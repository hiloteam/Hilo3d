import AmbientLightView from '../../light/AmbientLight';
import AreaLightView from '../../light/AreaLight';
import DirectionalLightView from '../../light/DirectionalLight';
import type Light from '../../light/Light';
import PointLightView from '../../light/PointLight';
import SpotLightView from '../../light/SpotLight';
import type {
    AmbientLightValue,
    AreaLightValue,
    DirectionalLightValue,
    LightComponentValue,
    PointLightValue,
    SpotLightValue
} from '../../scene/components/Lighting';
import type { TransformStore } from '../../scene/components/Transform';

const ABSENT_DENSE_INDEX = -1;
const MIN_LIGHT_CAPACITY = 8;
const AMBIENT_LIGHT = 1;
const DIRECTIONAL_LIGHT = 2;
const POINT_LIGHT = 3;
const SPOT_LIGHT = 4;
const AREA_LIGHT = 5;

function createSparseIndex(capacity: number): Int32Array {
    const values = new Int32Array(capacity);
    values.fill(ABSENT_DENSE_INDEX);
    return values;
}

/** Dense renderer-local Light views extracted from ECS light components. */
export class RenderLightStore {
    private sparse: Int32Array;
    private entityIndices: Uint32Array;
    private lightKinds: Uint8Array;
    private lightViews: (Light | null)[];
    private entryCount = 0;

    constructor(initialEntityCapacity = 0, initialLightCapacity = 0) {
        this.sparse = createSparseIndex(initialEntityCapacity);
        this.entityIndices = new Uint32Array(initialLightCapacity);
        this.lightKinds = new Uint8Array(initialLightCapacity);
        this.lightViews = new Array<Light | null>(initialLightCapacity).fill(null);
    }

    get length(): number {
        return this.entryCount;
    }

    get lights(): readonly (Light | null)[] {
        return this.lightViews;
    }

    ensureEntityCapacity(capacity: number): void {
        if (capacity <= this.sparse.length) return;
        const sparse = createSparseIndex(capacity);
        sparse.set(this.sparse);
        this.sparse = sparse;
    }

    has(entityIndex: number): boolean {
        return (
            entityIndex >= 0 &&
            entityIndex < this.sparse.length &&
            this.sparse[entityIndex] !== ABSENT_DENSE_INDEX
        );
    }

    synchronize(
        entityIndex: number,
        ambient: AmbientLightValue | undefined,
        directional: DirectionalLightValue | undefined,
        point: PointLightValue | undefined,
        spot: SpotLightValue | undefined,
        area: AreaLightValue | undefined,
        transforms: TransformStore
    ): void {
        let kind = 0;
        let count = 0;
        if (ambient !== undefined) {
            kind = AMBIENT_LIGHT;
            count++;
        }
        if (directional !== undefined) {
            kind = DIRECTIONAL_LIGHT;
            count++;
        }
        if (point !== undefined) {
            kind = POINT_LIGHT;
            count++;
        }
        if (spot !== undefined) {
            kind = SPOT_LIGHT;
            count++;
        }
        if (area !== undefined) {
            kind = AREA_LIGHT;
            count++;
        }
        if (count === 0) {
            this.remove(entityIndex);
            return;
        }
        if (count !== 1) {
            throw new TypeError(
                `Entity index ${String(entityIndex)} cannot have multiple light-kind components.`
            );
        }
        let denseIndex: number;
        if (this.has(entityIndex)) {
            denseIndex = this.requireDenseIndex(entityIndex);
            if (this.lightKinds[denseIndex] !== kind) {
                this.lightKinds[denseIndex] = kind;
                this.lightViews[denseIndex] = this.createLight(kind);
            }
        } else {
            this.ensureEntityCapacity(entityIndex + 1);
            this.ensureDenseCapacity(this.entryCount + 1);
            denseIndex = this.entryCount;
            this.entryCount++;
            this.sparse[entityIndex] = denseIndex;
            this.entityIndices[denseIndex] = entityIndex;
            this.lightKinds[denseIndex] = kind;
            this.lightViews[denseIndex] = this.createLight(kind);
        }
        const light = this.requireLight(denseIndex);
        const value = ambient ?? directional ?? point ?? spot ?? area;
        if (value === undefined) throw new Error('Extracted light value is missing.');
        this.writeCommon(light, value);
        if (directional !== undefined) this.writeDirectional(light, directional);
        else if (point !== undefined) this.writePoint(light, point);
        else if (spot !== undefined) this.writeSpot(light, spot);
        else if (area !== undefined) this.writeArea(light, area);
        if (transforms.has(entityIndex)) this.updateTransform(entityIndex, transforms);
    }

    updateTransform(entityIndex: number, transforms: TransformStore): void {
        if (!this.has(entityIndex) || !transforms.has(entityIndex)) return;
        const denseIndex = this.requireDenseIndex(entityIndex);
        const transformDenseIndex = transforms.denseIndexOf(entityIndex);
        this.requireLight(denseIndex).setExtractedWorldMatrix(
            transforms.worldMatrixData,
            transformDenseIndex * 16,
            transforms.worldRevisionOf(entityIndex)
        );
    }

    remove(entityIndex: number): boolean {
        if (!this.has(entityIndex)) return false;
        const denseIndex = this.requireDenseIndex(entityIndex);
        const lastDenseIndex = this.entryCount - 1;
        if (denseIndex !== lastDenseIndex) {
            const movedEntity = this.entityIndices[lastDenseIndex] ?? 0;
            this.entityIndices[denseIndex] = movedEntity;
            this.lightKinds[denseIndex] = this.lightKinds[lastDenseIndex] ?? 0;
            this.lightViews[denseIndex] = this.lightViews[lastDenseIndex] ?? null;
            this.sparse[movedEntity] = denseIndex;
        }
        this.sparse[entityIndex] = ABSENT_DENSE_INDEX;
        this.entityIndices[lastDenseIndex] = 0;
        this.lightKinds[lastDenseIndex] = 0;
        this.lightViews[lastDenseIndex] = null;
        this.entryCount--;
        return true;
    }

    clear(): void {
        this.sparse.fill(ABSENT_DENSE_INDEX);
        this.entityIndices.fill(0);
        this.lightKinds.fill(0);
        this.lightViews.fill(null);
        this.entryCount = 0;
    }

    private writeCommon(light: Light, value: LightComponentValue): void {
        const color = value.color ?? [1, 1, 1];
        light.color.r = color[0];
        light.color.g = color[1];
        light.color.b = color[2];
        light.amount = value.amount ?? 1;
        light.enabled = value.enabled ?? true;
        light.range = value.range ?? 0;
        light.constantAttenuation = value.constantAttenuation ?? 1;
        light.linearAttenuation = value.linearAttenuation ?? 0;
        light.quadraticAttenuation = value.quadraticAttenuation ?? 0;
        light.lightLayerMask = value.lightLayerMask ?? 0xffffffff;
        light.isDirty = true;
    }

    private writeDirectional(light: Light, value: DirectionalLightValue): void {
        if (!(light instanceof DirectionalLightView)) {
            throw new TypeError('Directional light component has an invalid renderer view.');
        }
        const direction = value.direction ?? [0, 0, 1];
        light.direction.set(direction[0], direction[1], direction[2]);
        light.shadow = value.shadow ?? null;
    }

    private writePoint(light: Light, value: PointLightValue): void {
        if (!(light instanceof PointLightView)) {
            throw new TypeError('Point light component has an invalid renderer view.');
        }
        light.shadow = value.shadow ?? null;
    }

    private writeSpot(light: Light, value: SpotLightValue): void {
        if (!(light instanceof SpotLightView)) {
            throw new TypeError('Spot light component has an invalid renderer view.');
        }
        const direction = value.direction ?? [0, 0, 1];
        light.direction.set(direction[0], direction[1], direction[2]);
        light.cutoff = value.cutoff ?? 12.5;
        light.outerCutoff = value.outerCutoff ?? 17.5;
        light.cookie = value.cookie ?? null;
        light.iesProfile = value.iesProfile ?? null;
        light.shadow = value.shadow ?? null;
    }

    private writeArea(light: Light, value: AreaLightValue): void {
        if (!(light instanceof AreaLightView)) {
            throw new TypeError('Area light component has an invalid renderer view.');
        }
        light.width = value.width ?? 10;
        light.height = value.height ?? 10;
    }

    private createLight(kind: number): Light {
        if (kind === AMBIENT_LIGHT) return new AmbientLightView();
        if (kind === DIRECTIONAL_LIGHT) return new DirectionalLightView();
        if (kind === POINT_LIGHT) return new PointLightView();
        if (kind === SPOT_LIGHT) return new SpotLightView();
        return new AreaLightView();
    }

    private requireLight(denseIndex: number): Light {
        if (denseIndex < 0 || denseIndex >= this.entryCount) {
            throw new RangeError(`Render light dense index ${String(denseIndex)} is out of range.`);
        }
        const light = this.lightViews[denseIndex];
        if (!light) throw new Error('Render light view is missing.');
        return light;
    }

    private requireDenseIndex(entityIndex: number): number {
        if (!this.has(entityIndex)) {
            throw new ReferenceError(`Entity index ${String(entityIndex)} has no extracted Light.`);
        }
        return this.sparse[entityIndex] ?? ABSENT_DENSE_INDEX;
    }

    private ensureDenseCapacity(required: number): void {
        if (required <= this.entityIndices.length) return;
        let capacity = Math.max(this.entityIndices.length, MIN_LIGHT_CAPACITY);
        while (capacity < required) capacity *= 2;
        const entities = new Uint32Array(capacity);
        entities.set(this.entityIndices);
        this.entityIndices = entities;
        const kinds = new Uint8Array(capacity);
        kinds.set(this.lightKinds);
        this.lightKinds = kinds;
        this.lightViews.length = capacity;
    }
}
