import Mesh from '../core/Mesh';
import Node from '../core/Node';
import type Stage from '../core/Stage';
import BasicMaterial from '../material/BasicMaterial';
import type { Renderer, RendererBackend } from '../renderer/common/Renderer';
import type { RenderTarget } from '../renderer/common/RenderTarget';
import { decodeMeshPickingId, getMeshPickingIdentity } from '../renderer/common/PickingIdentity';
import type { ShaderOptions } from '../renderer/common/types';

class MeshPickerMaterial extends BasicMaterial {
    constructor() {
        super();
        this.lightType = 'NONE';
        this.initializeBasicMaterialBindings();
    }

    override getRenderOption(option: ShaderOptions = {}): ShaderOptions {
        super.getRenderOption(option);
        option['PICKING_PASS'] = 1;
        return option;
    }
}

const meshPickerMaterial = new MeshPickerMaterial();

/** Construction parameters for the backend-neutral GPU picker. */
export interface MeshPickerParameters {
    /** Stage whose visible meshes are rendered into the backend-native picking target. */
    stage: Stage<RendererBackend>;
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
 * Selection coordinates are CSS pixels relative to the Stage canvas. Each request renders a
 * dedicated object-ID pass through the active backend and asynchronously reads the requested
 * rgba8unorm texels. No CPU ray-casting fallback is used.
 */
class MeshPicker {
    /** Identifies MeshPicker instances without relying on `instanceof`. */
    readonly isMeshPicker = true;
    /** Runtime class identifier retained for Hilo3d introspection. */
    readonly className = 'MeshPicker';
    /** Stage rendered by the object-ID pass. */
    readonly stage: Stage<RendererBackend>;
    /** Active renderer owned by this picker's Stage. */
    readonly renderer: Renderer;
    private renderTarget: RenderTarget | null = null;
    private readonly idMeshMap = new Map<number, Mesh>();
    private operation = Promise.resolve();
    private destroyed = false;

    constructor(params: MeshPickerParameters) {
        this.stage = params.stage;
        this.renderer = params.stage.renderer;
    }

    private hasBeenDestroyed(): boolean {
        return this.destroyed;
    }

    /** Render an object-ID pass and return the unique meshes covered by the requested rectangle. */
    getSelection(x: number, y: number, width = 1, height = 1): Promise<Mesh[]> {
        const result = this.operation.then(() => this.select(x, y, width, height));
        this.operation = result.then(
            () => undefined,
            () => undefined
        );
        return result;
    }

    private async select(x: number, y: number, width: number, height: number): Promise<Mesh[]> {
        if (this.hasBeenDestroyed()) return [];
        await this.stage.ready;
        if (this.hasBeenDestroyed()) return [];
        const camera = this.stage.camera;
        if (!camera) throw new Error('MeshPicker requires its Stage to have an active camera.');

        this.validateSelectionRectangle(x, y, width, height);
        const target = this.requireRenderTarget();
        const region = this.resolveReadbackRegion(x, y, width, height, target);
        if (!region) return [];
        this.collectMeshIdentities();

        const { renderer } = this;
        const previousForceMaterial = renderer.forceMaterial;
        const previousUseInstanced = renderer.useInstanced;
        try {
            renderer.forceMaterial = meshPickerMaterial;
            renderer.useInstanced = false;
            renderer.renderToTarget(target, this.stage, camera, false);
        } finally {
            renderer.forceMaterial = previousForceMaterial;
            renderer.useInstanced = previousUseInstanced;
        }

        const readback = await target.readColorAttachment(region);
        if (readback.format !== 'rgba8unorm' || readback.bytesPerPixel !== 4) {
            throw new TypeError('MeshPicker requires a four-byte rgba8unorm render target.');
        }
        const meshes = new Set<Mesh>();
        for (let offset = 0; offset < readback.data.length; offset += readback.bytesPerPixel) {
            const mesh = this.idMeshMap.get(decodeMeshPickingId(readback.data, offset));
            if (mesh) meshes.add(mesh);
        }
        return [...meshes];
    }

    private requireRenderTarget(): RenderTarget {
        const { renderer } = this;
        const width = renderer.width;
        const height = renderer.height;
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
                    depthClearValue: 1,
                    depthLoadOp: 'clear',
                    depthStoreOp: 'discard'
                },
                sampleCount: 1,
                label: 'MeshPicker'
            });
        } else if (this.renderTarget.width !== width || this.renderTarget.height !== height) {
            this.renderTarget.resize(width, height);
        }
        return this.renderTarget;
    }

    private collectMeshIdentities(): void {
        this.idMeshMap.clear();
        this.stage.traverse(node => {
            if (!node.visible) return Node.TRAVERSE_STOP_CHILDREN;
            if (node instanceof Mesh && node.geometry && node.material) {
                const identity = getMeshPickingIdentity(node);
                this.idMeshMap.set(identity.id, node);
            }
            return Node.TRAVERSE_STOP_NONE;
        });
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
        this.idMeshMap.clear();
        if (target) {
            void this.operation.then(() => {
                target.destroy();
            });
        }
    }
}

export default MeshPicker;
