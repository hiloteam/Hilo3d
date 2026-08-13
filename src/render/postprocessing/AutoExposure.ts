import type Camera from '../../camera/Camera';
import { getTransformHistoryRevision } from '../../core/TransformHistory';
import { DEFAULT_MATERIAL_PIPELINE_STATE } from '../../material/MaterialDefinition';
import Shader from '../../shader/Shader';
import ComputeKernel from '../compute/ComputeKernel';
import ComputeShader from '../compute/ComputeShader';
import type { StorageBuffer } from '../StorageBuffer';
import type {
    ForwardRenderFeatureContext,
    ForwardRenderPipelineFeature,
    ForwardRenderPipelineFeatureRuntime
} from '../pipeline/ForwardRenderPipeline';
import type {
    RenderPipelineContext,
    RenderPipelineCreateContext
} from '../pipeline/RenderPipeline';
import { RenderPassParameterPool } from '../pipeline/RenderPassParameterPool';
import {
    ComputeRenderPass,
    FullscreenRenderPass,
    type ComputeRenderPassParameters,
    type FullscreenRenderPassParameters
} from '../pipeline/passes';
import { PORTABLE_FULLSCREEN_VERTEX_SOURCE } from '../pipeline/passes/internal/PortableFullscreenShader';
import type {
    RenderGraphBufferHandle,
    RenderGraphTextureAccessHandle,
    RenderGraphTextureHandle,
    RenderPipelineColorAttachment,
    RenderPipelineHistoryTextureDescriptor,
    RenderPipelineTextureDescriptor,
    ScriptableRenderPass,
    ScriptableRenderPassBuilder,
    ScriptableRenderPassContext
} from '../pipeline/ScriptableRenderGraph';

const HISTOGRAM_BIN_COUNT = 256;
const HISTOGRAM_BYTES = HISTOGRAM_BIN_COUNT * 4;
const EXPOSURE_PARAMETER_BYTES = 64;
const EXPOSURE_DIAGNOSTIC_BYTES = 16;
const HISTOGRAM_WORKGROUP_SIZE = 8;
const INVALID_BUFFER = 0 as RenderGraphBufferHandle;
const INVALID_TEXTURE = 0 as RenderGraphTextureHandle;

/** Luminance-metering pattern used by {@link AutoExposure}. */
export type AutoExposureMeteringMode = 'average' | 'center-weighted';

/** GPU histogram, percentile metering, and eye-adaptation controls. */
export interface AutoExposureOptions {
    /** Lowest log2 luminance represented by the histogram. Defaults to -12. */
    readonly minimumLogLuminance?: number;
    /** Highest log2 luminance represented by the histogram. Defaults to 16. */
    readonly maximumLogLuminance?: number;
    /** Dark-tail percentile excluded from metering in [0, 0.49]. Defaults to 0.02. */
    readonly lowPercentile?: number;
    /** Bright-tail percentile retained by metering in [0.51, 1]. Defaults to 0.98. */
    readonly highPercentile?: number;
    /** Minimum automatically selected EV in [-15, 15]. Defaults to -8. */
    readonly minimumEV?: number;
    /** Maximum automatically selected EV in [-15, 15]. Defaults to 8. */
    readonly maximumEV?: number;
    /** Exposure compensation in EV stops. Defaults to 0. */
    readonly compensation?: number;
    /** Middle-gray target luminance in [0.01, 0.5]. Defaults to 0.18. */
    readonly keyValue?: number;
    /** Adaptation speed when exposure increases, in inverse seconds. Defaults to 1.5. */
    readonly speedUp?: number;
    /** Adaptation speed when exposure decreases, in inverse seconds. Defaults to 3. */
    readonly speedDown?: number;
    /** Histogram sampling stride in pixels. Defaults to 2. */
    readonly sampleStride?: number;
    /** Metering pattern. Defaults to center-weighted. */
    readonly metering?: AutoExposureMeteringMode;
}

/** On-demand values written by the latest submitted exposure reduction. */
export interface AutoExposureDiagnostics {
    /** Adapted exposure in EV stops. */
    readonly actualEV: number;
    /** Histogram-derived target exposure in EV stops. */
    readonly targetEV: number;
    /** Percentile-clipped geometric mean luminance. */
    readonly averageLuminance: number;
    /** Weighted histogram sample count. */
    readonly sampleCount: number;
}

/** @internal Immutable validated auto-exposure configuration. */
export interface AutoExposureSettings {
    readonly minimumLogLuminance: number;
    readonly maximumLogLuminance: number;
    readonly lowPercentile: number;
    readonly highPercentile: number;
    readonly minimumEV: number;
    readonly maximumEV: number;
    readonly compensation: number;
    readonly keyValue: number;
    readonly speedUp: number;
    readonly speedDown: number;
    readonly sampleStride: number;
    readonly metering: AutoExposureMeteringMode;
}

function finiteRange(value: number, minimum: number, maximum: number, label: string): number {
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
        throw new RangeError(
            `${label} must be finite and between ${String(minimum)} and ${String(maximum)}`
        );
    }
    return value;
}

/** @internal Validate and freeze an auto-exposure configuration. */
export function snapshotAutoExposureOptions(
    options: Readonly<AutoExposureOptions>
): Readonly<AutoExposureSettings> {
    const minimumLogLuminance = finiteRange(
        options.minimumLogLuminance ?? -12,
        -32,
        31,
        'Auto exposure minimumLogLuminance'
    );
    const maximumLogLuminance = finiteRange(
        options.maximumLogLuminance ?? 16,
        -31,
        32,
        'Auto exposure maximumLogLuminance'
    );
    if (maximumLogLuminance <= minimumLogLuminance) {
        throw new RangeError(
            'Auto exposure maximumLogLuminance must be greater than minimumLogLuminance'
        );
    }
    const lowPercentile = finiteRange(
        options.lowPercentile ?? 0.02,
        0,
        0.49,
        'Auto exposure lowPercentile'
    );
    const highPercentile = finiteRange(
        options.highPercentile ?? 0.98,
        0.51,
        1,
        'Auto exposure highPercentile'
    );
    if (highPercentile <= lowPercentile) {
        throw new RangeError('Auto exposure highPercentile must exceed lowPercentile');
    }
    const minimumEV = finiteRange(options.minimumEV ?? -8, -15, 15, 'Auto exposure minimumEV');
    const maximumEV = finiteRange(options.maximumEV ?? 8, -15, 15, 'Auto exposure maximumEV');
    if (maximumEV < minimumEV) {
        throw new RangeError('Auto exposure maximumEV must be at least minimumEV');
    }
    const sampleStride = options.sampleStride ?? 2;
    if (!Number.isSafeInteger(sampleStride) || sampleStride < 1 || sampleStride > 16) {
        throw new RangeError('Auto exposure sampleStride must be an integer between 1 and 16');
    }
    const metering = options.metering ?? 'center-weighted';
    if (!new Set<string>(['average', 'center-weighted']).has(metering)) {
        throw new TypeError('Auto exposure metering must be average or center-weighted');
    }
    return Object.freeze({
        minimumLogLuminance,
        maximumLogLuminance,
        lowPercentile,
        highPercentile,
        minimumEV,
        maximumEV,
        compensation: finiteRange(options.compensation ?? 0, -16, 16, 'Auto exposure compensation'),
        keyValue: finiteRange(options.keyValue ?? 0.18, 0.01, 0.5, 'Auto exposure keyValue'),
        speedUp: finiteRange(options.speedUp ?? 1.5, 0, 32, 'Auto exposure speedUp'),
        speedDown: finiteRange(options.speedDown ?? 3, 0, 32, 'Auto exposure speedDown'),
        sampleStride,
        metering
    });
}

function computePass(shader: ComputeShader): ComputeRenderPass {
    return new ComputeRenderPass(new ComputeKernel({ label: shader.label, shader }), shader.label);
}

const HISTOGRAM_PASS = computePass(
    new ComputeShader({
        label: 'Auto exposure luminance histogram',
        source: `
struct ExposureParameters {
    luminanceRange: vec4<f32>,
    exposureRange: vec4<f32>,
    adaptation: vec4<f32>,
    sampling: vec4<u32>,
};
struct Histogram { bins: array<atomic<u32>, ${String(HISTOGRAM_BIN_COUNT)}>, };
@group(0) @binding(0) var<storage, read> parameters: ExposureParameters;
@group(0) @binding(1) var<storage, read_write> histogram: Histogram;
@group(0) @binding(2) var sceneColor: texture_2d<f32>;

@compute @workgroup_size(${String(HISTOGRAM_WORKGROUP_SIZE)}, ${String(HISTOGRAM_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let dimensions = textureDimensions(sceneColor);
    let stride = max(parameters.sampling.x, 1u);
    let pixel = vec2<u32>(id.xy) * stride + vec2<u32>(stride / 2u);
    if (any(pixel >= dimensions)) { return; }
    let radiance = max(textureLoad(sceneColor, vec2<i32>(pixel), 0).rgb, vec3<f32>(0.0));
    let luminance = max(dot(radiance, vec3<f32>(0.2126, 0.7152, 0.0722)), 0.000001);
    let normalized = clamp(
        (log2(luminance) - parameters.luminanceRange.x) /
            max(parameters.luminanceRange.y - parameters.luminanceRange.x, 0.0001),
        0.0,
        0.999999
    );
    var weight = 1u;
    if (parameters.sampling.y != 0u) {
        let uv = (vec2<f32>(pixel) + vec2<f32>(0.5)) / vec2<f32>(dimensions);
        let radius = length((uv - vec2<f32>(0.5)) * vec2<f32>(1.0, 0.8));
        weight = u32(round(mix(12.0, 1.0, smoothstep(0.05, 0.7, radius))));
    }
    atomicAdd(&histogram.bins[u32(normalized * ${String(HISTOGRAM_BIN_COUNT)}.0)], weight);
}`,
        workgroupSize: [HISTOGRAM_WORKGROUP_SIZE, HISTOGRAM_WORKGROUP_SIZE],
        bindings: [
            { name: 'parameters', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            {
                name: 'histogram',
                group: 0,
                binding: 1,
                kind: 'storage-buffer',
                access: 'read-write'
            },
            {
                name: 'sceneColor',
                group: 0,
                binding: 2,
                kind: 'sampled-texture',
                sampleType: 'float'
            }
        ]
    })
);

const REDUCTION_COMMON = `
struct ExposureParameters {
    luminanceRange: vec4<f32>,
    exposureRange: vec4<f32>,
    adaptation: vec4<f32>,
    sampling: vec4<u32>,
};
struct Histogram { bins: array<u32, ${String(HISTOGRAM_BIN_COUNT)}>, };
struct ExposureDiagnostics { values: vec4<f32>, };
@group(0) @binding(0) var<storage, read> parameters: ExposureParameters;
@group(0) @binding(1) var<storage, read> histogram: Histogram;
@group(0) @binding(2) var<storage, read_write> diagnostics: ExposureDiagnostics;

fn meteredExposure() -> vec3<f32> {
    var total = 0u;
    for (var bin = 0u; bin < ${String(HISTOGRAM_BIN_COUNT)}u; bin += 1u) {
        total += histogram.bins[bin];
    }
    if (total == 0u) { return vec3<f32>(0.0, 0.0, 0.0); }
    let lowCount = u32(floor(f32(total) * parameters.luminanceRange.z));
    let highCount = u32(ceil(f32(total) * parameters.luminanceRange.w));
    var cursor = 0u;
    var retained = 0u;
    var weightedLogLuminance = 0.0;
    for (var bin = 0u; bin < ${String(HISTOGRAM_BIN_COUNT)}u; bin += 1u) {
        let count = histogram.bins[bin];
        let start = cursor;
        let end = cursor + count;
        let clippedStart = max(start, lowCount);
        let clippedEnd = min(end, highCount);
        if (clippedEnd > clippedStart) {
            let accepted = clippedEnd - clippedStart;
            let binCenter = (f32(bin) + 0.5) / ${String(HISTOGRAM_BIN_COUNT)}.0;
            let logLuminance = mix(
                parameters.luminanceRange.x,
                parameters.luminanceRange.y,
                binCenter
            );
            weightedLogLuminance += logLuminance * f32(accepted);
            retained += accepted;
        }
        cursor = end;
    }
    let averageLogLuminance = weightedLogLuminance / max(f32(retained), 1.0);
    let targetEV = clamp(
        log2(parameters.exposureRange.w) - averageLogLuminance + parameters.exposureRange.z,
        parameters.exposureRange.x,
        parameters.exposureRange.y
    );
    return vec3<f32>(targetEV, exp2(averageLogLuminance), f32(total));
}`;

const EXPOSURE_INITIALIZE_PASS = computePass(
    new ComputeShader({
        label: 'Auto exposure initialize eye adaptation',
        source: `${REDUCTION_COMMON}
@group(0) @binding(3) var exposureOutput: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(1)
fn main() {
    let metered = meteredExposure();
    textureStore(exposureOutput, vec2<i32>(0), vec4<f32>(exp2(metered.x), 0.0, 0.0, 0.0));
    diagnostics.values = vec4<f32>(metered.x, metered.x, metered.y, metered.z);
}`,
        workgroupSize: [1],
        bindings: [
            { name: 'parameters', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            { name: 'histogram', group: 0, binding: 1, kind: 'read-only-storage-buffer' },
            {
                name: 'diagnostics',
                group: 0,
                binding: 2,
                kind: 'storage-buffer',
                access: 'write-discard'
            },
            {
                name: 'exposureOutput',
                group: 0,
                binding: 3,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'rgba16float'
            }
        ]
    })
);

const EXPOSURE_ADAPT_PASS = computePass(
    new ComputeShader({
        label: 'Auto exposure temporal eye adaptation',
        source: `${REDUCTION_COMMON}
@group(0) @binding(3) var exposureHistory: texture_2d<f32>;
@group(0) @binding(4) var exposureOutput: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(1)
fn main() {
    let metered = meteredExposure();
    let previousMultiplier = max(textureLoad(exposureHistory, vec2<i32>(0), 0).r, 0.000001);
    let previousEV = log2(previousMultiplier);
    let speed = select(parameters.adaptation.y, parameters.adaptation.x, metered.x > previousEV);
    let blend = 1.0 - exp(-speed * parameters.adaptation.z);
    let actualEV = mix(previousEV, metered.x, clamp(blend, 0.0, 1.0));
    textureStore(exposureOutput, vec2<i32>(0), vec4<f32>(exp2(actualEV), 0.0, 0.0, 0.0));
    diagnostics.values = vec4<f32>(actualEV, metered.x, metered.y, metered.z);
}`,
        workgroupSize: [1],
        bindings: [
            { name: 'parameters', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            { name: 'histogram', group: 0, binding: 1, kind: 'read-only-storage-buffer' },
            {
                name: 'diagnostics',
                group: 0,
                binding: 2,
                kind: 'storage-buffer',
                access: 'write-discard'
            },
            {
                name: 'exposureHistory',
                group: 0,
                binding: 3,
                kind: 'sampled-texture',
                sampleType: 'unfilterable-float'
            },
            {
                name: 'exposureOutput',
                group: 0,
                binding: 4,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'rgba16float'
            }
        ]
    })
);

class HistogramClearParameters {
    buffer = INVALID_BUFFER;
}

class HistogramClearPass implements ScriptableRenderPass<HistogramClearParameters> {
    readonly name = 'Auto exposure histogram clear';

    setup(builder: ScriptableRenderPassBuilder, parameters: HistogramClearParameters): void {
        builder.clearBuffer(parameters.buffer, 0, HISTOGRAM_BYTES);
    }

    execute(context: ScriptableRenderPassContext, parameters: HistogramClearParameters): void {
        context.commands.clearBuffer(parameters.buffer, 0, HISTOGRAM_BYTES);
    }
}

interface MutableBufferBinding {
    buffer: RenderGraphBufferHandle;
}

interface MutableTextureBinding {
    texture: RenderGraphTextureAccessHandle;
}

class MutableComputeParameters implements ComputeRenderPassParameters {
    readonly buffers: MutableBufferBinding[];
    readonly textures: MutableTextureBinding[];
    readonly dispatch: { x: number; y: number; z: number } = { x: 1, y: 1, z: 1 };

    constructor(bufferCount: number, textureCount: number) {
        this.buffers = Array.from({ length: bufferCount }, () => ({ buffer: INVALID_BUFFER }));
        this.textures = Array.from({ length: textureCount }, () => ({ texture: INVALID_TEXTURE }));
    }

    setBuffer(index: number, buffer: RenderGraphBufferHandle): void {
        const binding = this.buffers[index];
        if (binding === undefined) throw new RangeError('Auto exposure buffer slot is unavailable');
        binding.buffer = buffer;
    }

    setTexture(index: number, texture: RenderGraphTextureAccessHandle): void {
        const binding = this.textures[index];
        if (binding === undefined)
            throw new RangeError('Auto exposure texture slot is unavailable');
        binding.texture = texture;
    }

    setDispatch(x: number, y = 1): void {
        this.dispatch.x = x;
        this.dispatch.y = y;
        this.dispatch.z = 1;
    }
}

class MutableFullscreenParameters implements FullscreenRenderPassParameters {
    readonly inputTextures: RenderGraphTextureAccessHandle[] = [];
    readonly colorAttachments: RenderPipelineColorAttachment[] = [
        { texture: INVALID_TEXTURE, loadOp: 'clear', storeOp: 'store' }
    ];
}

const APPLY_EXPOSURE_PASS = new FullscreenRenderPass({
    name: 'Auto exposure linear HDR pre-exposure',
    shader: new Shader({
        vs: PORTABLE_FULLSCREEN_VERTEX_SOURCE,
        fs: `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_exposure;
layout(location=0) out vec4 color;
void main() {
    vec4 scene = texture(u_scene, v_uv);
    float exposure = texelFetch(u_exposure, ivec2(0), 0).r;
    color = vec4(scene.rgb * max(exposure, 0.0), scene.a);
}`
    }),
    pipelineState: {
        ...DEFAULT_MATERIAL_PIPELINE_STATE,
        depthTest: false,
        depthWrite: false,
        cullMode: 'none'
    }
});

/** @internal Renderer-local GPU histogram and eye-adaptation controller. */
export class AutoExposureController {
    readonly #settings: Readonly<AutoExposureSettings>;
    readonly #parameters: StorageBuffer;
    readonly #diagnostics: StorageBuffer;
    readonly #parameterBytes = new ArrayBuffer(EXPOSURE_PARAMETER_BYTES);
    readonly #parameterFloats = new Float32Array(this.#parameterBytes);
    readonly #parameterUInts = new Uint32Array(this.#parameterBytes);
    readonly #parameterView = new Uint8Array(this.#parameterBytes);
    readonly #historyKey = Object.freeze({});
    readonly #historyDescriptor: RenderPipelineHistoryTextureDescriptor = Object.freeze({
        label: 'Auto exposure eye-adaptation history',
        format: 'rgba16float',
        extent: Object.freeze({ width: 1, height: 1 }),
        usage: Object.freeze(['sampled' as const, 'storage' as const]),
        bufferCount: 2 as const
    });
    readonly #clearPass = new HistogramClearPass();
    readonly #clearPool = new RenderPassParameterPool(() => new HistogramClearParameters());
    readonly #histogramPool = new RenderPassParameterPool(() => new MutableComputeParameters(2, 1));
    readonly #initializePool = new RenderPassParameterPool(
        () => new MutableComputeParameters(3, 1)
    );
    readonly #adaptPool = new RenderPassParameterPool(() => new MutableComputeParameters(3, 2));
    #destroyed = false;
    #pendingFrame = -1;
    #pendingCamera: Camera | null = null;
    #pendingCameraRevision = -1;
    #pendingTimestamp = 0;
    #committedCamera: Camera | null = null;
    #committedCameraRevision = -1;
    #committedTimestamp = 0;

    constructor(settings: Readonly<AutoExposureSettings>, context: RenderPipelineCreateContext) {
        this.#settings = settings;
        this.#parameters = context.createStorageBuffer({
            label: 'Auto exposure parameters',
            byteLength: EXPOSURE_PARAMETER_BYTES,
            usage: ['storage', 'copy-destination'],
            recovery: 'cpu-shadow'
        });
        this.#diagnostics = context.createStorageBuffer({
            label: 'Auto exposure diagnostics',
            byteLength: EXPOSURE_DIAGNOSTIC_BYTES,
            usage: ['storage', 'copy-source'],
            recovery: 'reinitialize'
        });
    }

    record(
        context: RenderPipelineContext,
        sceneColor: RenderGraphTextureHandle,
        historyValid = true
    ): RenderGraphTextureHandle {
        if (this.#destroyed) throw new Error('Auto exposure controller is destroyed');
        const now = performance.now() * 0.001;
        const cameraRevision = getTransformHistoryRevision(context.camera);
        const cameraContinuous =
            this.#committedCamera === context.camera &&
            this.#committedCameraRevision === cameraRevision;
        if (!historyValid || !cameraContinuous) {
            context.graph.invalidateHistoryTexture(this.#historyKey);
        }
        const deltaTime =
            this.#committedTimestamp <= 0
                ? 1 / 60
                : Math.min(0.25, Math.max(1 / 1000, now - this.#committedTimestamp));
        this.packParameters(deltaTime);
        context.writeStorageBuffer(this.#parameters, 0, this.#parameterView);
        const parameters = context.graph.importStorageBuffer(this.#parameters);
        const diagnostics = context.graph.importStorageBuffer(this.#diagnostics);
        const histogram = context.graph.createBuffer('Auto exposure luminance histogram', {
            byteLength: HISTOGRAM_BYTES
        });
        const clear = context.acquirePassParameters(this.#clearPool);
        clear.buffer = histogram;
        context.graph.addPass(this.#clearPass, clear);

        const histogramParameters = context.acquirePassParameters(this.#histogramPool);
        histogramParameters.setBuffer(0, parameters);
        histogramParameters.setBuffer(1, histogram);
        histogramParameters.setTexture(0, sceneColor);
        const stride = this.#settings.sampleStride * HISTOGRAM_WORKGROUP_SIZE;
        histogramParameters.setDispatch(
            Math.max(1, Math.ceil(context.output.width / stride)),
            Math.max(1, Math.ceil(context.output.height / stride))
        );
        context.graph.addPass(HISTOGRAM_PASS, histogramParameters);

        const history = context.graph.acquireHistoryTexture(
            this.#historyKey,
            this.#historyDescriptor
        );
        if (history.valid && historyValid && cameraContinuous) {
            const adapt = context.acquirePassParameters(this.#adaptPool);
            adapt.setBuffer(0, parameters);
            adapt.setBuffer(1, histogram);
            adapt.setBuffer(2, diagnostics);
            adapt.setTexture(0, history.history());
            adapt.setTexture(1, history.current);
            context.graph.addPass(EXPOSURE_ADAPT_PASS, adapt);
        } else {
            const initialize = context.acquirePassParameters(this.#initializePool);
            initialize.setBuffer(0, parameters);
            initialize.setBuffer(1, histogram);
            initialize.setBuffer(2, diagnostics);
            initialize.setTexture(0, history.current);
            context.graph.addPass(EXPOSURE_INITIALIZE_PASS, initialize);
        }
        this.#pendingFrame = context.frameIndex;
        this.#pendingCamera = context.camera;
        this.#pendingCameraRevision = cameraRevision;
        this.#pendingTimestamp = now;
        return history.current;
    }

    frameSubmitted(frameIndex: number): void {
        if (frameIndex !== this.#pendingFrame) return;
        this.#committedCamera = this.#pendingCamera;
        this.#committedCameraRevision = this.#pendingCameraRevision;
        this.#committedTimestamp = this.#pendingTimestamp;
        this.#pendingFrame = -1;
        this.#pendingCamera = null;
    }

    frameDiscarded(frameIndex: number): void {
        if (frameIndex !== this.#pendingFrame) return;
        this.#pendingFrame = -1;
        this.#pendingCamera = null;
    }

    async readDiagnostics(): Promise<Readonly<AutoExposureDiagnostics>> {
        if (this.#destroyed) throw new Error('Auto exposure controller is destroyed');
        const result = await this.#diagnostics.read();
        const values = new Float32Array(
            result.data.buffer,
            result.data.byteOffset,
            result.data.byteLength / 4
        );
        return Object.freeze({
            actualEV: values[0] ?? 0,
            targetEV: values[1] ?? 0,
            averageLuminance: values[2] ?? 0,
            sampleCount: values[3] ?? 0
        });
    }

    destroy(): void {
        if (this.#destroyed) return;
        this.#destroyed = true;
        const failures: unknown[] = [];
        for (const buffer of [this.#parameters, this.#diagnostics]) {
            try {
                buffer.destroy();
            } catch (error) {
                failures.push(error);
            }
        }
        if (failures.length !== 0) {
            throw new AggregateError(failures, 'Auto exposure resource destruction failed');
        }
    }

    private packParameters(deltaTime: number): void {
        const settings = this.#settings;
        this.#parameterFloats[0] = settings.minimumLogLuminance;
        this.#parameterFloats[1] = settings.maximumLogLuminance;
        this.#parameterFloats[2] = settings.lowPercentile;
        this.#parameterFloats[3] = settings.highPercentile;
        this.#parameterFloats[4] = settings.minimumEV;
        this.#parameterFloats[5] = settings.maximumEV;
        this.#parameterFloats[6] = settings.compensation;
        this.#parameterFloats[7] = settings.keyValue;
        this.#parameterFloats[8] = settings.speedUp;
        this.#parameterFloats[9] = settings.speedDown;
        this.#parameterFloats[10] = deltaTime;
        this.#parameterFloats[11] = 0;
        this.#parameterUInts[12] = settings.sampleStride;
        this.#parameterUInts[13] = settings.metering === 'center-weighted' ? 1 : 0;
        this.#parameterUInts[14] = 0;
        this.#parameterUInts[15] = 0;
    }
}

class AutoExposureRuntime implements ForwardRenderPipelineFeatureRuntime {
    readonly #controller: AutoExposureController;
    readonly #onDestroy: (runtime: AutoExposureRuntime) => void;
    readonly #outputDescriptor: RenderPipelineTextureDescriptor = Object.freeze({
        format: 'rgba16float',
        extent: Object.freeze({ relativeTo: 'output', scale: 1 })
    });
    readonly #applyPool = new RenderPassParameterPool(() => new MutableFullscreenParameters());

    constructor(
        settings: Readonly<AutoExposureSettings>,
        context: RenderPipelineCreateContext,
        onDestroy: (runtime: AutoExposureRuntime) => void
    ) {
        this.#controller = new AutoExposureController(settings, context);
        this.#onDestroy = onDestroy;
    }

    record(context: ForwardRenderFeatureContext): void {
        const source = context.resources.color;
        if (source === null) throw new Error('Auto exposure requires scene color');
        if (context.resources.colorEncoding !== 'linear') {
            throw new Error('Auto exposure requires linear HDR scene color');
        }
        const exposure = this.#controller.record(context.pipeline, source);
        const output = context.pipeline.graph.createTexture(
            'Auto exposure pre-exposed HDR scene',
            this.#outputDescriptor
        );
        const apply = context.pipeline.acquirePassParameters(this.#applyPool);
        apply.inputTextures.length = 2;
        apply.inputTextures[0] = source;
        apply.inputTextures[1] = exposure;
        apply.colorAttachments[0] = {
            texture: output,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 1 }
        };
        context.pipeline.graph.addPass(APPLY_EXPOSURE_PASS, apply);
        context.resources.replaceColor(output, 'linear');
    }

    frameSubmitted(frameIndex: number): void {
        this.#controller.frameSubmitted(frameIndex);
    }

    frameDiscarded(frameIndex: number): void {
        this.#controller.frameDiscarded(frameIndex);
    }

    readDiagnostics(): Promise<Readonly<AutoExposureDiagnostics>> {
        return this.#controller.readDiagnostics();
    }

    destroy(): void {
        this.#controller.destroy();
        this.#onDestroy(this);
    }
}

/**
 * WebGPU histogram auto exposure with percentile clipping and submission-aware eye adaptation.
 *
 * The feature records after HDR post-processing and before the display transform, so Bloom and
 * authored emissive energy share one exposure. It performs no per-frame CPU readback.
 */
export class AutoExposure implements ForwardRenderPipelineFeature {
    readonly name = 'auto-exposure';
    readonly injectionPoint = 'after-post-process' as const;
    readonly requirements = Object.freeze({
        sampledSceneColor: true,
        sampledDepth: false,
        requiredCapabilities: Object.freeze([
            'storage-buffer' as const,
            'storage-texture' as const,
            'compute-pass' as const
        ]),
        requiredTextureFormats: Object.freeze([
            Object.freeze({ format: 'rgba16float' as const, use: 'filterable-sampled' as const }),
            Object.freeze({ format: 'rgba16float' as const, use: 'storage' as const }),
            Object.freeze({ format: 'rgba16float' as const, use: 'color-attachment' as const })
        ]),
        requiredLimits: Object.freeze({
            maxBindingsPerBindGroup: 5,
            maxStorageBuffersPerShaderStage: 3,
            maxStorageTexturesPerShaderStage: 1,
            maxSampledTexturesPerShaderStage: 1,
            maxComputeInvocationsPerWorkgroup: HISTOGRAM_WORKGROUP_SIZE * HISTOGRAM_WORKGROUP_SIZE
        })
    });
    readonly #settings: Readonly<AutoExposureSettings>;
    readonly #runtimes = new Set<AutoExposureRuntime>();

    constructor(options: Readonly<AutoExposureOptions> = {}) {
        this.#settings = snapshotAutoExposureOptions(options);
    }

    create(context: RenderPipelineCreateContext): ForwardRenderPipelineFeatureRuntime {
        const runtime = new AutoExposureRuntime(this.#settings, context, destroyed => {
            this.#runtimes.delete(destroyed);
        });
        this.#runtimes.add(runtime);
        return runtime;
    }

    /** Read the latest adapted values when attached to exactly one live renderer. */
    async readDiagnostics(): Promise<Readonly<AutoExposureDiagnostics>> {
        if (this.#runtimes.size !== 1) {
            throw new Error('AutoExposure.readDiagnostics() requires exactly one live runtime');
        }
        const runtime = this.#runtimes.values().next().value;
        if (!(runtime instanceof AutoExposureRuntime)) {
            throw new Error('Auto exposure runtime is unavailable');
        }
        return runtime.readDiagnostics();
    }
}
