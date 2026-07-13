import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const Texture = Hilo3d.Texture;

describe('Texture', () => {
    it('create', () => {
        const texture = new Texture();
        expect(texture.isTexture).toBe(true);
        expect(texture.className).toBe('Texture');
        expect(texture.mipmapCount).toBe(1);
    });

    it('getSupportSize', () => {
        const texture = new Texture();
        const img = new Image();
        img.width = 1_024_000;
        img.height = 2040;
        const originMaxTextureSize = Hilo3d.capabilities.MAX_TEXTURE_SIZE;

        try {
            Hilo3d.capabilities.MAX_TEXTURE_SIZE = 0;
            let size = texture.getSupportSize(img);
            expect(size.width).toBe(img.width);
            expect(size.height).toBe(img.height);

            Hilo3d.capabilities.MAX_TEXTURE_SIZE = 4096;
            size = texture.getSupportSize(img);
            expect(size.width).toBe(4096);
            expect(size.height).toBe(2040);

            img.width = 4097;
            img.height = 4097;
            size = texture.getSupportSize(img);
            expect(size.width).toBe(4096);
            expect(size.height).toBe(4096);

            img.width = 4097;
            img.height = 19_999;
            Hilo3d.capabilities.MAX_TEXTURE_SIZE = 20_000;
            size = texture.getSupportSize(img);
            expect(size.width).toBe(4097);
            expect(size.height).toBe(19_999);
        } finally {
            Hilo3d.capabilities.MAX_TEXTURE_SIZE = originMaxTextureSize;
        }
    });
});
