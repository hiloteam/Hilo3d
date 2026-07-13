import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import { testEnv } from '../../setup';

const extensions = Hilo3d.extensions;

describe('extensions', () => {
    it('init', () => {
        extensions.init(testEnv.gl);

        expect(extensions.instanced).not.toBeNull();
        expect(extensions.vao).not.toBeNull();
        expect(extensions.get('ANGLE_instanced_arrays', 'instanced')).toBe(extensions.instanced);
        expect(extensions.get('OES_vertex_array_object', 'vao')).toBe(extensions.vao);
        expect(extensions.texFloat).toBe(testEnv.gl.getExtension('OES_texture_float'));
        expect(extensions.loseContext).toBe(testEnv.gl.getExtension('WEBGL_lose_context'));
        expect(extensions.uintIndices).toBe(testEnv.gl.getExtension('OES_element_index_uint'));
    });

    it('enable & disable', () => {
        extensions.disable('ANGLE_instanced_arrays');
        expect(extensions.get('ANGLE_instanced_arrays')).toBeNull();
        extensions.enable('ANGLE_instanced_arrays');
        expect(extensions.get('ANGLE_instanced_arrays')).not.toBeNull();
    });
});
