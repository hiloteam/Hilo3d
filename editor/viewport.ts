import * as H from '../src/Hilo3d';
import {
    createTestFrameControl,
    type TestFrameControl
} from '../examples/shared/test-frame-control';
import type { SceneDocument, SceneMaterial, SceneNode } from './scene';
import type { ProjectAsset } from './assets';
import { editorCameraClipRange, frameEditorBounds } from './camera-framing';
import {
    EditorAssetRuntime,
    type ModelInstance,
    type ModelLease,
    type TextureLease
} from './asset-runtime';
import {
    TransformGizmo,
    type TransformGesture,
    type TransformMode,
    type TransformSpace
} from './transform-gizmo';
export type { TransformGesture, TransformMode, TransformSpace };

type Primitive = NonNullable<SceneNode['geometry']>;
type View = 'perspective' | 'top' | 'front' | 'right';

interface RuntimeNode {
    node: H.Node;
    kind: string;
}
interface ModelBinding {
    asset: string;
    lease: ModelLease;
    ready: Promise<void>;
    instance: ModelInstance | null;
    materialError: Error | null;
    failed: boolean;
}

interface SavedView {
    position: H.Vector3;
    target: H.Vector3;
}

function color(value: string): H.Color {
    const result = new H.Color().fromHEX(value);
    const linear = (channel: number): number =>
        channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    result.r = linear(result.r);
    result.g = linear(result.g);
    result.b = linear(result.b);
    return result;
}

function message(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
}

/** A unit cylinder authored with ordinary portable geometry streams. */
function createCylinder(): H.Geometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const segments = 64;
    for (let index = 0; index <= segments; index++) {
        const angle = (index / segments) * Math.PI * 2;
        const x = Math.cos(angle);
        const z = Math.sin(angle);
        for (const y of [-0.5, 0.5]) {
            positions.push(x * 0.5, y, z * 0.5);
            normals.push(x, 0, z);
            uvs.push(index / segments, 0.5 - y);
        }
        if (index < segments) {
            const a = index * 2;
            const b = a + 2;
            indices.push(a, a + 1, b, b, a + 1, b + 1);
        }
    }
    for (const sign of [-1, 1]) {
        const center = positions.length / 3;
        positions.push(0, sign * 0.5, 0);
        normals.push(0, sign, 0);
        uvs.push(0.5, 0.5);
        for (let index = 0; index <= segments; index++) {
            const angle = (index / segments) * Math.PI * 2;
            const x = Math.cos(angle) * 0.5;
            const z = Math.sin(angle) * 0.5;
            positions.push(x, sign * 0.5, z);
            normals.push(0, sign, 0);
            uvs.push(x + 0.5, z + 0.5);
            if (index < segments) {
                const a = center + index + 1;
                if (sign > 0) indices.push(center, a + 1, a);
                else indices.push(center, a, a + 1);
            }
        }
    }
    return new H.Geometry({
        vertices: new H.GeometryData(new Float32Array(positions), 3),
        normals: new H.GeometryData(new Float32Array(normals), 3),
        uvs: new H.GeometryData(new Float32Array(uvs), 2),
        indices: new H.GeometryData(new Uint16Array(indices), 1)
    });
}

function lineMesh(positions: readonly number[], tint: string, overlay = false): H.Mesh {
    return new H.Mesh({
        geometry: new H.Geometry({
            mode: H.constants.LINES,
            vertices: new H.GeometryData(new Float32Array(positions), 3)
        }),
        material: new H.BasicMaterial({
            lightType: 'NONE',
            diffuse: color(tint),
            state: { depthWrite: false, depthTest: !overlay }
        }),
        castShadows: false,
        receiveShadows: false,
        renderOrder: overlay ? 100 : 50
    });
}

function createGrid(): H.Node {
    const grid = new H.Node({ name: 'Editor grid' });
    const geometry = new H.BoxGeometry();
    const materials = ['#474a50', '#50545a', '#75454a', '#3f6855'].map(
        tint =>
            new H.BasicMaterial({
                lightType: 'NONE',
                diffuse: color(tint),
                state: { depthWrite: false }
            })
    );
    const addLine = (index: number, alongX: boolean): void => {
        const material = materials[index === 0 ? (alongX ? 2 : 3) : index % 5 === 0 ? 1 : 0];
        if (!material) return;
        new H.Mesh({
            geometry,
            material,
            castShadows: false,
            receiveShadows: false,
            useInstanced: true,
            renderOrder: 50,
            x: alongX ? 0 : index,
            y: -0.012,
            z: alongX ? index : 0
        })
            .setScale(alongX ? 60 : 0.009, 0.003, alongX ? 0.009 : 60)
            .addTo(grid);
    };
    for (let index = -30; index <= 30; index++) {
        addLine(index, true);
        addLine(index, false);
    }
    return grid;
}

function createSelectionBox(): H.Mesh {
    const positions: number[] = [];
    for (const a of [-0.5, 0.5]) {
        for (const b of [-0.5, 0.5]) {
            positions.push(-0.5, a, b, 0.5, a, b);
            positions.push(a, -0.5, b, a, 0.5, b);
            positions.push(a, b, -0.5, a, b, 0.5);
        }
    }
    const mesh = lineMesh(positions, '#ef963d', true);
    mesh.visible = false;
    return mesh;
}

/** Reusable authoring primitives with complete logical UVs, including the engine's opt-in box UVs. */
export function createEditorGeometries(): Record<Primitive, H.Geometry> {
    return {
        cube: new H.BoxGeometry().setAllRectUV([
            [0, 1],
            [1, 1],
            [1, 0],
            [0, 0]
        ]),
        sphere: new H.SphereGeometry({ radius: 0.5, widthSegments: 48, heightSegments: 32 }),
        cylinder: createCylinder(),
        plane: new H.PlaneGeometry().rotate(-90, 0, 0)
    };
}

/** Scene-document adapter using only the engine's public rendering and camera contracts. */
export class EditorViewport {
    readonly backend: string;
    private readonly camera: H.PerspectiveCamera;
    private readonly controls: H.OrbitControls;
    private readonly picker: H.MeshPicker;
    private readonly ticker = new H.Ticker(60);
    private readonly sceneRoot = new H.Node({ name: 'Scene' });
    private readonly helpers = new H.Node({ name: 'Editor helpers' });
    private readonly grid = createGrid();
    private readonly selectionBox = createSelectionBox();
    private readonly gizmo: TransformGizmo;
    private interactionEnabled = true;
    private authoringEnabled = true;
    private selectedIds: readonly string[] = [];
    private sceneDocument: SceneDocument | null = null;
    private readonly ambient = new H.AmbientLight({ color: color('#d7e1ef'), amount: 0.3 });
    private readonly nodes = new Map<string, RuntimeNode>();
    private readonly meshIds = new Map<H.Mesh, string>();
    private readonly materials = new Map<string, H.PBRMaterial>();
    private readonly materialKeys = new Map<string, string>();
    private readonly assetRuntime: EditorAssetRuntime;
    private readonly textureLeases = new Map<string, TextureLease>();
    private readonly failedTextures = new Set<string>();
    private readonly modelBindings = new Map<string, ModelBinding>();
    private viewedCamera: string | null = null;
    private focusedRadius: number | null = null;
    private readonly geometries = createEditorGeometries();
    private readonly fallbackMaterial = new H.PBRMaterial({
        baseColor: color('#a6a6ab'),
        metallic: 0,
        roughness: 0.7
    });
    private readonly resizeObserver: ResizeObserver;
    private readonly testCapture: TestFrameControl | null;
    private selectedId: string | null = null;
    private sceneRevision = 0;
    private destroyed = false;
    private failed = false;
    private recovering = false;
    private suspended = false;
    private gridVisible = true;
    private preview: SavedView | null = null;
    private previewAngle = 0;
    private readonly previewPosition = new H.Vector3();
    private pendingPick: Promise<void> | null = null;
    private queuedScene: SceneDocument | null = null;
    private pointerStart: { id: number; x: number; y: number; dragged: boolean } | null = null;

    static async create(
        container: HTMLElement,
        onSelect: (id: string | null) => void,
        onError: (message: string) => void,
        onTransform?: (gesture: TransformGesture) => void
    ): Promise<EditorViewport> {
        const requested = new URL(location.href).searchParams.get('backend') ?? 'auto';
        if (requested !== 'auto' && requested !== 'webgl2' && requested !== 'webgpu') {
            throw new TypeError(`Unsupported renderer backend: ${requested}`);
        }
        const width = Math.max(container.clientWidth, 1);
        const height = Math.max(container.clientHeight, 1);
        const camera = new H.PerspectiveCamera({
            aspect: width / height,
            fov: 42,
            near: 0.05,
            far: 180,
            x: 3.6,
            y: 3.7,
            z: 4.8
        });
        const stage = await H.Stage.create({
            container,
            camera,
            backend: requested,
            width,
            height,
            pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
            antialias: true,
            useInstanced: true,
            clearColor: color('#292b30')
        });
        try {
            return new EditorViewport(stage, camera, container, onSelect, onError, onTransform);
        } catch (cause) {
            stage.destroy();
            stage.canvas.remove();
            throw cause;
        }
    }

    private constructor(
        private readonly stage: H.Stage,
        camera: H.PerspectiveCamera,
        private readonly container: HTMLElement,
        private readonly onSelect: (id: string | null) => void,
        private readonly onError: (message: string) => void,
        private readonly onTransform?: (gesture: TransformGesture) => void
    ) {
        this.backend = stage.renderer.backend;
        this.camera = camera;
        this.assetRuntime = new EditorAssetRuntime(stage.renderer);
        this.controls = new H.OrbitControls(stage, {
            camera,
            target: new H.Vector3(0, 1.1, 0),
            minDistance: 0.2,
            maxDistance: 100,
            rotateSpeed: 0.7,
            zoomSpeed: 0.75
        });
        this.picker = new H.MeshPicker({ stage });
        this.sceneRoot.addTo(stage);
        this.helpers.addTo(stage);
        this.grid.addTo(this.helpers);
        this.selectionBox.addTo(this.helpers);
        this.gizmo = new TransformGizmo({
            container,
            camera,
            onTransform: this.handleTransform,
            onError,
            onActiveChange: active => {
                this.pointerStart = null;
                if (active || !this.interactionEnabled || this.preview || this.viewedCamera)
                    this.controls.disable();
                else this.controls.enable();
            }
        });
        this.controls.onChange = () => {
            if (this.focusedRadius !== null) {
                const clipping = editorCameraClipRange(
                    this.camera.position.distance(this.controls.target),
                    this.focusedRadius,
                    this.controls.maxDistance
                );
                this.camera.near = clipping.near;
                this.camera.far = clipping.far;
                this.syncShadowClipRange();
            }
            this.gizmo.update();
        };
        this.ambient.addTo(stage);
        stage.canvas.classList.add('scene-canvas');
        stage.canvas.setAttribute(
            'aria-label',
            '3D scene viewport. Drag to orbit, Shift-drag to pan, scroll to zoom.'
        );
        stage.canvas.addEventListener('pointerdown', this.handlePointerDown);
        stage.canvas.addEventListener('pointermove', this.handlePointerMove);
        stage.canvas.addEventListener('pointerup', this.handlePointerUp);
        stage.canvas.addEventListener('pointercancel', this.handlePointerCancel);
        stage.canvas.addEventListener('dblclick', this.handleDoubleClick);
        this.resizeObserver = new ResizeObserver(this.resize);
        this.resizeObserver.observe(container);
        window.addEventListener('pagehide', this.handlePageHide);
        window.addEventListener('pageshow', this.handlePageShow);
        document.addEventListener('visibilitychange', this.handleVisibilityChange);
        stage.renderer.on('rhiDeviceLost', this.handleDeviceLost);
        stage.renderer.on('rhiDeviceRestored', this.handleDeviceRestored);
        stage.renderer.on('rhiDeviceRecoveryFailed', this.handleDeviceRecoveryFailed);
        this.ticker.addTick({ tick: this.tick });
        this.testCapture =
            new URL(location.href).searchParams.get('test') === '1'
                ? createTestFrameControl(
                      this.ticker,
                      () => this.stage.renderer.waitForIdle(),
                      new URL(location.href).searchParams.get('benchmark') !== '1'
                  )
                : null;
        if (this.testCapture) {
            (
                window as Window & { __HILO3D_TEST_CAPTURE__?: TestFrameControl }
            ).__HILO3D_TEST_CAPTURE__ = this.testCapture;
        }
        this.ticker.start();
    }

    setScene(scene: SceneDocument): void {
        if (this.destroyed) return;
        this.sceneRevision++;
        if (this.pendingPick) {
            this.queuedScene = scene;
            return;
        }
        this.assetRuntime.assertSceneBudget([
            ...Object.values(scene.materials).flatMap(material =>
                this.materialTextureIds(material)
            ),
            ...Object.values(scene.nodes).flatMap(node =>
                node.type === 'model' && node.asset ? [node.asset] : []
            )
        ]);
        this.sceneDocument = scene;
        this.stage.renderer.clearColor = color(scene.environment.background);
        this.ambient.amount = scene.environment.ambientIntensity;
        for (const [id, binding] of this.modelBindings) {
            const descriptor = scene.nodes[id];
            if (
                descriptor?.type !== 'model' ||
                descriptor.asset !== binding.asset ||
                !this.assetRuntime.has(binding.asset, 'model')
            ) {
                binding.lease.release();
                this.modelBindings.delete(id);
            }
        }
        this.syncTextureLeases(scene);
        for (const [id, descriptor] of Object.entries(scene.materials))
            this.updateMaterial(id, descriptor);
        // Detach first so deleting or changing a parent cannot destroy surviving children.
        for (const runtime of this.nodes.values()) runtime.node.removeFromParent();
        for (const [id, runtime] of this.nodes) {
            const descriptor = scene.nodes[id];
            const kind = descriptor ? this.nodeKind(descriptor) : null;
            if (kind !== runtime.kind) {
                runtime.node.destroy(this.stage.renderer);
                this.nodes.delete(id);
            }
        }
        this.meshIds.clear();
        for (const [id, descriptor] of Object.entries(scene.nodes)) {
            let runtime = this.nodes.get(id);
            if (!runtime) {
                runtime = { node: this.createNode(descriptor), kind: this.nodeKind(descriptor) };
                this.nodes.set(id, runtime);
            }
            const node = runtime.node;
            const { position, rotation, scale } = descriptor.transform;
            node.name = descriptor.name;
            node.visible = descriptor.visible;
            node.setPosition(position.x, position.y, position.z);
            node.setRotation(rotation.x, rotation.y, rotation.z);
            node.setScale(scale.x, scale.y, scale.z);
            if (node instanceof H.Mesh) {
                node.geometry = this.geometries[descriptor.geometry ?? 'cube'];
                node.material =
                    this.materials.get(descriptor.material ?? '') ?? this.fallbackMaterial;
                this.meshIds.set(node, id);
            } else if (node instanceof H.DirectionalLight || node instanceof H.AmbientLight) {
                node.color.copy(color(descriptor.light?.color ?? '#ffffff'));
                node.amount = descriptor.light?.intensity ?? 1;
            } else if (node instanceof H.PerspectiveCamera && descriptor.camera) {
                node.fov = descriptor.camera.fov;
                node.near = descriptor.camera.near;
                node.far = descriptor.camera.far;
                node.aspect = this.stage.width / this.stage.height;
            }
        }
        for (const [id, descriptor] of Object.entries(scene.nodes)) {
            const node = this.nodes.get(id)?.node;
            const parent = descriptor.parent
                ? this.nodes.get(descriptor.parent)?.node
                : this.sceneRoot;
            if (node) (parent ?? this.sceneRoot).addChild(node);
        }
        for (const id of this.materials.keys()) {
            if (!(id in scene.materials)) {
                this.materials.delete(id);
                this.materialKeys.delete(id);
            }
        }
        this.syncModels(scene);
        if (
            this.viewedCamera &&
            !(this.nodes.get(this.viewedCamera)?.node instanceof H.PerspectiveCamera)
        )
            this.setCamera(null);
        this.syncShadowClipRange();
        this.gizmo.setScene(scene);
        this.updateSelection();
        if (this.failed) {
            this.failed = false;
            if (!this.suspended && !document.hidden) this.ticker.start();
        }
    }

    /** Register portable project bytes and wait for the currently requested, available assets. */
    async setAssets(assets: Readonly<Record<string, ProjectAsset>>): Promise<void> {
        this.assetRuntime.setAssets(assets);
        if (this.sceneDocument) this.setScene(this.sceneDocument);
        await this.settleAssets(false);
    }

    /** Wait for all current model/texture instances and reject unresolved scene references. */
    async waitForAssets(): Promise<void> {
        await this.settleAssets(true);
    }

    /** Explicitly retry failed decoder requests while preserving every successful asset instance. */
    async retryAssets(): Promise<void> {
        if (this.destroyed) return;
        for (const [id, binding] of this.modelBindings) {
            if (!binding.failed) continue;
            binding.lease.release();
            this.modelBindings.delete(id);
        }
        for (const id of this.failedTextures) {
            this.textureLeases.get(id)?.release();
            this.textureLeases.delete(id);
        }
        this.failedTextures.clear();
        if (this.sceneDocument) this.setScene(this.sceneDocument);
        await this.waitForAssets();
    }

    private isAlive(): boolean {
        return !this.destroyed;
    }

    private async settleAssets(requireReferences: boolean): Promise<void> {
        while (this.isAlive()) {
            if (this.pendingPick) {
                await this.pendingPick;
                continue;
            }
            const revision = this.sceneRevision;
            try {
                await Promise.all(
                    [...this.textureLeases.values()]
                        .map(lease => lease.ready)
                        .concat([...this.modelBindings.values()].map(binding => binding.ready))
                );
            } catch (cause) {
                if (this.destroyed) return;
                if (revision !== this.sceneRevision) continue;
                throw cause;
            }
            if (revision !== this.sceneRevision) continue;
            for (const binding of this.modelBindings.values()) {
                if (binding.materialError) throw binding.materialError;
            }
            if (requireReferences && this.sceneDocument) {
                for (const node of Object.values(this.sceneDocument.nodes)) {
                    if (
                        node.type === 'model' &&
                        node.asset &&
                        !this.assetRuntime.has(node.asset, 'model')
                    )
                        throw new Error(`Missing model asset: ${node.asset}`);
                }
                for (const material of Object.values(this.sceneDocument.materials)) {
                    for (const id of this.materialTextureIds(material))
                        if (!this.assetRuntime.has(id, 'texture'))
                            throw new Error(`Missing texture asset: ${id}`);
                }
            }
            return;
        }
    }

    /** Render through an authored camera; null restores the unchanged editor orbit camera. */
    setCamera(id: string | null): void {
        if (this.destroyed) return;
        const node = id === null ? this.camera : this.nodes.get(id)?.node;
        if (!(node instanceof H.PerspectiveCamera))
            throw new Error('Select an authored camera to view through.');
        this.gizmo.cancel();
        this.viewedCamera = id;
        this.stage.camera = node;
        node.aspect = this.stage.width / this.stage.height;
        this.syncShadowClipRange();
        this.updateInteraction();
    }

    /** Apply transient local poses for timeline/playback without rebuilding the authored scene. */
    applyTransforms(transforms: Readonly<Record<string, SceneNode['transform']>>): void {
        for (const [id, transform] of Object.entries(transforms)) {
            const node = this.nodes.get(id)?.node;
            if (!node) continue;
            node.setPosition(transform.position.x, transform.position.y, transform.position.z);
            node.setRotation(transform.rotation.x, transform.rotation.y, transform.rotation.z);
            node.setScale(transform.scale.x, transform.scale.y, transform.scale.z);
        }
        this.updateSelection();
    }

    private materialTextureIds(material: SceneMaterial): string[] {
        return [
            material.baseColorTexture,
            material.normalTexture,
            material.metallicRoughnessTexture,
            material.emissiveTexture
        ].filter((id): id is string => id !== undefined);
    }

    private syncTextureLeases(scene: SceneDocument): void {
        const requested = new Set(
            Object.values(scene.materials).flatMap(material => this.materialTextureIds(material))
        );
        for (const [id, lease] of this.textureLeases) {
            if (!requested.has(id) || !this.assetRuntime.has(id, 'texture')) {
                lease.release();
                this.textureLeases.delete(id);
                this.failedTextures.delete(id);
            }
        }
        for (const id of requested) {
            if (this.textureLeases.has(id) || !this.assetRuntime.has(id, 'texture')) continue;
            const lease = this.assetRuntime.acquireTexture(id);
            this.textureLeases.set(id, lease);
            void lease.ready.catch((cause: unknown) => {
                if (!this.destroyed && this.textureLeases.get(id) === lease) {
                    this.failedTextures.add(id);
                    this.onError(message(cause));
                }
            });
        }
    }

    private updateMaterial(id: string, descriptor: SceneMaterial): void {
        const texture = (asset: string | undefined): H.Texture | undefined =>
            asset ? this.textureLeases.get(asset)?.texture : undefined;
        const base = texture(descriptor.baseColorTexture);
        const normal = texture(descriptor.normalTexture);
        const combined = texture(descriptor.metallicRoughnessTexture);
        const emission = texture(descriptor.emissiveTexture);
        const key = [base?.id, normal?.id, combined?.id, emission?.id].join('|');
        let material = this.materials.get(id);
        if (!material || this.materialKeys.get(id) !== key) {
            material = new H.PBRMaterial({
                baseColor: color(descriptor.color),
                metallic: descriptor.metallic,
                roughness: descriptor.roughness,
                emissionFactor: color(
                    descriptor.emissiveColor ?? (emission ? '#ffffff' : '#000000')
                ),
                ...(base ? { baseColorMap: { texture: base, encoding: 'srgb' } } : {}),
                ...(normal ? { normalMap: { texture: normal, encoding: 'data' } } : {}),
                ...(combined
                    ? { metallicRoughnessMap: { texture: combined, encoding: 'data' } }
                    : {}),
                ...(emission ? { emission: { texture: emission, encoding: 'srgb' } } : {})
            });
            this.materials.set(id, material);
            this.materialKeys.set(id, key);
        } else {
            material.baseColor.copy(color(descriptor.color));
            material.metallic = descriptor.metallic;
            material.roughness = descriptor.roughness;
            material.emissionFactor.copy(
                color(descriptor.emissiveColor ?? (emission ? '#ffffff' : '#000000'))
            );
        }
    }

    private syncModels(scene: SceneDocument): void {
        for (const [id, descriptor] of Object.entries(scene.nodes)) {
            if (
                descriptor.type !== 'model' ||
                !descriptor.asset ||
                !this.assetRuntime.has(descriptor.asset, 'model')
            )
                continue;
            let binding = this.modelBindings.get(id);
            if (!binding) {
                const lease = this.assetRuntime.acquireModel(descriptor.asset);
                binding = {
                    asset: descriptor.asset,
                    lease,
                    instance: null,
                    materialError: null,
                    failed: false,
                    ready: Promise.resolve()
                };
                const pending = binding;
                this.modelBindings.set(id, pending);
                pending.ready = lease.ready.then(instance => {
                    if (this.destroyed || this.modelBindings.get(id) !== pending) return;
                    const wrapper = this.nodes.get(id)?.node;
                    if (!wrapper) return;
                    pending.instance = instance;
                    wrapper.addChild(instance.root);
                    this.sceneRevision++;
                    this.updateModelMaterial(id, pending);
                    this.updateSelection();
                });
                void pending.ready.catch((cause: unknown) => {
                    if (!this.destroyed && this.modelBindings.get(id) === pending) {
                        pending.failed = true;
                        this.onError(message(cause));
                    }
                });
            }
            this.updateModelMaterial(id, binding);
        }
    }

    private updateModelMaterial(id: string, binding: ModelBinding): void {
        if (!binding.instance) return;
        const override = this.sceneDocument?.nodes[id]?.material;
        const material = override ? this.materials.get(override) : undefined;
        const missingUV = material?.getTextureSlot('normal')
            ? binding.instance.meshes.find(mesh => !mesh.geometry?.uvs)
            : undefined;
        const failure = missingUV
            ? new Error(
                  `Cannot apply a normal map to ${missingUV.name || id}: the imported mesh has no UV0 coordinates. Original model materials are retained. Remove the normal map or import a UV-mapped model.`
              )
            : null;
        if (failure && failure.message !== binding.materialError?.message)
            this.onError(failure.message);
        binding.materialError = failure;
        for (const mesh of binding.instance.meshes) {
            mesh.material =
                (failure ? undefined : material) ??
                binding.instance.originalMaterials.get(mesh) ??
                null;
            this.meshIds.set(mesh, id);
        }
    }

    private updateInteraction(): void {
        const editor = this.interactionEnabled && this.viewedCamera === null && !this.recovering;
        this.helpers.visible = editor;
        this.gizmo.setVisible(editor && this.authoringEnabled && this.preview === null);
        if (editor && !this.preview && !this.gizmo.active) this.controls.enable();
        else this.controls.disable();
    }

    private syncShadowClipRange(): void {
        const camera = this.stage.camera;
        const distance = Math.max(30, camera instanceof H.PerspectiveCamera ? camera.near * 2 : 30);
        for (const { node } of this.nodes.values()) {
            if (node instanceof H.DirectionalLight && node.shadow)
                node.shadow.cascadeMaxDistance = distance;
        }
    }

    select(id: string | null | readonly string[]): void {
        this.selectedIds = typeof id === 'string' ? [id] : (id ?? []);
        this.selectedId = this.selectedIds.at(-1) ?? null;
        this.gizmo.select(this.selectedIds);
        this.updateSelection();
    }

    setTransformMode(mode: TransformMode): void {
        this.gizmo.setMode(mode);
    }
    setTransformSpace(space: TransformSpace): void {
        this.gizmo.setSpace(space);
    }
    setTransformSnap(enabled: boolean): void {
        this.gizmo.setSnap(enabled);
    }
    setInteractionEnabled(enabled: boolean): void {
        this.interactionEnabled = enabled;
        if (!enabled) this.pointerStart = null;
        this.gizmo.setEnabled(enabled && this.authoringEnabled);
        this.updateInteraction();
    }

    /** Disable transform authoring while retaining orbit navigation and object inspection. */
    setAuthoringEnabled(enabled: boolean): void {
        this.authoringEnabled = enabled;
        this.gizmo.setEnabled(enabled && this.interactionEnabled);
        this.updateInteraction();
    }

    private readonly handleTransform = (gesture: TransformGesture): void => {
        this.applyTransforms(gesture.transforms);
        if (this.sceneDocument) {
            const nodes = { ...this.sceneDocument.nodes };
            for (const [id, transform] of Object.entries(gesture.transforms)) {
                const descriptor = nodes[id];
                if (descriptor) nodes[id] = { ...descriptor, transform };
            }
            this.gizmo.setScene({ ...this.sceneDocument, nodes });
        }
        this.updateSelection();
        this.onTransform?.(gesture);
    };

    focus(id: string | null = this.selectedId): void {
        if (this.destroyed) return;
        if (this.viewedCamera) this.setCamera(null);
        const bounds = id ? this.nodes.get(id)?.node.getBounds() : this.sceneBounds();
        if (!bounds) return;
        const frame = frameEditorBounds(
            bounds,
            this.camera.position.clone().subtract(this.controls.target),
            this.camera.fov,
            this.camera.aspect
        );
        this.focusedRadius = frame.radius;
        this.controls.minDistance = frame.minDistance;
        this.controls.maxDistance = frame.maxDistance;
        this.controls.setView(frame.position, frame.target);
    }

    setView(view: View): void {
        if (this.destroyed) return;
        if (this.viewedCamera) this.setCamera(null);
        const target = this.controls.target.clone();
        const radius = Math.max(this.camera.position.clone().subtract(target).length(), 3);
        const offset =
            view === 'top'
                ? new H.Vector3(0, radius, 0.001)
                : view === 'front'
                  ? new H.Vector3(0, 0, radius)
                  : view === 'right'
                    ? new H.Vector3(radius, 0, 0)
                    : new H.Vector3(0.62, 0.46, 0.72).normalize().scale(radius);
        this.controls.setView(offset.add(target), target);
    }

    setGrid(visible: boolean): void {
        this.gridVisible = visible;
        this.grid.visible = visible && this.preview === null;
    }

    setPreview(enabled: boolean): void {
        if (this.destroyed || enabled === (this.preview !== null)) return;
        if (enabled) {
            this.preview = {
                position: this.camera.position.clone(),
                target: this.controls.target.clone()
            };
            this.previewAngle = 0;
            this.controls.disable();
        } else if (this.preview) {
            this.controls.setView(this.preview.position, this.preview.target);
            this.preview = null;
            if (this.interactionEnabled) this.controls.enable();
        }
        this.grid.visible = this.gridVisible && !enabled;
        this.updateInteraction();
        this.updateSelection();
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.ticker.stop();
        this.gizmo.destroy();
        this.testCapture?.dispose();
        const captureWindow = window as Window & { __HILO3D_TEST_CAPTURE__?: TestFrameControl };
        if (captureWindow.__HILO3D_TEST_CAPTURE__ === this.testCapture)
            delete captureWindow.__HILO3D_TEST_CAPTURE__;
        this.queuedScene = null;
        this.controls.dispose();
        this.resizeObserver.disconnect();
        this.picker.destroy();
        this.stage.renderer.off('rhiDeviceLost', this.handleDeviceLost);
        this.stage.renderer.off('rhiDeviceRestored', this.handleDeviceRestored);
        this.stage.renderer.off('rhiDeviceRecoveryFailed', this.handleDeviceRecoveryFailed);
        window.removeEventListener('pagehide', this.handlePageHide);
        window.removeEventListener('pageshow', this.handlePageShow);
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
        const { canvas } = this.stage;
        canvas.removeEventListener('pointerdown', this.handlePointerDown);
        canvas.removeEventListener('pointermove', this.handlePointerMove);
        canvas.removeEventListener('pointerup', this.handlePointerUp);
        canvas.removeEventListener('pointercancel', this.handlePointerCancel);
        canvas.removeEventListener('dblclick', this.handleDoubleClick);
        const release = (): void => {
            for (const binding of this.modelBindings.values()) binding.lease.release();
            this.modelBindings.clear();
            for (const lease of this.textureLeases.values()) lease.release();
            this.textureLeases.clear();
            this.assetRuntime.destroy();
            try {
                this.stage.destroy();
            } catch (cause) {
                this.onError(message(cause));
            }
            canvas.remove();
            this.nodes.clear();
            this.materials.clear();
            this.meshIds.clear();
        };
        if (this.pendingPick) void this.pendingPick.then(release, release);
        else release();
    }

    private nodeKind(descriptor: SceneNode): string {
        return descriptor.type === 'light'
            ? `light:${descriptor.light?.kind ?? 'directional'}`
            : descriptor.type;
    }

    private sceneBounds(): H.Bounds | undefined {
        let result: H.Bounds | undefined;
        for (const { node, kind } of this.nodes.values()) {
            if (
                kind !== 'model' &&
                (!(node instanceof H.Mesh) || node.geometry === this.geometries.plane)
            )
                continue;
            let visible = true;
            for (let ancestor: H.Node | null = node; ancestor; ancestor = ancestor.parent) {
                if (!ancestor.visible) visible = false;
            }
            if (!visible) continue;
            const bounds = node.getBounds();
            if (!bounds) continue;
            if (!result) result = { ...bounds };
            else {
                result.xMin = Math.min(result.xMin, bounds.xMin);
                result.yMin = Math.min(result.yMin, bounds.yMin);
                result.zMin = Math.min(result.zMin, bounds.zMin);
                result.xMax = Math.max(result.xMax, bounds.xMax);
                result.yMax = Math.max(result.yMax, bounds.yMax);
                result.zMax = Math.max(result.zMax, bounds.zMax);
            }
        }
        if (result) {
            result.x = (result.xMin + result.xMax) * 0.5;
            result.y = (result.yMin + result.yMax) * 0.5;
            result.z = (result.zMin + result.zMax) * 0.5;
            result.width = result.xMax - result.xMin;
            result.height = result.yMax - result.yMin;
            result.depth = result.zMax - result.zMin;
        }
        return result;
    }

    private createNode(descriptor: SceneNode): H.Node {
        if (descriptor.type === 'mesh')
            return new H.Mesh({ castShadows: true, receiveShadows: true, useInstanced: true });
        if (descriptor.type === 'camera')
            return new H.PerspectiveCamera({
                ...descriptor.camera,
                aspect: this.stage.width / this.stage.height
            });
        if (descriptor.type === 'light') {
            if (descriptor.light?.kind === 'ambient') return new H.AmbientLight();
            return new H.DirectionalLight({
                direction: new H.Vector3(0, 0, -1),
                shadow: {
                    width: 2048,
                    height: 2048,
                    minBias: 0.001,
                    cascadeMaxDistance: 30,
                    stabilizeCascades: true
                }
            });
        }
        return new H.Node();
    }

    private updateSelection(): void {
        const visible = this.preview === null;
        let bounds: H.Bounds | undefined;
        for (const id of this.selectedIds) {
            const node = this.nodes.get(id)?.node;
            if (!node || !visible) continue;
            let hidden = false;
            for (let parent: H.Node | null = node; parent; parent = parent.parent) {
                if (!parent.visible) hidden = true;
            }
            const next = hidden ? undefined : node.getBounds();
            if (!next) continue;
            if (!bounds) bounds = { ...next };
            else {
                bounds.xMin = Math.min(bounds.xMin, next.xMin);
                bounds.xMax = Math.max(bounds.xMax, next.xMax);
                bounds.yMin = Math.min(bounds.yMin, next.yMin);
                bounds.yMax = Math.max(bounds.yMax, next.yMax);
                bounds.zMin = Math.min(bounds.zMin, next.zMin);
                bounds.zMax = Math.max(bounds.zMax, next.zMax);
            }
        }
        this.selectionBox.visible = bounds !== undefined;
        if (!bounds) return;
        this.selectionBox.setPosition(
            (bounds.xMin + bounds.xMax) / 2,
            (bounds.yMin + bounds.yMax) / 2,
            (bounds.zMin + bounds.zMax) / 2
        );
        this.selectionBox.setScale(
            Math.max(bounds.xMax - bounds.xMin, 0.025) + 0.025,
            Math.max(bounds.yMax - bounds.yMin, 0.025) + 0.025,
            Math.max(bounds.zMax - bounds.zMin, 0.025) + 0.025
        );
    }

    private readonly tick = (deltaTime: number): void => {
        if (this.destroyed || this.failed || this.recovering || this.suspended || this.pendingPick)
            return;
        try {
            if (this.preview) {
                this.previewAngle += Math.min(deltaTime, 100) * 0.00016;
                const { position, target } = this.preview;
                const x = position.x - target.x;
                const z = position.z - target.z;
                const cosine = Math.cos(this.previewAngle);
                const sine = Math.sin(this.previewAngle);
                this.controls.setView(
                    this.previewPosition.set(
                        target.x + x * cosine + z * sine,
                        position.y,
                        target.z + z * cosine - x * sine
                    ),
                    target
                );
            }
            this.stage.tick(deltaTime);
            this.gizmo.update();
        } catch (cause) {
            this.ticker.stop();
            // Native context loss can throw before the public loss event reaches its microtask.
            queueMicrotask(() => {
                if (this.destroyed || this.recovering || !this.stage.renderer.isReady) return;
                this.failed = true;
                this.onError(message(cause));
            });
        }
    };

    private readonly resize = (): void => {
        if (this.destroyed) return;
        const width = Math.max(this.container.clientWidth, 1);
        const height = Math.max(this.container.clientHeight, 1);
        this.camera.aspect = width / height;
        if (!this.stage.renderer.isReady) return;
        this.stage.resize(width, height, Math.min(window.devicePixelRatio || 1, 2));
        for (const runtime of this.nodes.values())
            if (runtime.node instanceof H.PerspectiveCamera) runtime.node.aspect = width / height;
        this.gizmo.update();
    };

    private readonly handlePointerDown = (event: PointerEvent): void => {
        if (
            event.button !== 0 ||
            event.shiftKey ||
            this.preview ||
            !this.interactionEnabled ||
            this.gizmo.active ||
            this.viewedCamera
        )
            return;
        this.pointerStart = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            dragged: false
        };
    };

    private readonly handlePointerMove = (event: PointerEvent): void => {
        const start = this.pointerStart;
        if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4)
            start.dragged = true;
    };

    private readonly handlePointerCancel = (): void => {
        this.pointerStart = null;
    };

    private readonly handlePointerUp = (event: PointerEvent): void => {
        const start = this.pointerStart;
        this.pointerStart = null;
        if (
            start?.id !== event.pointerId ||
            start.dragged ||
            this.pendingPick ||
            this.destroyed ||
            this.preview
        )
            return;
        const rect = this.stage.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return;
        const revision = this.sceneRevision;
        this.helpers.visible = false;
        this.pendingPick = this.picker
            .getSelection(x, y)
            .then(meshes => {
                if (this.destroyed || revision !== this.sceneRevision) return;
                const mesh = meshes.find(candidate => this.meshIds.has(candidate));
                this.onSelect(mesh ? (this.meshIds.get(mesh) ?? null) : null);
            })
            .catch((cause: unknown) => {
                if (!this.destroyed && !this.recovering) this.onError(message(cause));
            })
            .finally(() => {
                this.pendingPick = null;
                this.updateInteraction();
                if (this.queuedScene && !this.destroyed) {
                    const scene = this.queuedScene;
                    this.queuedScene = null;
                    this.setScene(scene);
                }
            });
    };

    private readonly handleDoubleClick = (): void => {
        this.focus();
    };

    private readonly handlePageHide = (event: PageTransitionEvent): void => {
        this.gizmo.cancel();
        this.ticker.stop();
        if (event.persisted) this.suspended = true;
        else this.destroy();
    };

    private readonly handlePageShow = (event: PageTransitionEvent): void => {
        if (event.persisted && !this.destroyed && !this.failed) {
            this.suspended = false;
            this.resize();
            if (!document.hidden) this.ticker.start();
        }
    };

    private readonly handleVisibilityChange = (): void => {
        if (document.hidden) this.ticker.stop();
        else if (!this.destroyed && !this.failed && !this.recovering && !this.suspended)
            this.ticker.start();
    };

    private readonly handleDeviceLost = (): void => {
        if (this.destroyed) return;
        this.recovering = true;
        this.ticker.stop();
        this.gizmo.cancel();
        this.updateInteraction();
    };

    private readonly handleDeviceRestored = (): void => {
        if (this.destroyed) return;
        this.recovering = false;
        this.failed = false;
        this.resize();
        this.updateInteraction();
        if (!this.suspended && !document.hidden) this.ticker.start();
    };

    private readonly handleDeviceRecoveryFailed = (event: H.DispatchEvent): void => {
        if (this.destroyed) return;
        this.recovering = false;
        this.failed = true;
        this.ticker.stop();
        this.onError(`Graphics device recovery failed: ${message(event.detail)}`);
    };
}
