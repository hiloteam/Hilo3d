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
import type { RenderPipelineContext, RenderPipelineRequirements } from '../pipeline/RenderPipeline';
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
    float u_varianceGamma;
    float u_sharpness;
};`;

const INITIALIZE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_velocity;
layout(location = 0) out vec4 historyColor;
layout(location = 1) out vec4 resolvedColor;
layout(location = 2) out float historyDepth;
void main() {
    vec4 current = texture(u_scene, v_uv);
    vec4 motion = texture(u_velocity, v_uv);
    historyColor = current;
    resolvedColor = current;
    historyDepth = motion.w;
}`;

const RESOLVE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_history;
uniform sampler2D u_velocity;
uniform sampler2D u_historyDepth;
${TEMPORAL_AA_BLOCK}
layout(location = 0) out vec4 historyColor;
layout(location = 1) out vec4 resolvedColor;
layout(location = 2) out float historyDepth;

vec3 rgbToYCoCg(vec3 value) {
    return vec3(
        dot(value, vec3(0.25, 0.5, 0.25)),
        dot(value, vec3(0.5, 0.0, -0.5)),
        dot(value, vec3(-0.25, 0.5, -0.25))
    );
}

vec3 yCoCgToRgb(vec3 value) {
    return vec3(value.x + value.y - value.z, value.x + value.z, value.x - value.y - value.z);
}

float relativeDepthError(float historyLogDepth, float expectedLogDepth) {
    float historyLinear = exp2(max(historyLogDepth, 0.0)) - 1.0;
    float expectedLinear = exp2(max(expectedLogDepth, 0.0)) - 1.0;
    return abs(historyLinear - expectedLinear) / max(expectedLinear, 1e-3);
}

float minimumHistoryDepthError(vec2 historyUV, float expectedLogDepth) {
    ivec2 dimensions = textureSize(u_historyDepth, 0);
    vec2 samplePosition = historyUV * vec2(dimensions) - 0.5;
    ivec2 base = ivec2(floor(samplePosition));
    float error = 1e20;
    for (int y = 0; y <= 1; y++) {
        for (int x = 0; x <= 1; x++) {
            ivec2 coordinate = clamp(base + ivec2(x, y), ivec2(0), dimensions - ivec2(1));
            error = min(
                error,
                relativeDepthError(texelFetch(u_historyDepth, coordinate, 0).r, expectedLogDepth)
            );
        }
    }
    return error;
}

void main() {
    ivec2 dimensions = textureSize(u_scene, 0);
    ivec2 pixel = clamp(ivec2(v_uv * vec2(dimensions)), ivec2(0), dimensions - ivec2(1));
    vec4 current = texelFetch(u_scene, pixel, 0);
    vec4 motion = texelFetch(u_velocity, pixel, 0);
    vec2 historyUV = v_uv - motion.xy;
    vec2 halfTexel = 0.5 / vec2(dimensions);
    bool inside = all(greaterThanEqual(historyUV, halfTexel)) &&
        all(lessThanEqual(historyUV, vec2(1.0) - halfTexel));

    vec3 currentWorking = rgbToYCoCg(current.rgb);
    vec3 neighborhoodMin = currentWorking;
    vec3 neighborhoodMax = currentWorking;
    vec3 moment1 = currentWorking;
    vec3 moment2 = currentWorking * currentWorking;
    vec3 crossSum = vec3(0.0);
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            if (x == 0 && y == 0) continue;
            ivec2 coordinate = clamp(pixel + ivec2(x, y), ivec2(0), dimensions - ivec2(1));
            vec3 sampleWorking = rgbToYCoCg(texelFetch(u_scene, coordinate, 0).rgb);
            neighborhoodMin = min(neighborhoodMin, sampleWorking);
            neighborhoodMax = max(neighborhoodMax, sampleWorking);
            moment1 += sampleWorking;
            moment2 += sampleWorking * sampleWorking;
            if (abs(x) + abs(y) == 1) crossSum += sampleWorking;
        }
    }

    vec3 mean = moment1 / 9.0;
    vec3 deviation = sqrt(max(moment2 / 9.0 - mean * mean, vec3(0.0)));
    vec3 clipMin = max(neighborhoodMin, mean - deviation * u_varianceGamma);
    vec3 clipMax = min(neighborhoodMax, mean + deviation * u_varianceGamma);
    vec2 sampledHistoryUV = clamp(historyUV, halfTexel, vec2(1.0) - halfTexel);
    vec4 sampledPrevious = textureLod(u_history, sampledHistoryUV, 0.0);
    vec4 previous = inside ? sampledPrevious : current;
    vec3 previousWorking = clamp(rgbToYCoCg(previous.rgb), clipMin, clipMax);

    bool velocityValid = motion.z >= 0.0;
    float depthError = velocityValid && inside
        ? minimumHistoryDepthError(historyUV, motion.z)
        : 1e20;
    float accepted = velocityValid && inside && depthError <= u_depthThreshold ? 1.0 : 0.0;
    float velocityPixels = length(motion.xy * vec2(dimensions));
    float motionResponse = clamp(velocityPixels / 32.0, 0.0, 1.0);
    float temporalWeight = mix(u_historyWeight, min(u_historyWeight, 0.6), motionResponse);
    float luminanceDelta = abs(previousWorking.x - currentWorking.x) /
        max(max(abs(previousWorking.x), abs(currentWorking.x)), 0.1);
    float reactive = clamp(luminanceDelta * 1.5, 0.0, 1.0);
    temporalWeight *= 1.0 - reactive * 0.8;

    vec3 resolvedWorking = mix(currentWorking, previousWorking, temporalWeight * accepted);
    vec3 resolved = max(yCoCgToRgb(resolvedWorking), vec3(0.0));
    vec3 crossAverage = crossSum * 0.25;
    vec3 sharpenedWorking = resolvedWorking +
        (resolvedWorking - crossAverage) * u_sharpness;
    vec3 sharpened = max(yCoCgToRgb(sharpenedWorking), vec3(0.0));
    historyColor = vec4(resolved, current.a);
    resolvedColor = vec4(sharpened, current.a);
    historyDepth = motion.w;
}`;

registerUniformBlockBinding('TemporalAABlock');

const temporalAALayout = createStd140Layout({
    u_historyWeight: 'float',
    u_depthThreshold: 'float',
    u_varianceGamma: 'float',
    u_sharpness: 'float'
});

const OUTPUT_EXTENT = Object.freeze({ relativeTo: 'output' as const, scale: 1 });
/** @internal Motion XY, expected previous log2 view depth, and current log2 view depth. */
export const TEMPORAL_MOTION_DESCRIPTOR = Object.freeze({
    format: 'rgba16float' as const,
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
    label: 'TemporalAA linear-depth history',
    format: 'r32float' as const,
    extent: OUTPUT_EXTENT,
    usage: Object.freeze(['sampled' as const, 'attachment' as const]),
    bufferCount: 2 as const
});
const CLEAR_ZERO = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });
/** @internal Clear value that marks pixels without a valid previous surface. */
export const TEMPORAL_MOTION_CLEAR = Object.freeze({ r: 0, g: 0, b: -1, a: 0 });
const CAMERA_HISTORY_RETENTION_FRAMES = 2;
const PROJECTION_CUT_THRESHOLD = 0.1;

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
    readonly committedProjection: Float32Array;
    readonly pendingProjection: Float32Array;
    committedTransformRevision: number;
    committedJitterIndex: number;
    committedSubmission: number;
    pendingTransformRevision: number;
    pendingJitterIndex: number;
    pendingFrame: number;
    lastTouchedFrame: number;
}

/** @internal Resources staged for one temporal resolve invocation. */
export interface TemporalResolveFrame {
    readonly state: CameraTemporalState;
    readonly historyValid: boolean;
    readonly colorHistory: RenderPipelineHistoryTextureResources;
    readonly depthHistory: RenderPipelineHistoryTextureResources;
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
            clearValue: TEMPORAL_MOTION_CLEAR
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
    /** Maximum accepted history contribution after rejection. Defaults to 0.92. */
    readonly historyWeight?: number;
    /** Maximum relative previous-view-depth error. Defaults to 0.02. */
    readonly depthThreshold?: number;
    /** Standard-deviation extent used by YCoCg variance clipping. Defaults to 1.25. */
    readonly varianceGamma?: number;
    /** Resolve-only contrast restoration; history remains unsharpened. Defaults to 0.08. */
    readonly sharpness?: number;
}

/** @internal Immutable temporal settings shared by Forward and GPU Scene pipelines. */
export interface TemporalAASettings {
    readonly historyWeight: number;
    readonly depthThreshold: number;
    readonly varianceGamma: number;
    readonly sharpness: number;
}

function finiteRange(value: number, minimum: number, maximum: number, label: string): number {
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
        throw new RangeError(
            `${label} must be finite and between ${String(minimum)} and ${String(maximum)}`
        );
    }
    return value;
}

/** @internal Validate and freeze public temporal options. */
export function snapshotTemporalAAOptions(
    options: Readonly<TemporalAAOptions>
): TemporalAASettings {
    return Object.freeze({
        historyWeight: finiteRange(options.historyWeight ?? 0.92, 0, 1, 'TemporalAA historyWeight'),
        depthThreshold: finiteRange(
            options.depthThreshold ?? 0.02,
            0,
            1,
            'TemporalAA depthThreshold'
        ),
        varianceGamma: finiteRange(
            options.varianceGamma ?? 1.25,
            0.25,
            4,
            'TemporalAA varianceGamma'
        ),
        sharpness: finiteRange(options.sharpness ?? 0.08, 0, 0.5, 'TemporalAA sharpness')
    });
}

/** Static requirements shared by every pipeline that uses the built-in temporal resolve. */
export const TEMPORAL_AA_REQUIREMENTS = Object.freeze({
    requiredLimits: Object.freeze({ maxColorAttachments: 3 }),
    requiredTextureFormats: Object.freeze([
        Object.freeze({ format: 'rgba16float' as const, use: 'color-attachment' as const }),
        Object.freeze({ format: 'rgba16float' as const, use: 'filterable-sampled' as const }),
        Object.freeze({ format: 'r32float' as const, use: 'color-attachment' as const }),
        Object.freeze({ format: 'r32float' as const, use: 'sampled' as const })
    ])
}) satisfies Readonly<RenderPipelineRequirements>;

function projectionCut(previous: ArrayLike<number>, current: ArrayLike<number>): boolean {
    // Any depth mapping change invalidates linear-depth history. XY scale/offset changes are
    // reprojectable until they cross a deliberate cut threshold.
    for (const index of [10, 11, 14, 15]) {
        if (Math.abs((previous[index] ?? 0) - (current[index] ?? 0)) > 1e-6) return true;
    }
    for (const index of [0, 4, 5, 8, 9, 12, 13]) {
        const before = previous[index] ?? 0;
        const after = current[index] ?? 0;
        const scale = Math.max(Math.abs(before), Math.abs(after), 1e-6);
        if (Math.abs(before - after) / scale > PROJECTION_CUT_THRESHOLD) return true;
    }
    return false;
}

/**
 * @internal Submission-aware temporal history and resolve controller shared by rendering paths.
 */
export class TemporalResolveController {
    readonly #block: UniformBuffer<typeof temporalAALayout.schema>;
    readonly #initializePass: FullscreenRenderPass;
    readonly #resolvePass: FullscreenRenderPass;
    readonly #resolveParameters = new RenderPassParameterPool(
        () => new TemporalResolveParameters(),
        parameters => {
            parameters.reset();
        }
    );
    readonly #states = new WeakMap<Camera, CameraTemporalState>();
    readonly #ownedStates = new Set<CameraTemporalState>();
    readonly #stagedStates: CameraTemporalState[] = [];
    readonly #pendingEvictions: CameraTemporalState[] = [];
    #destroyed = false;
    #submissionIndex = 0;

    constructor(settings: TemporalAASettings) {
        this.#block = UniformBuffer.fromSchema(temporalAALayout, {
            u_historyWeight: settings.historyWeight,
            u_depthThreshold: settings.depthThreshold,
            u_varianceGamma: settings.varianceGamma,
            u_sharpness: settings.sharpness
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
        this.#resolvePass = pass('TemporalAA production resolve', RESOLVE_FRAGMENT, [this.#block]);
    }

    begin(context: RenderPipelineContext): TemporalResolveFrame {
        if (this.#destroyed) throw new Error('TemporalAA resolve controller is destroyed');
        const [x, y, width, height] = context.viewport;
        if (
            x !== 0 ||
            y !== 0 ||
            width !== context.output.width ||
            height !== context.output.height
        ) {
            throw new Error('TemporalAA currently requires a full-output viewport');
        }
        this.sweepInactiveStates(context, context.camera);
        const state = this.stageCamera(context.camera, context.frameIndex, width, height);
        const transformRevision = getTransformHistoryRevision(context.camera);
        const discontinuous =
            state.committedSubmission >= 0 &&
            (state.committedSubmission !== this.#submissionIndex ||
                state.committedTransformRevision !== transformRevision ||
                projectionCut(state.committedProjection, context.camera.projectionMatrix.elements));
        if (discontinuous) {
            context.graph.invalidateHistoryTexture(state.colorHistoryKey);
            context.graph.invalidateHistoryTexture(state.depthHistoryKey);
        }
        const colorHistory = context.graph.acquireHistoryTexture(
            state.colorHistoryKey,
            COLOR_HISTORY_DESCRIPTOR
        );
        const depthHistory = context.graph.acquireHistoryTexture(
            state.depthHistoryKey,
            DEPTH_HISTORY_DESCRIPTOR
        );
        this.validateHistoryPair(colorHistory, depthHistory);
        return Object.freeze({
            state,
            historyValid: !discontinuous && colorHistory.valid && depthHistory.valid,
            colorHistory,
            depthHistory
        });
    }

    resolve(
        context: RenderPipelineContext,
        frame: TemporalResolveFrame,
        scene: RenderGraphTextureHandle,
        velocity: RenderGraphTextureHandle
    ): RenderGraphTextureHandle {
        if (frame.state.pendingFrame !== context.frameIndex) {
            throw new Error('TemporalAA resolve frame belongs to another application frame');
        }
        const resolved = context.graph.createTexture(
            'TemporalAA resolved color',
            RESOLVED_DESCRIPTOR
        );
        const parameters = context.acquirePassParameters(this.#resolveParameters);
        parameters.configure(
            frame.historyValid
                ? [scene, frame.colorHistory.history(), velocity, frame.depthHistory.history()]
                : [scene, velocity],
            frame.colorHistory.current,
            resolved,
            frame.depthHistory.current
        );
        context.graph.addPass(
            frame.historyValid ? this.#resolvePass : this.#initializePass,
            parameters
        );
        return resolved;
    }

    frameSubmitted(frameIndex: number): void {
        const committedSubmission = this.#submissionIndex + 1;
        for (const state of this.#stagedStates) {
            if (state.pendingFrame !== frameIndex) continue;
            state.committedTransformRevision = state.pendingTransformRevision;
            state.committedJitterIndex = (state.pendingJitterIndex + 1) % JITTER_SEQUENCE.length;
            state.committedProjection.set(state.pendingProjection);
            state.committedSubmission = committedSubmission;
            state.pendingFrame = -1;
            state.camera.clearProjectionJitter();
        }
        for (const state of this.#pendingEvictions) {
            this.#states.delete(state.camera);
            this.#ownedStates.delete(state);
            state.camera.clearProjectionJitter();
        }
        this.#stagedStates.length = 0;
        this.#pendingEvictions.length = 0;
        this.#submissionIndex = committedSubmission;
    }

    frameDiscarded(frameIndex: number): void {
        for (const state of this.#stagedStates) {
            if (state.pendingFrame !== frameIndex) continue;
            state.pendingFrame = -1;
            state.camera.clearProjectionJitter();
        }
        this.#stagedStates.length = 0;
        this.#pendingEvictions.length = 0;
    }

    destroy(): void {
        if (this.#destroyed) return;
        for (const state of this.#ownedStates) state.camera.clearProjectionJitter();
        this.#ownedStates.clear();
        this.#stagedStates.length = 0;
        this.#pendingEvictions.length = 0;
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
                committedProjection: new Float32Array(16),
                pendingProjection: new Float32Array(16),
                committedTransformRevision: -1,
                committedJitterIndex: 0,
                committedSubmission: -1,
                pendingTransformRevision: -1,
                pendingJitterIndex: 0,
                pendingFrame: -1,
                lastTouchedFrame: frameIndex
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
        state.lastTouchedFrame = frameIndex;
        state.pendingTransformRevision = getTransformHistoryRevision(camera);
        state.pendingJitterIndex = state.committedJitterIndex;
        state.pendingProjection.set(camera.projectionMatrix.elements);
        this.#stagedStates.push(state);
        const jitter = JITTER_SEQUENCE[state.pendingJitterIndex];
        if (jitter === undefined) throw new Error('TemporalAA jitter sequence is incomplete');
        camera.setProjectionJitter((jitter.x * 2) / width, (jitter.y * 2) / height);
        return state;
    }

    private sweepInactiveStates(context: RenderPipelineContext, activeCamera: Camera): void {
        for (const state of this.#ownedStates) {
            if (
                state.camera === activeCamera ||
                state.pendingFrame >= 0 ||
                state.lastTouchedFrame >= context.frameIndex - CAMERA_HISTORY_RETENTION_FRAMES ||
                this.#pendingEvictions.includes(state)
            ) {
                continue;
            }
            context.graph.releaseHistoryTexture(state.colorHistoryKey);
            context.graph.releaseHistoryTexture(state.depthHistoryKey);
            this.#pendingEvictions.push(state);
        }
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

class TemporalAARuntime implements ForwardRenderPipelineFeatureRuntime {
    readonly #resolve: TemporalResolveController;
    readonly #velocityPass = new SceneRenderPass('TemporalAA motion vectors');
    readonly #velocityParameters = new RenderPassParameterPool(() => new VelocityPassParameters());
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

    constructor(settings: TemporalAASettings) {
        this.#resolve = new TemporalResolveController(settings);
    }

    record(context: ForwardRenderFeatureContext): void {
        const pipeline = context.pipeline;
        const scene = context.resources.color;
        const depth = context.resources.depth;
        if (scene === null || depth === null) {
            throw new Error('TemporalAA requires opaque scene color and sampled depth');
        }
        const frame = this.#resolve.begin(pipeline);
        const velocity = pipeline.graph.createTexture(
            'TemporalAA rgba16float motion and view depth',
            TEMPORAL_MOTION_DESCRIPTOR
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
        context.resources.replaceColor(
            this.#resolve.resolve(pipeline, frame, scene, velocity),
            'linear'
        );
    }

    frameSubmitted(frameIndex: number): void {
        this.#resolve.frameSubmitted(frameIndex);
    }

    frameDiscarded(frameIndex: number): void {
        this.#resolve.frameDiscarded(frameIndex);
    }

    destroy(): void {
        this.#resolve.destroy();
    }
}

/**
 * Native-resolution temporal anti-aliasing feature.
 *
 * The feature records built-in opaque/masked motion and logarithmic view-depth data after opaque
 * shading, resolves only opaque scene color, then lets transparent rendering and Bloom compose
 * afterward. History uses submission-aware double buffers and is reset by camera cuts, resize,
 * projection discontinuities, visibility gaps, or device recovery.
 */
export class TemporalAA implements ForwardRenderPipelineFeature {
    readonly name = 'temporal-aa';
    readonly injectionPoint = 'after-opaque' as const;
    readonly requirements = Object.freeze({
        sampledSceneColor: true,
        sampledDepth: true,
        ...TEMPORAL_AA_REQUIREMENTS
    });
    readonly #settings: TemporalAASettings;

    constructor(options: Readonly<TemporalAAOptions> = {}) {
        this.#settings = snapshotTemporalAAOptions(options);
    }

    create(): ForwardRenderPipelineFeatureRuntime {
        return new TemporalAARuntime(this.#settings);
    }
}
