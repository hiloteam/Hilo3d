import { EventDispatcher } from '../core/EventDispatcher';
import Mesh from '../core/Mesh';
import type Node from '../core/Node';

export interface ManagedResource {
    readonly id?: string;
    readonly alwaysUse?: boolean;
    destroy(): unknown;
    getResources?(resources?: ManagedResource[]): ManagedResource[];
}

/** Tracks graphics resources shared by meshes and releases entries after their final reference. */
class GraphicsResourceManager extends EventDispatcher {
    readonly className = 'GraphicsResourceManager';
    readonly isGraphicsResourceManager = true;

    private readonly needDestroyResources: ManagedResource[] = [];
    private readonly meshResources = new Map<string, ManagedResource[]>();
    private frameResources: Map<string, Set<ManagedResource>> | null = null;

    get hasNeedDestroyResource(): boolean {
        return this.needDestroyResources.length > 0;
    }

    destroyMesh(mesh: Mesh): void {
        const resources = new Set(this.meshResources.get(mesh.id) ?? []);
        for (const resource of this.frameResources?.get(mesh.id) ?? []) resources.add(resource);
        for (const resource of resources) this.destroyIfNoRef(resource);
        this.meshResources.delete(mesh.id);
        this.frameResources?.delete(mesh.id);
    }

    getMeshResources(mesh: Mesh, resources: ManagedResource[] = []): ManagedResource[] {
        const seenResources = new Set(resources);
        const snapshot = this.meshResources.get(mesh.id);
        for (const resource of snapshot ?? []) {
            if (seenResources.has(resource)) continue;
            seenResources.add(resource);
            resources.push(resource);
        }
        for (const resource of this.frameResources?.get(mesh.id) ?? []) {
            if (seenResources.has(resource)) continue;
            seenResources.add(resource);
            resources.push(resource);
        }
        return resources;
    }

    addMeshResources(mesh: Mesh, resources: readonly ManagedResource[]): void {
        const currentResources = this.flattenResources(resources);
        if (this.frameResources) {
            let pendingResources = this.frameResources.get(mesh.id);
            if (!pendingResources) {
                pendingResources = new Set();
                this.frameResources.set(mesh.id, pendingResources);
            }
            for (const resource of currentResources) pendingResources.add(resource);
            return;
        }

        this.commitMeshResources(mesh.id, currentResources);
    }

    /** Begin an atomic frame-level resource snapshot. */
    beginFrame(): this {
        if (this.frameResources) {
            throw new Error('A graphics resource frame is already active');
        }
        this.frameResources = new Map();
        return this;
    }

    /** Commit resources accumulated across every pass in the active frame. */
    endFrame(): this {
        const frameResources = this.frameResources;
        if (!frameResources) throw new Error('No graphics resource frame is active');
        this.frameResources = null;
        for (const [meshId, resources] of frameResources) {
            this.commitMeshResources(meshId, resources);
        }
        return this;
    }

    /** Discard an incomplete frame and retire resources absent from every complete snapshot. */
    abortFrame(): this {
        const frameResources = this.frameResources;
        this.frameResources = null;
        if (!frameResources) return this;

        const committedResources = new Set<ManagedResource>();
        for (const resources of this.meshResources.values()) {
            for (const resource of resources) committedResources.add(resource);
        }
        for (const resources of frameResources.values()) {
            for (const resource of resources) {
                if (!committedResources.has(resource)) this.destroyIfNoRef(resource);
            }
        }
        return this;
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

    private commitMeshResources(
        meshId: string,
        currentResources: ReadonlySet<ManagedResource>
    ): void {
        const previousResources = this.meshResources.get(meshId) ?? [];
        this.meshResources.set(meshId, [...currentResources]);
        for (const resource of previousResources) {
            if (!currentResources.has(resource)) this.destroyIfNoRef(resource);
        }
    }

    destroyIfNoRef(resource: ManagedResource): this {
        if (!this.needDestroyResources.includes(resource)) this.needDestroyResources.push(resource);
        return this;
    }

    getUsedResources(rootNode?: Node): ManagedResource[] {
        const resources: ManagedResource[] = [];
        rootNode?.traverse(node => {
            if (node instanceof Mesh && !node.isDestroyed) this.getMeshResources(node, resources);
        });
        return resources;
    }

    destroyUnusedResource(rootNode?: Node): this {
        if (this.needDestroyResources.length === 0) return this;
        const usedResources = new Set(this.getUsedResources(rootNode));
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
        this.meshResources.clear();
        return this.reset();
    }
}

export default GraphicsResourceManager;
