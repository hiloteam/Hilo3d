import type { RHI, RHIBackend } from './RHI';
import { WebGLRHI, type WebGLRHICreateOptions } from './webgl2/WebGLRHI';
import {
    WebGPURHI,
    type WebGPUAdapterProbeOptions,
    type WebGPURHICreateOptions
} from './webgpu/WebGPURHI';

export interface RHICreateOptionsMap {
    readonly webgl2: WebGLRHICreateOptions;
    readonly webgpu: WebGPURHICreateOptions;
}

export interface RHIImplementationMap {
    readonly webgl2: WebGLRHI;
    readonly webgpu: WebGPURHI;
}

export interface WebGL2RHISupportOptions {
    readonly canvas: HTMLCanvasElement;
    readonly contextAttributes?: WebGLContextAttributes;
}

export interface RHISupportOptionsMap {
    readonly webgl2: WebGL2RHISupportOptions;
    readonly webgpu: WebGPUAdapterProbeOptions;
}

export type RHIForBackend<Backend extends RHIBackend> = RHIImplementationMap[Backend];
export type RHICreateOptionsForBackend<Backend extends RHIBackend> = RHICreateOptionsMap[Backend];
export type RHISupportOptionsForBackend<Backend extends RHIBackend> = RHISupportOptionsMap[Backend];

/**
 * Construct one concrete RHI without introducing a runtime facade.
 *
 * WebGL2 is ready synchronously; WebGPU starts asynchronous initialization and exposes it through
 * `ready`. Call `createRHI` when the caller needs an already-ready device.
 */
export function constructRHI(backend: 'webgl2', options: WebGLRHICreateOptions): WebGLRHI;
export function constructRHI(backend: 'webgpu', options: WebGPURHICreateOptions): WebGPURHI;
export function constructRHI(
    backend: string,
    options: WebGLRHICreateOptions | WebGPURHICreateOptions
): RHI {
    if (backend === 'webgl2') {
        return new WebGLRHI(options);
    }
    if (backend === 'webgpu') {
        return new WebGPURHI(options);
    }
    throw new TypeError(`Unsupported RHI backend ${backend}`);
}

/** Construct one concrete RHI and wait until its device and surface are ready. */
export async function createRHI(
    backend: 'webgl2',
    options: WebGLRHICreateOptions
): Promise<WebGLRHI>;
export async function createRHI(
    backend: 'webgpu',
    options: WebGPURHICreateOptions
): Promise<WebGPURHI>;
export async function createRHI(
    backend: RHIBackend,
    options: WebGLRHICreateOptions | WebGPURHICreateOptions
): Promise<RHI> {
    const rhi =
        backend === 'webgl2' ? constructRHI('webgl2', options) : constructRHI('webgpu', options);
    try {
        await rhi.ready;
        return rhi;
    } catch (error: unknown) {
        rhi.destroy();
        throw error;
    }
}

/** Probe backend availability without creating a renderer or GPU resource. */
export function isRHIBackendSupported(
    backend: 'webgl2',
    options: WebGL2RHISupportOptions
): Promise<boolean>;
export function isRHIBackendSupported(
    backend: 'webgpu',
    options?: WebGPUAdapterProbeOptions
): Promise<boolean>;
export async function isRHIBackendSupported(
    backend: string,
    options: WebGL2RHISupportOptions | WebGPUAdapterProbeOptions = {}
): Promise<boolean> {
    if (backend === 'webgpu') {
        return WebGPURHI.isSupported(options as WebGPUAdapterProbeOptions);
    }
    if (backend !== 'webgl2') throw new TypeError(`Unsupported RHI backend ${backend}`);
    const { canvas, contextAttributes } = options as WebGL2RHISupportOptions;
    try {
        return canvas.getContext('webgl2', contextAttributes) !== null;
    } catch {
        return false;
    }
}
