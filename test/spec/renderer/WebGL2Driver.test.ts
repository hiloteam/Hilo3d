import { describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import type { ProgramAttribute } from '../../../src/render/internal/webgl2/Program';
import type Program from '../../../src/render/internal/webgl2/Program';
import type { RendererFrameCallback } from '../../../src/render/Renderer';
import { getWebGLTexture, webGLStateUsesRHI } from '../../../src/render/internal/webgl2/WebGLState';
import VertexArrayObject from '../../../src/render/internal/webgl2/VertexArrayObject';
import WebGL2Driver from '../../../src/render/internal/webgl2/WebGL2Driver';
import type { WebGLRHI } from '../../../src/render/rhi/webgl2/WebGLRHI';
import { testEnv } from '../../setup';

function rhiOwner(renderer: WebGL2Driver): WebGLRHI {
    const owner = (renderer as unknown as { _rhi: WebGLRHI | null })._rhi;
    if (!owner) throw new Error('renderer RHI is unavailable');
    return owner;
}

describe('WebGL2Driver', () => {
    it('creates the WebGL2 driver', () => {
        const renderer = new WebGL2Driver();
        expect(renderer.backend).toBe('webgl2');
        expect(renderer.className).toBe('Renderer');
    });

    it('keeps runtime instancing selection synchronized with its render list', () => {
        const renderer = new WebGL2Driver();

        renderer.useInstanced = true;
        expect(renderer.renderList.useInstanced).toBe(true);
        renderer.useInstanced = false;
        expect(renderer.renderList.useInstanced).toBe(false);
    });

    it('exposes the same explicit application-frame boundary as WebGPU', () => {
        const renderer = new WebGL2Driver();
        const callback = vi.fn();
        const present = vi.spyOn(renderer, 'present').mockImplementation(() => undefined);

        renderer.renderFrame(frame => {
            expect(frame.backend).toBe('webgl2');
            callback();
        });

        expect(callback).toHaveBeenCalledOnce();
        expect(() => {
            renderer.renderFrame(() => {
                renderer.renderFrame(() => undefined);
            });
        }).toThrow(/Nested renderer frames/u);
        const asyncCallback = (() => Promise.resolve()) as unknown as RendererFrameCallback;
        expect(() => {
            renderer.renderFrame(asyncCallback);
        }).toThrow(/must be synchronous/u);

        let staleFrame: Parameters<RendererFrameCallback>[0] | undefined;
        renderer.renderFrame(frame => {
            staleFrame = frame;
        });
        renderer.renderFrame(frame => {
            expect(frame).not.toBe(staleFrame);
            expect(() => staleFrame?.present()).toThrow(/only valid inside/u);
            expect(() => {
                frame.present();
            }).not.toThrow();
        });
        expect(present).toHaveBeenCalledOnce();
    });

    it('resolves ready only after a real WebGL2 context is initialized', async () => {
        const renderer = new WebGL2Driver({
            domElement: document.createElement('canvas')
        });

        expect(renderer.isReady).toBe(false);
        await renderer.ready;
        expect(renderer.isInit).toBe(true);
        expect(renderer.isReady).toBe(true);
        renderer.destroy();
        expect(renderer.isReady).toBe(false);
    });

    it('normalizes LINE_LOOP geometry before WebGL2 shader and VAO setup', () => {
        const renderer = new WebGL2Driver();
        const geometry = new Hilo3d.Geometry({
            mode: Hilo3d.constants.LINE_LOOP,
            vertices: new Hilo3d.GeometryData(new Float32Array(9), 3),
            indices: new Hilo3d.GeometryData(new Uint32Array([0, 1, 2]), 1)
        });
        const mesh = new Hilo3d.Mesh({
            geometry,
            material: new Hilo3d.BasicMaterial({ lightType: 'NONE' })
        });
        const stopAfterNormalization = new Error('stop after topology normalization');
        const getShader = vi.spyOn(Hilo3d.Shader, 'getShader').mockImplementation(() => {
            throw stopAfterNormalization;
        });

        try {
            expect(() => renderer.setupMesh(mesh, false)).toThrow(stopAfterNormalization);
        } finally {
            getShader.mockRestore();
        }

        expect(geometry.mode).toBe(Hilo3d.constants.LINES);
        expect(geometry.indices?.data).toBeInstanceOf(Uint32Array);
        expect(Array.from(geometry.indices?.data ?? [])).toEqual([0, 1, 1, 2, 2, 0]);
    });

    it('creates only a WebGL 2 context', () => {
        const canvas = document.createElement('canvas');
        const getContext = vi.spyOn(canvas, 'getContext');
        const addEventListener = vi.spyOn(canvas, 'addEventListener');
        const renderer = new WebGL2Driver({ domElement: canvas });

        renderer.initContext();

        expect(getContext).toHaveBeenCalledOnce();
        expect(getContext).toHaveBeenCalledWith('webgl2', expect.any(Object));
        expect(getContext.mock.calls.some(([contextId]) => contextId === 'webgl')).toBe(false);
        expect(getContext.mock.calls[0]?.[1]).not.toHaveProperty('powerPreference');
        expect(
            addEventListener.mock.calls
                .map(([type]) => type)
                .filter(type => type.startsWith('webglcontext'))
        ).toEqual(['webglcontextlost', 'webglcontextrestored']);
        const rhi = rhiOwner(renderer);
        expect(rhi.nativeContext).toBe(renderer.gl);
        expect(webGLStateUsesRHI(renderer.state, rhi.state, rhi.device)).toBe(true);
        renderer.destroy();
    });

    it('uses one canonical state cache across the renderer adapter and RHI device', () => {
        const renderer = new WebGL2Driver({ domElement: document.createElement('canvas') });
        renderer.initContext();
        const { gl, state } = renderer;
        const rhi = rhiOwner(renderer);
        const enable = vi.spyOn(gl, 'enable');
        const disable = vi.spyOn(gl, 'disable');
        enable.mockClear();
        disable.mockClear();

        state.enable(gl.BLEND);
        rhi.state.enable(gl.BLEND, true);
        state.disable(gl.BLEND);
        rhi.state.enable(gl.BLEND, false);

        expect(enable).toHaveBeenCalledOnce();
        expect(disable).toHaveBeenCalledOnce();
        renderer.destroy();
    });

    it('invalidates canonical and legacy binding state around explicit native work', () => {
        const renderer = new WebGL2Driver({ domElement: document.createElement('canvas') });
        renderer.initContext();
        const enable = vi.spyOn(renderer.gl, 'enable');
        const disable = vi.spyOn(renderer.gl, 'disable');
        enable.mockClear();
        disable.mockClear();

        renderer.state.enable(renderer.gl.BLEND);
        renderer.withNativeContext(gl => {
            gl.disable(gl.BLEND);
        });
        renderer.state.enable(renderer.gl.BLEND);

        expect(enable).toHaveBeenCalledTimes(2);
        expect(disable).toHaveBeenCalledOnce();
        renderer.destroy();
    });

    it('uses one frame-scoped native session and never creates or replays RHI commands', () => {
        const renderer = new WebGL2Driver({ domElement: document.createElement('canvas') });
        renderer.initContext();
        const rhi = rhiOwner(renderer);
        const nativeSession = vi.spyOn(rhi.device, 'runWithNativeContext');
        const createCommandEncoder = vi.spyOn(rhi.device, 'createCommandEncoder');
        const submit = vi.spyOn(rhi.device.queue, 'submit');

        renderer.renderFrame(() => {
            renderer.render(new Hilo3d.Node(), new Hilo3d.PerspectiveCamera());
        });

        expect(nativeSession).toHaveBeenCalledOnce();
        expect(nativeSession).toHaveBeenCalledWith(expect.any(Function), true);
        expect(createCommandEncoder).not.toHaveBeenCalled();
        expect(submit).not.toHaveBeenCalled();
        renderer.destroy();
    });

    it('does not rebind unchanged native state across identical frames', () => {
        const renderer = new WebGL2Driver({ domElement: document.createElement('canvas') });
        renderer.initContext();
        const stage = new Hilo3d.Node();
        const camera = new Hilo3d.PerspectiveCamera();
        stage.addChild(
            new Hilo3d.Mesh({
                geometry: new Hilo3d.Geometry({
                    vertices: new Hilo3d.GeometryData(
                        new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
                        3
                    )
                }),
                material: new Hilo3d.BasicMaterial({ lightType: 'NONE' }),
                frustumTest: false
            })
        );
        const stateCalls = [
            'activeTexture',
            'bindFramebuffer',
            'bindSampler',
            'bindTexture',
            'bindVertexArray',
            'blendEquationSeparate',
            'blendFuncSeparate',
            'colorMask',
            'cullFace',
            'depthFunc',
            'depthMask',
            'depthRange',
            'disable',
            'enable',
            'frontFace',
            'stencilFunc',
            'stencilMask',
            'stencilOp',
            'useProgram',
            'viewport'
        ] as const;
        const spies = stateCalls.map(name => vi.spyOn(renderer.gl, name));

        renderer.render(stage, camera);
        const firstFrameCounts = spies.map(spy => spy.mock.calls.length);
        renderer.render(stage, camera);

        expect(spies.map(spy => spy.mock.calls.length)).toEqual(firstFrameCounts);
        renderer.destroy();
    });

    it('reattaches the renderer adapter to the restored RHI generation', async () => {
        const canvas = document.createElement('canvas');
        const renderer = new WebGL2Driver({ domElement: canvas });
        renderer.initContext();
        const rhi = rhiOwner(renderer);
        const previousDevice = rhi.device;
        const previousState = rhi.state;

        const lostEvent = new Event('webglcontextlost', { cancelable: true });
        canvas.dispatchEvent(lostEvent);
        const recovery = rhi.recovery;
        canvas.dispatchEvent(new Event('webglcontextrestored'));
        await recovery;

        expect(lostEvent.defaultPrevented).toBe(true);
        expect(renderer.isReady).toBe(true);
        expect(rhi.device).not.toBe(previousDevice);
        expect(renderer.gl).toBe(rhi.nativeContext);
        expect(rhi.state).not.toBe(previousState);
        expect(webGLStateUsesRHI(renderer.state, rhi.state, rhi.device)).toBe(true);
        renderer.destroy();
    });

    it('binds a first-upload texture to the requested sampler unit after using the upload unit', () => {
        const renderer = new WebGL2Driver({ domElement: document.createElement('canvas') });
        renderer.initContext();
        const texture = new Hilo3d.DataTexture({
            width: 1,
            height: 1,
            data: new Uint8Array([255, 0, 0, 255]),
            flipY: false
        });
        const bindTexture = (
            renderer as unknown as {
                bindTexture(value: Hilo3d.Texture, textureIndex: number, samplerType: GLenum): void;
            }
        ).bindTexture.bind(renderer);

        bindTexture(texture, 0, renderer.gl.SAMPLER_2D);

        expect(renderer.gl.getParameter(renderer.gl.ACTIVE_TEXTURE)).toBe(renderer.gl.TEXTURE0);
        expect(renderer.gl.getParameter(renderer.gl.TEXTURE_BINDING_2D)).toBe(
            getWebGLTexture(renderer.state, texture)
        );
        expect(renderer.gl.getError()).toBe(renderer.gl.NO_ERROR);
        renderer.destroy();
    });

    it('resolves legacy texture samplers through the device-owned cache', () => {
        const renderer = new WebGL2Driver({ domElement: document.createElement('canvas') });
        renderer.initContext();
        const createSampler = vi.spyOn(renderer.gl, 'createSampler');
        const bindSampler = vi.spyOn(renderer.gl, 'bindSampler');
        createSampler.mockClear();
        bindSampler.mockClear();
        const first = new Hilo3d.DataTexture({
            width: 1,
            height: 1,
            data: new Uint8Array([255, 0, 0, 255]),
            flipY: false
        });
        const second = new Hilo3d.DataTexture({
            width: 1,
            height: 1,
            data: new Uint8Array([0, 255, 0, 255]),
            flipY: false
        });
        const bindTexture = (
            renderer as unknown as {
                bindTexture(value: Hilo3d.Texture, textureIndex: number, samplerType: GLenum): void;
            }
        ).bindTexture.bind(renderer);

        bindTexture(first, 0, renderer.gl.SAMPLER_2D);
        bindTexture(second, 1, renderer.gl.SAMPLER_2D);
        bindTexture(second, 1, renderer.gl.SAMPLER_2D);

        expect(createSampler).toHaveBeenCalledOnce();
        expect(bindSampler).toHaveBeenCalledTimes(2);
        renderer.destroy();
    });

    it('remains fail-closed until every framebuffer recovers after context loss', () => {
        const renderer = new WebGL2Driver({
            domElement: document.createElement('canvas'),
            width: 16,
            height: 16
        });
        renderer.initContext();
        const target = renderer.createRenderTarget({ width: 4, height: 4 });
        renderer.setRenderTarget(target, { present: true });
        renderer.render(new Hilo3d.Node(), new Hilo3d.PerspectiveCamera());
        expect(renderer.gl.getError()).toBe(renderer.gl.NO_ERROR);
        const attachment = target.getColorTexture();
        const destroyListener = vi.fn();
        attachment.on('destroy', destroyListener);
        const lifecycle = renderer as unknown as {
            onContextLost(event: Pick<Event, 'preventDefault'>): void;
            onContextRestored(event: Event): void;
        };
        const checkFramebufferStatus = vi
            .spyOn(renderer.gl, 'checkFramebufferStatus')
            .mockReturnValue(renderer.gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT);

        try {
            lifecycle.onContextLost({ preventDefault: vi.fn() });
            expect(() => {
                lifecycle.onContextRestored(new Event('webglcontextrestored'));
            }).toThrow(/Framebuffer is incomplete/u);
            expect(target.getColorTexture()).toBe(attachment);
            expect(destroyListener).not.toHaveBeenCalled();
            expect(() => {
                renderer.render(new Hilo3d.Node(), new Hilo3d.PerspectiveCamera());
            }).toThrow(/context is lost/u);

            checkFramebufferStatus.mockRestore();
            lifecycle.onContextRestored(new Event('webglcontextrestored'));
            expect(target.getColorTexture()).toBe(attachment);
            expect(destroyListener).not.toHaveBeenCalled();
            expect(() => {
                renderer.render(new Hilo3d.Node(), new Hilo3d.PerspectiveCamera());
            }).not.toThrow();
            expect(renderer.gl.getError()).toBe(renderer.gl.NO_ERROR);
        } finally {
            checkFramebufferStatus.mockRestore();
            renderer.destroy();
        }
    });

    it('onInit', () => {
        const renderer = new WebGL2Driver({
            domElement: document.createElement('canvas')
        });
        const onInit1 = vi.fn();
        const onInit2 = vi.fn();
        const onInit3 = vi.fn();

        renderer.onInit(onInit1);
        renderer.on('init', onInit2);
        expect(onInit1).toHaveBeenCalledTimes(0);
        expect(onInit2).toHaveBeenCalledTimes(0);
        expect(onInit3).toHaveBeenCalledTimes(0);

        // init context
        renderer.initContext();
        expect(onInit1).toHaveBeenCalledTimes(1);
        expect(onInit2).toHaveBeenCalledTimes(1);
        expect(onInit3).toHaveBeenCalledTimes(0);

        renderer.onInit(onInit3);
        expect(onInit1).toHaveBeenCalledTimes(1);
        expect(onInit2).toHaveBeenCalledTimes(1);
        expect(onInit3).toHaveBeenCalledTimes(1);

        renderer.fire('init');
        expect(onInit1).toHaveBeenCalledTimes(1);
        expect(onInit2).toHaveBeenCalledTimes(2);
        expect(onInit3).toHaveBeenCalledTimes(1);
    });

    it('updates every program VAO after GeometryData identity and index changes', () => {
        const renderer = new WebGL2Driver();
        const geometry = new Hilo3d.Geometry({
            vertices: new Hilo3d.GeometryData(new Float32Array([0, 0, 0, 1, 1, 1]), 3),
            indices: new Hilo3d.GeometryData(new Uint16Array([0, 1]), 1)
        });
        const mesh = new Hilo3d.Mesh({
            geometry,
            material: new Hilo3d.BasicMaterial({ lightType: 'NONE' })
        });
        const firstPointer = vi.fn();
        const secondPointer = vi.fn();
        const program = (pointer: () => void): Program =>
            ({
                attributes: {
                    a_position: {
                        name: 'a_position',
                        enable: () => undefined,
                        pointer
                    } as unknown as ProgramAttribute
                }
            }) as unknown as Program;
        const firstProgram = program(firstPointer);
        const secondProgram = program(secondPointer);
        const firstVao = new VertexArrayObject(testEnv.gl, '_hiloFirstProgramVao');
        const secondVao = new VertexArrayObject(testEnv.gl, '_hiloSecondProgramVao');

        renderer.setupVao(firstVao, firstProgram, mesh);
        renderer.setupVao(secondVao, secondProgram, mesh);
        const resources = new Set([...firstVao.getResources(), ...secondVao.getResources()]);

        geometry.vertices = new Hilo3d.GeometryData(
            new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2]),
            3
        );
        geometry.indices = null;
        geometry.isDirty = true;
        renderer.setupVao(firstVao, firstProgram, mesh);
        expect(geometry.isDirty).toBe(false);
        renderer.setupVao(secondVao, secondProgram, mesh);

        expect(firstPointer).toHaveBeenCalledTimes(2);
        expect(secondPointer).toHaveBeenCalledTimes(2);
        expect(firstVao.getVertexCount()).toBe(3);
        expect(secondVao.getVertexCount()).toBe(3);
        expect(firstVao.getResources()).toHaveLength(1);
        expect(secondVao.getResources()).toHaveLength(1);

        for (const resource of firstVao.getResources()) resources.add(resource);
        for (const resource of secondVao.getResources()) resources.add(resource);
        resources.forEach(resource => resource.destroy());
        firstVao.destroy();
        secondVao.destroy();
    });

    it('retires only uncommitted resources when a frame fails', () => {
        const renderer = new WebGL2Driver({
            domElement: document.createElement('canvas')
        });
        const stage = new Hilo3d.Node();
        const camera = new Hilo3d.PerspectiveCamera();
        const mesh = new Hilo3d.Mesh({
            geometry: new Hilo3d.Geometry(),
            material: new Hilo3d.Material(),
            frustumTest: false
        });
        const committed = { id: 'committed', destroy: vi.fn() };
        const incomplete = { id: 'incomplete', destroy: vi.fn() };
        const failure = new Error('render failed');
        stage.addChild(mesh);
        renderer.resourceManager.addMeshResources(mesh, [committed]);
        vi.spyOn(renderer, 'renderScene').mockImplementation(() => {
            renderer.resourceManager.addMeshResources(mesh, [incomplete]);
            throw failure;
        });

        expect(() => {
            renderer.render(stage, camera);
        }).toThrow(failure);

        expect(renderer.resourceManager.getMeshResources(mesh)).toEqual([committed]);
        expect(renderer.resourceManager.hasNeedDestroyResource).toBe(false);
        expect(committed.destroy).not.toHaveBeenCalled();
        expect(incomplete.destroy).toHaveBeenCalledOnce();
        renderer.destroy();
    });
});
