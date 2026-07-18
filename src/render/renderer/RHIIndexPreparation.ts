import type GeometryData from '../../geometry/GeometryData';
import { UNSIGNED_BYTE } from '../../constants/webgl';
import type { RHIIndexFormat } from '../rhi/core';
import { mapRHIIndexFormat } from './RHIDescriptorMapping';

/** Whether one engine index source needs a widened portable RHI representation. */
export function isUint8RHIIndexSource(indices: GeometryData): boolean {
    return indices.data instanceof Uint8Array || indices.data instanceof Uint8ClampedArray;
}

/**
 * Resolve the RHI format used after resource preparation. Uint8 has no WebGPU index format, so
 * both backends consume the same widened Uint16 representation.
 */
export function mapPortableRHIIndexFormat(indices: GeometryData): RHIIndexFormat {
    if (!isUint8RHIIndexSource(indices)) return mapRHIIndexFormat(indices);
    if (indices.size !== 1 || indices.stride !== 0 || indices.offset !== 0 || indices.normalized) {
        throw new TypeError(
            'RHI index data must be contiguous, non-normalized, and contain one component per index'
        );
    }
    if (indices.data.length === 0) {
        throw new RangeError('RHI index data must contain at least one index');
    }
    if (indices.type !== UNSIGNED_BYTE) {
        throw new TypeError('Uint8 index data must use the UNSIGNED_BYTE component type');
    }
    return 'uint16';
}
