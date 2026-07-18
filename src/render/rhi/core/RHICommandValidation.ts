import type { RHIBuffer, RHIDevice } from './RHIResources';
import { RHIBufferUsage } from './RHITypes';
import {
    RHIValidationError,
    assertRHIObjectOwnedBy,
    type RHIValidationErrorCode
} from './RHIValidation';

function fail(code: RHIValidationErrorCode, message: string, path: string): never {
    throw new RHIValidationError(code, message, path);
}

function nonNegativeInteger(value: number, path: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        fail('invalid-descriptor', 'must be a non-negative safe integer', path);
    }
}

function positiveInteger(value: number, path: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        fail('invalid-descriptor', 'must be a positive safe integer', path);
    }
}

function validateRHIDispatchDimension(value: number, maximum: number, path: string): void {
    positiveInteger(value, path);
    if (value > maximum) {
        fail('out-of-bounds', 'workgroup count exceeds the device limit', path);
    }
}

function assertRHIUnmappedBuffer(buffer: RHIBuffer, path: string): void {
    if (buffer.mapState !== 'unmapped') {
        fail('invalid-state', `buffer is ${buffer.mapState}`, path);
    }
}

/** Validate and return the resolved byte size for an allocation-free clear-buffer command. */
export function validateRHIClearBuffer(
    device: RHIDevice,
    buffer: RHIBuffer,
    offset = 0,
    size = buffer.size - offset
): number {
    assertRHIObjectOwnedBy(device, buffer, 'clearBuffer.buffer');
    if ((buffer.usage & RHIBufferUsage.COPY_DST) === 0) {
        fail('invalid-descriptor', 'buffer lacks COPY_DST usage', 'clearBuffer.buffer.usage');
    }
    assertRHIUnmappedBuffer(buffer, 'clearBuffer.buffer');
    nonNegativeInteger(offset, 'clearBuffer.offset');
    positiveInteger(size, 'clearBuffer.size');
    if (offset % 4 !== 0) {
        fail('invalid-descriptor', 'must be 4-byte aligned', 'clearBuffer.offset');
    }
    if (size % 4 !== 0) {
        fail('invalid-descriptor', 'must be 4-byte aligned', 'clearBuffer.size');
    }
    if (offset + size > buffer.size) {
        fail('out-of-bounds', 'range exceeds the buffer', 'clearBuffer');
    }
    return size;
}

/** Validate one direct compute dispatch against the device's per-dimension limit. */
export function validateRHIDispatchWorkgroups(device: RHIDevice, x: number, y = 1, z = 1): void {
    if (!device.capabilities.features.has('compute-pipelines')) {
        fail('unsupported-feature', 'compute dispatch is unsupported', 'dispatchWorkgroups');
    }
    const maximum = device.capabilities.limits.maxComputeWorkgroupsPerDimension;
    if (maximum === undefined) {
        fail(
            'unsupported-feature',
            'compute dispatch limit is unavailable',
            'device.capabilities.limits.maxComputeWorkgroupsPerDimension'
        );
    }
    validateRHIDispatchDimension(x, maximum, 'dispatchWorkgroups.x');
    validateRHIDispatchDimension(y, maximum, 'dispatchWorkgroups.y');
    validateRHIDispatchDimension(z, maximum, 'dispatchWorkgroups.z');
}

function validateRHIIndirectBuffer(
    device: RHIDevice,
    buffer: RHIBuffer,
    offset: number,
    commandSize: number,
    path: string,
    bufferPath: string,
    usagePath: string,
    offsetPath: string
): void {
    if (!device.capabilities.features.has('indirect-draw')) {
        fail('unsupported-feature', 'indirect commands are unsupported', path);
    }
    assertRHIObjectOwnedBy(device, buffer, bufferPath);
    if ((buffer.usage & RHIBufferUsage.INDIRECT) === 0) {
        fail('invalid-descriptor', 'buffer lacks INDIRECT usage', usagePath);
    }
    assertRHIUnmappedBuffer(buffer, bufferPath);
    nonNegativeInteger(offset, offsetPath);
    if (offset % 4 !== 0) {
        fail('invalid-descriptor', 'must be 4-byte aligned', offsetPath);
    }
    if (offset + commandSize > buffer.size) {
        fail('out-of-bounds', 'command exceeds the buffer', path);
    }
}

export function validateRHIDispatchWorkgroupsIndirect(
    device: RHIDevice,
    buffer: RHIBuffer,
    offset = 0
): void {
    if (!device.capabilities.features.has('compute-pipelines')) {
        fail(
            'unsupported-feature',
            'indirect compute dispatch is unsupported',
            'dispatchWorkgroupsIndirect'
        );
    }
    validateRHIIndirectBuffer(
        device,
        buffer,
        offset,
        12,
        'dispatchWorkgroupsIndirect',
        'dispatchWorkgroupsIndirect.buffer',
        'dispatchWorkgroupsIndirect.buffer.usage',
        'dispatchWorkgroupsIndirect.offset'
    );
}

export function validateRHIDrawIndirect(
    device: RHIDevice,
    buffer: RHIBuffer,
    offset = 0,
    indexed = false
): void {
    if (indexed) {
        validateRHIIndirectBuffer(
            device,
            buffer,
            offset,
            20,
            'drawIndexedIndirect',
            'drawIndexedIndirect.buffer',
            'drawIndexedIndirect.buffer.usage',
            'drawIndexedIndirect.offset'
        );
        return;
    }
    validateRHIIndirectBuffer(
        device,
        buffer,
        offset,
        16,
        'drawIndirect',
        'drawIndirect.buffer',
        'drawIndirect.buffer.usage',
        'drawIndirect.offset'
    );
}
