import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const CubeTexture = Hilo3d.CubeTexture;

describe('CubeTexture', () => {
    it('create', () => {
        const texture = new CubeTexture();
        expect(texture.isCubeTexture).toBe(true);
        expect(texture.className).toBe('CubeTexture');
    });

    it('images', () => {
        const images = [
            new Image(),
            new Image(),
            new Image(),
            new Image(),
            new Image(),
            new Image()
        ];
        const texture = new CubeTexture({ image: images });

        expect(texture.right).toBe(images[0]);
        expect(texture.left).toBe(images[1]);
        expect(texture.top).toBe(images[2]);
        expect(texture.bottom).toBe(images[3]);
        expect(texture.front).toBe(images[4]);
        expect(texture.back).toBe(images[5]);
    });
});
