import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import { testEnv } from '../../setup';

const capabilities = Hilo3d.capabilities;

describe('capabilities', () => {
    const gl = testEnv.gl;

    it('init', () => {
        capabilities.init(gl);

        const names = [
            'MAX_RENDERBUFFER_SIZE',
            'MAX_COMBINED_TEXTURE_IMAGE_UNITS',
            'MAX_CUBE_MAP_TEXTURE_SIZE',
            'MAX_FRAGMENT_UNIFORM_VECTORS',
            'MAX_TEXTURE_IMAGE_UNITS',
            'MAX_TEXTURE_SIZE',
            'MAX_VARYING_VECTORS',
            'MAX_VERTEX_ATTRIBS',
            'MAX_VERTEX_TEXTURE_IMAGE_UNITS',
            'MAX_VERTEX_UNIFORM_VECTORS'
        ] as const;
        const glEnums: Record<(typeof names)[number], GLenum> = {
            MAX_RENDERBUFFER_SIZE: gl.MAX_RENDERBUFFER_SIZE,
            MAX_COMBINED_TEXTURE_IMAGE_UNITS: gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS,
            MAX_CUBE_MAP_TEXTURE_SIZE: gl.MAX_CUBE_MAP_TEXTURE_SIZE,
            MAX_FRAGMENT_UNIFORM_VECTORS: gl.MAX_FRAGMENT_UNIFORM_VECTORS,
            MAX_TEXTURE_IMAGE_UNITS: gl.MAX_TEXTURE_IMAGE_UNITS,
            MAX_TEXTURE_SIZE: gl.MAX_TEXTURE_SIZE,
            MAX_VARYING_VECTORS: gl.MAX_VARYING_VECTORS,
            MAX_VERTEX_ATTRIBS: gl.MAX_VERTEX_ATTRIBS,
            MAX_VERTEX_TEXTURE_IMAGE_UNITS: gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS,
            MAX_VERTEX_UNIFORM_VECTORS: gl.MAX_VERTEX_UNIFORM_VECTORS
        };

        for (const name of names) {
            const expected: unknown = gl.getParameter(glEnums[name]);
            expect(Reflect.get(capabilities, name)).toBe(expected);
        }
    });

    it('getMaxPrecision', () => {
        expect(capabilities.getMaxPrecision('highp', 'highp')).toBe('highp');
        expect(capabilities.getMaxPrecision('highp', 'mediump')).toBe('mediump');
        expect(capabilities.getMaxPrecision('highp', 'lowp')).toBe('lowp');

        expect(capabilities.getMaxPrecision('mediump', 'highp')).toBe('mediump');
        expect(capabilities.getMaxPrecision('mediump', 'mediump')).toBe('mediump');
        expect(capabilities.getMaxPrecision('mediump', 'lowp')).toBe('lowp');

        expect(capabilities.getMaxPrecision('lowp', 'highp')).toBe('lowp');
        expect(capabilities.getMaxPrecision('lowp', 'mediump')).toBe('lowp');
        expect(capabilities.getMaxPrecision('lowp', 'lowp')).toBe('lowp');
    });

    it('get', () => {
        expect(capabilities.get('MAX_VERTEX_TEXTURE_IMAGE_UNITS')).toBe(
            gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS)
        );
    });
});
