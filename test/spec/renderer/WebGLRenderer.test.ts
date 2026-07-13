import { describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import type { ProgramAttribute } from '../../../src/renderer/Program';
import type Program from '../../../src/renderer/Program';
import { testEnv } from '../../setup';

const WebGLRenderer = Hilo3d.WebGLRenderer;

describe('WebGLRenderer', () => {
    it('create', () => {
        const renderer = new WebGLRenderer();
        expect(renderer.isWebGLRenderer).toBe(true);
        expect(renderer.className).toBe('WebGLRenderer');
    });

    it('creates only a WebGL 2 context', () => {
        const canvas = document.createElement('canvas');
        const getContext = vi.spyOn(canvas, 'getContext');
        const renderer = new WebGLRenderer({ domElement: canvas });

        renderer.initContext();

        expect(getContext).toHaveBeenCalledWith('webgl2', expect.any(Object));
        expect(getContext.mock.calls.some(([contextId]) => contextId === 'webgl')).toBe(false);
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
