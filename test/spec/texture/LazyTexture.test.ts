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
});
