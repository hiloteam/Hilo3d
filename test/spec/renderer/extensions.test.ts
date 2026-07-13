import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import { testEnv } from '../../setup';

const extensions = Hilo3d.extensions;

describe('extensions', () => {
    it('init', () => {
        extensions.init(testEnv.gl);

        expect(extensions.loseContext).toBe(testEnv.gl.getExtension('WEBGL_lose_context'));
        expect(extensions.colorBufferFloat).toBe(testEnv.gl.getExtension('EXT_color_buffer_float'));
    });

    it('enable & disable', () => {
        extensions.disable('WEBGL_lose_context');
        expect(extensions.get('WEBGL_lose_context', 'loseContext')).toBeNull();
        extensions.enable('WEBGL_lose_context');
        expect(extensions.get('WEBGL_lose_context', 'loseContext')).toBe(extensions.loseContext);
    });
});
