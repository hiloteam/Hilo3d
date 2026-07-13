import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import { testEnv } from '../../setup';

const WebGLState = Hilo3d.WebGLState;

describe('WebGLState', () => {
    it('create', () => {
        const state = new WebGLState(testEnv.gl);
        expect(state.isWebGLState).toBe(true);
        expect(state.className).toBe('WebGLState');
    });

    let gl = testEnv.gl;
    let state = new WebGLState(gl);

    beforeEach(() => {
        gl = testEnv.gl;
        state = new WebGLState(gl);
    });

    it('set1', () => {
        const enable = vi.spyOn(gl, 'enable');

        state.set1('enable', 1);
        expect(enable).toHaveBeenCalledTimes(1);

        state.set1('enable', 1);
        expect(enable).toHaveBeenCalledTimes(1);

        state.set1('enable', 2);
        expect(enable).toHaveBeenCalledTimes(2);

        state.set1('enable', 1);
        expect(enable).toHaveBeenCalledTimes(3);

        enable.mockRestore();
    });

    it('set2', () => {
        const depthRange = vi.spyOn(gl, 'depthRange');

        state.set2('depthRange', 1, 2);
        expect(depthRange).toHaveBeenCalledTimes(1);

        state.set2('depthRange', 1, 2);
        expect(depthRange).toHaveBeenCalledTimes(1);

        state.set2('depthRange', 1, 3);
        expect(depthRange).toHaveBeenCalledTimes(2);

        state.set2('depthRange', 2, 3);
        expect(depthRange).toHaveBeenCalledTimes(3);

        depthRange.mockRestore();
    });

    it('set3', () => {
        const stencilOp = vi.spyOn(state.gl, 'stencilOp');

        state.set3('stencilOp', gl.KEEP, gl.KEEP, gl.KEEP);
        expect(stencilOp).toHaveBeenCalledTimes(1);

        state.set3('stencilOp', gl.KEEP, gl.KEEP, gl.KEEP);
        expect(stencilOp).toHaveBeenCalledTimes(1);

        state.set3('stencilOp', gl.KEEP, gl.REPLACE, gl.KEEP);
        expect(stencilOp).toHaveBeenCalledTimes(2);

        state.set3('stencilOp', gl.REPLACE, gl.REPLACE, gl.KEEP);
        expect(stencilOp).toHaveBeenCalledTimes(3);

        stencilOp.mockRestore();
    });

    it('set4', () => {
        const viewport = vi.spyOn(gl, 'viewport');

        state.set4('viewport', 1, 2, 3, 4);
        expect(viewport).toHaveBeenCalledTimes(1);

        state.set4('viewport', 1, 2, 3, 4);
        expect(viewport).toHaveBeenCalledTimes(1);

        state.set4('viewport', 1, 2, 4, 4);
        expect(viewport).toHaveBeenCalledTimes(2);

        state.set4('viewport', 1, 2, 3, 4);
        expect(viewport).toHaveBeenCalledTimes(3);

        viewport.mockRestore();
    });

    it('enable & disable', () => {
        const enable = vi.spyOn(gl, 'enable');
        const disable = vi.spyOn(gl, 'disable');

        state.enable(1);
        expect(enable).toHaveBeenCalledTimes(1);

        state.enable(2);
        expect(enable).toHaveBeenCalledTimes(2);

        state.disable(1);
        expect(disable).toHaveBeenCalledTimes(1);

        state.disable(1);
        expect(disable).toHaveBeenCalledTimes(1);

        state.enable(1);
        expect(enable).toHaveBeenCalledTimes(3);

        enable.mockRestore();
        disable.mockRestore();
    });

    it('bindFramebuffer & bindSystemFramebuffer', () => {
        const bindFramebuffer = vi.spyOn(gl, 'bindFramebuffer');

        const framebuffer1 = gl.createFramebuffer();
        const framebuffer2 = gl.createFramebuffer();
        const framebuffer3 = gl.createFramebuffer();

        state.bindFramebuffer(1, framebuffer1);
        expect(bindFramebuffer).toHaveBeenCalledTimes(1);

        state.bindFramebuffer(1, framebuffer1);
        expect(bindFramebuffer).toHaveBeenCalledTimes(1);

        state.bindFramebuffer(1, framebuffer2);
        expect(bindFramebuffer).toHaveBeenCalledTimes(2);
        expect(state.preFramebuffer).toBe(framebuffer1);

        state.bindFramebuffer(1, framebuffer3);
        expect(bindFramebuffer).toHaveBeenCalledTimes(3);
        expect(state.preFramebuffer).toBe(framebuffer2);

        state.bindSystemFramebuffer();
        expect(bindFramebuffer).toHaveBeenCalledTimes(4);
        expect(state.preFramebuffer).toBe(framebuffer3);

        bindFramebuffer.mockRestore();
    });

    it('pixelStorei', () => {
        const pixelStorei = vi.spyOn(gl, 'pixelStorei');

        state.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        expect(pixelStorei).toHaveBeenCalledTimes(1);

        state.pixelStorei(gl.PACK_ALIGNMENT, 1);
        expect(pixelStorei).toHaveBeenCalledTimes(2);

        state.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        expect(pixelStorei).toHaveBeenCalledTimes(2);

        state.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
        expect(pixelStorei).toHaveBeenCalledTimes(3);

        state.pixelStorei(gl.PACK_ALIGNMENT, 1);
        expect(pixelStorei).toHaveBeenCalledTimes(3);

        pixelStorei.mockRestore();
    });

    it('activeTexture', () => {
        const activeTexture = vi.spyOn(gl, 'activeTexture');

        state.activeTexture(gl.TEXTURE0);
        expect(activeTexture).toHaveBeenCalledTimes(1);
        expect(activeTexture).toHaveBeenLastCalledWith(gl.TEXTURE0);

        state.activeTexture(gl.TEXTURE1);
        expect(activeTexture).toHaveBeenCalledTimes(2);
        expect(activeTexture).toHaveBeenLastCalledWith(gl.TEXTURE1);

        state.activeTexture(gl.TEXTURE1);
        expect(activeTexture).toHaveBeenCalledTimes(2);

        activeTexture.mockRestore();
    });

    it('bindTexture & getActiveTextureUnit', () => {
        const texture = gl.createTexture();
        const bindTexture = vi.spyOn(gl, 'bindTexture');

        state.activeTexture(gl.TEXTURE3);
        state.bindTexture(gl.TEXTURE_2D, texture);
        expect(state.getActiveTextureUnit().get(gl.TEXTURE_2D)).toBe(texture);
        expect(bindTexture).toHaveBeenCalledTimes(1);

        state.activeTexture(gl.TEXTURE3);
        state.bindTexture(gl.TEXTURE_2D, texture);
        expect(state.getActiveTextureUnit().get(gl.TEXTURE_2D)).toBe(texture);
        expect(bindTexture).toHaveBeenCalledTimes(1);

        state.activeTexture(gl.TEXTURE4);
        state.bindTexture(gl.TEXTURE_2D, texture);
        expect(state.getActiveTextureUnit().get(gl.TEXTURE_2D)).toBe(texture);
        expect(bindTexture).toHaveBeenCalledTimes(2);

        bindTexture.mockRestore();
    });
});
