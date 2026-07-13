import { describe, expect, it } from 'vitest';
import { RGBA, UNSIGNED_BYTE } from '../../../src/constants/webgl';
import { RGBA8 } from '../../../src/constants/webgl2';
import TGALoader, { type TGAHeader } from './TGALoader';

const header: TGAHeader = {
    idLength: 0,
    colorMapType: 0,
    dataTypeCode: 2,
    colorMapOrigin: 0,
    colorMapLength: 0,
    colorMapDepth: 0,
    xOrigin: 0,
    yOrigin: 0,
    width: 2,
    height: 1,
    bitsPerPixel: 32,
    bytesPerPixel: 4,
    imageDescriptor: 0x20
};

describe('TGALoader WebGPU-compatible texture declaration', () => {
    it('creates an explicit RGBA8 unsigned-byte data texture', () => {
        const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]);

        const texture = new TGALoader().createTexture(header, pixels);

        expect(texture.internalFormat).toBe(RGBA8);
        expect(texture.format).toBe(RGBA);
        expect(texture.type).toBe(UNSIGNED_BYTE);
        expect(texture.width).toBe(2);
        expect(texture.height).toBe(1);
        expect(texture.image).toBe(pixels);
    });
});
