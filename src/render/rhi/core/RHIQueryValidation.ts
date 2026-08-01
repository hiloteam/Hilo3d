import type { RHITimestampWrites } from './RHICommands';
import type { RHICapabilities } from './RHICapabilities';
import type {
    RHIBuffer,
    RHIDevice,
    RHINormalizedQuerySetDescriptor,
    RHIQuerySet,
    RHIQuerySetDescriptor
} from './RHIResources';
import { RHIBufferUsage } from './RHITypes';
import { RHIValidationError, assertRHIObjectOwnedBy } from './RHIValidation';

const MAX_QUERY_COUNT = 8192;

function nonNegativeInteger(value: number, path: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RHIValidationError(
            'invalid-descriptor',
            'must be a non-negative safe integer',
            path
        );
    }
}

function positiveInteger(value: number, path: string): void {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new RHIValidationError('invalid-descriptor', 'must be a positive safe integer', path);
    }
}

/** Normalize a timestamp query descriptor before any native query allocation. */
export function normalizeRHIQuerySetDescriptor(
    descriptor: Readonly<RHIQuerySetDescriptor>,
    capabilities: RHICapabilities
): Readonly<RHINormalizedQuerySetDescriptor> {
    if (!capabilities.features.has('timestamp-query')) {
        throw new RHIValidationError(
            'unsupported-feature',
            'timestamp queries require the timestamp-query feature',
            'querySet.type'
        );
    }
    positiveInteger(descriptor.count, 'querySet.count');
    if (descriptor.count > MAX_QUERY_COUNT) {
        throw new RHIValidationError(
            'out-of-bounds',
            `query count exceeds ${String(MAX_QUERY_COUNT)}`,
            'querySet.count'
        );
    }
    return Object.freeze({
        label: descriptor.label ?? '',
        lifetime: descriptor.lifetime ?? 'persistent',
        type: descriptor.type,
        count: descriptor.count
    });
}

/** Validate pass timestamp indices and ownership before beginning a native pass. */
export function validateRHITimestampWrites(
    device: RHIDevice,
    writes: Readonly<RHITimestampWrites> | undefined,
    path: string
): void {
    if (writes === undefined) return;
    if (!device.capabilities.features.has('timestamp-query')) {
        throw new RHIValidationError(
            'unsupported-feature',
            'timestamp writes require the timestamp-query feature',
            path
        );
    }
    const querySet = writes.querySet;
    assertRHIObjectOwnedBy(device, querySet, `${path}.querySet`);
    if (querySet.destroyed) {
        throw new RHIValidationError(
            'destroyed-object',
            'query set is destroyed',
            `${path}.querySet`
        );
    }
    const beginning = writes.beginningOfPassWriteIndex;
    const end = writes.endOfPassWriteIndex;
    if (beginning === undefined && end === undefined) {
        throw new RHIValidationError(
            'invalid-descriptor',
            'timestamp writes require a beginning or end index',
            path
        );
    }
    for (const [name, value] of [
        ['beginningOfPassWriteIndex', beginning],
        ['endOfPassWriteIndex', end]
    ] as const) {
        if (value === undefined) continue;
        nonNegativeInteger(value, `${path}.${name}`);
        if (value >= querySet.count) {
            throw new RHIValidationError(
                'out-of-bounds',
                'query index exceeds query set',
                `${path}.${name}`
            );
        }
    }
    if (beginning !== undefined && beginning === end) {
        throw new RHIValidationError(
            'invalid-descriptor',
            'beginning and end timestamp indices must differ',
            path
        );
    }
}

/** Validate one explicit query resolve command before native command emission. */
export function validateRHIResolveQuerySet(
    device: RHIDevice,
    querySet: RHIQuerySet,
    firstQuery: number,
    queryCount: number,
    destination: RHIBuffer,
    destinationOffset: number
): void {
    assertRHIObjectOwnedBy(device, querySet, 'resolveQuerySet.querySet');
    assertRHIObjectOwnedBy(device, destination, 'resolveQuerySet.destination');
    if (querySet.destroyed) {
        throw new RHIValidationError(
            'destroyed-object',
            'query set is destroyed',
            'resolveQuerySet.querySet'
        );
    }
    if (destination.destroyed) {
        throw new RHIValidationError(
            'destroyed-object',
            'destination buffer is destroyed',
            'resolveQuerySet.destination'
        );
    }
    nonNegativeInteger(firstQuery, 'resolveQuerySet.firstQuery');
    positiveInteger(queryCount, 'resolveQuerySet.queryCount');
    if (firstQuery > querySet.count || queryCount > querySet.count - firstQuery) {
        throw new RHIValidationError(
            'out-of-bounds',
            'query range exceeds query set',
            'resolveQuerySet'
        );
    }
    nonNegativeInteger(destinationOffset, 'resolveQuerySet.destinationOffset');
    if (destinationOffset % 256 !== 0) {
        throw new RHIValidationError(
            'invalid-descriptor',
            'destination offset must be 256-byte aligned',
            'resolveQuerySet.destinationOffset'
        );
    }
    if ((destination.usage & RHIBufferUsage.QUERY_RESOLVE) === 0) {
        throw new RHIValidationError(
            'invalid-descriptor',
            'destination buffer lacks QUERY_RESOLVE usage',
            'resolveQuerySet.destination.usage'
        );
    }
    const byteLength = queryCount * 8;
    if (destinationOffset > destination.size || byteLength > destination.size - destinationOffset) {
        throw new RHIValidationError(
            'out-of-bounds',
            'resolved query bytes exceed destination buffer',
            'resolveQuerySet.destination'
        );
    }
}

/** Debug labels are required to be non-empty so native captures remain actionable. */
export function validateRHIDebugLabel(label: string, path: string): void {
    if (typeof label !== 'string' || label.length === 0) {
        throw new RHIValidationError('invalid-descriptor', 'debug label must be non-empty', path);
    }
}
