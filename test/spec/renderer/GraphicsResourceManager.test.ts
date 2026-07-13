import { describe, expect, it, vi } from 'vitest';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import GraphicsResourceManager, {
    type ManagedResource
} from '../../../src/renderer/GraphicsResourceManager';

function resource(id: string): ManagedResource & { readonly destroy: () => void } {
    return { id, destroy: vi.fn<() => void>() };
}

describe('GraphicsResourceManager', () => {
    it('tracks each mesh current resource snapshot and retires replaced entries', () => {
        const manager = new GraphicsResourceManager();
        const root = new Node();
        const mesh = new Mesh();
        const nested = resource('nested');
        const previous = resource('previous');
        previous.getResources = (resources = []) => {
            resources.push(nested);
            return resources;
        };
        const current = resource('current');
        root.addChild(mesh);

        manager.addMeshResources(mesh, [previous]);
        manager.addMeshResources(mesh, [current, current]);

        expect(manager.getMeshResources(mesh)).toEqual([current]);
        manager.destroyUnusedResource(root);
        expect(previous.destroy).toHaveBeenCalledOnce();
        expect(nested.destroy).toHaveBeenCalledOnce();
        expect(current.destroy).not.toHaveBeenCalled();
    });

    it('keeps shared batch resources alive after the first mesh is removed', () => {
        const manager = new GraphicsResourceManager();
        const root = new Node();
        const first = new Mesh();
        const second = new Mesh();
        const third = new Mesh();
        const shared = resource('instance-batch');
        root.addChild(first);
        root.addChild(second);
        root.addChild(third);
        manager.addMeshResources(first, [shared]);
        manager.addMeshResources(second, [shared]);
        manager.addMeshResources(third, [shared]);

        manager.destroyMesh(first);
        manager.destroyUnusedResource(root);
        expect(shared.destroy).not.toHaveBeenCalled();

        manager.destroyMesh(second);
        manager.destroyMesh(third);
        manager.destroyUnusedResource(root);
        expect(shared.destroy).toHaveBeenCalledOnce();
    });

    it('commits the union of shadow and main-pass resources, then diffs the next frame', () => {
        const manager = new GraphicsResourceManager();
        const root = new Node();
        const mesh = new Mesh();
        const shadowNested = resource('shadow-nested');
        const shadow = resource('shadow');
        shadow.getResources = (resources = []) => {
            resources.push(shadowNested);
            return resources;
        };
        const main = resource('main');
        root.addChild(mesh);

        manager.beginFrame();
        manager.addMeshResources(mesh, [shadow]);
        manager.addMeshResources(mesh, [main, main]);
        expect(manager.getMeshResources(mesh)).toEqual([shadow, shadowNested, main]);
        manager.endFrame();

        expect(manager.getMeshResources(mesh)).toEqual([shadow, shadowNested, main]);
        manager.destroyUnusedResource(root);
        expect(shadow.destroy).not.toHaveBeenCalled();
        expect(shadowNested.destroy).not.toHaveBeenCalled();

        manager.beginFrame();
        manager.addMeshResources(mesh, [main]);
        manager.endFrame();

        expect(manager.getMeshResources(mesh)).toEqual([main]);
        manager.destroyUnusedResource(root);
        expect(shadow.destroy).toHaveBeenCalledOnce();
        expect(shadowNested.destroy).toHaveBeenCalledOnce();
        expect(main.destroy).not.toHaveBeenCalled();
    });

    it('discards an aborted frame without changing the last complete snapshot', () => {
        const manager = new GraphicsResourceManager();
        const mesh = new Mesh();
        const sharingMesh = new Mesh();
        const committed = resource('committed');
        const shared = resource('shared');
        const incomplete = resource('incomplete');
        manager.addMeshResources(mesh, [committed]);
        manager.addMeshResources(sharingMesh, [shared]);

        manager.beginFrame();
        manager.addMeshResources(mesh, [incomplete, shared]);
        expect(manager.getMeshResources(mesh)).toEqual([committed, incomplete, shared]);
        manager.abortFrame();

        expect(manager.getMeshResources(mesh)).toEqual([committed]);
        expect(manager.getMeshResources(sharingMesh)).toEqual([shared]);
        expect(manager.hasNeedDestroyResource).toBe(true);
        manager.destroyUnusedResource();
        expect(committed.destroy).not.toHaveBeenCalled();
        expect(shared.destroy).not.toHaveBeenCalled();
        expect(incomplete.destroy).toHaveBeenCalledOnce();
    });

    it('retires committed and pending resources when a mesh is destroyed mid-frame', () => {
        const manager = new GraphicsResourceManager();
        const mesh = new Mesh();
        const committed = resource('committed');
        const pending = resource('pending');
        manager.addMeshResources(mesh, [committed]);
        manager.beginFrame();
        manager.addMeshResources(mesh, [pending]);

        manager.destroyMesh(mesh);
        expect(manager.getMeshResources(mesh)).toEqual([]);
        manager.endFrame();
        manager.destroyUnusedResource();

        expect(committed.destroy).toHaveBeenCalledOnce();
        expect(pending.destroy).toHaveBeenCalledOnce();
    });

    it('clears both pending work and mesh snapshots after a backend-wide release', () => {
        const manager = new GraphicsResourceManager();
        const mesh = new Mesh();
        const tracked = resource('tracked');
        manager.addMeshResources(mesh, [tracked]);
        manager.destroyIfNoRef(tracked);
        manager.beginFrame();
        manager.addMeshResources(mesh, [resource('incomplete')]);

        manager.clear();

        expect(manager.hasNeedDestroyResource).toBe(false);
        expect(manager.getMeshResources(mesh)).toEqual([]);
        manager.destroyUnusedResource();
        expect(tracked.destroy).not.toHaveBeenCalled();
        expect(() => manager.beginFrame()).not.toThrow();
        manager.abortFrame();
    });
});
