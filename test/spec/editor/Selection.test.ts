import { describe, expect, it } from 'vitest';
import { createDefaultScene } from '../../../editor/scene';
import { createProject } from '../../../editor/project';
import { createPrefab, instantiatePrefab } from '../../../editor/prefabs';
import { duplicateSelection, selectionRoots } from '../../../editor/selection';

describe('selection transactions', () => {
    it('duplicates selected roots once and retains nested parenting', () => {
        const project = createProject(createDefaultScene());
        const scene = project.scenes[project.activeSceneId];
        if (!scene) throw new Error('Missing scene');
        expect(selectionRoots(scene, ['sculpture', 'hero-sphere'])).toEqual(['sculpture']);
        const result = duplicateSelection(project, ['sculpture', 'hero-sphere']);
        const copied = result.project.scenes[project.activeSceneId];
        expect(Object.keys(copied?.nodes ?? {})).toHaveLength(16);
        expect(result.selection).toHaveLength(1);
        expect(copied?.nodes['hero-sphere-copy-1']?.parent).toBe(result.selection[0]);
        expect(Object.keys(scene.nodes)).toHaveLength(9);
    });
    it('keeps duplicated prefab links with isolated material overrides', () => {
        const project = createProject(createDefaultScene());
        const scene = project.scenes[project.activeSceneId];
        if (!scene) throw new Error('Missing scene');
        const prefab = createPrefab(scene, 'sculpture', 'prefab-study', 'Study');
        const instance = instantiatePrefab(scene, prefab, project.activeSceneId, 'instance-study');
        project.prefabs[prefab.id] = prefab;
        project.instances[instance.instance.id] = instance.instance;
        project.scenes[project.activeSceneId] = instance.scene;
        const result = duplicateSelection(project, [instance.instance.rootId]);
        const copy = Object.values(result.project.instances).find(
            value => value.id !== instance.instance.id
        );
        expect(copy?.rootId).toBe(result.selection[0]);
        expect(copy?.prefabId).toBe(prefab.id);
        expect(copy?.materialMap['porcelain']).not.toBe(instance.instance.materialMap['porcelain']);
    });
});
