import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const DataTexture = Hilo3d.DataTexture;

describe('DataTexture', () => {
    it('create', () => {
        const texture = new DataTexture();
        expect(texture.isDataTexture).toBe(true);
        expect(texture.className).toBe('DataTexture');
    });

    it('derives power-of-two dimensions when data changes', () => {
        const texture = new DataTexture();
        texture.data = new Float32Array(100);
        expect(texture.width).toBe(4);
        expect(texture.height).toBe(8);

        texture.data = new Float32Array(200);
        expect(texture.width).toBe(8);
        expect(texture.height).toBe(8);
    });

    it('data', () => {
        const texture = new DataTexture({
            data: new Float32Array(100)
        });
        expect(texture.width).toBe(4);
        expect(texture.height).toBe(8);
        expect(texture.image?.length).toBe(128);
    });
});
