import { afterEach, describe, expect, it } from 'vitest';
import { createClip } from '../../../editor/animation';
import { assetReferences, removeProjectAsset, useProjectAsset } from '../../../editor/asset-panel';
import {
    assetBytes,
    assetDecodedImageBytes,
    importAsset,
    validateWAV
} from '../../../editor/assets';
import { ComponentPanel } from '../../../editor/component-panel';
import {
    defaultAudioComponent,
    defaultParticleComponent,
    defaultPhysicsComponent,
    validateNodeComponents
} from '../../../editor/components';
import { createPrefab, instantiatePrefab, updatePrefabInstance } from '../../../editor/prefabs';
import {
    createProject,
    parseProject,
    serializeProject,
    validateProject,
    type ProjectDocument
} from '../../../editor/project';
import { exportProjectArchive, importProjectArchive } from '../../../editor/project-archive';
import { ProjectHistory } from '../../../editor/project-history';
import {
    cloneScene,
    createDefaultScene,
    parseScene,
    serializeScene,
    type SceneDocument,
    type SceneNode
} from '../../../editor/scene';

function wav(bits = 16, channels = 1): Uint8Array<ArrayBuffer> {
    const frames = 64;
    const align = (channels * bits) / 8;
    const bytes = new Uint8Array(44 + frames * align);
    const view = new DataView(bytes.buffer);
    const text = (offset: number, value: string): void => {
        bytes.set(new TextEncoder().encode(value), offset);
    };
    text(0, 'RIFF');
    view.setUint32(4, bytes.length - 8, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, 8000, true);
    view.setUint32(28, 8000 * align, true);
    view.setUint16(32, align, true);
    view.setUint16(34, bits, true);
    text(36, 'data');
    view.setUint32(40, frames * align, true);
    for (let index = 44; index < bytes.length; index += 1) bytes[index] = (index * 31) % 256;
    return bytes;
}
function selected(project: ProjectDocument): SceneNode {
    const node = project.scenes[project.activeSceneId]?.nodes['hero-sphere'];
    if (!node) throw new Error('Fixture node missing');
    return node;
}
function sceneNode(scene: Pick<SceneDocument, 'nodes'>, id = 'hero-sphere'): SceneNode {
    const node = scene.nodes[id];
    if (!node) throw new Error('Fixture node missing');
    return node;
}
const panels: ComponentPanel[] = [];
const hosts: HTMLElement[] = [];
afterEach(() => {
    for (const panel of panels.splice(0)) panel.destroy();
    for (const host of hosts.splice(0)) host.remove();
});

describe('Studio runtime component documents', () => {
    it('migrates legacy scene/project documents, requiring v3 for component records', () => {
        const source = createDefaultScene();
        for (const version of [1, 2]) {
            const legacy = { ...source, version };
            expect(parseScene(JSON.stringify(legacy)).version).toBe(3);
            const project = createProject(source);
            expect(
                validateProject({ ...project, scenes: { [project.activeSceneId]: legacy } }).scenes[
                    project.activeSceneId
                ]?.version
            ).toBe(3);
            sceneNode(legacy).components = { particles: defaultParticleComponent() };
            expect(() => parseScene(JSON.stringify(legacy))).toThrow();
            Reflect.deleteProperty(sceneNode(legacy), 'components');
        }
    });

    it('round trips detached physics and particle records in deterministic order', () => {
        const scene = createDefaultScene();
        sceneNode(scene).components = {
            particles: { ...defaultParticleComponent(), color: '#FFCCAA' },
            physics: defaultPhysicsComponent()
        };
        const copied = cloneScene(scene);
        expect(sceneNode(copied).components?.particles?.color).toBe('#ffccaa');
        expect(Object.keys(sceneNode(copied).components ?? {})).toEqual(['physics', 'particles']);
        expect(serializeScene(parseScene(serializeScene(copied)))).toBe(serializeScene(copied));
        const particle = sceneNode(copied).components?.particles;
        if (!particle) throw new Error('Missing particle');
        particle.gravity.x = 99;
        expect(sceneNode(scene).components?.particles?.gravity.x).toBe(0);
        expect(() =>
            validateNodeComponents({ physics: { ...defaultPhysicsComponent(), mass: 0 } })
        ).toThrow('mass');
        expect(() =>
            validateNodeComponents({
                particles: { ...defaultParticleComponent(), maxParticles: 4097 }
            })
        ).toThrow('maxParticles');
        expect(() =>
            validateNodeComponents({ particles: { ...defaultParticleComponent(), seed: 1.5 } })
        ).toThrow('seed');
        expect(() =>
            validateNodeComponents({
                particles: {
                    ...defaultParticleComponent(),
                    shape: 'sphere',
                    extent: { x: 1, y: 2, z: 1 }
                }
            })
        ).toThrow('equal radii');
        expect(() =>
            validateNodeComponents({ physics: { ...defaultPhysicsComponent(), nativeBody: 1 } })
        ).toThrow('unknown field');
    });

    it('enforces aggregate emitter/audio bounds including invisible nodes', () => {
        const scene = createDefaultScene();
        scene.nodes = {};
        const template = sceneNode(createDefaultScene());
        for (let index = 0; index < 9; index += 1)
            scene.nodes[`emitter-${String(index)}`] = {
                ...structuredClone(template),
                parent: null,
                visible: false,
                components: { particles: { ...defaultParticleComponent(), maxParticles: 4096 } }
            };
        expect(() => cloneScene(scene)).toThrow('capacity');
        scene.nodes = {};
        for (let index = 0; index < 33; index += 1)
            scene.nodes[`audio-${String(index)}`] = {
                ...structuredClone(template),
                parent: null,
                visible: false,
                components: { audio: defaultAudioComponent('sound-aaaaaaaaaaaa') }
            };
        expect(() => cloneScene(scene)).toThrow('audio source count');
    });

    it('rejects unsupported collider scale and dynamic animation while accepting kinematic motion', () => {
        const scene = createDefaultScene();
        const node = sceneNode(scene);
        node.components = { physics: { ...defaultPhysicsComponent(), shape: 'sphere' } };
        node.transform.scale.x = 2;
        expect(() => cloneScene(scene)).toThrow('uniform scale');
        node.transform.scale = { x: 1, y: 1, z: 1 };
        const parent = sceneNode(scene, 'sculpture');
        parent.transform.scale.y = 2;
        expect(() => cloneScene(scene)).toThrow('unit scale');
        parent.transform.scale.y = 1;
        const project = createProject(scene);
        const clip = createClip('move', project.activeSceneId);
        clip.tracks = [
            {
                id: 'up',
                nodeId: 'hero-sphere',
                property: 'position.y',
                keys: [{ time: 0, value: 1, interpolation: 'linear' }]
            }
        ];
        project.clips[clip.id] = clip;
        expect(() => validateProject(project)).toThrow('conflicts');
        const physics = selected(project).components?.physics;
        if (!physics) throw new Error('Missing physics');
        physics.body = 'kinematic';
        expect(validateProject(project).clips[clip.id]).toEqual(clip);
        const track = clip.tracks[0];
        if (!track) throw new Error('Missing track');
        track.property = 'scale.x';
        expect(() => validateProject(project)).toThrow('collider scale is fixed');
    });

    it('validates integer PCM WAV structure, metadata and exact immutable source bytes', async () => {
        for (const bits of [8, 16, 24, 32])
            for (const channels of [1, 2])
                expect(validateWAV(wav(bits, channels))).toEqual({
                    channels,
                    sampleRate: 8000,
                    frames: 64
                });
        const bytes = wav();
        const asset = await importAsset(new File([bytes], 'Door chime.wav'));
        expect(asset.kind).toBe('audio');
        expect(asset.mimeType).toBe('audio/wav');
        expect(assetBytes(asset)).toEqual(bytes);
        expect(assetDecodedImageBytes(asset)).toBe(0);
        assetBytes(asset).fill(0);
        expect(assetBytes(asset)).toEqual(bytes);
        for (const [offset, value] of [
            [4, 4],
            [16, 3],
            [20, 3],
            [22, 7],
            [28, 1],
            [32, 1],
            [40, 3]
        ] as const) {
            const malformed = bytes.slice();
            new DataView(malformed.buffer).setUint32(offset, value, true);
            expect(() => validateWAV(malformed)).toThrow();
        }
        await expect(importAsset(new File([bytes.slice(0, -1)], 'truncated.wav'))).rejects.toThrow(
            'length'
        );
        await expect(importAsset(new File([bytes], 'renamed.mp3'))).rejects.toThrow('PCM WAV');
    });

    it('preserves audio references in projects, archives, prefabs, instance baselines and removal checks', async () => {
        let project = createProject(createDefaultScene());
        const asset = await importAsset(new File([wav()], 'chime.wav'));
        project.assets[asset.id] = asset;
        project = useProjectAsset(project, asset.id, 'hero-sphere').project;
        const scene = project.scenes[project.activeSceneId];
        if (!scene) throw new Error('Missing scene');
        const prefab = createPrefab(scene, 'hero-sphere', 'sound-object', 'Sound Object');
        project.prefabs[prefab.id] = prefab;
        const instance = instantiatePrefab(scene, prefab, project.activeSceneId, 'sound-instance');
        project.scenes[project.activeSceneId] = instance.scene;
        project.instances[instance.instance.id] = instance.instance;
        project = validateProject(project);
        expect(assetReferences(project, asset.id)).toHaveLength(4);
        expect(() => removeProjectAsset(project, asset.id)).toThrow('used by');
        const source = serializeProject(project);
        expect(serializeProject(parseProject(source))).toBe(source);
        expect(
            serializeProject(await importProjectArchive(await exportProjectArchive(project)))
        ).toBe(source);
        const nextPrefab = structuredClone(prefab);
        const audio = nextPrefab.nodes['hero-sphere']?.components?.audio;
        if (!audio) throw new Error('Missing prefab audio');
        audio.volume = 0.2;
        const update = updatePrefabInstance(instance.scene, nextPrefab, instance.instance);
        expect(update.scene.nodes[instance.instance.rootId]?.components?.audio?.volume).toBe(0.2);
        Reflect.deleteProperty(project.assets, asset.id);
        expect(() => validateProject(project)).toThrow('audio asset');
    });
});

describe('Studio component inspector', () => {
    it('authors and removes all components through controls, records history and rejects invalid edits transactionally', async () => {
        let project = createProject(createDefaultScene());
        const asset = await importAsset(new File([wav()], 'sound.wav'));
        project.assets[asset.id] = asset;
        const history = new ProjectHistory(project);
        const messages: string[] = [];
        let canEdit = true;
        const host = document.createElement('section');
        document.body.append(host);
        hosts.push(host);
        const panel = new ComponentPanel({
            getProject: () => project,
            getSelectedNode: () => 'hero-sphere',
            canEdit: () => canEdit,
            onCommit: next => {
                project = next;
                history.commitProject(next);
            },
            onNotify: message => {
                messages.push(message);
            }
        });
        panels.push(panel);
        panel.render(host);
        const click = (selector: string): void => {
            const button = host.querySelector<HTMLButtonElement>(selector);
            if (!button) throw new Error(`Missing ${selector}`);
            button.click();
        };
        const change = (name: string, value: string): void => {
            const input = host.querySelector<HTMLInputElement | HTMLSelectElement>(
                `[data-component-field="${name}"]`
            );
            if (!input) throw new Error(`Missing ${name}`);
            input.value = value;
            input.dispatchEvent(new Event('change', { bubbles: true }));
        };
        click('[data-component-add="physics"]');
        change('physics.mass', '3');
        expect(selected(project).components?.physics?.mass).toBe(3);
        change('physics.mass', '-1');
        expect(selected(project).components?.physics?.mass).toBe(3);
        expect(messages.at(-1)).toContain('mass');
        click('[data-component-add="particles"]');
        change('particles.shape', 'sphere');
        change('particles.extent.x', '2');
        change('particles.rate', '44');
        expect(selected(project).components?.particles?.extent).toEqual({ x: 2, y: 2, z: 2 });
        expect(selected(project).components?.particles?.rate).toBe(44);
        click('[data-component-add="audio"]');
        change('audio.volume', '0.4');
        expect(selected(project).components?.audio?.asset).toBe(asset.id);
        expect(selected(project).components?.audio?.volume).toBe(0.4);
        click('[data-component-remove="physics"]');
        expect(selected(project).components?.physics).toBeUndefined();
        history.undo();
        project = history.project;
        panel.render(host);
        expect(selected(project).components?.physics?.mass).toBe(3);
        canEdit = false;
        panel.render(host);
        expect(host.querySelector('fieldset')?.disabled).toBe(true);
        change('physics.mass', '9');
        expect(selected(project).components?.physics?.mass).toBe(3);
        expect(messages.at(-1)).toContain('cannot be edited');
    });
});
