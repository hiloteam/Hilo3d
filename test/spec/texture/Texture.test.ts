import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const Texture = Hilo3d.Texture;

describe('Texture', () => {
    it('create', () => {
        const texture = new Texture();
        expect(texture.isTexture).toBe(true);
        expect(texture.className).toBe('Texture');
    });

    it('isImgPowerOfTwo', () => {
        const texture = new Texture();
        const img = new Image();
        img.width = 100;
        img.height = 100;

        expect(texture.isImgPowerOfTwo(img)).toBe(false);
        img.width = 512;
        expect(texture.isImgPowerOfTwo(img)).toBe(false);
        img.height = 1024;
        expect(texture.isImgPowerOfTwo(img)).toBe(true);
    });

    it('resizeImgToPowerOfTwo', async () => {
        const texture = new Texture();
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
            img.onload = () => {
                resolve();
            };
            img.onerror = () => {
                reject(new Error('fixture image failed to load'));
            };
            img.src = '/test/asset/images/logo.png';
        });
        expect(texture.isImgPowerOfTwo(img)).toBe(false);
        expect(texture.isImgPowerOfTwo(texture.resizeImgToPowerOfTwo(img))).toBe(true);
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

            size = texture.getSupportSize(img, true);
            expect(size.width).toBe(4096);
            expect(size.height).toBe(2048);

            img.width = 4097;
            img.height = 4097;
            size = texture.getSupportSize(img, true);
            expect(size.width).toBe(4096);
            expect(size.height).toBe(4096);

            img.width = 4097;
            img.height = 19_999;
            Hilo3d.capabilities.MAX_TEXTURE_SIZE = 20_000;
            size = texture.getSupportSize(img, true);
            expect(size.width).toBe(8192);
            expect(size.height).toBe(20_000);
        } finally {
            Hilo3d.capabilities.MAX_TEXTURE_SIZE = originMaxTextureSize;
        }
    });
});
