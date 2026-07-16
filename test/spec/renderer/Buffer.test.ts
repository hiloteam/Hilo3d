import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import { testEnv } from '../../setup';

const Buffer = Hilo3d.Buffer;

describe('Buffer', () => {
    it('create', () => {
        const buffer = new Buffer(testEnv.gl);
        expect(buffer.isBuffer).toBe(true);
        expect(buffer.className).toBe('Buffer');
    });

    it('cache & destroy', () => {
        const geometryData = new Hilo3d.GeometryData(new Float32Array(), 3);
        const buffer = Buffer.createVertexBuffer(testEnv.gl, geometryData);
        expect(Buffer.cache.getObject(buffer)).toBe(buffer);
        buffer.destroy();
        expect(Buffer.cache.getObject(buffer)).toBeUndefined();
    });
});
