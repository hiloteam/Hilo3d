import type Camera from '../../camera/Camera';
import Mesh from '../../core/Mesh';
import Material from '../../material/Material';
import type { RHIUploadBatch, RHIUploadBatchParticipant } from '../frame/RHIUploadBatch';
import type { RenderGraphFrameContext } from '../frame/RenderGraphFrameContext';
import type { RHIMeshDrawTargetDescriptor } from './RHIDescriptorMapping';
import type { PreparedDraw } from './PreparedDraw';
import type { ShadowAtlasSceneLight, ShadowAtlasScenePlan } from './ShadowAtlasSceneAdapter';
import type { ShadowAtlasSlice } from './ShadowAtlasPlanner';
import type { ShadowAtlasSlicePreparer } from './ShadowAtlasRenderer';
import type { MeshDrawProcessor } from './MeshDrawProcessor';

interface ShadowOwnerRecord {
    readonly owner: object;
    readonly camera: Camera;
    readonly mesh: Mesh;
}

interface ShadowMaterialRecord {
    readonly fallback: Material;
    candidate: Material;
    material: Material;
}

function shadowMaterialProxy(source: Material): Material {
    const proxy = Object.create(source) as Material;
    Object.defineProperty(proxy, 'revision', {
        configurable: true,
        get: () => source.revision
    });
    return proxy;
}

function normalizeShadowMaterial(candidate: Material): Material {
    const material = shadowMaterialProxy(candidate);
    material.lightType = 'NONE';
    material.receiveShadows = false;
    material.castShadows = true;
    material.wireframe = false;
    material.transparent = false;
    material.blend = false;
    material.depthTest = true;
    material.depthMask = true;
    material.sampleAlphaToCoverage = false;
    return material;
}

/**
 * Real Mesh/Material -> depth-only PreparedDraw adapter for ShadowAtlasRenderer.
 * Every camera/mesh pair owns a distinct draw and bind group so graph construction cannot alias
 * the final slice's CameraBlock across earlier passes.
 */
export class ShadowAtlasMeshPreparer
    implements ShadowAtlasSlicePreparer<ShadowAtlasSceneLight>, RHIUploadBatchParticipant
{
    readonly #draws: PreparedDraw[] = [];
    readonly #sceneSlicesByPhysicalIndex: ShadowAtlasScenePlan['slices'][number][] = [];
    readonly #ownersByCamera = new Map<Camera, Map<Mesh, object>>();
    readonly #ownerRecords = new Map<object, ShadowOwnerRecord>();
    readonly #usedOwners = new Set<object>();
    readonly #pendingDetachOwners = new Set<object>();
    #materials = new WeakMap<Material, ShadowMaterialRecord>();
    #plan: Readonly<ShadowAtlasScenePlan> | null = null;
    #meshes: readonly Mesh[] = Object.freeze([]);
    #target: RHIMeshDrawTargetDescriptor | null = null;
    #active = false;
    #destroyed = false;

    constructor(readonly processor: MeshDrawProcessor) {}

    get sampledGraphDependencies(): MeshDrawProcessor['sampledGraphDependencies'] {
        return this.processor.sampledGraphDependencies;
    }

    configure(plan: Readonly<ShadowAtlasScenePlan>, meshes: readonly Mesh[]): void {
        this.assertAlive();
        if (this.#active) throw new Error('Cannot configure an active shadow mesh preparer');
        if (plan.atlas.sliceCount === 0 || plan.slices.length !== plan.atlas.slices.length) {
            throw new RangeError('Shadow mesh preparation requires a complete scene atlas plan');
        }
        // Truncating first clears entries when the reusable plan keeps the same slice count.
        this.#sceneSlicesByPhysicalIndex.length = 0;
        this.#sceneSlicesByPhysicalIndex.length = plan.atlas.sliceCount;
        for (const slice of plan.slices) {
            if (this.#sceneSlicesByPhysicalIndex[slice.physicalIndex] !== undefined) {
                throw new TypeError('Shadow scene plan contains a duplicate physical slice');
            }
            this.#sceneSlicesByPhysicalIndex[slice.physicalIndex] = slice;
        }
        this.#plan = plan;
        this.#meshes = meshes;
        this.#target = Object.freeze({
            colorFormats: Object.freeze([]),
            depthStencilFormat: plan.atlas.format,
            sampleCount: 1
        });
    }

    begin(context: RenderGraphFrameContext, uploads: RHIUploadBatch, frameStarted = false): void {
        this.assertAlive();
        if (this.#active) throw new Error('Nested shadow mesh preparation is not allowed');
        if (this.#plan === null || this.#target === null) {
            throw new Error('Shadow mesh preparer requires configure() before rendering');
        }
        this.#usedOwners.clear();
        if (!frameStarted) this.processor.beginFrame(context, uploads);
        uploads.enlist(this);
        this.#active = true;
    }

    prepare(slice: Readonly<ShadowAtlasSlice<ShadowAtlasSceneLight>>): readonly PreparedDraw[] {
        this.assertAlive();
        if (!this.#active || this.#target === null) {
            throw new Error('Shadow mesh preparer requires begin() before slice preparation');
        }
        const sceneSlice = this.#sceneSlicesByPhysicalIndex[slice.physicalIndex];
        if (sceneSlice?.sliceIndex !== slice.sliceIndex || sceneSlice.light !== slice.owner) {
            throw new Error('Shadow atlas and scene slice ordering disagree');
        }
        this.processor.beginPass(sceneSlice.camera, sceneSlice.viewport);
        this.#draws.length = 0;
        for (const mesh of this.#meshes) {
            const sourceMaterial = mesh.material;
            if (!(mesh instanceof Mesh) || sourceMaterial?.castShadows !== true) continue;
            const owner = this.ownerFor(sceneSlice.camera, mesh);
            this.#usedOwners.add(owner);
            this.#pendingDetachOwners.delete(owner);
            this.#draws.push(
                this.processor.prepareShadow(
                    owner,
                    mesh,
                    this.materialFor(sourceMaterial),
                    this.#target
                )
            );
        }
        return this.#draws;
    }

    end(): void {
        if (!this.#active) return;
        this.#active = false;
        for (const owner of this.#ownerRecords.keys()) {
            if (this.#usedOwners.has(owner)) continue;
            this.#pendingDetachOwners.add(owner);
        }
        this.#usedOwners.clear();
    }

    /** Stage every cached slice/mesh owner for release after the active frame commits. */
    retireAll(uploads: RHIUploadBatch): void {
        this.assertAlive();
        if (this.#active) throw new Error('Cannot retire owners from an active shadow preparer');
        if (!this.processor.active) {
            throw new Error('Shadow owner retirement requires an active mesh frame');
        }
        uploads.enlist(this);
        for (const owner of this.#ownerRecords.keys()) this.#pendingDetachOwners.add(owner);
    }

    prepareCommit(): void {
        if (this.#active) throw new Error('Cannot commit an active shadow mesh preparer');
    }

    /** Child resource caches commit first, making processor-owned detach legal here. */
    commit(): void {
        this.flushPendingDetachOwners();
    }

    /** Failed frames keep prior owner records so the next frame can reuse or retire them. */
    rollback(): void {
        // The child caches roll back after this participant; defer cleanup to a later commit.
    }

    destroy(): void {
        if (this.#destroyed) return;
        if (this.#active) throw new Error('Cannot destroy an active shadow mesh preparer');
        for (const owner of this.#ownerRecords.keys()) this.processor.detachShadowDraw(owner);
        this.#ownerRecords.clear();
        this.#ownersByCamera.clear();
        this.#usedOwners.clear();
        this.#pendingDetachOwners.clear();
        this.#sceneSlicesByPhysicalIndex.length = 0;
        this.#draws.length = 0;
        this.#materials = new WeakMap();
        this.#plan = null;
        this.#target = null;
        this.#meshes = Object.freeze([]);
        this.#destroyed = true;
    }

    private ownerFor(camera: Camera, mesh: Mesh): object {
        let byMesh = this.#ownersByCamera.get(camera);
        if (byMesh === undefined) {
            byMesh = new Map<Mesh, object>();
            this.#ownersByCamera.set(camera, byMesh);
        }
        let owner = byMesh.get(mesh);
        if (owner === undefined) {
            owner = Object.freeze({ camera, mesh });
            byMesh.set(mesh, owner);
            this.#ownerRecords.set(owner, { owner, camera, mesh });
        }
        return owner;
    }

    private materialFor(source: Material): Material {
        let record = this.#materials.get(source);
        if (record === undefined) {
            const fallback = shadowMaterialProxy(source);
            const candidate = source.getShadowMaterial(fallback);
            if (!(candidate instanceof Material)) {
                throw new TypeError('Material.getShadowMaterial must return a Material');
            }
            record = {
                fallback,
                candidate,
                material: normalizeShadowMaterial(candidate)
            };
            this.#materials.set(source, record);
            return record.material;
        }
        const candidate = source.getShadowMaterial(record.fallback);
        if (!(candidate instanceof Material)) {
            throw new TypeError('Material.getShadowMaterial must return a Material');
        }
        if (candidate !== record.candidate) {
            record.candidate = candidate;
            record.material = normalizeShadowMaterial(candidate);
        }
        return record.material;
    }

    private flushPendingDetachOwners(): void {
        let detachError: unknown;
        for (const owner of this.#pendingDetachOwners) {
            const record = this.#ownerRecords.get(owner);
            if (record === undefined) {
                this.#pendingDetachOwners.delete(owner);
                continue;
            }
            try {
                this.processor.detachShadowDraw(owner);
                this.#pendingDetachOwners.delete(owner);
                this.#ownerRecords.delete(owner);
                const byMesh = this.#ownersByCamera.get(record.camera);
                byMesh?.delete(record.mesh);
                if (byMesh?.size === 0) this.#ownersByCamera.delete(record.camera);
            } catch (error) {
                detachError ??= error;
            }
        }
        if (detachError !== undefined) {
            throw detachError instanceof Error
                ? detachError
                : new Error('Shadow mesh owner detach failed');
        }
    }

    private assertAlive(): void {
        if (this.#destroyed) throw new Error('ShadowAtlasMeshPreparer is destroyed');
    }
}
