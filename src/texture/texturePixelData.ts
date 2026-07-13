import {
    ALPHA,
    BYTE,
    DEPTH_COMPONENT,
    DEPTH_STENCIL,
    FLOAT,
    INT,
    LUMINANCE,
    LUMINANCE_ALPHA,
    RGB,
    RGBA,
    SHORT,
    UNSIGNED_BYTE,
    UNSIGNED_INT,
    UNSIGNED_SHORT,
    UNSIGNED_SHORT_4_4_4_4,
    UNSIGNED_SHORT_5_5_5_1,
    UNSIGNED_SHORT_5_6_5
} from '../constants/webgl';
import {
    HALF_FLOAT,
    INT_2_10_10_10_REV,
    FLOAT_32_UNSIGNED_INT_24_8_REV,
    RED,
    RED_INTEGER,
    RG,
    RGB_INTEGER,
    RGBA_INTEGER,
    RG_INTEGER,
    UNSIGNED_INT_10F_11F_11F_REV,
    UNSIGNED_INT_24_8,
    UNSIGNED_INT_2_10_10_10_REV,
    UNSIGNED_INT_5_9_9_9_REV
} from '../constants/webgl2';
import type { TexturePixelData, TypedArray } from '../renderer/common/types';

const PACKED_PIXEL_TYPES = new Set<GLenum>([
    UNSIGNED_SHORT_4_4_4_4,
    UNSIGNED_SHORT_5_5_5_1,
    UNSIGNED_SHORT_5_6_5,
    INT_2_10_10_10_REV,
    UNSIGNED_INT_2_10_10_10_REV,
    UNSIGNED_INT_10F_11F_11F_REV,
    UNSIGNED_INT_5_9_9_9_REV,
    UNSIGNED_INT_24_8
]);

/** Runtime counterpart of the public raw texture-storage union. */
export function isTexturePixelData(value: unknown): value is TexturePixelData {
    return (
        value instanceof DataView ||
        value instanceof Int8Array ||
        value instanceof Uint8Array ||
        value instanceof Uint8ClampedArray ||
        value instanceof Int16Array ||
        value instanceof Uint16Array ||
        value instanceof Int32Array ||
        value instanceof Uint32Array ||
        value instanceof Float32Array ||
        value instanceof Float64Array
    );
}

function requireElementAlignment(source: DataView, bytesPerElement: number): ArrayBuffer {
    if (source.byteLength % bytesPerElement !== 0) {
        throw new RangeError(
            `Texture DataView contains ${String(source.byteLength)} bytes; its byte length must be divisible by ${String(bytesPerElement)}`
        );
    }
    const buffer = new ArrayBuffer(source.byteLength);
    new Uint8Array(buffer).set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
    return buffer;
}

/**
 * Give DataView sources the component representation declared by the texture type.
 * DataView bytes use the host's native component encoding, matching the equivalent TypedArray.
 */
export function texturePixelDataToTypedArray(source: TexturePixelData, type: GLenum): TypedArray {
    if (!(source instanceof DataView)) return source;
    switch (type) {
        // Compressed KTX payloads declare glType=0 and are still byte-addressed.
        case 0:
            return new Uint8Array(requireElementAlignment(source, Uint8Array.BYTES_PER_ELEMENT));
        case BYTE:
            return new Int8Array(requireElementAlignment(source, Int8Array.BYTES_PER_ELEMENT));
        case UNSIGNED_BYTE:
            return new Uint8Array(requireElementAlignment(source, Uint8Array.BYTES_PER_ELEMENT));
        case SHORT:
            return new Int16Array(requireElementAlignment(source, Int16Array.BYTES_PER_ELEMENT));
        case UNSIGNED_SHORT:
        case UNSIGNED_SHORT_4_4_4_4:
        case UNSIGNED_SHORT_5_5_5_1:
        case UNSIGNED_SHORT_5_6_5:
        case HALF_FLOAT:
            return new Uint16Array(requireElementAlignment(source, Uint16Array.BYTES_PER_ELEMENT));
        case INT:
        case INT_2_10_10_10_REV:
            return new Int32Array(requireElementAlignment(source, Int32Array.BYTES_PER_ELEMENT));
        case UNSIGNED_INT:
        case UNSIGNED_INT_2_10_10_10_REV:
        case UNSIGNED_INT_10F_11F_11F_REV:
        case UNSIGNED_INT_5_9_9_9_REV:
        case UNSIGNED_INT_24_8:
            return new Uint32Array(requireElementAlignment(source, Uint32Array.BYTES_PER_ELEMENT));
        case FLOAT_32_UNSIGNED_INT_24_8_REV:
            return new Uint32Array(requireElementAlignment(source, Uint32Array.BYTES_PER_ELEMENT));
        case FLOAT:
            return new Float32Array(
                requireElementAlignment(source, Float32Array.BYTES_PER_ELEMENT)
            );
        default:
            throw new TypeError(
                `Texture DataView cannot represent WebGL component type ${String(type)}`
            );
    }
}

/** Number of stored elements in one tightly packed pixel. */
export function textureElementsPerPixel(format: GLenum, type: GLenum): number {
    if (type === FLOAT_32_UNSIGNED_INT_24_8_REV) return 2;
    if (PACKED_PIXEL_TYPES.has(type)) return 1;
    switch (format) {
        case ALPHA:
        case LUMINANCE:
        case DEPTH_COMPONENT:
        case RED:
        case RED_INTEGER:
            return 1;
        case LUMINANCE_ALPHA:
        case DEPTH_STENCIL:
        case RG:
        case RG_INTEGER:
            return 2;
        case RGB:
        case RGB_INTEGER:
            return 3;
        case RGBA:
        case RGBA_INTEGER:
            return 4;
        default:
            throw new TypeError(`Texture format ${String(format)} has no packed pixel layout`);
    }
}

function createTypedArrayLike<Data extends TypedArray>(source: Data, length: number): Data {
    let output: TypedArray;
    if (source instanceof Int8Array) output = new Int8Array(length);
    else if (source instanceof Uint8ClampedArray) output = new Uint8ClampedArray(length);
    else if (source instanceof Uint8Array) output = new Uint8Array(length);
    else if (source instanceof Int16Array) output = new Int16Array(length);
    else if (source instanceof Uint16Array) output = new Uint16Array(length);
    else if (source instanceof Int32Array) output = new Int32Array(length);
    else if (source instanceof Uint32Array) output = new Uint32Array(length);
    else if (source instanceof Float32Array) output = new Float32Array(length);
    else output = new Float64Array(length);
    return output as Data;
}

/** Return a tightly packed copy whose row order is vertically reversed. */
export function flipTexturePixelRows<Data extends TypedArray>(
    source: Data,
    elementsPerRow: number,
    height: number
): Data {
    if (!Number.isSafeInteger(elementsPerRow) || elementsPerRow <= 0) {
        throw new RangeError('Texture row length must be a positive integer');
    }
    if (!Number.isSafeInteger(height) || height <= 0) {
        throw new RangeError('Texture height must be a positive integer');
    }
    const requiredElements = elementsPerRow * height;
    if (source.length < requiredElements) {
        throw new RangeError(
            `Texture data contains ${String(source.length)} elements; ${String(requiredElements)} are required`
        );
    }
    const output = createTypedArrayLike(source, requiredElements);
    const sourceBytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    const outputBytes = new Uint8Array(output.buffer, output.byteOffset, output.byteLength);
    const rowByteLength = elementsPerRow * source.BYTES_PER_ELEMENT;
    for (let targetRow = 0; targetRow < height; targetRow++) {
        const sourceRow = height - targetRow - 1;
        const sourceOffset = sourceRow * rowByteLength;
        outputBytes.set(
            sourceBytes.subarray(sourceOffset, sourceOffset + rowByteLength),
            targetRow * rowByteLength
        );
    }
    return output;
}
