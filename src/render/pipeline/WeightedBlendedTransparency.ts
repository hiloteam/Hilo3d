import UniformBuffer from '../UniformBuffer';
import {
    MAX_WEIGHTED_FRAGMENT_COUNT,
    WEIGHTED_TRANSPARENCY_LAYOUT,
    weightedFragmentBound,
    writeWeightedNormalization
} from './internal/weightedTransparencyNumerics';
import { DEFAULT_MATERIAL_PIPELINE_STATE } from '../../material/MaterialDefinition';
import { MaterialBlendPreset } from '../../material/MaterialCompiler';
import Shader from '../../shader/Shader';
import Mesh from '../../core/Mesh';
import Node from '../../core/Node';
import type { RenderPipelineContext, RenderPipelineRequirements } from './RenderPipeline';
import type { CullingResultsHandle, RendererListHandle } from './RendererList';
import type {
    RenderGraphTextureHandle,
    RenderPipelineColorAttachment,
    RenderPipelineDepthStencilAttachment,
    RenderPipelineExtent
} from './ScriptableRenderGraph';
import { RenderPassParameterPool } from './RenderPassParameterPool';
import { SceneRenderPass, type SceneStorageShaderVariant } from './passes/SceneRenderPass';
import { FullscreenRenderPass } from './passes/FullscreenRenderPass';
import { PORTABLE_FULLSCREEN_VERTEX_SOURCE } from './passes/internal/PortableFullscreenShader';

/** Portable weighted-blended transparency resource limits. */
export interface WeightedBlendedTransparencyOptions {
    /**
     * Maximum pixels per invocation, defaulting to 3840 × 2160. Accumulation and revealage use
     * 26 bytes per pixel, excluding shared scene color/depth and resource-pool retention.
     * Oversized invocations fail before allocation rather than reducing quality silently.
     */
    readonly maxPixelCount?: number;
    /** Conservative visible primitive × instance budget, from 1 to 1,048,576. Defaults to the maximum. */
    readonly maxFragmentCount?: number;
}

/** @internal Static format constraints shared by Forward and Clustered Forward+. */
export const WEIGHTED_BLENDED_TRANSPARENCY_REQUIREMENTS: Readonly<RenderPipelineRequirements> =
    Object.freeze({
        requiredLimits: Object.freeze({
            maxColorAttachments: 3,
            maxColorAttachmentBytesPerSample: 24
        }),
        requiredTextureFormats: Object.freeze([
            Object.freeze({
                format: 'rgba16float' as const,
                use: 'blendable-color-attachment' as const
            }),
            Object.freeze({ format: 'rgba16float' as const, use: 'filterable-sampled' as const }),
            Object.freeze({
                format: 'r16float' as const,
                use: 'blendable-color-attachment' as const
            }),
            Object.freeze({ format: 'r16float' as const, use: 'filterable-sampled' as const })
        ])
    });

/** @internal One invocation, after opaque temporal resolve and before sorted transparency. */
export interface WeightedBlendedTransparencyFrame {
    readonly cullingResults: CullingResultsHandle;
    readonly color: RenderGraphTextureHandle;
    readonly depth: RenderGraphTextureHandle;
    readonly scale?: number;
    readonly hasStencil?: boolean;
    readonly clustered?: Readonly<{
        meshes: readonly Mesh[];
        accumulation: Readonly<SceneStorageShaderVariant>;
        revealage: Readonly<SceneStorageShaderVariant>;
    }>;
}

/** @internal Avoid transient attachments and shader preparation for empty weighted queues. */
export function hasVisibleWeightedTransparency(context: RenderPipelineContext): boolean {
    let found = false;
    context.scene.traverse(node => {
        if (found || !node.visible) return Node.TRAVERSE_STOP_CHILDREN;
        if (
            node instanceof Mesh &&
            !node.isDestroyed &&
            node.geometry !== null &&
            node.material?.transparencyClass === 'weighted-blended' &&
            (context.camera.visibility & node.layer) !== 0 &&
            (!node.frustumTest || context.camera.isMeshVisible(node))
        )
            found = true;
        return undefined;
    });
    return found;
}

/** @internal Validate without allocating renderer-local shader objects. */
export function snapshotWeightedBlendedTransparencyOptions(
    input: boolean | Readonly<WeightedBlendedTransparencyOptions> | undefined
): Readonly<WeightedBlendedTransparencyOptions> | null {
    const candidate: unknown = input;
    if (candidate === undefined || candidate === false) return null;
    if (
        candidate !== true &&
        (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate))
    ) {
        throw new TypeError('weightedBlendedTransparency must be a boolean or options object');
    }
    const maxPixelCount: unknown =
        candidate === true ? 3840 * 2160 : (Reflect.get(candidate, 'maxPixelCount') ?? 3840 * 2160);
    if (
        typeof maxPixelCount !== 'number' ||
        !Number.isSafeInteger(maxPixelCount) ||
        maxPixelCount < 1
    ) {
        throw new RangeError('Weighted transparency maxPixelCount must be a positive safe integer');
    }
    const maxFragmentCount: unknown =
        candidate === true
            ? MAX_WEIGHTED_FRAGMENT_COUNT
            : (Reflect.get(candidate, 'maxFragmentCount') ?? MAX_WEIGHTED_FRAGMENT_COUNT);
    if (
        typeof maxFragmentCount !== 'number' ||
        !Number.isSafeInteger(maxFragmentCount) ||
        maxFragmentCount < 1 ||
        maxFragmentCount > MAX_WEIGHTED_FRAGMENT_COUNT
    ) {
        throw new RangeError(
            'Weighted transparency maxFragmentCount must be an integer in [1, 1048576]'
        );
    }
    return Object.freeze({ maxPixelCount, maxFragmentCount });
}

const ZERO = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });
const INVALID_TEXTURE = 0 as RenderGraphTextureHandle;
const INVALID_LIST = 0 as RendererListHandle;

interface MutableColor extends RenderPipelineColorAttachment {
    texture: RenderGraphTextureHandle;
}

interface SceneParameters {
    rendererList: RendererListHandle;
    readonly colorAttachments: MutableColor[];
    depthStencilAttachment: RenderPipelineDepthStencilAttachment;
    storageShaderVariant?: Readonly<SceneStorageShaderVariant>;
    uniformBlocks?: Readonly<Record<string, UniformBuffer>>;
}

const COMPOSITE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_accumulation;
uniform sampler2D u_middle;
uniform sampler2D u_high;
uniform sampler2D u_revealage;
layout(std140) uniform WeightedTransparencyBlock { vec4 u_weightedTransparency; };
layout(location = 0) out vec4 color;
bool weightedFinite(vec4 value) {
    return all(lessThan(floatBitsToUint(value) & uvec4(0x7f800000u), uvec4(0x7f800000u)));
}
void main() {
    // The shared fullscreen vertex normalizes render-target UVs exactly once.
    vec4 low = texture(u_accumulation, v_uv);
    vec4 middle = texture(u_middle, v_uv);
    vec4 high = texture(u_high, v_uv);
    float opticalDepth = texture(u_revealage, v_uv).r;
    uint opticalBits = floatBitsToUint(opticalDepth) & 0x7fffffffu;
    bool invalidOpticalDepth = opticalBits > 0x7f800000u || opticalDepth < 0.0;
    // An out-of-contract source is visibly diagnosed; valid FP16 radiance cannot reach this path.
    if (!weightedFinite(low) || !weightedFinite(middle) || !weightedFinite(high) || high.a < 0.0 || invalidOpticalDepth) {
        color = vec4(1.0, 0.0, 1.0, 1.0);
        return;
    }
    // Positive optical-depth overflow is mathematically fully opaque, not invalid radiance.
    opticalDepth = min(opticalDepth, 24.0);
    float alpha = opticalDepth < 0.01
        ? opticalDepth * (1.0 - opticalDepth * (0.5 - opticalDepth * (1.0 / 6.0 - opticalDepth / 24.0)))
        : 1.0 - exp(-opticalDepth);
    vec4 accumulation = low + middle / u_weightedTransparency.y + high / u_weightedTransparency.z;
    // Zero coverage leaves both the scene's HDR radiance and premultiplied alpha unchanged.
    // A positive-weight mean of valid sources is inside the same signed FP16 domain. Enforce
    // that mathematical envelope only against reconstruction roundoff at the representable edge.
    vec3 averageColor = clamp(accumulation.rgb / max(accumulation.a, 1e-20), vec3(-65504.0), vec3(65504.0));
    color = vec4(averageColor * alpha, alpha);
}`;

/** @internal Stateless graph recorder; all attachments belong to the graph's recovery lifecycle. */
export class WeightedBlendedTransparency {
    readonly maxPixelCount: number;
    readonly maxFragmentCount: number;
    readonly #accumulationPass = new SceneRenderPass('Weighted transparency HDR accumulation');
    readonly #revealagePass = new SceneRenderPass('Weighted transparency revealage');
    readonly #compositeShader = new Shader({
        vs: PORTABLE_FULLSCREEN_VERTEX_SOURCE,
        fs: COMPOSITE_FRAGMENT
    });
    readonly #invocations = new RenderPassParameterPool(() => {
        const uniform = new UniformBuffer(WEIGHTED_TRANSPARENCY_LAYOUT);
        return {
            uniform,
            values: new Float32Array(4),
            uniformBlocks: Object.freeze({ WeightedTransparencyBlock: uniform }),
            composite: new FullscreenRenderPass({
                name: 'Weighted transparency HDR composition',
                shader: this.#compositeShader,
                uniformBuffers: [uniform],
                pipelineState: {
                    ...DEFAULT_MATERIAL_PIPELINE_STATE,
                    depthTest: false,
                    depthWrite: false,
                    cullMode: 'none',
                    blend: MaterialBlendPreset.PREMULTIPLIED_ALPHA
                }
            })
        };
    });
    readonly #sceneParameters = new RenderPassParameterPool<SceneParameters>(() => ({
        rendererList: INVALID_LIST,
        colorAttachments: [{ texture: INVALID_TEXTURE, loadOp: 'clear', storeOp: 'store' }],
        depthStencilAttachment: {
            texture: INVALID_TEXTURE,
            depthLoadOp: 'load',
            depthStoreOp: 'store',
            depthReadOnly: true
        }
    }));
    readonly #compositeParameters = new RenderPassParameterPool(() => ({
        inputTextures: [INVALID_TEXTURE, INVALID_TEXTURE, INVALID_TEXTURE, INVALID_TEXTURE],
        colorAttachments: [
            { texture: INVALID_TEXTURE, loadOp: 'load' as const, storeOp: 'store' as const }
        ]
    }));

    constructor(options: Readonly<WeightedBlendedTransparencyOptions> = {}) {
        const settings = snapshotWeightedBlendedTransparencyOptions(options);
        this.maxPixelCount = settings?.maxPixelCount ?? 3840 * 2160;
        this.maxFragmentCount = settings?.maxFragmentCount ?? MAX_WEIGHTED_FRAGMENT_COUNT;
    }

    record(
        context: RenderPipelineContext,
        frame: Readonly<WeightedBlendedTransparencyFrame>
    ): void {
        const scale = frame.scale ?? 1;
        if (!Number.isFinite(scale) || scale <= 0 || scale > 1) {
            throw new RangeError('Weighted transparency scale must be between zero and one');
        }
        const width = Math.max(1, Math.floor(context.output.width * scale));
        const height = Math.max(1, Math.floor(context.output.height * scale));
        if (width * height > this.maxPixelCount) {
            throw new RangeError('Weighted transparency invocation exceeds maxPixelCount');
        }
        const count = weightedFragmentBound(context, this.maxFragmentCount);
        if (count === 0) return;
        const invocation = context.acquirePassParameters(this.#invocations);
        writeWeightedNormalization(count, invocation.values);
        invocation.uniform.set('u_weightedTransparency', invocation.values);
        const extent: RenderPipelineExtent = { width, height };
        const accumulation = context.graph.createTexture('Weighted transparency low accumulation', {
            format: 'rgba16float',
            extent
        });
        const middle = context.graph.createTexture('Weighted transparency middle accumulation', {
            format: 'rgba16float',
            extent
        });
        const high = context.graph.createTexture('Weighted transparency high accumulation', {
            format: 'rgba16float',
            extent
        });
        const revealage = context.graph.createTexture('Weighted transparency revealage', {
            format: 'r16float',
            extent
        });
        const accumulations = [accumulation, middle, high];
        this.recordScene(
            context,
            frame,
            accumulations,
            'weighted-accumulation',
            invocation.uniformBlocks
        );
        if (frame.clustered !== undefined)
            this.recordClusteredScene(
                context,
                frame,
                accumulations,
                'weighted-accumulation',
                invocation.uniformBlocks
            );
        this.recordScene(
            context,
            frame,
            [revealage],
            'weighted-revealage',
            invocation.uniformBlocks
        );
        if (frame.clustered !== undefined)
            this.recordClusteredScene(
                context,
                frame,
                [revealage],
                'weighted-revealage',
                invocation.uniformBlocks
            );
        const parameters = context.acquirePassParameters(this.#compositeParameters);
        parameters.inputTextures[0] = accumulation;
        parameters.inputTextures[1] = middle;
        parameters.inputTextures[2] = high;
        parameters.inputTextures[3] = revealage;
        const attachment = parameters.colorAttachments[0];
        if (attachment === undefined)
            throw new Error('Weighted transparency composite attachment missing');
        attachment.texture = frame.color;
        context.graph.addPass(invocation.composite, parameters);
    }

    private recordScene(
        context: RenderPipelineContext,
        frame: Readonly<WeightedBlendedTransparencyFrame>,
        textures: readonly RenderGraphTextureHandle[],
        role: 'weighted-accumulation' | 'weighted-revealage',
        uniformBlocks: Readonly<Record<string, UniformBuffer>>
    ): void {
        const parameters = context.acquirePassParameters(this.#sceneParameters);
        parameters.rendererList = context.createRendererList({
            cullingResults: frame.cullingResults,
            queue: 'transparent',
            sorting: 'none',
            transparency: 'weighted-blended',
            ...(frame.clustered === undefined ? {} : { excludeMeshes: frame.clustered.meshes }),
            materialPass: role
        });
        parameters.uniformBlocks = uniformBlocks;
        parameters.colorAttachments.length = textures.length;
        for (const [index, texture] of textures.entries())
            parameters.colorAttachments[index] = {
                texture,
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: ZERO
            };
        parameters.depthStencilAttachment = {
            texture: frame.depth,
            depthReadOnly: true,
            ...(frame.hasStencil === true ? { stencilReadOnly: true } : {})
        };
        delete parameters.storageShaderVariant;
        context.graph.addPass(
            role === 'weighted-accumulation' ? this.#accumulationPass : this.#revealagePass,
            parameters
        );
    }

    private recordClusteredScene(
        context: RenderPipelineContext,
        frame: Readonly<WeightedBlendedTransparencyFrame>,
        textures: readonly RenderGraphTextureHandle[],
        role: 'weighted-accumulation' | 'weighted-revealage',
        uniformBlocks: Readonly<Record<string, UniformBuffer>>
    ): void {
        const clustered = frame.clustered;
        if (clustered === undefined) return;
        const parameters = context.acquirePassParameters(this.#sceneParameters);
        parameters.rendererList = context.createOrderedRendererList({
            cullingResults: frame.cullingResults,
            meshes: clustered.meshes,
            materialPass: role
        });
        parameters.uniformBlocks = uniformBlocks;
        parameters.colorAttachments.length = textures.length;
        for (const [index, texture] of textures.entries())
            parameters.colorAttachments[index] = { texture, loadOp: 'load', storeOp: 'store' };
        parameters.depthStencilAttachment = {
            texture: frame.depth,
            depthReadOnly: true,
            ...(frame.hasStencil === true ? { stencilReadOnly: true } : {})
        };
        parameters.storageShaderVariant =
            role === 'weighted-accumulation' ? clustered.accumulation : clustered.revealage;
        context.graph.addPass(
            role === 'weighted-accumulation' ? this.#accumulationPass : this.#revealagePass,
            parameters
        );
    }

    destroy(): void {
        this.#compositeShader.destroy();
    }
}
