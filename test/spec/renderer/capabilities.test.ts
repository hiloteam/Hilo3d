import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import { testEnv } from '../../setup';

describe('capabilities', () => {
    const gl = testEnv.gl;
    const extensions = new Hilo3d.WebGLExtensions();
    extensions.init(gl);
    const capabilities = new Hilo3d.WebGLCapabilities(extensions);

    it('init', () => {
        capabilities.init(gl);

        const names = [
            'MAX_RENDERBUFFER_SIZE',
            'MAX_COMBINED_TEXTURE_IMAGE_UNITS',
            'MAX_CUBE_MAP_TEXTURE_SIZE',
            'MAX_FRAGMENT_UNIFORM_COMPONENTS',
            'MAX_TEXTURE_IMAGE_UNITS',
            'MAX_TEXTURE_SIZE',
            'MAX_3D_TEXTURE_SIZE',
            'MAX_ARRAY_TEXTURE_LAYERS',
            'MAX_COLOR_ATTACHMENTS',
            'MAX_DRAW_BUFFERS',
            'MAX_SAMPLES',
            'MAX_VARYING_COMPONENTS',
            'MAX_VERTEX_ATTRIBS',
            'MAX_VERTEX_TEXTURE_IMAGE_UNITS',
            'MAX_VERTEX_UNIFORM_COMPONENTS',
            'MAX_UNIFORM_BUFFER_BINDINGS',
            'MAX_UNIFORM_BLOCK_SIZE',
            'UNIFORM_BUFFER_OFFSET_ALIGNMENT',
            'MAX_COMBINED_UNIFORM_BLOCKS',
            'MAX_VERTEX_UNIFORM_BLOCKS',
            'MAX_FRAGMENT_UNIFORM_BLOCKS'
        ] as const;
        const glEnums: Record<(typeof names)[number], GLenum> = {
            MAX_RENDERBUFFER_SIZE: gl.MAX_RENDERBUFFER_SIZE,
            MAX_COMBINED_TEXTURE_IMAGE_UNITS: gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS,
            MAX_CUBE_MAP_TEXTURE_SIZE: gl.MAX_CUBE_MAP_TEXTURE_SIZE,
            MAX_FRAGMENT_UNIFORM_COMPONENTS: gl.MAX_FRAGMENT_UNIFORM_COMPONENTS,
            MAX_TEXTURE_IMAGE_UNITS: gl.MAX_TEXTURE_IMAGE_UNITS,
            MAX_TEXTURE_SIZE: gl.MAX_TEXTURE_SIZE,
            MAX_3D_TEXTURE_SIZE: gl.MAX_3D_TEXTURE_SIZE,
            MAX_ARRAY_TEXTURE_LAYERS: gl.MAX_ARRAY_TEXTURE_LAYERS,
            MAX_COLOR_ATTACHMENTS: gl.MAX_COLOR_ATTACHMENTS,
            MAX_DRAW_BUFFERS: gl.MAX_DRAW_BUFFERS,
            MAX_SAMPLES: gl.MAX_SAMPLES,
            MAX_VARYING_COMPONENTS: gl.MAX_VARYING_COMPONENTS,
            MAX_VERTEX_ATTRIBS: gl.MAX_VERTEX_ATTRIBS,
            MAX_VERTEX_TEXTURE_IMAGE_UNITS: gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS,
            MAX_VERTEX_UNIFORM_COMPONENTS: gl.MAX_VERTEX_UNIFORM_COMPONENTS,
            MAX_UNIFORM_BUFFER_BINDINGS: gl.MAX_UNIFORM_BUFFER_BINDINGS,
            MAX_UNIFORM_BLOCK_SIZE: gl.MAX_UNIFORM_BLOCK_SIZE,
            UNIFORM_BUFFER_OFFSET_ALIGNMENT: gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT,
            MAX_COMBINED_UNIFORM_BLOCKS: gl.MAX_COMBINED_UNIFORM_BLOCKS,
            MAX_VERTEX_UNIFORM_BLOCKS: gl.MAX_VERTEX_UNIFORM_BLOCKS,
            MAX_FRAGMENT_UNIFORM_BLOCKS: gl.MAX_FRAGMENT_UNIFORM_BLOCKS
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

    it('clears the previous anisotropy limit when the extension is unavailable', () => {
        capabilities.MAX_TEXTURE_MAX_ANISOTROPY = 99;
        extensions.disable('EXT_texture_filter_anisotropic');
        capabilities.init(gl);
        expect(capabilities.MAX_TEXTURE_MAX_ANISOTROPY).toBe(1);
        extensions.enable('EXT_texture_filter_anisotropic');
    });
});
