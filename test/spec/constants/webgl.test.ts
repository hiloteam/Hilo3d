import { describe, expect, it } from 'vitest';
import * as webgl from '../../../src/constants/webgl';
import * as webgl2 from '../../../src/constants/webgl2';

describe('constants/webgl', () => {
    it('matches WebGL 2 context constants', () => {
        const gl = document.createElement('canvas').getContext('webgl2');
        if (!gl) throw new Error('Expected the test browser to provide WebGL 2');

        for (const [name, value] of Object.entries(webgl)) {
            const contextValue: unknown = Reflect.get(gl, name);
            if (typeof contextValue === 'number') {
                expect(value).toBe(contextValue);
            }
        }
    });

    it('matches WebGL 2 constants', () => {
        const gl = document.createElement('canvas').getContext('webgl2');
        if (!gl) throw new Error('Expected the test browser to provide WebGL 2');

        for (const [name, value] of Object.entries(webgl2)) {
            const contextValue: unknown = Reflect.get(gl, name);
            if (typeof contextValue === 'number') expect(value, name).toBe(contextValue);
        }
    });
});
