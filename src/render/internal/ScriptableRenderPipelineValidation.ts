import { RHIBufferUsage } from '../rhi/core';
import type {
    RenderGraphBufferReadUse,
    RenderGraphBufferWriteUse
} from '../pipeline/ScriptableRenderGraph';
import type { RendererViewport } from '../RendererCore';
import type { BufferRecord } from './ScriptableRenderPipelineTypes';

export function requireRuntimeArray(value: unknown, path: string): void {
    if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
}

function isPromiseLike(value: unknown): boolean {
    return (
        ((typeof value === 'object' && value !== null) || typeof value === 'function') &&
        typeof Reflect.get(value, 'then') === 'function'
    );
}

export function assertSynchronousResult(label: string, result: unknown): void {
    if (isPromiseLike(result)) throw new TypeError(`${label} must be synchronous`);
}

export function positiveInteger(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new RangeError(`${name} must be a positive safe integer`);
    }
    return value;
}

export function finiteViewport(viewport: RendererViewport, name: string): void {
    const values: readonly unknown[] = viewport;
    const width: unknown = values[2];
    const height: unknown = values[3];
    if (
        values.length !== 4 ||
        !values.every(value => typeof value === 'number' && Number.isFinite(value)) ||
        typeof width !== 'number' ||
        width <= 0 ||
        typeof height !== 'number' ||
        height <= 0
    ) {
        throw new RangeError(`${name} must contain finite x/y and positive width/height values`);
    }
}

export function normalizeBufferRange(
    buffer: BufferRecord,
    byteOffset = 0,
    byteLength = buffer.byteLength - byteOffset,
    operation: string
): Readonly<{ byteOffset: number; byteLength: number }> {
    if (
        !Number.isSafeInteger(byteOffset) ||
        !Number.isSafeInteger(byteLength) ||
        byteOffset < 0 ||
        byteLength < 1 ||
        byteOffset + byteLength > buffer.byteLength
    ) {
        throw new RangeError(
            `${operation} byte range [${String(byteOffset)}, ${String(byteOffset + byteLength)}) is invalid`
        );
    }
    if (byteOffset % 4 !== 0 || byteLength % 4 !== 0) {
        throw new RangeError(`${operation} byte offset and length must be 4-byte aligned`);
    }
    return { byteOffset, byteLength };
}

export function graphBufferUsage(
    use: RenderGraphBufferReadUse | RenderGraphBufferWriteUse
): number {
    switch (use) {
        case 'storage':
            return RHIBufferUsage.STORAGE;
        case 'vertex':
            return RHIBufferUsage.VERTEX;
        case 'index':
            return RHIBufferUsage.INDEX;
        case 'copy-source':
            return RHIBufferUsage.COPY_SRC;
        case 'indirect':
            return RHIBufferUsage.INDIRECT;
        case 'copy-destination':
            return RHIBufferUsage.COPY_DST;
        default:
            throw new TypeError(`Unsupported render graph buffer use ${String(use)}`);
    }
}
