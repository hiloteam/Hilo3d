import { TRIANGLES } from '../../../constants/webgl';
import type Geometry from '../../../geometry/Geometry';
import type GeometryData from '../../../geometry/GeometryData';
import { requireNumber } from '../../../math/numberArray';

const EMPTY_NUMBERS: readonly number[] = [];

export const RAY_TRIANGLE_FLOATS = 80;
export const RAY_BVH_NODE_FLOATS = 8;
export const RAY_BVH_LEAF_FLAG = 0x80000000;

export interface StreamStamp {
    readonly stream: GeometryData;
    readonly data: GeometryData['data'];
    readonly revision: number;
    readonly size: number;
    readonly stride: number;
    readonly offset: number;
    readonly normalized: boolean;
    readonly stepMode: 'vertex' | 'instance';
}

export interface SceneGeometry {
    readonly geometry: Geometry;
    readonly revision: number;
    readonly streams: readonly (StreamStamp | null)[];
    readonly uvDecode: readonly number[];
    readonly uv1Decode: readonly number[];
    readonly indices: Uint32Array;
    readonly tangentMask: number;
    readonly positionDecode: readonly number[];
    readonly normalDecode: readonly number[];
    /** Eighteen local vec4s: positions, normals, UV0/UV1, RGBA and two tangent sets. */
    readonly vertices: Float32Array;
    readonly triangleCount: number;
}

export function stamp(stream: GeometryData): StreamStamp {
    return {
        stream,
        data: stream.data,
        revision: stream.revision,
        size: stream.size,
        stride: stream.stride,
        offset: stream.offset,
        normalized: stream.normalized,
        stepMode: stream.stepMode
    };
}

export function matchesStream(
    previous: StreamStamp | null | undefined,
    stream: GeometryData | null
): boolean {
    if (stream === null) return previous === null;
    return (
        previous?.stream === stream &&
        previous.data === stream.data &&
        previous.revision === stream.revision &&
        previous.size === stream.size &&
        previous.stride === stream.stride &&
        previous.offset === stream.offset &&
        previous.normalized === stream.normalized &&
        previous.stepMode === stream.stepMode
    );
}

export function numbersEqual(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
    if (a.length !== b.length) return false;
    for (let index = 0; index < a.length; index++) {
        if (a[index] !== b[index]) return false;
    }
    return true;
}

/** GeometryData layout changes are public and do not necessarily advance its data revision. */
export function matchesGeometry(
    previous: SceneGeometry,
    geometry: Geometry,
    tangentMask = 0
): boolean {
    const normals = geometry.normals;
    return (
        previous.geometry === geometry &&
        (previous.tangentMask & tangentMask) === tangentMask &&
        previous.revision === geometry.revision &&
        matchesStream(previous.streams[0], geometry.vertices) &&
        matchesStream(previous.streams[1], normals) &&
        matchesStream(previous.streams[2], geometry.indices) &&
        matchesStream(previous.streams[3], geometry.uvs) &&
        matchesStream(previous.streams[4], geometry.uvs1) &&
        matchesStream(previous.streams[5], geometry.colors) &&
        matchesStream(
            previous.streams[6],
            (previous.tangentMask & 1) !== 0 ? geometry.tangents : null
        ) &&
        matchesStream(
            previous.streams[7],
            (previous.tangentMask & 2) !== 0 ? geometry.tangents1 : null
        ) &&
        numbersEqual(previous.uvDecode, geometry.uvDecodeMat ?? EMPTY_NUMBERS) &&
        numbersEqual(previous.uv1Decode, geometry.uv1DecodeMat ?? EMPTY_NUMBERS) &&
        numbersEqual(previous.positionDecode, geometry.positionDecodeMat ?? EMPTY_NUMBERS) &&
        numbersEqual(previous.normalDecode, geometry.normalDecodeMat ?? EMPTY_NUMBERS)
    );
}

export function countStream(stream: GeometryData, size: number): number {
    const bytes = stream.data.BYTES_PER_ELEMENT;
    const stride = stream.stride === 0 ? stream.size : stream.stride / bytes;
    const offset = stream.offset / bytes;
    if (
        stream.size !== size ||
        stream.stepMode !== 'vertex' ||
        !Number.isSafeInteger(stride) ||
        stride < size ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset + size > stream.data.length
    ) {
        throw new RangeError('DDGI geometry has an invalid vertex/index stream layout');
    }
    return Math.floor((stream.data.length - offset - size) / stride) + 1;
}

export function readComponent(stream: GeometryData, vertex: number, component: number): number {
    const stride =
        stream.stride === 0 ? stream.size : stream.stride / stream.data.BYTES_PER_ELEMENT;
    const offset = stream.offset / stream.data.BYTES_PER_ELEMENT + vertex * stride + component;
    let value = requireNumber(stream.data, offset);
    if (stream.normalized) {
        const data = stream.data;
        if (data instanceof Int8Array) value = Math.max(-1, value / 127);
        else if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) value /= 255;
        else if (data instanceof Int16Array) value = Math.max(-1, value / 32767);
        else if (data instanceof Uint16Array) value /= 65535;
        else if (data instanceof Int32Array) value = Math.max(-1, value / 2147483647);
        else if (data instanceof Uint32Array) value /= 4294967295;
    }
    if (!Number.isFinite(value)) throw new RangeError('DDGI geometry must contain finite values');
    return value;
}

function decodeVertex(
    output: Float32Array,
    offset: number,
    stream: GeometryData,
    vertex: number,
    decode: readonly number[]
): void {
    const x = readComponent(stream, vertex, 0);
    const y = readComponent(stream, vertex, 1);
    const z = readComponent(stream, vertex, 2);
    if (decode.length === 0) {
        output[offset] = x;
        output[offset + 1] = y;
        output[offset + 2] = z;
    } else {
        for (let axis = 0; axis < 3; axis++) {
            output[offset + axis] =
                x * requireNumber(decode, axis) +
                y * requireNumber(decode, axis + 4) +
                z * requireNumber(decode, axis + 8) +
                requireNumber(decode, axis + 12);
        }
    }
}

function copyDecode(input: ArrayLike<number> | null): readonly number[] {
    if (input === null) return [];
    const values = Array.from(input);
    if (values.length !== 16 || values.some(value => !Number.isFinite(value))) {
        throw new RangeError('DDGI quantization decode matrices must contain 16 finite values');
    }
    return values;
}

/** Validates CPU-readable static triangle data before publishing a reusable local snapshot. */
export function extractGeometry(
    geometry: Geometry,
    maxTriangles: number,
    tangentMask = 0
): SceneGeometry {
    if (geometry.mode !== TRIANGLES || geometry.vertices === null) {
        throw new TypeError('DDGI requires triangle-list geometry with vertex positions');
    }
    const positions = geometry.vertices;
    const vertexCount = countStream(positions, 3);
    const indices = geometry.indices;
    if (
        indices &&
        (indices.normalized ||
            !(
                indices.data instanceof Uint8Array ||
                indices.data instanceof Uint16Array ||
                indices.data instanceof Uint32Array
            ))
    ) {
        throw new TypeError('DDGI triangle indices must be unnormalized unsigned integers');
    }
    const indexCount = indices ? countStream(indices, 1) : vertexCount;
    if (indexCount % 3 !== 0) throw new RangeError('DDGI triangle lists require complete triples');
    const triangleCount = indexCount / 3;
    if (triangleCount > maxTriangles) throw new RangeError('DDGI scene triangle budget exceeded');
    // Validate all indices before the lazily generated Geometry normals can consume them.
    if (indices) {
        for (let index = 0; index < indexCount; index++) {
            if (readComponent(indices, index, 0) >= vertexCount) {
                throw new RangeError('DDGI triangle index is outside the vertex stream');
            }
        }
    }
    const normals = geometry.normals;
    if (normals === null || countStream(normals, 3) < vertexCount) {
        throw new RangeError('DDGI requires a complete normal stream');
    }
    const positionDecode = copyDecode(geometry.positionDecodeMat);
    const normalDecode = copyDecode(geometry.normalDecodeMat);
    const attributes = [
        geometry.uvs,
        geometry.uvs1,
        geometry.colors,
        (tangentMask & 1) !== 0 ? geometry.tangents : null,
        (tangentMask & 2) !== 0 ? geometry.tangents1 : null
    ];
    for (let index = 0; index < attributes.length; index++) {
        const stream = attributes[index];
        if (
            stream &&
            ((index === 2 && stream.size !== 3 && stream.size !== 4) ||
                countStream(stream, index < 2 ? 2 : index === 2 ? stream.size : 4) < vertexCount)
        )
            throw new RangeError('DDGI requires complete UV/color/tangent vertex streams');
    }
    const uvDecode = Array.from(geometry.uvDecodeMat ?? []);
    if (
        uvDecode.length !== 0 &&
        (uvDecode.length !== 9 || uvDecode.some(value => !Number.isFinite(value)))
    )
        throw new RangeError('DDGI UV decode matrix must contain nine finite values');
    const uv1Decode = Array.from(geometry.uv1DecodeMat ?? []);
    if (
        uv1Decode.length !== 0 &&
        (uv1Decode.length !== 9 || uv1Decode.some(value => !Number.isFinite(value)))
    )
        throw new RangeError('DDGI UV1 decode matrix must contain nine finite values');
    const sourceIndices = new Uint32Array(triangleCount * 3);
    const vertices = new Float32Array(triangleCount * 72);
    for (let triangle = 0; triangle < triangleCount; triangle++) {
        for (let corner = 0; corner < 3; corner++) {
            const index = indices
                ? readComponent(indices, triangle * 3 + corner, 0)
                : triangle * 3 + corner;
            sourceIndices[triangle * 3 + corner] = index;
            decodeVertex(vertices, triangle * 72 + corner * 4, positions, index, positionDecode);
            decodeVertex(vertices, triangle * 72 + 12 + corner * 4, normals, index, normalDecode);
            for (let set = 0; set < 2; set++) {
                const stream = attributes[set];
                if (!stream) continue;
                const u = readComponent(stream, index, 0),
                    v = readComponent(stream, index, 1);
                const out = triangle * 72 + 24 + corner * 4 + set * 2;
                const decode = set === 0 ? uvDecode : uv1Decode;
                vertices[out] = decode.length
                    ? u * requireNumber(decode, 0) +
                      v * requireNumber(decode, 3) +
                      requireNumber(decode, 6)
                    : u;
                vertices[out + 1] = decode.length
                    ? u * requireNumber(decode, 1) +
                      v * requireNumber(decode, 4) +
                      requireNumber(decode, 7)
                    : v;
            }
            const colors = geometry.colors;
            for (let component = 0; component < 4; component++)
                vertices[triangle * 72 + 36 + corner * 4 + component] =
                    colors && component < colors.size ? readComponent(colors, index, component) : 1;
            for (let set = 0; set < 2; set++) {
                const tangent = attributes[3 + set];
                for (let component = 0; component < 4; component++)
                    vertices[triangle * 72 + 48 + set * 12 + corner * 4 + component] = tangent
                        ? readComponent(tangent, index, component)
                        : component === 0 || component === 3
                          ? 1
                          : 0;
            }
        }
    }
    if (vertices.some(value => !Number.isFinite(value))) {
        throw new RangeError('DDGI decoded geometry exceeds the finite float32 range');
    }
    return {
        geometry,
        revision: geometry.revision,
        streams: [positions, normals, indices, ...attributes].map(stream =>
            stream ? stamp(stream) : null
        ),
        uvDecode,
        uv1Decode,
        indices: sourceIndices,
        tangentMask,
        positionDecode,
        normalDecode,
        vertices,
        triangleCount
    };
}

/** Column-major inverse-transpose linear transform, rejecting collapsed rigid objects. */
export function normalTransform(matrix: ArrayLike<number>): readonly number[] {
    if (matrix.length !== 16 || Array.from(matrix).some(value => !Number.isFinite(value))) {
        throw new RangeError('DDGI world transforms must contain 16 finite values');
    }
    if (matrix[3] !== 0 || matrix[7] !== 0 || matrix[11] !== 0 || matrix[15] !== 1) {
        throw new RangeError('DDGI world transforms must be affine');
    }
    const a = requireNumber(matrix, 0),
        b = requireNumber(matrix, 4),
        c = requireNumber(matrix, 8);
    const d = requireNumber(matrix, 1),
        e = requireNumber(matrix, 5),
        f = requireNumber(matrix, 9);
    const g = requireNumber(matrix, 2),
        h = requireNumber(matrix, 6),
        i = requireNumber(matrix, 10);
    const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-20) {
        throw new RangeError('DDGI cannot trace a singular world transform');
    }
    return [
        (e * i - f * h) / determinant,
        (c * h - b * i) / determinant,
        (b * f - c * e) / determinant,
        (f * g - d * i) / determinant,
        (a * i - c * g) / determinant,
        (c * d - a * f) / determinant,
        (d * h - e * g) / determinant,
        (b * g - a * h) / determinant,
        (a * e - b * d) / determinant
    ];
}

/** Writes one object's triangles to their stable BVH leaf slots. */
export function writeWorldTriangles(
    target: Float32Array,
    source: SceneGeometry,
    matrix: ArrayLike<number>,
    normalMatrix: readonly number[],
    material: readonly number[],
    objectIndex: number,
    layerMask: number,
    reverseWinding: boolean,
    sourceOffset: number,
    remap: Uint32Array | null
): void {
    const local = source.vertices;
    const metadata = new Uint32Array(target.buffer, target.byteOffset, target.length);
    for (let triangle = 0; triangle < source.triangleCount; triangle++) {
        const destination = remap
            ? requireNumber(remap, sourceOffset + triangle)
            : sourceOffset + triangle;
        const output = destination * RAY_TRIANGLE_FLOATS;
        metadata[output + 3] = layerMask;
        for (let corner = 0; corner < 3; corner++) {
            const localCorner = reverseWinding && corner > 0 ? 3 - corner : corner;
            const input = triangle * 72 + localCorner * 4;
            const x = requireNumber(local, input),
                y = requireNumber(local, input + 1),
                z = requireNumber(local, input + 2);
            const nx = requireNumber(local, input + 12),
                ny = requireNumber(local, input + 13),
                nz = requireNumber(local, input + 14);
            let normalLength = 0;
            for (let axis = 0; axis < 3; axis++) {
                const position =
                    x * requireNumber(matrix, axis) +
                    y * requireNumber(matrix, axis + 4) +
                    z * requireNumber(matrix, axis + 8) +
                    requireNumber(matrix, axis + 12);
                target[output + corner * 4 + axis] = position;
                const normal =
                    nx * requireNumber(normalMatrix, axis) +
                    ny * requireNumber(normalMatrix, axis + 3) +
                    nz * requireNumber(normalMatrix, axis + 6);
                target[output + 12 + corner * 4 + axis] = normal;
                normalLength += normal * normal;
                if (
                    !Number.isFinite(Math.fround(position)) ||
                    !Number.isFinite(Math.fround(normal))
                ) {
                    throw new RangeError('DDGI world geometry exceeds the finite float32 range');
                }
            }
            const scale = normalLength > 1e-20 ? 1 / Math.sqrt(normalLength) : 0;
            for (let axis = 0; axis < 3; axis++) {
                const normalIndex = output + 12 + corner * 4 + axis;
                target[normalIndex] = requireNumber(target, normalIndex) * scale;
            }
        }
        for (let corner = 0; corner < 3; corner++) {
            const localCorner = reverseWinding && corner > 0 ? 3 - corner : corner;
            for (let component = 0; component < 4; component++) {
                target[output + 32 + corner * 4 + component] = requireNumber(
                    local,
                    triangle * 72 + 24 + localCorner * 4 + component
                );
                target[output + 44 + corner * 4 + component] = requireNumber(
                    local,
                    triangle * 72 + 36 + localCorner * 4 + component
                );
            }
            for (let set = 0; set < 2; set++) {
                const offset = triangle * 72 + 48 + set * 12 + localCorner * 4;
                const nx = requireNumber(local, offset),
                    ny = requireNumber(local, offset + 1),
                    nz = requireNumber(local, offset + 2);
                const out = output + 56 + set * 12 + corner * 4;
                let length = 0;
                for (let axis = 0; axis < 3; axis++) {
                    const value =
                        nx * requireNumber(normalMatrix, axis) +
                        ny * requireNumber(normalMatrix, axis + 3) +
                        nz * requireNumber(normalMatrix, axis + 6);
                    target[out + axis] = value;
                    length += value * value;
                }
                for (let axis = 0; axis < 3; axis++)
                    target[out + axis] =
                        length > 1e-20 ? requireNumber(target, out + axis) / Math.sqrt(length) : 0;
                target[out + 3] = requireNumber(local, offset + 3);
            }
        }
        target.set(material, output + 24);
        target[output + 31] = objectIndex;
    }
}
