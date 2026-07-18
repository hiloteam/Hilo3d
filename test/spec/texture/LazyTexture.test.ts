import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const LazyTexture = Hilo3d.LazyTexture;

describe('LazyTexture', () => {
    it('create', () => {
        const texture = new LazyTexture();
        expect(texture.isLazyTexture).toBe(true);
        expect(texture.className).toBe('LazyTexture');
    });

    it('load', () => {
        return new Promise<void>((resolve, reject) => {
            const texture = new LazyTexture({
                src: '/test/asset/images/logo.png'
            });

            texture.on('load', () => {
                if (!(texture.image instanceof HTMLImageElement)) {
                    reject(new TypeError('Expected LazyTexture to load an HTMLImageElement'));
                    return;
                }
                expect(texture.image.width).toBe(600);
                resolve();
            });

            texture.on('error', () => {
                reject(new Error('load error!'));
            });
        });
    });

    it('validates constructor parameters and copies layered depth/wrapR from loaded textures', async () => {
        expect(() => new LazyTexture({ depth: 2 })).toThrow(/depth must be 1/);
        const previousLoader = LazyTexture.loader;
        const loaded = new Hilo3d.Texture({
            target: Hilo3d.constants.TEXTURE_3D,
            width: 1,
            height: 1,
            depth: 2,
            wrapR: Hilo3d.constants.CLAMP_TO_EDGE,
            image: new Uint8Array(8)
        });
        LazyTexture.loader = {
            load: () => Promise.resolve(loaded)
        } as unknown as Hilo3d.Loader;
        try {
            const texture = new LazyTexture({ autoLoad: false, src: 'memory://volume' });
            await texture.load();
            expect(texture.target).toBe(Hilo3d.constants.TEXTURE_3D);
            expect(texture.depth).toBe(2);
            expect(texture.wrapR).toBe(Hilo3d.constants.CLAMP_TO_EDGE);
        } finally {
            LazyTexture.loader = previousLoader;
        }
    });
});
