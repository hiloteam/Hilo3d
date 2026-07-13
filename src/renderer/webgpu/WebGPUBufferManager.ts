import type GeometryData from '../../geometry/GeometryData';
import type { WebGPUVertexInput } from '../../shader/GlslToWgsl';
import type { TypedArray } from '../types';
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
    revisionKey: string;
    byteLength: number;
}

interface CachedIndexBuffer extends WebGPUIndexBufferBinding {
    revision: number;
    byteLength: number;
}

interface CachedInstanceBuffer extends WebGPUVertexBufferBinding {
    byteLength: number;
}

interface GeometryRevisionState {
    fingerprint: string;
    revision: number;
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

function packedGeometryData(
    geometryData: GeometryData,
    shape: InputShape
): Float32Array | Int32Array | Uint32Array {
    const components = shape.columns * shape.rows;
    if (geometryData.size !== components) {
        throw new RangeError(
            `GeometryData has ${String(geometryData.size)} components, but shader input requires ${String(components)}`
        );
    }
    if (shape.scalar !== 'float' && geometryData.normalized) {
        throw new TypeError('Normalized GeometryData cannot feed an integer WebGPU shader input');
    }
    const count = validateCount(geometryData.count, 'GeometryData');
    const result =
        shape.scalar === 'float'
            ? new Float32Array(count * components)
            : shape.scalar === 'sint'
              ? new Int32Array(count * components)
              : new Uint32Array(count * components);
    const source = geometryData.data;
    for (let vertex = 0; vertex < count; vertex++) {
        const sourceOffset = geometryData.getOffset(vertex);
        for (let component = 0; component < components; component++) {
            const raw = source[sourceOffset + component];
            if (raw === undefined) {
                throw new RangeError('GeometryData vertex points outside its backing array');
            }
            const value =
                shape.scalar === 'float'
                    ? geometryData.normalized
                        ? normalizedComponent(source, raw)
                        : raw
                    : validateIntegerComponent(raw, shape.scalar);
            result[vertex * components + component] = value;
        }
    }
    return result;
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

function packVertexSources(
    sources: readonly WebGPUVertexBufferSource[],
    prepared: PreparedVertexLayout,
    count: number
): Uint8Array {
    const arrayStride = prepared.layout.arrayStride;
    const output = new Uint8Array(packedByteLength(count, arrayStride));
    for (const item of prepared.inputs) {
        const source = sources[item.sourceIndex];
        if (!source) throw new RangeError('Missing packed WebGPU vertex source');
        const data = packedGeometryData(source.geometryData, item.shape);
        const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        for (let vertex = 0; vertex < count; vertex++) {
            const sourceOffset = vertex * item.byteLength;
            output.set(
                bytes.subarray(sourceOffset, sourceOffset + item.byteLength),
                vertex * arrayStride + item.byteOffset
            );
        }
    }
    return output;
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
    device: GPUDevice,
    label: string,
    usage: GPUBufferUsageFlags,
    data: ArrayBufferView
): GPUBuffer {
    const allocationSize = alignTo4(data.byteLength);
    if (allocationSize > device.limits.maxBufferSize) {
        throw new RangeError(
            `WebGPU buffer allocation ${String(allocationSize)} exceeds maxBufferSize ${String(device.limits.maxBufferSize)}`
        );
    }
    const buffer = device.createBuffer({
        label,
        size: allocationSize,
        usage,
        mappedAtCreation: true
    });
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
function writeBufferData(device: GPUDevice, buffer: GPUBuffer, data: ArrayBufferView): void {
    const byteLength = alignTo4(data.byteLength);
    if (byteLength === data.byteLength) {
        device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
        return;
    }
    const padded = new Uint8Array(byteLength);
    padded.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    device.queue.writeBuffer(buffer, 0, padded.buffer, 0, padded.byteLength);
}

function packedIndexData(
    geometryData: GeometryData,
    primitiveRestart: boolean
): {
    readonly data: Uint16Array | Uint32Array;
    readonly format: GPUIndexFormat;
    readonly key: string;
} {
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
        return { data: geometryData.data, format: 'uint32', key: 'uint32' };
    }
    if (geometryData.data instanceof Uint16Array) {
        return { data: geometryData.data, format: 'uint16', key: 'uint16' };
    }
    if (geometryData.data instanceof Uint8Array || geometryData.data instanceof Uint8ClampedArray) {
        const remapRestart = primitiveRestart;
        return {
            data: Uint16Array.from(geometryData.data, value =>
                remapRestart && value === 0xff ? 0xffff : value
            ),
            format: 'uint16',
            key: remapRestart ? 'uint8-restart' : 'uint8'
        };
    }
    throw new TypeError('WebGPU index data must be an unsigned 8-, 16-, or 32-bit array');
}

/** Per-device packed vertex, instance and index allocation cache. */
export class WebGPUBufferManager {
    private readonly device: GPUDevice;
    private readonly vertexBuffers = new OwnerCache<Map<string, CachedVertexBuffer>>();
    /** Renderer frame snapshots call releaseOwner when an index GeometryData identity is replaced. */
    private indexBuffers = new WeakMap<GeometryData, Map<string, CachedIndexBuffer>>();
    private readonly instanceBuffers = new OwnerCache<Map<string, CachedInstanceBuffer>>();
    private geometryStates = new WeakMap<GeometryData, GeometryRevisionState>();
    private readonly objectIds = new WeakMap<object, number>();
    private nextObjectId = 1;
    private readonly ownedBuffers = new Set<GPUBuffer>();
    readonly cacheLimits: Readonly<WebGPUBufferCacheLimits>;

    constructor(device: GPUDevice, cacheLimits: Partial<WebGPUBufferCacheLimits> = {}) {
        this.device = device;
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

    private destroyCachedBuffer(resource: { readonly buffer: GPUBuffer }): void {
        resource.buffer.destroy();
        this.ownedBuffers.delete(resource.buffer);
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

    private geometryRevision(geometryData: GeometryData): number {
        const fingerprint = [
            geometryData.revision,
            geometryData.size,
            geometryData.normalized ? 1 : 0,
            geometryData.stride,
            geometryData.offset,
            geometryData.type,
            geometryData.data.byteLength,
            geometryData.count
        ].join(':');
        let state = this.geometryStates.get(geometryData);
        if (!state) {
            state = { fingerprint, revision: 1 };
            this.geometryStates.set(geometryData, state);
        } else if (state.fingerprint !== fingerprint) {
            state.fingerprint = fingerprint;
            state.revision++;
        }
        return state.revision;
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
        const orderedSources = prepared.inputs.map(item => sources[item.sourceIndex]);
        const first = orderedSources[0];
        if (!first) throw new RangeError('A WebGPU vertex bundle requires a source');
        const count = validateCount(first.geometryData.count, 'Vertex bundle');
        for (const source of orderedSources) {
            if (!source) throw new RangeError('Missing WebGPU vertex source');
            if (validateCount(source.geometryData.count, 'Vertex bundle') !== count) {
                throw new RangeError(
                    'Every source in a WebGPU vertex bundle must have equal count'
                );
            }
        }
        const cacheKey = orderedSources
            .map(source => {
                if (!source) throw new RangeError('Missing WebGPU vertex source');
                return String(this.objectId(source.geometryData));
            })
            .join(':');
        const revisionKey = orderedSources
            .map(source => {
                if (!source) throw new RangeError('Missing WebGPU vertex source');
                return String(this.geometryRevision(source.geometryData));
            })
            .join(':');
        let variants = this.vertexBuffers.get(owner);
        if (!variants) {
            variants = new Map();
            this.vertexBuffers.set(owner, variants);
        }
        const variantKey = `${prepared.signature}:${cacheKey}`;
        let resource = variants.get(variantKey);
        if (resource?.revisionKey !== revisionKey) {
            const data = packVertexSources(sources, prepared, count);
            if (resource?.byteLength !== data.byteLength) {
                const buffer = uploadNewBuffer(
                    this.device,
                    `VertexBundle:${variantKey}`,
                    WebGPUBufferUsage.VERTEX | WebGPUBufferUsage.COPY_DST,
                    data
                );
                resource?.buffer.destroy();
                if (resource) this.ownedBuffers.delete(resource.buffer);
                this.ownedBuffers.add(buffer);
                resource = {
                    buffer,
                    layout: prepared.layout,
                    count,
                    revisionKey,
                    byteLength: data.byteLength
                };
                variants.set(variantKey, resource);
            } else {
                this.device.queue.writeBuffer(
                    resource.buffer,
                    0,
                    data.buffer,
                    data.byteOffset,
                    data.byteLength
                );
                resource.revisionKey = revisionKey;
                resource.count = count;
            }
        }
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
        const packed = packedIndexData(geometryData, options.primitiveRestart ?? false);
        const revision = this.geometryRevision(geometryData);
        let variants = this.indexBuffers.get(geometryData);
        if (!variants) {
            variants = new Map();
            this.indexBuffers.set(geometryData, variants);
        }
        let resource = variants.get(packed.key);
        if (resource?.revision !== revision) {
            if (
                resource?.byteLength !== packed.data.byteLength ||
                resource.format !== packed.format
            ) {
                const buffer = uploadNewBuffer(
                    this.device,
                    `Index:${geometryData.id}:${packed.key}`,
                    WebGPUBufferUsage.INDEX | WebGPUBufferUsage.COPY_DST,
                    packed.data
                );
                resource?.buffer.destroy();
                if (resource) this.ownedBuffers.delete(resource.buffer);
                this.ownedBuffers.add(buffer);
                resource = {
                    buffer,
                    format: packed.format,
                    count: geometryData.count,
                    revision,
                    byteLength: packed.data.byteLength
                };
                variants.set(packed.key, resource);
            } else {
                writeBufferData(this.device, resource.buffer, packed.data);
                resource.revision = revision;
                resource.count = geometryData.count;
            }
        }
        this.touchVariant(variants, packed.key, resource);
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
        if (resource?.byteLength !== data.byteLength) {
            const buffer = uploadNewBuffer(
                this.device,
                `InstanceBundle:${typeof owner === 'string' ? owner : String(this.objectId(owner))}`,
                WebGPUBufferUsage.VERTEX | WebGPUBufferUsage.COPY_DST,
                data
            );
            resource?.buffer.destroy();
            if (resource) this.ownedBuffers.delete(resource.buffer);
            this.ownedBuffers.add(buffer);
            resource = {
                buffer,
                layout: prepared.layout,
                count,
                byteLength: data.byteLength
            };
            variants.set(prepared.signature, resource);
        } else {
            this.device.queue.writeBuffer(
                resource.buffer,
                0,
                data.buffer,
                data.byteOffset,
                data.byteLength
            );
            resource.count = count;
        }
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
        for (const buffer of this.ownedBuffers) buffer.destroy();
        this.ownedBuffers.clear();
        this.instanceBuffers.clear();
        this.vertexBuffers.clear();
        this.indexBuffers = new WeakMap();
        this.geometryStates = new WeakMap();
    }
}
