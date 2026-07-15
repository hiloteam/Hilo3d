import { describe, expect, it } from 'vitest';
import { WebGLExtensions } from '../../../src/render/internal/webgl2/extensions';
import { testEnv } from '../../legacy-setup';

describe('extensions', () => {
    const extensions = new WebGLExtensions();

    it('init', () => {
        extensions.init(testEnv.gl);

        expect(extensions.loseContext).toBe(testEnv.gl.getExtension('WEBGL_lose_context'));
        expect(extensions.colorBufferFloat).toBe(testEnv.gl.getExtension('EXT_color_buffer_float'));
    });

    it('enable & disable', () => {
        extensions.init(testEnv.gl);
        extensions.disable('WEBGL_lose_context');
        expect(extensions.get('WEBGL_lose_context', 'loseContext')).toBeNull();
        extensions.reset(testEnv.gl);
        expect(extensions.loseContext).toBeNull();
        extensions.enable('WEBGL_lose_context');
        expect(extensions.get('WEBGL_lose_context', 'loseContext')).toBe(extensions.loseContext);
    });
});
