import {
    RHITextureUsage,
    normalizeRHITextureDescriptor,
    type RHINormalizedTextureDescriptor,
    type RHISampler,
    type RHITexture,
    type RHITextureFormat,
    type RHITextureView
} from '../rhi/core';
import type { ResourceRegistry, ResourceRegistryHandle } from './ResourceRegistry';
import { assertShadowAtlasFormatSupported, type ShadowAtlasPlan } from './ShadowAtlasPlanner';
import type { CameraDepthMode } from '../../camera/Camera';
import { depthComparison } from './DepthConvention';

export interface ShadowAtlasResourceRecord {
    readonly token: number;
    readonly width: number;
    readonly height: number;
    readonly format: RHITextureFormat;
    readonly depthMode: CameraDepthMode;
    readonly texture: ResourceRegistryHandle<RHITexture>;
    readonly textureDescriptor: Readonly<RHINormalizedTextureDescriptor>;
    /** Persistent depth view consumed by reflected comparison-sampler bind groups. */
    readonly view: ResourceRegistryHandle<RHITextureView>;
    readonly comparisonSampler: ResourceRegistryHandle<RHISampler>;
}

interface ShadowAtlasOwnerRecord {
    readonly resource: Readonly<ShadowAtlasResourceRecord>;
}

function requireOwner(owner: unknown): void {
    if (owner === null || (typeof owner !== 'object' && typeof owner !== 'function')) {
        throw new TypeError('Shadow atlas resource owner must be a non-null object');
    }
}

/** Recoverable persistent atlas textures keyed by their renderer-level owner. */
export class ShadowAtlasResourceCache {
    #recordsByOwner = new WeakMap<object, ShadowAtlasOwnerRecord>();
    readonly #records = new Set<ShadowAtlasOwnerRecord>();
    #nextToken = 1;
    #destroyed = false;

    constructor(readonly registry: ResourceRegistry) {}

    prepare(
        owner: object,
        plan: Readonly<ShadowAtlasPlan>,
        depthMode: CameraDepthMode = 'standard'
    ): Readonly<ShadowAtlasResourceRecord> {
        this.assertAlive();
        requireOwner(owner);
        this.validatePlanShape(plan);
        const current = this.#recordsByOwner.get(owner);
        if (
            current?.resource.width === plan.width &&
            current.resource.height === plan.height &&
            current.resource.format === plan.format &&
            current.resource.depthMode === depthMode
        ) {
            return current.resource;
        }
        this.validatePlanCapabilities(plan);

        const token = this.allocateToken();
        const label = `Shadow atlas ${String(token)}`;
        const textureDescriptor = normalizeRHITextureDescriptor(
            {
                label,
                lifetime: 'persistent',
                size: { width: plan.width, height: plan.height },
                sampleCount: 1,
                dimension: '2d',
                viewDimension: '2d',
                format: plan.format,
                usage: RHITextureUsage.RENDER_ATTACHMENT | RHITextureUsage.TEXTURE_BINDING
            },
            this.registry.deviceCapabilities
        );
        const texture = this.registry.registerTexture(textureDescriptor);
        let view: ResourceRegistryHandle<RHITextureView> | undefined;
        let comparisonSampler: ResourceRegistryHandle<RHISampler> | undefined;
        try {
            view = this.registry.register<RHITextureView>({
                label: `${label} depth view`,
                dependencies: [texture],
                create: (_device, resolve) =>
                    resolve(texture).createView({
                        label: `${label} depth view`,
                        dimension: '2d',
                        aspect: 'depth-only',
                        baseMipLevel: 0,
                        mipLevelCount: 1,
                        baseArrayLayer: 0,
                        arrayLayerCount: 1
                    })
            });
            comparisonSampler = this.registry.registerSampler({
                label: `${label} comparison sampler`,
                lifetime: 'persistent',
                addressModeU: 'clamp-to-edge',
                addressModeV: 'clamp-to-edge',
                addressModeW: 'clamp-to-edge',
                magFilter: 'linear',
                minFilter: 'linear',
                mipmapFilter: 'nearest',
                lodMinClamp: 0,
                lodMaxClamp: 0,
                compare: depthComparison(depthMode),
                maxAnisotropy: 1
            });
        } catch (error) {
            if (comparisonSampler !== undefined) {
                this.registry.discardUnsubmitted(comparisonSampler);
            }
            if (view !== undefined) this.registry.discardUnsubmitted(view);
            this.registry.discardUnsubmitted(texture);
            throw error;
        }
        const replacement: ShadowAtlasOwnerRecord = {
            resource: Object.freeze({
                token,
                width: plan.width,
                height: plan.height,
                format: plan.format,
                depthMode,
                texture,
                textureDescriptor,
                view,
                comparisonSampler
            })
        };
        this.#recordsByOwner.set(owner, replacement);
        this.#records.add(replacement);
        if (current !== undefined) {
            this.#records.delete(current);
            this.releaseRecord(current);
        }
        return replacement.resource;
    }

    resolve(owner: object): RHITexture {
        this.assertAlive();
        return this.registry.resolve(this.requireRecord(owner).resource.texture);
    }

    resolveView(owner: object): RHITextureView {
        this.assertAlive();
        return this.registry.resolve(this.requireRecord(owner).resource.view);
    }

    resolveComparisonSampler(owner: object): RHISampler {
        this.assertAlive();
        return this.registry.resolve(this.requireRecord(owner).resource.comparisonSampler);
    }

    markUsed(owner: object, frameIndex: number): void {
        this.assertAlive();
        const resource = this.requireRecord(owner).resource;
        this.registry.markUsed(resource.texture, frameIndex);
        this.registry.markUsed(resource.view, frameIndex);
        this.registry.markUsed(resource.comparisonSampler, frameIndex);
    }

    detach(owner: object): boolean {
        this.assertAlive();
        const record = this.#recordsByOwner.get(owner);
        if (record === undefined) return false;
        this.#recordsByOwner.delete(owner);
        this.#records.delete(record);
        this.releaseRecord(record);
        return true;
    }

    destroy(): void {
        if (this.#destroyed) return;
        for (const record of this.#records) this.releaseRecord(record);
        this.#records.clear();
        this.#recordsByOwner = new WeakMap();
        this.#destroyed = true;
    }

    private validatePlanShape(plan: Readonly<ShadowAtlasPlan>): void {
        if (plan.sliceCount === 0) {
            throw new RangeError('Cannot allocate a shadow atlas for an empty plan');
        }
        if (plan.slices.length !== plan.sliceCount) {
            throw new TypeError('Shadow atlas plan sliceCount does not match its slice storage');
        }
        if (!Number.isSafeInteger(plan.width) || plan.width <= 0) {
            throw new RangeError('Shadow atlas width must be a positive safe integer');
        }
        if (!Number.isSafeInteger(plan.height) || plan.height <= 0) {
            throw new RangeError('Shadow atlas height must be a positive safe integer');
        }
    }

    private validatePlanCapabilities(plan: Readonly<ShadowAtlasPlan>): void {
        const maximumDimension = this.registry.deviceCapabilities.limits.maxTextureDimension2D;
        if (plan.width > maximumDimension || plan.height > maximumDimension) {
            throw new RangeError(
                `Shadow atlas ${String(plan.width)}x${String(plan.height)} exceeds maxTextureDimension2D ${String(maximumDimension)}`
            );
        }
        assertShadowAtlasFormatSupported(this.registry.deviceCapabilities, plan.format);
    }

    private requireRecord(owner: object): ShadowAtlasOwnerRecord {
        const record = this.#recordsByOwner.get(owner);
        if (record === undefined) {
            throw new Error('Owner is not prepared in this shadow atlas resource cache');
        }
        return record;
    }

    private releaseRecord(record: ShadowAtlasOwnerRecord): void {
        this.registry.release(record.resource.comparisonSampler);
        this.registry.release(record.resource.view);
        this.registry.release(record.resource.texture);
    }

    private allocateToken(): number {
        const token = this.#nextToken;
        if (!Number.isSafeInteger(token)) {
            throw new RangeError('Shadow atlas resource token space is exhausted');
        }
        this.#nextToken++;
        return token;
    }

    private assertAlive(): void {
        if (this.#destroyed) throw new Error('Shadow atlas resource cache is destroyed');
    }
}
