import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import { FLOAT_VEC3 } from '../../../src/constants/webgl';

const glType = Hilo3d.glType;

describe('glType', () => {
    it('get', () => {
        const info = glType.get(FLOAT_VEC3);
        expect(info.name).toBe('FLOAT_VEC3');
        expect(info.glValue).toBe(FLOAT_VEC3);
    });
});
