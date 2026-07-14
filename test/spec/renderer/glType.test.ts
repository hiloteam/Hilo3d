import { describe, expect, it } from 'vitest';
import { FLOAT_VEC3 } from '../../../src/constants/webgl';
import glType from '../../../src/render/internal/webgl2/glType';

describe('glType', () => {
    it('get', () => {
        const info = glType.get(FLOAT_VEC3);
        expect(info.name).toBe('FLOAT_VEC3');
        expect(info.glValue).toBe(FLOAT_VEC3);
    });
});
