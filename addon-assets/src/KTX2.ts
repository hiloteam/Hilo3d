import type { TextureAssetSource, AssetTextureCapabilities, AssetTextureFormat } from './types.js';

const identifier = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

/** Validate the deliberately bounded 2D ETC1S/UASTC KTX2 contract before entering WASM. */
export function inspectKTX2(
    data: ArrayBuffer,
    source: Readonly<TextureAssetSource>
): 'linear' | 'srgb' {
    if (
        ![source.width, source.height, source.mipLevelCount, source.byteLength].every(
            value => Number.isSafeInteger(value) && value > 0
        ) ||
        source.width > 16384 ||
        source.height > 16384 ||
        source.mipLevelCount !== Math.floor(Math.log2(Math.max(source.width, source.height))) + 1
    )
        throw new RangeError('KTX2 manifest dimensions or full mip count are invalid.');
    const bytes = new Uint8Array(data);
    if (bytes.length < 104 || identifier.some((value, index) => bytes[index] !== value)) {
        throw new TypeError('Asset is not a KTX2 container.');
    }
    if (bytes.length !== source.byteLength)
        throw new RangeError('KTX2 byte length differs from its manifest.');
    const view = new DataView(data);
    const u32 = (offset: number): number => view.getUint32(offset, true);
    if (u32(12) !== 0 || u32(16) !== 1 || u32(28) !== 0 || u32(32) !== 0 || u32(36) !== 1) {
        throw new TypeError(
            'Only Basis-compressed, non-array, non-cube 2D KTX2 assets are supported.'
        );
    }
    if (u32(20) !== source.width || u32(24) !== source.height || u32(40) !== source.mipLevelCount) {
        throw new RangeError('KTX2 dimensions or mip count differ from its manifest.');
    }
    const indexEnd = 80 + source.mipLevelCount * 24;
    const ranges: { start: number; end: number }[] = [{ start: 0, end: indexEnd }];
    const range = (offset: number, length: number): void => {
        if (
            !Number.isSafeInteger(offset) ||
            !Number.isSafeInteger(length) ||
            offset < indexEnd ||
            length <= 0 ||
            offset + length > bytes.length
        ) {
            throw new RangeError('KTX2 contains an invalid section range.');
        }
        if (ranges.some(value => offset < value.end && offset + length > value.start))
            throw new RangeError('KTX2 sections overlap.');
        ranges.push({ start: offset, end: offset + length });
    };
    if (indexEnd > bytes.length) throw new RangeError('KTX2 mip index is truncated.');
    for (let level = 0; level < source.mipLevelCount; level++) {
        range(
            Number(view.getBigUint64(80 + level * 24, true)),
            Number(view.getBigUint64(88 + level * 24, true))
        );
    }
    const dfd = u32(48),
        dfdLength = u32(52),
        kvd = u32(56),
        kvdLength = u32(60);
    range(dfd, dfdLength);
    if (dfdLength < 28 || u32(dfd) !== dfdLength)
        throw new RangeError('Invalid KTX2 data format descriptor.');
    const model = bytes[dfd + 12],
        transfer = bytes[dfd + 14];
    if (model !== 163 && model !== 166)
        throw new TypeError('Only ETC1S and UASTC LDR KTX2 codecs are supported.');
    if (transfer !== 1 && transfer !== 2)
        throw new TypeError('KTX2 must use linear or sRGB transfer.');
    if ((bytes[dfd + 15] ?? 0) !== 0)
        throw new TypeError('Premultiplied KTX2 assets are unsupported.');
    const scheme = u32(44);
    if ((model === 163 && scheme !== 1) || (model === 166 && scheme !== 0 && scheme !== 2))
        throw new TypeError('Unsupported KTX2 supercompression scheme.');
    const sgdLength = Number(view.getBigUint64(72, true));
    if (sgdLength > 0) range(Number(view.getBigUint64(64, true)), sgdLength);
    if (model === 163 && sgdLength === 0) throw new TypeError('ETC1S requires global codebooks.');
    if (kvdLength > 0) {
        range(kvd, kvdLength);
        const decoder = new TextDecoder('utf-8', { fatal: true });
        for (let offset = kvd; offset < kvd + kvdLength;) {
            if (offset + 4 > kvd + kvdLength)
                throw new RangeError('Truncated KTX2 key/value length.');
            const length = u32(offset);
            offset += 4;
            if (length < 2 || offset + length > kvd + kvdLength)
                throw new RangeError('Invalid KTX2 key/value entry.');
            const entry = bytes.subarray(offset, offset + length);
            const separator = entry.indexOf(0);
            if (separator < 1) throw new TypeError('KTX2 metadata key is unterminated.');
            const key = decoder.decode(entry.subarray(0, separator));
            const value = decoder.decode(entry.subarray(separator + 1)).replace(/\0+$/u, '');
            if (key === 'KTXorientation' && value !== 'rd')
                throw new TypeError('KTX2 assets must use top-left rd orientation.');
            if (key === 'KTXswizzle' && value !== 'rgba')
                throw new TypeError('KTX2 channel swizzles must be baked before streaming.');
            offset += Math.ceil(length / 4) * 4;
            if (offset > kvd + kvdLength)
                throw new RangeError('KTX2 metadata padding is truncated.');
        }
    }
    return transfer === 2 ? 'srgb' : 'linear';
}

/** Deterministic family choice; RGBA8 is the portable last resort. */
export function selectTextureFormat(
    capabilities: Readonly<AssetTextureCapabilities>,
    source?: Readonly<TextureAssetSource>,
    mipLevel = 0
): AssetTextureFormat {
    if (
        source &&
        (Math.max(1, Math.floor(source.width / 2 ** mipLevel)) % 4 !== 0 ||
            Math.max(1, Math.floor(source.height / 2 ** mipLevel)) % 4 !== 0)
    )
        return 'rgba8';
    return capabilities.astc
        ? 'astc'
        : capabilities.bc
          ? 'bc3'
          : capabilities.etc2
            ? 'etc2'
            : 'rgba8';
}

/** Exact tightly packed texel payload for a complete suffix of the authored mip chain. */
export function textureByteLength(
    source: Readonly<TextureAssetSource>,
    mipLevel: number,
    format: AssetTextureFormat
): number {
    let total = 0;
    for (let level = mipLevel; level < source.mipLevelCount; level++) {
        const width = Math.max(1, Math.floor(source.width / 2 ** level));
        const height = Math.max(1, Math.floor(source.height / 2 ** level));
        total +=
            format === 'rgba8'
                ? width * height * 4
                : Math.ceil(width / 4) * Math.ceil(height / 4) * 16;
    }
    return total;
}
