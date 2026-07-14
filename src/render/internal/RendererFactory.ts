import type RendererCore from '../RendererCore';
import type { RendererBackend } from '../RendererCore';
import WebGL2Driver from './webgl2/WebGL2Driver';
import WebGPUDriver, { type WebGPUDriverOptions } from './webgpu/WebGPUDriver';
import type {
    RendererCreateOptions,
    RendererExplicitOptions,
    RendererSupportOptions,
    RendererWebGL2Options
} from '../RendererOptions';
import { isRHIBackendSupported } from '../rhi/RHIFactory';

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
    if (backend === 'webgpu') {
        if (Object.prototype.hasOwnProperty.call(options, 'preserveDrawingBuffer')) {
            throw new TypeError(
                'Renderer preserveDrawingBuffer is WebGL2-only; WebGPU requires an explicit copy/readback pass'
            );
        }
        return new WebGPUDriver(driverOptions(options) as WebGPUDriverOptions);
    }
    return new WebGL2Driver(driverOptions(options));
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
        return WebGPUDriver.isSupported(options as RendererSupportOptions);
    }
    const webglOptions = options as RendererWebGL2Options;
    const canvas = webGL2SupportCanvas(webglOptions);
    if (!canvas) return false;
    try {
        const attributes: WebGLContextAttributes = {
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
            contextAttributes: attributes
        });
    } catch {
        return false;
    }
}

/** Resolve an explicit or WebGPU-first backend policy without creating a renderer. */
export async function resolveRendererBackend(
    options: RendererCreateOptions = {}
): Promise<RendererBackend> {
    const requested: unknown = options.backend ?? 'auto';
    if (requested === 'webgl2' || requested === 'webgpu') return requested;
    if (requested !== 'auto') {
        throw new TypeError(`Unsupported Renderer backend ${String(requested)}`);
    }
    if (
        Object.prototype.hasOwnProperty.call(options, 'preserveDrawingBuffer') ||
        (options.alpha === true && options.premultipliedAlpha === false)
    ) {
        return 'webgl2';
    }
    return (await WebGPUDriver.isSupported(autoWebGPUSupportOptions(options)))
        ? 'webgpu'
        : 'webgl2';
}

function snapshotCreateOptions(options: RendererCreateOptions): RendererCreateOptions {
    const requiredFeatures = 'requiredFeatures' in options ? options.requiredFeatures : undefined;
    const requiredLimits = 'requiredLimits' in options ? options.requiredLimits : undefined;
    return {
        ...options,
        ...(requiredFeatures === undefined ? {} : { requiredFeatures: [...requiredFeatures] }),
        ...(requiredLimits === undefined ? {} : { requiredLimits: { ...requiredLimits } })
    };
}

/** Resolve, construct and await one renderer backend. */
export async function createRenderer(options: RendererCreateOptions = {}): Promise<RendererCore> {
    const snapshot = snapshotCreateOptions(options);
    const backend = await resolveRendererBackend(snapshot);
    const renderer = constructRenderer({
        ...snapshot,
        backend
    } as RendererExplicitOptions);
    try {
        await renderer.ready;
        return renderer;
    } catch (error: unknown) {
        renderer.destroy();
        throw error;
    }
}
