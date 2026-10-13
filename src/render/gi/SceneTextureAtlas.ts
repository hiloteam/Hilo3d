import ComputeShader from '../compute/ComputeShader';
import ComputeKernel from '../compute/ComputeKernel';
import UniformBuffer from '../UniformBuffer';
import { Std140Layout } from '../ubo/Std140Layout';
import {
    ComputeRenderPass,
    type ComputeRenderPassParameters
} from '../pipeline/passes/ComputeRenderPass';
import { RenderPassParameterPool } from '../pipeline/RenderPassParameterPool';
import type { RenderPipelineContext } from '../pipeline/RenderPipeline';
import type {
    RenderGraphBufferHandle,
    RenderGraphTextureHandle
} from '../pipeline/ScriptableRenderGraph';
import type { RaySceneTexture } from './scene/SceneMaterials';
import Shader from '../../shader/Shader';
import portableCoordinates from '../../shader/method/portableCoordinates.glsl';
import { DEFAULT_MATERIAL_PIPELINE_STATE } from '../../material/MaterialDefinition';
import {
    FullscreenRenderPass,
    type FullscreenRenderPassParameters
} from '../pipeline/passes/FullscreenRenderPass';

const layout = new Std140Layout({ destination: 'uvec4' });
class AtlasParameters implements ComputeRenderPassParameters {
    readonly uniform = new UniformBuffer(layout);
    readonly uniformBuffers = [this.uniform];
    readonly buffers = [{ buffer: 0 as RenderGraphBufferHandle }];
    readonly textures = [{ texture: 0 as RenderGraphTextureHandle }];
    readonly dispatch = { x: 1, y: 1 };
}

class NormalizationParameters implements FullscreenRenderPassParameters {
    readonly inputTextures = [0 as RenderGraphTextureHandle];
    readonly colorAttachments = [
        {
            texture: 0 as RenderGraphTextureHandle,
            loadOp: 'clear' as const,
            storeOp: 'store' as const,
            clearValue: { r: 0, g: 0, b: 0, a: 0 }
        }
    ];
    readonly descriptor = {
        format: 'rgba32float' as const,
        extent: { width: 1, height: 1 }
    };
}

/** @internal Decode compressed images through portable raster before compute transport. */
export function createSceneTextureNormalizationShader(): Shader {
    return new Shader({
        // Image UVs are logical top-left on both backends, unlike the attachment-sampling UVs
        // produced by the ordinary fullscreen vertex shader. Directional parity tests cover both.
        vs: `#version 300 es
out vec2 v_uv;
void main() {
    vec2 position = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
    v_uv = vec2(position.x, 1.0 - position.y);
}`,
        fs: `#version 300 es
precision highp float;
in vec2 v_uv;
${portableCoordinates}
uniform sampler2D u_source;
layout(location = 0) out vec4 color;
void main() {
    // Fullscreen v_uv addresses logical top-left rows. Cross the managed-image boundary once;
    // integer level-zero fetch preserves decoded channels without filtering or another sRGB decode.
    ivec2 texel = ivec2(hiloTextureUV(v_uv) * vec2(textureSize(u_source, 0)));
    color = texelFetch(u_source, texel, 0);
}`
    });
}

/** Copies the uploaded source without CPU readback, including compressed and HDR sources.
 * WebGPU managed-image rows already use top-left logical coordinates: textureLoad is the one
 * normalized sampling boundary here. Material UVs are subsequently sampled in this same domain.
 */
export function createSceneTextureAtlasShader(): ComputeShader {
    return new ComputeShader({
        label: 'DDGI texture transport atlas upload',
        source: `
struct Parameters { destination: vec4<u32>, }
@group(0) @binding(0) var<uniform> parameters: Parameters;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> texels: array<vec4<f32>>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let size = parameters.destination.yz;
    if (any(id.xy >= size)) { return; }
    texels[parameters.destination.x + id.y * size.x + id.x] = textureLoad(source, vec2<i32>(id.xy), 0);
}`,
        workgroupSize: [8, 8],
        bindings: [
            {
                name: 'parameters',
                group: 0,
                binding: 0,
                kind: 'uniform-buffer',
                minBindingSize: 16
            },
            {
                name: 'source',
                group: 0,
                binding: 1,
                kind: 'sampled-texture',
                sampleType: 'unfilterable-float'
            },
            {
                name: 'texels',
                group: 0,
                binding: 2,
                kind: 'storage-buffer',
                access: 'read-write',
                minBindingSize: 16
            }
        ]
    });
}

export class SceneTextureAtlas {
    private readonly pass = new ComputeRenderPass(
        new ComputeKernel({ shader: createSceneTextureAtlasShader() })
    );
    private readonly pool = new RenderPassParameterPool(() => new AtlasParameters());
    private readonly normalizationShader = createSceneTextureNormalizationShader();
    private readonly normalizationPass = new FullscreenRenderPass({
        name: 'DDGI compressed texture normalization',
        shader: this.normalizationShader,
        pipelineState: {
            ...DEFAULT_MATERIAL_PIPELINE_STATE,
            depthTest: false,
            depthWrite: false,
            cullMode: 'none'
        }
    });
    private readonly normalizationPool = new RenderPassParameterPool(
        () => new NormalizationParameters()
    );
    record(
        context: RenderPipelineContext,
        buffer: RenderGraphBufferHandle,
        texture: RaySceneTexture
    ): void {
        const parameters = context.acquirePassParameters(this.pool);
        parameters.uniform.set('destination', [texture.offset, texture.width, texture.height, 0]);
        const output = parameters.buffers[0];
        const source = parameters.textures[0];
        if (!output || !source) throw new Error('Missing DDGI atlas resource binding');
        output.buffer = buffer;
        source.texture = context.graph.importTexture(texture.texture);
        if (texture.texture.compressed) {
            // Some WebGPU software adapters lose compressed compute reads after resource recovery.
            // Raster decoding avoids that path and preserves HDR/alpha/normal channels in float32.
            // Only changed assets reach record(): stable frames allocate no normalization targets.
            const normalization = context.acquirePassParameters(this.normalizationPool);
            normalization.descriptor.extent.width = texture.width;
            normalization.descriptor.extent.height = texture.height;
            normalization.inputTextures[0] = source.texture;
            const attachment = normalization.colorAttachments[0];
            if (!attachment) throw new Error('Missing DDGI normalization attachment');
            attachment.texture = context.graph.createTexture(
                'DDGI decoded compressed texture',
                normalization.descriptor
            );
            context.graph.addPass(this.normalizationPass, normalization);
            source.texture = attachment.texture;
        }
        parameters.dispatch.x = Math.ceil(texture.width / 8);
        parameters.dispatch.y = Math.ceil(texture.height / 8);
        context.graph.addPass(this.pass, parameters);
    }

    destroy(): void {
        this.normalizationShader.destroy();
    }
}
