import { defineComponent, SparseSetComponentStore } from '../../ecs/Component';
import Geometry from '../../geometry/Geometry';
import MaterialInstance from '../../material/MaterialInstance';
import type { CameraDepthMode } from '../../camera/Camera';
import type { RenderExtension } from '../../render/pipeline/RenderExtension';

/** Geometry/material and draw-policy data composable with any Entity components. */
export interface MeshRendererValue {
    readonly geometry: Geometry;
    readonly material: MaterialInstance;
    readonly useInstanced?: boolean;
    readonly frustumTest?: boolean;
    readonly castShadows?: boolean;
    readonly receiveShadows?: boolean;
    readonly instanceCount?: number;
}

/** Camera and renderer visibility are independent from transform hierarchy. */
export interface RenderVisibilityValue {
    readonly visible?: boolean;
    readonly layer?: number;
}

/** Explicit render ordering independent from hierarchy insertion order. */
export interface RenderOrderValue {
    readonly renderOrder?: number;
    readonly sortingLayer?: number;
    readonly zIndex?: number;
}

/** Fields shared by perspective and orthographic camera components. */
export interface CameraComponentValue {
    readonly depthMode?: CameraDepthMode;
    readonly visibility?: number;
    readonly clearColor?: boolean;
    readonly clearDepth?: boolean;
    readonly clearStencil?: boolean;
    readonly priority?: number;
}

/** Perspective projection authored directly on a camera Entity. */
export interface PerspectiveCameraValue extends CameraComponentValue {
    readonly fov?: number;
    readonly near?: number;
    readonly far?: number | null;
    readonly aspect?: number;
}

/** Orthographic projection authored directly on a camera Entity. */
export interface OrthographicCameraValue extends CameraComponentValue {
    readonly left?: number;
    readonly right?: number;
    readonly top?: number;
    readonly bottom?: number;
    readonly near?: number;
    readonly far?: number;
}

/** Camera output policy. Null renders to the active canvas surface. */
export interface CameraOutputValue {
    readonly enabled?: boolean;
}

/** Explicit renderer extension attached to an Entity and copied into RenderWorld. */
export interface RenderExtensionValue {
    readonly extension: RenderExtension;
}

/** Snapshotting sparse store with one allocation-stable dirty queue for render extraction. */
export class ChangedComponentStore<T> extends SparseSetComponentStore<T> {
    private changed: Uint8Array;
    private changedEntities: Uint32Array;
    private changedCount = 0;

    constructor(
        initialCapacity: number,
        private readonly normalize: (value: T) => T
    ) {
        super(initialCapacity);
        this.changed = new Uint8Array(initialCapacity);
        this.changedEntities = new Uint32Array(initialCapacity);
    }

    get changedEntityIndices(): Uint32Array {
        return this.changedEntities;
    }

    get changedEntityCount(): number {
        return this.changedCount;
    }

    override ensureEntityCapacity(capacity: number): void {
        const previousCapacity = this.entityCapacity;
        super.ensureEntityCapacity(capacity);
        if (capacity <= previousCapacity) return;
        const changed = new Uint8Array(capacity);
        changed.set(this.changed);
        this.changed = changed;
        const changedEntities = new Uint32Array(capacity);
        changedEntities.set(this.changedEntities);
        this.changedEntities = changedEntities;
    }

    override validate(value: T): void {
        this.normalize(value);
    }

    override add(entityIndex: number, value: T): void {
        super.add(entityIndex, this.normalize(value));
        this.markChanged(entityIndex);
    }

    override set(entityIndex: number, value: T): void {
        super.set(entityIndex, this.normalize(value));
        this.markChanged(entityIndex);
    }

    override remove(entityIndex: number): boolean {
        const removed = super.remove(entityIndex);
        if (removed) this.markChanged(entityIndex);
        return removed;
    }

    override clear(): void {
        super.clear();
        this.changed.fill(0);
        this.changedCount = 0;
    }

    clearChangedEntities(): void {
        for (let index = 0; index < this.changedCount; index++) {
            const entityIndex = this.changedEntities[index] ?? 0;
            this.changed[entityIndex] = 0;
        }
        this.changedCount = 0;
    }

    /** Mark an in-place payload mutation for incremental extraction. */
    markChangedEntity(entityIndex: number): void {
        if (!this.has(entityIndex)) {
            throw new ReferenceError(`Entity index ${String(entityIndex)} has no component value.`);
        }
        this.markChanged(entityIndex);
    }

    private markChanged(entityIndex: number): void {
        if (this.changed[entityIndex] === 1) return;
        this.changed[entityIndex] = 1;
        this.changedEntities[this.changedCount] = entityIndex;
        this.changedCount++;
    }
}

function unsignedMask(value: number | undefined, fallback: number, label: string): number {
    const resolved = value ?? fallback;
    if (!Number.isSafeInteger(resolved) || resolved < 0 || resolved > 0xffffffff) {
        throw new RangeError(`${label} must be an unsigned 32-bit integer.`);
    }
    return resolved >>> 0;
}

function finite(value: number | undefined, fallback: number, label: string): number {
    const resolved = value ?? fallback;
    if (!Number.isFinite(resolved)) throw new RangeError(`${label} must be finite.`);
    return resolved;
}

function safeInteger(value: number | undefined, fallback: number, label: string): number {
    const resolved = value ?? fallback;
    if (!Number.isSafeInteger(resolved)) throw new RangeError(`${label} must be a safe integer.`);
    return resolved;
}

function positive(value: number | undefined, fallback: number, label: string): number {
    const resolved = finite(value, fallback, label);
    if (resolved <= 0) throw new RangeError(`${label} must be positive.`);
    return resolved;
}

function cameraFields(value: CameraComponentValue): Required<CameraComponentValue> {
    const depthMode: unknown = value.depthMode ?? 'standard';
    if (depthMode !== 'standard' && depthMode !== 'reversed') {
        throw new TypeError('Camera depthMode must be "standard" or "reversed".');
    }
    return {
        depthMode,
        visibility: unsignedMask(value.visibility, 0xffffffff, 'Camera visibility'),
        clearColor: value.clearColor ?? true,
        clearDepth: value.clearDepth ?? true,
        clearStencil: value.clearStencil ?? true,
        priority: finite(value.priority, 0, 'Camera priority')
    };
}

function normalizeMeshRenderer(value: MeshRendererValue): MeshRendererValue {
    if (!(value.geometry instanceof Geometry)) {
        throw new TypeError('MeshRenderer geometry must be a Geometry.');
    }
    if (!(value.material instanceof MaterialInstance)) {
        throw new TypeError('MeshRenderer material must be a MaterialInstance.');
    }
    const instanceCount = value.instanceCount ?? 1;
    if (!Number.isSafeInteger(instanceCount) || instanceCount < 1) {
        throw new RangeError('MeshRenderer instanceCount must be a positive safe integer.');
    }
    return Object.freeze({
        geometry: value.geometry,
        material: value.material,
        useInstanced: value.useInstanced ?? false,
        frustumTest: value.frustumTest ?? true,
        castShadows: value.castShadows ?? true,
        receiveShadows: value.receiveShadows ?? true,
        instanceCount
    });
}

function normalizeVisibility(value: RenderVisibilityValue): RenderVisibilityValue {
    return Object.freeze({
        visible: value.visible ?? true,
        layer: unsignedMask(value.layer, 1, 'RenderVisibility layer')
    });
}

function normalizeOrder(value: RenderOrderValue): RenderOrderValue {
    return Object.freeze({
        renderOrder: finite(value.renderOrder, 0, 'RenderOrder renderOrder'),
        sortingLayer: safeInteger(value.sortingLayer, 0, 'RenderOrder sortingLayer'),
        zIndex: safeInteger(value.zIndex, 0, 'RenderOrder zIndex')
    });
}

function normalizeRenderExtension(value: RenderExtensionValue): RenderExtensionValue {
    return Object.freeze({ extension: value.extension });
}

function normalizePerspective(value: PerspectiveCameraValue): PerspectiveCameraValue {
    const near = positive(value.near, 0.1, 'PerspectiveCamera near');
    const far = value.far ?? null;
    if (far !== null && (!Number.isFinite(far) || far <= near)) {
        throw new RangeError('PerspectiveCamera far must be null or greater than near.');
    }
    const fov = finite(value.fov, 50, 'PerspectiveCamera fov');
    if (fov <= 0 || fov >= 180) {
        throw new RangeError('PerspectiveCamera fov must be between zero and 180 degrees.');
    }
    return Object.freeze({
        ...cameraFields(value),
        fov,
        near,
        far,
        aspect: positive(value.aspect, 1, 'PerspectiveCamera aspect')
    });
}

function normalizeOrthographic(value: OrthographicCameraValue): OrthographicCameraValue {
    const near = finite(value.near, 0.1, 'OrthographicCamera near');
    const far = finite(value.far, 1000, 'OrthographicCamera far');
    if (near === far) throw new RangeError('OrthographicCamera near and far must differ.');
    const left = finite(value.left, -1, 'OrthographicCamera left');
    const right = finite(value.right, 1, 'OrthographicCamera right');
    const top = finite(value.top, 1, 'OrthographicCamera top');
    const bottom = finite(value.bottom, -1, 'OrthographicCamera bottom');
    if (left === right || top === bottom) {
        throw new RangeError('OrthographicCamera projection extents must have non-zero size.');
    }
    return Object.freeze({
        ...cameraFields(value),
        left,
        right,
        top,
        bottom,
        near,
        far
    });
}

/** Mesh draw data. Combine with LocalTransform on the same Entity. */
export const MeshRenderer = defineComponent<MeshRendererValue>(
    'hilo3d/mesh-renderer',
    initialCapacity => new ChangedComponentStore(initialCapacity, normalizeMeshRenderer)
);

/** Per-Entity renderer visibility and camera layer mask. */
export const RenderVisibility = defineComponent<RenderVisibilityValue>(
    'hilo3d/render-visibility',
    initialCapacity => new ChangedComponentStore(initialCapacity, normalizeVisibility)
);

/** Per-Entity draw ordering. */
export const RenderOrder = defineComponent<RenderOrderValue>(
    'hilo3d/render-order',
    initialCapacity => new ChangedComponentStore(initialCapacity, normalizeOrder)
);

/** Renderer extension contribution; no symbol lookup or scene-object traversal is performed. */
export const RenderExtensionComponent = defineComponent<RenderExtensionValue>(
    'hilo3d/render-extension',
    initialCapacity => new ChangedComponentStore(initialCapacity, normalizeRenderExtension)
);

/** Perspective camera projection component. */
export const PerspectiveCamera = defineComponent<PerspectiveCameraValue>(
    'hilo3d/perspective-camera',
    initialCapacity => new ChangedComponentStore(initialCapacity, normalizePerspective)
);

/** Orthographic camera projection component. */
export const OrthographicCamera = defineComponent<OrthographicCameraValue>(
    'hilo3d/orthographic-camera',
    initialCapacity => new ChangedComponentStore(initialCapacity, normalizeOrthographic)
);

/** Marks a camera for Engine composition. */
export const CameraOutput = defineComponent<CameraOutputValue>(
    'hilo3d/camera-output',
    initialCapacity =>
        new ChangedComponentStore(initialCapacity, value =>
            Object.freeze({ enabled: value.enabled ?? true })
        )
);
