import {
    createWebGL2RHIDevice,
    isWebGL2RHIAvailable,
    type WebGL2RHIDevice
} from './backends/webgl2';
import { waitForWebGL2RHIContextRestored as waitForWebGL2BackendContextRestored } from './backends/webgl2/WebGL2Device';
import { createWebGPUDevice, isWebGPURHIAvailable, type WebGPUDevice } from './backends/webgpu';
import type { RHIFeatureName, RHILimits } from './core/RHICapabilities';
import type { RHIDevice, RHIGraphicsShaderArtifactInput } from './core/RHIResources';
import type { RHIBackend, RHIPowerPreference } from './core/RHITypes';
import type { RHIDiagnosticsSink } from './RHIDiagnosticsSink';

/** WebGL context policy expressed without exposing a native context or handle. */
export interface RHIWebGL2ContextOptions {
    readonly alpha?: boolean;
    readonly antialias?: boolean;
    readonly depth?: boolean;
    readonly desynchronized?: boolean;
    readonly failIfMajorPerformanceCaveat?: boolean;
    readonly powerPreference?: 'default' | RHIPowerPreference;
    readonly premultipliedAlpha?: boolean;
    readonly preserveDrawingBuffer?: boolean;
    readonly stencil?: boolean;
}

export interface WebGL2RHIDeviceCreateOptions {
    readonly canvas: HTMLCanvasElement;
    readonly context?: RHIWebGL2ContextOptions;
    readonly label?: string;
    /** @internal Allocation-free renderer diagnostics channel. */
    readonly diagnosticsSink?: RHIDiagnosticsSink;
}

/** Only features that WebGPU adapters expose as requestable native capabilities. */
export type RHIRequestableWebGPUFeature = Extract<
    RHIFeatureName,
    | 'texture-compression-bc'
    | 'texture-compression-etc2'
    | 'texture-compression-astc'
    | 'timestamp-query'
    | 'depth32float-stencil8'
    | 'float32-filterable'
    | 'float32-blendable'
>;

export interface WebGPURHIDeviceCreateOptions {
    readonly powerPreference?: RHIPowerPreference;
    readonly forceFallbackAdapter?: boolean;
    /** Reject an adapter reported as fallback instead of silently accepting a caveat. */
    readonly rejectFallbackAdapter?: boolean;
    readonly requiredFeatures?: readonly RHIRequestableWebGPUFeature[];
    /** Request supported accelerators without making them a device-creation requirement. */
    readonly optionalFeatures?: readonly RHIRequestableWebGPUFeature[];
    readonly requiredLimits?: Readonly<Partial<RHILimits>>;
    readonly label?: string;
    /** @internal Allocation-free renderer diagnostics channel. */
    readonly diagnosticsSink?: RHIDiagnosticsSink;
    /** @internal Required GLSL/Naga-prepared artifacts for the backend-owned mipmap utility. */
    readonly mipmapShaderArtifacts: Readonly<RHIGraphicsShaderArtifactInput>;
}

export type WebGPURHISupportOptions = Omit<
    WebGPURHIDeviceCreateOptions,
    'diagnosticsSink' | 'label' | 'mipmapShaderArtifacts'
>;

export interface RHIDeviceCreateOptionsMap {
    readonly webgl2: WebGL2RHIDeviceCreateOptions;
    readonly webgpu: WebGPURHIDeviceCreateOptions;
}

export interface RHIDeviceImplementationMap {
    readonly webgl2: WebGL2RHIDevice;
    readonly webgpu: WebGPUDevice;
}

export type RHIDeviceForBackend<Backend extends RHIBackend> = RHIDeviceImplementationMap[Backend];
export type RHIDeviceCreateOptionsForBackend<Backend extends RHIBackend> =
    RHIDeviceCreateOptionsMap[Backend];

function assertBackend(value: string): asserts value is RHIBackend {
    if (value !== 'webgl2' && value !== 'webgpu') {
        throw new TypeError(`Unsupported RHI backend ${value}`);
    }
}

function hasMipmapShaderArtifacts(value: unknown): value is WebGPURHIDeviceCreateOptions {
    return (
        typeof value === 'object' &&
        value !== null &&
        Reflect.get(value, 'mipmapShaderArtifacts') !== undefined
    );
}

function snapshotWebGPUOptions(
    options: WebGPURHIDeviceCreateOptions
): WebGPURHIDeviceCreateOptions {
    return Object.freeze({
        ...(options.powerPreference === undefined
            ? {}
            : { powerPreference: options.powerPreference }),
        ...(options.forceFallbackAdapter === undefined
            ? {}
            : { forceFallbackAdapter: options.forceFallbackAdapter }),
        ...(options.rejectFallbackAdapter === undefined
            ? {}
            : { rejectFallbackAdapter: options.rejectFallbackAdapter }),
        ...(options.requiredFeatures === undefined
            ? {}
            : { requiredFeatures: Object.freeze([...options.requiredFeatures]) }),
        ...(options.optionalFeatures === undefined
            ? {}
            : { optionalFeatures: Object.freeze([...options.optionalFeatures]) }),
        ...(options.requiredLimits === undefined
            ? {}
            : { requiredLimits: Object.freeze({ ...options.requiredLimits }) }),
        ...(options.label === undefined ? {} : { label: options.label }),
        ...(options.diagnosticsSink === undefined
            ? {}
            : { diagnosticsSink: options.diagnosticsSink }),
        mipmapShaderArtifacts: options.mipmapShaderArtifacts
    });
}

function snapshotWebGPUSupportOptions(options: WebGPURHISupportOptions): WebGPURHISupportOptions {
    return Object.freeze({
        ...(options.powerPreference === undefined
            ? {}
            : { powerPreference: options.powerPreference }),
        ...(options.forceFallbackAdapter === undefined
            ? {}
            : { forceFallbackAdapter: options.forceFallbackAdapter }),
        ...(options.rejectFallbackAdapter === undefined
            ? {}
            : { rejectFallbackAdapter: options.rejectFallbackAdapter }),
        ...(options.requiredFeatures === undefined
            ? {}
            : { requiredFeatures: Object.freeze([...options.requiredFeatures]) }),
        ...(options.optionalFeatures === undefined
            ? {}
            : { optionalFeatures: Object.freeze([...options.optionalFeatures]) }),
        ...(options.requiredLimits === undefined
            ? {}
            : { requiredLimits: Object.freeze({ ...options.requiredLimits }) })
    });
}

/** Synchronous construction exists only for WebGL2; WebGPU adapter/device selection is async. */
export function constructRHIDevice(
    backend: 'webgl2',
    options: WebGL2RHIDeviceCreateOptions
): WebGL2RHIDevice;
export function constructRHIDevice(
    backend: string,
    options: WebGL2RHIDeviceCreateOptions
): WebGL2RHIDevice {
    assertBackend(backend);
    if (backend !== 'webgl2') {
        throw new TypeError('WebGPU RHI construction is asynchronous; use createRHIDevice()');
    }
    const context = { ...(options.context ?? {}) };
    return createWebGL2RHIDevice(options.canvas, {
        ...context,
        ...(options.label === undefined ? {} : { label: options.label }),
        ...(options.diagnosticsSink === undefined
            ? {}
            : { diagnosticsSink: options.diagnosticsSink })
    });
}

/** Create one concrete RHI device. Surface creation remains a separate explicit operation. */
export async function createRHIDevice(
    backend: 'webgl2',
    options: WebGL2RHIDeviceCreateOptions
): Promise<WebGL2RHIDevice>;
export async function createRHIDevice(
    backend: 'webgpu',
    options: WebGPURHIDeviceCreateOptions
): Promise<WebGPUDevice>;
export async function createRHIDevice(
    backend: string,
    options?: WebGL2RHIDeviceCreateOptions | WebGPURHIDeviceCreateOptions
): Promise<RHIDevice> {
    assertBackend(backend);
    if (backend === 'webgl2') {
        if (options === undefined || !('canvas' in options)) {
            throw new TypeError('WebGL2 RHI device creation requires a canvas');
        }
        return constructRHIDevice('webgl2', options);
    }
    if (!hasMipmapShaderArtifacts(options)) {
        throw new TypeError(
            'WebGPU RHI device creation requires GLSL/Naga-prepared mipmap shader artifacts'
        );
    }
    const snapshot = snapshotWebGPUOptions(options);
    return createWebGPUDevice(snapshot);
}

/** Probe support without requesting a WebGPU device or creating any GPU resource. */
export function isRHIBackendSupported(
    backend: 'webgl2',
    options: WebGL2RHIDeviceCreateOptions
): Promise<boolean>;
export function isRHIBackendSupported(
    backend: 'webgpu',
    options?: WebGPURHISupportOptions
): Promise<boolean>;
export async function isRHIBackendSupported(
    backend: string,
    options: WebGL2RHIDeviceCreateOptions | WebGPURHISupportOptions = {}
): Promise<boolean> {
    assertBackend(backend);
    if (backend === 'webgl2') {
        if (!('canvas' in options)) return false;
        return isWebGL2RHIAvailable(options.canvas, { ...(options.context ?? {}) });
    }
    if ('canvas' in options) return false;
    const snapshot = snapshotWebGPUSupportOptions(options);
    return isWebGPURHIAvailable(snapshot);
}

/** Wait for a lost WebGL2 canvas context without exposing the native context to renderer code. */
export function waitForWebGL2RHIContextRestored(
    canvas: HTMLCanvasElement,
    options: RHIWebGL2ContextOptions = {}
): Promise<void> {
    return waitForWebGL2BackendContextRestored(canvas, { ...options });
}
