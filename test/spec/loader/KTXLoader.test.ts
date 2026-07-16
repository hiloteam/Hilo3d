import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const KTXLoader = Hilo3d.KTXLoader;
type KTXLoadRequest = Parameters<InstanceType<typeof KTXLoader>['createTexture']>[0];

function createKTX(mipmapLevels: number, littleEndian = true): ArrayBuffer {
    const headerLength = 12 + 13 * Uint32Array.BYTES_PER_ELEMENT;
    const levelLength = Uint32Array.BYTES_PER_ELEMENT + 8;
    const buffer = new ArrayBuffer(headerLength + mipmapLevels * levelLength);
    new Uint8Array(buffer).set([
        0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a
    ]);
    const header = new DataView(buffer, 12);
    const values = [
        0x04030201,
        0,
        1,
        0,
        0x83f0,
        Hilo3d.constants.RGB,
        4,
        4,
        0,
        0,
        1,
        mipmapLevels,
        0
    ];
    values.forEach((value, index) => {
        header.setUint32(index * Uint32Array.BYTES_PER_ELEMENT, value, littleEndian);
    });
    for (let level = 0; level < mipmapLevels; level++) {
        const levelOffset = headerLength + level * levelLength;
        new DataView(buffer).setUint32(levelOffset, 8, littleEndian);
        new Uint8Array(buffer, levelOffset + Uint32Array.BYTES_PER_ELEMENT, 8).fill(level + 1);
    }
    return buffer;
}

describe('KTXLoader', () => {
    it('create', () => {
        const loader = new KTXLoader();
        expect(loader.isKTXLoader).toBe(true);
        expect(loader.className).toBe('KTXLoader');
    });

    it.each([1, 2, 3])('accepts a valid %i-level chain for a 4x4 texture', levels => {
        const loader = new KTXLoader();
        const buffer = createKTX(levels);

        const texture = loader.createTexture({ src: buffer }, buffer);

        expect(texture.mipmaps).toHaveLength(levels);
        expect(texture.image).toEqual(texture.mipmaps?.[0]?.data);
    });

    it('reads big-endian headers and mip image sizes using the container marker', () => {
        const loader = new KTXLoader();
        const buffer = createKTX(3, false);

        const texture = loader.createTexture({ src: buffer }, buffer);

        expect(texture.width).toBe(4);
        expect(texture.height).toBe(4);
        expect(texture.mipmaps).toHaveLength(3);
        expect(texture.mipmaps?.[0]?.data).toEqual(new Uint8Array(8).fill(1));
        expect(texture.mipmaps?.[2]?.data).toEqual(new Uint8Array(8).fill(3));
    });

    it('rejects invalid endianness markers instead of assuming an encoding', () => {
        const loader = new KTXLoader();
        const buffer = createKTX(1);
        new DataView(buffer, 12).setUint32(0, 0, true);

        expect(() => loader.createTexture({ src: buffer }, buffer)).toThrow(
            'KTX file has an invalid endianness marker.'
        );
    });

    it('rejects unsupported runtime mipmap generation instead of inventing a base level', () => {
        const loader = new KTXLoader();
        const buffer = createKTX(1);
        const mipLevelCountOffset = 12 + 11 * Uint32Array.BYTES_PER_ELEMENT;
        new DataView(buffer).setUint32(mipLevelCountOffset, 0, true);

        expect(() => loader.createTexture({ src: buffer }, buffer)).toThrow(
            'KTX runtime mipmap generation is not supported.'
        );
    });

    it('allows only the explicit KTX-safe lifecycle, metadata and sampler options', () => {
        const loader = new KTXLoader();
        const buffer = createKTX(2);

        const texture = loader.createTexture(
            {
                src: buffer,
                type: 'ktx',
                isImageCanRelease: true,
                name: 'compressed-texture',
                magFilter: Hilo3d.constants.NEAREST,
                minFilter: Hilo3d.constants.NEAREST,
                wrapS: Hilo3d.constants.CLAMP_TO_EDGE,
                wrapT: Hilo3d.constants.MIRRORED_REPEAT,
                uv: 1,
                anisotropic: 4
            },
            buffer
        );

        expect(texture).toMatchObject({
            width: 4,
            height: 4,
            internalFormat: 0x83f0,
            format: 0,
            type: 0,
            compressed: true,
            isImageCanRelease: true,
            name: 'compressed-texture',
            magFilter: Hilo3d.constants.NEAREST,
            minFilter: Hilo3d.constants.NEAREST,
            wrapS: Hilo3d.constants.CLAMP_TO_EDGE,
            wrapT: Hilo3d.constants.MIRRORED_REPEAT,
            uv: 1,
            anisotropic: 4
        });
        expect(texture.mipmaps).toHaveLength(2);
    });

    it.each([
        'width',
        'height',
        'internalFormat',
        'format',
        'mipmaps',
        'compressed',
        'target',
        'image',
        'flipY'
    ])('rejects the container-authoritative option %s', option => {
        const loader = new KTXLoader();
        const buffer = createKTX(1);
        const request = { src: buffer, [option]: undefined } as unknown as KTXLoadRequest;

        expect(() => loader.createTexture(request, buffer)).toThrow(
            `KTXLoader does not accept option ${option}; container metadata is authoritative.`
        );
    });

    it('rejects a numeric loader type as an attempted texel-type override', () => {
        const loader = new KTXLoader();
        const buffer = createKTX(1);
        const request = {
            src: buffer,
            type: Hilo3d.constants.UNSIGNED_BYTE
        } as unknown as KTXLoadRequest;

        expect(() => loader.createTexture(request, buffer)).toThrow(
            'KTX loader routing type must be a string.'
        );
    });

    it('rejects truncated headers, image-size fields and mip payloads explicitly', () => {
        const loader = new KTXLoader();
        const complete = createKTX(1);
        const headerLength = 12 + 13 * Uint32Array.BYTES_PER_ELEMENT;
        const truncatedHeader = complete.slice(0, headerLength - 1);
        const missingImageSize = complete.slice(0, headerLength);
        const truncatedPayload = complete.slice(0, complete.byteLength - 1);

        expect(() => loader.createTexture({ src: truncatedHeader }, truncatedHeader)).toThrow(
            'KTX header is truncated.'
        );
        expect(() => loader.createTexture({ src: missingImageSize }, missingImageSize)).toThrow(
            'KTX mip level 0 is truncated before imageSize.'
        );
        expect(() => loader.createTexture({ src: truncatedPayload }, truncatedPayload)).toThrow(
            'KTX mip level 0 face 0 data is truncated.'
        );
    });

    it('rejects a chain longer than a 4x4 texture can contain', () => {
        const loader = new KTXLoader();
        const buffer = createKTX(4);

        expect(() => loader.createTexture({ src: buffer }, buffer)).toThrow(
            'KTX mipmap chain has 4 levels; 3 is the maximum for 4x4'
        );
    });
});
