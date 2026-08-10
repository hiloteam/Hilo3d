import type Camera from '../../camera/Camera';
import { getTransformHistoryRevision } from '../../core/TransformHistory';
import { DEFAULT_MATERIAL_PIPELINE_STATE } from '../../material/MaterialDefinition';
import Shader from '../../shader/Shader';
import UniformBuffer from '../UniformBuffer';
import { renderTargetFormatHasStencil } from '../RenderTarget';
import type {
    ForwardRenderFeatureContext,
    ForwardRenderPipelineFeature,
    ForwardRenderPipelineFeatureRuntime
} from '../pipeline/ForwardRenderPipeline';
import { RenderPassParameterPool } from '../pipeline/RenderPassParameterPool';
import type { CullingResultsHandle } from '../pipeline/RendererList';
import {
    FullscreenRenderPass,
    SceneRenderPass,
    type FullscreenRenderPassParameters,
    type SceneRenderPassParameters
} from '../pipeline/passes';
import { PORTABLE_FULLSCREEN_VERTEX_SOURCE } from '../pipeline/passes/internal/PortableFullscreenShader';
import type {
    RenderGraphTextureAccessHandle,
    RenderGraphTextureHandle,
    RenderPipelineColorAttachment,
    RenderPipelineDepthStencilAttachment,
    RenderPipelineHistoryTextureResources
} from '../pipeline/ScriptableRenderGraph';
import { createStd140Layout } from '../ubo/Std140Layout';
import { registerUniformBlockBinding } from '../ubo/UniformBlockBindings';

const TEMPORAL_AA_BLOCK = `layout(std140) uniform TemporalAABlock {
    float u_historyWeight;
    float u_depthThreshold;
    vec2 u_temporalPadding;
};`;

const INITIALIZE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_depth;
layout(location = 0) out vec4 historyColor;
layout(location = 1) out vec4 resolvedColor;
layout(location = 2) out float historyDepth;
void main() {
    vec4 current = texture(u_scene, v_uv);
    historyColor = current;
    resolvedColor = current;
    historyDepth = texture(u_depth, v_uv).r;
}`;

const RESOLVE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_history;
uniform sampler2D u_velocity;
uniform sampler2D u_depth;
uniform sampler2D u_historyDepth;
${TEMPORAL_AA_BLOCK}
layout(location = 0) out vec4 historyColor;
layout(location = 1) out vec4 resolvedColor;
layout(location = 2) out float historyDepth;

void main() {
    vec4 current = texture(u_scene, v_uv);
    float currentDepth = texture(u_depth, v_uv).r;
    vec2 velocity = texture(u_velocity, v_uv).xy;
    vec2 historyUV = v_uv - velocity;
    bool inside = all(greaterThanEqual(historyUV, vec2(0.0))) &&
        all(lessThanEqual(historyUV, vec2(1.0)));

    vec2 texel = 1.0 / vec2(textureSize(u_scene, 0));
    vec3 neighborhoodMin = current.rgb;
    vec3 neighborhoodMax = current.rgb;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec3 sampleColor = texture(u_scene, v_uv + vec2(float(x), float(y)) * texel).rgb;
            neighborhoodMin = min(neighborhoodMin, sampleColor);
            neighborhoodMax = max(neighborhoodMax, sampleColor);
        }
    }

    vec4 previous = inside ? texture(u_history, historyUV) : current;
    float previousDepth = inside ? texture(u_historyDepth, historyUV).r : currentDepth;
    float depthLimit = u_depthThreshold * max(1.0, abs(currentDepth));
    float accepted = inside && abs(previousDepth - currentDepth) <= depthLimit ? 1.0 : 0.0;
    vec3 clampedHistory = clamp(previous.rgb, neighborhoodMin, neighborhoodMax);
    vec3 resolved = mix(current.rgb, clampedHistory, u_historyWeight * accepted);
    vec4 result = vec4(resolved, current.a);
    historyColor = result;
    resolvedColor = result;
    historyDepth = currentDepth;
}`;

registerUniformBlockBinding('TemporalAABlock');

const temporalAALayout = createStd140Layout({
    u_historyWeight: 'float',
    u_depthThreshold: 'float',
    u_temporalPadding: 'vec2'
});

const OUTPUT_EXTENT = Object.freeze({ relativeTo: 'output' as const, scale: 1 });
const VELOCITY_DESCRIPTOR = Object.freeze({
    format: 'rg16float' as const,
    extent: OUTPUT_EXTENT
});
const RESOLVED_DESCRIPTOR = Object.freeze({
    format: 'rgba16float' as const,
    extent: OUTPUT_EXTENT
});
const COLOR_HISTORY_DESCRIPTOR = Object.freeze({
    label: 'TemporalAA color history',
    format: 'rgba16float' as const,
    extent: OUTPUT_EXTENT,
    usage: Object.freeze(['sampled' as const, 'attachment' as const]),
    bufferCount: 2 as const
});
const DEPTH_HISTORY_DESCRIPTOR = Object.freeze({
    label: 'TemporalAA depth history',
    format: 'r16float' as const,
    extent: OUTPUT_EXTENT,
    usage: Object.freeze(['sampled' as const, 'attachment' as const]),
    bufferCount: 2 as const
});
const CLEAR_ZERO = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });

const JITTER_SEQUENCE: readonly Readonly<{ x: number; y: number }>[] = Object.freeze([
    Object.freeze({ x: 0, y: -1 / 6 }),
    Object.freeze({ x: -1 / 4, y: 1 / 6 }),
    Object.freeze({ x: 1 / 4, y: -7 / 18 }),
    Object.freeze({ x: -3 / 8, y: -1 / 18 }),
    Object.freeze({ x: 1 / 8, y: 5 / 18 }),
    Object.freeze({ x: -1 / 8, y: -5 / 18 }),
    Object.freeze({ x: 3 / 8, y: 1 / 18 }),
    Object.freeze({ x: -7 / 16, y: 7 / 18 })
]);

interface CameraTemporalState {
    readonly camera: Camera;
    readonly colorHistoryKey: object;
    readonly depthHistoryKey: object;
    committedTransformRevision: number;
    committedJitterIndex: number;
    pendingTransformRevision: number;
    pendingJitterIndex: number;
    pendingFrame: number;
}

interface MutableVelocityColorAttachment extends RenderPipelineColorAttachment {
    texture: RenderGraphTextureHandle;
}

interface MutableVelocityDepthAttachment extends RenderPipelineDepthStencilAttachment {
    texture: RenderGraphTextureHandle;
    stencilReadOnly?: boolean;
}

class VelocityPassParameters implements SceneRenderPassParameters {
    rendererList = 0 as SceneRenderPassParameters['rendererList'];
    readonly colorAttachments: MutableVelocityColorAttachment[] = [
        {
            texture: 0 as RenderGraphTextureHandle,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: CLEAR_ZERO
        }
    ];
    readonly depthStencilAttachment: MutableVelocityDepthAttachment = {
        texture: 0 as RenderGraphTextureHandle,
        depthReadOnly: true
    };

    configure(
        rendererList: SceneRenderPassParameters['rendererList'],
        velocity: RenderGraphTextureHandle,
        depth: RenderGraphTextureHandle,
        stencilReadOnly: boolean
    ): void {
        this.rendererList = rendererList;
        const color = this.colorAttachments[0];
        if (color === undefined) throw new Error('TemporalAA velocity attachment is unavailable');
        color.texture = velocity;
        this.depthStencilAttachment.texture = depth;
        if (stencilReadOnly) this.depthStencilAttachment.stencilReadOnly = true;
        else delete this.depthStencilAttachment.stencilReadOnly;
    }
}

interface MutableTemporalColorAttachment extends RenderPipelineColorAttachment {
    texture: RenderGraphTextureHandle;
}

class TemporalResolveParameters implements FullscreenRenderPassParameters {
    readonly inputTextures: RenderGraphTextureAccessHandle[] = [];
    readonly colorAttachments: MutableTemporalColorAttachment[] = [
        {
            texture: 0 as RenderGraphTextureHandle,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: CLEAR_ZERO
        },
        {
            texture: 0 as RenderGraphTextureHandle,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: CLEAR_ZERO
        },
        {
            texture: 0 as RenderGraphTextureHandle,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: CLEAR_ZERO
        }
    ];

    configure(
        inputs: readonly RenderGraphTextureAccessHandle[],
        colorHistory: RenderGraphTextureHandle,
        resolved: RenderGraphTextureHandle,
        depthHistory: RenderGraphTextureHandle
    ): void {
        this.inputTextures.length = inputs.length;
        for (let index = 0; index < inputs.length; index += 1) {
            const input = inputs[index];
            if (input === undefined)
                throw new TypeError('TemporalAA input array must not be sparse');
            this.inputTextures[index] = input;
        }
        const colorAttachment = this.colorAttachments[0];
        const resolvedAttachment = this.colorAttachments[1];
        const depthAttachment = this.colorAttachments[2];
        if (
            colorAttachment === undefined ||
            resolvedAttachment === undefined ||
            depthAttachment === undefined
        ) {
            throw new Error('TemporalAA resolve attachments are incomplete');
        }
        colorAttachment.texture = colorHistory;
        resolvedAttachment.texture = resolved;
        depthAttachment.texture = depthHistory;
    }

    reset(): void {
        this.inputTextures.length = 0;
    }
}

/** Native-resolution temporal resolve controls. */
export interface TemporalAAOptions {
    /** Accepted history contribution after rejection and clamping. Defaults to 0.9. */
    readonly historyWeight?: number;
    /** Raw depth difference that rejects reprojected history. Defaults to 0.002. */
    readonly depthThreshold?: number;
}

interface TemporalAASettings {
    readonly historyWeight: number;
    readonly depthThreshold: number;
}

function finiteRange(value: number, minimum: number, maximum: number, label: string): number {
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
        throw new RangeError(
            `${label} must be finite and between ${String(minimum)} and ${String(maximum)}`
        );
    }
    return value;
}

function snapshotOptions(options: Readonly<TemporalAAOptions>): TemporalAASettings {
    return Object.freeze({
        historyWeight: finiteRange(options.historyWeight ?? 0.9, 0, 1, 'TemporalAA historyWeight'),
        depthThreshold: finiteRange(
            options.depthThreshold ?? 0.002,
            0,
            1,
            'TemporalAA depthThreshold'
        )
    });
}

class TemporalAARuntime implements ForwardRenderPipelineFeatureRuntime {
    readonly #block: UniformBuffer<typeof temporalAALayout.schema>;
    readonly #velocityPass = new SceneRenderPass('TemporalAA motion vectors');
    readonly #initializePass: FullscreenRenderPass;
    readonly #resolvePass: FullscreenRenderPass;
    readonly #velocityParameters = new RenderPassParameterPool(() => new VelocityPassParameters());
    readonly #resolveParameters = new RenderPassParameterPool(
        () => new TemporalResolveParameters(),
        parameters => {
            parameters.reset();
        }
    );
    readonly #rendererListDescriptor: {
        cullingResults: CullingResultsHandle;
        readonly queue: 'opaque';
        readonly sorting: 'material-front-to-back';
        readonly materialPass: 'motion-vector';
    } = {
        cullingResults: 0 as CullingResultsHandle,
        queue: 'opaque',
        sorting: 'material-front-to-back',
        materialPass: 'motion-vector'
    };
    readonly #states = new WeakMap<Camera, CameraTemporalState>();
    readonly #ownedStates = new Set<CameraTemporalState>();
    readonly #stagedStates: CameraTemporalState[] = [];
    #destroyed = false;

    constructor(settings: TemporalAASettings) {
        this.#block = UniformBuffer.fromSchema(temporalAALayout, {
            u_historyWeight: settings.historyWeight,
            u_depthThreshold: settings.depthThreshold,
            u_temporalPadding: [0, 0]
        });
        const pass = (name: string, fs: string, uniformBuffers: readonly UniformBuffer[]) =>
            new FullscreenRenderPass({
                name,
                shader: new Shader({ vs: PORTABLE_FULLSCREEN_VERTEX_SOURCE, fs }),
                pipelineState: {
                    ...DEFAULT_MATERIAL_PIPELINE_STATE,
                    depthTest: false,
                    depthWrite: false,
                    cullMode: 'none'
                },
                uniformBuffers
            });
        this.#initializePass = pass('TemporalAA initialize history', INITIALIZE_FRAGMENT, []);
        this.#resolvePass = pass('TemporalAA resolve', RESOLVE_FRAGMENT, [this.#block]);
    }

    record(context: ForwardRenderFeatureContext): void {
        if (this.#destroyed) throw new Error('TemporalAA runtime is destroyed');
        const pipeline = context.pipeline;
        const scene = context.resources.color;
        const depth = context.resources.depth;
        if (scene === null || depth === null) {
            throw new Error('TemporalAA requires opaque scene color and sampled depth');
        }
        const [x, y, width, height] = pipeline.viewport;
        if (
            x !== 0 ||
            y !== 0 ||
            width !== pipeline.output.width ||
            height !== pipeline.output.height
        ) {
            throw new Error('TemporalAA currently requires a full-output viewport');
        }
        const state = this.stageCamera(pipeline.camera, pipeline.frameIndex, width, height);
        const transformRevision = getTransformHistoryRevision(pipeline.camera);
        if (
            state.committedTransformRevision >= 0 &&
            state.committedTransformRevision !== transformRevision
        ) {
            pipeline.graph.invalidateHistoryTexture(state.colorHistoryKey);
            pipeline.graph.invalidateHistoryTexture(state.depthHistoryKey);
        }

        const colorHistory = pipeline.graph.acquireHistoryTexture(
            state.colorHistoryKey,
            COLOR_HISTORY_DESCRIPTOR
        );
        const depthHistory = pipeline.graph.acquireHistoryTexture(
            state.depthHistoryKey,
            DEPTH_HISTORY_DESCRIPTOR
        );
        const historyValid = colorHistory.valid && depthHistory.valid;
        this.validateHistoryPair(colorHistory, depthHistory);

        const velocity = pipeline.graph.createTexture(
            'TemporalAA rg16float velocity',
            VELOCITY_DESCRIPTOR
        );
        this.#rendererListDescriptor.cullingResults = context.cullingResults;
        const velocityList = pipeline.createRendererList(this.#rendererListDescriptor);
        const velocityParameters = pipeline.acquirePassParameters(this.#velocityParameters);
        velocityParameters.configure(
            velocityList,
            velocity,
            depth,
            pipeline.output.depthStencilFormat !== null &&
                renderTargetFormatHasStencil(pipeline.output.depthStencilFormat)
        );
        pipeline.graph.addPass(this.#velocityPass, velocityParameters);

        const resolved = pipeline.graph.createTexture(
            'TemporalAA resolved color',
            RESOLVED_DESCRIPTOR
        );
        const parameters = pipeline.acquirePassParameters(this.#resolveParameters);
        parameters.configure(
            historyValid
                ? [scene, colorHistory.history(), velocity, depth, depthHistory.history()]
                : [scene, depth],
            colorHistory.current,
            resolved,
            depthHistory.current
        );
        pipeline.graph.addPass(historyValid ? this.#resolvePass : this.#initializePass, parameters);
        context.resources.replaceColor(resolved, 'linear');
    }

    frameSubmitted(frameIndex: number): void {
        for (const state of this.#stagedStates) {
            if (state.pendingFrame !== frameIndex) continue;
            state.committedTransformRevision = state.pendingTransformRevision;
            state.committedJitterIndex = (state.pendingJitterIndex + 1) % JITTER_SEQUENCE.length;
            state.pendingFrame = -1;
        }
        this.#stagedStates.length = 0;
    }

    frameDiscarded(frameIndex: number): void {
        for (const state of this.#stagedStates) {
            if (state.pendingFrame !== frameIndex) continue;
            state.pendingFrame = -1;
            state.camera.clearProjectionJitter();
        }
        this.#stagedStates.length = 0;
    }

    destroy(): void {
        if (this.#destroyed) return;
        for (const state of this.#ownedStates) state.camera.clearProjectionJitter();
        this.#ownedStates.clear();
        this.#stagedStates.length = 0;
        this.#destroyed = true;
    }

    private stageCamera(
        camera: Camera,
        frameIndex: number,
        width: number,
        height: number
    ): CameraTemporalState {
        let state = this.#states.get(camera);
        if (state === undefined) {
            state = {
                camera,
                colorHistoryKey: Object.freeze({}),
                depthHistoryKey: Object.freeze({}),
                committedTransformRevision: -1,
                committedJitterIndex: 0,
                pendingTransformRevision: -1,
                pendingJitterIndex: 0,
                pendingFrame: -1
            };
            this.#states.set(camera, state);
            this.#ownedStates.add(state);
        }
        if (state.pendingFrame === frameIndex) {
            throw new Error(
                'TemporalAA supports one invocation per camera in an application frame'
            );
        }
        state.pendingFrame = frameIndex;
        state.pendingTransformRevision = getTransformHistoryRevision(camera);
        state.pendingJitterIndex = state.committedJitterIndex;
        this.#stagedStates.push(state);
        const jitter = JITTER_SEQUENCE[state.pendingJitterIndex];
        if (jitter === undefined) throw new Error('TemporalAA jitter sequence is incomplete');
        camera.setProjectionJitter((jitter.x * 2) / width, (jitter.y * 2) / height);
        return state;
    }

    private validateHistoryPair(
        color: RenderPipelineHistoryTextureResources,
        depth: RenderPipelineHistoryTextureResources
    ): void {
        if (color.valid !== depth.valid || color.generation !== depth.generation) {
            throw new Error('TemporalAA color and depth history generations diverged');
        }
    }
}

/**
 * Native-resolution temporal anti-aliasing feature.
 *
 * The feature records built-in opaque/masked motion vectors after opaque shading, resolves only
 * opaque scene color, then lets transparent rendering and Bloom compose afterward. History uses
 * submission-aware double buffers and is reset by camera cuts, resize, or device recovery.
 */
export class TemporalAA implements ForwardRenderPipelineFeature {
    readonly name = 'temporal-aa';
    readonly injectionPoint = 'after-opaque' as const;
    readonly requirements = Object.freeze({
        sampledSceneColor: true,
        sampledDepth: true,
        requiredLimits: Object.freeze({ maxColorAttachments: 3 }),
        requiredTextureFormats: Object.freeze([
            Object.freeze({ format: 'rgba16float' as const, use: 'color-attachment' as const }),
            Object.freeze({ format: 'rgba16float' as const, use: 'filterable-sampled' as const }),
            Object.freeze({ format: 'rg16float' as const, use: 'color-attachment' as const }),
            Object.freeze({ format: 'rg16float' as const, use: 'filterable-sampled' as const }),
            Object.freeze({ format: 'r16float' as const, use: 'color-attachment' as const }),
            Object.freeze({ format: 'r16float' as const, use: 'filterable-sampled' as const })
        ])
    });
    readonly #settings: TemporalAASettings;

    constructor(options: Readonly<TemporalAAOptions> = {}) {
        this.#settings = snapshotOptions(options);
    }

    create(): ForwardRenderPipelineFeatureRuntime {
        return new TemporalAARuntime(this.#settings);
    }
}
