import { describe, expect, it } from 'vitest';
import { createDefaultScene } from '../../../editor/scene';
import {
    createPrefab,
    instantiatePrefab,
    prefabOverrides,
    updatePrefabInstance,
    prefabFromInstance
} from '../../../editor/prefabs';

describe('Prefab authoring', () => {
    it('creates an isolated subtree and fresh identities for each instance', () => {
        const scene = createDefaultScene();
        const prefab = createPrefab(scene, 'sculpture', 'sculpture-template', 'Sculpture');
        expect(prefab.nodes['ground']).toBeUndefined();
        const first = instantiatePrefab(scene, prefab, 'scene-main', 'instance-one');
        const second = instantiatePrefab(first.scene, prefab, 'scene-main', 'instance-two');
        expect(second.instance.rootId).not.toBe(first.instance.rootId);
        expect(prefabOverrides(second.scene, second.instance)).toEqual([]);
        expect(second.scene.nodes[second.instance.nodeMap['hero-sphere'] ?? '']?.material).not.toBe(
            'porcelain'
        );
    });
    it('updates untouched axes while retaining instance overrides and supports revert', () => {
        const scene = createDefaultScene();
        const prefab = createPrefab(scene, 'sculpture', 'sculpture-template', 'Sculpture');
        const instance = instantiatePrefab(scene, prefab, 'scene-main', 'instance-one');
        const id = instance.instance.nodeMap['hero-sphere'] ?? '';
        const node = instance.scene.nodes[id];
        const source = prefab.nodes['hero-sphere'];
        if (!node || !source) throw new Error('Missing sphere');
        node.transform.position.x = 8;
        source.transform.position.x = 2;
        source.transform.position.y = 4;
        const updated = updatePrefabInstance(instance.scene, prefab, instance.instance);
        expect(updated.scene.nodes[id]?.transform.position).toEqual({ x: 8, y: 4, z: 0 });
        expect(prefabOverrides(updated.scene, updated.instance)).toContainEqual({
            nodeId: id,
            property: 'transform',
            kind: 'changed'
        });
        const reverted = updatePrefabInstance(updated.scene, prefab, updated.instance, true);
        expect(reverted.scene.nodes[id]?.transform.position.x).toBe(2);
        expect(prefabOverrides(reverted.scene, reverted.instance)).toEqual([]);
    });
    it('applies an instance back to a template and round trips nested references', () => {
        const scene = createDefaultScene();
        const prefab = createPrefab(scene, 'sculpture', 'sculpture-template', 'Sculpture');
        const instance = instantiatePrefab(scene, prefab, 'scene-main', 'instance-one');
        const node = instance.scene.nodes[instance.instance.nodeMap['hero-sphere'] ?? ''];
        if (!node) throw new Error('Missing sphere');
        node.name = 'Custom sphere';
        const applied = prefabFromInstance(instance.scene, instance.instance);
        expect(applied.nodes['hero-sphere']?.name).toBe('Custom sphere');
        expect(applied.nodes['hero-sphere']?.parent).toBe('sculpture');
        expect(applied.nodes['hero-sphere']?.material).toBe('porcelain');
    });
});
