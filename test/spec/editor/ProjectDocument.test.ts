import { describe, expect, it } from 'vitest';
import { importAsset, MAX_ASSET_BYTES } from '../../../editor/assets';
import { createClip } from '../../../editor/animation';
import {
    createProject,
    parseProject,
    serializeProject,
    validateProject
} from '../../../editor/project';
import { createDefaultScene } from '../../../editor/scene';

function model(): File {
    const text = new TextEncoder().encode('{"asset":{"version":"2.0"}}');
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
    return new File([bytes], 'sculpture.glb');
}

describe('editor project documents', () => {
    it('enforces one aggregate keyframe budget across individually valid clips', () => {
        const project = createProject(createDefaultScene());
        for (const id of ['first', 'second']) {
            const clip = createClip(id, project.activeSceneId);
            clip.duration = 1000;
            clip.tracks = [
                {
                    id: 'motion',
                    nodeId: 'hero-sphere',
                    property: 'position.x',
                    keys: Array.from({ length: 50_000 }, (_, index) => ({
                        time: index / 100,
                        value: index / 100,
                        interpolation: 'linear' as const
                    }))
                }
            ];
            project.clips[id] = clip;
        }
        expect(Object.keys(validateProject(project).clips)).toHaveLength(2);
        const overflow = createClip('overflow', project.activeSceneId);
        overflow.tracks = [
            {
                id: 'motion',
                nodeId: 'hero-sphere',
                property: 'position.x',
                keys: [{ time: 0, value: 0, interpolation: 'linear' }]
            }
        ];
        project.clips[overflow.id] = overflow;
        expect(() => validateProject(project)).toThrow('Project animation key budget');
    });

    it('rejects oversized canonical documents during validation before committing or exporting', async () => {
        // Four records share one valid 16 MiB binary source in memory, but canonical portable JSON
        // must budget every emitted base64 payload. The scene metadata then crosses the 96 MiB cap.
        const json = new TextEncoder().encode('{"asset":{"version":"2.0"}}');
        const jsonLength = Math.ceil(json.length / 4) * 4;
        const bytes = new Uint8Array(MAX_ASSET_BYTES);
        const view = new DataView(bytes.buffer);
        view.setUint32(0, 0x46546c67, true);
        view.setUint32(4, 2, true);
        view.setUint32(8, bytes.length, true);
        view.setUint32(12, jsonLength, true);
        view.setUint32(16, 0x4e4f534a, true);
        bytes.fill(32, 20, 20 + jsonLength);
        bytes.set(json, 20);
        view.setUint32(20 + jsonLength, bytes.length - 28 - jsonLength, true);
        view.setUint32(24 + jsonLength, 0x004e4942, true);
        const binary = await importAsset(new File([bytes], 'Bulk.glb'));
        const project = createProject(createDefaultScene());
        for (let index = 0; index < 4; index += 1) {
            const id = `bulk-${String(index)}-${binary.hash.slice(0, 12)}`;
            project.assets[id] = { ...binary, id };
        }
        const scene = createDefaultScene();
        scene.materials = {};
        const group = scene.nodes['sculpture'];
        if (!group) throw new Error('Missing group');
        scene.nodes = Object.fromEntries(
            Array.from({ length: 1000 }, (_, index) => [
                `node-${String(index)}`,
                { ...structuredClone(group), name: '陶'.repeat(120) }
            ])
        );
        project.scenes = Object.fromEntries(
            Array.from({ length: 32 }, (_, index) => [`scene-${String(index)}`, scene])
        );
        project.activeSceneId = 'scene-0';
        expect(() => validateProject(project)).toThrow('Canonical project document exceeds 96 MiB');
    });

    it('migrates a standalone scene without sharing mutable state and round trips canonically', () => {
        const scene = createDefaultScene();
        const project = createProject(scene, 'My Project');
        expect(project.revision).toBe(0);
        expect(project.scenes[project.activeSceneId]).toEqual(scene);
        scene.name = 'Changed externally';
        expect(project.scenes[project.activeSceneId]?.name).not.toBe(scene.name);
        project.scenes['another-scene'] = createDefaultScene();
        const source = serializeProject(project);
        expect(parseProject(source)).toEqual(validateProject(project));
        expect(serializeProject(parseProject(source))).toBe(source);
        expect(Object.keys(parseProject(source).scenes)).toEqual(['another-scene', 'scene-main']);
    });

    it('bundles model bytes and verifies typed asset references without external files', async () => {
        const project = createProject(createDefaultScene());
        const asset = await importAsset(model());
        project.assets[asset.id] = asset;
        const scene = project.scenes[project.activeSceneId];
        if (!scene) throw new Error('Missing scene');
        const group = scene.nodes['sculpture'];
        if (!group) throw new Error('Missing group');
        scene.nodes['imported-model'] = {
            ...structuredClone(group),
            type: 'model',
            asset: asset.id
        };
        const restored = parseProject(serializeProject(project));
        expect(restored.assets[asset.id]).toEqual(asset);
        Reflect.deleteProperty(project.assets, asset.id);
        expect(() => serializeProject(project)).toThrow('missing model asset');
        project.assets[asset.id] = asset;
        const material = scene.materials['terracotta'];
        if (!material) throw new Error('Missing material');
        material.baseColorTexture = asset.id;
        expect(() => serializeProject(project)).toThrow('missing texture asset');
    });

    it('rejects corrupt bundle payloads and ID mismatches before returning a project', async () => {
        const project = createProject(createDefaultScene());
        const asset = await importAsset(model());
        project.assets[asset.id] = asset;
        asset.data = `AAAA${asset.data.slice(4)}`;
        expect(() => parseProject(JSON.stringify(project))).toThrow('checksum');
        project.assets = { different: await importAsset(model()) };
        expect(() => serializeProject(project)).toThrow('record key');
    });

    it('rejects unsupported schemas, reserved keys, impossible metadata and missing scenes', () => {
        const project = createProject(createDefaultScene());
        expect(() => parseProject('{')).toThrow('invalid JSON');
        expect(() => validateProject({ ...project, version: 2 })).toThrow('version');
        expect(() => validateProject({ ...project, runtime: {} })).toThrow('unknown field');
        expect(() => validateProject({ ...project, revision: -1 })).toThrow('revision');
        expect(() =>
            validateProject({ ...project, updatedAt: '2000-01-01T00:00:00.000Z' })
        ).toThrow('precedes');
        expect(() => validateProject({ ...project, activeSceneId: 'missing' })).toThrow(
            'missing scene'
        );
        expect(() => validateProject({ ...project, scenes: {} })).toThrow('1 to 32');
        expect(() =>
            validateProject({ ...project, scenes: { constructor: createDefaultScene() } })
        ).toThrow('kebab-case');
        expect(() =>
            validateProject({
                ...project,
                scenes: Object.fromEntries(
                    Array.from({ length: 33 }, (_, index) => [
                        `scene-${String(index)}`,
                        createDefaultScene()
                    ])
                )
            })
        ).toThrow('1 to 32');
    });
});
