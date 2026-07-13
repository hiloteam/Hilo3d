import { describe, expect, it, vi } from 'vitest';
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
        expect(Buffer.getCache(testEnv.gl).getObject(buffer)).toBe(buffer);
        buffer.destroy();
        expect(Buffer.getCache(testEnv.gl).getObject(buffer)).toBeUndefined();
    });

    it('tracks uploaded revisions independently for every WebGL2 allocation', () => {
        const geometryData = new Hilo3d.GeometryData(new Float32Array([0, 1, 2, 3]), 2);
        const first = new Buffer(testEnv.gl, testEnv.gl.ARRAY_BUFFER, geometryData.data);
        const second = new Buffer(testEnv.gl, testEnv.gl.ARRAY_BUFFER, geometryData.data);
        first.uploadGeometryData(geometryData);
        second.uploadGeometryData(geometryData);
        const subData = vi.spyOn(testEnv.gl, 'bufferSubData');

        geometryData.setSubData(2, new Float32Array([8, 9]));
        first.uploadGeometryData(geometryData);

        expect(first.needsGeometryDataUpload(geometryData)).toBe(false);
        expect(second.needsGeometryDataUpload(geometryData)).toBe(true);
        expect(geometryData.isDirty).toBe(true);
        second.uploadGeometryData(geometryData);
        expect(second.needsGeometryDataUpload(geometryData)).toBe(false);
        expect(subData).toHaveBeenCalledTimes(2);

        first.destroy();
        second.destroy();
    });
});
