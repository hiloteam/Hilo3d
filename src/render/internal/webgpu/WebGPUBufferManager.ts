import type GeometryData from '../../../geometry/GeometryData';
import { WebGPUDevice } from '../../rhi/webgpu/WebGPUDevice';
import type { WebGPUVertexInput } from '../../shader/GlslToWgsl';
import type { TypedArray } from '../../types';
import { WebGPUBufferUsage } from './WebGPUConstants';

export interface WebGPUVertexBufferBinding {
    readonly buffer: GPUBuffer;
    readonly layout: GPUVertexBufferLayout;
    count: number;
}

export interface WebGPUIndexBufferBinding {
    readonly buffer: GPUBuffer;
    readonly format: GPUIndexFormat;
    count: number;
}

export interface WebGPUVertexBufferSource {
    readonly geometryData: GeometryData;
    readonly input: WebGPUVertexInput;
}

export interface WebGPUInstanceBufferSource {
    readonly input: WebGPUVertexInput;
    /** Called and copied immediately so shared semantic scratch values remain safe. */
    readonly getValue: (instanceIndex: number) => ArrayLike<number>;
}

export interface WebGPUIndexBufferOptions {
    /** Remap Uint8's 0xff restart marker to WebGPU uint16's 0xffff marker. */
    readonly primitiveRestart?: boolean;
}

export type WebGPUBufferOwner = object | string;

export interface WebGPUBufferCacheLimits {
    /** Maximum packed vertex layouts retained for one geometry/explicit owner. */
    readonly vertexVariantsPerOwner: number;
    /** Maximum packed instance layouts retained for one stable batch owner. */
    readonly instanceVariantsPerOwner: number;
    /** Maximum primitive-restart/data-format variants retained for one index owner. */
    readonly indexVariantsPerOwner: number;
}

export const DEFAULT_WEBGPU_BUFFER_CACHE_LIMITS: Readonly<WebGPUBufferCacheLimits> = Object.freeze({
    vertexVariantsPerOwner: 16,
    instanceVariantsPerOwner: 8,
    indexVariantsPerOwner: 4
});

interface CachedVertexBuffer extends WebGPUVertexBufferBinding {
    byteLength: number;
    structureKey: string;
    sourceRevisions: number[];
}

interface CachedIndexBuffer extends WebGPUIndexBufferBinding {
    revision: number;
    byteLength: number;
    structureKey: string;
}

interface CachedInstanceBuffer extends WebGPUVertexBufferBinding {
    byteLength: number;
    data: Uint8Array;
}

interface InputShape {
    readonly scalar: 'float' | 'sint' | 'uint';
    readonly columns: number;
    readonly rows: number;
}

interface PreparedInput {
    readonly input: WebGPUVertexInput;
    readonly shape: InputShape;
    readonly sourceIndex: number;
    readonly byteOffset: number;
    readonly byteLength: number;
}

interface PreparedVertexLayout {
    readonly inputs: readonly PreparedInput[];
    readonly layout: GPUVertexBufferLayout;
    readonly signature: string;
}

interface ByteRange {
    readonly start: number;
    readonly end: number;
}

interface IndexFormatInfo {
    readonly format: GPUIndexFormat;
    readonly key: string;
    readonly sourceByteLength: number;
    readonly packedByteLength: number;
    readonly primitiveRestart: boolean;
}

class OwnerCache<Value> {
    private objects = new WeakMap<object, Value>();
    private readonly strings = new Map<string, Value>();

    get(owner: WebGPUBufferOwner): Value | undefined {
        return typeof owner === 'string' ? this.strings.get(owner) : this.objects.get(owner);
    }

    set(owner: WebGPUBufferOwner, value: Value): void {
        if (typeof owner === 'string') this.strings.set(owner, value);
        else this.objects.set(owner, value);
    }

    delete(owner: WebGPUBufferOwner): void {
        if (typeof owner === 'string') this.strings.delete(owner);
        else this.objects.delete(owner);
    }

    clear(): void {
        this.strings.clear();
        this.objects = new WeakMap();
    }
}

function alignTo4(value: number): number {
    return Math.max(4, Math.ceil(value / 4) * 4);
}

function cacheLimit(value: number, name: keyof WebGPUBufferCacheLimits): number {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new RangeError(`WebGPU buffer cache limit ${name} must be a positive safe integer`);
    }
    return value;
}

function inputShape(type: string): InputShape {
    if (type === 'float') return { scalar: 'float', columns: 1, rows: 1 };
    if (type === 'int') return { scalar: 'sint', columns: 1, rows: 1 };
    if (type === 'uint') return { scalar: 'uint', columns: 1, rows: 1 };
    const vector = /^(i|u)?vec([2-4])$/u.exec(type);
    if (vector?.[2]) {
        return {
            scalar: vector[1] === 'i' ? 'sint' : vector[1] === 'u' ? 'uint' : 'float',
            columns: 1,
            rows: Number(vector[2])
        };
    }
    const matrix = /^mat([2-4])(?:x([2-4]))?$/u.exec(type);
    if (matrix?.[1]) {
        return {
            scalar: 'float',
            columns: Number(matrix[1]),
            rows: Number(matrix[2] ?? matrix[1])
        };
    }
    throw new TypeError(`WebGPU vertex input type ${type} is unsupported`);
}

function vertexFormat(scalar: InputShape['scalar'], components: number): GPUVertexFormat {
    const suffix = components === 1 ? '' : `x${String(components)}`;
    return `${scalar}32${suffix}` as GPUVertexFormat;
}

function normalizedComponent(data: TypedArray, value: number): number {
    if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) return value / 0xff;
    if (data instanceof Uint16Array) return value / 0xffff;
    if (data instanceof Uint32Array) return value / 0xffffffff;
    if (data instanceof Int8Array) return Math.max(-1, value / 0x7f);
    if (data instanceof Int16Array) return Math.max(-1, value / 0x7fff);
    if (data instanceof Int32Array) return Math.max(-1, value / 0x7fffffff);
    return value;
}

function validateIntegerComponent(value: number, scalar: 'sint' | 'uint'): number {
    if (!Number.isInteger(value)) {
        throw new TypeError(`WebGPU ${scalar} vertex inputs require integer component values`);
    }
    if (scalar === 'uint' && (value < 0 || value > 0xffffffff)) {
        throw new RangeError('WebGPU uint vertex component is outside the uint32 range');
    }
    if (scalar === 'sint' && (value < -0x80000000 || value > 0x7fffffff)) {
        throw new RangeError('WebGPU sint vertex component is outside the sint32 range');
    }
    return value;
}

function validateCount(count: number, label: string): number {
    if (!Number.isSafeInteger(count) || count < 0) {
        throw new RangeError(`${label} count must be a non-negative safe integer`);
    }
    return count;
}

function packedByteLength(count: number, arrayStride: number): number {
    const byteLength = count * arrayStride;
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
        throw new RangeError('Packed WebGPU buffer byte length exceeds JavaScript safe integers');
    }
    return byteLength;
}

function validateGeometryShape(geometryData: GeometryData, shape: InputShape): void {
    const components = shape.columns * shape.rows;
    if (geometryData.size !== components) {
        throw new RangeError(
            `GeometryData has ${String(geometryData.size)} components, but shader input requires ${String(components)}`
        );
    }
    if (shape.scalar !== 'float' && geometryData.normalized) {
        throw new TypeError('Normalized GeometryData cannot feed an integer WebGPU shader input');
    }
    validateCount(geometryData.count, 'GeometryData');
}

function prepareVertexLayout(
    inputs: readonly WebGPUVertexInput[],
    stepMode: GPUVertexStepMode,
    limits: GPUSupportedLimits
): PreparedVertexLayout {
    if (inputs.length === 0) {
        throw new RangeError('A WebGPU vertex buffer bundle requires at least one shader input');
    }
    const sorted = inputs
        .map((input, sourceIndex) => ({ input, sourceIndex, shape: inputShape(input.type) }))
        .sort(
            (left, right) =>
                left.input.location - right.input.location ||
                left.input.type.localeCompare(right.input.type) ||
                left.input.name.localeCompare(right.input.name)
        );
    const occupiedLocations = new Set<number>();
    const prepared: PreparedInput[] = [];
    const attributes: GPUVertexAttribute[] = [];
    let arrayStride = 0;
    for (const item of sorted) {
        const { input, shape, sourceIndex } = item;
        if (!Number.isSafeInteger(input.location) || input.location < 0) {
            throw new RangeError(
                `Vertex input ${input.name} location must be a non-negative integer`
            );
        }
        if (input.locationCount !== shape.columns) {
            throw new RangeError(
                `Vertex input ${input.name} declares ${String(input.locationCount)} locations, but ${input.type} requires ${String(shape.columns)}`
            );
        }
        const byteLength = shape.columns * shape.rows * 4;
        const byteOffset = arrayStride;
        for (let column = 0; column < shape.columns; column++) {
            const shaderLocation = input.location + column;
            if (shaderLocation >= limits.maxVertexAttributes) {
                throw new RangeError(
                    `Vertex input ${input.name} location ${String(shaderLocation)} exceeds maxVertexAttributes ${String(limits.maxVertexAttributes)}`
                );
            }
            if (occupiedLocations.has(shaderLocation)) {
                throw new RangeError(
                    `WebGPU vertex shader location ${String(shaderLocation)} is used more than once`
                );
            }
            occupiedLocations.add(shaderLocation);
            attributes.push({
                format: vertexFormat(shape.scalar, shape.rows),
                offset: byteOffset + column * shape.rows * 4,
                shaderLocation
            });
        }
        prepared.push({ input, shape, sourceIndex, byteOffset, byteLength });
        arrayStride += byteLength;
    }
    if (arrayStride > limits.maxVertexBufferArrayStride) {
        throw new RangeError(
            `Packed WebGPU vertex stride ${String(arrayStride)} exceeds maxVertexBufferArrayStride ${String(limits.maxVertexBufferArrayStride)}`
        );
    }
    return {
        inputs: prepared,
        layout: { arrayStride, stepMode, attributes },
        signature: prepared.map(({ input }) => `${String(input.location)}:${input.type}`).join('|')
    };
}

function packVertexRange(
    sources: readonly WebGPUVertexBufferSource[],
    prepared: PreparedVertexLayout,
    firstVertex: number,
    count: number
): Uint8Array {
    const arrayStride = prepared.layout.arrayStride;
    if (!Number.isSafeInteger(firstVertex) || firstVertex < 0) {
        throw new RangeError('Packed WebGPU vertex range must start at a non-negative integer');
    }
    const buffer = new ArrayBuffer(packedByteLength(count, arrayStride));
    const output = new Uint8Array(buffer);
    const floatValues = new Float32Array(buffer);
    const sintValues = new Int32Array(buffer);
    const uintValues = new Uint32Array(buffer);
    for (const item of prepared.inputs) {
        const source = sources[item.sourceIndex];
        if (!source) throw new RangeError('Missing packed WebGPU vertex source');
        const geometryData = source.geometryData;
        validateGeometryShape(geometryData, item.shape);
        const sourceCount = validateCount(geometryData.count, 'GeometryData');
        if (firstVertex + count > sourceCount) {
            throw new RangeError('Packed WebGPU vertex range exceeds its GeometryData source');
        }
        const components = item.shape.columns * item.shape.rows;
        const sourceData = geometryData.data;
        for (let vertex = 0; vertex < count; vertex++) {
            const sourceOffset = geometryData.getOffset(firstVertex + vertex);
            const outputOffset = (vertex * arrayStride + item.byteOffset) / 4;
            for (let component = 0; component < components; component++) {
                const raw = sourceData[sourceOffset + component];
                if (raw === undefined) {
                    throw new RangeError('GeometryData vertex points outside its backing array');
                }
                if (item.shape.scalar === 'float') {
                    floatValues[outputOffset + component] = geometryData.normalized
                        ? normalizedComponent(sourceData, raw)
                        : raw;
                } else if (item.shape.scalar === 'sint') {
                    sintValues[outputOffset + component] = validateIntegerComponent(raw, 'sint');
                } else {
                    uintValues[outputOffset + component] = validateIntegerComponent(raw, 'uint');
                }
            }
        }
    }
    return output;
}

function packVertexSources(
    sources: readonly WebGPUVertexBufferSource[],
    prepared: PreparedVertexLayout,
    count: number
): Uint8Array {
    return packVertexRange(sources, prepared, 0, count);
}

function geometryStructureKey(geometryData: GeometryData): string {
    return [
        geometryData.size,
        geometryData.normalized ? 1 : 0,
        geometryData.stride,
        geometryData.offset,
        geometryData.type,
        geometryData.data.byteLength,
        geometryData.count
    ].join(':');
}

function mergeRanges(ranges: readonly ByteRange[]): readonly ByteRange[] {
    if (ranges.length < 2) return ranges;
    const sorted = [...ranges].sort(
        (left, right) => left.start - right.start || left.end - right.end
    );
    const merged: ByteRange[] = [];
    for (const range of sorted) {
        const previous = merged.at(-1);
        if (previous && range.start <= previous.end) {
            merged[merged.length - 1] = {
                start: previous.start,
                end: Math.max(previous.end, range.end)
            };
        } else {
            merged.push(range);
        }
    }
    return merged;
}

function affectedVertexRange(
    geometryData: GeometryData,
    byteOffset: number,
    byteLength: number,
    count: number
): ByteRange | null {
    if (count === 0 || byteLength === 0) return null;
    const componentByteLength = geometryData.data.BYTES_PER_ELEMENT;
    const attributeByteLength = geometryData.size * componentByteLength;
    const sourceStride = geometryData.stride === 0 ? attributeByteLength : geometryData.stride;
    const sourceOffset = geometryData.stride === 0 ? 0 : geometryData.offset;
    const updateEnd = byteOffset + byteLength;
    const first = Math.max(
        0,
        Math.floor((byteOffset - sourceOffset - attributeByteLength) / sourceStride) + 1
    );
    const last = Math.min(count - 1, Math.floor((updateEnd - sourceOffset - 1) / sourceStride));
    return first > last ? null : { start: first, end: last + 1 };
}

function updatedVertexRanges(
    sources: readonly WebGPUVertexBufferSource[],
    uploadedRevisions: readonly number[],
    count: number
): readonly ByteRange[] | null {
    const ranges: ByteRange[] = [];
    for (let index = 0; index < sources.length; index++) {
        const source = sources[index];
        const uploadedRevision = uploadedRevisions[index];
        if (!source || uploadedRevision === undefined) return null;
        const geometryData = source.geometryData;
        if (geometryData.revision === uploadedRevision) continue;
        const updates = geometryData.getSubDataUpdatesSince(uploadedRevision);
        if (updates === null) return null;
        for (const update of updates) {
            const range = affectedVertexRange(
                geometryData,
                update.byteOffset,
                update.data.byteLength,
                count
            );
            if (range) ranges.push(range);
        }
    }
    return mergeRanges(ranges);
}

function packInstanceSources(
    sources: readonly WebGPUInstanceBufferSource[],
    prepared: PreparedVertexLayout,
    count: number
): Uint8Array {
    const arrayStride = prepared.layout.arrayStride;
    const buffer = new ArrayBuffer(packedByteLength(count, arrayStride));
    const floatValues = new Float32Array(buffer);
    const sintValues = new Int32Array(buffer);
    const uintValues = new Uint32Array(buffer);
    for (let instance = 0; instance < count; instance++) {
        for (const item of prepared.inputs) {
            const source = sources[item.sourceIndex];
            if (!source) throw new RangeError('Missing packed WebGPU instance source');
            const value = source.getValue(instance);
            const components = item.shape.columns * item.shape.rows;
            if (value.length !== components) {
                throw new RangeError(
                    `Instanced shader input ${item.input.name} requires ${String(components)} values, received ${String(value.length)}`
                );
            }
            const elementOffset = (instance * arrayStride + item.byteOffset) / 4;
            for (let component = 0; component < components; component++) {
                const raw = value[component];
                if (typeof raw !== 'number' || !Number.isFinite(raw)) {
                    throw new TypeError('Instanced shader input values must be finite numbers');
                }
                if (item.shape.scalar === 'float') {
                    floatValues[elementOffset + component] = raw;
                } else if (item.shape.scalar === 'sint') {
                    sintValues[elementOffset + component] = validateIntegerComponent(raw, 'sint');
                } else {
                    uintValues[elementOffset + component] = validateIntegerComponent(raw, 'uint');
                }
            }
        }
    }
    return new Uint8Array(buffer);
}

function uploadNewBuffer(
    deviceOrOwner: GPUDevice | WebGPUDevice,
    label: string,
    usage: GPUBufferUsageFlags,
    data: ArrayBufferView
): GPUBuffer {
    const device =
        deviceOrOwner instanceof WebGPUDevice ? deviceOrOwner.nativeDevice : deviceOrOwner;
    const allocationSize = alignTo4(data.byteLength);
    if (allocationSize > device.limits.maxBufferSize) {
        throw new RangeError(
            `WebGPU buffer allocation ${String(allocationSize)} exceeds maxBufferSize ${String(device.limits.maxBufferSize)}`
        );
    }
    const descriptor: GPUBufferDescriptor = {
        label,
        size: allocationSize,
        usage,
        mappedAtCreation: true
    };
    const buffer =
        deviceOrOwner instanceof WebGPUDevice
            ? deviceOrOwner.createNativeBuffer(descriptor)
            : device.createBuffer(descriptor);
    try {
        new Uint8Array(buffer.getMappedRange(), 0, data.byteLength).set(
            new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        );
        buffer.unmap();
        return buffer;
    } catch (error) {
        buffer.destroy();
        throw error;
    }
}

/** GPUQueue.writeBuffer requires both the destination offset and copied byte count to be 4-byte aligned. */
function writeBufferData(
    deviceOrOwner: GPUDevice | WebGPUDevice,
    buffer: GPUBuffer,
    data: ArrayBufferView,
    bufferOffset = 0
): void {
    if (!Number.isSafeInteger(bufferOffset) || bufferOffset < 0 || bufferOffset % 4 !== 0) {
        throw new RangeError('GPUQueue.writeBuffer destination offset must be 4-byte aligned');
    }
    const byteLength = alignTo4(data.byteLength);
    const write = (source: AllowSharedBufferSource, dataOffset: number, size: number): void => {
        if (deviceOrOwner instanceof WebGPUDevice) {
            deviceOrOwner.writeNativeBuffer(buffer, bufferOffset, source, dataOffset, size);
        } else {
            deviceOrOwner.queue.writeBuffer(buffer, bufferOffset, source, dataOffset, size);
        }
    };
    if (byteLength === data.byteLength) {
        write(data.buffer, data.byteOffset, data.byteLength);
        return;
    }
    const padded = new Uint8Array(byteLength);
    padded.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    write(padded.buffer, 0, padded.byteLength);
}

function indexFormatInfo(geometryData: GeometryData, primitiveRestart: boolean): IndexFormatInfo {
    if (
        geometryData.size !== 1 ||
        geometryData.stride !== 0 ||
        geometryData.offset !== 0 ||
        geometryData.normalized
    ) {
        throw new TypeError(
            'WebGPU index data requires size=1, stride=0, offset=0 and normalized=false'
        );
    }
    if (geometryData.data instanceof Uint32Array) {
        return {
            format: 'uint32',
            key: 'uint32',
            sourceByteLength: 4,
            packedByteLength: 4,
            primitiveRestart: false
        };
    }
    if (geometryData.data instanceof Uint16Array) {
        return {
            format: 'uint16',
            key: 'uint16',
            sourceByteLength: 2,
            packedByteLength: 2,
            primitiveRestart: false
        };
    }
    if (geometryData.data instanceof Uint8Array || geometryData.data instanceof Uint8ClampedArray) {
        return {
            format: 'uint16',
            key: primitiveRestart ? 'uint8-restart' : 'uint8',
            sourceByteLength: 1,
            packedByteLength: 2,
            primitiveRestart
        };
    }
    throw new TypeError('WebGPU index data must be an unsigned 8-, 16-, or 32-bit array');
}

function packIndexRange(
    geometryData: GeometryData,
    info: IndexFormatInfo,
    firstIndex: number,
    count: number
): Uint16Array | Uint32Array {
    const end = firstIndex + count;
    if (firstIndex < 0 || count < 0 || end > geometryData.count) {
        throw new RangeError('Packed WebGPU index range exceeds its GeometryData source');
    }
    const data = geometryData.data;
    if (info.format === 'uint32') {
        if (!(data instanceof Uint32Array)) throw new TypeError('uint32 index source changed type');
        return data.slice(firstIndex, end);
    }
    if (data instanceof Uint16Array) return data.slice(firstIndex, end);
    if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) {
        return Uint16Array.from(data.subarray(firstIndex, end), value =>
            info.primitiveRestart && value === 0xff ? 0xffff : value
        );
    }
    throw new TypeError('uint16 index source changed type');
}

function packAllIndexData(
    geometryData: GeometryData,
    info: IndexFormatInfo
): Uint16Array | Uint32Array {
    return packIndexRange(geometryData, info, 0, validateCount(geometryData.count, 'Index'));
}

function updatedIndexByteRanges(
    geometryData: GeometryData,
    info: IndexFormatInfo,
    uploadedRevision: number
): readonly ByteRange[] | null {
    const updates = geometryData.getSubDataUpdatesSince(uploadedRevision);
    if (updates === null) return null;
    const allocationByteLength = alignTo4(geometryData.count * info.packedByteLength);
    const ranges: ByteRange[] = [];
    for (const update of updates) {
        if (update.data.byteLength === 0) continue;
        const firstIndex = Math.floor(update.byteOffset / info.sourceByteLength);
        const endIndex = Math.ceil(
            (update.byteOffset + update.data.byteLength) / info.sourceByteLength
        );
        ranges.push({
            start: Math.floor((firstIndex * info.packedByteLength) / 4) * 4,
            end: Math.min(allocationByteLength, alignTo4(endIndex * info.packedByteLength))
        });
    }
    return mergeRanges(ranges);
}

function packIndexByteRange(
    geometryData: GeometryData,
    info: IndexFormatInfo,
    range: ByteRange
): Uint8Array {
    const firstIndex = Math.floor(range.start / info.packedByteLength);
    const endIndex = Math.min(geometryData.count, Math.ceil(range.end / info.packedByteLength));
    const packed = packIndexRange(geometryData, info, firstIndex, endIndex - firstIndex);
    const result = new Uint8Array(range.end - range.start);
    const packedOffset = firstIndex * info.packedByteLength - range.start;
    result.set(new Uint8Array(packed.buffer, packed.byteOffset, packed.byteLength), packedOffset);
    return result;
}

/** Per-device packed vertex, instance and index allocation cache. */
export class WebGPUBufferManager {
    private readonly owner: GPUDevice | WebGPUDevice;
    private readonly device: GPUDevice;
    private readonly vertexBuffers = new OwnerCache<Map<string, CachedVertexBuffer>>();
    /** Renderer frame snapshots call releaseOwner when an index GeometryData identity is replaced. */
    private indexBuffers = new WeakMap<GeometryData, Map<string, CachedIndexBuffer>>();
    private readonly instanceBuffers = new OwnerCache<Map<string, CachedInstanceBuffer>>();
    private readonly objectIds = new WeakMap<object, number>();
    private nextObjectId = 1;
    private readonly ownedBuffers = new Set<GPUBuffer>();
    private submissionActive = false;
    private submissionUsedBuffers = new WeakSet<GPUBuffer>();
    private readonly deferredBufferDestructions = new Set<GPUBuffer>();
    readonly cacheLimits: Readonly<WebGPUBufferCacheLimits>;

    constructor(
        deviceOrOwner: GPUDevice | WebGPUDevice,
        cacheLimits: Partial<WebGPUBufferCacheLimits> = {}
    ) {
        this.owner = deviceOrOwner;
        this.device =
            deviceOrOwner instanceof WebGPUDevice ? deviceOrOwner.nativeDevice : deviceOrOwner;
        this.cacheLimits = Object.freeze({
            vertexVariantsPerOwner: cacheLimit(
                cacheLimits.vertexVariantsPerOwner ??
                    DEFAULT_WEBGPU_BUFFER_CACHE_LIMITS.vertexVariantsPerOwner,
                'vertexVariantsPerOwner'
            ),
            instanceVariantsPerOwner: cacheLimit(
                cacheLimits.instanceVariantsPerOwner ??
                    DEFAULT_WEBGPU_BUFFER_CACHE_LIMITS.instanceVariantsPerOwner,
                'instanceVariantsPerOwner'
            ),
            indexVariantsPerOwner: cacheLimit(
                cacheLimits.indexVariantsPerOwner ??
                    DEFAULT_WEBGPU_BUFFER_CACHE_LIMITS.indexVariantsPerOwner,
                'indexVariantsPerOwner'
            )
        });
    }

    /** Preserve every native buffer referenced by one pending command-buffer submission. */
    beginSubmission(): void {
        if (this.submissionActive) {
            throw new Error('A WebGPU buffer submission is already active');
        }
        this.submissionActive = true;
        this.submissionUsedBuffers = new WeakSet();
    }

    /** Release buffers evicted after use once their command buffer has been queued or abandoned. */
    endSubmission(): void {
        if (!this.submissionActive) return;
        this.submissionActive = false;
        for (const buffer of this.deferredBufferDestructions) {
            buffer.destroy();
            this.ownedBuffers.delete(buffer);
        }
        this.deferredBufferDestructions.clear();
        this.submissionUsedBuffers = new WeakSet();
    }

    private markSubmissionUse(resource: { readonly buffer: GPUBuffer }): void {
        if (this.submissionActive) this.submissionUsedBuffers.add(resource.buffer);
    }

    private destroyCachedBuffer(resource: { readonly buffer: GPUBuffer }): void {
        const buffer = resource.buffer;
        if (this.submissionActive && this.submissionUsedBuffers.has(buffer)) {
            this.deferredBufferDestructions.add(buffer);
            return;
        }
        buffer.destroy();
        this.ownedBuffers.delete(buffer);
    }

    private touchVariant<Value>(variants: Map<string, Value>, key: string, value: Value): void {
        variants.delete(key);
        variants.set(key, value);
    }

    private evictVariantOverflow<Value extends { readonly buffer: GPUBuffer }>(
        variants: Map<string, Value>,
        limit: number
    ): void {
        while (variants.size > limit) {
            const oldest = variants.entries().next();
            if (oldest.done) return;
            const [key, resource] = oldest.value;
            variants.delete(key);
            this.destroyCachedBuffer(resource);
        }
    }

    private objectId(object: object): number {
        let id = this.objectIds.get(object);
        if (id === undefined) {
            id = this.nextObjectId++;
            this.objectIds.set(object, id);
        }
        return id;
    }

    /** Pack any number of per-vertex shader inputs into one GPU vertex-buffer slot. */
    getInterleavedVertexBuffer(
        owner: WebGPUBufferOwner,
        sources: readonly WebGPUVertexBufferSource[]
    ): WebGPUVertexBufferBinding {
        const prepared = prepareVertexLayout(
            sources.map(source => source.input),
            'vertex',
            this.device.limits
        );
        const orderedSources = prepared.inputs.map(item => {
            const source = sources[item.sourceIndex];
            if (!source) throw new RangeError('Missing packed WebGPU vertex source');
            return source;
        });
        const first = orderedSources[0];
        if (!first) throw new RangeError('A WebGPU vertex bundle requires a source');
        const count = validateCount(first.geometryData.count, 'Vertex bundle');
        for (const source of orderedSources) {
            if (validateCount(source.geometryData.count, 'Vertex bundle') !== count) {
                throw new RangeError(
                    'Every source in a WebGPU vertex bundle must have equal count'
                );
            }
        }
        const cacheKey = orderedSources
            .map(source => String(this.objectId(source.geometryData)))
            .join(':');
        const structureKey = orderedSources
            .map(source => geometryStructureKey(source.geometryData))
            .join('|');
        const sourceRevisions = orderedSources.map(source => source.geometryData.revision);
        let variants = this.vertexBuffers.get(owner);
        if (!variants) {
            variants = new Map();
            this.vertexBuffers.set(owner, variants);
        }
        const variantKey = `${prepared.signature}:${cacheKey}`;
        let resource = variants.get(variantKey);
        const byteLength = packedByteLength(count, prepared.layout.arrayStride);
        const resourceChanged =
            resource !== undefined &&
            (resource.byteLength !== byteLength ||
                resource.structureKey !== structureKey ||
                resource.sourceRevisions.some(
                    (revision, index) => revision !== sourceRevisions[index]
                ));
        if (
            resource !== undefined &&
            resourceChanged &&
            this.submissionActive &&
            this.submissionUsedBuffers.has(resource.buffer)
        ) {
            throw new Error(
                'Geometry data cannot change after its first use in one WebGPU submission'
            );
        }
        if (resource?.byteLength !== byteLength) {
            const data = packVertexSources(sources, prepared, count);
            const buffer = uploadNewBuffer(
                this.owner,
                `VertexBundle:${variantKey}`,
                WebGPUBufferUsage.VERTEX | WebGPUBufferUsage.COPY_DST,
                data
            );
            if (resource) this.destroyCachedBuffer(resource);
            this.ownedBuffers.add(buffer);
            resource = {
                buffer,
                layout: prepared.layout,
                count,
                byteLength: data.byteLength,
                structureKey,
                sourceRevisions: [...sourceRevisions]
            };
            variants.set(variantKey, resource);
        } else if (
            resource.structureKey !== structureKey ||
            resource.sourceRevisions.some((revision, index) => revision !== sourceRevisions[index])
        ) {
            const ranges =
                resource.structureKey === structureKey
                    ? updatedVertexRanges(orderedSources, resource.sourceRevisions, count)
                    : null;
            if (ranges === null) {
                writeBufferData(
                    this.owner,
                    resource.buffer,
                    packVertexSources(sources, prepared, count)
                );
            } else {
                const patches = ranges.map(range => ({
                    bufferOffset: range.start * prepared.layout.arrayStride,
                    data: packVertexRange(sources, prepared, range.start, range.end - range.start)
                }));
                for (const patch of patches) {
                    writeBufferData(this.owner, resource.buffer, patch.data, patch.bufferOffset);
                }
            }
            resource.structureKey = structureKey;
            resource.sourceRevisions = [...sourceRevisions];
            resource.count = count;
        }
        this.markSubmissionUse(resource);
        this.touchVariant(variants, variantKey, resource);
        this.evictVariantOverflow(variants, this.cacheLimits.vertexVariantsPerOwner);
        return resource;
    }

    getVertexBuffer(
        geometryData: GeometryData,
        input: WebGPUVertexInput
    ): WebGPUVertexBufferBinding {
        return this.getInterleavedVertexBuffer(geometryData, [{ geometryData, input }]);
    }

    getIndexBuffer(
        geometryData: GeometryData,
        options: WebGPUIndexBufferOptions = {}
    ): WebGPUIndexBufferBinding {
        const info = indexFormatInfo(geometryData, options.primitiveRestart ?? false);
        const revision = geometryData.revision;
        const structureKey = geometryStructureKey(geometryData);
        const byteLength = validateCount(geometryData.count, 'Index') * info.packedByteLength;
        let variants = this.indexBuffers.get(geometryData);
        if (!variants) {
            variants = new Map();
            this.indexBuffers.set(geometryData, variants);
        }
        let resource = variants.get(info.key);
        const resourceChanged =
            resource !== undefined &&
            (resource.byteLength !== byteLength ||
                resource.format !== info.format ||
                resource.revision !== revision ||
                resource.structureKey !== structureKey);
        if (
            resource !== undefined &&
            resourceChanged &&
            this.submissionActive &&
            this.submissionUsedBuffers.has(resource.buffer)
        ) {
            throw new Error(
                'Geometry data cannot change after its first use in one WebGPU submission'
            );
        }
        if (resource?.byteLength !== byteLength || resource.format !== info.format) {
            const data = packAllIndexData(geometryData, info);
            const buffer = uploadNewBuffer(
                this.owner,
                `Index:${geometryData.id}:${info.key}`,
                WebGPUBufferUsage.INDEX | WebGPUBufferUsage.COPY_DST,
                data
            );
            if (resource) this.destroyCachedBuffer(resource);
            this.ownedBuffers.add(buffer);
            resource = {
                buffer,
                format: info.format,
                count: geometryData.count,
                revision,
                byteLength: data.byteLength,
                structureKey
            };
            variants.set(info.key, resource);
        } else if (resource.revision !== revision || resource.structureKey !== structureKey) {
            const ranges =
                resource.structureKey === structureKey
                    ? updatedIndexByteRanges(geometryData, info, resource.revision)
                    : null;
            if (ranges === null) {
                writeBufferData(this.owner, resource.buffer, packAllIndexData(geometryData, info));
            } else {
                const patches = ranges.map(range => ({
                    bufferOffset: range.start,
                    data: packIndexByteRange(geometryData, info, range)
                }));
                for (const patch of patches) {
                    writeBufferData(this.owner, resource.buffer, patch.data, patch.bufferOffset);
                }
            }
            resource.revision = revision;
            resource.structureKey = structureKey;
            resource.count = geometryData.count;
        }
        this.markSubmissionUse(resource);
        this.touchVariant(variants, info.key, resource);
        this.evictVariantOverflow(variants, this.cacheLimits.indexVariantsPerOwner);
        return resource;
    }

    /** Pack all per-instance inputs into one GPU vertex-buffer slot. */
    getInterleavedInstanceBuffer(
        owner: WebGPUBufferOwner,
        instanceCount: number,
        sources: readonly WebGPUInstanceBufferSource[]
    ): WebGPUVertexBufferBinding {
        const count = validateCount(instanceCount, 'Instance');
        const prepared = prepareVertexLayout(
            sources.map(source => source.input),
            'instance',
            this.device.limits
        );
        const data = packInstanceSources(sources, prepared, count);
        let variants = this.instanceBuffers.get(owner);
        if (!variants) {
            variants = new Map();
            this.instanceBuffers.set(owner, variants);
        }
        let resource = variants.get(prepared.signature);
        if (
            resource?.byteLength !== data.byteLength &&
            resource !== undefined &&
            this.submissionActive &&
            this.submissionUsedBuffers.has(resource.buffer)
        ) {
            throw new Error(
                'Instance data cannot change after its first use in one WebGPU submission'
            );
        }
        if (resource?.byteLength !== data.byteLength) {
            const buffer = uploadNewBuffer(
                this.owner,
                `InstanceBundle:${typeof owner === 'string' ? owner : String(this.objectId(owner))}`,
                WebGPUBufferUsage.VERTEX | WebGPUBufferUsage.COPY_DST,
                data
            );
            if (resource) this.destroyCachedBuffer(resource);
            this.ownedBuffers.add(buffer);
            resource = {
                buffer,
                layout: prepared.layout,
                count,
                byteLength: data.byteLength,
                data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice()
            };
            variants.set(prepared.signature, resource);
        } else {
            const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
            let start = 0;
            while (start < bytes.byteLength && resource.data[start] === bytes[start]) start++;
            if (start < bytes.byteLength) {
                if (this.submissionActive && this.submissionUsedBuffers.has(resource.buffer)) {
                    throw new Error(
                        'Instance data cannot change after its first use in one WebGPU submission'
                    );
                }
                let end = bytes.byteLength;
                while (end > start && resource.data[end - 1] === bytes[end - 1]) end--;
                const alignedStart = Math.floor(start / 4) * 4;
                const alignedEnd = Math.ceil(end / 4) * 4;
                const changedBytes = bytes.subarray(alignedStart, alignedEnd);
                if (this.owner instanceof WebGPUDevice) {
                    this.owner.writeNativeBuffer(resource.buffer, alignedStart, changedBytes);
                } else {
                    this.owner.queue.writeBuffer(resource.buffer, alignedStart, changedBytes);
                }
                resource.data.set(bytes);
            }
            resource.count = count;
        }
        this.markSubmissionUse(resource);
        this.touchVariant(variants, prepared.signature, resource);
        this.evictVariantOverflow(variants, this.cacheLimits.instanceVariantsPerOwner);
        return resource;
    }

    /** Release every vertex/instance bundle owned by a mesh, geometry or explicit key. */
    releaseOwner(owner: WebGPUBufferOwner): void {
        const vertexVariants = this.vertexBuffers.get(owner);
        if (vertexVariants) {
            for (const resource of vertexVariants.values()) {
                this.destroyCachedBuffer(resource);
            }
            this.vertexBuffers.delete(owner);
        }
        const instanceVariants = this.instanceBuffers.get(owner);
        if (instanceVariants) {
            for (const resource of instanceVariants.values()) {
                this.destroyCachedBuffer(resource);
            }
            this.instanceBuffers.delete(owner);
        }
        if (typeof owner === 'object') {
            const indexVariants = this.indexBuffers.get(owner as GeometryData);
            if (indexVariants) {
                for (const resource of indexVariants.values()) {
                    this.destroyCachedBuffer(resource);
                }
                this.indexBuffers.delete(owner as GeometryData);
            }
        }
    }

    destroy(): void {
        this.submissionActive = false;
        this.submissionUsedBuffers = new WeakSet();
        this.deferredBufferDestructions.clear();
        for (const buffer of this.ownedBuffers) buffer.destroy();
        this.ownedBuffers.clear();
        this.instanceBuffers.clear();
        this.vertexBuffers.clear();
        this.indexBuffers = new WeakMap();
    }
}
