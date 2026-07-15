const START_MARKER_NAME = 'markRHIAllocationFrameStart';
const END_MARKER_NAME = 'markRHIAllocationFrameEnd';
const UINT32_MAX = 0xffff_ffff;
const ERROR_RESPONSE_MAX_BYTES = 64 * 1024;

export const RHI_STREAMING_HEAP_PROFILER_MAX_PROFILE_HEAD_BYTES = 64 * 1024 * 1024;

/**
 * A stopSampling reply is intentionally handled as bytes because V8 cannot materialize a string
 * larger than roughly 512 MiB. 1.5 GiB leaves room for the audited large profile while still
 * imposing a positive, finite localhost transport bound below the signed 31-bit framing ceiling.
 */
export const RHI_STREAMING_HEAP_PROFILER_MAX_PAYLOAD_BYTES = 1536 * 1024 * 1024;

export type RHIHeapProfilerSamplingMode = 'discard' | 'marked';

export interface RHIHeapProfilerStopResponseExpectation {
    readonly expectedId: number;
    readonly mode: RHIHeapProfilerSamplingMode;
    /** Required for flattened --remote-debugging-pipe target responses; omitted for a direct target. */
    readonly expectedSessionId?: string;
}

interface SamplingProfileNode {
    readonly callFrame?: unknown;
    readonly selfSize?: unknown;
    readonly id?: unknown;
    readonly children?: unknown;
}

interface CompactSamplingSample {
    readonly size: number;
    readonly nodeId: number;
    readonly ordinal: number;
}

interface ProfileHeadAnalysis {
    readonly nodeIds: ReadonlySet<number>;
    readonly startMarkerNodeIds: ReadonlySet<number>;
    readonly endMarkerNodeIds: ReadonlySet<number>;
}

interface SamplingArrayLocation {
    readonly start: number;
    readonly end: number;
    readonly count: number;
    readonly maximumOrdinal: number;
}

interface ParsedStopSuccess {
    readonly kind: 'success';
    readonly result: unknown;
}

interface ParsedStopError {
    readonly kind: 'error';
    readonly error: unknown;
}

type ParsedStopResponse = ParsedStopSuccess | ParsedStopError;

const JSON_KEYS = Object.freeze({
    id: Buffer.from('id', 'ascii'),
    method: Buffer.from('method', 'ascii'),
    result: Buffer.from('result', 'ascii'),
    error: Buffer.from('error', 'ascii'),
    profile: Buffer.from('profile', 'ascii'),
    head: Buffer.from('head', 'ascii'),
    samples: Buffer.from('samples', 'ascii'),
    size: Buffer.from('size', 'ascii'),
    nodeId: Buffer.from('nodeId', 'ascii'),
    ordinal: Buffer.from('ordinal', 'ascii'),
    sessionId: Buffer.from('sessionId', 'ascii')
});

function transportFailure(message: string): never {
    throw new Error(`RHI streaming heap-profiler transport failed: ${message}`);
}

function isWhitespace(byte: number): boolean {
    return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

class JsonByteCursor {
    readonly buffer: Buffer;
    offset: number;

    constructor(buffer: Buffer, offset = 0) {
        this.buffer = buffer;
        this.offset = offset;
    }

    skipWhitespace(): void {
        while (this.offset < this.buffer.length && isWhitespace(this.buffer[this.offset] ?? 0)) {
            this.offset += 1;
        }
    }

    expectByte(byte: number, context: string): void {
        this.skipWhitespace();
        if (this.buffer[this.offset] !== byte) transportFailure(context);
        this.offset += 1;
    }

    expectEnd(context: string): void {
        this.skipWhitespace();
        if (this.offset !== this.buffer.length) transportFailure(context);
    }

    readKnownKey<T extends string>(
        candidates: readonly (readonly [name: T, bytes: Buffer])[],
        context: string
    ): T {
        this.skipWhitespace();
        if (this.buffer[this.offset] !== 0x22) transportFailure(`${context} key is missing`);
        const start = ++this.offset;
        while (this.offset < this.buffer.length) {
            const byte = this.buffer[this.offset] ?? 0;
            if (byte === 0x5c) transportFailure(`${context} key must not be escaped`);
            if (byte === 0x22) break;
            if (byte < 0x20) transportFailure(`${context} key contains invalid JSON`);
            this.offset += 1;
        }
        if (this.offset >= this.buffer.length) transportFailure(`${context} key is truncated`);
        const end = this.offset;
        this.offset += 1;
        for (const [name, bytes] of candidates) {
            if (end - start === bytes.length && this.buffer.subarray(start, end).equals(bytes)) {
                this.expectByte(0x3a, `${context} key is missing its colon`);
                return name;
            }
        }
        transportFailure(`${context} key is unknown`);
    }

    expectKey(name: keyof typeof JSON_KEYS, context: string): void {
        const observed = this.readKnownKey([[name, JSON_KEYS[name]]], context);
        if (observed !== name) transportFailure(`${context} key differs from ${name}`);
    }

    readUnsignedInteger(context: string): number {
        this.skipWhitespace();
        const first = this.buffer[this.offset] ?? -1;
        if (first < 0x30 || first > 0x39) transportFailure(`${context} is missing`);
        let value = 0;
        if (first === 0x30) {
            this.offset += 1;
            const next = this.buffer[this.offset] ?? -1;
            if (next >= 0x30 && next <= 0x39) {
                transportFailure(`${context} contains a leading zero`);
            }
            return 0;
        }
        while (this.offset < this.buffer.length) {
            const byte = this.buffer[this.offset] ?? 0;
            if (byte < 0x30 || byte > 0x39) break;
            value = value * 10 + byte - 0x30;
            if (!Number.isSafeInteger(value)) transportFailure(`${context} is not a safe integer`);
            this.offset += 1;
        }
        return value;
    }

    expectString(expected: string, context: string): void {
        this.skipWhitespace();
        if (this.buffer[this.offset] !== 0x22) transportFailure(`${context} is not a string`);
        const start = ++this.offset;
        while (this.offset < this.buffer.length) {
            const byte = this.buffer[this.offset] ?? 0;
            if (byte === 0x5c) transportFailure(`${context} must not be escaped`);
            if (byte === 0x22) break;
            if (byte < 0x20) transportFailure(`${context} contains invalid JSON`);
            this.offset += 1;
        }
        if (this.offset >= this.buffer.length) transportFailure(`${context} is truncated`);
        const expectedBytes = Buffer.from(expected, 'utf8');
        const end = this.offset;
        this.offset += 1;
        if (
            end - start !== expectedBytes.length ||
            !this.buffer.subarray(start, end).equals(expectedBytes)
        ) {
            transportFailure(`${context} differs from its request`);
        }
    }

    readObjectSlice(context: string, maximumBytes: number): Buffer {
        this.skipWhitespace();
        const start = this.offset;
        if (this.buffer[start] !== 0x7b) transportFailure(`${context} is not an object`);
        let objectDepth = 0;
        let arrayDepth = 0;
        let inString = false;
        let escaped = false;
        for (let index = start; index < this.buffer.length; index += 1) {
            if (index - start >= maximumBytes) {
                transportFailure(`${context} exceeds its bounded parsing limit`);
            }
            const byte = this.buffer[index] ?? 0;
            if (inString) {
                if (escaped) escaped = false;
                else if (byte === 0x5c) escaped = true;
                else if (byte === 0x22) inString = false;
                else if (byte < 0x20) transportFailure(`${context} contains invalid JSON`);
                continue;
            }
            if (byte === 0x22) {
                inString = true;
                continue;
            }
            if (byte === 0x7b) objectDepth += 1;
            else if (byte === 0x7d) objectDepth -= 1;
            else if (byte === 0x5b) arrayDepth += 1;
            else if (byte === 0x5d) arrayDepth -= 1;
            if (objectDepth < 0 || arrayDepth < 0) {
                transportFailure(`${context} nesting is invalid`);
            }
            if (objectDepth === 0 && arrayDepth === 0) {
                this.offset = index + 1;
                return this.buffer.subarray(start, this.offset);
            }
        }
        transportFailure(`${context} is truncated`);
    }
}

export function isRHIHeapProfilerProfileHeadByteLengthWithinLimit(byteLength: number): boolean {
    return (
        Number.isSafeInteger(byteLength) &&
        byteLength >= 0 &&
        byteLength <= RHI_STREAMING_HEAP_PROFILER_MAX_PROFILE_HEAD_BYTES
    );
}

function simpleFunctionName(value: unknown): string {
    if (typeof value !== 'string') return '';
    const separator = Math.max(value.lastIndexOf('.'), value.lastIndexOf(' '));
    return value.slice(separator + 1);
}

function parseProfileHead(cursor: JsonByteCursor): SamplingProfileNode {
    const slice = cursor.readObjectSlice(
        'sampling profile head',
        RHI_STREAMING_HEAP_PROFILER_MAX_PROFILE_HEAD_BYTES
    );
    if (!isRHIHeapProfilerProfileHeadByteLengthWithinLimit(slice.length)) {
        transportFailure('sampling profile head exceeds its bounded parsing limit');
    }
    let value: unknown;
    try {
        // The profile head is bounded and comparatively small. The giant samples array is never
        // converted to a string anywhere in this module.
        value = JSON.parse(slice.toString('utf8')) as unknown;
    } catch {
        transportFailure('sampling profile head contains invalid JSON');
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        transportFailure('sampling profile head is malformed');
    }
    return value;
}

function analyzeProfileHead(
    head: SamplingProfileNode,
    mode: RHIHeapProfilerSamplingMode
): ProfileHeadAnalysis {
    const nodeIds = new Set<number>();
    const startMarkerNodeIds = new Set<number>();
    const endMarkerNodeIds = new Set<number>();
    const stack: {
        readonly node: SamplingProfileNode;
        readonly startStack: boolean;
        readonly endStack: boolean;
    }[] = [{ node: head, startStack: false, endStack: false }];
    while (stack.length > 0) {
        const entry = stack.pop();
        if (!entry) transportFailure('sampling profile traversal is inconsistent');
        const id = entry.node.id;
        if (!Number.isSafeInteger(id) || (id as number) < 1 || (id as number) > UINT32_MAX) {
            transportFailure('sampling profile node id is invalid');
        }
        const nodeId = id as number;
        if (nodeIds.has(nodeId)) transportFailure('sampling profile node id is duplicated');
        nodeIds.add(nodeId);
        if (!Number.isSafeInteger(entry.node.selfSize) || (entry.node.selfSize as number) < 0) {
            transportFailure('sampling profile node self size is invalid');
        }
        const callFrame = entry.node.callFrame;
        if (typeof callFrame !== 'object' || callFrame === null || Array.isArray(callFrame)) {
            transportFailure('sampling profile call frame is malformed');
        }
        const functionNameValue = (callFrame as Record<string, unknown>)['functionName'];
        if (typeof functionNameValue !== 'string') {
            transportFailure('sampling profile call frame function name is malformed');
        }
        const functionName = simpleFunctionName(functionNameValue);
        const nextStart = entry.startStack || functionName === START_MARKER_NAME;
        const nextEnd = entry.endStack || functionName === END_MARKER_NAME;
        if (nextStart && nextEnd) transportFailure('sampling profile marker stacks overlap');
        if (nextStart) startMarkerNodeIds.add(nodeId);
        if (nextEnd) endMarkerNodeIds.add(nodeId);
        if (!Array.isArray(entry.node.children)) {
            transportFailure('sampling profile node children are malformed');
        }
        const children: readonly unknown[] = entry.node.children;
        for (let index = children.length - 1; index >= 0; index -= 1) {
            const child = children[index];
            if (typeof child !== 'object' || child === null || Array.isArray(child)) {
                transportFailure('sampling profile child node is malformed');
            }
            stack.push({
                node: child,
                startStack: nextStart,
                endStack: nextEnd
            });
        }
    }
    const hasMarkers = startMarkerNodeIds.size > 0 || endMarkerNodeIds.size > 0;
    if (mode === 'marked' && (startMarkerNodeIds.size === 0 || endMarkerNodeIds.size === 0)) {
        transportFailure('marked sampling profile marker nodes are missing');
    }
    if (mode === 'discard' && hasMarkers) {
        transportFailure('discard sampling profile must not contain marker nodes');
    }
    return { nodeIds, startMarkerNodeIds, endMarkerNodeIds };
}

function parseSample(
    cursor: JsonByteCursor,
    callback: (size: number, nodeId: number, ordinal: number) => void
): void {
    cursor.expectByte(0x7b, 'sampling profile sample must start with an object');
    let fields = 0;
    let seen = 0;
    let size = 0;
    let nodeId = 0;
    let ordinal = 0;
    let complete = false;
    while (!complete) {
        cursor.skipWhitespace();
        if (cursor.buffer[cursor.offset] === 0x7d) {
            cursor.offset += 1;
            complete = true;
            continue;
        }
        if (fields > 0) {
            cursor.expectByte(0x2c, 'sampling profile sample fields require a comma');
            cursor.skipWhitespace();
            if (cursor.buffer[cursor.offset] === 0x7d) {
                transportFailure('sampling profile sample has a trailing comma');
            }
        }
        const key = cursor.readKnownKey(
            [
                ['size', JSON_KEYS.size],
                ['nodeId', JSON_KEYS.nodeId],
                ['ordinal', JSON_KEYS.ordinal]
            ] as const,
            'sampling profile sample'
        );
        const mask = key === 'size' ? 1 : key === 'nodeId' ? 2 : 4;
        if ((seen & mask) !== 0) transportFailure(`sampling profile sample ${key} is duplicated`);
        seen |= mask;
        const value = cursor.readUnsignedInteger(`sampling profile sample ${key}`);
        if (key === 'size') size = value;
        else if (key === 'nodeId') nodeId = value;
        else ordinal = value;
        fields += 1;
    }
    if (seen !== 7 || fields !== 3) transportFailure('sampling profile sample keys are incomplete');
    if (size < 1 || nodeId < 1 || nodeId > UINT32_MAX || ordinal < 1) {
        transportFailure('sampling profile sample contains an invalid integer');
    }
    callback(size, nodeId, ordinal);
}

function visitSamplingArray(
    cursor: JsonByteCursor,
    callback: (size: number, nodeId: number, ordinal: number) => void
): void {
    cursor.expectByte(0x5b, 'sampling profile samples are not an array');
    cursor.skipWhitespace();
    if (cursor.buffer[cursor.offset] === 0x5d) {
        cursor.offset += 1;
        return;
    }
    let count = 0;
    let complete = false;
    while (!complete) {
        if (count > 0) {
            cursor.expectByte(0x2c, 'sampling profile samples require a comma');
            cursor.skipWhitespace();
            if (cursor.buffer[cursor.offset] === 0x5d) {
                transportFailure('sampling profile samples have a trailing comma');
            }
        }
        parseSample(cursor, callback);
        count += 1;
        cursor.skipWhitespace();
        if (cursor.buffer[cursor.offset] === 0x5d) {
            cursor.offset += 1;
            complete = true;
        }
    }
}

function parseSuccessEnvelope(
    cursor: JsonByteCursor,
    mode: RHIHeapProfilerSamplingMode,
    expectedSessionId: string | undefined
): {
    readonly head: SamplingProfileNode;
    readonly analysis: ProfileHeadAnalysis;
    readonly samples: SamplingArrayLocation;
} {
    cursor.expectByte(0x7b, 'CDP stopSampling result is not an object');
    cursor.expectKey('profile', 'CDP stopSampling result');
    cursor.expectByte(0x7b, 'CDP stopSampling profile is not an object');
    cursor.expectKey('head', 'CDP stopSampling profile');
    const head = parseProfileHead(cursor);
    const analysis = analyzeProfileHead(head, mode);
    cursor.expectByte(0x2c, 'CDP stopSampling profile head requires a samples field');
    cursor.expectKey('samples', 'CDP stopSampling profile');
    const samplesStart = cursor.offset;
    let count = 0;
    let maximumOrdinal = 0;
    visitSamplingArray(cursor, (_size, nodeId, ordinal) => {
        if (!analysis.nodeIds.has(nodeId)) {
            transportFailure('sampling profile sample references an unknown node id');
        }
        count += 1;
        maximumOrdinal = Math.max(maximumOrdinal, ordinal);
    });
    const samplesEnd = cursor.offset;
    cursor.expectByte(0x7d, 'CDP stopSampling profile has unexpected fields');
    cursor.expectByte(0x7d, 'CDP stopSampling result has unexpected fields');
    if (expectedSessionId !== undefined) {
        cursor.expectByte(0x2c, 'CDP stopSampling response requires its flattened session id');
        cursor.expectKey('sessionId', 'CDP stopSampling response');
        cursor.expectString(expectedSessionId, 'CDP stopSampling response session id');
    }
    cursor.expectByte(0x7d, 'CDP stopSampling response has unexpected fields');
    cursor.expectEnd('CDP stopSampling response has trailing data');
    return {
        head,
        analysis,
        samples: { start: samplesStart, end: samplesEnd, count, maximumOrdinal }
    };
}

function visitLocatedSamples(
    buffer: Buffer,
    location: SamplingArrayLocation,
    callback: (size: number, nodeId: number, ordinal: number) => void
): void {
    const cursor = new JsonByteCursor(buffer, location.start);
    visitSamplingArray(cursor, callback);
    if (cursor.offset !== location.end) {
        transportFailure('sampling profile samples changed between validation passes');
    }
}

function chronologicalMarkedSamples(
    buffer: Buffer,
    location: SamplingArrayLocation,
    nodeIds: ReadonlySet<number>
): { readonly nodeIds: Uint32Array; readonly sizes: Float64Array } {
    // V8 emits samples out of array order. The audited marked protocol therefore requires the
    // ordinal set to be exactly dense 1..N before using ordinal-indexed typed arrays.
    if (location.count === 0 || location.maximumOrdinal > location.count) {
        transportFailure('marked sampling profile ordinals are not dense from one');
    }
    const chronologicalNodeIds = new Uint32Array(location.count + 1);
    const sizes = new Float64Array(location.count + 1);
    visitLocatedSamples(buffer, location, (size, nodeId, ordinal) => {
        if (!nodeIds.has(nodeId)) {
            transportFailure('sampling profile sample references an unknown node id');
        }
        if (ordinal > location.count) {
            transportFailure('marked sampling profile ordinals are not dense from one');
        }
        if (chronologicalNodeIds[ordinal] !== 0) {
            transportFailure('sampling profile sample ordinal is duplicated');
        }
        chronologicalNodeIds[ordinal] = nodeId;
        sizes[ordinal] = size;
    });
    for (let ordinal = 1; ordinal <= location.count; ordinal += 1) {
        if (chronologicalNodeIds[ordinal] === 0 || (sizes[ordinal] ?? 0) <= 0) {
            transportFailure('marked sampling profile ordinals are not dense from one');
        }
    }
    return { nodeIds: chronologicalNodeIds, sizes };
}

function ordinalHash(ordinal: number): number {
    const low = ordinal >>> 0;
    const high = Math.floor(ordinal / 0x1_0000_0000) >>> 0;
    return Math.imul(low ^ high, 0x9e37_79b1) >>> 0;
}

function validateUniqueDiscardOrdinals(
    buffer: Buffer,
    location: SamplingArrayLocation,
    nodeIds: ReadonlySet<number>
): void {
    if (location.count === 0) return;
    let capacity = 1;
    const minimumCapacity = Math.ceil(location.count / 0.7);
    while (capacity < minimumCapacity) {
        capacity *= 2;
        if (!Number.isSafeInteger(capacity) || capacity > 0x4000_0000) {
            transportFailure('discard sampling profile contains too many samples');
        }
    }
    const ordinals = new Float64Array(capacity);
    const mask = capacity - 1;
    visitLocatedSamples(buffer, location, (_size, nodeId, ordinal) => {
        if (!nodeIds.has(nodeId)) {
            transportFailure('sampling profile sample references an unknown node id');
        }
        let slot = ordinalHash(ordinal) & mask;
        while (ordinals[slot] !== 0) {
            if (ordinals[slot] === ordinal) {
                transportFailure('sampling profile sample ordinal is duplicated');
            }
            slot = (slot + 1) & mask;
        }
        ordinals[slot] = ordinal;
    });
}

function compactMarkedSamples(
    nodeIds: Uint32Array,
    sizes: Float64Array,
    startMarkerNodeIds: ReadonlySet<number>,
    endMarkerNodeIds: ReadonlySet<number>
): readonly CompactSamplingSample[] {
    const result: CompactSamplingSample[] = [];
    let phase: 'outside' | 'start-marker' | 'frame' | 'end-marker' = 'outside';
    let activeFrame: Map<number, number> | null = null;
    let activeStartNodeId = 0;
    let nextOrdinal = 1;
    const finishFrame = (endNodeId: number): void => {
        if (activeFrame === null || activeStartNodeId === 0) {
            transportFailure('sampling profile marker state is inconsistent');
        }
        result.push(Object.freeze({ size: 1, nodeId: activeStartNodeId, ordinal: nextOrdinal }));
        nextOrdinal += 1;
        for (const [nodeId, size] of activeFrame) {
            result.push(Object.freeze({ size, nodeId, ordinal: nextOrdinal }));
            nextOrdinal += 1;
        }
        result.push(Object.freeze({ size: 1, nodeId: endNodeId, ordinal: nextOrdinal }));
        nextOrdinal += 1;
        activeFrame = null;
        activeStartNodeId = 0;
    };
    for (let ordinal = 1; ordinal < nodeIds.length; ordinal += 1) {
        const nodeId = nodeIds[ordinal] ?? 0;
        const size = sizes[ordinal] ?? 0;
        const startMarker = startMarkerNodeIds.has(nodeId);
        const endMarker = endMarkerNodeIds.has(nodeId);
        if (startMarker) {
            if (phase === 'frame')
                transportFailure('sampling profile observed a nested frame start');
            if (phase === 'outside' || phase === 'end-marker') {
                activeFrame = new Map<number, number>();
                activeStartNodeId = nodeId;
                phase = 'start-marker';
            }
            continue;
        }
        if (endMarker) {
            if (phase === 'outside') {
                transportFailure('sampling profile observed a frame end without a start');
            }
            if (phase === 'start-marker' || phase === 'frame') {
                finishFrame(nodeId);
                phase = 'end-marker';
            }
            continue;
        }
        if (phase === 'start-marker') phase = 'frame';
        if (phase === 'frame') {
            if (activeFrame === null) transportFailure('sampling profile frame state is invalid');
            const total = (activeFrame.get(nodeId) ?? 0) + size;
            if (!Number.isSafeInteger(total)) {
                transportFailure('sampling profile frame byte total is not a safe integer');
            }
            activeFrame.set(nodeId, total);
        } else if (phase === 'end-marker') {
            phase = 'outside';
        }
    }
    if (phase === 'start-marker' || phase === 'frame' || activeFrame !== null) {
        transportFailure('sampling profile ended inside a frame');
    }
    return Object.freeze(result);
}

function parseSmallErrorResponse(
    buffer: Buffer,
    expectedId: number,
    expectedSessionId: string | undefined
): ParsedStopError {
    if (buffer.length > ERROR_RESPONSE_MAX_BYTES) {
        transportFailure('CDP stopSampling error response exceeds its small parsing bound');
    }
    let value: unknown;
    try {
        value = JSON.parse(buffer.toString('utf8')) as unknown;
    } catch {
        transportFailure('CDP stopSampling error response contains invalid JSON');
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        transportFailure('CDP stopSampling error response is malformed');
    }
    const response = value as Record<string, unknown>;
    const keys = Object.keys(response);
    const expectedKeyCount = expectedSessionId === undefined ? 2 : 3;
    if (
        keys.length !== expectedKeyCount ||
        !Object.hasOwn(response, 'id') ||
        !Object.hasOwn(response, 'error') ||
        response['id'] !== expectedId ||
        (expectedSessionId !== undefined && response['sessionId'] !== expectedSessionId) ||
        typeof response['error'] !== 'object' ||
        response['error'] === null ||
        Array.isArray(response['error'])
    ) {
        transportFailure('CDP stopSampling error envelope is malformed');
    }
    return { kind: 'error', error: response['error'] };
}

function parseStopSamplingResponse(
    buffer: Buffer,
    expectation: RHIHeapProfilerStopResponseExpectation
): ParsedStopResponse {
    if (buffer.length > RHI_STREAMING_HEAP_PROFILER_MAX_PAYLOAD_BYTES) {
        transportFailure('CDP stopSampling response exceeds the transport payload bound');
    }
    const cursor = new JsonByteCursor(buffer);
    cursor.expectByte(0x7b, 'CDP stopSampling response is not an object');
    cursor.expectKey('id', 'CDP stopSampling response');
    const id = cursor.readUnsignedInteger('CDP stopSampling response id');
    if (id < 1) transportFailure('CDP stopSampling response id is invalid');
    if (id !== expectation.expectedId) {
        transportFailure('CDP stopSampling response id differs from its request');
    }
    cursor.expectByte(0x2c, 'CDP stopSampling response id requires a result or error');
    const envelopeKey = cursor.readKnownKey(
        [
            ['result', JSON_KEYS.result],
            ['error', JSON_KEYS.error]
        ] as const,
        'CDP stopSampling response'
    );
    if (envelopeKey === 'error') {
        return parseSmallErrorResponse(buffer, id, expectation.expectedSessionId);
    }
    const parsed = parseSuccessEnvelope(cursor, expectation.mode, expectation.expectedSessionId);
    if (expectation.mode === 'discard') {
        validateUniqueDiscardOrdinals(buffer, parsed.samples, parsed.analysis.nodeIds);
        return { kind: 'success', result: Object.freeze({}) };
    }
    const samples = chronologicalMarkedSamples(buffer, parsed.samples, parsed.analysis.nodeIds);
    return {
        kind: 'success',
        result: Object.freeze({
            profile: Object.freeze({
                head: parsed.head,
                samples: compactMarkedSamples(
                    samples.nodeIds,
                    samples.sizes,
                    parsed.analysis.startMarkerNodeIds,
                    parsed.analysis.endMarkerNodeIds
                )
            })
        })
    };
}

/**
 * Validate and compact one complete stopSampling response without materializing its samples JSON
 * as a string. The caller must provide the mode attached to the successful startSampling command;
 * marker text is never used to infer whether a profile may be discarded.
 */
export function compactRHIHeapProfilerStopResponse(
    buffer: Buffer,
    expectation: RHIHeapProfilerStopResponseExpectation
): unknown {
    const mode: unknown = expectation.mode;
    const expectedSessionId: unknown = expectation.expectedSessionId;
    if (
        !Number.isSafeInteger(expectation.expectedId) ||
        expectation.expectedId < 1 ||
        (mode !== 'discard' && mode !== 'marked') ||
        (expectedSessionId !== undefined &&
            (typeof expectedSessionId !== 'string' || expectedSessionId.length === 0))
    ) {
        throw new RangeError('RHI stopSampling response expectation is invalid');
    }
    const parsed = parseStopSamplingResponse(buffer, expectation);
    if (parsed.kind === 'error') {
        transportFailure(`CDP stopSampling failed: ${JSON.stringify(parsed.error)}`);
    }
    return parsed.result;
}
