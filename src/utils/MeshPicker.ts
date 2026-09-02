import Mesh from '../core/Mesh';
import type Engine from '../core/Engine';
import type { Entity } from '../ecs/Entity';
import type World from '../ecs/World';
import ShaderMaterial from '../material/ShaderMaterial';
import type { Renderer } from '../render/Renderer';
import type { RenderTarget } from '../render/RenderTarget';
import type { RenderWorld } from '../render/world/RenderWorld';
import { decodeMeshPickingId, getMeshPickingIdentity } from '../render/PickingIdentity';
import type { CameraDepthMode } from '../camera/Camera';
import basicVertexSource from '../shader/basic.vert';
import basicFragmentSource from '../shader/basic.frag';
import { RENDER_WORLD } from '../scene/systems/RenderExtractionSystem';

const meshPickerMaterial = new ShaderMaterial({
    vs: `#define HILO_PICKING_PASS 1\n${basicVertexSource}`,
    fs: `#define HILO_PICKING_PASS 1\n${basicFragmentSource}`,
    sourceRevision: 'mesh-picker:2',
    state: { cullMode: 'none' }
});

/** Construction parameters for the backend-neutral GPU picker. */
export interface MeshPickerParameters {
    /** Engine whose renderer owns the backend-native picking target. */
    engine: Engine;
    /** World containing the extracted render records. */
    world: World;
    /** Camera Entity used for the object-ID pass. */
    camera: Entity;
}

interface ReadbackRegion {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/**
 * Asynchronous backend-neutral GPU object picker.
 *
 * Selection coordinates are CSS pixels relative to the Engine canvas. Each request renders a
 * dedicated object-ID pass through the active backend and asynchronously reads the requested
 * rgba8unorm texels. No CPU ray-casting fallback is used.
 */
class MeshPicker {
    /** Identifies MeshPicker instances without relying on `instanceof`. */
    readonly isMeshPicker = true;
    /** Runtime class identifier retained for Hilo3d introspection. */
    readonly className = 'MeshPicker';
    readonly world: World;
    readonly camera: Entity;
    /** Active renderer owned by this picker's Engine. */
    readonly renderer: Renderer;
    private renderTarget: RenderTarget | null = null;
    private renderTargetDepthMode: CameraDepthMode | null = null;
    private readonly idEntityMap = new Map<number, Entity>();
    private operation = Promise.resolve();
    private destroyed = false;

    constructor(params: MeshPickerParameters) {
        this.world = params.world;
        this.camera = params.camera;
        this.renderer = params.engine.renderer;
    }

    private hasBeenDestroyed(): boolean {
        return this.destroyed;
    }

    /** Render an object-ID pass and return the unique meshes covered by the requested rectangle. */
    getSelection(x: number, y: number, width = 1, height = 1): Promise<Entity[]> {
        const result = this.operation.then(() => this.select(x, y, width, height));
        this.operation = result.then(
            () => undefined,
            () => undefined
        );
        return result;
    }

    private async select(x: number, y: number, width: number, height: number): Promise<Entity[]> {
        if (this.hasBeenDestroyed()) return [];
        const renderWorld = this.world.getResource(RENDER_WORLD);
        const cameraIndex = this.world.entityIndex(this.camera);
        if (!renderWorld.cameras.has(cameraIndex)) {
            throw new TypeError('MeshPicker camera Entity has no extracted Camera component.');
        }
        const camera = renderWorld.cameras.get(cameraIndex);

        this.validateSelectionRectangle(x, y, width, height);
        const target = this.requireRenderTarget(camera.depthMode);
        const region = this.resolveReadbackRegion(x, y, width, height, target);
        if (!region) return [];
        this.collectMeshIdentities(renderWorld);

        const { renderer } = this;
        const previousForceMaterial = renderer.forceMaterial;
        const previousUseInstanced = renderer.useInstanced;
        try {
            renderer.forceMaterial = meshPickerMaterial;
            renderer.useInstanced = false;
            renderer.renderToTarget(target, renderWorld, camera, false);
        } finally {
            renderer.forceMaterial = previousForceMaterial;
            renderer.useInstanced = previousUseInstanced;
        }

        const readback = await target.readColorAttachment(region);
        if (readback.format !== 'rgba8unorm' || readback.bytesPerPixel !== 4) {
            throw new TypeError('MeshPicker requires a four-byte rgba8unorm render target.');
        }
        const entities = new Set<Entity>();
        for (let offset = 0; offset < readback.data.length; offset += readback.bytesPerPixel) {
            const entity = this.idEntityMap.get(decodeMeshPickingId(readback.data, offset));
            if (entity !== undefined && this.world.isAlive(entity)) entities.add(entity);
        }
        return [...entities];
    }

    private requireRenderTarget(depthMode: CameraDepthMode): RenderTarget {
        const { renderer } = this;
        const width = renderer.width;
        const height = renderer.height;
        if (this.renderTarget !== null && this.renderTargetDepthMode !== depthMode) {
            this.renderTarget.destroy();
            this.renderTarget = null;
        }
        if (!this.renderTarget) {
            this.renderTarget = renderer.createRenderTarget({
                width,
                height,
                colorAttachments: [
                    {
                        format: 'rgba8unorm',
                        clearValue: { r: 0, g: 0, b: 0, a: 0 },
                        loadOp: 'clear',
                        storeOp: 'store',
                        label: 'MeshPicker.objectIds'
                    }
                ],
                depthStencilAttachment: {
                    format: 'depth24plus',
                    depthMode,
                    depthLoadOp: 'clear',
                    depthStoreOp: 'discard'
                },
                sampleCount: 1,
                label: 'MeshPicker'
            });
            this.renderTargetDepthMode = depthMode;
        } else if (this.renderTarget.width !== width || this.renderTarget.height !== height) {
            this.renderTarget.resize(width, height);
        }
        return this.renderTarget;
    }

    private collectMeshIdentities(renderWorld: RenderWorld): void {
        this.idEntityMap.clear();
        for (let denseIndex = 0; denseIndex < renderWorld.length; denseIndex++) {
            const mesh = renderWorld.meshes[denseIndex];
            if (!(mesh instanceof Mesh) || !mesh.visible || !mesh.geometry || !mesh.material)
                continue;
            const entity = renderWorld.entityAt(denseIndex, entityIndex =>
                this.world.entityAt(entityIndex)
            );
            this.idEntityMap.set(getMeshPickingIdentity(mesh).id, entity);
        }
    }

    private resolveReadbackRegion(
        x: number,
        y: number,
        width: number,
        height: number,
        target: RenderTarget
    ): ReadbackRegion | null {
        const pixelRatio = this.renderer.pixelRatio;
        const targetX = Math.floor(x * pixelRatio);
        const targetY = Math.floor(y * pixelRatio);
        if (targetX >= target.width || targetY >= target.height) return null;
        const targetWidth = Math.min(
            Math.max(1, Math.ceil(width * pixelRatio)),
            target.width - targetX
        );
        const targetHeight = Math.min(
            Math.max(1, Math.ceil(height * pixelRatio)),
            target.height - targetY
        );
        return { x: targetX, y: targetY, width: targetWidth, height: targetHeight };
    }

    private validateSelectionRectangle(x: number, y: number, width: number, height: number): void {
        if (![x, y, width, height].every(Number.isFinite)) {
            throw new RangeError('MeshPicker coordinates and dimensions must be finite.');
        }
        if (x < 0 || y < 0 || width <= 0 || height <= 0) {
            throw new RangeError('MeshPicker requires a non-negative origin and positive size.');
        }
    }

    /** Release the private picking target after any in-flight readback completes. */
    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        const target = this.renderTarget;
        this.renderTarget = null;
        this.renderTargetDepthMode = null;
        this.idEntityMap.clear();
        if (target) {
            void this.operation.then(() => {
                target.destroy();
            });
        }
    }
}

export default MeshPicker;
