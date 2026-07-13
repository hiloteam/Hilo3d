import { EventDispatcher } from '../core/EventMixin';
import Mesh from '../core/Mesh';
import type Node from '../core/Node';

export interface ManagedResource {
    readonly id?: string;
    readonly alwaysUse?: boolean;
    destroy(): unknown;
    getResources?(resources?: ManagedResource[]): ManagedResource[];
}

/** Tracks GPU resources referenced by meshes and releases unreferenced entries. */
class WebGLResourceManager extends EventDispatcher {
    readonly className = 'WebGLResourceManager';
    readonly isWebGLResourceManager = true;

    private readonly needDestroyResources: ManagedResource[] = [];
    private readonly meshResources = new Map<string, ManagedResource[]>();

    get hasNeedDestroyResource(): boolean {
        return this.needDestroyResources.length > 0;
    }

    destroyMesh(mesh: Mesh): void {
        for (const resource of this.getMeshResources(mesh)) this.destroyIfNoRef(resource);
        this.meshResources.delete(mesh.id);
    }

    getMeshResources(mesh: Mesh, resources: ManagedResource[] = []): ManagedResource[] {
        const directResources = this.meshResources.get(mesh.id);
        if (!directResources) return resources;
        for (const resource of directResources) {
            resources.push(resource);
            resource.getResources?.(resources);
        }
        return resources;
    }

    addMeshResources(mesh: Mesh, resources: readonly ManagedResource[]): void {
        let directResources = this.meshResources.get(mesh.id);
        if (!directResources) {
            directResources = [];
            this.meshResources.set(mesh.id, directResources);
        }
        for (const resource of resources) {
            if (!directResources.includes(resource)) directResources.push(resource);
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
}

export default WebGLResourceManager;
