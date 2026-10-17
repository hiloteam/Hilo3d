import Mesh from '../../core/Mesh';
import Node from '../../core/Node';
import PBRMaterial from '../../material/PBRMaterial';
import { DEFAULT_MATERIAL_PIPELINE_STATE } from '../../material/MaterialDefinition';
import Shader from '../../shader/Shader';
import UniformBuffer from '../UniformBuffer';
import type {
    ForwardRenderFeatureContext,
    ForwardRenderFeatureRequirements,
    ForwardRenderPipelineFeature,
    ForwardRenderPipelineFeatureRuntime
} from '../pipeline/ForwardRenderPipeline';
import type { RenderPipelineContext, RenderPipelineRequirements } from '../pipeline/RenderPipeline';
import type { CullingResultsHandle, RendererListHandle } from '../pipeline/RendererList';
import { RenderPassParameterPool } from '../pipeline/RenderPassParameterPool';
import {
    FullscreenRenderPass,
    SceneRenderPass,
    type SceneRenderPassParameters,
    type SceneStorageShaderVariant
} from '../pipeline/passes';
import { PORTABLE_FULLSCREEN_VERTEX_SOURCE } from '../pipeline/passes/internal/PortableFullscreenShader';
import type {
    RenderGraphTextureHandle,
    RenderPipelineColorAttachment,
    RenderPipelineDepthStencilAttachment
} from '../pipeline/ScriptableRenderGraph';
import { createStd140Layout } from '../ubo/Std140Layout';
import { registerUniformBlockBinding } from '../ubo/UniformBlockBindings';

/** Bounded portable, full-resolution subsurface diffusion controls. */
export interface SubsurfaceScatteringOptions {
    /** Taps per axis: 9, 17 (default), or 25. Two separable passes use exactly twice this count. */
    readonly sampleCount?: 9 | 17 | 25;
    /** Maximum projected three-sigma kernel radius, from 1 to 256 pixels. Defaults to 64. */
    readonly maxRadiusPixels?: number;
    /** Minimum view-normal cosine accepted across the kernel, from 0 to 1. Defaults to 0.5. */
    readonly normalThreshold?: number;
    /**
     * Maximum pixels per invocation. Defaults to 1920 × 1080. Six RGBA16F attachments cost
     * 48 bytes per pixel; Clustered DDGI + SSGI adds three matching baseline attachments (72 bytes
     * per pixel total), excluding shared scene color/depth and resource-pool retention.
     * Larger invocations fail before allocation, rather than silently lowering quality.
     */
    readonly maxPixelCount?: number;
}

/** @internal Validated settings shared by Forward and Clustered Forward+. */
export interface SubsurfaceScatteringSettings {
    readonly sampleCount: 9 | 17 | 25;
    readonly maxRadiusPixels: number;
    readonly normalThreshold: number;
    readonly maxPixelCount: number;
}

function range(value: number, minimum: number, maximum: number, name: string): number {
    if (!Number.isFinite(value) || value < minimum || value > maximum)
        throw new RangeError(
            `SubsurfaceScattering ${name} must be between ${String(minimum)} and ${String(maximum)}`
        );
    return value;
}

/** @internal Snapshot options without allocating GPU resources. */
export function snapshotSubsurfaceScatteringOptions(
    options: Readonly<SubsurfaceScatteringOptions> = {}
): Readonly<SubsurfaceScatteringSettings> {
    const sampleCount = options.sampleCount ?? 17;
    if (![9, 17, 25].includes(sampleCount))
        throw new RangeError('SubsurfaceScattering sampleCount must be 9, 17 or 25');
    const maxPixelCount = options.maxPixelCount ?? 1920 * 1080;
    if (!Number.isSafeInteger(maxPixelCount) || maxPixelCount < 1 || maxPixelCount > 16384 * 16384)
        throw new RangeError(
            'SubsurfaceScattering maxPixelCount must be an integer from 1 to 268435456'
        );
    return Object.freeze({
        sampleCount,
        maxPixelCount,
        maxRadiusPixels: range(options.maxRadiusPixels ?? 64, 1, 256, 'maxRadiusPixels'),
        normalThreshold: range(options.normalThreshold ?? 0.5, 0, 1, 'normalThreshold')
    });
}

/** @internal Portable MRT and sampling requirements, checked before backend selection. */
export const SUBSURFACE_SCATTERING_REQUIREMENTS: Readonly<RenderPipelineRequirements> =
    Object.freeze({
        requiredLimits: Object.freeze({
            maxColorAttachments: 3,
            maxColorAttachmentBytesPerSample: 24,
            maxSampledTexturesPerShaderStage: 4,
            maxSamplersPerShaderStage: 4
        }),
        requiredTextureFormats: Object.freeze([
            Object.freeze({ format: 'rgba16float' as const, use: 'color-attachment' as const }),
            Object.freeze({ format: 'rgba16float' as const, use: 'filterable-sampled' as const })
        ])
    });

registerUniformBlockBinding('SubsurfaceScatteringBlock');
/** @internal Per-invocation projection and quality data; immutable through submission/discard. */
export const SUBSURFACE_SCATTERING_LAYOUT = createStd140Layout({
    u_sssProjection: 'vec4',
    u_sssFilter: 'vec4'
});
const BLOCK = `layout(std140) uniform SubsurfaceScatteringBlock {
    vec4 u_sssProjection;
    vec4 u_sssFilter;
};`;

function diffusionFragment(samples: number, horizontal: boolean): string {
    return `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_diffuse;
uniform sampler2D u_profile;
uniform sampler2D u_geometry;
${BLOCK}
layout(location=0) out vec4 color;
vec3 decodeNormal(vec2 encoded) {
    vec2 f = encoded * 2.0 - 1.0;
    vec3 n = vec3(f, 1.0 - abs(f.x) - abs(f.y));
    float t = max(-n.z, 0.0);
    n.xy += vec2(n.x >= 0.0 ? -t : t, n.y >= 0.0 ? -t : t);
    return normalize(n);
}
void main() {
    // PORTABLE_FULLSCREEN_VERTEX_SOURCE already crosses the render-target UV boundary once.
    // Integer fetches and offsets below stay in that native attachment coordinate system.
    ivec2 size = textureSize(u_diffuse, 0);
    ivec2 centerPixel = clamp(ivec2(v_uv * vec2(size)), ivec2(0), size - 1);
    vec4 center = texelFetch(u_diffuse, centerPixel, 0);
    vec4 profile = texelFetch(u_profile, centerPixel, 0);
    vec4 geometry = texelFetch(u_geometry, centerPixel, 0);
    if (geometry.a < 0.5) { color = center; return; }
    float depth = exp2(geometry.b) - 1.0;
    vec3 sigma = max(min(profile.rgb, vec3(profile.a)), vec3(0.00001));
    float maxSigma = max(sigma.r, max(sigma.g, sigma.b));
    float pixelsPerUnit = u_sssProjection.${horizontal ? 'x' : 'y'} / mix(max(depth, 0.00001), 1.0, u_sssProjection.z);
    float radiusPixels = min(3.0 * maxSigma * pixelsPerUnit, u_sssFilter.x);
    if (radiusPixels < 0.5) { color = center; return; }
    vec3 centerNormal = decodeNormal(geometry.rg);
    vec3 total = vec3(0.0);
    vec3 weights = vec3(0.0);
    for (int tap = 0; tap < ${String(samples)}; ++tap) {
        float offset = (float(tap) / ${String((samples - 1) / 2)}.0 - 1.0) * radiusPixels;
        ivec2 coordinate = centerPixel + ${horizontal ? 'ivec2(int(round(offset)), 0)' : 'ivec2(0, int(round(offset)))'};
        if (any(lessThan(coordinate, ivec2(0))) || any(greaterThanEqual(coordinate, size))) continue;
        vec4 otherGeometry = texelFetch(u_geometry, coordinate, 0);
        if (otherGeometry.a < 0.5) continue;
        vec4 otherProfile = texelFetch(u_profile, coordinate, 0);
        // Radius triples define canonical profile identity, independent of object allocation.
        if (any(notEqual(profile.rgb, otherProfile.rgb))) continue;
        float otherDepth = exp2(otherGeometry.b) - 1.0;
        float depthAllowance = max(min(profile.a, otherProfile.a), depth * 0.0015);
        if (abs(otherDepth - depth) > depthAllowance || dot(centerNormal, decodeNormal(otherGeometry.rg)) < u_sssFilter.y) continue;
        float distanceWorld = float(abs(coordinate.${horizontal ? 'x' : 'y'} - centerPixel.${horizontal ? 'x' : 'y'})) / max(pixelsPerUnit, 0.00001);
        vec3 weight = exp(-0.5 * distanceWorld * distanceWorld / (sigma * sigma));
        vec4 sampleValue = texelFetch(u_diffuse, coordinate, 0);
        total += sampleValue.rgb * weight;
        weights += weight;
    }
    color = vec4(total / max(weights, vec3(0.000001)), center.a);
}`;
}

const COMPOSITE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_diffuse;
uniform sampler2D u_scattered;
layout(location=0) out vec4 color;
void main() {
    // The shared fullscreen vertex shader performs the single attachment-UV normalization.
    ivec2 size = textureSize(u_scene, 0);
    ivec2 pixel = clamp(ivec2(v_uv * vec2(size)), ivec2(0), size - 1);
    vec4 scene = texelFetch(u_scene, pixel, 0);
    vec4 diffuse = texelFetch(u_diffuse, pixel, 0);
    vec3 scattered = texelFetch(u_scattered, pixel, 0).rgb;
    color = vec4(scene.rgb + (scattered - diffuse.rgb) * diffuse.a, scene.a);
}`;
const BASELINE_COMPOSITE = COMPOSITE.replace(
    'uniform sampler2D u_scattered;',
    'uniform sampler2D u_scattered;\nuniform sampler2D u_strength;'
).replace(
    '(scattered - diffuse.rgb) * diffuse.a',
    '(scattered - diffuse.rgb) * texelFetch(u_strength, pixel, 0).a'
);
const INVALID_TEXTURE = 0 as RenderGraphTextureHandle;
const INVALID_LIST = 0 as RendererListHandle;
const STATE = Object.freeze({
    ...DEFAULT_MATERIAL_PIPELINE_STATE,
    depthTest: false,
    depthWrite: false,
    cullMode: 'none' as const
});
const CLEAR = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });

/** @internal Frame-local input; clustered overrides reuse the exact native direct-light recipe. */
export interface SubsurfaceScatteringFrame {
    readonly cullingResults: CullingResultsHandle;
    readonly sceneColor: RenderGraphTextureHandle;
    readonly sceneDepth: RenderGraphTextureHandle;
    readonly sceneScale: number;
    /** Unfiltered DDGI contribution that SSGI later subtracts from scene color. */
    readonly hybridBaseline?: RenderGraphTextureHandle;
    readonly ambientOcclusion?: RenderGraphTextureHandle | null;
    readonly storageShaderVariant?: Readonly<SceneStorageShaderVariant>;
}
/** @internal Scene and optional DDGI baseline undergo exactly the same diffusion operator. */
export interface SubsurfaceScatteringResult {
    readonly sceneColor: RenderGraphTextureHandle;
    readonly hybridBaseline?: RenderGraphTextureHandle;
}
interface SceneParameters extends SceneRenderPassParameters {
    rendererList: RendererListHandle;
    colorAttachments: RenderPipelineColorAttachment[];
    depthStencilAttachment?: RenderPipelineDepthStencilAttachment;
    ambientOcclusionTexture?: RenderGraphTextureHandle;
    storageShaderVariant?: Readonly<SceneStorageShaderVariant>;
}

function collectMeshes(context: RenderPipelineContext, meshes: Mesh[]): void {
    meshes.length = 0;
    context.scene.traverse(node => {
        if (!node.visible) return Node.TRAVERSE_STOP_CHILDREN;
        if (
            node instanceof Mesh &&
            !node.isDestroyed &&
            node.geometry !== null &&
            node.material instanceof PBRMaterial &&
            node.material.subsurfaceProfile !== null &&
            node.material.subsurfaceFactor > 0 &&
            (context.camera.visibility & node.layer) !== 0 &&
            (!node.frustumTest || context.camera.isMeshVisible(node))
        )
            meshes.push(node);
        return undefined;
    });
}

/** @internal Stateless, submission-safe recorder. Transient graph ownership handles resize/recovery. */
export class SubsurfaceScatteringController {
    readonly #settings: Readonly<SubsurfaceScatteringSettings>;
    readonly #meshes: Mesh[] = [];
    readonly #surface = new SceneRenderPass('Subsurface diffuse and profile');
    readonly #shaders: readonly Shader[];
    readonly #scenePool = new RenderPassParameterPool<SceneParameters>(() => ({
        rendererList: INVALID_LIST,
        colorAttachments: []
    }));
    readonly #fullscreenPool = new RenderPassParameterPool(() => ({
        inputTextures: [INVALID_TEXTURE, INVALID_TEXTURE, INVALID_TEXTURE],
        colorAttachments: [
            {
                texture: INVALID_TEXTURE,
                loadOp: 'clear' as const,
                storeOp: 'store' as const,
                clearValue: CLEAR
            }
        ]
    }));
    readonly #invocations: RenderPassParameterPool<{
        uniform: UniformBuffer;
        projection: Float32Array;
        filter: Float32Array;
        passes: readonly FullscreenRenderPass[];
    }>;
    #destroyed = false;

    constructor(settings: Readonly<SubsurfaceScatteringSettings>) {
        this.#settings = settings;
        this.#shaders = [
            diffusionFragment(settings.sampleCount, true),
            diffusionFragment(settings.sampleCount, false),
            COMPOSITE,
            BASELINE_COMPOSITE
        ].map(fs => new Shader({ vs: PORTABLE_FULLSCREEN_VERTEX_SOURCE, fs }));
        this.#invocations = new RenderPassParameterPool(() => {
            const uniform = new UniformBuffer(SUBSURFACE_SCATTERING_LAYOUT);
            return {
                uniform,
                projection: new Float32Array(4),
                filter: new Float32Array(4),
                passes: this.#shaders.map(
                    (shader, index) =>
                        new FullscreenRenderPass({
                            name:
                                [
                                    'Subsurface horizontal diffusion',
                                    'Subsurface vertical diffusion',
                                    'Subsurface diffuse replacement',
                                    'Subsurface DDGI baseline replacement'
                                ][index] ?? 'Subsurface',
                            shader,
                            uniformBuffers: index < 2 ? [uniform] : [],
                            pipelineState: STATE
                        })
                )
            };
        });
    }

    hasVisibleSurfaces(context: RenderPipelineContext): boolean {
        collectMeshes(context, this.#meshes);
        return this.#meshes.length !== 0;
    }

    record(
        context: RenderPipelineContext,
        frame: Readonly<SubsurfaceScatteringFrame>
    ): Readonly<SubsurfaceScatteringResult> {
        if (this.#destroyed) throw new Error('SubsurfaceScattering is destroyed');
        collectMeshes(context, this.#meshes);
        if (this.#meshes.length === 0)
            return {
                sceneColor: frame.sceneColor,
                ...(frame.hybridBaseline === undefined
                    ? {}
                    : { hybridBaseline: frame.hybridBaseline })
            };
        if (frame.storageShaderVariant !== undefined) {
            for (const mesh of this.#meshes) {
                if (frame.storageShaderVariant.shaderByMesh?.has(mesh) !== true) {
                    throw new TypeError(
                        'SubsurfaceScattering requires an exact clustered shader for every participating surface'
                    );
                }
            }
        }
        if (context.scene.fog !== undefined && context.scene.fog !== null)
            throw new TypeError(
                'SubsurfaceScattering does not support material fog; use post-process volumetric fog'
            );
        if (
            context.viewport[0] !== 0 ||
            context.viewport[1] !== 0 ||
            context.viewport[2] !== context.output.width ||
            context.viewport[3] !== context.output.height
        )
            throw new TypeError('SubsurfaceScattering requires a full-output camera viewport');
        const width = Math.max(1, Math.floor(context.output.width * frame.sceneScale));
        const height = Math.max(1, Math.floor(context.output.height * frame.sceneScale));
        if (width * height > this.#settings.maxPixelCount)
            throw new RangeError('SubsurfaceScattering invocation exceeds maxPixelCount');
        const textures = [
            'Subsurface diffuse',
            'Subsurface profile',
            'Subsurface geometry',
            'Subsurface horizontal',
            'Subsurface vertical',
            'Subsurface composed'
        ].map(name =>
            context.graph.createTexture(name, {
                format: 'rgba16float',
                extent: { width, height },
                sampleCount: 1
            })
        );
        const [diffuse, profile, geometry, horizontal, vertical, composed] = textures;
        if (
            diffuse === undefined ||
            profile === undefined ||
            geometry === undefined ||
            horizontal === undefined ||
            vertical === undefined ||
            composed === undefined
        )
            throw new Error('SubsurfaceScattering attachment allocation failed');
        const scene = context.acquirePassParameters(this.#scenePool);
        scene.rendererList = context.createOrderedRendererList({
            cullingResults: frame.cullingResults,
            meshes: this.#meshes,
            materialPass: 'subsurface'
        });
        scene.colorAttachments.length = 3;
        for (let index = 0; index < 3; index++)
            scene.colorAttachments[index] = {
                texture: textures[index] ?? INVALID_TEXTURE,
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: CLEAR
            };
        scene.depthStencilAttachment = { texture: frame.sceneDepth, depthReadOnly: true };
        if (frame.ambientOcclusion === undefined || frame.ambientOcclusion === null)
            delete scene.ambientOcclusionTexture;
        else scene.ambientOcclusionTexture = frame.ambientOcclusion;
        if (frame.storageShaderVariant === undefined) delete scene.storageShaderVariant;
        else scene.storageShaderVariant = frame.storageShaderVariant;
        context.graph.addPass(this.#surface, scene);
        const invocation = context.acquirePassParameters(this.#invocations);
        const projection = context.camera.projectionMatrix.elements;
        invocation.projection[0] = Math.abs(projection[0]) * width * 0.5;
        invocation.projection[1] = Math.abs(projection[5]) * height * 0.5;
        invocation.projection[2] = Math.abs(projection[15]) > 0.5 ? 1 : 0;
        invocation.filter[0] = this.#settings.maxRadiusPixels;
        invocation.filter[1] = this.#settings.normalThreshold;
        invocation.uniform.set('u_sssProjection', invocation.projection);
        invocation.uniform.set('u_sssFilter', invocation.filter);
        const sources: RenderGraphTextureHandle[][] = [
            [diffuse, profile, geometry],
            [horizontal, profile, geometry],
            [frame.sceneColor, diffuse, vertical]
        ];
        const outputs = [horizontal, vertical, composed];
        const passIndices = [0, 1, 2];
        let baseline: RenderGraphTextureHandle | undefined;
        if (frame.hybridBaseline !== undefined) {
            const baselineHorizontal = context.graph.createTexture('Subsurface DDGI horizontal', {
                format: 'rgba16float',
                extent: { width, height },
                sampleCount: 1
            });
            const baselineVertical = context.graph.createTexture('Subsurface DDGI vertical', {
                format: 'rgba16float',
                extent: { width, height },
                sampleCount: 1
            });
            baseline = context.graph.createTexture('Subsurface DDGI baseline', {
                format: 'rgba16float',
                extent: { width, height },
                sampleCount: 1
            });
            sources.push(
                [frame.hybridBaseline, profile, geometry],
                [baselineHorizontal, profile, geometry],
                [frame.hybridBaseline, frame.hybridBaseline, baselineVertical, diffuse]
            );
            outputs.push(baselineHorizontal, baselineVertical, baseline);
            passIndices.push(0, 1, 3);
        }
        for (let index = 0; index < outputs.length; index++) {
            const pass = invocation.passes[passIndices[index] ?? 0];
            const inputs = sources[index];
            const output = outputs[index];
            if (pass === undefined || inputs === undefined || output === undefined)
                throw new Error('SubsurfaceScattering pass is missing');
            const parameters = context.acquirePassParameters(this.#fullscreenPool);
            parameters.inputTextures.length = inputs.length;
            for (let slot = 0; slot < inputs.length; slot++)
                parameters.inputTextures[slot] = inputs[slot] ?? INVALID_TEXTURE;
            parameters.colorAttachments[0] = {
                texture: output,
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: CLEAR
            };
            context.graph.addPass(pass, parameters);
        }
        return {
            sceneColor: composed,
            ...(baseline === undefined ? {} : { hybridBaseline: baseline })
        };
    }

    destroy(): void {
        if (this.#destroyed) return;
        this.#destroyed = true;
        for (const shader of this.#shaders) shader.destroy();
        this.#meshes.length = 0;
    }
}

class SubsurfaceScatteringRuntime implements ForwardRenderPipelineFeatureRuntime {
    readonly #controller: SubsurfaceScatteringController;
    constructor(settings: Readonly<SubsurfaceScatteringSettings>) {
        this.#controller = new SubsurfaceScatteringController(settings);
    }
    record(context: ForwardRenderFeatureContext): void {
        if (!this.#controller.hasVisibleSurfaces(context.pipeline)) return;
        const color = context.resources.color;
        const depth = context.resources.depth;
        if (color === null || depth === null || context.resources.colorEncoding !== 'linear')
            throw new TypeError(
                'SubsurfaceScattering requires linear scene color and opaque depth'
            );
        context.resources.replaceColor(
            this.#controller.record(context.pipeline, {
                cullingResults: context.cullingResults,
                sceneColor: color,
                sceneDepth: depth,
                sceneScale: context.resources.sceneScale,
                ambientOcclusion: context.resources.ambientOcclusionTexture
            }).sceneColor,
            'linear'
        );
    }
    destroy(): void {
        this.#controller.destroy();
    }
}

/**
 * Profile-based, depth/normal-isolated diffuse scattering before transparent rendering and TAA.
 * Specular, sheen and emission remain in the original scene color. Only the diffuse lighting
 * contribution is replaced. Opaque and alpha-masked PBR materials, including skin/morph, share
 * the canonical scene evaluator. This finite screen-space approximation cannot scatter hidden
 * or off-screen light and does not simulate volumetric back transmission.
 */
export class SubsurfaceScattering implements ForwardRenderPipelineFeature {
    readonly name = 'subsurface-scattering';
    readonly injectionPoint = 'after-opaque' as const;
    readonly requirements: Readonly<ForwardRenderFeatureRequirements> = Object.freeze({
        sampledSceneColor: true,
        sampledDepth: false,
        splitScene: true,
        subsurfaceScattering: true,
        ...SUBSURFACE_SCATTERING_REQUIREMENTS
    });
    readonly #settings: Readonly<SubsurfaceScatteringSettings>;
    constructor(options: Readonly<SubsurfaceScatteringOptions> = {}) {
        this.#settings = snapshotSubsurfaceScatteringOptions(options);
    }
    create(): ForwardRenderPipelineFeatureRuntime {
        return new SubsurfaceScatteringRuntime(this.#settings);
    }
}
