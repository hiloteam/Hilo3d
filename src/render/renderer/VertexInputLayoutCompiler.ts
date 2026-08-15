import type Mesh from '../../core/Mesh';
import GeometryData, { type GeometryComponentSize } from '../../geometry/GeometryData';
import type Material from '../../material/MaterialInstance';
import type { MaterialBinding, ProgramBindingInfo } from '../../material/MaterialInstance';
import {
    BYTE,
    FLOAT,
    INT,
    SHORT,
    UNSIGNED_BYTE,
    UNSIGNED_INT,
    UNSIGNED_SHORT
} from '../../constants/webgl';
import type {
    RHILimits,
    RHIShaderVertexInputReflection,
    RHIVertexAttribute,
    RHIVertexBufferLayout,
    RHIVertexFormat
} from '../rhi/core';

/** Reflection accepted from either a compiled shader artifact or its richer compiler metadata. */
export interface VertexInputReflection extends RHIShaderVertexInputReflection {
    /** GLSL scalar/vector type retained by the shared shader compiler metadata. */
    readonly type?: string;
    /** Matrices occupy one consecutive shader location per column. */
    readonly locationCount?: number;
}

/** The portable device limits that can affect a vertex-input plan. */
export interface VertexInputLayoutCapabilities {
    readonly limits: Pick<
        RHILimits,
        'maxVertexAttributes' | 'maxVertexBuffers' | 'maxVertexBufferArrayStride'
    >;
}

/** One unique CPU stream and the pipeline layout bound at its exact RHI vertex-buffer slot. */
export interface VertexInputStreamPlan {
    /** Canonical source whose complete byte range is bound to this slot. */
    readonly source: GeometryData;
    /** Every public GeometryData wrapper that aliases the canonical byte range. */
    readonly sources: readonly GeometryData[];
    readonly slot: number;
    readonly vertexCount: number;
    readonly stepMode: 'vertex' | 'instance';
    readonly layout: Readonly<RHIVertexBufferLayout>;
}

/** Immutable, location-sorted input plan shared by WebGL2 and WebGPU pipelines. */
export interface VertexInputLayoutPlan {
    readonly streams: readonly Readonly<VertexInputStreamPlan>[];
    /** Contiguous pipeline layouts; `vertexBuffers[stream.slot] === stream.layout`. */
    readonly vertexBuffers: readonly Readonly<RHIVertexBufferLayout>[];
    readonly vertexCount: number;
    /** Maximum instances addressable by every per-instance stream, or one when none exist. */
    readonly instanceCapacity: number;
}

interface ResolvedInput {
    readonly input: VertexInputReflection;
    readonly name: string;
    readonly location: number;
    readonly locationCount: number;
    readonly binding: MaterialBinding | undefined;
    readonly source: GeometryData;
    readonly format: RHIVertexFormat;
    readonly columns: number;
    readonly rows: number;
    readonly arrayStride: number;
    readonly vertexCount: number;
    readonly stepMode: 'vertex' | 'instance';
}

interface InputSnapshot {
    readonly input: VertexInputReflection;
    readonly name: string;
    readonly location: number;
    readonly locationCount: number;
    readonly binding: MaterialBinding | undefined;
    readonly source: GeometryData;
    readonly dataConstructor: object;
    readonly byteLength: number;
    readonly size: number;
    readonly type: number;
    readonly normalized: boolean;
    readonly stride: number;
    readonly offset: number;
    readonly bufferViewId: string;
    readonly stepMode: 'vertex' | 'instance';
}

interface CachedPlan {
    readonly inputs: readonly VertexInputReflection[];
    readonly material: Material;
    readonly programInfo: ProgramBindingInfo;
    readonly geometry: Mesh['geometry'];
    readonly attributes: Material['attributes'];
    readonly maxVertexAttributes: number;
    readonly maxVertexBuffers: number;
    readonly maxVertexBufferArrayStride: number;
    readonly snapshots: readonly InputSnapshot[];
    readonly plan: Readonly<VertexInputLayoutPlan>;
}

interface MutableStream {
    readonly source: GeometryData;
    readonly sources: GeometryData[];
    readonly vertexCount: number;
    readonly arrayStride: number;
    readonly stepMode: 'vertex' | 'instance';
    readonly attributes: RHIVertexAttribute[];
}

type GenericAttributeCache = WeakMap<object, Map<string, GeometryData>>;

const EMPTY_PROGRAM_INFO: ProgramBindingInfo = Object.freeze({});

function requireLimit(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name} must be a non-negative safe integer`);
    }
}

function inputName(input: VertexInputReflection, index: number): string {
    if (typeof input.name !== 'string' || input.name.length === 0) {
        throw new TypeError(`Vertex input ${String(index)} must have a non-empty reflection name`);
    }
    return input.name;
}

interface MatrixShape {
    readonly columns: number;
    readonly rows: number;
}

const MAT2_SHAPE: MatrixShape = Object.freeze({ columns: 2, rows: 2 });
const MAT2X3_SHAPE: MatrixShape = Object.freeze({ columns: 2, rows: 3 });
const MAT2X4_SHAPE: MatrixShape = Object.freeze({ columns: 2, rows: 4 });
const MAT3X2_SHAPE: MatrixShape = Object.freeze({ columns: 3, rows: 2 });
const MAT3_SHAPE: MatrixShape = Object.freeze({ columns: 3, rows: 3 });
const MAT3X4_SHAPE: MatrixShape = Object.freeze({ columns: 3, rows: 4 });
const MAT4X2_SHAPE: MatrixShape = Object.freeze({ columns: 4, rows: 2 });
const MAT4X3_SHAPE: MatrixShape = Object.freeze({ columns: 4, rows: 3 });
const MAT4_SHAPE: MatrixShape = Object.freeze({ columns: 4, rows: 4 });

function reflectedMatrixShape(type: string | undefined): MatrixShape | null {
    switch (type) {
        case 'mat2':
        case 'mat2x2':
            return MAT2_SHAPE;
        case 'mat2x3':
            return MAT2X3_SHAPE;
        case 'mat2x4':
            return MAT2X4_SHAPE;
        case 'mat3x2':
            return MAT3X2_SHAPE;
        case 'mat3':
        case 'mat3x3':
            return MAT3_SHAPE;
        case 'mat3x4':
            return MAT3X4_SHAPE;
        case 'mat4x2':
            return MAT4X2_SHAPE;
        case 'mat4x3':
            return MAT4X3_SHAPE;
        case 'mat4':
        case 'mat4x4':
            return MAT4_SHAPE;
        default:
            return null;
    }
}

function inputLocationCount(input: VertexInputReflection, name: string): number {
    const matrix = reflectedMatrixShape(input.type);
    const requiredLocationCount = matrix?.columns ?? 1;
    const locationCount = input.locationCount ?? requiredLocationCount;
    if (!Number.isSafeInteger(locationCount) || locationCount <= 0) {
        throw new RangeError(`Vertex input ${name} locationCount must be a positive safe integer`);
    }
    if (locationCount !== requiredLocationCount) {
        throw new TypeError(
            `Vertex input ${name} type ${input.type ?? 'unknown'} requires ${String(requiredLocationCount)} shader locations, received ${String(locationCount)}`
        );
    }
    return locationCount;
}

function validateInputs(
    inputs: readonly VertexInputReflection[],
    capabilities: VertexInputLayoutCapabilities
): void {
    const limits = capabilities.limits;
    requireLimit(limits.maxVertexAttributes, 'maxVertexAttributes');
    requireLimit(limits.maxVertexBuffers, 'maxVertexBuffers');
    requireLimit(limits.maxVertexBufferArrayStride, 'maxVertexBufferArrayStride');
    if (inputs.length === 0) {
        throw new TypeError('A vertex-input plan requires at least one named shader input');
    }
    let attributeCount = 0;
    for (let index = 0; index < inputs.length; index += 1) {
        const input = inputs[index];
        if (input === undefined) throw new TypeError(`Vertex input ${String(index)} is missing`);
        const name = inputName(input, index);
        const locationCount = inputLocationCount(input, name);
        if (!Number.isSafeInteger(input.location) || input.location < 0) {
            throw new RangeError(
                `Vertex input ${name} location must be a non-negative safe integer`
            );
        }
        const locationEnd = input.location + locationCount;
        if (!Number.isSafeInteger(locationEnd)) {
            throw new RangeError(`Vertex input ${name} location range exceeds safe integers`);
        }
        if (locationEnd > limits.maxVertexAttributes) {
            throw new RangeError(
                `Vertex input ${name} occupies locations [${String(input.location)}, ${String(locationEnd)}), exceeding maxVertexAttributes ${String(limits.maxVertexAttributes)}`
            );
        }
        attributeCount += locationCount;
        for (let previousIndex = 0; previousIndex < index; previousIndex += 1) {
            const previous = inputs[previousIndex];
            if (previous === undefined) continue;
            if (previous.name === name) {
                throw new TypeError(`Vertex input name ${name} is declared more than once`);
            }
            const previousName = inputName(previous, previousIndex);
            const previousCount = inputLocationCount(previous, previousName);
            const previousEnd = previous.location + previousCount;
            if (input.location < previousEnd && previous.location < locationEnd) {
                throw new TypeError(
                    `Vertex input ${name} overlaps ${previousName} at shader location ${String(Math.max(input.location, previous.location))}`
                );
            }
        }
    }
    if (attributeCount > limits.maxVertexAttributes) {
        throw new RangeError(
            `Shader declares ${String(attributeCount)} physical vertex attributes, exceeding maxVertexAttributes ${String(limits.maxVertexAttributes)}`
        );
    }
}

function float32Format(size: number): RHIVertexFormat {
    switch (size) {
        case 1:
            return 'float32';
        case 2:
            return 'float32x2';
        case 3:
            return 'float32x3';
        case 4:
            return 'float32x4';
        default:
            throw new TypeError(
                `Float32 vertex attributes support only scalar through vec4 values; received ${String(size)} components`
            );
    }
}

function packedIntegerFormat(source: GeometryData, signed: boolean, bits: 8 | 16): RHIVertexFormat {
    if (source.size !== 2 && source.size !== 4) {
        throw new TypeError(
            `${signed ? 'Signed' : 'Unsigned'} ${String(bits)}-bit vertex attributes support only x2 or x4 values; received ${String(source.size)} components`
        );
    }
    if (bits === 8) {
        if (signed) {
            if (source.normalized) return source.size === 2 ? 'snorm8x2' : 'snorm8x4';
            return source.size === 2 ? 'sint8x2' : 'sint8x4';
        }
        if (source.normalized) return source.size === 2 ? 'unorm8x2' : 'unorm8x4';
        return source.size === 2 ? 'uint8x2' : 'uint8x4';
    }
    if (signed) {
        if (source.normalized) return source.size === 2 ? 'snorm16x2' : 'snorm16x4';
        return source.size === 2 ? 'sint16x2' : 'sint16x4';
    }
    if (source.normalized) return source.size === 2 ? 'unorm16x2' : 'unorm16x4';
    return source.size === 2 ? 'uint16x2' : 'uint16x4';
}

function integer32Format(source: GeometryData, signed: boolean): RHIVertexFormat {
    if (source.normalized) {
        throw new TypeError('Normalized 32-bit integer vertex attributes are not supported');
    }
    if (source.size < 1 || source.size > 4) {
        throw new TypeError(
            `32-bit integer vertex attributes support only scalar through vec4 values; received ${String(source.size)} components`
        );
    }
    if (signed) {
        if (source.size === 1) return 'sint32';
        if (source.size === 2) return 'sint32x2';
        if (source.size === 3) return 'sint32x3';
        return 'sint32x4';
    }
    if (source.size === 1) return 'uint32';
    if (source.size === 2) return 'uint32x2';
    if (source.size === 3) return 'uint32x3';
    return 'uint32x4';
}

function vertexFormat(source: GeometryData, name: string): RHIVertexFormat {
    const data = source.data;
    if (data instanceof Float32Array) {
        if (source.type !== FLOAT) {
            throw new TypeError(
                `Vertex input ${name} Float32 storage must use the FLOAT component type`
            );
        }
        if (source.normalized) {
            throw new TypeError(`Vertex input ${name} Float32 storage must not be normalized`);
        }
        return float32Format(source.size);
    }
    if (data instanceof Int8Array) {
        if (source.type !== BYTE) {
            throw new TypeError(
                `Vertex input ${name} Int8 storage must use the BYTE component type`
            );
        }
        return packedIntegerFormat(source, true, 8);
    }
    if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) {
        if (source.type !== UNSIGNED_BYTE) {
            throw new TypeError(
                `Vertex input ${name} Uint8 storage must use the UNSIGNED_BYTE component type`
            );
        }
        return packedIntegerFormat(source, false, 8);
    }
    if (data instanceof Int16Array) {
        if (source.type !== SHORT) {
            throw new TypeError(
                `Vertex input ${name} Int16 storage must use the SHORT component type`
            );
        }
        return packedIntegerFormat(source, true, 16);
    }
    if (data instanceof Uint16Array) {
        if (source.type !== UNSIGNED_SHORT) {
            throw new TypeError(
                `Vertex input ${name} Uint16 storage must use the UNSIGNED_SHORT component type`
            );
        }
        return packedIntegerFormat(source, false, 16);
    }
    if (data instanceof Int32Array) {
        if (source.type !== INT) {
            throw new TypeError(
                `Vertex input ${name} Int32 storage must use the INT component type`
            );
        }
        return integer32Format(source, true);
    }
    if (data instanceof Uint32Array) {
        if (source.type !== UNSIGNED_INT) {
            throw new TypeError(
                `Vertex input ${name} Uint32 storage must use the UNSIGNED_INT component type`
            );
        }
        return integer32Format(source, false);
    }
    throw new TypeError(
        `Vertex input ${name} uses unsupported storage; Float64 and non-numeric views are not portable vertex formats`
    );
}

function matrixVertexShape(
    source: GeometryData,
    input: VertexInputReflection,
    name: string
): MatrixShape | null {
    const matrix = reflectedMatrixShape(input.type);
    if (matrix !== null) {
        if (matrix.columns !== matrix.rows) {
            throw new TypeError(
                `Vertex input ${name} type ${input.type ?? 'unknown'} is rectangular; the public GeometryData ABI supports only mat2, mat3, and mat4 vertex values`
            );
        }
        const components = matrix.columns * matrix.rows;
        if (source.size !== components) {
            throw new TypeError(
                `Vertex input ${name} type ${input.type ?? 'unknown'} requires GeometryData size ${String(components)}, received ${String(source.size)}`
            );
        }
        if (!(source.data instanceof Float32Array) || source.type !== FLOAT) {
            throw new TypeError(`Vertex input ${name} matrices require Float32 storage`);
        }
        if (source.normalized) {
            throw new TypeError(`Vertex input ${name} matrix storage must not be normalized`);
        }
        return matrix;
    }
    if (source.size === 9 || source.size === 16) {
        throw new TypeError(
            `Vertex input ${name} uses matrix GeometryData size ${String(source.size)} without matching matrix reflection metadata`
        );
    }
    vertexFormat(source, name);
    return null;
}

function validateVertexMetrics(
    source: GeometryData,
    name: string,
    maxVertexBufferArrayStride: number,
    attributeByteLength: number
): number {
    const offset = source.offset;
    if (!Number.isSafeInteger(offset) || offset < 0) {
        throw new RangeError(
            `Vertex input ${name} byte offset must be a non-negative safe integer`
        );
    }
    const formatAlignment = Math.min(4, attributeByteLength);
    if (offset % formatAlignment !== 0) {
        throw new RangeError(
            `Vertex input ${name} byte offset must be aligned to ${String(formatAlignment)} bytes`
        );
    }
    if (source.stride === 0 && offset !== 0) {
        throw new RangeError(
            `Vertex input ${name} cannot use a non-zero offset with a tightly packed stream`
        );
    }
    const arrayStride = source.stride === 0 ? attributeByteLength : source.stride;
    if (!Number.isSafeInteger(arrayStride) || arrayStride <= 0) {
        throw new RangeError(`Vertex input ${name} array stride must be a positive safe integer`);
    }
    if (arrayStride % 4 !== 0) {
        throw new RangeError(
            `Vertex input ${name} array stride must be a multiple of 4 for portable WebGPU/WebGL2 input`
        );
    }
    if (arrayStride > maxVertexBufferArrayStride) {
        throw new RangeError(
            `Vertex input ${name} array stride ${String(arrayStride)} exceeds maxVertexBufferArrayStride ${String(maxVertexBufferArrayStride)}`
        );
    }
    if (offset + attributeByteLength > arrayStride) {
        throw new RangeError(`Vertex input ${name} exceeds its vertex array stride`);
    }
    const byteLength = source.data.byteLength;
    if (byteLength === 0 || byteLength % arrayStride !== 0) {
        throw new RangeError(
            `Vertex input ${name} data must contain a whole number of complete vertices`
        );
    }
    const vertexCount = byteLength / arrayStride;
    if (!Number.isSafeInteger(vertexCount) || vertexCount <= 0) {
        throw new RangeError(`Vertex input ${name} vertex count must be a positive safe integer`);
    }
    return vertexCount;
}

function genericVertexAttributeShape(
    type: string,
    name: string
): {
    readonly size: GeometryComponentSize;
    readonly storage: 'float' | 'sint' | 'uint';
    readonly columns: number;
    readonly rows: number;
} {
    const matrix = reflectedMatrixShape(type);
    if (matrix !== null) {
        if (matrix.columns !== matrix.rows) {
            throw new TypeError(
                `Vertex input ${name} type ${type} cannot use a generic default because rectangular matrices are outside the public GeometryData ABI`
            );
        }
        return {
            size: (matrix.columns * matrix.rows) as GeometryComponentSize,
            storage: 'float',
            columns: matrix.columns,
            rows: matrix.rows
        };
    }
    if (type === 'float') return { size: 1, storage: 'float', columns: 1, rows: 1 };
    if (type === 'int') return { size: 1, storage: 'sint', columns: 1, rows: 1 };
    if (type === 'uint') return { size: 1, storage: 'uint', columns: 1, rows: 1 };
    const vector = /^(i|u)?vec([2-4])$/u.exec(type);
    const size = vector?.[2] === undefined ? Number.NaN : Number(vector[2]);
    if (size !== 2 && size !== 3 && size !== 4) {
        throw new TypeError(
            `Vertex input ${name} type ${type} cannot use a generic default attribute`
        );
    }
    return {
        size,
        storage: vector?.[1] === 'i' ? 'sint' : vector?.[1] === 'u' ? 'uint' : 'float',
        columns: 1,
        rows: size
    };
}

function genericVertexAttribute(
    input: VertexInputReflection,
    name: string,
    mesh: Mesh,
    cache: GenericAttributeCache
): GeometryData {
    const geometry = mesh.geometry;
    const vertices = geometry?.vertices;
    if (geometry === null || vertices === null || vertices === undefined) {
        throw new Error(
            `Cannot provide the generic default for vertex input ${name} without positive geometry vertex count`
        );
    }
    const vertexCount = vertices.count;
    if (!Number.isSafeInteger(vertexCount) || vertexCount <= 0) {
        throw new Error(
            `Cannot provide the generic default for vertex input ${name} without positive geometry vertex count`
        );
    }
    const key = input.type;
    if (key === undefined) {
        throw new TypeError(
            `Vertex input ${name} cannot use a generic default without reflected type metadata`
        );
    }
    const shape = genericVertexAttributeShape(key, name);
    let attributes = cache.get(geometry);
    if (attributes === undefined) {
        attributes = new Map();
        cache.set(geometry, attributes);
    }
    const cached = attributes.get(key);
    if (cached?.count === vertexCount) return cached;

    const elementCount = vertexCount * shape.size;
    const values =
        shape.storage === 'sint'
            ? new Int32Array(elementCount)
            : shape.storage === 'uint'
              ? new Uint32Array(elementCount)
              : new Float32Array(elementCount);
    // Match WebGL's disabled-array generic value (0, 0, 0, 1) at every physical location.
    if (shape.rows === 4) {
        for (let vertex = 0; vertex < vertexCount; vertex += 1) {
            const vertexOffset = vertex * shape.size;
            for (let column = 0; column < shape.columns; column += 1) {
                values[vertexOffset + column * shape.rows + 3] = 1;
            }
        }
    }
    if (cached !== undefined) {
        cached.data = values;
        return cached;
    }
    const attribute = new GeometryData(values, shape.size);
    attributes.set(key, attribute);
    return attribute;
}

function resolveInputSource(
    input: VertexInputReflection,
    name: string,
    mesh: Mesh,
    material: Material,
    programInfo: ProgramBindingInfo,
    genericAttributes: GenericAttributeCache
): GeometryData {
    const value = material.getAttributeData(name, mesh, programInfo);
    if (value instanceof GeometryData) return value;
    if (value === undefined || value === null) {
        return genericVertexAttribute(input, name, mesh, genericAttributes);
    }
    throw new TypeError(`Vertex input ${name} must resolve to GeometryData`);
}

function resolvedInput(
    input: VertexInputReflection,
    inputIndex: number,
    mesh: Mesh,
    material: Material,
    programInfo: ProgramBindingInfo,
    maxVertexBufferArrayStride: number,
    genericAttributes: GenericAttributeCache
): ResolvedInput {
    const name = inputName(input, inputIndex);
    const locationCount = inputLocationCount(input, name);
    const value = resolveInputSource(input, name, mesh, material, programInfo, genericAttributes);
    const matrix = matrixVertexShape(value, input, name);
    const components = matrix === null ? value.size : matrix.columns * matrix.rows;
    const attributeByteLength = components * value.data.BYTES_PER_ELEMENT;
    const vertexCount = validateVertexMetrics(
        value,
        name,
        maxVertexBufferArrayStride,
        attributeByteLength
    );
    return {
        input,
        name,
        location: input.location,
        locationCount,
        binding: material.attributes[name],
        source: value,
        format: matrix === null ? vertexFormat(value, name) : float32Format(matrix.rows),
        columns: matrix?.columns ?? 1,
        rows: matrix?.rows ?? value.size,
        arrayStride: value.stride === 0 ? value.size * value.data.BYTES_PER_ELEMENT : value.stride,
        vertexCount,
        stepMode: value.stepMode
    };
}

function snapshot(input: ResolvedInput): InputSnapshot {
    return {
        input: input.input,
        name: input.name,
        location: input.location,
        locationCount: input.locationCount,
        binding: input.binding,
        source: input.source,
        dataConstructor: input.source.data.constructor,
        byteLength: input.source.data.byteLength,
        size: input.source.size,
        type: input.source.type,
        normalized: input.source.normalized,
        stride: input.source.stride,
        offset: input.source.offset,
        bufferViewId: input.source.bufferViewId,
        stepMode: input.source.stepMode
    };
}

function snapshotMatches(
    cached: InputSnapshot,
    input: VertexInputReflection,
    inputIndex: number,
    mesh: Mesh,
    material: Material,
    programInfo: ProgramBindingInfo,
    maxVertexBufferArrayStride: number,
    genericAttributes: GenericAttributeCache
): boolean {
    const name = inputName(input, inputIndex);
    const locationCount = inputLocationCount(input, name);
    const value = resolveInputSource(input, name, mesh, material, programInfo, genericAttributes);
    const matrix = matrixVertexShape(value, input, name);
    const components = matrix === null ? value.size : matrix.columns * matrix.rows;
    validateVertexMetrics(
        value,
        name,
        maxVertexBufferArrayStride,
        components * value.data.BYTES_PER_ELEMENT
    );
    return (
        cached.input === input &&
        cached.name === name &&
        cached.location === input.location &&
        cached.locationCount === locationCount &&
        cached.binding === material.attributes[name] &&
        cached.source === value &&
        cached.dataConstructor === value.data.constructor &&
        cached.byteLength === value.data.byteLength &&
        cached.size === value.size &&
        cached.type === value.type &&
        cached.normalized === value.normalized &&
        cached.stride === value.stride &&
        cached.offset === value.offset &&
        cached.bufferViewId === value.bufferViewId &&
        cached.stepMode === value.stepMode
    );
}

function sharesExactByteRange(left: GeometryData, right: GeometryData): boolean {
    return (
        left.data === right.data ||
        (left.data.buffer === right.data.buffer &&
            left.data.byteOffset === right.data.byteOffset &&
            left.data.byteLength === right.data.byteLength)
    );
}

function requireCompatibleCanonicalStream(
    canonical: MutableStream,
    candidate: ResolvedInput
): boolean {
    if (canonical.source === candidate.source) return true;
    if (canonical.stepMode !== candidate.stepMode) return false;
    if (canonical.source.bufferViewId !== candidate.source.bufferViewId) return false;
    if (!sharesExactByteRange(canonical.source, candidate.source)) {
        throw new TypeError(
            `Vertex inputs sharing bufferViewId ${candidate.source.bufferViewId} must reference the exact same underlying byte range`
        );
    }
    if (canonical.arrayStride !== candidate.arrayStride) {
        throw new TypeError(
            `Vertex inputs sharing bufferViewId ${candidate.source.bufferViewId} must use the same effective array stride`
        );
    }
    if (canonical.vertexCount !== candidate.vertexCount) {
        throw new TypeError(
            `Vertex inputs sharing bufferViewId ${candidate.source.bufferViewId} must contain the same vertex count`
        );
    }
    return true;
}

function validateCachedCanonicalStreams(plan: Readonly<VertexInputLayoutPlan>): void {
    for (const stream of plan.streams) {
        if (stream.sources.length < 2) continue;
        for (const alias of stream.sources) {
            if (alias === stream.source) continue;
            if (alias.bufferViewId !== stream.source.bufferViewId) {
                throw new TypeError('Canonical vertex stream aliases must share one bufferViewId');
            }
            if (!sharesExactByteRange(stream.source, alias)) {
                throw new TypeError(
                    `Vertex inputs sharing bufferViewId ${alias.bufferViewId} must reference the exact same underlying byte range`
                );
            }
            const arrayStride =
                alias.stride === 0 ? alias.size * alias.data.BYTES_PER_ELEMENT : alias.stride;
            if (arrayStride !== stream.layout.arrayStride) {
                throw new TypeError(
                    `Vertex inputs sharing bufferViewId ${alias.bufferViewId} must use the same effective array stride`
                );
            }
            if (alias.data.byteLength / arrayStride !== stream.vertexCount) {
                throw new TypeError(
                    `Vertex inputs sharing bufferViewId ${alias.bufferViewId} must contain the same vertex count`
                );
            }
        }
    }
}

function buildPlan(
    inputs: readonly VertexInputReflection[],
    mesh: Mesh,
    material: Material,
    programInfo: ProgramBindingInfo,
    capabilities: VertexInputLayoutCapabilities,
    genericAttributes: GenericAttributeCache
): {
    readonly snapshots: readonly InputSnapshot[];
    readonly plan: Readonly<VertexInputLayoutPlan>;
} {
    const resolved = new Array<ResolvedInput>(inputs.length);
    const snapshots = new Array<InputSnapshot>(inputs.length);
    for (let index = 0; index < inputs.length; index += 1) {
        const input = inputs[index];
        if (input === undefined) throw new TypeError(`Vertex input ${String(index)} is missing`);
        const candidate = resolvedInput(
            input,
            index,
            mesh,
            material,
            programInfo,
            capabilities.limits.maxVertexBufferArrayStride,
            genericAttributes
        );
        resolved[index] = candidate;
        snapshots[index] = snapshot(candidate);
    }
    resolved.sort((left, right) => left.location - right.location);

    const mutableStreams: MutableStream[] = [];
    for (const candidate of resolved) {
        let stream: MutableStream | undefined;
        for (const existing of mutableStreams) {
            if (requireCompatibleCanonicalStream(existing, candidate)) {
                stream = existing;
                break;
            }
        }
        if (stream === undefined) {
            stream = {
                source: candidate.source,
                sources: [candidate.source],
                vertexCount: candidate.vertexCount,
                arrayStride: candidate.arrayStride,
                stepMode: candidate.stepMode,
                attributes: []
            };
            mutableStreams.push(stream);
        } else if (!stream.sources.includes(candidate.source)) {
            stream.sources.push(candidate.source);
        }
        const columnByteLength = candidate.rows * candidate.source.data.BYTES_PER_ELEMENT;
        for (let column = 0; column < candidate.columns; column += 1) {
            stream.attributes.push(
                Object.freeze({
                    format: candidate.format,
                    offset: candidate.source.offset + column * columnByteLength,
                    shaderLocation: candidate.location + column
                })
            );
        }
    }
    if (mutableStreams.length > capabilities.limits.maxVertexBuffers) {
        throw new RangeError(
            `Vertex plan requires ${String(mutableStreams.length)} buffers, exceeding maxVertexBuffers ${String(capabilities.limits.maxVertexBuffers)}`
        );
    }

    let vertexCount = 0;
    let instanceCapacity = 0;
    const streams = new Array<Readonly<VertexInputStreamPlan>>(mutableStreams.length);
    const vertexBuffers = new Array<Readonly<RHIVertexBufferLayout>>(mutableStreams.length);
    for (let slot = 0; slot < mutableStreams.length; slot += 1) {
        const mutable = mutableStreams[slot];
        if (mutable === undefined) continue;
        const expectedCount = mutable.stepMode === 'vertex' ? vertexCount : instanceCapacity;
        if (expectedCount === 0) {
            if (mutable.stepMode === 'vertex') vertexCount = mutable.vertexCount;
            else instanceCapacity = mutable.vertexCount;
        } else if (mutable.vertexCount !== expectedCount) {
            const countName = mutable.stepMode === 'vertex' ? 'vertex count' : 'instance count';
            throw new RangeError(
                `Per-${mutable.stepMode} streams must contain the same ${countName}; expected ${String(expectedCount)}, received ${String(mutable.vertexCount)}`
            );
        }
        const layout: Readonly<RHIVertexBufferLayout> = Object.freeze({
            arrayStride: mutable.arrayStride,
            stepMode: mutable.stepMode,
            attributes: Object.freeze(mutable.attributes)
        });
        const stream: Readonly<VertexInputStreamPlan> = Object.freeze({
            source: mutable.source,
            sources: Object.freeze(mutable.sources),
            slot,
            vertexCount: mutable.vertexCount,
            stepMode: mutable.stepMode,
            layout
        });
        streams[slot] = stream;
        vertexBuffers[slot] = layout;
    }
    return {
        snapshots,
        plan: Object.freeze({
            streams: Object.freeze(streams),
            vertexBuffers: Object.freeze(vertexBuffers),
            vertexCount,
            instanceCapacity: instanceCapacity === 0 ? 1 : instanceCapacity
        })
    };
}

/**
 * Compile material-resolved shader inputs into a portable per-vertex RHI layout.
 *
 * Repeated inputs resolving to the exact same `GeometryData` share one slot. Distinct wrappers
 * also share one canonical slot when they explicitly identify the same buffer view, exact byte
 * range, effective stride, and vertex count. Square matrix inputs are expanded column-major over
 * consecutive physical shader locations while preserving one logical GeometryData value per
 * vertex. Instanced meshes require an explicit opt-in from the batch compiler so direct-draw
 * callers cannot accidentally omit their per-instance stream.
 */
export class VertexInputLayoutCompiler {
    private records = new WeakMap<Mesh, CachedPlan[]>();
    private genericAttributes: GenericAttributeCache = new WeakMap();

    compile(
        inputs: readonly VertexInputReflection[],
        mesh: Mesh,
        material: Material,
        capabilities: VertexInputLayoutCapabilities,
        programInfo: ProgramBindingInfo = EMPTY_PROGRAM_INFO,
        allowInstanced = false
    ): Readonly<VertexInputLayoutPlan> {
        validateInputs(inputs, capabilities);
        if (mesh.useInstanced && !allowInstanced) {
            throw new TypeError('Instanced vertex inputs are not supported by this compiler');
        }

        let records = this.records.get(mesh);
        let replacementIndex = -1;
        if (records !== undefined) {
            for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
                const record = records[recordIndex];
                if (record === undefined) continue;
                if (
                    record.inputs !== inputs ||
                    record.material !== material ||
                    record.programInfo !== programInfo
                ) {
                    continue;
                }
                replacementIndex = recordIndex;
                if (
                    record.geometry !== mesh.geometry ||
                    record.attributes !== material.attributes ||
                    record.maxVertexAttributes !== capabilities.limits.maxVertexAttributes ||
                    record.maxVertexBuffers !== capabilities.limits.maxVertexBuffers ||
                    record.maxVertexBufferArrayStride !==
                        capabilities.limits.maxVertexBufferArrayStride ||
                    record.snapshots.length !== inputs.length
                ) {
                    break;
                }
                let matches = true;
                for (let index = 0; index < inputs.length; index += 1) {
                    const input = inputs[index];
                    const cached = record.snapshots[index];
                    if (
                        input === undefined ||
                        cached === undefined ||
                        !snapshotMatches(
                            cached,
                            input,
                            index,
                            mesh,
                            material,
                            programInfo,
                            capabilities.limits.maxVertexBufferArrayStride,
                            this.genericAttributes
                        )
                    ) {
                        matches = false;
                        break;
                    }
                }
                if (matches) {
                    validateCachedCanonicalStreams(record.plan);
                    return record.plan;
                }
                break;
            }
        } else {
            records = [];
            this.records.set(mesh, records);
        }

        const built = buildPlan(
            inputs,
            mesh,
            material,
            programInfo,
            capabilities,
            this.genericAttributes
        );
        const record: CachedPlan = {
            inputs,
            material,
            programInfo,
            geometry: mesh.geometry,
            attributes: material.attributes,
            maxVertexAttributes: capabilities.limits.maxVertexAttributes,
            maxVertexBuffers: capabilities.limits.maxVertexBuffers,
            maxVertexBufferArrayStride: capabilities.limits.maxVertexBufferArrayStride,
            snapshots: built.snapshots,
            plan: built.plan
        };
        if (replacementIndex < 0) records.push(record);
        else records[replacementIndex] = record;
        return built.plan;
    }

    /** Drop every cached snapshot without retaining mesh identities. */
    clear(): void {
        this.records = new WeakMap();
        this.genericAttributes = new WeakMap();
    }
}
