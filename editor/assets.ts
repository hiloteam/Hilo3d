/** A portable source asset. The base64 payload is immutable and addressed by SHA-256. */
export interface ProjectAsset {
    id: string;
    name: string;
    kind: 'model' | 'texture';
    mimeType: 'model/gltf-binary' | 'image/png' | 'image/jpeg' | 'image/webp';
    size: number;
    hash: string;
    source: {
        fileName: string;
        importedAt: string;
        license?: string;
        attribution?: string;
        originURL?: string;
    };
    data: string;
}

export const MAX_ASSET_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_EDGE = 8192;
const MAX_IMAGE_PIXELS = 16_777_216;
const MAX_BASE64_LENGTH = Math.ceil(MAX_ASSET_BYTES / 3) * 4;
interface VerifiedPayload {
    data: string;
    size: number;
    mimeType: ProjectAsset['mimeType'];
    decodedImageBytes: number;
}
// Cache immutable string content, never mutable object identity. A changed byte, hash, MIME, or
// size always crosses the full validation boundary again. Bound retained source data to 64 MiB.
const verifiedPayloads = new Map<string, VerifiedPayload>();
let verifiedPayloadBytes = 0;

function rememberPayload(hash: string, payload: VerifiedPayload): void {
    const previous = verifiedPayloads.get(hash);
    if (previous) verifiedPayloadBytes -= previous.size;
    verifiedPayloads.delete(hash);
    verifiedPayloads.set(hash, payload);
    verifiedPayloadBytes += payload.size;
    while (verifiedPayloadBytes > 64 * 1024 * 1024 || verifiedPayloads.size > 128) {
        const oldest = verifiedPayloads.keys().next().value;
        if (!oldest) break;
        verifiedPayloadBytes -= verifiedPayloads.get(oldest)?.size ?? 0;
        verifiedPayloads.delete(oldest);
    }
}
const SHA_CONSTANTS = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function rotate(value: number, bits: number): number {
    return (value >>> bits) | (value << (32 - bits));
}

/** Synchronous SHA-256 permits checksum verification at the JSON parsing boundary. */
export function assetHash(bytes: Uint8Array): string {
    const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000));
    view.setUint32(padded.length - 4, bytes.length * 8);
    const state = new Uint32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19
    ]);
    const words = new Uint32Array(64);
    for (let offset = 0; offset < padded.length; offset += 64) {
        for (let index = 0; index < 16; index += 1)
            words[index] = view.getUint32(offset + index * 4);
        for (let index = 16; index < 64; index += 1) {
            const a = words[index - 15] ?? 0;
            const b = words[index - 2] ?? 0;
            words[index] =
                (words[index - 16] ?? 0) +
                (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) +
                (words[index - 7] ?? 0) +
                (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10));
        }
        let a = state[0] ?? 0;
        let b = state[1] ?? 0;
        let c = state[2] ?? 0;
        let d = state[3] ?? 0;
        let e = state[4] ?? 0;
        let f = state[5] ?? 0;
        let g = state[6] ?? 0;
        let h = state[7] ?? 0;
        for (let index = 0; index < 64; index += 1) {
            const first =
                (h +
                    (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) +
                    ((e & f) ^ (~e & g)) +
                    (SHA_CONSTANTS[index] ?? 0) +
                    (words[index] ?? 0)) |
                0;
            const second =
                ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) |
                0;
            h = g;
            g = f;
            f = e;
            e = (d + first) | 0;
            d = c;
            c = b;
            b = a;
            a = (first + second) | 0;
        }
        const block = [a, b, c, d, e, f, g, h];
        for (let index = 0; index < state.length; index += 1)
            state[index] = (state[index] ?? 0) + (block[index] ?? 0);
    }
    return Array.from(state, value => value.toString(16).padStart(8, '0')).join('');
}

function encode(bytes: Uint8Array): string {
    const parts: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 8192) {
        parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
    }
    return btoa(parts.join(''));
}

function decode(data: string): Uint8Array<ArrayBuffer> {
    if (
        data.length > MAX_BASE64_LENGTH ||
        data.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/u.test(data)
    ) {
        throw new Error('Asset data must be canonical base64 within the 16 MiB limit');
    }
    let binary: string;
    try {
        binary = atob(data);
    } catch {
        throw new Error('Asset contains invalid base64');
    }
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    if (bytes.length > MAX_ASSET_BYTES || encode(bytes) !== data)
        throw new Error('Asset contains noncanonical or oversized base64');
    return bytes;
}

function object(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error(`${label} must be an object`);
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
        throw new Error(`${label} must be a plain object`);
    return value as Record<string, unknown>;
}

function fields(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
    for (const key of Object.keys(value))
        if (!allowed.includes(key)) throw new Error(`${label}.${key}: unknown field`);
}

function name(value: unknown, label: string, length: number): string {
    if (
        typeof value !== 'string' ||
        !value.trim() ||
        value.length > length ||
        Array.from(value).some(character => character.charCodeAt(0) < 32)
    )
        throw new Error(`${label}: invalid name`);
    return value;
}

function dimensions(width: number, height: number): void {
    if (
        width < 1 ||
        height < 1 ||
        width > MAX_IMAGE_EDGE ||
        height > MAX_IMAGE_EDGE ||
        width * height > MAX_IMAGE_PIXELS
    ) {
        throw new Error('Texture dimensions exceed 8192 per edge or 16,777,216 pixels');
    }
}

function fourCC(bytes: Uint8Array, offset: number): string {
    return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

const PNG_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1)
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
});

function pngCRC(bytes: Uint8Array, start: number, end: number): number {
    let value = 0xffffffff;
    for (let offset = start; offset < end; offset += 1)
        value = (PNG_CRC_TABLE[(value ^ (bytes[offset] ?? 0)) & 0xff] ?? 0) ^ (value >>> 8);
    return (value ^ 0xffffffff) >>> 0;
}

function validatePNG(bytes: Uint8Array, view: DataView): { width: number; height: number } {
    if (
        bytes.length < 45 ||
        ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte) ||
        view.getUint32(8) !== 13 ||
        fourCC(bytes, 12) !== 'IHDR'
    )
        throw new Error('Invalid PNG header');
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    dimensions(width, height);
    const bitDepth = bytes[24] ?? 0;
    const colorType = bytes[25] ?? 0;
    const depths: Record<number, readonly number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16]
    };
    if (
        !depths[colorType]?.includes(bitDepth) ||
        bytes[26] !== 0 ||
        bytes[27] !== 0 ||
        (bytes[28] ?? 2) > 1
    )
        throw new Error('Unsupported PNG color, compression, filter or interlace header');
    let offset = 8;
    let palette = 0;
    let transparency = false;
    let dataStarted = false;
    let dataEnded = false;
    let dataBytes = 0;
    const zlibHeader: number[] = [];
    let ended = false;
    while (offset + 12 <= bytes.length) {
        const length = view.getUint32(offset);
        if (length > bytes.length - offset - 12) throw new Error('Truncated PNG chunk');
        const kind = fourCC(bytes, offset + 4);
        if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/u.test(kind)) throw new Error('Invalid PNG chunk type');
        if (pngCRC(bytes, offset + 4, offset + 8 + length) !== view.getUint32(offset + 8 + length))
            throw new Error(`PNG ${kind} chunk CRC mismatch`);
        if (kind === 'IHDR') {
            if (offset !== 8 || length !== 13)
                throw new Error('PNG IHDR must occur exactly once at the start');
        } else if (kind === 'PLTE') {
            if (
                palette ||
                dataStarted ||
                length === 0 ||
                length % 3 !== 0 ||
                length > 768 ||
                colorType === 0 ||
                colorType === 4
            )
                throw new Error('PNG palette is invalid or out of order');
            palette = length / 3;
            if (colorType === 3 && palette > 2 ** bitDepth)
                throw new Error('PNG palette exceeds its bit depth');
        } else if (kind === 'tRNS') {
            if (
                transparency ||
                dataStarted ||
                (colorType === 0
                    ? length !== 2
                    : colorType === 2
                      ? length !== 6
                      : colorType === 3
                        ? palette === 0 || length < 1 || length > palette
                        : true)
            )
                throw new Error('PNG transparency is invalid or out of order');
            transparency = true;
        } else if (kind === 'IDAT') {
            if (dataEnded || (colorType === 3 && palette === 0))
                throw new Error(
                    'PNG image chunks must be consecutive and follow a required palette'
                );
            dataStarted = true;
            dataBytes += length;
            for (let index = 0; index < length && zlibHeader.length < 2; index += 1)
                zlibHeader.push(bytes[offset + 8 + index] ?? 0);
        } else if (kind === 'IEND') {
            if (length !== 0 || offset + 12 !== bytes.length || !dataStarted || dataBytes < 6)
                throw new Error('Incomplete PNG image or trailing bytes');
            ended = true;
            break;
        } else {
            if (kind === 'acTL' || kind === 'fcTL' || kind === 'fdAT')
                throw new Error('Animated PNG textures are not supported');
            if (((bytes[offset + 4] ?? 0) & 32) === 0)
                throw new Error(`Unsupported critical PNG chunk ${kind}`);
            if (dataStarted) dataEnded = true;
        }
        offset += 12 + length;
    }
    const cmf = zlibHeader[0] ?? 0;
    const flags = zlibHeader[1] ?? 0;
    if (
        !ended ||
        zlibHeader.length !== 2 ||
        (cmf & 15) !== 8 ||
        cmf >>> 4 > 7 ||
        ((cmf << 8) + flags) % 31 !== 0 ||
        (flags & 32) !== 0
    )
        throw new Error('PNG compressed image data is invalid');
    return { width, height };
}

function imageDimensions(
    bytes: Uint8Array,
    mime: ProjectAsset['mimeType']
): { width: number; height: number } {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let width = 0;
    let height = 0;
    if (mime === 'image/png') {
        ({ width, height } = validatePNG(bytes, view));
    } else if (mime === 'image/jpeg') {
        if (
            bytes.length < 12 ||
            bytes[0] !== 0xff ||
            bytes[1] !== 0xd8 ||
            bytes[bytes.length - 2] !== 0xff ||
            bytes[bytes.length - 1] !== 0xd9
        )
            throw new Error('Invalid JPEG boundaries');
        let offset = 2;
        while (offset + 4 <= bytes.length) {
            if (bytes[offset] !== 0xff) throw new Error('Invalid JPEG marker');
            while (bytes[offset] === 0xff) offset += 1;
            const marker = bytes[offset++];
            if (marker === 0xda || marker === 0xd9) break;
            if (marker === 0x01 || (marker !== undefined && marker >= 0xd0 && marker <= 0xd7))
                continue;
            if (offset + 2 > bytes.length) throw new Error('Truncated JPEG marker');
            const length = view.getUint16(offset);
            if (length < 2 || offset + length > bytes.length)
                throw new Error('Truncated JPEG segment');
            if (
                marker !== undefined &&
                [
                    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
                ].includes(marker)
            ) {
                if (length < 8) throw new Error('Invalid JPEG frame');
                height = view.getUint16(offset + 3);
                width = view.getUint16(offset + 5);
            }
            offset += length;
        }
    } else if (mime === 'image/webp') {
        if (
            bytes.length < 20 ||
            fourCC(bytes, 0) !== 'RIFF' ||
            fourCC(bytes, 8) !== 'WEBP' ||
            view.getUint32(4, true) + 8 !== bytes.length
        )
            throw new Error('Invalid WebP container');
        const kind = fourCC(bytes, 12);
        if (kind === 'VP8X' && bytes.length >= 30) {
            if ((bytes[20] ?? 0) & 2) throw new Error('Animated WebP textures are not supported');
            width = 1 + (bytes[24] ?? 0) + ((bytes[25] ?? 0) << 8) + ((bytes[26] ?? 0) << 16);
            height = 1 + (bytes[27] ?? 0) + ((bytes[28] ?? 0) << 8) + ((bytes[29] ?? 0) << 16);
        } else if (kind === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
            const bits = view.getUint32(21, true);
            width = (bits & 0x3fff) + 1;
            height = ((bits >>> 14) & 0x3fff) + 1;
        } else if (kind === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) {
            width = view.getUint16(26, true) & 0x3fff;
            height = view.getUint16(28, true) & 0x3fff;
        } else throw new Error('Unsupported WebP image header');
        let offset = 12;
        while (offset + 8 <= bytes.length) {
            const length = view.getUint32(offset + 4, true);
            offset += 8 + length + (length % 2);
        }
        if (offset !== bytes.length) throw new Error('Truncated WebP chunk');
    } else throw new Error('Unsupported image type');
    dimensions(width, height);
    return { width, height };
}

interface EmbeddedImage {
    bytes: Uint8Array;
    mime: 'image/png' | 'image/jpeg' | 'image/webp';
    copies: number;
}

function glb(bytes: Uint8Array): EmbeddedImage[] {
    if (bytes.length < 20) throw new Error('GLB header is truncated');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (
        view.getUint32(0, true) !== 0x46546c67 ||
        view.getUint32(4, true) !== 2 ||
        view.getUint32(8, true) !== bytes.length
    )
        throw new Error('GLB requires glTF 2.0 with an exact container length');
    let offset = 12;
    let json: Record<string, unknown> | null = null;
    let binary = new Uint8Array(0);
    let binaryLength = 0;
    let binarySeen = false;
    while (offset + 8 <= bytes.length) {
        const length = view.getUint32(offset, true);
        const kind = view.getUint32(offset + 4, true);
        if (length % 4 !== 0 || offset + 8 + length > bytes.length)
            throw new Error('GLB chunk size is invalid');
        if (kind === 0x4e4f534a && offset === 12 && !json) {
            try {
                json = object(
                    JSON.parse(
                        new TextDecoder('utf-8', { fatal: true }).decode(
                            bytes.subarray(offset + 8, offset + 8 + length)
                        )
                    ) as unknown,
                    'GLB JSON'
                );
            } catch {
                throw new Error('GLB JSON chunk is invalid');
            }
        } else if (kind === 0x004e4942 && json && !binarySeen) {
            binaryLength = length;
            binary = bytes.slice(offset + 8, offset + 8 + length);
            binarySeen = true;
        } else throw new Error('GLB must contain one JSON chunk followed by at most one BIN chunk');
        offset += 8 + length;
    }
    if (offset !== bytes.length || !json) throw new Error('Incomplete GLB container');
    if (object(json['asset'], 'glTF asset')['version'] !== '2.0')
        throw new Error('Only glTF 2.0 assets are supported');
    let visited = 0;
    const inspect = (value: unknown, depth: number): void => {
        if (++visited > 200_000 || depth > 64) throw new Error('GLB JSON is too complex');
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) {
            for (const item of value) inspect(item, depth + 1);
            return;
        }
        for (const [key, item] of Object.entries(object(value, 'GLB object'))) {
            if (key === '__proto__' || key === 'constructor' || key === 'prototype')
                throw new Error('GLB contains a reserved property');
            if (key === 'uri') {
                if (
                    typeof item !== 'string' ||
                    !/^data:(?:application\/(?:octet-stream|gltf-buffer)|image\/(?:png|jpeg|webp));base64,/u.test(
                        item
                    )
                )
                    throw new Error(
                        'GLB external URI dependencies are not allowed; embed buffers and textures'
                    );
                const comma = item.indexOf(',');
                const embedded = decode(item.slice(comma + 1));
                const mime = item.slice(5, item.indexOf(';'));
                if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp')
                    imageDimensions(embedded, mime);
            }
            inspect(item, depth + 1);
        }
    };
    inspect(json, 0);
    const bufferData: Uint8Array[] = [];
    const buffers = json['buffers'];
    if (buffers !== undefined) {
        if (!Array.isArray(buffers) || buffers.length > 256) throw new Error('Invalid GLB buffers');
        for (const [index, entry] of buffers.entries()) {
            const buffer = object(entry, 'GLB buffer');
            const length = buffer['byteLength'];
            if (
                typeof length !== 'number' ||
                !Number.isSafeInteger(length) ||
                length < 1 ||
                length > MAX_ASSET_BYTES
            )
                throw new Error('GLB buffer byteLength is invalid');
            if (
                buffer['uri'] === undefined &&
                (index !== 0 || length > binaryLength || binaryLength - length > 3)
            )
                throw new Error('GLB buffer exceeds its BIN chunk');
            if (typeof buffer['uri'] === 'string') {
                if (!/^data:application\/(?:octet-stream|gltf-buffer);base64,/u.test(buffer['uri']))
                    throw new Error('GLB buffer URI must embed binary data');
                const data = decode(buffer['uri'].slice(buffer['uri'].indexOf(',') + 1));
                if (data.length !== length)
                    throw new Error('GLB embedded buffer length does not match');
                bufferData.push(data);
            } else bufferData.push(binary.subarray(0, length));
        }
    }
    const imageData: EmbeddedImage[] = [];
    const views: Uint8Array[] = [];
    if (json['bufferViews'] !== undefined) {
        if (!Array.isArray(json['bufferViews']) || json['bufferViews'].length > 10000)
            throw new Error('Invalid GLB buffer views');
        for (const value of json['bufferViews']) {
            const item = object(value, 'GLB buffer view');
            const index = item['buffer'];
            const start = item['byteOffset'] ?? 0;
            const length = item['byteLength'];
            if (
                typeof index !== 'number' ||
                !Number.isSafeInteger(index) ||
                typeof start !== 'number' ||
                !Number.isSafeInteger(start) ||
                start < 0 ||
                typeof length !== 'number' ||
                !Number.isSafeInteger(length) ||
                length < 1
            )
                throw new Error('Invalid GLB buffer view range');
            const data = bufferData[index];
            if (!data || start + length > data.length)
                throw new Error('GLB buffer view exceeds its buffer');
            views.push(data.subarray(start, start + length));
        }
    }
    if (json['images'] !== undefined) {
        if (!Array.isArray(json['images']) || json['images'].length > 128)
            throw new Error('GLB supports at most 128 embedded images');
        for (const value of json['images']) {
            const item = object(value, 'GLB image');
            let data: Uint8Array;
            let mime: unknown = item['mimeType'];
            if (typeof item['uri'] === 'string') {
                if (item['bufferView'] !== undefined)
                    throw new Error('GLB image cannot have both URI and buffer view');
                mime = item['uri'].slice(5, item['uri'].indexOf(';'));
                data = decode(item['uri'].slice(item['uri'].indexOf(',') + 1));
            } else {
                const index = item['bufferView'];
                if (typeof index !== 'number' || !Number.isSafeInteger(index) || !views[index])
                    throw new Error('GLB image references a missing buffer view');
                data = views[index];
            }
            if (mime !== 'image/png' && mime !== 'image/jpeg' && mime !== 'image/webp')
                throw new Error('GLB images must use PNG, JPEG or WebP');
            imageDimensions(data, mime);
            imageData.push({ bytes: data, mime, copies: 1 });
        }
    }
    if (json['textures'] !== undefined) {
        if (!Array.isArray(json['textures']) || json['textures'].length > 4096)
            throw new Error('GLB supports at most 4096 textures');
        const references = new Map<number, number>();
        for (const value of json['textures']) {
            const texture = object(value, 'GLB texture');
            const sources = new Set<number>();
            const add = (index: unknown): void => {
                if (index === undefined) return;
                if (typeof index !== 'number' || !Number.isSafeInteger(index) || !imageData[index])
                    throw new Error('GLB texture references a missing image');
                sources.add(index);
            };
            add(texture['source']);
            if (texture['extensions'] !== undefined) {
                for (const extension of Object.values(
                    object(texture['extensions'], 'GLB texture extensions')
                ))
                    add(object(extension, 'GLB texture extension')['source']);
            }
            for (const index of sources) references.set(index, (references.get(index) ?? 0) + 1);
        }
        for (const [index, image] of imageData.entries())
            image.copies = Math.max(1, references.get(index) ?? 0);
    }
    return imageData;
}

function validateBytes(bytes: Uint8Array, mime: ProjectAsset['mimeType']): EmbeddedImage[] {
    if (bytes.length < 1 || bytes.length > MAX_ASSET_BYTES)
        throw new Error('Assets must contain 1 byte to 16 MiB');
    if (mime === 'model/gltf-binary') return glb(bytes);
    imageDimensions(bytes, mime);
    return [{ bytes, mime, copies: 1 }];
}

/** Validate a bundled asset before allowing it to enter a project or create a Blob URL. */
export function validateAsset(value: unknown): ProjectAsset {
    const input = object(value, 'asset');
    fields(input, ['id', 'name', 'kind', 'mimeType', 'size', 'hash', 'source', 'data'], 'asset');
    const id = input['id'];
    const hash = input['hash'];
    if (
        typeof id !== 'string' ||
        id.length > 64 ||
        !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-[a-f0-9]{12}$/u.test(id)
    )
        throw new Error(
            'Asset ID must be semantic kebab-case with a 12-character content hash suffix'
        );
    if (
        typeof hash !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(hash) ||
        !id.endsWith(hash.slice(0, 12))
    )
        throw new Error('Asset hash and ID do not match');
    const mimeType = input['mimeType'];
    if (
        mimeType !== 'model/gltf-binary' &&
        mimeType !== 'image/png' &&
        mimeType !== 'image/jpeg' &&
        mimeType !== 'image/webp'
    )
        throw new Error('Unsupported asset MIME type');
    const kind = mimeType === 'model/gltf-binary' ? 'model' : 'texture';
    if (input['kind'] !== kind || typeof input['data'] !== 'string')
        throw new Error('Asset kind or data is invalid');
    const cached = verifiedPayloads.get(hash);
    let size: number;
    if (
        cached?.data === input['data'] &&
        cached.size === input['size'] &&
        cached.mimeType === mimeType
    ) {
        size = cached.size;
        rememberPayload(hash, cached);
    } else {
        const bytes = decode(input['data']);
        if (input['size'] !== bytes.length || assetHash(bytes) !== hash)
            throw new Error('Asset payload checksum or size mismatch');
        const images = validateBytes(bytes, mimeType);
        const decodedImageBytes = images.reduce((total, image) => {
            const shape = imageDimensions(image.bytes, image.mime);
            return total + shape.width * shape.height * 4 * image.copies;
        }, 0);
        size = bytes.length;
        rememberPayload(hash, { data: input['data'], size, mimeType, decodedImageBytes });
    }
    const source = object(input['source'], 'asset.source');
    fields(
        source,
        ['fileName', 'importedAt', 'license', 'attribution', 'originURL'],
        'asset.source'
    );
    const importedAt = source['importedAt'];
    if (
        typeof importedAt !== 'string' ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(importedAt) ||
        !Number.isFinite(Date.parse(importedAt)) ||
        new Date(importedAt).toISOString() !== importedAt
    )
        throw new Error('Asset import timestamp is invalid');
    const metadata: ProjectAsset['source'] = {
        fileName: name(source['fileName'], 'asset.source.fileName', 255),
        importedAt
    };
    if (source['license'] !== undefined)
        metadata.license = name(source['license'], 'asset.source.license', 120);
    if (source['attribution'] !== undefined)
        metadata.attribution = name(source['attribution'], 'asset.source.attribution', 2000);
    if (source['originURL'] !== undefined) {
        const url = new URL(name(source['originURL'], 'asset.source.originURL', 2048));
        if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password)
            throw new Error('Asset source URL must be HTTP(S) without embedded credentials.');
        if (url.href.length > 2048)
            throw new Error('Canonical asset source URL exceeds 2048 characters.');
        metadata.originURL = url.href;
    }
    return {
        id,
        name: name(input['name'], 'asset.name', 120),
        kind,
        mimeType,
        size,
        hash,
        source: metadata,
        data: input['data']
    };
}

interface DecodedPayload {
    data: string;
    mimeType: ProjectAsset['mimeType'];
    size: number;
}
const decodedPayloads = new Map<string, DecodedPayload>();
let decodedPayloadBytes = 0;
let decodingTail: Promise<void> = Promise.resolve();

function alreadyDecoded(asset: ProjectAsset): boolean {
    const cached = decodedPayloads.get(asset.hash);
    return (
        cached?.data === asset.data &&
        cached.mimeType === asset.mimeType &&
        cached.size === asset.size
    );
}

function rememberDecoded(asset: ProjectAsset): void {
    const previous = decodedPayloads.get(asset.hash);
    if (previous) decodedPayloadBytes -= previous.size;
    decodedPayloads.delete(asset.hash);
    decodedPayloads.set(asset.hash, {
        data: asset.data,
        mimeType: asset.mimeType,
        size: asset.size
    });
    decodedPayloadBytes += asset.size;
    while (decodedPayloadBytes > 64 * 1024 * 1024 || decodedPayloads.size > 128) {
        const oldest = decodedPayloads.keys().next().value;
        if (!oldest) break;
        decodedPayloadBytes -= decodedPayloads.get(oldest)?.size ?? 0;
        decodedPayloads.delete(oldest);
    }
}

async function ensureAssetDecoded(asset: ProjectAsset): Promise<void> {
    if (alreadyDecoded(asset)) {
        rememberDecoded(asset);
        return;
    }
    const task = decodingTail.then(async () => {
        if (alreadyDecoded(asset)) {
            rememberDecoded(asset);
            return;
        }
        const images = validateBytes(decode(asset.data), asset.mimeType);
        for (const image of images) {
            let bitmap: ImageBitmap;
            try {
                bitmap = await createImageBitmap(
                    new Blob([new Uint8Array(image.bytes)], { type: image.mime })
                );
            } catch (cause) {
                throw new Error(
                    `Unable to decode asset "${asset.name}" (${image.mime}). Its image data is corrupt or unsupported.`,
                    { cause }
                );
            }
            try {
                dimensions(bitmap.width, bitmap.height);
                const header = imageDimensions(image.bytes, image.mime);
                // JPEG orientation may swap width and height, while decoded pixel count is stable.
                if (bitmap.width * bitmap.height !== header.width * header.height)
                    throw new Error(
                        `Decoded dimensions disagree with the header for asset "${asset.name}"`
                    );
            } finally {
                bitmap.close();
            }
        }
        rememberDecoded(asset);
    });
    // A failed decode must not poison later project imports. One decoder at a time also bounds
    // temporary image memory across overlapping import/recovery/collaboration operations.
    decodingTail = task.catch(() => undefined);
    await task;
}

/** Decode-check local asset bytes before activating imported, restored or remotely supplied projects. */
export async function validateProjectAssetDecoding(
    assets: Readonly<Record<string, ProjectAsset>>
): Promise<void> {
    const entries = Object.entries(assets);
    if (entries.length > 128) throw new Error('Projects support at most 128 assets');
    let sourceBytes = 0;
    const checked = entries.map(([id, value]) => {
        const asset = validateAsset(value);
        if (id !== asset.id) throw new Error(`Asset record key does not match ${asset.id}`);
        sourceBytes += asset.size;
        if (sourceBytes > 64 * 1024 * 1024) throw new Error('Project asset data exceeds 64 MiB');
        return asset;
    });
    for (const asset of checked) await ensureAssetDecoded(asset);
}

/** Import supported local bytes; no URL fetch or external model dependency is accepted. */
export async function importAsset(file: File): Promise<ProjectAsset> {
    if (file.size < 1 || file.size > MAX_ASSET_BYTES)
        throw new Error('Assets must contain 1 byte to 16 MiB');
    const extension = file.name.split('.').pop()?.toLowerCase();
    const mimeType =
        extension === 'glb'
            ? 'model/gltf-binary'
            : extension === 'png'
              ? 'image/png'
              : extension === 'jpg' || extension === 'jpeg'
                ? 'image/jpeg'
                : extension === 'webp'
                  ? 'image/webp'
                  : null;
    if (!mimeType) throw new Error('Import a GLB, PNG, JPEG, or WebP file');
    const bytes = new Uint8Array(await file.arrayBuffer());
    validateBytes(bytes, mimeType);
    const hash = assetHash(bytes);
    let stem = file.name
        .replace(/\.[^.]+$/u, '')
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, '-')
        .replace(/^-+|-+$/gu, '')
        .slice(0, 40)
        .replace(/-+$/u, '');
    if (!/^[a-z]/u.test(stem)) stem = `asset-${stem || 'source'}`;
    const asset = validateAsset({
        id: `${stem}-${hash.slice(0, 12)}`,
        name: file.name.slice(0, 120),
        kind: mimeType === 'model/gltf-binary' ? 'model' : 'texture',
        mimeType,
        size: bytes.length,
        hash,
        source: { fileName: file.name, importedAt: new Date().toISOString() },
        data: encode(bytes)
    });
    await validateProjectAssetDecoding({ [asset.id]: asset });
    return asset;
}

/** Estimate decoded RGBA bytes from validated headers before any image decode or GPU allocation. */
export function assetDecodedImageBytes(asset: ProjectAsset): number {
    const checked = validateAsset(asset);
    const cached = verifiedPayloads.get(checked.hash);
    if (cached?.data !== checked.data || cached.mimeType !== checked.mimeType)
        throw new Error('Validated asset metadata is unavailable');
    return cached.decodedImageBytes;
}

/** Create a caller-owned URL; call URL.revokeObjectURL after replacing or releasing its resource. */
export function assetURL(asset: ProjectAsset): string {
    const checked = validateAsset(asset);
    return URL.createObjectURL(new Blob([decode(checked.data)], { type: checked.mimeType }));
}
