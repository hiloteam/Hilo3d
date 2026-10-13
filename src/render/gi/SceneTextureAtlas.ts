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

const layout = new Std140Layout({ destination: 'uvec4' });
class AtlasParameters implements ComputeRenderPassParameters {
    readonly uniform = new UniformBuffer(layout);
    readonly uniformBuffers = [this.uniform];
    readonly buffers = [{ buffer: 0 as RenderGraphBufferHandle }];
    readonly textures = [{ texture: 0 as RenderGraphTextureHandle }];
    readonly dispatch = { x: 1, y: 1 };
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
        parameters.dispatch.x = Math.ceil(texture.width / 8);
        parameters.dispatch.y = Math.ceil(texture.height / 8);
        context.graph.addPass(this.pass, parameters);
    }
}
