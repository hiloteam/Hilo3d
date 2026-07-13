import { describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import type { ProgramAttribute } from '../../../src/renderer/webgl/Program';
import type Program from '../../../src/renderer/webgl/Program';
import type { RendererFrameCallback } from '../../../src/renderer/common/Renderer';
import { getWebGLTexture } from '../../../src/renderer/webgl/WebGLState';
import { testEnv } from '../../setup';

const WebGLRenderer = Hilo3d.WebGLRenderer;

describe('WebGLRenderer', () => {
    it('create', () => {
        const renderer = new WebGLRenderer();
        expect(renderer.isWebGLRenderer).toBe(true);
        expect(renderer.className).toBe('WebGLRenderer');
    });

    it('keeps runtime instancing selection synchronized with its render list', () => {
        const renderer = new WebGLRenderer();

        renderer.useInstanced = true;
        expect(renderer.renderList.useInstanced).toBe(true);
        renderer.useInstanced = false;
        expect(renderer.renderList.useInstanced).toBe(false);
    });

    it('exposes the same explicit application-frame boundary as WebGPU', () => {
        const renderer = new WebGLRenderer();
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
        const renderer = new WebGLRenderer({
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
        const renderer = new WebGLRenderer();
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
        const renderer = new WebGLRenderer({ domElement: canvas });

        renderer.initContext();

        expect(getContext).toHaveBeenCalledWith('webgl2', expect.any(Object));
        expect(getContext.mock.calls.some(([contextId]) => contextId === 'webgl')).toBe(false);
    });

    it('binds a first-upload texture to the requested sampler unit after using the upload unit', () => {
        const renderer = new WebGLRenderer({ domElement: document.createElement('canvas') });
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

    it('remains fail-closed until every framebuffer recovers after context loss', () => {
        const renderer = new WebGLRenderer({
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
        const renderer = new WebGLRenderer({
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
        const renderer = new WebGLRenderer();
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
        const firstVao = new Hilo3d.VertexArrayObject(testEnv.gl, '_hiloFirstProgramVao');
        const secondVao = new Hilo3d.VertexArrayObject(testEnv.gl, '_hiloSecondProgramVao');

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
        const renderer = new WebGLRenderer({
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
