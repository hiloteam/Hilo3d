import { describe, expect, it } from 'vitest';
import * as webgl from '../../../src/constants/webgl';
import * as webgl2 from '../../../src/constants/webgl2';

describe('constants/webgl', () => {
    it('matches WebGL context constants', () => {
        const gl = document.createElement('canvas').getContext('webgl');
        if (!gl) throw new Error('Expected the test browser to provide WebGL');

        for (const [name, value] of Object.entries(webgl)) {
            const contextValue: unknown = Reflect.get(gl, name);
            if (typeof contextValue === 'number') {
                expect(value).toBe(contextValue);
            }
        }
    });

    it('matches WebGL2 copy-buffer binding constants', () => {
        const gl = document.createElement('canvas').getContext('webgl2');
        if (!gl) return;

        expect(webgl2.COPY_READ_BUFFER_BINDING).toBe(gl.COPY_READ_BUFFER_BINDING);
        expect(webgl2.COPY_WRITE_BUFFER_BINDING).toBe(gl.COPY_WRITE_BUFFER_BINDING);
    });
});
