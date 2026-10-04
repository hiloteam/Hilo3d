import { describe, expect, it } from 'vitest';
import {
    AssetPanel,
    assetReferences,
    removeProjectAsset,
    useProjectAsset
} from '../../../editor/asset-panel';
import { importAsset } from '../../../editor/assets';
import { createPrefab, instantiatePrefab } from '../../../editor/prefabs';
import { createProject, validateProject } from '../../../editor/project';
import { createDefaultScene } from '../../../editor/scene';

function model(name = 'Chair', generator = 'Hilo'): File {
    const text = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0', generator } }));
    const length = Math.ceil(text.length / 4) * 4;
    const bytes = new Uint8Array(20 + length);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, bytes.length, true);
    view.setUint32(12, length, true);
    view.setUint32(16, 0x4e4f534a, true);
    bytes.fill(32, 20);
    bytes.set(text, 20);
    return new File([bytes], `${name}.glb`);
}

async function texture(): Promise<File> {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(value => {
            if (value) resolve(value);
            else reject(new Error('No image'));
        });
    });
    return new File([blob], 'Color.png');
}

describe('project asset operations', () => {
    it('instantiates models with fresh stable IDs and respects locked hierarchy parents', async () => {
        const project = createProject(createDefaultScene());
        const asset = await importAsset(model());
        project.assets[asset.id] = asset;
        const first = useProjectAsset(project, asset.id, 'sculpture');
        const second = useProjectAsset(first.project, asset.id, 'sculpture');
        expect(first.nodeId).not.toBe(second.nodeId);
        expect(first.project.scenes[first.project.activeSceneId]?.nodes[first.nodeId]?.parent).toBe(
            'sculpture'
        );
        const group = project.scenes[project.activeSceneId]?.nodes['sculpture'];
        if (!group) throw new Error('Missing group');
        group.locked = true;
        expect(() => useProjectAsset(project, asset.id, 'hero-sphere')).toThrow('Unlock');
        expect(() => removeProjectAsset(first.project, asset.id)).toThrow('used by');
        expect(removeProjectAsset(project, asset.id).assets).toEqual({});
    });

    it('applies textures only to existing mesh materials and records cross-scene dependencies', async () => {
        const project = createProject(createDefaultScene());
        const asset = await importAsset(await texture());
        project.assets[asset.id] = asset;
        expect(() => useProjectAsset(project, asset.id, null)).toThrow('Select a mesh');
        const result = useProjectAsset(project, asset.id, 'hero-sphere');
        expect(
            result.project.scenes[result.project.activeSceneId]?.materials['porcelain']
                ?.baseColorTexture
        ).toBe(asset.id);
        result.project.scenes['other-scene'] = structuredClone(
            result.project.scenes[result.project.activeSceneId] ?? createDefaultScene()
        );
        expect(assetReferences(result.project, asset.id)).toHaveLength(2);
        expect(() => removeProjectAsset(result.project, asset.id)).toThrow('other-scene');
    });

    it('protects assets referenced only by a prefab merge baseline', async () => {
        const project = createProject(createDefaultScene());
        const old = await importAsset(model('Old', 'old'));
        const replacement = await importAsset(model('New', 'new'));
        project.assets[old.id] = old;
        project.assets[replacement.id] = replacement;
        const used = useProjectAsset(project, old.id, null);
        const scene = used.project.scenes[used.project.activeSceneId];
        if (!scene) throw new Error('Missing scene');
        const prefab = createPrefab(scene, used.nodeId, 'chair-prefab', 'Chair');
        used.project.prefabs[prefab.id] = prefab;
        const update = instantiatePrefab(
            scene,
            prefab,
            used.project.activeSceneId,
            'chair-instance'
        );
        used.project.instances[update.instance.id] = update.instance;
        used.project.scenes[used.project.activeSceneId] = update.scene;
        for (const node of Object.values(update.scene.nodes))
            if (node.asset === old.id) node.asset = replacement.id;
        for (const node of Object.values(prefab.nodes))
            if (node.asset === old.id) node.asset = replacement.id;
        const checked = validateProject(used.project);
        expect(assetReferences(checked, old.id)).toEqual([
            { owner: 'instance chair-instance baseline', objectId: used.nodeId, property: 'asset' }
        ]);
        expect(() => removeProjectAsset(checked, old.id)).toThrow('baseline');
    });

    it('imports complete batches atomically, deduplicates files and provides working model cards', async () => {
        let project = createProject(createDefaultScene());
        let selected: string | null = null;
        const notices: string[] = [];
        const selections: string[] = [];
        const host = document.createElement('div');
        document.body.append(host);
        const panel = new AssetPanel({
            getProject: () => project,
            getSelected: () => selected,
            onCommit: next => {
                project = next;
            },
            onSelect: id => {
                selected = id;
                if (id) selections.push(id);
            },
            onNotify: message => {
                notices.push(message);
            }
        });
        try {
            panel.render(host);
            await expect(
                panel.importFiles([model(), new File(['bad'], 'broken.glb')])
            ).rejects.toThrow('truncated');
            expect(Object.keys(project.assets)).toHaveLength(0);
            await panel.importFiles([model(), model()]);
            expect(Object.keys(project.assets)).toHaveLength(1);
            const card = host.querySelector<HTMLButtonElement>('[data-asset-action="use"]');
            if (!card) throw new Error('Asset card missing');
            card.click();
            expect(selected).not.toBeNull();
            const selectedId = selections[0];
            if (!selectedId) throw new Error('Model was not selected');
            expect(project.scenes[project.activeSceneId]?.nodes[selectedId]?.type).toBe('model');
            const asset = Object.values(project.assets)[0];
            if (!asset) throw new Error('Missing asset');
            const name = host.querySelector<HTMLInputElement>('[data-asset-name]');
            if (!name) throw new Error('Rename input missing');
            name.value = 'Lounge chair';
            name.dispatchEvent(new Event('change', { bubbles: true }));
            expect(project.assets[asset.id]?.name).toBe('Lounge chair');
            host.querySelector<HTMLButtonElement>('[data-asset-action="remove"]')?.click();
            expect(Object.keys(project.assets)).toHaveLength(1);
            expect(notices.some(message => message.includes('used by'))).toBe(true);
            panel.render(host, 'does-not-match');
            expect(host.textContent).toContain('No matching assets');
        } finally {
            panel.destroy();
            host.remove();
        }
    });

    it('cancels an import when its project changes and does not overwrite another asset tab', async () => {
        let project = createProject(createDefaultScene());
        const host = document.createElement('div');
        document.body.append(host);
        const panel = new AssetPanel({
            getProject: () => project,
            getSelected: () => null,
            onCommit: next => {
                project = next;
            },
            onSelect: () => undefined,
            onNotify: () => undefined
        });
        try {
            panel.render(host);
            const pending = panel.importFiles([model()]);
            project = createProject(createDefaultScene(), 'Other Project');
            host.innerHTML = '<strong>Primitives tab</strong>';
            await expect(pending).rejects.toThrow('Project changed');
            expect(project.assets).toEqual({});
            expect(host.textContent).toBe('Primitives tab');
        } finally {
            panel.destroy();
            host.remove();
        }
    });
});
