import type { Entity } from '../../ecs/Entity';
import Mesh from '../../core/Mesh';
import type Geometry from '../../geometry/Geometry';
import type MaterialInstance from '../../material/MaterialInstance';
import type { TransformStore } from '../../scene/components/Transform';
import type {
    MeshRendererValue,
    RenderOrderValue,
    RenderVisibilityValue
} from '../../scene/components/Rendering';
import { RenderCameraStore } from './RenderCameraStore';
import { RenderLightStore } from './RenderLightStore';
import type Fog from '../../core/Fog';
import type { RenderExtension } from '../pipeline/RenderExtension';
import type { NormalizedSpriteRendererValue } from '../../scene/components/TwoD';

const ABSENT_DENSE_INDEX = -1;
const MIN_RENDER_CAPACITY = 16;
const MATRIX_ELEMENT_COUNT = 16;
const BOUNDS_ELEMENT_COUNT = 4;

/** Per-extraction work counters used by performance gates and diagnostics. */
export interface RenderWorldDiagnostics {
    readonly renderObjectCount: number;
    readonly structuralUpdateCount: number;
    readonly transformUpdateCount: number;
    readonly boundsUpdateCount: number;
    readonly componentUpdateCount: number;
    readonly retiredRenderObjectCount: number;
}

function createSparseIndex(capacity: number): Int32Array {
    const values = new Int32Array(capacity);
    values.fill(ABSENT_DENSE_INDEX);
    return values;
}

function growFloat32(source: Float32Array, capacity: number): Float32Array {
    const values = new Float32Array(capacity);
    values.set(source);
    return values;
}

function growFloat64(source: Float64Array, capacity: number): Float64Array {
    const values = new Float64Array(capacity);
    values.set(source);
    return values;
}

function growInt32(source: Int32Array, capacity: number): Int32Array {
    const values = new Int32Array(capacity);
    values.set(source);
    return values;
}

function growUint32(source: Uint32Array, capacity: number): Uint32Array {
    const values = new Uint32Array(capacity);
    values.set(source);
    return values;
}

function growUint8(source: Uint8Array, capacity: number): Uint8Array {
    const values = new Uint8Array(capacity);
    values.set(source);
    return values;
}

/**
 * Renderer-local dense scene database.
 *
 * Entity composition is resolved before this boundary. Render code consumes only these parallel
 * arrays and stable render ids; it never traverses transform hierarchy or component maps.
 */
export class RenderWorld {
    /** Scene fog copied from the Engine-owned render configuration. */
    fog: Fog | null = null;
    /** Optional renderer contributions extracted from explicit ECS components. */
    readonly extensions: RenderExtension[] = [];
    /** Dense renderer-local camera views and output policy. */
    readonly cameras: RenderCameraStore;
    /** Dense renderer-local light views. */
    readonly lights: RenderLightStore;
    private extensionSparse: Int32Array;
    private extensionEntities: Uint32Array;
    private extensionCount = 0;
    private sparse: Int32Array;
    private denseEntities: Uint32Array;
    private renderIds: Uint32Array;
    private geometries: (Geometry | null)[];
    private materials: (MaterialInstance | null)[];
    private meshViews: (Mesh | null)[];
    private retiredMeshViews: (Mesh | null)[];
    private worldMatrices: Float32Array;
    private previousWorldMatrices: Float32Array;
    private worldBounds: Float32Array;
    private worldRevisions: Uint32Array;
    private layers: Uint32Array;
    private instanceCounts: Uint32Array;
    private sortingLayers: Int32Array;
    private zIndices: Int32Array;
    private renderOrders: Float64Array;
    private visible: Uint8Array;
    private useInstanced: Uint8Array;
    private frustumTest: Uint8Array;
    private castShadows: Uint8Array;
    private receiveShadows: Uint8Array;
    private retiredRenderIds: Uint32Array;
    private entryCount = 0;
    private retiredCount = 0;
    private nextRenderId = 1;
    private structuralUpdateCount = 0;
    private transformUpdateCount = 0;
    private boundsUpdateCount = 0;
    private componentUpdateCount = 0;

    constructor(initialEntityCapacity = 0, initialRenderCapacity = initialEntityCapacity) {
        this.cameras = new RenderCameraStore(initialEntityCapacity);
        this.lights = new RenderLightStore(initialEntityCapacity);
        this.extensionSparse = createSparseIndex(initialEntityCapacity);
        this.extensionEntities = new Uint32Array(initialRenderCapacity);
        this.sparse = createSparseIndex(initialEntityCapacity);
        this.denseEntities = new Uint32Array(initialRenderCapacity);
        this.renderIds = new Uint32Array(initialRenderCapacity);
        this.geometries = new Array<Geometry | null>(initialRenderCapacity).fill(null);
        this.materials = new Array<MaterialInstance | null>(initialRenderCapacity).fill(null);
        this.meshViews = new Array<Mesh | null>(initialRenderCapacity).fill(null);
        this.retiredMeshViews = new Array<Mesh | null>(initialRenderCapacity).fill(null);
        this.worldMatrices = new Float32Array(initialRenderCapacity * MATRIX_ELEMENT_COUNT);
        this.previousWorldMatrices = new Float32Array(initialRenderCapacity * MATRIX_ELEMENT_COUNT);
        this.worldBounds = new Float32Array(initialRenderCapacity * BOUNDS_ELEMENT_COUNT);
        this.worldRevisions = new Uint32Array(initialRenderCapacity);
        this.layers = new Uint32Array(initialRenderCapacity);
        this.instanceCounts = new Uint32Array(initialRenderCapacity);
        this.sortingLayers = new Int32Array(initialRenderCapacity);
        this.zIndices = new Int32Array(initialRenderCapacity);
        this.renderOrders = new Float64Array(initialRenderCapacity);
        this.visible = new Uint8Array(initialRenderCapacity);
        this.useInstanced = new Uint8Array(initialRenderCapacity);
        this.frustumTest = new Uint8Array(initialRenderCapacity);
        this.castShadows = new Uint8Array(initialRenderCapacity);
        this.receiveShadows = new Uint8Array(initialRenderCapacity);
        this.retiredRenderIds = new Uint32Array(initialRenderCapacity);
    }

    get length(): number {
        return this.entryCount;
    }

    get entityIndices(): Uint32Array {
        return this.denseEntities;
    }

    get stableRenderIds(): Uint32Array {
        return this.renderIds;
    }

    get geometryData(): readonly (Geometry | null)[] {
        return this.geometries;
    }

    get materialData(): readonly (MaterialInstance | null)[] {
        return this.materials;
    }

    /** Persistent renderer views in dense RenderWorld order. */
    get meshes(): readonly (Mesh | null)[] {
        return this.meshViews;
    }

    get worldMatrixData(): Float32Array {
        return this.worldMatrices;
    }

    get previousWorldMatrixData(): Float32Array {
        return this.previousWorldMatrices;
    }

    /** Packed world-space culling spheres as x, y, z, radius. */
    get worldBoundsData(): Float32Array {
        return this.worldBounds;
    }

    get worldRevisionData(): Uint32Array {
        return this.worldRevisions;
    }

    get layerData(): Uint32Array {
        return this.layers;
    }

    get visibilityData(): Uint8Array {
        return this.visible;
    }

    get renderOrderData(): Float64Array {
        return this.renderOrders;
    }

    get sortingLayerData(): Int32Array {
        return this.sortingLayers;
    }

    get zIndexData(): Int32Array {
        return this.zIndices;
    }

    beginExtraction(): void {
        this.structuralUpdateCount = 0;
        this.transformUpdateCount = 0;
        this.boundsUpdateCount = 0;
        this.componentUpdateCount = 0;
    }

    ensureEntityCapacity(capacity: number): void {
        if (capacity <= this.sparse.length) return;
        const sparse = createSparseIndex(capacity);
        sparse.set(this.sparse);
        this.sparse = sparse;
        this.cameras.ensureEntityCapacity(capacity);
        this.lights.ensureEntityCapacity(capacity);
        const extensionSparse = createSparseIndex(capacity);
        extensionSparse.set(this.extensionSparse);
        this.extensionSparse = extensionSparse;
    }

    has(entityIndex: number): boolean {
        return (
            entityIndex >= 0 &&
            entityIndex < this.sparse.length &&
            this.sparse[entityIndex] !== ABSENT_DENSE_INDEX
        );
    }

    denseIndexOf(entityIndex: number): number {
        if (!this.has(entityIndex)) {
            throw new ReferenceError(
                `Entity index ${String(entityIndex)} is absent from RenderWorld.`
            );
        }
        return this.sparse[entityIndex] ?? ABSENT_DENSE_INDEX;
    }

    /** Resolve one persistent renderer view by Entity index. @internal */
    meshForEntity(entityIndex: number): Mesh | null {
        return this.has(entityIndex)
            ? (this.meshViews[this.denseIndexOf(entityIndex)] ?? null)
            : null;
    }

    add(
        entityIndex: number,
        mesh: MeshRendererValue,
        visibility: RenderVisibilityValue | undefined,
        order: RenderOrderValue | undefined,
        transforms: TransformStore,
        sprite?: NormalizedSpriteRendererValue
    ): void {
        this.ensureEntityCapacity(entityIndex + 1);
        if (this.has(entityIndex)) {
            this.updateMesh(entityIndex, mesh);
            this.updateVisibility(entityIndex, visibility);
            this.updateOrder(entityIndex, order);
            if (sprite) this.updateSprite(entityIndex, sprite);
            this.updateTransform(entityIndex, transforms);
            return;
        }
        if (this.nextRenderId > 0xffffffff) {
            throw new RangeError('RenderWorld exhausted its stable render-object id space.');
        }
        this.ensureDenseCapacity(this.entryCount + 1);
        const denseIndex = this.entryCount;
        this.entryCount++;
        this.sparse[entityIndex] = denseIndex;
        this.denseEntities[denseIndex] = entityIndex;
        this.renderIds[denseIndex] = this.nextRenderId;
        this.nextRenderId++;
        const meshView = new Mesh();
        this.meshViews[denseIndex] = meshView;
        this.writeMesh(denseIndex, mesh);
        if (sprite) this.writeSprite(denseIndex, sprite);
        this.writeVisibility(denseIndex, visibility);
        this.writeOrder(denseIndex, order);
        this.copyTransform(denseIndex, entityIndex, transforms);
        this.structuralUpdateCount++;
    }

    remove(entityIndex: number): boolean {
        if (!this.has(entityIndex)) return false;
        const denseIndex = this.sparse[entityIndex] ?? ABSENT_DENSE_INDEX;
        const lastDenseIndex = this.entryCount - 1;
        this.ensureRetiredCapacity(this.retiredCount + 1);
        this.retiredRenderIds[this.retiredCount] = this.renderIds[denseIndex] ?? 0;
        this.retiredMeshViews[this.retiredCount] = this.meshViews[denseIndex] ?? null;
        this.retiredCount++;
        if (denseIndex !== lastDenseIndex) this.moveDenseRow(lastDenseIndex, denseIndex);
        this.sparse[entityIndex] = ABSENT_DENSE_INDEX;
        this.clearDenseRow(lastDenseIndex);
        this.entryCount--;
        this.structuralUpdateCount++;
        return true;
    }

    updateTransform(entityIndex: number, transforms: TransformStore): void {
        if (!transforms.has(entityIndex)) return;
        let updated = false;
        if (this.has(entityIndex)) {
            this.copyTransform(this.denseIndexOf(entityIndex), entityIndex, transforms);
            updated = true;
        }
        if (this.cameras.has(entityIndex)) {
            this.cameras.updateTransform(entityIndex, transforms);
            updated = true;
        }
        if (this.lights.has(entityIndex)) {
            this.lights.updateTransform(entityIndex, transforms);
            updated = true;
        }
        const extensionDenseIndex = this.extensionSparse[entityIndex] ?? ABSENT_DENSE_INDEX;
        if (extensionDenseIndex !== ABSENT_DENSE_INDEX) {
            const extension = this.extensions[extensionDenseIndex];
            if (extension?.setWorldTransform) {
                const transformDenseIndex = transforms.denseIndexOf(entityIndex);
                extension.setWorldTransform(
                    transforms.worldMatrixData,
                    transformDenseIndex * MATRIX_ELEMENT_COUNT,
                    transforms.worldRevisionOf(entityIndex)
                );
                updated = true;
            }
        }
        if (updated) this.transformUpdateCount++;
    }

    updateMesh(entityIndex: number, mesh: MeshRendererValue): void {
        if (!this.has(entityIndex)) return;
        this.writeMesh(this.denseIndexOf(entityIndex), mesh);
        this.componentUpdateCount++;
    }

    updateSprite(entityIndex: number, sprite: NormalizedSpriteRendererValue): void {
        if (!this.has(entityIndex)) return;
        const denseIndex = this.denseIndexOf(entityIndex);
        this.writeMesh(denseIndex, {
            geometry: sprite.geometry,
            material: sprite.material,
            useInstanced: true,
            frustumTest: false,
            castShadows: false,
            receiveShadows: false
        });
        this.writeSprite(denseIndex, sprite);
        this.componentUpdateCount++;
    }

    /** Update one extracted morph pose without touching shared Geometry state. */
    updateMorph(entityIndex: number, weights: Float32Array | null): void {
        const mesh = this.meshForEntity(entityIndex);
        if (!mesh) return;
        if (weights === null) mesh.morphWeights = null;
        else if (mesh.morphWeights?.length === weights.length) mesh.morphWeights.set(weights);
        else mesh.morphWeights = weights.slice();
        this.componentUpdateCount++;
    }

    /** Update one extracted skin palette whose matrices are already in mesh-local space. */
    updateSkin(entityIndex: number, matrices: Float32Array | null): void {
        const mesh = this.meshForEntity(entityIndex);
        if (!mesh) return;
        if (matrices === null) {
            mesh.jointMatrices = null;
            mesh.isSkinnedMesh = false;
        } else {
            if (mesh.jointMatrices?.length === matrices.length) mesh.jointMatrices.set(matrices);
            else mesh.jointMatrices = matrices.slice();
            mesh.isSkinnedMesh = true;
            mesh.useInstanced = false;
            mesh.frustumTest = false;
        }
        this.componentUpdateCount++;
    }

    updateVisibility(entityIndex: number, visibility: RenderVisibilityValue | undefined): void {
        if (!this.has(entityIndex)) return;
        this.writeVisibility(this.denseIndexOf(entityIndex), visibility);
        this.componentUpdateCount++;
    }

    updateOrder(entityIndex: number, order: RenderOrderValue | undefined): void {
        if (!this.has(entityIndex)) return;
        this.writeOrder(this.denseIndexOf(entityIndex), order);
        this.componentUpdateCount++;
    }

    /** Insert or replace one explicitly extracted renderer extension. */
    synchronizeExtension(entityIndex: number, extension: RenderExtension | undefined): void {
        this.ensureEntityCapacity(entityIndex + 1);
        const denseIndex = this.extensionSparse[entityIndex] ?? ABSENT_DENSE_INDEX;
        if (extension === undefined) {
            if (denseIndex === ABSENT_DENSE_INDEX) return;
            const last = this.extensionCount - 1;
            const removedExtension = this.extensions[denseIndex];
            if (removedExtension?.meshes) {
                for (const mesh of removedExtension.meshes) {
                    this.ensureRetiredCapacity(this.retiredCount + 1);
                    this.retiredRenderIds[this.retiredCount] = 0;
                    this.retiredMeshViews[this.retiredCount] = mesh;
                    this.retiredCount++;
                }
            }
            if (denseIndex !== last) {
                const movedEntity = this.extensionEntities[last] ?? 0;
                const movedExtension = this.extensions[last];
                if (!movedExtension) throw new Error('Render extension dense row is missing.');
                this.extensionEntities[denseIndex] = movedEntity;
                this.extensions[denseIndex] = movedExtension;
                this.extensionSparse[movedEntity] = denseIndex;
            }
            this.extensionSparse[entityIndex] = ABSENT_DENSE_INDEX;
            this.extensionEntities[last] = 0;
            this.extensions.pop();
            this.extensionCount--;
            return;
        }
        if (denseIndex !== ABSENT_DENSE_INDEX) {
            this.extensions[denseIndex] = extension;
            return;
        }
        if (this.extensionCount >= this.extensionEntities.length) {
            this.extensionEntities = growUint32(
                this.extensionEntities,
                Math.max(MIN_RENDER_CAPACITY, this.extensionEntities.length * 2)
            );
        }
        this.extensionSparse[entityIndex] = this.extensionCount;
        this.extensionEntities[this.extensionCount] = entityIndex;
        this.extensions.push(extension);
        this.extensionCount++;
    }

    /** Stable ids awaiting renderer cache retirement at the next submission boundary. */
    getRetiredRenderIds(): Uint32Array {
        return this.retiredRenderIds;
    }

    get retiredRenderIdCount(): number {
        return this.retiredCount;
    }

    /** Persistent mesh views awaiting renderer cache retirement. */
    getRetiredMeshes(): readonly (Mesh | null)[] {
        return this.retiredMeshViews;
    }

    /** Acknowledge renderer cache retirement after submission ownership was recorded. */
    clearRetiredRenderIds(): void {
        this.retiredRenderIds.fill(0, 0, this.retiredCount);
        this.retiredMeshViews.fill(null, 0, this.retiredCount);
        this.retiredCount = 0;
    }

    getDiagnostics(): RenderWorldDiagnostics {
        return {
            renderObjectCount: this.entryCount,
            structuralUpdateCount: this.structuralUpdateCount,
            transformUpdateCount: this.transformUpdateCount,
            boundsUpdateCount: this.boundsUpdateCount,
            componentUpdateCount: this.componentUpdateCount,
            retiredRenderObjectCount: this.retiredCount
        };
    }

    clear(): void {
        this.sparse.fill(ABSENT_DENSE_INDEX);
        for (let index = 0; index < this.entryCount; index++) this.clearDenseRow(index);
        this.entryCount = 0;
        this.retiredCount = 0;
        this.retiredMeshViews.fill(null);
        this.extensionSparse.fill(ABSENT_DENSE_INDEX);
        this.extensionEntities.fill(0);
        this.extensions.length = 0;
        this.extensionCount = 0;
        this.cameras.clear();
        this.lights.clear();
    }

    /** Resolve a generation-safe Entity handle for diagnostics and picking. */
    entityAt(denseIndex: number, resolve: (entityIndex: number) => Entity): Entity {
        if (denseIndex < 0 || denseIndex >= this.entryCount) {
            throw new RangeError(`RenderWorld dense index ${String(denseIndex)} is out of range.`);
        }
        return resolve(this.denseEntities[denseIndex] ?? 0);
    }

    private writeMesh(denseIndex: number, mesh: MeshRendererValue): void {
        this.geometries[denseIndex] = mesh.geometry;
        this.materials[denseIndex] = mesh.material;
        const meshView = this.requireMeshView(denseIndex);
        meshView.geometry = mesh.geometry;
        meshView.material = mesh.material;
        meshView.useInstanced = mesh.useInstanced ?? false;
        meshView.frustumTest = mesh.frustumTest ?? true;
        meshView.castShadows = mesh.castShadows ?? true;
        meshView.receiveShadows = mesh.receiveShadows ?? true;
        meshView.instanceCount = mesh.instanceCount ?? 1;
        meshView.isSprite = false;
        meshView.spriteUVRect = null;
        meshView.spriteSizeAnchor = null;
        meshView.spriteTint = null;
        this.useInstanced[denseIndex] = mesh.useInstanced === true ? 1 : 0;
        this.frustumTest[denseIndex] = mesh.frustumTest === false ? 0 : 1;
        this.castShadows[denseIndex] = mesh.castShadows === false ? 0 : 1;
        this.receiveShadows[denseIndex] = mesh.receiveShadows === false ? 0 : 1;
        this.instanceCounts[denseIndex] = mesh.instanceCount ?? 1;
        this.updateBounds(denseIndex);
    }

    private writeSprite(denseIndex: number, sprite: NormalizedSpriteRendererValue): void {
        const meshView = this.requireMeshView(denseIndex);
        meshView.isSprite = true;
        meshView.spriteUVRect = sprite.uvRect;
        meshView.spriteSizeAnchor = sprite.sizeAnchor;
        meshView.spriteTint = sprite.tint;
    }

    private writeVisibility(
        denseIndex: number,
        visibility: RenderVisibilityValue | undefined
    ): void {
        this.visible[denseIndex] = visibility?.visible === false ? 0 : 1;
        this.layers[denseIndex] = visibility?.layer ?? 1;
        const meshView = this.requireMeshView(denseIndex);
        meshView.visible = visibility?.visible ?? true;
        meshView.layer = visibility?.layer ?? 1;
    }

    private writeOrder(denseIndex: number, order: RenderOrderValue | undefined): void {
        this.renderOrders[denseIndex] = order?.renderOrder ?? 0;
        this.sortingLayers[denseIndex] = order?.sortingLayer ?? 0;
        this.zIndices[denseIndex] = order?.zIndex ?? 0;
        const meshView = this.requireMeshView(denseIndex);
        meshView.renderOrder = order?.renderOrder ?? 0;
        meshView.sortingLayer = order?.sortingLayer ?? 0;
        meshView.zIndex = order?.zIndex ?? 0;
    }

    private copyTransform(
        denseIndex: number,
        entityIndex: number,
        transforms: TransformStore
    ): void {
        const matrixOffset = denseIndex * MATRIX_ELEMENT_COUNT;
        transforms.copyWorldMatrix(entityIndex, this.worldMatrices, matrixOffset);
        transforms.copyPreviousWorldMatrix(entityIndex, this.previousWorldMatrices, matrixOffset);
        this.worldRevisions[denseIndex] = transforms.worldRevisionOf(entityIndex);
        const meshView = this.requireMeshView(denseIndex);
        meshView.worldMatrix.fromArray(this.worldMatrices, matrixOffset);
        meshView.worldMatrixVersion = this.worldRevisions[denseIndex] ?? 0;
        this.updateBounds(denseIndex);
    }

    private updateBounds(denseIndex: number): void {
        const geometry = this.geometries[denseIndex];
        const meshView = this.meshViews[denseIndex];
        if (!geometry || !meshView) return;
        const local = geometry.getLocalSphereBounds();
        const matrixOffset = denseIndex * MATRIX_ELEMENT_COUNT;
        const boundsOffset = denseIndex * BOUNDS_ELEMENT_COUNT;
        const values = this.worldMatrices;
        const x = local.center.x;
        const y = local.center.y;
        const z = local.center.z;
        const centerX =
            (values[matrixOffset] ?? 0) * x +
            (values[matrixOffset + 4] ?? 0) * y +
            (values[matrixOffset + 8] ?? 0) * z +
            (values[matrixOffset + 12] ?? 0);
        const centerY =
            (values[matrixOffset + 1] ?? 0) * x +
            (values[matrixOffset + 5] ?? 0) * y +
            (values[matrixOffset + 9] ?? 0) * z +
            (values[matrixOffset + 13] ?? 0);
        const centerZ =
            (values[matrixOffset + 2] ?? 0) * x +
            (values[matrixOffset + 6] ?? 0) * y +
            (values[matrixOffset + 10] ?? 0) * z +
            (values[matrixOffset + 14] ?? 0);
        const scaleX = Math.hypot(
            values[matrixOffset] ?? 0,
            values[matrixOffset + 1] ?? 0,
            values[matrixOffset + 2] ?? 0
        );
        const scaleY = Math.hypot(
            values[matrixOffset + 4] ?? 0,
            values[matrixOffset + 5] ?? 0,
            values[matrixOffset + 6] ?? 0
        );
        const scaleZ = Math.hypot(
            values[matrixOffset + 8] ?? 0,
            values[matrixOffset + 9] ?? 0,
            values[matrixOffset + 10] ?? 0
        );
        const radius = local.radius * Math.max(scaleX, scaleY, scaleZ);
        this.worldBounds[boundsOffset] = centerX;
        this.worldBounds[boundsOffset + 1] = centerY;
        this.worldBounds[boundsOffset + 2] = centerZ;
        this.worldBounds[boundsOffset + 3] = radius;
        meshView.worldBounds.center.set(centerX, centerY, centerZ);
        meshView.worldBounds.radius = radius;
        this.boundsUpdateCount++;
    }

    private moveDenseRow(sourceDenseIndex: number, targetDenseIndex: number): void {
        const entityIndex = this.denseEntities[sourceDenseIndex] ?? 0;
        this.denseEntities[targetDenseIndex] = entityIndex;
        this.sparse[entityIndex] = targetDenseIndex;
        this.renderIds[targetDenseIndex] = this.renderIds[sourceDenseIndex] ?? 0;
        this.geometries[targetDenseIndex] = this.geometries[sourceDenseIndex] ?? null;
        this.materials[targetDenseIndex] = this.materials[sourceDenseIndex] ?? null;
        this.meshViews[targetDenseIndex] = this.meshViews[sourceDenseIndex] ?? null;
        this.worldRevisions[targetDenseIndex] = this.worldRevisions[sourceDenseIndex] ?? 0;
        this.layers[targetDenseIndex] = this.layers[sourceDenseIndex] ?? 0;
        this.instanceCounts[targetDenseIndex] = this.instanceCounts[sourceDenseIndex] ?? 0;
        this.sortingLayers[targetDenseIndex] = this.sortingLayers[sourceDenseIndex] ?? 0;
        this.zIndices[targetDenseIndex] = this.zIndices[sourceDenseIndex] ?? 0;
        this.renderOrders[targetDenseIndex] = this.renderOrders[sourceDenseIndex] ?? 0;
        this.visible[targetDenseIndex] = this.visible[sourceDenseIndex] ?? 0;
        this.useInstanced[targetDenseIndex] = this.useInstanced[sourceDenseIndex] ?? 0;
        this.frustumTest[targetDenseIndex] = this.frustumTest[sourceDenseIndex] ?? 0;
        this.castShadows[targetDenseIndex] = this.castShadows[sourceDenseIndex] ?? 0;
        this.receiveShadows[targetDenseIndex] = this.receiveShadows[sourceDenseIndex] ?? 0;
        for (let index = 0; index < MATRIX_ELEMENT_COUNT; index++) {
            this.worldMatrices[targetDenseIndex * MATRIX_ELEMENT_COUNT + index] =
                this.worldMatrices[sourceDenseIndex * MATRIX_ELEMENT_COUNT + index] ?? 0;
            this.previousWorldMatrices[targetDenseIndex * MATRIX_ELEMENT_COUNT + index] =
                this.previousWorldMatrices[sourceDenseIndex * MATRIX_ELEMENT_COUNT + index] ?? 0;
        }
        for (let index = 0; index < BOUNDS_ELEMENT_COUNT; index++) {
            this.worldBounds[targetDenseIndex * BOUNDS_ELEMENT_COUNT + index] =
                this.worldBounds[sourceDenseIndex * BOUNDS_ELEMENT_COUNT + index] ?? 0;
        }
    }

    private clearDenseRow(denseIndex: number): void {
        this.denseEntities[denseIndex] = 0;
        this.renderIds[denseIndex] = 0;
        this.geometries[denseIndex] = null;
        this.materials[denseIndex] = null;
        this.meshViews[denseIndex] = null;
        this.worldRevisions[denseIndex] = 0;
        this.layers[denseIndex] = 0;
        this.instanceCounts[denseIndex] = 0;
        this.sortingLayers[denseIndex] = 0;
        this.zIndices[denseIndex] = 0;
        this.renderOrders[denseIndex] = 0;
        this.visible[denseIndex] = 0;
        this.useInstanced[denseIndex] = 0;
        this.frustumTest[denseIndex] = 0;
        this.castShadows[denseIndex] = 0;
        this.receiveShadows[denseIndex] = 0;
        this.worldBounds.fill(
            0,
            denseIndex * BOUNDS_ELEMENT_COUNT,
            (denseIndex + 1) * BOUNDS_ELEMENT_COUNT
        );
    }

    private ensureDenseCapacity(required: number): void {
        if (required <= this.denseEntities.length) return;
        let capacity = Math.max(this.denseEntities.length, MIN_RENDER_CAPACITY);
        while (capacity < required) capacity *= 2;
        this.denseEntities = growUint32(this.denseEntities, capacity);
        this.renderIds = growUint32(this.renderIds, capacity);
        this.geometries.length = capacity;
        this.materials.length = capacity;
        this.meshViews.length = capacity;
        this.worldMatrices = growFloat32(this.worldMatrices, capacity * MATRIX_ELEMENT_COUNT);
        this.previousWorldMatrices = growFloat32(
            this.previousWorldMatrices,
            capacity * MATRIX_ELEMENT_COUNT
        );
        this.worldBounds = growFloat32(this.worldBounds, capacity * BOUNDS_ELEMENT_COUNT);
        this.worldRevisions = growUint32(this.worldRevisions, capacity);
        this.layers = growUint32(this.layers, capacity);
        this.instanceCounts = growUint32(this.instanceCounts, capacity);
        this.sortingLayers = growInt32(this.sortingLayers, capacity);
        this.zIndices = growInt32(this.zIndices, capacity);
        this.renderOrders = growFloat64(this.renderOrders, capacity);
        this.visible = growUint8(this.visible, capacity);
        this.useInstanced = growUint8(this.useInstanced, capacity);
        this.frustumTest = growUint8(this.frustumTest, capacity);
        this.castShadows = growUint8(this.castShadows, capacity);
        this.receiveShadows = growUint8(this.receiveShadows, capacity);
    }

    private ensureRetiredCapacity(required: number): void {
        if (required <= this.retiredRenderIds.length) return;
        let capacity = Math.max(this.retiredRenderIds.length, MIN_RENDER_CAPACITY);
        while (capacity < required) capacity *= 2;
        this.retiredRenderIds = growUint32(this.retiredRenderIds, capacity);
        this.retiredMeshViews.length = capacity;
    }

    private requireMeshView(denseIndex: number): Mesh {
        const mesh = this.meshViews[denseIndex];
        if (!mesh) throw new Error(`RenderWorld mesh view ${String(denseIndex)} is missing.`);
        return mesh;
    }
}
