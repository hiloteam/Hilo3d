import { describe, expect, it } from 'vitest';
import { createClip } from '../../../editor/animation';
import { createPrefab, instantiatePrefab } from '../../../editor/prefabs';
import { createProject, validateProject } from '../../../editor/project';
import {
    createProjectScene,
    deleteProjectScene,
    duplicateProjectScene
} from '../../../editor/project-panel';
import { createDefaultScene } from '../../../editor/scene';
import { createScript } from '../../../editor/script-types';

describe('project scene operations', () => {
    it('creates an independent empty scene while preserving shared authoring records', () => {
        const project = createProject(createDefaultScene());
        project.scripts['rotate'] = createScript('rotate');
        const next = createProjectScene(project, 'Lighting Stage');
        expect(next.activeSceneId).toBe('scene-001');
        expect(next.scenes['scene-001']?.name).toBe('Lighting Stage');
        expect(next.scenes['scene-001']?.nodes).toEqual({});
        expect(next.scripts).toEqual(project.scripts);
        expect(Object.keys(project.scenes)).toEqual(['scene-main']);
        expect(next.scenes['scene-main']).not.toBe(project.scenes['scene-main']);
    });

    it('duplicates scene content, animation tracks and prefab links without aliasing', () => {
        const project = createProject(createDefaultScene());
        const source = project.scenes[project.activeSceneId];
        if (!source) throw new Error('Missing scene');
        const prefab = createPrefab(source, 'hero-sphere', 'porcelain', 'Porcelain');
        project.prefabs[prefab.id] = prefab;
        const instance = instantiatePrefab(
            source,
            prefab,
            project.activeSceneId,
            'porcelain-instance'
        );
        project.instances[instance.instance.id] = instance.instance;
        project.scenes[project.activeSceneId] = instance.scene;
        const clip = createClip('hero-move', project.activeSceneId);
        clip.tracks = [
            {
                id: 'hero-x',
                nodeId: 'hero-sphere',
                property: 'position.x',
                keys: [
                    { time: 0, value: 0, interpolation: 'linear' },
                    { time: 3, value: 1, interpolation: 'linear' }
                ]
            }
        ];
        project.clips[clip.id] = clip;
        const next = duplicateProjectScene(validateProject(project), project.activeSceneId);
        expect(next.activeSceneId).toBe('scene-001');
        expect(next.scenes[next.activeSceneId]?.name).toBe('Terracotta Study copy');
        const copiedInstance = Object.values(next.instances).find(
            value => value.sceneId === next.activeSceneId
        );
        expect(copiedInstance?.prefabId).toBe(prefab.id);
        expect(copiedInstance?.id).not.toBe(instance.instance.id);
        const copiedClip = Object.values(next.clips).find(
            value => value.sceneId === next.activeSceneId
        );
        expect(copiedClip?.tracks).toEqual(clip.tracks);
        expect(copiedClip?.tracks).not.toBe(clip.tracks);
        const removed = deleteProjectScene(next, next.activeSceneId);
        expect(removed.activeSceneId).toBe(project.activeSceneId);
        expect(removed.instances).toEqual(project.instances);
        expect(removed.clips).toEqual(project.clips);
        expect(removed.prefabs).toEqual(project.prefabs);
    });

    it('prevents deleting the final scene and rejects nonexistent IDs without mutation', () => {
        const project = createProject(createDefaultScene());
        expect(() => deleteProjectScene(project, project.activeSceneId)).toThrow('at least one');
        expect(() => deleteProjectScene(project, 'missing')).toThrow('no longer exists');
        expect(() => duplicateProjectScene(project, 'missing')).toThrow('no longer exists');
        expect(() => createProjectScene(project, '')).toThrow('name');
        expect(Object.keys(project.scenes)).toEqual(['scene-main']);
    });
});
