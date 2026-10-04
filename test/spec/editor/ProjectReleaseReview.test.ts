import { describe, expect, it } from 'vitest';
import { createClip } from '../../../editor/animation';
import { PrefabPanel } from '../../../editor/prefab-panel';
import {
    createPrefab,
    instantiatePrefab,
    prefabFromInstance,
    updatePrefabInstance
} from '../../../editor/prefabs';
import { createProject } from '../../../editor/project';
import { ProjectHistory } from '../../../editor/project-history';
import { cloneScene, createDefaultScene, parseScene, serializeScene } from '../../../editor/scene';
import { ScriptPanel } from '../../../editor/script-panel';
import { createScript } from '../../../editor/script-types';

describe('cross-feature authoring release regressions', () => {
    it('migrates genuine version1 scenes but rejects version2-only fields under a legacy label', () => {
        const legacy = { ...createDefaultScene(), version: 1 };
        expect(parseScene(JSON.stringify(legacy)).version).toBe(2);
        const withLock = structuredClone(legacy);
        const group = withLock.nodes['sculpture'];
        if (!group) throw new Error('Missing group');
        group.locked = true;
        expect(() => parseScene(JSON.stringify(withLock))).toThrow();
        const withTexture = structuredClone(legacy);
        const material = withTexture.materials['porcelain'];
        if (!material) throw new Error('Missing material');
        material.baseColorTexture = 'source-texture';
        expect(() => parseScene(JSON.stringify(withTexture))).toThrow();
        const withCamera = structuredClone(legacy);
        withCamera.nodes['new-camera'] = {
            ...structuredClone(group),
            type: 'camera',
            camera: { fov: 45, near: 0.1, far: 100 }
        };
        Reflect.deleteProperty(withCamera.nodes['new-camera'], 'locked');
        expect(() => parseScene(JSON.stringify(withCamera))).toThrow();
    });

    it('rejects a scene whose canonical export would exceed its own import byte limit', () => {
        const scene = createDefaultScene();
        const prototype = scene.nodes['sculpture'];
        if (!prototype) throw new Error('Missing group');
        prototype.name = '陶'.repeat(120);
        prototype.type = 'model';
        prototype.locked = true;
        prototype.asset = `model-${'a'.repeat(58)}`;
        prototype.material = `material-${'b'.repeat(55)}`;
        prototype.scripts = Array.from(
            { length: 16 },
            (_, index) => `script-${'a'.repeat(54)}-${String(index).padStart(2, '0')}`
        );
        scene.materials = {
            [prototype.material]: { name: 'Material', color: '#ffffff', metallic: 0, roughness: 1 }
        };
        scene.nodes = Object.fromEntries(
            Array.from({ length: 1000 }, (_, index) => [`node-${String(index)}`, prototype])
        );
        expect(() => cloneScene(scene)).toThrow('2 MiB');
        expect(() => serializeScene(scene)).toThrow('2 MiB');
    });

    it('removes an unchanged optional material slot while retaining a separate instance override', () => {
        const source = createDefaultScene();
        const porcelain = source.materials['porcelain'];
        if (!porcelain) throw new Error('Missing material');
        porcelain.baseColorTexture = 'tile-texture';
        const prefab = createPrefab(source, 'hero-sphere', 'study', 'Study');
        const { scene, instance } = instantiatePrefab(
            source,
            prefab,
            'scene-main',
            'instance-study'
        );
        const materialId = instance.materialMap['porcelain'];
        if (!materialId || !scene.materials[materialId])
            throw new Error('Missing instance material');
        scene.materials[materialId].roughness = 0.15;
        const updated = structuredClone(prefab);
        Reflect.deleteProperty(updated.materials['porcelain'] ?? {}, 'baseColorTexture');
        const result = updatePrefabInstance(scene, updated, instance);
        expect(result.scene.materials[materialId]?.baseColorTexture).toBeUndefined();
        expect(result.scene.materials[materialId]?.roughness).toBe(0.15);
    });

    it('preserves an added child material when its scene ID matches another template material ID', () => {
        const source = createDefaultScene();
        const prefab = createPrefab(source, 'sculpture', 'study', 'Study');
        const { scene, instance } = instantiatePrefab(
            source,
            prefab,
            'scene-main',
            'instance-study'
        );
        const original = scene.materials['charcoal'];
        const block = scene.nodes['small-block'];
        if (!original || !block) throw new Error('Missing fixture content');
        original.color = '#ff0000';
        scene.nodes['local-cube'] = {
            ...structuredClone(block),
            parent: instance.rootId,
            material: 'charcoal'
        };
        const applied = prefabFromInstance(scene, instance);
        const addedMaterial = applied.nodes['local-cube']?.material;
        const originalMaterial = applied.nodes['small-block']?.material;
        expect(addedMaterial).not.toBe(originalMaterial);
        expect(addedMaterial ? applied.materials[addedMaterial]?.color : undefined).toBe('#ff0000');
        expect(originalMaterial ? applied.materials[originalMaterial]?.color : undefined).toBe(
            '#45484b'
        );
    });

    it('applies a removed prefab child and prunes its animation bindings in one reversible transaction', () => {
        const project = createProject(createDefaultScene());
        const scene = project.scenes[project.activeSceneId];
        if (!scene) throw new Error('Missing scene');
        const prefab = createPrefab(scene, 'sculpture', 'study', 'Study');
        const first = instantiatePrefab(scene, prefab, project.activeSceneId, 'first-instance');
        const second = instantiatePrefab(
            first.scene,
            prefab,
            project.activeSceneId,
            'second-instance'
        );
        project.scenes[project.activeSceneId] = second.scene;
        project.prefabs[prefab.id] = prefab;
        project.instances[first.instance.id] = first.instance;
        project.instances[second.instance.id] = second.instance;
        const firstChild = first.instance.nodeMap['hero-sphere'];
        const secondChild = second.instance.nodeMap['hero-sphere'];
        if (!firstChild || !secondChild) throw new Error('Missing children');
        const clip = createClip('motion', project.activeSceneId);
        clip.tracks = [
            {
                id: 'motion-x',
                nodeId: secondChild,
                property: 'position.x',
                keys: [{ time: 0, value: 0, interpolation: 'linear' }]
            }
        ];
        project.clips[clip.id] = clip;
        const history = new ProjectHistory(project);
        const changed = history.scene;
        Reflect.deleteProperty(changed.nodes, firstChild);
        history.commit(changed);
        const messages: string[] = [];
        const panel = new PrefabPanel({
            getProject: () => history.project,
            getSelected: () => first.instance.rootId,
            onCommit: next => {
                history.commitProject(next);
            },
            onSelect: () => undefined,
            onNotify: message => {
                messages.push(message);
            }
        });
        const host = document.createElement('div');
        document.body.append(host);
        try {
            panel.renderInspector(host);
            host.querySelector<HTMLButtonElement>('[data-prefab-action="apply"]')?.click();
            expect(messages).toEqual([]);
            expect(history.scene.nodes[secondChild]).toBeUndefined();
            expect(history.project.clips[clip.id]?.tracks).toEqual([]);
            history.undo();
            expect(history.scene.nodes[secondChild]).toBeDefined();
            expect(history.project.clips[clip.id]?.tracks).toEqual(clip.tracks);
        } finally {
            host.remove();
        }
    });

    it('does not attach scripts through a locked parent collection', () => {
        let project = createProject(createDefaultScene());
        const group = project.scenes[project.activeSceneId]?.nodes['sculpture'];
        if (!group) throw new Error('Missing group');
        group.locked = true;
        project.scripts['spin'] = createScript('spin');
        const messages: string[] = [];
        const app = document.createElement('div');
        const inspector = document.createElement('div');
        app.append(inspector);
        document.body.append(app);
        const panel = new ScriptPanel(app, {
            getProject: () => structuredClone(project),
            getSelected: () => 'hero-sphere',
            onCommit: next => {
                project = next;
            },
            onNotify: message => {
                messages.push(message);
            }
        });
        try {
            panel.renderInspector(inspector);
            const select = inspector.querySelector<HTMLSelectElement>('select');
            if (!select) throw new Error('Missing script selector');
            select.value = 'spin';
            select.dispatchEvent(new Event('change', { bubbles: true }));
            expect(
                project.scenes[project.activeSceneId]?.nodes['hero-sphere']?.scripts
            ).toBeUndefined();
            expect(messages.some(message => /unlock|locked/iu.test(message))).toBe(true);
        } finally {
            panel.destroy();
            app.remove();
        }
    });
});
