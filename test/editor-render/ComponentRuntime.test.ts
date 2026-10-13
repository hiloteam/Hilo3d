import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { ParticleSystem } from '@hilo/addon-particle';
import * as H from '../../src/Hilo3d';
import { ComponentAudioSession, ComponentRuntime } from '../../editor/component-runtime';
import {
    defaultAudioComponent,
    defaultParticleComponent,
    defaultPhysicsComponent
} from '../../editor/components';
import { importAsset } from '../../editor/assets';
import { createProject, type ProjectDocument } from '../../editor/project';
import { createDefaultScene, type SceneDocument, type SceneNode } from '../../editor/scene';

const stages: H.Stage[] = [];
const runtimes: ComponentRuntime[] = [];
const sessions: ComponentAudioSession[] = [];
afterEach(async () => {
    for (const runtime of runtimes.splice(0)) await runtime.stop();
    for (const session of sessions.splice(0)) await session.stop();
    for (const stage of stages.splice(0)) {
        stage.destroy();
        stage.canvas.remove();
    }
});

function node(y = 0): SceneNode {
    return {
        name: 'Component fixture',
        type: 'group',
        parent: null,
        visible: true,
        transform: {
            position: { x: 0, y, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        }
    };
}
function sceneWith(nodes: Record<string, SceneNode>): SceneDocument {
    const scene = createDefaultScene();
    scene.nodes = nodes;
    return scene;
}
async function setup(
    scene: SceneDocument,
    backend: 'webgl2' | 'webgpu' = 'webgl2'
): Promise<{
    stage: H.Stage;
    project: ProjectDocument;
    nodes: Map<string, H.Node>;
}> {
    const camera = new H.PerspectiveCamera({ x: 0, y: 1, z: 8, aspect: 1 });
    camera.lookAt(new H.Vector3(0, 1, 0));
    const stage = await H.Stage.create({
        backend,
        camera,
        width: 64,
        height: 64,
        pixelRatio: 1,
        clearColor: new H.Color(0, 0, 0, 1)
    });
    stages.push(stage);
    const nodes = new Map<string, H.Node>();
    for (const [id, source] of Object.entries(scene.nodes)) {
        const value = new H.Node();
        value.setPosition(
            source.transform.position.x,
            source.transform.position.y,
            source.transform.position.z
        );
        value.setRotation(
            source.transform.rotation.x,
            source.transform.rotation.y,
            source.transform.rotation.z
        );
        value.setScale(
            source.transform.scale.x,
            source.transform.scale.y,
            source.transform.scale.z
        );
        nodes.set(id, value);
    }
    for (const [id, source] of Object.entries(scene.nodes)) {
        const value = nodes.get(id);
        if (!value) throw new Error('Fixture node missing.');
        value.addTo(source.parent ? (nodes.get(source.parent) ?? stage) : stage);
    }
    const project = createProject(createDefaultScene());
    project.scenes[project.activeSceneId] = scene;
    return { stage, project, nodes };
}
async function create(
    scene: SceneDocument,
    setupValue: Awaited<ReturnType<typeof setup>>,
    audio?: ComponentAudioSession,
    signal?: AbortSignal,
    startPaused = false
): Promise<ComponentRuntime> {
    const runtime = await ComponentRuntime.create({
        scene,
        startPaused,
        project: setupValue.project,
        renderer: setupValue.stage.renderer,
        resolveNode: id => setupValue.nodes.get(id),
        listener: () => setupValue.stage.camera ?? setupValue.stage,
        ...(audio ? { audio } : {}),
        ...(signal ? { signal } : {})
    });
    runtimes.push(runtime);
    return runtime;
}
function advance(runtime: ComponentRuntime, scene: SceneDocument, frames: number): void {
    for (let index = 0; index < frames; index++) {
        const transforms = runtime.step(1 / 60, (index + 1) / 60, scene);
        for (const [id, transform] of Object.entries(transforms)) {
            const source = scene.nodes[id];
            if (source) source.transform = transform;
        }
    }
}
function wav(samples = 8000): File {
    const sampleRate = 8000;
    const buffer = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(buffer);
    const tag = (offset: number, text: string): void => {
        for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    };
    tag(0, 'RIFF');
    view.setUint32(4, buffer.byteLength - 8, true);
    tag(8, 'WAVE');
    tag(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    tag(36, 'data');
    view.setUint32(40, samples * 2, true);
    for (let index = 0; index < samples; index++)
        view.setInt16(
            44 + index * 2,
            Math.round(Math.sin((index * Math.PI * 2 * 440) / sampleRate) * 12000),
            true
        );
    return new File([buffer], 'tone.wav', { type: 'audio/wav' });
}

describe('Studio/Player real component runtime', () => {
    it('runs fixed Rapier steps, resolves contact and writes local transforms under a rotated parent', async () => {
        const parent = node();
        parent.transform.position.x = 2;
        parent.transform.rotation.y = 35;
        const ball = node(3);
        ball.parent = 'parent';
        ball.components = {
            physics: { ...defaultPhysicsComponent(), shape: 'sphere', restitution: 0 }
        };
        const ground = node(-0.5);
        ground.components = {
            physics: { ...defaultPhysicsComponent(), body: 'static', size: { x: 20, y: 1, z: 20 } }
        };
        const scene = sceneWith({ parent, ball, ground });
        const authored = structuredClone(scene);
        const setupValue = await setup(scene);
        const runtime = await create(scene, setupValue);
        advance(runtime, scene, 120);
        expect(scene.nodes['ball']?.transform.position.y).toBeCloseTo(0.5, 1);
        expect(scene.nodes['ball']?.transform.position.x).toBeCloseTo(0, 4);
        expect(runtime.getDiagnostics().physics).toMatchObject({
            bodyCount: 2,
            colliderCount: 2,
            simulatedSteps: 120
        });
        expect(authored.nodes['ball']?.transform.position.y).toBe(3);
        runtime.executeCommands([{ type: 'applyImpulse', nodeId: 'ball', x: 0, y: 5, z: 0 }]);
        advance(runtime, scene, 12);
        expect(scene.nodes['ball']?.transform.position.y).toBeGreaterThan(1);
        await runtime.stop();
        expect(runtime.getDiagnostics()).toMatchObject({
            stopped: true,
            physics: null,
            particles: [],
            audio: null
        });
    });

    it('follows kinematic input and rejects dynamic transform or collider-scale ownership conflicts', async () => {
        const dynamic = node(2);
        dynamic.transform.scale = { x: 0.3, y: 0.7, z: 0.2 };
        dynamic.components = { physics: defaultPhysicsComponent() };
        const moving = node();
        moving.components = { physics: { ...defaultPhysicsComponent(), body: 'kinematic' } };
        const scene = sceneWith({ dynamic, moving });
        const setupValue = await setup(scene);
        const runtime = await create(scene, setupValue);
        setupValue.nodes.get('moving')?.setPosition(1, 0, 0);
        moving.transform.position.x = 1;
        advance(runtime, scene, 1);
        expect(setupValue.nodes.get('moving')?.x).toBe(1);
        dynamic.transform.position.x = 2;
        expect(() => runtime.step(1 / 60, 1, scene)).toThrow(/owns its transform/);
        dynamic.transform.position.x = 0;
        setupValue.nodes.get('moving')?.setScale(2);
        expect(() => runtime.step(1 / 60, 1, scene)).toThrow(/owns its scale/);
    });

    for (const backend of ['webgl2', 'webgpu'] as const) {
        it(`renders real particle pixels through ${backend}, freezes Stage ticks and replays seeded simulation`, async () => {
            const emitter = node();
            emitter.components = {
                particles: {
                    ...defaultParticleComponent(),
                    speed: 0,
                    size: 0.8,
                    gravity: { x: 0, y: 0, z: 0 }
                }
            };
            const scene = sceneWith({ emitter });
            const setupValue = await setup(scene, backend);
            const target = setupValue.stage.renderer.createRenderTarget({ width: 64, height: 64 });
            setupValue.stage.renderer.setRenderTarget(target);
            const runtime = await create(scene, setupValue);
            setupValue.stage.tick(0);
            const before = await target.readColorAttachment();
            advance(runtime, scene, 30);
            setupValue.stage.tick(16);
            const rendered = await target.readColorAttachment();
            const particles = runtime.getDiagnostics().particles[0];
            expect(particles?.alive).toBe(15);
            const hash = particles?.hash;
            const changed = rendered.data.reduce(
                (sum, value, index) =>
                    sum + (Math.abs(value - (before.data[index] ?? 0)) > 10 ? 1 : 0),
                0
            );
            expect(changed).toBeGreaterThan(15);
            setupValue.nodes.get('emitter')?.setPosition(2, 0, 0);
            setupValue.stage.tick(0);
            const moved = await target.readColorAttachment();
            expect(
                moved.data.some(
                    (value, index) => Math.abs(value - (rendered.data[index] ?? 0)) > 10
                )
            ).toBe(true);
            setupValue.nodes.get('emitter')?.setPosition(0, 0, 0);
            runtime.pause();
            setupValue.stage.tick(1000);
            await setupValue.stage.renderer.waitForIdle();
            expect(runtime.getDiagnostics().particles[0]?.hash).toBe(hash);
            advance(runtime, scene, 1);
            expect(runtime.getDiagnostics().particles[0]?.elapsed).toBeGreaterThan(
                particles?.elapsed ?? 0
            );
            await runtime.stop();
            expect(setupValue.nodes.get('emitter')?.children).toHaveLength(0);
            const replay = await create(scene, setupValue);
            advance(replay, scene, 30);
            expect(replay.getDiagnostics().particles[0]?.hash).toBe(hash);
            replay.executeCommands([{ nodeId: 'emitter', type: 'emitParticles', count: 5 }]);
            advance(replay, scene, 1);
            expect(replay.getDiagnostics().particles[0]?.alive).toBeGreaterThan(15);
            await replay.stop();
            target.destroy();
        });
    }

    it('uses authored half extents for actual box spawns and converts sRGB particle color to linear', async () => {
        const emitter = node();
        emitter.components = {
            particles: {
                ...defaultParticleComponent(),
                shape: 'box',
                extent: { x: 2, y: 0.5, z: 1 },
                maxParticles: 2048,
                rate: 0,
                speed: 0,
                size: 0.001,
                color: '#808080',
                gravity: { x: 0, y: 0, z: 0 }
            }
        };
        const scene = sceneWith({ emitter });
        const setupValue = await setup(scene);
        const runtime = await create(scene, setupValue);
        runtime.executeCommands([{ type: 'emitParticles', nodeId: 'emitter', count: 2000 }]);
        advance(runtime, scene, 1);
        const system = setupValue.nodes.get('emitter')?.children[0];
        if (!(system instanceof ParticleSystem)) throw new Error('Particle node missing.');
        expect(system.aliveCount).toBe(2000);
        expect(system.definition.emitters[0]?.initialize.color).toEqual([
            Math.fround(0.21586050011389923),
            Math.fround(0.21586050011389923),
            Math.fround(0.21586050011389923),
            1
        ]);
        const mesh = system.children.find(child => child instanceof H.Mesh);
        if (!(mesh instanceof H.Mesh) || !mesh.geometry)
            throw new Error('Particle render mesh missing.');
        const bounds = mesh.geometry.getLocalBounds();
        expect(bounds.width).toBeGreaterThan(3.8);
        expect(bounds.width).toBeLessThanOrEqual(4.01);
        expect(bounds.height).toBeGreaterThan(0.9);
        expect(bounds.height).toBeLessThanOrEqual(1.01);
        expect(bounds.depth).toBeGreaterThan(1.9);
        expect(bounds.depth).toBeLessThanOrEqual(2.01);
    });

    it('decodes imported WAV, plays actual non-silent PCM, follows spatial transforms and pauses voices', async () => {
        const sound = node();
        const asset = await importAsset(wav());
        sound.components = { audio: { ...defaultAudioComponent(asset.id), loop: true } };
        const scene = sceneWith({ sound });
        const setupValue = await setup(scene);
        setupValue.project.assets[asset.id] = asset;
        const offline = new OfflineAudioContext(2, 8000, 8000);
        const audio = new ComponentAudioSession(offline);
        sessions.push(audio);
        const runtime = await create(scene, setupValue, audio);
        expect(runtime.getDiagnostics().audio).toMatchObject({
            activeVoices: 1,
            realVoices: 1,
            sourceNodesCreated: 1
        });
        runtime.pause();
        expect(runtime.getDiagnostics().audio?.pausedVoices).toBe(1);
        runtime.resume();
        expect(runtime.getDiagnostics().audio?.pausedVoices).toBe(0);
        setupValue.nodes.get('sound')?.setPosition(2, 1, 4);
        advance(runtime, scene, 1);
        const pcm = await offline.startRendering();
        expect(pcm.getChannelData(0).some(value => Math.abs(value) > 0.001)).toBe(true);
        expect(pcm.getChannelData(1).some(value => Math.abs(value) > 0.001)).toBe(true);
        await runtime.stop();
        expect(audio.engine.getDiagnostics()).toMatchObject({
            activeVoices: 0,
            allocatedVoiceSlots: 0
        });
    });

    it('unlocks only on a trusted gesture, keeps preparation silent and pauses after natural completion', async () => {
        const sound = node();
        const asset = await importAsset(wav(800));
        sound.components = { audio: defaultAudioComponent(asset.id) };
        const scene = sceneWith({ sound });
        const setupValue = await setup(scene);
        setupValue.project.assets[asset.id] = asset;
        const holder: { audio: ComponentAudioSession | null; unlock: Promise<void> | null } = {
            audio: null,
            unlock: null
        };
        const button = document.createElement('button');
        button.textContent = 'Start component audio test';
        document.body.append(button);
        button.addEventListener('click', () => {
            holder.audio = ComponentAudioSession.create(scene);
            if (holder.audio) {
                sessions.push(holder.audio);
                holder.unlock = holder.audio.unlock();
            }
        });
        try {
            expect(ComponentAudioSession.create(sceneWith({ empty: node() }))).toBeNull();
            await userEvent.click(button);
            await holder.unlock;
            const audio = holder.audio;
            if (!audio) throw new Error('Gesture did not create audio owner.');
            expect(audio.engine.context.state).toBe('running');
            const runtime = await create(scene, setupValue, audio, undefined, true);
            expect(runtime.getDiagnostics().audio).toMatchObject({
                pausedVoices: 1,
                sourceNodesCreated: 0,
                realVoices: 0
            });
            runtime.resume();
            expect(runtime.getDiagnostics().audio?.sourceNodesCreated).toBe(1);
            await expect
                .poll(
                    () => {
                        audio.engine.update();
                        return audio.engine.getDiagnostics().activeVoices;
                    },
                    { timeout: 2000 }
                )
                .toBe(0);
            expect(() => {
                runtime.pause();
            }).not.toThrow();
            expect(() => {
                runtime.resume();
            }).not.toThrow();
            await runtime.stop();
            expect(audio.engine.context.state).toBe('closed');
        } finally {
            button.remove();
        }
    });

    it('does not publish resources after cancellation during WAV preparation', async () => {
        const sound = node();
        const asset = await importAsset(wav());
        sound.components = { audio: defaultAudioComponent(asset.id) };
        const scene = sceneWith({ sound });
        const setupValue = await setup(scene);
        setupValue.project.assets[asset.id] = asset;
        const audio = new ComponentAudioSession(new OfflineAudioContext(2, 8000, 8000));
        sessions.push(audio);
        const controller = new AbortController();
        const pending = create(scene, setupValue, audio, controller.signal);
        controller.abort();
        await expect(pending).rejects.toThrow();
        expect(audio.engine.getDiagnostics()).toMatchObject({
            activeVoices: 0,
            allocatedVoiceSlots: 0
        });
        expect(setupValue.nodes.get('sound')?.children).toHaveLength(0);
    });
});
