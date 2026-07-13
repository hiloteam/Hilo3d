import { describe, expect, it, vi } from 'vitest';
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

    it('uses native drawBuffers for multiple color attachments', () => {
        const drawBuffers = vi.spyOn(testEnv.gl, 'drawBuffers');
        const framebuffer = new Framebuffer(testEnv.renderer, {
            colorAttachmentInfos: Array.from({ length: 2 }, () => ({
                attachmentType: Framebuffer.ATTACHMENT_TYPE_TEXTURE
            }))
        });

        framebuffer.init();

        expect(drawBuffers).toHaveBeenCalledWith([
            testEnv.gl.COLOR_ATTACHMENT0,
            testEnv.gl.COLOR_ATTACHMENT1
        ]);
        drawBuffers.mockRestore();
    });

    it('restores independent read and draw framebuffer bindings after a blit', () => {
        const source = new Framebuffer(testEnv.renderer);
        const destination = new Framebuffer(testEnv.renderer);
        source.init();
        destination.init();
        const previousRead = testEnv.state.currentReadFramebuffer;
        const previousDraw = testEnv.state.currentDrawFramebuffer;

        destination.copyFramebuffer(source);

        expect(testEnv.state.currentReadFramebuffer).toBe(previousRead);
        expect(testEnv.state.currentDrawFramebuffer).toBe(previousDraw);
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
