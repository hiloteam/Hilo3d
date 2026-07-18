import type RendererCore from '../RendererCore';
import type { RendererBackend } from '../RendererCore';
import SharedRendererDriver from './SharedRendererDriver';
import type {
    RendererCreateOptions,
    RendererExplicitOptions,
    RendererFeatureName,
    RendererSupportOptions,
    RendererWebGL2Options
} from '../RendererOptions';
import {
    isRHIBackendSupported,
    type RHIRequestableWebGPUFeature,
    type RHIWebGL2ContextOptions
} from '../rhi/RHIFactory';
import { defaultForwardRenderPipelineFactory } from '../pipeline/ForwardRenderPipeline';
import { snapshotRenderPipelineFactory } from '../pipeline/RenderPipelineFactory';
import {
    describeWebGL2OnlyRendererOption,
    describeWebGPUOnlyPipelineRequirement,
    describeWebGPUOnlyRendererFeature
} from './RenderPipelineBackendSelection';

const REQUESTABLE_WEBGPU_FEATURES: ReadonlySet<string> = new Set([
    'texture-compression-bc',
    'texture-compression-etc2',
    'texture-compression-astc',
    'timestamp-query',
    'shader-f16',
    'depth32float-stencil8',
    'float32-filterable',
    'float32-blendable'
]);

function assertBackend(value: unknown): asserts value is RendererBackend {
    if (value !== 'webgl2' && value !== 'webgpu') {
        throw new TypeError(`Unsupported Renderer backend ${String(value)}`);
    }
}

function driverOptions<Options extends { readonly backend?: unknown }>(
    options: Options
): Omit<Options, 'backend'> {
    const { backend, ...rest } = options;
    void backend;
    return rest;
}

/** @internal Construct exactly one backend driver; no per-call proxy is introduced. */
export function constructRenderer(options: RendererExplicitOptions = {}): RendererCore {
    const backend: unknown = options.backend ?? 'webgl2';
    assertBackend(backend);
    return new SharedRendererDriver(backend, driverOptions(options));
}

function webGL2SupportCanvas(options: RendererWebGL2Options): HTMLCanvasElement | null {
    if (options.domElement) return options.domElement;
    return typeof document === 'undefined' ? null : document.createElement('canvas');
}

function autoWebGPUSupportOptions(options: RendererCreateOptions): RendererSupportOptions {
    const powerPreference = options.powerPreference;
    const requiredFeatures = 'requiredFeatures' in options ? options.requiredFeatures : undefined;
    const requiredLimits = 'requiredLimits' in options ? options.requiredLimits : undefined;
    const forceFallbackAdapter =
        'forceFallbackAdapter' in options ? options.forceFallbackAdapter : undefined;
    return {
        ...(powerPreference === 'low-power' || powerPreference === 'high-performance'
            ? { powerPreference }
            : {}),
        ...(forceFallbackAdapter === undefined ? {} : { forceFallbackAdapter }),
        ...(options.failIfMajorPerformanceCaveat === undefined
            ? {}
            : { failIfMajorPerformanceCaveat: options.failIfMajorPerformanceCaveat }),
        ...(requiredFeatures === undefined ? {} : { requiredFeatures }),
        ...(requiredLimits === undefined ? {} : { requiredLimits })
    };
}

function portableRequiredFeatures(
    features: readonly RendererFeatureName[] | undefined
): readonly RHIRequestableWebGPUFeature[] | null {
    if (features === undefined) return [];
    const result = new Array<RHIRequestableWebGPUFeature>(features.length);
    for (let index = 0; index < features.length; index += 1) {
        const feature = features[index];
        if (feature === undefined || !REQUESTABLE_WEBGPU_FEATURES.has(feature)) return null;
        result[index] = feature;
    }
    return result;
}

/** Probe backend support without constructing the public Renderer facade. */
export async function isRendererBackendSupported(
    backend: 'webgl2',
    options?: RendererWebGL2Options
): Promise<boolean>;
export async function isRendererBackendSupported(
    backend: 'webgpu',
    options?: RendererSupportOptions
): Promise<boolean>;
export async function isRendererBackendSupported(
    backend: RendererBackend,
    options: RendererWebGL2Options | RendererSupportOptions = {}
): Promise<boolean> {
    assertBackend(backend);
    if (backend === 'webgpu') {
        const webGPUOptions = options as RendererSupportOptions;
        const requiredFeatures = portableRequiredFeatures(webGPUOptions.requiredFeatures);
        if (requiredFeatures === null) return false;
        return isRHIBackendSupported('webgpu', {
            ...(webGPUOptions.powerPreference === undefined
                ? {}
                : { powerPreference: webGPUOptions.powerPreference }),
            ...(webGPUOptions.forceFallbackAdapter === undefined
                ? {}
                : { forceFallbackAdapter: webGPUOptions.forceFallbackAdapter }),
            ...(webGPUOptions.failIfMajorPerformanceCaveat === undefined
                ? {}
                : { rejectFallbackAdapter: webGPUOptions.failIfMajorPerformanceCaveat }),
            requiredFeatures,
            ...(webGPUOptions.requiredLimits === undefined
                ? {}
                : { requiredLimits: webGPUOptions.requiredLimits })
        });
    }
    const webglOptions = options as RendererWebGL2Options;
    const canvas = webGL2SupportCanvas(webglOptions);
    if (!canvas) return false;
    try {
        const attributes: RHIWebGL2ContextOptions = {
            ...(webglOptions.alpha === undefined ? {} : { alpha: webglOptions.alpha }),
            ...(webglOptions.depth === undefined ? {} : { depth: webglOptions.depth }),
            ...(webglOptions.stencil === undefined ? {} : { stencil: webglOptions.stencil }),
            ...(webglOptions.antialias === undefined ? {} : { antialias: webglOptions.antialias }),
            ...(webglOptions.premultipliedAlpha === undefined
                ? {}
                : { premultipliedAlpha: webglOptions.premultipliedAlpha }),
            ...(webglOptions.preserveDrawingBuffer === undefined
                ? {}
                : { preserveDrawingBuffer: webglOptions.preserveDrawingBuffer }),
            ...(webglOptions.failIfMajorPerformanceCaveat === undefined
                ? {}
                : {
                      failIfMajorPerformanceCaveat: webglOptions.failIfMajorPerformanceCaveat
                  }),
            ...(webglOptions.powerPreference === undefined
                ? {}
                : { powerPreference: webglOptions.powerPreference })
        };
        return await isRHIBackendSupported('webgl2', {
            canvas,
            context: attributes
        });
    } catch {
        return false;
    }
}

async function resolveRendererBackendSnapshot(
    options: RendererCreateOptions
): Promise<RendererBackend> {
    const requested: unknown = options.backend ?? 'auto';
    if (requested !== 'auto') {
        if (requested !== 'webgl2' && requested !== 'webgpu') {
            throw new TypeError(`Unsupported Renderer backend ${String(requested)}`);
        }
    }
    const requiredFeatures = 'requiredFeatures' in options ? options.requiredFeatures : undefined;
    const webGPURequirement =
        describeWebGPUOnlyRendererFeature(requiredFeatures) ??
        describeWebGPUOnlyPipelineRequirement(options.renderPipeline?.requirements);
    const webGL2Option = describeWebGL2OnlyRendererOption(options);
    if (requested === 'webgl2') {
        if (webGPURequirement !== null) {
            throw new TypeError(
                `Renderer configuration conflict: ${webGPURequirement} requires WebGPU, but backend webgl2 was requested`
            );
        }
        return 'webgl2';
    }
    if (requested === 'webgpu') {
        if (webGL2Option !== null) {
            throw new TypeError(`Renderer ${webGL2Option}; backend webgpu was requested`);
        }
        return 'webgpu';
    }
    if (webGL2Option !== null) {
        if (webGPURequirement !== null) {
            throw new TypeError(
                `Renderer configuration conflict: ${webGPURequirement} requires WebGPU, but ${webGL2Option}`
            );
        }
        return 'webgl2';
    }
    if (await isRendererBackendSupported('webgpu', autoWebGPUSupportOptions(options))) {
        return 'webgpu';
    }
    if (webGPURequirement !== null) {
        throw new Error(
            `No compatible Renderer backend: ${webGPURequirement} requires WebGPU, but no compatible WebGPU adapter is available`
        );
    }
    return 'webgl2';
}

function snapshotCreateOptions(options: RendererCreateOptions): RendererCreateOptions {
    const renderPipeline = snapshotRenderPipelineFactory(
        options.renderPipeline ?? defaultForwardRenderPipelineFactory
    );
    const optionFeatures = 'requiredFeatures' in options ? options.requiredFeatures : undefined;
    const featureSet = new Set<RendererFeatureName>(optionFeatures ?? []);
    for (const feature of renderPipeline.requirements?.requiredFeatures ?? []) {
        featureSet.add(feature);
    }
    const requiredFeatures = [...featureSet];
    const optionLimits = 'requiredLimits' in options ? options.requiredLimits : undefined;
    const requiredLimits: Record<string, number> = { ...(optionLimits ?? {}) };
    for (const [name, value] of Object.entries(renderPipeline.requirements?.requiredLimits ?? {})) {
        requiredLimits[name] = Math.max(requiredLimits[name] ?? 0, value);
    }
    return {
        ...options,
        renderPipeline,
        ...(requiredFeatures.length === 0 ? {} : { requiredFeatures }),
        ...(Object.keys(requiredLimits).length === 0 ? {} : { requiredLimits })
    };
}

/** Resolve an explicit or WebGPU-first backend policy without creating a renderer. */
export function resolveRendererBackend(
    options: RendererCreateOptions = {}
): Promise<RendererBackend> {
    return resolveRendererBackendSnapshot(snapshotCreateOptions(options));
}

/** Resolve, construct and await one renderer backend. */
export async function createRenderer(options: RendererCreateOptions = {}): Promise<RendererCore> {
    const snapshot = snapshotCreateOptions(options);
    const backend = await resolveRendererBackendSnapshot(snapshot);
    const renderer = constructRenderer({
        ...snapshot,
        backend
    } as RendererExplicitOptions);
    try {
        await renderer.ready;
        return renderer;
    } catch (error: unknown) {
        let cleanupFailed = false;
        let cleanupFailure: unknown;
        try {
            renderer.destroy();
        } catch (cleanupError) {
            cleanupFailed = true;
            cleanupFailure = cleanupError;
        }
        if (cleanupFailed) {
            throw new AggregateError(
                [error, cleanupFailure],
                'Renderer initialization and cleanup both failed',
                { cause: error }
            );
        }
        throw error;
    }
}
