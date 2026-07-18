import type ComputeSampler from '../compute/ComputeSampler';
import type { RHISampler, RHISamplerDescriptor } from '../rhi/core';
import type { ResourceRegistry, ResourceRegistryHandle } from './ResourceRegistry';

/** Renderer-local recovery-aware sampler cache keyed by immutable ComputeSampler identity. */
export class ComputeSamplerResourceCache {
    #handles = new WeakMap<ComputeSampler, ResourceRegistryHandle<RHISampler>>();
    readonly #samplers = new Set<ComputeSampler>();
    #destroyed = false;

    constructor(readonly registry: ResourceRegistry) {}

    prepare(sampler: ComputeSampler): ResourceRegistryHandle<RHISampler> {
        this.assertAlive();
        const existing = this.#handles.get(sampler);
        if (existing !== undefined) return existing;
        const descriptor: Readonly<RHISamplerDescriptor> = Object.freeze({
            label: sampler.label,
            lifetime: 'persistent',
            addressModeU: sampler.addressModeU,
            addressModeV: sampler.addressModeV,
            addressModeW: sampler.addressModeW,
            magFilter: sampler.magFilter,
            minFilter: sampler.minFilter,
            mipmapFilter: sampler.mipmapFilter,
            lodMinClamp: sampler.lodMinClamp,
            lodMaxClamp: sampler.lodMaxClamp,
            ...(sampler.compare === undefined ? {} : { compare: sampler.compare }),
            maxAnisotropy: sampler.maxAnisotropy
        });
        const handle = this.registry.registerSampler(descriptor);
        this.#handles.set(sampler, handle);
        this.#samplers.add(sampler);
        return handle;
    }

    resolve(sampler: ComputeSampler): RHISampler {
        const handle = this.#handles.get(sampler);
        if (handle === undefined) throw new Error('ComputeSampler is not prepared');
        return this.registry.resolve(handle);
    }

    markUsed(sampler: ComputeSampler, frameIndex: number): void {
        const handle = this.#handles.get(sampler);
        if (handle === undefined) throw new Error('ComputeSampler is not prepared');
        this.registry.markUsed(handle, frameIndex);
    }

    detach(sampler: ComputeSampler): boolean {
        this.assertAlive();
        const handle = this.#handles.get(sampler);
        if (handle === undefined) return false;
        this.#handles.delete(sampler);
        this.#samplers.delete(sampler);
        this.registry.release(handle);
        return true;
    }

    destroy(): void {
        if (this.#destroyed) return;
        for (const sampler of this.#samplers) {
            const handle = this.#handles.get(sampler);
            if (handle !== undefined) this.registry.release(handle);
        }
        this.#samplers.clear();
        this.#handles = new WeakMap();
        this.#destroyed = true;
    }

    private assertAlive(): void {
        if (this.#destroyed) throw new Error('Compute sampler resource cache is destroyed');
    }
}
