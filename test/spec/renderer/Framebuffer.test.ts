import { describe, expect, it, vi } from 'vitest';
import Framebuffer, {
    type FramebufferRenderer
} from '../../../src/render/internal/webgl2/Framebuffer';
import WebGLState, {
    getWebGLTexture,
    getWebGLTextureCache,
    releaseWebGLTexture
} from '../../../src/render/internal/webgl2/WebGLState';
import { TEXTURE_3D } from '../../../src/constants/webgl2';
import Texture from '../../../src/texture/Texture';
import { testEnv } from '../../legacy-setup';

function createNativeFramebuffer(): WebGLFramebuffer {
    return testEnv.gl.createFramebuffer();
}

interface IsolatedFramebufferRenderer extends FramebufferRenderer {
    readonly gl: WebGL2RenderingContext;
    readonly state: WebGLState;
}

function createIsolatedRenderer(): IsolatedFramebufferRenderer {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('A WebGL2 context is required for framebuffer ownership tests.');
    return {
        isInit: true,
        gl,
        state: new WebGLState(gl),
        width: canvas.width,
        height: canvas.height
    };
}

function createDepthOnlyFramebuffer(renderer: IsolatedFramebufferRenderer): Framebuffer {
    return new Framebuffer(renderer, {
        colorAttachmentInfos: [],
        depthStencilAttachmentInfo: {
            attachmentType: Framebuffer.ATTACHMENT_TYPE_RENDERBUFFER,
            attachment: renderer.gl.DEPTH_ATTACHMENT,
            internalFormat: renderer.gl.DEPTH_COMPONENT16
        }
    });
}

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

    it('restores framebuffer bindings when readPixels throws', () => {
        const framebuffer = new Framebuffer(testEnv.renderer);
        framebuffer.init();
        const previousRead = createNativeFramebuffer();
        const previousDraw = createNativeFramebuffer();
        testEnv.state.bindFramebuffer(testEnv.gl.READ_FRAMEBUFFER, previousRead);
        testEnv.state.bindFramebuffer(testEnv.gl.DRAW_FRAMEBUFFER, previousDraw);
        const readPixels = vi.spyOn(testEnv.gl, 'readPixels').mockImplementationOnce(() => {
            throw new Error('injected readback failure');
        });

        try {
            expect(() => {
                framebuffer.readPixels(0, 0);
            }).toThrow(/injected readback failure/u);
            expect(testEnv.state.currentReadFramebuffer).toBe(previousRead);
            expect(testEnv.state.currentDrawFramebuffer).toBe(previousDraw);
        } finally {
            readPixels.mockRestore();
            testEnv.state.bindSystemFramebuffer();
            framebuffer.destroy();
            testEnv.gl.deleteFramebuffer(previousRead);
            testEnv.gl.deleteFramebuffer(previousDraw);
        }
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

    it('rejects framebuffer copies across WebGL2 contexts before native blit', () => {
        const firstRenderer = createIsolatedRenderer();
        const secondRenderer = createIsolatedRenderer();
        const source = createDepthOnlyFramebuffer(firstRenderer);
        const destination = createDepthOnlyFramebuffer(secondRenderer);
        source.init();
        destination.init();
        const blitFramebuffer = vi.spyOn(secondRenderer.gl, 'blitFramebuffer');

        try {
            expect(() => {
                destination.copyFramebuffer(source);
            }).toThrow(/across WebGL2 contexts/u);
            expect(blitFramebuffer).not.toHaveBeenCalled();
            expect(firstRenderer.gl.getError()).toBe(firstRenderer.gl.NO_ERROR);
            expect(secondRenderer.gl.getError()).toBe(secondRenderer.gl.NO_ERROR);
        } finally {
            blitFramebuffer.mockRestore();
            source.destroy();
            destination.destroy();
        }
    });

    it('restores independent read and draw bindings after a successful reset', () => {
        const framebuffer = new Framebuffer(testEnv.renderer);
        framebuffer.init();
        const previousRead = createNativeFramebuffer();
        const previousDraw = createNativeFramebuffer();
        testEnv.state.bindFramebuffer(testEnv.gl.READ_FRAMEBUFFER, previousRead);
        testEnv.state.bindFramebuffer(testEnv.gl.DRAW_FRAMEBUFFER, previousDraw);

        try {
            framebuffer.reset();

            expect(testEnv.state.currentReadFramebuffer).toBe(previousRead);
            expect(testEnv.state.currentDrawFramebuffer).toBe(previousDraw);
            expect(framebuffer.isComplete()).toBe(true);
            expect(testEnv.state.currentReadFramebuffer).toBe(previousRead);
            expect(testEnv.state.currentDrawFramebuffer).toBe(previousDraw);
        } finally {
            testEnv.state.bindSystemFramebuffer();
            framebuffer.destroy();
            testEnv.gl.deleteFramebuffer(previousRead);
            testEnv.gl.deleteFramebuffer(previousDraw);
        }
    });

    it('keeps attachment and native allocation identity across reset and resize', () => {
        const framebuffer = new Framebuffer(testEnv.renderer, { width: 4, height: 5 });
        framebuffer.init();
        const texture = framebuffer.texture;
        if (!(texture instanceof Texture)) {
            throw new Error('Framebuffer did not create an engine color texture');
        }
        const destroyListener = vi.fn();
        texture.on('destroy', destroyListener);
        const firstAllocation = getWebGLTexture(testEnv.state, texture);

        framebuffer.reset();

        const resetAllocation = getWebGLTexture(testEnv.state, texture);
        expect(framebuffer.texture).toBe(texture);
        expect(framebuffer.colorAttachmentInfos[0]?.texture).toBe(texture);
        expect(resetAllocation).toBe(firstAllocation);
        expect(testEnv.gl.isTexture(resetAllocation)).toBe(true);
        expect(destroyListener).not.toHaveBeenCalled();

        framebuffer.resize(7, 9);

        const resizedAllocation = getWebGLTexture(testEnv.state, texture);
        expect(framebuffer.texture).toBe(texture);
        expect(texture.width).toBe(7);
        expect(texture.height).toBe(9);
        expect(resizedAllocation).toBe(resetAllocation);
        expect(testEnv.gl.isTexture(resizedAllocation)).toBe(true);
        expect(framebuffer.isComplete()).toBe(true);
        expect(destroyListener).not.toHaveBeenCalled();

        framebuffer.destroy();
        expect(destroyListener).toHaveBeenCalledOnce();
        expect(getWebGLTextureCache(testEnv.state).get(texture.id)).toBeUndefined();
    });

    it('rejects one texture being owned by multiple framebuffer attachment graphs', () => {
        const texture = new Texture<null>({ width: 4, height: 4, image: null });
        const first = new Framebuffer(testEnv.renderer, {
            width: 4,
            height: 4,
            needRenderbuffer: false,
            colorAttachmentInfos: [
                {
                    attachmentType: Framebuffer.ATTACHMENT_TYPE_TEXTURE,
                    texture
                }
            ]
        });
        const second = new Framebuffer(testEnv.renderer, {
            width: 4,
            height: 4,
            needRenderbuffer: false,
            colorAttachmentInfos: [
                {
                    attachmentType: Framebuffer.ATTACHMENT_TYPE_TEXTURE,
                    texture
                }
            ]
        });

        try {
            first.init();
            expect(() => {
                second.init();
            }).toThrow(/already attached to another framebuffer/);
            expect(first.isComplete()).toBe(true);
        } finally {
            second.destroy();
            first.destroy();
        }
    });

    it('reattaches a framebuffer texture after external native invalidation', () => {
        const framebuffer = new Framebuffer(testEnv.renderer, { width: 4, height: 4 });
        framebuffer.init();
        const texture = framebuffer.texture;
        if (!(texture instanceof Texture)) {
            throw new Error('Framebuffer did not create an engine color texture');
        }
        const firstAllocation = getWebGLTexture(testEnv.state, texture);

        try {
            texture.destroy();
            expect(testEnv.gl.isTexture(firstAllocation)).toBe(false);

            framebuffer.bind();
            framebuffer.unbind();
            const replacement = getWebGLTexture(testEnv.state, texture);
            expect(replacement).not.toBe(firstAllocation);
            expect(testEnv.gl.isTexture(replacement)).toBe(true);
            expect(framebuffer.isComplete()).toBe(true);
        } finally {
            framebuffer.destroy();
        }
    });

    it('restores independent read and draw bindings after repeated bind and unbind calls', () => {
        const framebuffer = new Framebuffer(testEnv.renderer);
        framebuffer.init();
        const previousRead = createNativeFramebuffer();
        const previousDraw = createNativeFramebuffer();
        testEnv.state.bindFramebuffer(testEnv.gl.READ_FRAMEBUFFER, previousRead);
        testEnv.state.bindFramebuffer(testEnv.gl.DRAW_FRAMEBUFFER, previousDraw);

        try {
            framebuffer.bind();
            framebuffer.bind();
            expect(testEnv.state.currentReadFramebuffer).toBe(framebuffer.framebuffer);
            expect(testEnv.state.currentDrawFramebuffer).toBe(framebuffer.framebuffer);

            framebuffer.unbind();
            framebuffer.unbind();
            expect(testEnv.state.currentReadFramebuffer).toBe(previousRead);
            expect(testEnv.state.currentDrawFramebuffer).toBe(previousDraw);
        } finally {
            testEnv.state.bindSystemFramebuffer();
            framebuffer.destroy();
            testEnv.gl.deleteFramebuffer(previousRead);
            testEnv.gl.deleteFramebuffer(previousDraw);
        }
    });

    it('drops saved bindings when a bound framebuffer is reset', () => {
        const framebuffer = new Framebuffer(testEnv.renderer);
        framebuffer.init();

        try {
            framebuffer.bind();
            framebuffer.reset();
            expect(testEnv.state.currentReadFramebuffer).toBe(testEnv.state.systemFramebuffer);
            expect(testEnv.state.currentDrawFramebuffer).toBe(testEnv.state.systemFramebuffer);

            framebuffer.bind();
            framebuffer.unbind();
            expect(testEnv.state.currentReadFramebuffer).toBe(testEnv.state.systemFramebuffer);
            expect(testEnv.state.currentDrawFramebuffer).toBe(testEnv.state.systemFramebuffer);
            expect(testEnv.gl.getError()).toBe(testEnv.gl.NO_ERROR);
        } finally {
            testEnv.state.bindSystemFramebuffer();
            framebuffer.destroy();
        }
    });

    it('scopes static reset and destroy to the supplied WebGL2 context', () => {
        const firstRenderer = createIsolatedRenderer();
        const secondRenderer = createIsolatedRenderer();
        const first = createDepthOnlyFramebuffer(firstRenderer);
        const second = createDepthOnlyFramebuffer(secondRenderer);
        first.init();
        second.init();
        const firstAllocation = first.framebuffer;
        const secondAllocation = second.framebuffer;
        const secondRead = secondRenderer.gl.createFramebuffer();
        const secondDraw = secondRenderer.gl.createFramebuffer();
        secondRenderer.state.bindFramebuffer(secondRenderer.gl.READ_FRAMEBUFFER, secondRead);
        secondRenderer.state.bindFramebuffer(secondRenderer.gl.DRAW_FRAMEBUFFER, secondDraw);

        try {
            Framebuffer.reset(firstRenderer.gl);

            expect(first.framebuffer).not.toBe(firstAllocation);
            expect(first.isComplete()).toBe(true);
            expect(second.framebuffer).toBe(secondAllocation);
            expect(second.isComplete()).toBe(true);
            expect(secondRenderer.state.currentReadFramebuffer).toBe(secondRead);
            expect(secondRenderer.state.currentDrawFramebuffer).toBe(secondDraw);

            Framebuffer.destroy(firstRenderer.gl);

            expect(first.framebuffer).toBeNull();
            expect(Framebuffer.getCache(firstRenderer.gl).get(first.id)).toBeUndefined();
            expect(second.framebuffer).toBe(secondAllocation);
            expect(second.isComplete()).toBe(true);
            expect(Framebuffer.getCache(secondRenderer.gl).get(second.id)).toBe(second);
            expect(secondRenderer.state.currentReadFramebuffer).toBe(secondRead);
            expect(secondRenderer.state.currentDrawFramebuffer).toBe(secondDraw);
        } finally {
            firstRenderer.state.bindSystemFramebuffer();
            secondRenderer.state.bindSystemFramebuffer();
            first.destroy();
            second.destroy();
            secondRenderer.gl.deleteFramebuffer(secondRead);
            secondRenderer.gl.deleteFramebuffer(secondDraw);
        }
    });

    it('registers a framebuffer created before its renderer initializes', () => {
        const renderer: {
            isInit: boolean;
            gl: WebGL2RenderingContext | null;
            state: WebGLState | null;
            width: number;
            height: number;
        } = {
            isInit: false,
            gl: null,
            state: null,
            width: 16,
            height: 16
        };
        const framebuffer = new Framebuffer(renderer, {
            colorAttachmentInfos: [],
            depthStencilAttachmentInfo: {
                attachmentType: Framebuffer.ATTACHMENT_TYPE_RENDERBUFFER,
                attachment: testEnv.gl.DEPTH_ATTACHMENT,
                internalFormat: testEnv.gl.DEPTH_COMPONENT16
            }
        });
        const initialized = createIsolatedRenderer();
        renderer.gl = initialized.gl;
        renderer.state = initialized.state;
        renderer.isInit = true;

        framebuffer.init();
        expect(Framebuffer.getCache(initialized.gl).get(framebuffer.id)).toBe(framebuffer);

        Framebuffer.destroy(initialized.gl);
        expect(framebuffer.framebuffer).toBeNull();
        expect(Framebuffer.getCache(initialized.gl).get(framebuffer.id)).toBeUndefined();
    });

    it('cleans an incomplete allocation transaction and retries from an uninitialized state', () => {
        const framebuffer = new Framebuffer(testEnv.renderer);
        const previousRead = createNativeFramebuffer();
        const previousDraw = createNativeFramebuffer();
        testEnv.state.bindFramebuffer(testEnv.gl.READ_FRAMEBUFFER, previousRead);
        testEnv.state.bindFramebuffer(testEnv.gl.DRAW_FRAMEBUFFER, previousDraw);
        const checkFramebufferStatus = vi
            .spyOn(testEnv.gl, 'checkFramebufferStatus')
            .mockReturnValueOnce(testEnv.gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT);
        const deleteFramebuffer = vi.spyOn(testEnv.gl, 'deleteFramebuffer');
        const deleteTexture = vi.spyOn(testEnv.gl, 'deleteTexture');
        const deleteRenderbuffer = vi.spyOn(testEnv.gl, 'deleteRenderbuffer');

        try {
            expect(() => {
                framebuffer.init();
            }).toThrow(
                `Framebuffer is incomplete (status ${String(testEnv.gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT)})`
            );
            expect(framebuffer.framebuffer).toBeNull();
            const failedTexture = framebuffer.texture;
            expect(failedTexture).not.toBeNull();
            expect(framebuffer.renderbuffer).toBeNull();
            expect(framebuffer.colorAttachmentInfos[0]?.texture).toBe(failedTexture);
            expect(framebuffer.depthStencilAttachmentInfo?.renderbuffer).toBeNull();
            expect(deleteFramebuffer).toHaveBeenCalledTimes(1);
            expect(deleteTexture).toHaveBeenCalledTimes(1);
            if (!failedTexture) throw new Error('Framebuffer did not preserve its logical texture');
            expect(getWebGLTextureCache(testEnv.state).get(failedTexture.id)).toBeUndefined();
            expect(deleteRenderbuffer).toHaveBeenCalledTimes(1);
            expect(testEnv.state.currentReadFramebuffer).toBe(previousRead);
            expect(testEnv.state.currentDrawFramebuffer).toBe(previousDraw);

            expect(() => {
                framebuffer.init();
            }).not.toThrow();
            expect(framebuffer.isComplete()).toBe(true);
            expect(framebuffer.texture).toBe(failedTexture);
            expect(deleteTexture).toHaveBeenCalledTimes(1);
            expect(getWebGLTextureCache(testEnv.state).get(failedTexture.id)).toBeDefined();
            expect(checkFramebufferStatus).toHaveBeenCalledTimes(3);
            expect(testEnv.state.currentReadFramebuffer).toBe(previousRead);
            expect(testEnv.state.currentDrawFramebuffer).toBe(previousDraw);
        } finally {
            testEnv.state.bindSystemFramebuffer();
            framebuffer.destroy();
            testEnv.gl.deleteFramebuffer(previousRead);
            testEnv.gl.deleteFramebuffer(previousDraw);
        }
    });

    it('reattaches a manager-replaced texture allocation before the next bind', () => {
        const framebuffer = new Framebuffer(testEnv.renderer);
        framebuffer.init();
        const texture = framebuffer.texture;
        if (!texture) throw new Error('Framebuffer did not create its color texture');
        const firstAllocation = getWebGLTexture(testEnv.state, texture);

        expect(releaseWebGLTexture(testEnv.state, texture)).toBe(true);
        expect(testEnv.gl.isTexture(firstAllocation)).toBe(false);

        framebuffer.bind();
        try {
            const replacement = getWebGLTexture(testEnv.state, texture);
            expect(replacement).not.toBe(firstAllocation);
            expect(
                testEnv.gl.getFramebufferAttachmentParameter(
                    testEnv.gl.FRAMEBUFFER,
                    testEnv.gl.COLOR_ATTACHMENT0,
                    testEnv.gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME
                )
            ).toBe(replacement);
            expect(framebuffer.isComplete()).toBe(true);
        } finally {
            framebuffer.unbind();
            framebuffer.destroy();
        }
    });

    it('rejects an attachment target mutation and recovers after it is restored', () => {
        const framebuffer = new Framebuffer(testEnv.renderer);
        framebuffer.init();
        const texture = framebuffer.texture;
        if (!texture) throw new Error('Framebuffer did not create its color texture');
        const firstAllocation = getWebGLTexture(testEnv.state, texture);

        texture.target = TEXTURE_3D;
        texture.depth = 1;
        const incompatibleAllocation = getWebGLTexture(testEnv.state, texture);
        expect(incompatibleAllocation).not.toBe(firstAllocation);
        expect(() => {
            framebuffer.bind();
        }).toThrow(/does not match attachment target/u);

        texture.target = testEnv.gl.TEXTURE_2D;
        framebuffer.bind();
        try {
            const recoveredAllocation = getWebGLTexture(testEnv.state, texture);
            expect(recoveredAllocation).not.toBe(incompatibleAllocation);
            expect(framebuffer.isComplete()).toBe(true);
            expect(testEnv.gl.getError()).toBe(testEnv.gl.NO_ERROR);
        } finally {
            framebuffer.unbind();
            framebuffer.destroy();
        }
    });

    it('cache & destroy', () => {
        const framebuffer = new Framebuffer(testEnv.renderer);
        expect(Framebuffer.getCache(testEnv.gl).get(framebuffer.id)).toBe(framebuffer);
        framebuffer.destroy();
        expect(Framebuffer.getCache(testEnv.gl).get(framebuffer.id)).toBeUndefined();
        expect(framebuffer.framebuffer).toBeNull();
        expect(framebuffer.texture).toBeNull();
        expect(framebuffer.renderbuffer).toBeNull();
    });
});
