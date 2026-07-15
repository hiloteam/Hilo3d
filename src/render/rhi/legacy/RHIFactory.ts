import type { RHI, RHIBackend } from '../RHI';
import { WebGLRHI, type WebGLRHICreateOptions } from '../webgl2/WebGLRHI';
import {
    WebGPURHI,
    type WebGPUAdapterProbeOptions,
    type WebGPURHICreateOptions
} from '../webgpu/WebGPURHI';

export interface LegacyRHICreateOptionsMap {
    readonly webgl2: WebGLRHICreateOptions;
    readonly webgpu: WebGPURHICreateOptions;
}

export interface LegacyRHIImplementationMap {
    readonly webgl2: WebGLRHI;
    readonly webgpu: WebGPURHI;
}

export interface LegacyWebGL2RHISupportOptions {
    readonly canvas: HTMLCanvasElement;
    readonly contextAttributes?: WebGLContextAttributes;
}

export interface LegacyRHISupportOptionsMap {
    readonly webgl2: LegacyWebGL2RHISupportOptions;
    readonly webgpu: WebGPUAdapterProbeOptions;
}

export type LegacyRHIForBackend<Backend extends RHIBackend> = LegacyRHIImplementationMap[Backend];
export type LegacyRHICreateOptionsForBackend<Backend extends RHIBackend> =
    LegacyRHICreateOptionsMap[Backend];
export type LegacyRHISupportOptionsForBackend<Backend extends RHIBackend> =
    LegacyRHISupportOptionsMap[Backend];

/** Migration-only construction path retained for renderer A/B comparison. */
export function constructLegacyRHI(backend: 'webgl2', options: WebGLRHICreateOptions): WebGLRHI;
/** Migration-only construction path retained for renderer A/B comparison. */
export function constructLegacyRHI(backend: 'webgpu', options: WebGPURHICreateOptions): WebGPURHI;
export function constructLegacyRHI(
    backend: string,
    options: WebGLRHICreateOptions | WebGPURHICreateOptions
): RHI {
    if (backend === 'webgl2') return new WebGLRHI(options);
    if (backend === 'webgpu') return new WebGPURHI(options);
    throw new TypeError(`Unsupported legacy RHI backend ${backend}`);
}

/** Migration-only construction path retained for renderer A/B comparison. */
export async function createLegacyRHI(
    backend: 'webgl2',
    options: WebGLRHICreateOptions
): Promise<WebGLRHI>;
/** Migration-only construction path retained for renderer A/B comparison. */
export async function createLegacyRHI(
    backend: 'webgpu',
    options: WebGPURHICreateOptions
): Promise<WebGPURHI>;
export async function createLegacyRHI(
    backend: RHIBackend,
    options: WebGLRHICreateOptions | WebGPURHICreateOptions
): Promise<RHI> {
    const rhi: RHI = backend === 'webgl2' ? new WebGLRHI(options) : new WebGPURHI(options);
    try {
        await rhi.ready;
        return rhi;
    } catch (error: unknown) {
        rhi.destroy();
        throw error;
    }
}

/** Migration-only support probe retained for renderer A/B comparison. */
export function isLegacyRHIBackendSupported(
    backend: 'webgl2',
    options: LegacyWebGL2RHISupportOptions
): Promise<boolean>;
/** Migration-only support probe retained for renderer A/B comparison. */
export function isLegacyRHIBackendSupported(
    backend: 'webgpu',
    options?: WebGPUAdapterProbeOptions
): Promise<boolean>;
export async function isLegacyRHIBackendSupported(
    backend: string,
    options: LegacyWebGL2RHISupportOptions | WebGPUAdapterProbeOptions = {}
): Promise<boolean> {
    if (backend === 'webgpu') {
        return WebGPURHI.isSupported(options as WebGPUAdapterProbeOptions);
    }
    if (backend !== 'webgl2') throw new TypeError(`Unsupported legacy RHI backend ${backend}`);
    const { canvas, contextAttributes } = options as LegacyWebGL2RHISupportOptions;
    try {
        return canvas.getContext('webgl2', contextAttributes) !== null;
    } catch {
        return false;
    }
}
