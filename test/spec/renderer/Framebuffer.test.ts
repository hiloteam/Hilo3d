import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import { testEnv } from '../../setup';

const Framebuffer = Hilo3d.Framebuffer;

describe('Framebuffer', () => {
    it('create', () => {
        const framebuffer = new Framebuffer(testEnv.renderer);
        expect(framebuffer.isFramebuffer).toBe(true);
        expect(framebuffer.className).toBe('Framebuffer');

        framebuffer.init();
        expect(framebuffer.isComplete()).toBe(true);
    });

    it('readPixels', () => {
        const framebuffer = new Framebuffer(testEnv.renderer);
        expect(framebuffer.readPixels(0, 0, 2, 2)).toEqual(new Uint8Array(16));
    });

    it('restores depth and cull capabilities after drawing its texture', () => {
        const framebuffer = new Framebuffer(testEnv.renderer);
        testEnv.state.enable(testEnv.gl.DEPTH_TEST);
        testEnv.state.disable(testEnv.gl.CULL_FACE);

        framebuffer.render();

        expect(testEnv.state.isEnabled(testEnv.gl.DEPTH_TEST)).toBe(true);
        expect(testEnv.state.isEnabled(testEnv.gl.CULL_FACE)).toBe(false);
    });

    it('cache & destroy', () => {
        const framebuffer = new Framebuffer(testEnv.renderer);
        expect(Framebuffer.cache.get(framebuffer.id)).toBe(framebuffer);
        framebuffer.destroy();
        expect(Framebuffer.cache.get(framebuffer.id)).toBeUndefined();
        expect(framebuffer.framebuffer).toBeNull();
        expect(framebuffer.texture).toBeNull();
        expect(framebuffer.renderbuffer).toBeNull();
    });
});
