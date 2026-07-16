import { describe, expect, it, vi } from 'vitest';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import Geometry from '../../../src/geometry/Geometry';
import Material from '../../../src/material/Material';
import GraphicsResourceManager, {
    type ManagedResource
} from '../../../src/render/GraphicsResourceManager';

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
        manager.addMeshResources(mesh, [shadow], { key: 'shadow' });
        manager.addMeshResources(mesh, [main, main], { key: 'main' });
        expect(manager.getMeshResources(mesh)).toEqual([shadow, shadowNested, main]);
        manager.endFrame();

        expect(manager.getMeshResources(mesh)).toEqual([shadow, shadowNested, main]);
        manager.destroyUnusedResource(root);
        expect(shadow.destroy).not.toHaveBeenCalled();
        expect(shadowNested.destroy).not.toHaveBeenCalled();

        manager.beginFrame();
        manager.addMeshResources(mesh, [main], { key: 'main' });
        manager.removeMeshVariant(mesh, { key: 'shadow' });
        manager.endFrame();

        expect(manager.getMeshResources(mesh)).toEqual([main]);
        manager.destroyUnusedResource(root);
        expect(shadow.destroy).toHaveBeenCalledOnce();
        expect(shadowNested.destroy).toHaveBeenCalledOnce();
        expect(main.destroy).not.toHaveBeenCalled();
    });

    it('reuses material and pass variants across independent consecutive render frames', () => {
        const manager = new GraphicsResourceManager();
        const root = new Node();
        const mesh = new Mesh({ geometry: new Geometry(), material: new Material() });
        const mainPass = {};
        const auxiliaryPass = {};
        const main = resource('main');
        const position = resource('position');
        const normal = resource('normal');
        root.addChild(mesh);

        manager.beginFrame();
        manager.addMeshResources(mesh, [position], { key: 'position-shader', pass: auxiliaryPass });
        manager.endFrame();
        manager.destroyUnusedResource(root);

        manager.beginFrame();
        manager.addMeshResources(mesh, [main], { key: 'main-shader', pass: mainPass });
        manager.endFrame();
        manager.destroyUnusedResource(root);

        manager.beginFrame();
        manager.addMeshResources(mesh, [normal], { key: 'normal-shader', pass: auxiliaryPass });
        manager.endFrame();
        manager.destroyUnusedResource(root);

        manager.beginFrame();
        manager.addMeshResources(mesh, [position], { key: 'position-shader', pass: auxiliaryPass });
        manager.endFrame();
        manager.destroyUnusedResource(root);

        expect(manager.getMeshResources(mesh)).toEqual([position, normal, main]);
        expect(position.destroy).not.toHaveBeenCalled();
        expect(normal.destroy).not.toHaveBeenCalled();
        expect(main.destroy).not.toHaveBeenCalled();
    });

    it('releases one removed variant while preserving resources shared by a sibling variant', () => {
        const manager = new GraphicsResourceManager();
        const root = new Node();
        const mesh = new Mesh({ geometry: new Geometry(), material: new Material() });
        const pass = {};
        const first = resource('first');
        const second = resource('second');
        const shared = resource('shared');
        root.addChild(mesh);
        manager.addMeshResources(mesh, [first, shared], { key: 'first', pass });
        manager.addMeshResources(mesh, [second, shared], { key: 'second', pass });

        manager.removeMeshVariant(mesh, { key: 'first', pass });
        manager.destroyUnusedResource(root);

        expect(first.destroy).toHaveBeenCalledOnce();
        expect(shared.destroy).not.toHaveBeenCalled();
        expect(second.destroy).not.toHaveBeenCalled();

        manager.releasePass(pass);
        manager.destroyUnusedResource(root);

        expect(shared.destroy).toHaveBeenCalledOnce();
        expect(second.destroy).toHaveBeenCalledOnce();
    });

    it('retires every old variant when the mesh material or geometry owner is replaced', () => {
        const manager = new GraphicsResourceManager();
        const root = new Node();
        const mesh = new Mesh({ geometry: new Geometry(), material: new Material() });
        const main = resource('main');
        const forced = resource('forced');
        const replacementMaterial = resource('replacement-material');
        const replacementGeometry = resource('replacement-geometry');
        root.addChild(mesh);
        manager.addMeshResources(mesh, [main], { key: 'main' });
        manager.addMeshResources(mesh, [forced], { key: 'forced' });

        mesh.material = new Material();
        manager.addMeshResources(mesh, [replacementMaterial], { key: 'main' });
        manager.destroyUnusedResource(root);

        expect(main.destroy).toHaveBeenCalledOnce();
        expect(forced.destroy).toHaveBeenCalledOnce();
        expect(replacementMaterial.destroy).not.toHaveBeenCalled();

        mesh.geometry = new Geometry();
        manager.addMeshResources(mesh, [replacementGeometry], { key: 'main' });
        manager.destroyUnusedResource(root);

        expect(replacementMaterial.destroy).toHaveBeenCalledOnce();
        expect(replacementGeometry.destroy).not.toHaveBeenCalled();
    });

    it('bounds dormant variants with deterministic least-recently-used eviction', () => {
        const manager = new GraphicsResourceManager({ maxVariantsPerMesh: 2 });
        const root = new Node();
        const mesh = new Mesh({ geometry: new Geometry(), material: new Material() });
        const first = resource('first');
        const second = resource('second');
        const third = resource('third');
        root.addChild(mesh);
        manager.addMeshResources(mesh, [first], { key: 'first' });
        manager.addMeshResources(mesh, [second], { key: 'second' });
        manager.addMeshResources(mesh, [first], { key: 'first' });
        manager.addMeshResources(mesh, [third], { key: 'third' });
        manager.destroyUnusedResource(root);

        expect(manager.getMeshResources(mesh)).toEqual([first, third]);
        expect(first.destroy).not.toHaveBeenCalled();
        expect(second.destroy).toHaveBeenCalledOnce();
        expect(third.destroy).not.toHaveBeenCalled();
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

    it('reports backend-neutral lifecycle diagnostics for committed and active frames', () => {
        const manager = new GraphicsResourceManager();
        const root = new Node();
        const visibleMesh = new Mesh();
        const detachedMesh = new Mesh();
        const shared = resource('shared');
        const visible = resource('visible');
        const pending = resource('pending');
        root.addChild(visibleMesh);
        manager.addMeshResources(visibleMesh, [shared, visible]);
        manager.addMeshResources(detachedMesh, [shared]);
        manager.destroyIfNoRef(pending);
        manager.beginFrame();
        manager.addMeshResources(visibleMesh, [shared]);

        expect(manager.getDiagnostics(root)).toEqual({
            trackedMeshCount: 2,
            trackedResourceCount: 2,
            usedResourceCount: 2,
            pendingDestroyCount: 1,
            frameActive: true
        });

        manager.abortFrame();
        expect(manager.getDiagnostics()).toEqual({
            trackedMeshCount: 2,
            trackedResourceCount: 2,
            usedResourceCount: 2,
            pendingDestroyCount: 1,
            frameActive: false
        });
    });
});
