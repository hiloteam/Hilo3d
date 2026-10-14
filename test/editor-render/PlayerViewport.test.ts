import { afterEach, describe, expect, it, vi } from 'vitest';
import * as H from '../../src/Hilo3d';
import { importAsset } from '../../editor/assets';
import { createDefaultScene, type SceneDocument, type SceneNode } from '../../editor/scene';
import { EditorViewport } from '../../editor/viewport';

const views: EditorViewport[] = [];
const containers: HTMLElement[] = [];
afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
    for (const container of containers.splice(0)) container.remove();
});
function node(type: SceneNode['type'], z = 0): SceneNode {
    return {
        name: type,
        type,
        parent: null,
        visible: true,
        transform: {
            position: { x: 0, y: 0, z },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        }
    };
}
function fixtureScene(): SceneDocument {
    const scene = createDefaultScene();
    scene.environment = { background: '#000000', ambientIntensity: 1 };
    scene.nodes = {
        camera: { ...node('camera', 4), camera: { fov: 42, near: 0.05, far: 100 } },
        cube: { ...node('mesh'), geometry: 'cube', material: 'red' }
    };
    scene.materials = { red: { name: 'Red', color: '#ff3311', metallic: 0, roughness: 1 } };
    return scene;
}
async function create(
    backend: 'webgl2' | 'webgpu'
): Promise<{ view: EditorViewport; errors: string[]; container: HTMLElement }> {
    const container = document.createElement('div');
    container.style.cssText = 'width:64px;height:64px;position:relative';
    document.body.append(container);
    containers.push(container);
    const errors: string[] = [];
    const view = await EditorViewport.create(
        container,
        vi.fn(),
        value => {
            errors.push(value);
        },
        undefined,
        {
            mode: 'player',
            backend,
            autoStart: false,
            managePageLifecycle: false
        }
    );
    views.push(view);
    return { view, errors, container };
}

/** A compact animated GLB with an asymmetric translating triangle and no network references. */
function animatedModel(): File {
    const values = new Float32Array([
        -0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0, 0, 1, 0, 0, 0, 1, 0, 0
    ]);
    const json = {
        asset: { version: '2.0' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ name: 'Animated triangle', mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
        buffers: [{ byteLength: values.byteLength }],
        bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: 36 },
            { buffer: 0, byteOffset: 36, byteLength: 8 },
            { buffer: 0, byteOffset: 44, byteLength: 24 }
        ],
        accessors: [
            {
                bufferView: 0,
                componentType: 5126,
                count: 3,
                type: 'VEC3',
                min: [-0.5, -0.5, 0],
                max: [0.5, 0.5, 0]
            },
            { bufferView: 1, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
            { bufferView: 2, componentType: 5126, count: 2, type: 'VEC3' }
        ],
        animations: [
            {
                name: 'Travel',
                samplers: [{ input: 1, output: 2, interpolation: 'LINEAR' }],
                channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }]
            }
        ]
    };
    const encoded = new TextEncoder().encode(JSON.stringify(json));
    const jsonSize = Math.ceil(encoded.length / 4) * 4;
    const bytes = new Uint8Array(28 + jsonSize + values.byteLength);
    const header = new DataView(bytes.buffer);
    header.setUint32(0, 0x46546c67, true);
    header.setUint32(4, 2, true);
    header.setUint32(8, bytes.length, true);
    header.setUint32(12, jsonSize, true);
    header.setUint32(16, 0x4e4f534a, true);
    bytes.fill(32, 20, 20 + jsonSize);
    bytes.set(encoded, 20);
    header.setUint32(20 + jsonSize, values.byteLength, true);
    header.setUint32(24 + jsonSize, 0x004e4942, true);
    bytes.set(new Uint8Array(values.buffer), 28 + jsonSize);
    return new File([bytes], 'Travel.glb');
}

describe('standalone Player uses the shared viewport', () => {
    for (const backend of ['webgl2', 'webgpu'] as const) {
        it(`renders authored camera motion without editor helpers through ${backend}`, async () => {
            const { view, errors, container } = await create(backend);
            const scene = fixtureScene();
            view.setScene(scene);
            await view.waitForAssets();
            view.setCamera('camera');
            const camera = view.getRuntimeNode('camera');
            expect(view.runtimeCamera).toBe(camera);
            expect(container.querySelector('.transform-gizmo')).toBeNull();
            expect(view.runtimeStage.children.some(child => child.name === 'Editor helpers')).toBe(
                false
            );
            expect(view.runtimeRoot.children).toHaveLength(2);
            const target = view.runtimeStage.renderer.createRenderTarget({ width: 64, height: 64 });
            try {
                view.runtimeStage.renderer.setRenderTarget(target);
                view.runtimeStage.tick(0);
                const visible = await target.readColorAttachment();
                const transform = structuredClone(scene.nodes['camera']?.transform);
                if (!transform) throw new Error('Missing camera');
                transform.position.x = 8;
                view.applyTransforms({ camera: transform });
                view.runtimeStage.tick(0);
                const hidden = await target.readColorAttachment();
                const changed = visible.data.reduce(
                    (sum, value, index) =>
                        sum + (Math.abs(value - (hidden.data[index] ?? 0)) > 10 ? 1 : 0),
                    0
                );
                expect(changed).toBeGreaterThan(100);
                expect(view.runtimeCamera).toBe(camera);
                expect(camera?.x).toBe(8);
                expect(scene.nodes['camera']?.transform.position.x).toBe(0);
                expect(errors).toEqual([]);
            } finally {
                view.runtimeStage.renderer.setRenderTarget(null);
                target.destroy();
            }
        });
    }

    it('keeps GLB clips on the explicit playback clock and restores their reference pose', async () => {
        const { view, errors } = await create('webgl2');
        const asset = await importAsset(animatedModel());
        const scene = fixtureScene();
        scene.nodes['model'] = { ...node('model'), asset: asset.id };
        delete scene.nodes['cube'];
        await view.setAssets({ [asset.id]: asset });
        view.setScene(scene);
        await view.waitForAssets();
        const wrapper = view.getRuntimeNode('model');
        let animated: H.Node | undefined;
        wrapper?.traverse(value => {
            if (value.name === 'Animated triangle') animated = value;
        });
        expect(animated).toBeDefined();
        view.startModelAnimations();
        view.stepModelAnimations(0.5);
        expect(animated?.x).toBeCloseTo(0.5);
        H.Animation.tick(1000);
        expect(animated?.x).toBeCloseTo(0.5);
        view.stopModelAnimations();
        expect(animated?.x).toBe(0);
        view.startModelAnimations();
        view.stepModelAnimations(0.25);
        expect(animated?.x).toBeCloseTo(0.25);
        view.stopModelAnimations();
        expect(errors).toEqual([]);
    });

    it('does not restart explicitly stopped rendering on visibility or caller-owned page transitions', async () => {
        const { view } = await create('webgl2');
        view.setScene(fixtureScene());
        view.setCamera('camera');
        const ticks = vi.spyOn(view.runtimeStage, 'tick');
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        await new Promise<void>(resolve => {
            requestAnimationFrame(() => {
                resolve();
            });
        });
        expect(ticks).not.toHaveBeenCalled();
        view.startRendering();
        await expect.poll(() => ticks.mock.calls.length).toBeGreaterThan(0);
        view.stopRendering();
        await view.runtimeStage.renderer.waitForIdle();
        const count = ticks.mock.calls.length;
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        await new Promise<void>(resolve => {
            requestAnimationFrame(() => {
                resolve();
            });
        });
        expect(ticks).toHaveBeenCalledTimes(count);
        expect(view.runtimeRoot.parent).toBe(view.runtimeStage);
        view.destroy();
        await expect(view.waitForAssets()).rejects.toThrow('destroyed');
    });
});
