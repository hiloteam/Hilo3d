import Mesh from '../../core/Mesh';
import SkinnedMesh from '../../core/SkinnedMesh';
import type Geometry from '../../geometry/Geometry';
import type GeometryData from '../../geometry/GeometryData';
import MorphGeometry from '../../geometry/MorphGeometry';
import type Material from '../../material/MaterialInstance';
import type Texture from '../../texture/Texture';
import type { RHIUploadBatch, RHIUploadBatchParticipant } from '../frame/RHIUploadBatch';
import { RHICacheCounter, type RHISubmission } from '../rhi/core';
import type { ShadowAtlasResourceRecord } from './ShadowAtlasResourceCache';
import type { ShadowAtlasScenePlan, ShadowAtlasSceneSlice } from './ShadowAtlasSceneAdapter';

export type ShadowAtlasInvalidationReason =
    | 'allocation'
    | 'layout'
    | 'light'
    | 'caster-set'
    | 'caster-transform'
    | 'caster-geometry'
    | 'caster-material'
    | 'caster-texture'
    | 'caster-deformation';

export interface ShadowAtlasContentDecision {
    /** Reused physical-index mask. It remains valid only until the next `stage` call. */
    readonly dirtySlices: readonly boolean[];
    /** First exact invalidation cause for each physical slice, or `null` on a cache hit. */
    readonly reasons: readonly (ShadowAtlasInvalidationReason | null)[];
    readonly sliceCount: number;
    readonly dirtySliceCount: number;
    readonly cachedSliceCount: number;
}

interface CasterSnapshot {
    mesh: Mesh | null;
    geometry: Geometry | null;
    geometryMode: number;
    material: Material | null;
    materialRevision: number;
    instanceCount: number;
    skeleton: object | null;
    readonly geometrySources: (GeometryData | null)[];
    readonly geometrySourceRevisions: number[];
    geometrySourceCount: number;
    readonly textures: (Texture<unknown> | null)[];
    readonly textureRevisions: number[];
    textureCount: number;
    readonly numericState: number[];
    numericStateCount: number;
}

interface CasterRecord {
    readonly mesh: Mesh;
    committed: CasterSnapshot;
    pending: CasterSnapshot;
    committedValid: boolean;
    committedRevision: number;
    pendingRevision: number;
    pendingEpoch: number;
    pendingChanged: boolean;
    pendingReason: ShadowAtlasInvalidationReason;
}

interface SliceSnapshot {
    atlasToken: number;
    owner: object | null;
    kind: ShadowAtlasSceneSlice['kind'];
    face: number | null;
    cascade: number | null;
    sliceIndex: number;
    physicalIndex: number;
    readonly viewport: number[];
    readonly viewProjection: number[];
    readonly casters: (CasterRecord | null)[];
    readonly casterRevisions: number[];
    casterCount: number;
}

interface SliceRecord {
    committed: SliceSnapshot;
    pending: SliceSnapshot;
    committedValid: boolean;
    pendingEpoch: number;
}

function createCasterSnapshot(): CasterSnapshot {
    return {
        mesh: null,
        geometry: null,
        geometryMode: -1,
        material: null,
        materialRevision: -1,
        instanceCount: 0,
        skeleton: null,
        geometrySources: [],
        geometrySourceRevisions: [],
        geometrySourceCount: 0,
        textures: [],
        textureRevisions: [],
        textureCount: 0,
        numericState: [],
        numericStateCount: 0
    };
}

function createSliceSnapshot(): SliceSnapshot {
    return {
        atlasToken: 0,
        owner: null,
        kind: 'directional',
        face: null,
        cascade: null,
        sliceIndex: -1,
        physicalIndex: -1,
        viewport: new Array<number>(6).fill(0),
        viewProjection: new Array<number>(16).fill(0),
        casters: [],
        casterRevisions: [],
        casterCount: 0
    };
}

function sameNumbers(
    previous: ArrayLike<number>,
    current: ArrayLike<number>,
    count: number,
    offset = 0
): boolean {
    if (previous.length < offset + count || current.length < offset + count) return false;
    for (let index = offset; index < offset + count; index += 1) {
        if (!Object.is(previous[index], current[index])) return false;
    }
    return true;
}

function copyNumbers(target: number[], source: readonly number[], count: number): void {
    target.length = count;
    for (let index = 0; index < count; index += 1) target[index] = source[index] ?? 0;
}

function appendNumbers(target: number[], values: ArrayLike<number> | null): void {
    if (values === null) {
        target.push(-1);
        return;
    }
    target.push(values.length);
    let index = 0;
    while (index < values.length) {
        target.push(values[index] ?? 0);
        index++;
    }
}

function appendGeometrySource(target: GeometryData[], source: GeometryData | null): void {
    if (source !== null) target.push(source);
}

function collectGeometrySources(target: GeometryData[], geometry: Geometry | null): void {
    target.length = 0;
    if (geometry === null) return;
    appendGeometrySource(target, geometry.vertices);
    appendGeometrySource(target, geometry.uvs);
    appendGeometrySource(target, geometry.uvs1);
    appendGeometrySource(target, geometry.colors);
    appendGeometrySource(target, geometry.indices);
    appendGeometrySource(target, geometry.skinIndices);
    appendGeometrySource(target, geometry.skinWeights);
    if (!(geometry instanceof MorphGeometry) || geometry.targets === null) return;
    for (const name in geometry.targets) {
        if (!Object.hasOwn(geometry.targets, name)) continue;
        const sources = geometry.targets[name];
        if (sources === undefined) continue;
        for (const source of sources) appendGeometrySource(target, source);
    }
}

function collectTextures(target: Texture<unknown>[], material: Material | null): void {
    target.length = 0;
    if (material === null) return;
    for (const slot of material.definition.textureSlots) {
        const binding = material.getTextureSlotByIndex(slot.index);
        if (binding !== null) target.push(binding.texture);
    }
}

function collectNumericState(target: number[], mesh: Mesh): void {
    target.length = 0;
    appendNumbers(target, mesh.worldMatrix.elements);
    const geometry = mesh.geometry;
    appendNumbers(target, geometry?.positionDecodeMat ?? null);
    if (geometry instanceof MorphGeometry) appendNumbers(target, geometry.weights);
    else appendNumbers(target, null);
    if (mesh instanceof SkinnedMesh && mesh.skeleton !== null) {
        appendNumbers(target, mesh.getJointMat());
    } else appendNumbers(target, null);
}

function sameIdentities<T extends object>(
    previous: readonly (T | null)[],
    current: readonly T[],
    count: number
): boolean {
    if (current.length !== count) return false;
    for (let index = 0; index < count; index += 1) {
        if (previous[index] !== current[index]) return false;
    }
    return true;
}

/**
 * Submission-aware S0 content cache for stable shadow-atlas slices.
 *
 * The cache compares exact light/caster state, never a collision-prone hash. Rigid casters use the
 * shadow camera frustum to localize invalidation to intersecting slices; deformation and geometry
 * changes conservatively invalidate every slice until GPU caster culling owns those bounds.
 */
export class ShadowAtlasContentCache implements RHIUploadBatchParticipant {
    readonly metrics = new RHICacheCounter();
    readonly #casters = new WeakMap<Mesh, CasterRecord>();
    readonly #activeCasterRecords = new Set<CasterRecord>();
    readonly #currentCasters: CasterRecord[] = [];
    readonly #geometryScratch: GeometryData[] = [];
    readonly #textureScratch: Texture<unknown>[] = [];
    readonly #numericScratch: number[] = [];
    readonly #slices: SliceRecord[] = [];
    readonly #dirtySlices: boolean[] = [];
    readonly #reasons: (ShadowAtlasInvalidationReason | null)[] = [];
    #transactionEpoch = 0;
    #transactionActive = false;
    #pendingSliceCount = 0;
    #pendingInsertions = 0;
    #pendingReplacements = 0;
    #pendingRemovals = 0;
    #nextCasterRevision = 1;
    #destroyed = false;

    stage(
        atlas: Readonly<ShadowAtlasResourceRecord>,
        plan: Readonly<ShadowAtlasScenePlan>,
        meshes: readonly Mesh[],
        uploads: RHIUploadBatch
    ): Readonly<ShadowAtlasContentDecision> {
        this.assertAlive();
        if (plan.atlas.sliceCount !== plan.slices.length) {
            throw new TypeError('Shadow content cache requires a complete scene plan');
        }
        this.beginTransaction(uploads);
        this.captureCasters(meshes);
        const sliceCount = plan.slices.length;
        this.#dirtySlices.length = sliceCount;
        this.#reasons.length = sliceCount;
        this.#pendingSliceCount = sliceCount;
        this.#pendingInsertions = 0;
        this.#pendingReplacements = 0;
        this.#pendingRemovals = 0;
        let dirtySliceCount = 0;

        for (let physicalIndex = 0; physicalIndex < sliceCount; physicalIndex += 1) {
            const slice = plan.slices[physicalIndex];
            if (slice?.physicalIndex !== physicalIndex) {
                throw new TypeError('Shadow scene plan must be dense in physical atlas order');
            }
            const record = this.sliceAt(physicalIndex);
            const previous =
                record.pendingEpoch === this.#transactionEpoch
                    ? record.pending
                    : record.committedValid
                      ? record.committed
                      : null;
            const reason = this.sliceInvalidationReason(previous, atlas.token, slice);
            const committedReason = this.sliceInvalidationReason(
                record.committedValid ? record.committed : null,
                atlas.token,
                slice
            );
            const dirty = reason !== null;
            this.copySlice(record.pending, atlas.token, slice);
            record.pendingEpoch = this.#transactionEpoch;
            this.#dirtySlices[physicalIndex] = dirty;
            this.#reasons[physicalIndex] = reason;
            if (dirty) {
                dirtySliceCount++;
                this.metrics.recordMiss();
            } else this.metrics.recordHit();
            if (!record.committedValid) this.#pendingInsertions++;
            else if (committedReason !== null) this.#pendingReplacements++;
        }
        for (let index = sliceCount; index < this.#slices.length; index += 1) {
            const record = this.#slices[index];
            if (record?.committedValid === true) this.#pendingRemovals++;
        }

        return Object.freeze({
            dirtySlices: this.#dirtySlices,
            reasons: this.#reasons,
            sliceCount,
            dirtySliceCount,
            cachedSliceCount: sliceCount - dirtySliceCount
        });
    }

    /** Stage an empty final atlas state without breaking an already-enlisted frame transaction. */
    stageEmpty(uploads: RHIUploadBatch): void {
        this.assertAlive();
        this.beginTransaction(uploads);
        this.#pendingSliceCount = 0;
        this.#pendingInsertions = 0;
        this.#pendingReplacements = 0;
        this.#pendingRemovals = 0;
        for (const record of this.#slices) {
            if (record.committedValid) this.#pendingRemovals++;
        }
    }

    /** Drop all content validity after atlas detach, resize, or device recovery. */
    invalidateAll(): void {
        this.assertAlive();
        this.rollback();
        for (const record of this.#slices) record.committedValid = false;
        this.metrics.clear();
    }

    prepareCommit(_submission: RHISubmission): void {
        this.assertAlive();
        if (!this.#transactionActive) {
            throw new Error('Shadow content cache has no staged transaction to commit');
        }
    }

    commit(_submission: RHISubmission): void {
        this.assertAlive();
        if (!this.#transactionActive) return;
        for (const record of this.#activeCasterRecords) {
            if (record.pendingEpoch !== this.#transactionEpoch) continue;
            if (record.pendingChanged) {
                const previous = record.committed;
                record.committed = record.pending;
                record.pending = previous;
                record.committedValid = true;
            }
            record.committedRevision = record.pendingRevision;
        }
        for (let index = 0; index < this.#pendingSliceCount; index += 1) {
            const record = this.#slices[index];
            if (record?.pendingEpoch !== this.#transactionEpoch) continue;
            const previous = record.committed;
            record.committed = record.pending;
            record.pending = previous;
            record.committedValid = true;
        }
        for (let index = this.#pendingSliceCount; index < this.#slices.length; index += 1) {
            const record = this.#slices[index];
            if (record !== undefined) record.committedValid = false;
        }
        if (this.#pendingReplacements > 0) {
            this.metrics.recordReplacement(this.#pendingReplacements);
        }
        if (this.#pendingRemovals > 0) this.metrics.recordRemoval(this.#pendingRemovals);
        if (this.#pendingInsertions > 0) this.metrics.recordInsertion(this.#pendingInsertions);
        this.finishTransaction();
    }

    rollback(): void {
        if (!this.#transactionActive) return;
        this.finishTransaction();
    }

    destroy(): void {
        if (this.#destroyed) return;
        this.rollback();
        this.metrics.clear();
        this.#activeCasterRecords.clear();
        this.#currentCasters.length = 0;
        this.#slices.length = 0;
        this.#dirtySlices.length = 0;
        this.#reasons.length = 0;
        this.#destroyed = true;
    }

    private beginTransaction(uploads: RHIUploadBatch): void {
        if (!this.#transactionActive) {
            if (!Number.isSafeInteger(this.#transactionEpoch + 1)) {
                throw new RangeError('Shadow content-cache transaction space is exhausted');
            }
            this.#transactionEpoch++;
            this.#transactionActive = true;
            this.#activeCasterRecords.clear();
        }
        uploads.enlist(this);
    }

    private captureCasters(meshes: readonly Mesh[]): void {
        this.#currentCasters.length = 0;
        for (const mesh of meshes) {
            if (!(mesh instanceof Mesh) || !mesh.castShadows || mesh.material === null) continue;
            let record = this.#casters.get(mesh);
            if (record === undefined) {
                record = {
                    mesh,
                    committed: createCasterSnapshot(),
                    pending: createCasterSnapshot(),
                    committedValid: false,
                    committedRevision: 0,
                    pendingRevision: 0,
                    pendingEpoch: 0,
                    pendingChanged: false,
                    pendingReason: 'caster-set'
                };
                this.#casters.set(mesh, record);
            }
            this.captureCaster(record);
            this.#activeCasterRecords.add(record);
            this.#currentCasters.push(record);
        }
    }

    private captureCaster(record: CasterRecord): void {
        const mesh = record.mesh;
        const geometry = mesh.geometry;
        const material = mesh.material;
        collectGeometrySources(this.#geometryScratch, geometry);
        collectTextures(this.#textureScratch, material);
        collectNumericState(this.#numericScratch, mesh);
        const comparingPending =
            record.pendingEpoch === this.#transactionEpoch && record.pendingChanged;
        const previous = comparingPending
            ? record.pending
            : record.committedValid
              ? record.committed
              : null;
        const reason = this.casterInvalidationReason(previous, mesh);
        record.pendingEpoch = this.#transactionEpoch;
        record.pendingReason = reason ?? record.pendingReason;
        if (reason === null) {
            if (comparingPending) return;
            record.pendingChanged = false;
            record.pendingRevision = record.committedRevision;
            return;
        }
        this.copyCaster(record.pending, mesh);
        if (reason === 'caster-geometry' && mesh.geometry?.vertices !== null) {
            mesh.geometry?.getLocalSphereBounds(true);
        }
        record.pendingChanged = true;
        record.pendingRevision = this.allocateCasterRevision();
        record.pendingReason = reason;
    }

    private casterInvalidationReason(
        previous: Readonly<CasterSnapshot> | null,
        mesh: Mesh
    ): ShadowAtlasInvalidationReason | null {
        if (previous?.mesh !== mesh) return 'caster-set';
        if (!sameNumbers(previous.numericState, this.#numericScratch, 17, 0)) {
            return 'caster-transform';
        }
        const geometry = mesh.geometry;
        if (
            previous.geometry !== geometry ||
            previous.geometryMode !== (geometry?.mode ?? -1) ||
            !sameIdentities(
                previous.geometrySources,
                this.#geometryScratch,
                previous.geometrySourceCount
            )
        ) {
            return 'caster-geometry';
        }
        for (let index = 0; index < this.#geometryScratch.length; index += 1) {
            if (
                previous.geometrySourceRevisions[index] !== this.#geometryScratch[index]?.revision
            ) {
                return 'caster-geometry';
            }
        }
        const material = mesh.material;
        if (
            previous.material !== material ||
            previous.materialRevision !== (material?.revision ?? -1) ||
            previous.instanceCount !== mesh.instanceCount ||
            previous.skeleton !== (mesh instanceof SkinnedMesh ? mesh.skeleton : null)
        ) {
            return 'caster-material';
        }
        if (!sameIdentities(previous.textures, this.#textureScratch, previous.textureCount)) {
            return 'caster-texture';
        }
        for (let index = 0; index < this.#textureScratch.length; index += 1) {
            const texture = this.#textureScratch[index];
            if (
                texture?.autoUpdate === true ||
                previous.textureRevisions[index] !== texture?.updateRevision
            ) {
                return 'caster-texture';
            }
        }
        if (
            previous.numericStateCount !== this.#numericScratch.length ||
            !sameNumbers(previous.numericState, this.#numericScratch, this.#numericScratch.length)
        ) {
            return 'caster-deformation';
        }
        return null;
    }

    private copyCaster(target: CasterSnapshot, mesh: Mesh): void {
        const geometry = mesh.geometry;
        const material = mesh.material;
        target.mesh = mesh;
        target.geometry = geometry;
        target.geometryMode = geometry?.mode ?? -1;
        target.material = material;
        target.materialRevision = material?.revision ?? -1;
        target.instanceCount = mesh.instanceCount;
        target.skeleton = mesh instanceof SkinnedMesh ? mesh.skeleton : null;
        target.geometrySourceCount = this.#geometryScratch.length;
        target.geometrySources.length = this.#geometryScratch.length;
        target.geometrySourceRevisions.length = this.#geometryScratch.length;
        for (let index = 0; index < this.#geometryScratch.length; index += 1) {
            const source = this.#geometryScratch[index] ?? null;
            target.geometrySources[index] = source;
            target.geometrySourceRevisions[index] = source?.revision ?? -1;
        }
        target.textureCount = this.#textureScratch.length;
        target.textures.length = this.#textureScratch.length;
        target.textureRevisions.length = this.#textureScratch.length;
        for (let index = 0; index < this.#textureScratch.length; index += 1) {
            const texture = this.#textureScratch[index] ?? null;
            target.textures[index] = texture;
            target.textureRevisions[index] = texture?.updateRevision ?? -1;
        }
        target.numericStateCount = this.#numericScratch.length;
        copyNumbers(target.numericState, this.#numericScratch, this.#numericScratch.length);
    }

    private sliceInvalidationReason(
        previous: Readonly<SliceSnapshot> | null,
        atlasToken: number,
        slice: Readonly<ShadowAtlasSceneSlice>
    ): ShadowAtlasInvalidationReason | null {
        if (previous?.atlasToken !== atlasToken) return 'allocation';
        if (
            previous.owner !== slice.light ||
            previous.kind !== slice.kind ||
            previous.face !== slice.face ||
            previous.cascade !== slice.cascade ||
            previous.sliceIndex !== slice.sliceIndex ||
            previous.physicalIndex !== slice.physicalIndex ||
            previous.viewport[0] !== slice.viewport.x ||
            previous.viewport[1] !== slice.viewport.y ||
            previous.viewport[2] !== slice.viewport.width ||
            previous.viewport[3] !== slice.viewport.height ||
            previous.viewport[4] !== slice.viewport.minDepth ||
            previous.viewport[5] !== slice.viewport.maxDepth
        ) {
            return 'layout';
        }
        const matrix = slice.viewProjectionMatrix.elements;
        if (!sameNumbers(previous.viewProjection, matrix, 16)) return 'light';

        let casterIndex = 0;
        for (const record of this.#currentCasters) {
            if (!this.casterAffectsSlice(record, slice)) continue;
            if (previous.casters[casterIndex] !== record) return 'caster-set';
            if (previous.casterRevisions[casterIndex] !== record.pendingRevision) {
                return record.pendingReason;
            }
            casterIndex++;
        }
        return previous.casterCount === casterIndex ? null : 'caster-set';
    }

    private copySlice(
        target: SliceSnapshot,
        atlasToken: number,
        slice: Readonly<ShadowAtlasSceneSlice>
    ): void {
        target.atlasToken = atlasToken;
        target.owner = slice.light;
        target.kind = slice.kind;
        target.face = slice.face;
        target.cascade = slice.cascade;
        target.sliceIndex = slice.sliceIndex;
        target.physicalIndex = slice.physicalIndex;
        target.viewport[0] = slice.viewport.x;
        target.viewport[1] = slice.viewport.y;
        target.viewport[2] = slice.viewport.width;
        target.viewport[3] = slice.viewport.height;
        target.viewport[4] = slice.viewport.minDepth;
        target.viewport[5] = slice.viewport.maxDepth;
        const matrix = slice.viewProjectionMatrix.elements;
        for (let index = 0; index < 16; index += 1) {
            target.viewProjection[index] = matrix[index] ?? 0;
        }
        let casterIndex = 0;
        for (const record of this.#currentCasters) {
            if (!this.casterAffectsSlice(record, slice)) continue;
            target.casters[casterIndex] = record;
            target.casterRevisions[casterIndex] = record.pendingRevision;
            casterIndex++;
        }
        for (let index = casterIndex; index < target.casterCount; index += 1) {
            target.casters[index] = null;
            target.casterRevisions[index] = 0;
        }
        target.casterCount = casterIndex;
    }

    private casterAffectsSlice(
        record: Readonly<CasterRecord>,
        slice: Readonly<ShadowAtlasSceneSlice>
    ): boolean {
        const mesh = record.mesh;
        const geometry = mesh.geometry;
        if (
            geometry === null ||
            !mesh.frustumTest ||
            mesh instanceof SkinnedMesh ||
            geometry instanceof MorphGeometry ||
            (record.pendingChanged && record.pendingReason === 'caster-geometry')
        ) {
            return true;
        }
        return slice.camera.isMeshVisible(mesh);
    }

    private sliceAt(index: number): SliceRecord {
        let record = this.#slices[index];
        if (record === undefined) {
            record = {
                committed: createSliceSnapshot(),
                pending: createSliceSnapshot(),
                committedValid: false,
                pendingEpoch: 0
            };
            this.#slices[index] = record;
        }
        return record;
    }

    private allocateCasterRevision(): number {
        const revision = this.#nextCasterRevision;
        if (!Number.isSafeInteger(revision)) {
            throw new RangeError('Shadow caster revision space is exhausted');
        }
        this.#nextCasterRevision++;
        return revision;
    }

    private finishTransaction(): void {
        this.#transactionActive = false;
        this.#activeCasterRecords.clear();
        this.#currentCasters.length = 0;
        this.#pendingSliceCount = 0;
        this.#pendingInsertions = 0;
        this.#pendingReplacements = 0;
        this.#pendingRemovals = 0;
    }

    private assertAlive(): void {
        if (this.#destroyed) throw new Error('ShadowAtlasContentCache is destroyed');
    }
}
