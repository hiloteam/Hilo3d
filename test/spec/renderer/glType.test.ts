import { describe, expect, it } from 'vitest';
import { FLOAT_VEC3 } from '../../../src/constants/webgl';
import glType from '../../../src/render/internal/webgl2/glType';

describe('glType', () => {
    it('get', () => {
        const gl = document.createElement('canvas').getContext('webgl2');
        expect(gl).not.toBeNull();
        if (gl === null) throw new Error('WebGL2 is unavailable');
        glType.init(gl);
        const info = glType.get(FLOAT_VEC3);
        expect(info.name).toBe('FLOAT_VEC3');
        expect(info.glValue).toBe(FLOAT_VEC3);
    });
});
