import type Camera from '../../camera/Camera';
import Mesh from '../../core/Mesh';
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
    readonly #configuredCameras = new Set<Camera>();
    readonly #configuredMeshes = new Set<Mesh>();
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
        this.#configuredCameras.clear();
        for (const slice of plan.slices) {
            if (this.#sceneSlicesByPhysicalIndex[slice.physicalIndex] !== undefined) {
                throw new TypeError('Shadow scene plan contains a duplicate physical slice');
            }
            this.#sceneSlicesByPhysicalIndex[slice.physicalIndex] = slice;
            this.#configuredCameras.add(slice.camera);
        }
        this.#configuredMeshes.clear();
        for (const mesh of meshes) {
            if (mesh.castShadows && mesh.material !== null) this.#configuredMeshes.add(mesh);
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
        else this.processor.beginContextPass(context);
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
            if (!(mesh instanceof Mesh) || sourceMaterial === null || !mesh.castShadows) continue;
            const owner = this.ownerFor(sceneSlice.camera, mesh);
            this.#usedOwners.add(owner);
            this.#pendingDetachOwners.delete(owner);
            this.#draws.push(this.processor.prepareShadow(owner, mesh, this.#target));
        }
        return this.#draws;
    }

    end(): void {
        if (!this.#active) return;
        this.#active = false;
        for (const owner of this.#ownerRecords.keys()) {
            if (this.#usedOwners.has(owner)) continue;
            const record = this.#ownerRecords.get(owner);
            if (
                record !== undefined &&
                this.#configuredCameras.has(record.camera) &&
                this.#configuredMeshes.has(record.mesh)
            ) {
                continue;
            }
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
        this.#configuredCameras.clear();
        this.#configuredMeshes.clear();
        this.#sceneSlicesByPhysicalIndex.length = 0;
        this.#draws.length = 0;
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
