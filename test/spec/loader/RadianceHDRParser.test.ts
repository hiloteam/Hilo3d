import { describe, expect, it } from 'vitest';
import { parseRadianceHDR } from '../../../src/loader/RadianceHDRParser';

function hdrBytes(
    resolution: string,
    pixels: readonly number[],
    fields: readonly string[] = []
): Uint8Array {
    const header = new TextEncoder().encode(
        ['#?RADIANCE', 'FORMAT=32-bit_rle_rgbe', ...fields, '', resolution, ''].join('\n')
    );
    const result = new Uint8Array(header.length + pixels.length);
    result.set(header);
    result.set(pixels, header.length);
    return result;
}

describe('parseRadianceHDR', () => {
    it('parses raw RGBE pixels and metadata', () => {
        const image = parseRadianceHDR(
            hdrBytes('-Y 1 +X 2', [128, 64, 32, 129, 1, 2, 3, 128], ['EXPOSURE=2', 'GAMMA=2.2'])
        );

        expect(image.shape).toEqual([2, 1]);
        expect(image.exposure).toBe(2);
        expect(image.gamma).toBe(2.2);
        expect([...image.data]).toEqual([1, 0.5, 0.25, 1, 1 / 256, 2 / 256, 3 / 256, 1]);
    });

    it('decodes modern per-channel RLE scanlines', () => {
        const image = parseRadianceHDR(
            hdrBytes('-Y 1 +X 8', [2, 2, 0, 8, 136, 128, 136, 64, 136, 32, 136, 129])
        );

        expect(image.shape).toEqual([8, 1]);
        for (let index = 0; index < 8; index++) {
            expect([...image.data.slice(index * 4, index * 4 + 4)]).toEqual([1, 0.5, 0.25, 1]);
        }
    });

    it('normalizes reversed image orientation', () => {
        const image = parseRadianceHDR(hdrBytes('+Y 1 -X 2', [128, 0, 0, 129, 0, 128, 0, 129]));

        expect([...image.data]).toEqual([0, 1, 0, 1, 1, 0, 0, 1]);
    });

    it('rejects malformed and truncated images', () => {
        expect(() => parseRadianceHDR(new TextEncoder().encode('#?OTHER\n'))).toThrow(
            'Unsupported HDR signature'
        );
        expect(() => parseRadianceHDR(hdrBytes('-Y 1 +X 8', [2, 2, 0, 8, 136, 1]))).toThrow(
            'Unexpected end of HDR data'
        );
    });
});
