import { EventDispatcher } from '../core/EventDispatcher';
import type Mesh from '../core/Mesh';
import type { RendererResourceDiagnostics } from './Renderer';
import type { RenderWorld } from './world/RenderWorld';

export interface ManagedResource {
    readonly id?: string;
    readonly alwaysUse?: boolean;
    destroy(): unknown;
    getResources?(resources?: ManagedResource[]): ManagedResource[];
}

/**
 * Stable identity for one render variant of a mesh.
 *
 * `pass` owns the lifetime of target-specific variants. `key` separates material, shader and
 * instancing permutations within that pass. Renderers must reuse both values while a variant is
 * reusable.
 */
export interface MeshResourceVariant {
    readonly key: string;
    readonly pass?: object;
}

export interface GraphicsResourceManagerParameters {
    /** Deterministic per-mesh LRU bound for live render variants. */
    readonly maxVariantsPerMesh?: number;
}

interface MeshResourceVariantSnapshot {
    readonly key: string;
    readonly pass: object;
    readonly resources: readonly ManagedResource[];
    readonly lastUsed: number;
}

interface MeshResourceState {
    /** The public mesh owners, excluding temporary force-material passes. */
    readonly material: Mesh['material'];
    readonly geometry: Mesh['geometry'];
    readonly variants: ReadonlyMap<object, ReadonlyMap<string, MeshResourceVariantSnapshot>>;
}

interface MutableMeshResourceState {
    material: Mesh['material'];
    geometry: Mesh['geometry'];
    variants: Map<object, Map<string, MeshResourceVariantSnapshot>>;
}

const DEFAULT_MAX_VARIANTS_PER_MESH = 32;

function validateMaxVariantsPerMesh(value: number): void {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new RangeError('maxVariantsPerMesh must be a positive safe integer');
    }
}

/** Tracks graphics resources shared by mesh render variants and releases final references. */
class GraphicsResourceManager extends EventDispatcher {
    readonly className = 'GraphicsResourceManager';
    readonly isGraphicsResourceManager = true;

    private readonly needDestroyResources: ManagedResource[] = [];
    private readonly meshResources = new Map<string, MeshResourceState>();
    private readonly defaultPass = {};
    private readonly maxVariantsPerMesh: number;
    private frameResources: Map<string, MutableMeshResourceState> | null = null;
    private frameTouchedResources: Set<ManagedResource> | null = null;
    private frameDestroyedMeshes: Set<string> | null = null;
    private usageSequence = 0;

    constructor(parameters: GraphicsResourceManagerParameters = {}) {
        super();
        const maxVariantsPerMesh = parameters.maxVariantsPerMesh ?? DEFAULT_MAX_VARIANTS_PER_MESH;
        validateMaxVariantsPerMesh(maxVariantsPerMesh);
        this.maxVariantsPerMesh = maxVariantsPerMesh;
    }

    get hasNeedDestroyResource(): boolean {
        return this.needDestroyResources.length > 0;
    }

    destroyMesh(mesh: Mesh): void {
        // Shared renderer resource caches are not represented by legacy ManagedResource wrappers.
        // Publish the same explicit mesh lifetime boundary so they can detach their logical RHI
        // recipes without teaching this backend-neutral manager about either implementation.
        this.fire('destroyMesh', mesh);
        const resources = new Set<ManagedResource>();
        this.addStateResources(this.meshResources.get(mesh.id), resources);
        this.addStateResources(this.frameResources?.get(mesh.id), resources);
        for (const resource of resources) this.destroyIfNoRef(resource);
        this.meshResources.delete(mesh.id);
        this.frameResources?.delete(mesh.id);
        this.frameDestroyedMeshes?.add(mesh.id);
    }

    getMeshResources(mesh: Mesh, resources: ManagedResource[] = []): ManagedResource[] {
        const seenResources = new Set(resources);
        this.appendStateResources(this.meshResources.get(mesh.id), resources, seenResources);
        this.appendStateResources(this.frameResources?.get(mesh.id), resources, seenResources);
        return resources;
    }

    addMeshResources(
        mesh: Mesh,
        resources: readonly ManagedResource[],
        variant: MeshResourceVariant = { key: 'default' }
    ): void {
        if (!variant.key) throw new TypeError('A mesh resource variant requires a non-empty key');
        const currentResources = this.flattenResources(resources);
        const pass = variant.pass ?? this.defaultPass;
        const next = this.createWritableState(mesh);
        let passVariants = next.variants.get(pass);
        if (!passVariants) {
            passVariants = new Map();
            next.variants.set(pass, passVariants);
        }
        passVariants.set(variant.key, {
            key: variant.key,
            pass,
            resources: [...currentResources],
            lastUsed: ++this.usageSequence
        });
        this.trimVariants(next);

        if (this.frameResources) {
            this.frameResources.set(mesh.id, next);
            const touched = this.frameTouchedResources;
            if (!touched) throw new Error('Graphics resource frame tracking is unavailable');
            for (const resource of currentResources) touched.add(resource);
            return;
        }
        this.commitMeshState(mesh.id, next);
    }

    /** Remove one material/shader permutation without disturbing sibling pass variants. */
    removeMeshVariant(mesh: Mesh, variant: MeshResourceVariant): this {
        const current = this.frameResources?.get(mesh.id) ?? this.meshResources.get(mesh.id);
        if (!current) return this;
        const pass = variant.pass ?? this.defaultPass;
        if (!current.variants.get(pass)?.has(variant.key)) return this;
        const next = this.cloneState(current);
        const passVariants = next.variants.get(pass);
        passVariants?.delete(variant.key);
        if (passVariants?.size === 0) next.variants.delete(pass);
        if (this.frameResources) this.frameResources.set(mesh.id, next);
        else this.commitMeshState(mesh.id, next);
        return this;
    }

    /** Release every mesh variant owned by a render pass, normally a destroyed RenderTarget. */
    releasePass(pass: object): this {
        const meshIds = new Set(this.meshResources.keys());
        for (const meshId of this.frameResources?.keys() ?? []) meshIds.add(meshId);
        for (const meshId of meshIds) {
            if (this.frameDestroyedMeshes?.has(meshId)) continue;
            const current = this.frameResources?.get(meshId) ?? this.meshResources.get(meshId);
            if (!current?.variants.has(pass)) continue;
            const next = this.cloneState(current);
            next.variants.delete(pass);
            if (this.frameResources) this.frameResources.set(meshId, next);
            else this.commitMeshState(meshId, next);
        }
        return this;
    }

    /** Begin an atomic frame-level variant update. */
    beginFrame(): this {
        if (this.frameResources) {
            throw new Error('A graphics resource frame is already active');
        }
        this.frameResources = new Map();
        this.frameTouchedResources = new Set();
        this.frameDestroyedMeshes = new Set();
        return this;
    }

    /** Commit only variants touched in the active render; all other live variants remain cached. */
    endFrame(): this {
        const frameResources = this.frameResources;
        const touchedResources = this.frameTouchedResources;
        const destroyedMeshes = this.frameDestroyedMeshes;
        if (!frameResources || !touchedResources || !destroyedMeshes) {
            throw new Error('No graphics resource frame is active');
        }
        this.frameResources = null;
        this.frameTouchedResources = null;
        this.frameDestroyedMeshes = null;
        for (const [meshId, state] of frameResources) {
            if (!destroyedMeshes.has(meshId)) this.commitMeshState(meshId, state);
        }
        const committedResources = this.getTrackedResourceSet();
        for (const resource of touchedResources) {
            if (!committedResources.has(resource)) this.destroyIfNoRef(resource);
        }
        return this;
    }

    /** Discard incomplete variant updates without changing the last complete snapshots. */
    abortFrame(): this {
        const touchedResources = this.frameTouchedResources;
        this.frameResources = null;
        this.frameTouchedResources = null;
        this.frameDestroyedMeshes = null;
        if (!touchedResources) return this;

        const committedResources = this.getTrackedResourceSet();
        for (const resource of touchedResources) {
            if (!committedResources.has(resource)) this.destroyIfNoRef(resource);
        }
        return this;
    }

    private createWritableState(mesh: Mesh): MutableMeshResourceState {
        if (this.frameDestroyedMeshes?.has(mesh.id)) {
            throw new Error(`Cannot add graphics resources for destroyed mesh ${mesh.id}`);
        }
        const current = this.frameResources?.get(mesh.id) ?? this.meshResources.get(mesh.id);
        if (current?.material !== mesh.material || current.geometry !== mesh.geometry) {
            return {
                material: mesh.material,
                geometry: mesh.geometry,
                variants: new Map()
            };
        }
        return this.cloneState(current);
    }

    private cloneState(state: MeshResourceState): MutableMeshResourceState {
        const variants = new Map<object, Map<string, MeshResourceVariantSnapshot>>();
        for (const [pass, passVariants] of state.variants) {
            variants.set(pass, new Map(passVariants));
        }
        return { material: state.material, geometry: state.geometry, variants };
    }

    private flattenResources(resources: readonly ManagedResource[]): Set<ManagedResource> {
        const flattened = new Set<ManagedResource>();
        const addResource = (resource: ManagedResource): void => {
            if (flattened.has(resource)) return;
            flattened.add(resource);
            for (const nestedResource of resource.getResources?.([]) ?? []) {
                addResource(nestedResource);
            }
        };
        for (const resource of resources) addResource(resource);
        return flattened;
    }

    private trimVariants(state: MutableMeshResourceState): void {
        const variants: MeshResourceVariantSnapshot[] = [];
        for (const passVariants of state.variants.values()) {
            for (const variant of passVariants.values()) variants.push(variant);
        }
        variants.sort((first, second) => first.lastUsed - second.lastUsed);
        while (variants.length > this.maxVariantsPerMesh) {
            const oldest = variants.shift();
            if (!oldest) break;
            const passVariants = state.variants.get(oldest.pass);
            passVariants?.delete(oldest.key);
            if (passVariants?.size === 0) state.variants.delete(oldest.pass);
        }
    }

    private commitMeshState(meshId: string, current: MeshResourceState): void {
        const previous = this.meshResources.get(meshId);
        const currentResources = new Set<ManagedResource>();
        const previousResources = new Set<ManagedResource>();
        this.addStateResources(current, currentResources);
        this.addStateResources(previous, previousResources);
        if (current.variants.size === 0) this.meshResources.delete(meshId);
        else this.meshResources.set(meshId, current);
        for (const resource of previousResources) {
            if (!currentResources.has(resource)) this.destroyIfNoRef(resource);
        }
    }

    private appendStateResources(
        state: MeshResourceState | undefined,
        resources: ManagedResource[],
        seenResources: Set<ManagedResource>
    ): void {
        if (!state) return;
        for (const passVariants of state.variants.values()) {
            for (const variant of passVariants.values()) {
                for (const resource of variant.resources) {
                    if (seenResources.has(resource)) continue;
                    seenResources.add(resource);
                    resources.push(resource);
                }
            }
        }
    }

    private addStateResources(
        state: MeshResourceState | undefined,
        resources: Set<ManagedResource>
    ): void {
        if (!state) return;
        for (const passVariants of state.variants.values()) {
            for (const variant of passVariants.values()) {
                for (const resource of variant.resources) resources.add(resource);
            }
        }
    }

    private getTrackedResourceSet(): Set<ManagedResource> {
        const resources = new Set<ManagedResource>();
        for (const state of this.meshResources.values()) this.addStateResources(state, resources);
        return resources;
    }

    private getCurrentResourceSet(): Set<ManagedResource> {
        const resources = this.getTrackedResourceSet();
        for (const state of this.frameResources?.values() ?? []) {
            this.addStateResources(state, resources);
        }
        return resources;
    }

    destroyIfNoRef(resource: ManagedResource): this {
        if (!this.needDestroyResources.includes(resource)) this.needDestroyResources.push(resource);
        return this;
    }

    getUsedResources(renderWorld?: RenderWorld): ManagedResource[] {
        if (!renderWorld) return [...this.getTrackedResourceSet()];
        const resources: ManagedResource[] = [];
        for (let index = 0; index < renderWorld.length; index++) {
            const mesh = renderWorld.meshes[index];
            if (mesh) this.getMeshResources(mesh, resources);
        }
        return resources;
    }

    /** Return stable backend-neutral lifecycle counts for diagnostics and tooling. */
    getDiagnostics(renderWorld?: RenderWorld): RendererResourceDiagnostics {
        const meshIds = new Set(this.meshResources.keys());
        const trackedResources = this.getTrackedResourceSet();
        for (const [meshId, state] of this.frameResources ?? []) {
            meshIds.add(meshId);
            this.addStateResources(state, trackedResources);
        }
        const usedResourceCount = renderWorld
            ? new Set(this.getUsedResources(renderWorld)).size
            : trackedResources.size;
        return Object.freeze({
            trackedMeshCount: meshIds.size,
            trackedResourceCount: trackedResources.size,
            usedResourceCount,
            pendingDestroyCount: new Set(this.needDestroyResources).size,
            frameActive: this.frameResources !== null
        });
    }

    destroyUnusedResource(_renderWorld?: RenderWorld): this {
        if (this.needDestroyResources.length === 0) return this;
        // Resource ownership is renderer-wide: a program, shader or buffer may be shared by meshes
        // rendered through different scene roots. A queued resource is safe to destroy only after
        // the final committed/pending variant reference has gone away.
        const usedResources = this.getCurrentResourceSet();
        for (const resource of this.needDestroyResources) {
            if (!usedResources.has(resource) && !resource.alwaysUse) {
                this.fire('destroyResource', resource.id);
                resource.destroy();
            }
        }
        return this.reset();
    }

    reset(): this {
        this.needDestroyResources.length = 0;
        return this;
    }

    /** Forget all scene references after the backend has released every device allocation. */
    clear(): this {
        this.frameResources = null;
        this.frameTouchedResources = null;
        this.frameDestroyedMeshes = null;
        this.meshResources.clear();
        return this.reset();
    }
}

export default GraphicsResourceManager;
