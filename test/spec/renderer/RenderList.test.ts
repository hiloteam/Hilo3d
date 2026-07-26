import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import RenderList from '../../../src/render/RenderList';
import { testEnv } from '../../renderer-setup';

function createMesh(transparent: boolean, options: { renderOrder?: number } = {}): Hilo3d.Mesh {
    const material = new Hilo3d.Material({
        transparent,
        renderOrder: options.renderOrder ?? 0
    });
    const geometry = new Hilo3d.BoxGeometry();
    return new Hilo3d.Mesh({ material, geometry });
}

describe('RenderList', () => {
    it('create', () => {
        const list = new RenderList();
        expect(list.isRenderList).toBe(true);
        expect(list.className).toBe('RenderList');
    });

    let list = new RenderList();
    beforeEach(() => {
        list = new RenderList();
        const camera = testEnv.camera;

        list.addMesh(createMesh(true), camera);
        list.addMesh(createMesh(false), camera);
        list.addMesh(createMesh(false), camera);
        list.addMesh(createMesh(true), camera);
        list.addMesh(createMesh(false), camera);
        list.addMesh(createMesh(false, { renderOrder: 1 }), camera);
        list.addMesh(createMesh(false, { renderOrder: -1 }), camera);
    });

    it('sort', () => {
        list.sort();
        expect(list.opaqueList.at(0)?.material?.renderOrder).toBe(-1);
        expect(list.opaqueList.at(-1)?.material?.renderOrder).toBe(1);
    });

    it('addMesh', () => {
        expect(list.transparentList).toHaveLength(2);
        expect(list.opaqueList).toHaveLength(5);
    });

    it('traverse', () => {
        const callback = vi.fn<(mesh: Hilo3d.Mesh) => void>();
        list.traverse(callback);
        expect(callback).toHaveBeenCalledTimes(7);
    });

    it('preserves camera-visible scene order for the shared draw planner', () => {
        const first = createMesh(true);
        const second = createMesh(false);
        first.useInstanced = true;
        list.reset();
        list.useInstanced = true;

        list.addMesh(first, testEnv.camera);
        list.addMesh(second, testEnv.camera);

        const callback = vi.fn<(mesh: Hilo3d.Mesh) => void>();
        list.traverse(callback);
        expect(callback.mock.calls.map(call => call[0])).toEqual([first, second]);
    });

    it('skips duplicate legacy classification in ordered-only shared-planner mode', () => {
        const first = createMesh(true);
        const second = createMesh(false);
        first.useInstanced = true;
        list.reset();
        list.orderedOnly = true;
        list.useInstanced = true;

        list.addMesh(first, testEnv.camera);
        list.addMesh(second, testEnv.camera);
        list.sort();

        expect(list.orderedList).toEqual([first, second]);
        expect(list.opaqueList).toEqual([]);
        expect(list.transparentList).toEqual([]);
        const instancedCallback = vi.fn<(meshes: Hilo3d.Mesh[]) => void>();
        list.traverse(vi.fn(), instancedCallback);
        expect(instancedCallback).not.toHaveBeenCalled();
    });

    it('keeps explicitly opted-in transparent meshes on the instanced path', () => {
        const transparent = createMesh(true);
        const material = transparent.material;
        const geometry = transparent.geometry;
        const second = new Hilo3d.Mesh({ material, geometry, useInstanced: true });
        transparent.useInstanced = true;
        list.reset();
        list.useInstanced = true;

        list.addMesh(transparent, testEnv.camera);
        list.addMesh(second, testEnv.camera);

        expect(list.transparentList).toHaveLength(0);
        const instancedCallback = vi.fn<(meshes: Hilo3d.Mesh[]) => void>();
        list.traverse(vi.fn(), instancedCallback);
        expect(instancedCallback).toHaveBeenCalledOnce();
        expect(instancedCallback).toHaveBeenCalledWith([transparent, second]);
    });

    it('does not downgrade a single opted-in mesh from the instanced shader contract', () => {
        const mesh = createMesh(false);
        mesh.useInstanced = true;
        list.reset();
        list.useInstanced = true;
        list.addMesh(mesh, testEnv.camera);

        const directCallback = vi.fn<(item: Hilo3d.Mesh) => void>();
        const instancedCallback = vi.fn<(meshes: Hilo3d.Mesh[]) => void>();
        list.traverse(directCallback, instancedCallback);

        expect(directCallback).not.toHaveBeenCalled();
        expect(instancedCallback).toHaveBeenCalledWith([mesh]);
    });

    it('reset', () => {
        list.reset();
        expect(list.transparentList).toHaveLength(0);
        expect(list.opaqueList).toHaveLength(0);
        const callback = vi.fn<(mesh: Hilo3d.Mesh) => void>();
        list.traverse(callback);
        expect(callback).not.toHaveBeenCalled();
    });
});
