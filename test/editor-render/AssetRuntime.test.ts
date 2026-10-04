import { afterEach, describe, expect, it, vi } from 'vitest';
import * as H from '../../src/Hilo3d';
import { EditorAssetRuntime } from '../../editor/asset-runtime';
import { importAsset } from '../../editor/assets';
import { createEditorGeometries, EditorViewport } from '../../editor/viewport';
import { createDefaultScene } from '../../editor/scene';

function modelFile(requiredExtension?: string): File {
    const buffers: Uint8Array[] = [];
    const views: { buffer: number; byteOffset: number; byteLength: number }[] = [];
    let byteLength = 0;
    const append = (data: Float32Array | Uint16Array): number => {
        const bytes = new Uint8Array(data.buffer);
        views.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length });
        const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4);
        padded.set(bytes);
        buffers.push(padded);
        byteLength += padded.length;
        return views.length - 1;
    };
    const positions = append(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0, 1, 0]));
    const normals = append(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]));
    const indices = append(new Uint16Array([0, 1, 2]));
    const joints = append(new Uint16Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    const weights = append(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]));
    const inverse = append(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
    const times = append(new Float32Array([0, 1]));
    const translation = append(new Float32Array([0, 0, 0, 0, 1, 0]));
    const json = {
        asset: { version: '2.0' },
        ...(requiredExtension ? { extensionsRequired: [requiredExtension] } : {}),
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [
            { name: 'Root', children: [1, 2] },
            { name: 'Joint' },
            { name: 'Triangle', mesh: 0, skin: 0 }
        ],
        meshes: [
            {
                primitives: [
                    {
                        attributes: { POSITION: 0, NORMAL: 1, JOINTS_0: 3, WEIGHTS_0: 4 },
                        indices: 2,
                        material: 0
                    }
                ]
            }
        ],
        materials: [
            {
                pbrMetallicRoughness: {
                    baseColorFactor: [0.8, 0.15, 0.06, 1],
                    metallicFactor: 0,
                    roughnessFactor: 0.7
                }
            }
        ],
        skins: [{ joints: [1], inverseBindMatrices: 5 }],
        animations: [
            {
                name: 'Rise',
                samplers: [{ input: 6, output: 7, interpolation: 'LINEAR' }],
                channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }]
            }
        ],
        buffers: [{ byteLength }],
        bufferViews: views,
        accessors: [
            {
                bufferView: positions,
                componentType: 5126,
                count: 3,
                type: 'VEC3',
                min: [-0.5, 0, 0],
                max: [0.5, 1, 0]
            },
            { bufferView: normals, componentType: 5126, count: 3, type: 'VEC3' },
            { bufferView: indices, componentType: 5123, count: 3, type: 'SCALAR' },
            { bufferView: joints, componentType: 5123, count: 3, type: 'VEC4' },
            { bufferView: weights, componentType: 5126, count: 3, type: 'VEC4' },
            { bufferView: inverse, componentType: 5126, count: 1, type: 'MAT4' },
            {
                bufferView: times,
                componentType: 5126,
                count: 2,
                type: 'SCALAR',
                min: [0],
                max: [1]
            },
            { bufferView: translation, componentType: 5126, count: 2, type: 'VEC3' }
        ]
    };
    const text = new TextEncoder().encode(JSON.stringify(json));
    const jsonLength = Math.ceil(text.length / 4) * 4;
    const output = new Uint8Array(28 + jsonLength + byteLength);
    const header = new DataView(output.buffer);
    header.setUint32(0, 0x46546c67, true);
    header.setUint32(4, 2, true);
    header.setUint32(8, output.length, true);
    header.setUint32(12, jsonLength, true);
    header.setUint32(16, 0x4e4f534a, true);
    output.fill(32, 20, 20 + jsonLength);
    output.set(text, 20);
    header.setUint32(20 + jsonLength, byteLength, true);
    header.setUint32(24 + jsonLength, 0x004e4942, true);
    let offset = 28 + jsonLength;
    for (const bytes of buffers) {
        output.set(bytes, offset);
        offset += bytes.length;
    }
    return new File([output], 'Animated Triangle.glb');
}

async function imageFile(): Promise<File> {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 2;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable.');
    context.fillStyle = '#ff2200';
    context.fillRect(0, 0, 4, 1);
    context.fillStyle = '#0044ff';
    context.fillRect(0, 1, 4, 1);
    const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(value => {
            if (value) resolve(value);
            else reject(new Error('PNG unavailable.'));
        });
    });
    return new File([blob], 'Direction.png', { type: 'image/png' });
}

const stages: H.Stage[] = [];
const runtimes: EditorAssetRuntime[] = [];
afterEach(() => {
    for (const runtime of runtimes.splice(0)) runtime.destroy();
    for (const stage of stages.splice(0)) {
        stage.destroy();
        stage.canvas.remove();
    }
});
async function setup(
    backend: 'webgl2' | 'webgpu' = 'webgl2'
): Promise<{ stage: H.Stage; runtime: EditorAssetRuntime }> {
    const camera = new H.PerspectiveCamera({ x: 0, y: 0.5, z: 3, aspect: 1 });
    camera.lookAt(new H.Vector3(0, 0.5, 0));
    const stage = await H.Stage.create({ backend, camera, width: 64, height: 64, pixelRatio: 1 });
    stages.push(stage);
    const runtime = new EditorAssetRuntime(stage.renderer);
    runtimes.push(runtime);
    return { stage, runtime };
}

describe('editor asset runtime', () => {
    for (const backend of ['webgl2', 'webgpu'] as const) {
        it(`recovers a UV-less GLB override error without stopping ${backend} or poisoning readiness`, async () => {
            const previousURL = location.href;
            const url = new URL(location.href);
            url.searchParams.set('backend', backend);
            url.searchParams.set('test', '1');
            history.replaceState(null, '', url);
            const container = document.createElement('div');
            container.style.cssText = 'width:128px;height:128px;position:relative';
            document.body.append(container);
            const errors: string[] = [];
            const viewport = await EditorViewport.create(
                container,
                () => {
                    /* Selection is not involved in this resource regression. */
                },
                value => {
                    errors.push(value);
                }
            );
            try {
                const model = await importAsset(modelFile());
                const image = await importAsset(await imageFile());
                const scene = createDefaultScene();
                // This contract covers imported-material failure/recovery. A full demo scene's
                // 2048px directional shadows are unrelated and dominate software-GPU execution.
                scene.nodes = {};
                scene.materials = {
                    override: {
                        name: 'Normal override',
                        color: '#ffffff',
                        metallic: 0,
                        roughness: 0.8,
                        normalTexture: image.id
                    }
                };
                scene.nodes['imported'] = {
                    name: 'UV-less triangle',
                    type: 'model',
                    asset: model.id,
                    material: 'override',
                    parent: null,
                    visible: true,
                    transform: {
                        position: { x: 0, y: 1, z: 1 },
                        rotation: { x: 0, y: 0, z: 0 },
                        scale: { x: 1, y: 1, z: 1 }
                    }
                };
                viewport.setScene(scene);
                await expect(
                    viewport.setAssets({ [model.id]: model, [image.id]: image })
                ).rejects.toThrow(/UV0/);
                const capture = (
                    window as Window & {
                        __HILO3D_TEST_CAPTURE__?: {
                            waitForFrames(count: number): Promise<void>;
                            pause(): Promise<void>;
                            resume(): void;
                        };
                    }
                ).__HILO3D_TEST_CAPTURE__;
                if (!capture) throw new Error('Test capture unavailable.');
                await capture.waitForFrames(2);
                await capture.pause();
                capture.resume();
                delete scene.nodes['imported'].material;
                viewport.setScene(scene);
                await viewport.waitForAssets();
                await capture.waitForFrames(2);
                await capture.pause();
                expect(errors).toHaveLength(1);
                expect(errors[0]).toMatch(/Original model materials are retained/);
            } finally {
                viewport.destroy();
                container.remove();
                history.replaceState(null, '', previousURL);
            }
        });

        it(`renders every editor primitive with all four PBR texture slots through ${backend}`, async () => {
            const { stage, runtime } = await setup(backend);
            const asset = await importAsset(await imageFile());
            runtime.setAssets({ [asset.id]: asset });
            const lease = runtime.acquireTexture(asset.id);
            await lease.ready;
            const material = new H.PBRMaterial({
                baseColorMap: { texture: lease.texture, encoding: 'srgb' },
                normalMap: { texture: lease.texture, encoding: 'data' },
                metallicRoughnessMap: { texture: lease.texture, encoding: 'data' },
                emission: { texture: lease.texture, encoding: 'srgb' },
                emissionFactor: new H.Color(0.1, 0.1, 0.1)
            });
            const meshes = Object.values(createEditorGeometries()).map((geometry, index) =>
                new H.Mesh({ geometry, material, x: (index - 1.5) * 0.7, y: 0.5 })
                    .setScale(0.5)
                    .addTo(stage)
            );
            new H.AmbientLight({ amount: 1 }).addTo(stage);
            stage.tick(16);
            await stage.renderer.waitForIdle();
            expect(material.getTextureSlot('baseColor')?.encoding).toBe('srgb');
            expect(material.getTextureSlot('normal')?.encoding).toBe('data');
            for (const mesh of meshes) mesh.destroy(stage.renderer);
            lease.release();
        });

        it(`loads independent skinned animated GLB instances and submits them through ${backend}`, async () => {
            const { stage, runtime } = await setup(backend);
            const asset = await importAsset(modelFile());
            runtime.setAssets({ [asset.id]: asset });
            const first = runtime.acquireModel(asset.id);
            const second = runtime.acquireModel(asset.id);
            const [a, b] = await Promise.all([first.ready, second.ready]);
            expect(a.root).not.toBe(b.root);
            expect(a.meshes.length).toBe(1);
            const left = a.meshes[0];
            const right = b.meshes[0];
            if (!(left instanceof H.SkinnedMesh) || !(right instanceof H.SkinnedMesh))
                throw new Error('Fixture must contain skinned meshes.');
            expect(left.geometry).toBe(right.geometry);
            expect(left.material).toBe(right.material);
            expect(left.skeleton).not.toBe(right.skeleton);
            expect(left.skeleton?.jointNodeList[0]).not.toBe(right.skeleton?.jointNodeList[0]);
            expect(a.root.anim).not.toBe(b.root.anim);
            expect(a.root.anim?.clips[0]?.name).toBe('Rise');
            a.root.setPosition(-0.6, 0, 0).addTo(stage);
            b.root.setPosition(0.6, 0, 0).addTo(stage);
            new H.AmbientLight({ amount: 1 }).addTo(stage);
            stage.tick(16);
            await stage.renderer.waitForIdle();
            a.root.anim?.play('Rise');
            a.root.anim?.pause();
            a.root.anim?.update(0.5);
            expect(left.skeleton?.jointNodeList[0]?.y).toBeCloseTo(0.5);
            expect(right.skeleton?.jointNodeList[0]?.y).toBe(0);
            first.release();
            expect(left.isDestroyed).toBe(true);
            expect(right.isDestroyed).toBe(false);
            stage.tick(16);
            await stage.renderer.waitForIdle();
            second.release();
            expect(right.isDestroyed).toBe(true);
        });
    }

    it('resumes real rendering after native WebGL2 context recovery without an authoring edit', async () => {
        const previousURL = location.href;
        const url = new URL(location.href);
        url.searchParams.set('backend', 'webgl2');
        url.searchParams.delete('test');
        history.replaceState(null, '', url);
        const container = document.createElement('div');
        container.style.cssText = 'width:128px;height:128px;position:relative';
        document.body.append(container);
        const errors: string[] = [];
        const draws = vi.spyOn(WebGL2RenderingContext.prototype, 'drawElementsInstanced');
        const viewport = await EditorViewport.create(
            container,
            () => {
                /* Selection is not involved. */
            },
            value => {
                errors.push(value);
            }
        );
        try {
            viewport.setScene(createDefaultScene());
            await vi.waitFor(() => {
                expect(draws.mock.calls.length).toBeGreaterThan(0);
            });
            const canvas = container.querySelector('canvas');
            const native = canvas?.getContext('webgl2');
            const extension = native?.getExtension('WEBGL_lose_context');
            if (!canvas || !native || !extension)
                throw new Error('Native context-loss extension unavailable.');
            const lost = new Promise<Event>(resolve => {
                canvas.addEventListener('webglcontextlost', resolve, { once: true });
            });
            extension.loseContext();
            expect((await lost).defaultPrevented).toBe(true);
            const before = draws.mock.calls.length;
            await new Promise<void>(resolve => {
                setTimeout(resolve, 0);
            });
            extension.restoreContext();
            await vi.waitFor(
                () => {
                    expect(native.isContextLost()).toBe(false);
                    expect(draws.mock.calls.length).toBeGreaterThan(before + 2);
                },
                { timeout: 5000 }
            );
            expect(errors).toEqual([]);
        } finally {
            viewport.destroy();
            draws.mockRestore();
            container.remove();
            history.replaceState(null, '', previousURL);
        }
    });

    it('preserves asset name, unsupported extension reason and cause across the loader boundary', async () => {
        const { runtime } = await setup();
        const asset = await importAsset(modelFile('KHR_draco_mesh_compression'));
        runtime.setAssets({ [asset.id]: asset });
        const lease = runtime.acquireModel(asset.id);
        const failure = await lease.ready.catch((cause: unknown) => cause);
        expect(failure).toBeInstanceOf(Error);
        if (!(failure instanceof Error)) throw new Error('Expected named model error.');
        expect(failure.message).toContain('Animated Triangle.glb');
        expect(failure.message).toContain('KHR_draco_mesh_compression');
        expect(failure.cause).toBeInstanceOf(Error);
        expect(failure.message).not.toContain('blob:');
        lease.release();
        expect(runtime.decodedImageBytes).toBe(0);
    });

    it('explicitly retries a failed viewport lease without an automatic request loop', async () => {
        const previousURL = location.href;
        const url = new URL(location.href);
        url.searchParams.set('backend', 'webgl2');
        history.replaceState(null, '', url);
        const container = document.createElement('div');
        container.style.cssText = 'width:128px;height:128px;position:relative';
        document.body.append(container);
        const errors: string[] = [];
        const viewport = await EditorViewport.create(
            container,
            () => {
                /* Selection is not involved. */
            },
            value => {
                errors.push(value);
            }
        );
        const load = vi
            .spyOn(H.GLTFLoader.prototype, 'load')
            .mockRejectedValueOnce(new Error('Transient decoder failure'));
        try {
            const asset = await importAsset(modelFile());
            const scene = createDefaultScene();
            scene.nodes['imported'] = {
                name: 'Retry fixture',
                type: 'model',
                asset: asset.id,
                parent: null,
                visible: true,
                transform: {
                    position: { x: 0, y: 1, z: 1 },
                    rotation: { x: 0, y: 0, z: 0 },
                    scale: { x: 1, y: 1, z: 1 }
                }
            };
            viewport.setScene(scene);
            await expect(viewport.setAssets({ [asset.id]: asset })).rejects.toThrow(
                /Transient decoder failure/
            );
            expect(load).toHaveBeenCalledTimes(1);
            await viewport.retryAssets();
            await viewport.waitForAssets();
            expect(load).toHaveBeenCalledTimes(2);
            expect(errors).toHaveLength(1);
        } finally {
            load.mockRestore();
            viewport.destroy();
            container.remove();
            history.replaceState(null, '', previousURL);
        }
    });

    it('reserves aggregate decoded pixels before creating URLs and recovers after release', async () => {
        const { stage } = await setup();
        const runtime = new EditorAssetRuntime(stage.renderer, 32);
        runtimes.push(runtime);
        const file = await imageFile();
        const a = await importAsset(file);
        const b = await importAsset(
            new File([await file.arrayBuffer()], 'Other.png', { type: 'image/png' })
        );
        runtime.setAssets({ [a.id]: a, [b.id]: b });
        expect(() => {
            runtime.assertSceneBudget([a.id, b.id]);
        }).toThrow(/decoded image budget/);
        expect(runtime.decodedImageBytes).toBe(0);
        const first = runtime.acquireTexture(a.id);
        const shared = runtime.acquireTexture(a.id);
        expect(runtime.decodedImageBytes).toBe(32);
        expect(() => runtime.acquireTexture(b.id)).toThrow(/decoded image budget/);
        expect(runtime.decodedImageBytes).toBe(32);
        await first.ready;
        first.release();
        expect(runtime.decodedImageBytes).toBe(32);
        shared.release();
        expect(runtime.decodedImageBytes).toBe(0);
        const next = runtime.acquireTexture(b.id);
        await next.ready;
        next.release();
        expect(runtime.decodedImageBytes).toBe(0);
    });

    it('shares decoded texture identity until the final owner releases it', async () => {
        const { runtime } = await setup();
        const asset = await importAsset(await imageFile());
        runtime.setAssets({ [asset.id]: asset });
        const a = runtime.acquireTexture(asset.id);
        const b = runtime.acquireTexture(asset.id);
        expect(a.texture).toBe(b.texture);
        await a.ready;
        expect(a.texture.width).toBe(4);
        expect(a.texture.height).toBe(2);
        expect(a.texture.flipY).toBe(false);
        a.release();
        expect(b.texture.image).not.toBeNull();
        b.release();
        expect(b.texture.image).toBeNull();
        b.release();
    });

    it('cancels obsolete model loads and permits a fresh request for the same asset', async () => {
        const { runtime } = await setup();
        const asset = await importAsset(modelFile());
        runtime.setAssets({ [asset.id]: asset });
        const obsolete = runtime.acquireModel(asset.id);
        obsolete.release();
        await expect(obsolete.ready).rejects.toThrow();
        const fresh = runtime.acquireModel(asset.id);
        expect((await fresh.ready).meshes.length).toBe(1);
        fresh.release();
    });

    it('owner destruction disposes active model and texture leases', async () => {
        const { runtime } = await setup();
        const model = await importAsset(modelFile());
        const texture = await importAsset(await imageFile());
        runtime.setAssets({ [model.id]: model, [texture.id]: texture });
        const modelLease = runtime.acquireModel(model.id);
        const textureLease = runtime.acquireTexture(texture.id);
        const instance = await modelLease.ready;
        await textureLease.ready;
        runtime.destroy();
        expect(instance.meshes[0]?.isDestroyed).toBe(true);
        expect(textureLease.texture.image).toBeNull();
        expect(() => runtime.acquireModel(model.id)).toThrow(/destroyed/);
    });
});
