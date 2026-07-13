import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import { testEnv } from '../../setup';

const VertexArrayObject = Hilo3d.VertexArrayObject;

describe('VertexArrayObject', () => {
    it('create', () => {
        const vao = new VertexArrayObject(testEnv.gl, '_hiloTestVaoCreate');
        expect(vao.isVertexArrayObject).toBe(true);
        expect(vao.className).toBe('VertexArrayObject');
    });

    it('cache & destroy', () => {
        const vao = VertexArrayObject.getVao(testEnv.gl, '_hiloTestVao');
        expect(VertexArrayObject.cache.get('_hiloTestVao')).toBe(vao);
        expect(vao.destroy()).toBe(vao);
        expect(VertexArrayObject.cache.get('_hiloTestVao')).toBeUndefined();
        expect(vao.getResources()).toEqual([]);
        expect(vao.destroy()).toBe(vao);
    });

    it('getVertexCount', () => {
        const vao = VertexArrayObject.getVao(testEnv.gl, '_hiloTestVao');
        expect(vao.getVertexCount()).toBe(0);
    });
});
