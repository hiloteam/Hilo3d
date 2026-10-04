import { describe, expect, it } from 'vitest';
import { createClip } from '../../../editor/animation';
import { importAsset } from '../../../editor/assets';
import { createPrefab, instantiatePrefab } from '../../../editor/prefabs';
import { createProject } from '../../../editor/project';
import { ProjectHistory } from '../../../editor/project-history';
import { createProjectScene } from '../../../editor/project-panel';
import { createDefaultScene } from '../../../editor/scene';

async function asset(marker = 'source'): ReturnType<typeof importAsset> {
    const json = new TextEncoder().encode(
        JSON.stringify({ asset: { version: '2.0', generator: marker } })
    );
    const length = Math.ceil(json.length / 4) * 4;
    const bytes = new Uint8Array(length + 20);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, bytes.length, true);
    view.setUint32(12, length, true);
    view.setUint32(16, 0x4e4f534a, true);
    bytes.fill(32, 20);
    bytes.set(json, 20);
    return importAsset(new File([bytes], 'Source.glb'));
}

describe('project authoring history', () => {
    it('prunes old unique asset sets to a byte budget while preserving the current snapshot', async () => {
        const first = await asset('first');
        const second = await asset('second');
        const project = createProject(createDefaultScene());
        project.assets[first.id] = first;
        const history = new ProjectHistory(project, {
            maxAssetBytes: Math.max(first.size, second.size)
        });
        const next = history.project;
        next.assets = { [second.id]: second };
        history.commitProject(next);
        expect(history.memoryUsage.entries).toBe(1);
        expect(history.memoryUsage.assetBytes).toBe(second.size);
        expect(history.memoryUsage.overBudget).toBe(false);
        expect(history.canUndo).toBe(false);
        expect(history.project.assets).toEqual({ [second.id]: second });
    });

    it('accounts for shared hashes, discarded redo branches and assets released by entry pruning', async () => {
        const first = await asset('first');
        const second = await asset('second');
        const project = createProject(createDefaultScene());
        project.assets[first.id] = first;
        const history = new ProjectHistory(project, { maxEntries: 2 });
        let next = history.project;
        next.name = 'Same binary';
        history.commitProject(next);
        expect(history.memoryUsage.assetBytes).toBe(first.size);
        history.undo();
        next = history.project;
        next.assets = { [second.id]: second };
        history.commitProject(next);
        expect(history.canRedo).toBe(false);
        expect(history.memoryUsage.assetBytes).toBe(first.size + second.size);
        next = history.project;
        next.assets = {};
        history.commitProject(next);
        expect(history.memoryUsage.entries).toBe(2);
        expect(history.memoryUsage.assetBytes).toBe(second.size);
        history.undo();
        expect(history.project.assets[second.id]).toEqual(second);
        history.redo();
        expect(history.project.assets).toEqual({});
        expect(history.memoryUsage.assetBytes).toBe(second.size);
    });

    it('bounds canonical metadata and retains a valid current document even above tighter limits', async () => {
        const project = createProject(createDefaultScene());
        const base = new ProjectHistory(project).memoryUsage.metadataBytes;
        const history = new ProjectHistory(project, { maxMetadataBytes: base * 2 + 100 });
        for (let index = 0; index < 5; index += 1) {
            const next = history.project;
            next.name = `Metadata ${String(index)}`;
            history.commitProject(next);
        }
        expect(history.memoryUsage.entries).toBe(2);
        expect(history.memoryUsage.metadataBytes).toBeLessThanOrEqual(base * 2 + 100);
        const before = history.memoryUsage;
        history.undo();
        expect(history.memoryUsage).toEqual(before);
        history.redo();
        const imported = await asset();
        project.assets[imported.id] = imported;
        const tight = new ProjectHistory(project, { maxAssetBytes: 1, maxMetadataBytes: 1 });
        expect(tight.memoryUsage).toMatchObject({
            entries: 1,
            assetBytes: imported.size,
            overBudget: true
        });
        expect(tight.project.assets[imported.id]).toEqual(imported);
        const next = tight.project;
        next.name = 'Still retained';
        tight.commitProject(next);
        expect(tight.memoryUsage.entries).toBe(1);
        expect(tight.project.name).toBe('Still retained');
        expect(() => new ProjectHistory(project, { maxEntries: 81 })).toThrow('maxEntries');
        expect(() => new ProjectHistory(project, { maxAssetBytes: 129 * 1024 * 1024 })).toThrow(
            'maxAssetBytes'
        );
        expect(() => new ProjectHistory(project, { maxMetadataBytes: 0 })).toThrow(
            'maxMetadataBytes'
        );
    });

    it('undoes asset metadata and active-scene transactions while durable revisions never rewind', async () => {
        const initial = createProject(createDefaultScene());
        const history = new ProjectHistory(initial);
        const imported = await asset();
        const withAsset = history.project;
        withAsset.assets[imported.id] = imported;
        expect(history.commitProject(withAsset)).toBe(true);
        const renamed = history.project;
        const source = renamed.assets[imported.id];
        if (!source) throw new Error('Missing asset');
        source.name = 'Portable Source';
        history.commitProject(renamed);
        history.commitProject(createProjectScene(history.project, 'New Stage'));
        const savedAt = '2099-01-01T00:00:00.000Z';
        history.markSaved(7, savedAt);
        history.undo();
        expect(history.project.activeSceneId).toBe(initial.activeSceneId);
        expect(history.project.assets[imported.id]?.name).toBe('Portable Source');
        history.undo();
        expect(history.project.assets[imported.id]).toEqual(imported);
        expect(history.project.revision).toBe(7);
        expect(history.project.updatedAt).toBe(savedAt);
        const copy = history.project;
        const detached = copy.assets[imported.id];
        if (!detached) throw new Error('Missing copy');
        detached.source.fileName = 'Changed externally';
        detached.data = '';
        expect(history.project.assets[imported.id]).toEqual(imported);
        history.redo();
        history.redo();
        expect(history.scene.name).toBe('New Stage');
        expect(history.project.assets[imported.id]?.data).toBe(imported.data);
        expect(history.project.revision).toBe(7);
    });

    it('removes orphaned instance links and animation targets in the same undoable scene edit', () => {
        const project = createProject(createDefaultScene());
        const scene = project.scenes[project.activeSceneId];
        if (!scene) throw new Error('Missing scene');
        const prefab = createPrefab(scene, 'hero-sphere', 'sphere-prefab', 'Sphere');
        const created = instantiatePrefab(scene, prefab, project.activeSceneId, 'sphere-instance');
        project.prefabs[prefab.id] = prefab;
        project.instances[created.instance.id] = created.instance;
        project.scenes[project.activeSceneId] = created.scene;
        const clip = createClip('motion', project.activeSceneId);
        clip.tracks = [
            {
                id: 'translate',
                nodeId: created.instance.rootId,
                property: 'position.x',
                keys: [{ time: 0, value: 0, interpolation: 'linear' }]
            }
        ];
        project.clips[clip.id] = clip;
        const history = new ProjectHistory(project);
        const changed = history.scene;
        Reflect.deleteProperty(changed.nodes, created.instance.rootId);
        history.commit(changed);
        expect(history.project.instances).toEqual({});
        expect(history.project.clips[clip.id]?.tracks).toEqual([]);
        history.undo();
        expect(history.project.instances).toEqual(project.instances);
        expect(history.project.clips).toEqual(project.clips);
        expect(history.scene.nodes[created.instance.rootId]).toEqual(
            created.scene.nodes[created.instance.rootId]
        );
    });

    it('retains redo on no-op commits, rejects invalid snapshots and bounds complete transactions', async () => {
        const history = new ProjectHistory(createProject(createDefaultScene()));
        const imported = await asset();
        let project = history.project;
        project.assets[imported.id] = imported;
        history.commitProject(project);
        for (let index = 1; index <= 83; index += 1) {
            project = history.project;
            project.name = `Version ${String(index)}`;
            history.commitProject(project);
        }
        history.undo();
        expect(history.commitProject(history.project)).toBe(false);
        expect(history.canRedo).toBe(true);
        const invalid = history.project;
        invalid.activeSceneId = 'missing';
        expect(() => history.commitProject(invalid)).toThrow('missing scene');
        expect(history.canRedo).toBe(true);
        history.redo();
        let undos = 0;
        while (history.canUndo) {
            history.undo();
            undos += 1;
        }
        expect(undos).toBe(79);
        expect(history.project.name).toBe('Version 4');
        expect(history.project.assets[imported.id]).toEqual(imported);
        project = history.project;
        project.name = 'Branch';
        history.commitProject(project);
        expect(history.canRedo).toBe(false);
    });
});
