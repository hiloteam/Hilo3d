import { rebaseTextureExternalAllocation, type default as Texture } from '../../texture/Texture';
import { isTexturePixelData, texturePixelDataToTypedArray } from '../../texture/texturePixelData';
import { RGBA, UNSIGNED_BYTE } from '../../constants/webgl';
import type { RHIUploadBatch, RHIUploadBatchParticipant } from '../frame/RHIUploadBatch';
import {
    RHITextureUsage,
    isRHIExternalImageSource,
    type RHISampler,
    type RHISubmission,
    type RHITexture,
    type RHITextureFormat,
    type RHITextureView
} from '../rhi/core';
import type {
    ExternalTextureBindingProvider,
    ExternalTextureGraphDependency,
    ExternalTextureSamplerKind
} from './ExternalTextureBindingRegistry';
import type { RHIRenderTarget } from './RHIRenderTarget';
import type { ResourceRegistry, ResourceRegistryHandle } from './ResourceRegistry';
import type { ShaderSampledBindingResources } from './ShaderBindGroupResourceCache';

interface MutableSampledBindingResources {
    textureView: ResourceRegistryHandle<RHITextureView>;
    sampler: ResourceRegistryHandle<RHISampler>;
}

interface AttachmentAllocation {
    readonly registryGeneration: number;
    readonly deviceGeneration: number;
    readonly targetRevision: number;
    readonly textureHandle: ResourceRegistryHandle<RHITexture>;
    readonly texture: RHITexture;
    readonly viewHandle: ResourceRegistryHandle<RHITextureView>;
    readonly format: RHITextureFormat;
}

interface PendingAttachmentUpdate extends AttachmentAllocation {
    readonly sourceRevision: number;
}

export interface RenderTargetTextureBindingProviderOptions {
    readonly target: RHIRenderTarget;
    /** `null` identifies the sampled depth attachment. */
    readonly attachmentIndex: number | null;
    readonly texture: Texture<unknown>;
    readonly registry: ResourceRegistry;
    readonly sampler: ResourceRegistryHandle<RHISampler> | null;
    readonly comparisonSampler: ResourceRegistryHandle<RHISampler> | null;
    readonly getUploadBatch: () => RHIUploadBatch;
}

function colorFormatBytesPerPixel(format: RHITextureFormat): number {
    switch (format) {
        case 'rgba8unorm':
        case 'rgba8unorm-srgb':
            return 4;
        case 'rgba16float':
            return 8;
        case 'rgba32float':
            return 16;
        default:
            throw new TypeError(
                `Public render-target color updates do not support ${format} storage`
            );
    }
}

/**
 * Bridges a public render-target Texture identity to its renderer-owned RHI attachment.
 *
 * Only incremental `updateSubTexture()` journal entries are replayable. A target allocation
 * replacement (resize or device recovery) deliberately rebases the backend-local revision:
 * partial patches cannot reconstruct the render pass content that was lost with the allocation.
 */
export class RenderTargetTextureBindingProvider
    implements ExternalTextureBindingProvider, RHIUploadBatchParticipant
{
    readonly target: RHIRenderTarget;
    readonly graphDependency: ExternalTextureGraphDependency;
    readonly #attachmentIndex: number | null;
    readonly #texture: Texture<unknown>;
    readonly #registry: ResourceRegistry;
    readonly #sampledResources: MutableSampledBindingResources | null;
    readonly #comparisonResources: MutableSampledBindingResources | null;
    readonly #getUploadBatch: () => RHIUploadBatch;

    #committedRevision: number;
    #allocation: AttachmentAllocation;
    #pending: PendingAttachmentUpdate | null = null;

    constructor(options: Readonly<RenderTargetTextureBindingProviderOptions>) {
        if (options.sampler === null && options.comparisonSampler === null) {
            throw new TypeError('Render-target texture binding requires at least one sampler');
        }
        this.target = options.target;
        this.#attachmentIndex = options.attachmentIndex;
        this.graphDependency = Object.freeze(
            options.attachmentIndex === null
                ? {
                      record: options.target.resourceRecord,
                      attachment: 'sampled-depth' as const
                  }
                : {
                      record: options.target.resourceRecord,
                      attachment: 'color' as const,
                      attachmentIndex: options.attachmentIndex
                  }
        );
        this.#texture = options.texture;
        this.#registry = options.registry;
        this.#getUploadBatch = options.getUploadBatch;
        this.#allocation = this.captureAllocation();
        this.#committedRevision = options.texture.updateRevision;
        this.#sampledResources =
            options.sampler === null
                ? null
                : { textureView: this.#allocation.viewHandle, sampler: options.sampler };
        this.#comparisonResources =
            options.comparisonSampler === null
                ? null
                : {
                      textureView: this.#allocation.viewHandle,
                      sampler: options.comparisonSampler
                  };
    }

    get committedRevision(): number {
        return this.#committedRevision;
    }

    get pendingRevision(): number | null {
        return this.#pending?.sourceRevision ?? null;
    }

    resolve(
        samplerKind: ExternalTextureSamplerKind
    ): Readonly<ShaderSampledBindingResources> | null {
        const resources =
            samplerKind === 'comparison-sampler'
                ? this.#comparisonResources
                : this.#sampledResources;
        if (resources === null) return null;
        const allocation = this.ensureCurrentAllocation();
        this.preparePublicUpdates(allocation);
        resources.textureView = allocation.viewHandle;
        return resources;
    }

    /**
     * Rebase immediately when resize/recovery replaces the attachment allocation. Historical
     * patches belong to the old rendered contents and must not be replayed into the blank resource.
     */
    rebaseAllocation(): void {
        if (this.#pending !== null) {
            throw new Error('Cannot replace a render-target attachment with updates in flight');
        }
        this.#allocation = this.captureAllocation();
        this.#committedRevision = this.#texture.updateRevision;
        // Idempotent with RHIRenderTarget.resize's dimension-boundary reset and also covers
        // same-size allocation replacement during device recovery.
        rebaseTextureExternalAllocation(this.#texture);
        if (this.#sampledResources !== null) {
            this.#sampledResources.textureView = this.#allocation.viewHandle;
        }
        if (this.#comparisonResources !== null) {
            this.#comparisonResources.textureView = this.#allocation.viewHandle;
        }
    }

    prepareCommit(submission: RHISubmission): void {
        const pending = this.#pending;
        if (pending === null) return;
        if (submission.status === 'failed') {
            throw submission.error instanceof Error
                ? submission.error
                : new Error('Cannot commit failed render-target texture updates');
        }
        if (
            submission.deviceId !== this.#registry.deviceId ||
            submission.deviceGeneration !== pending.deviceGeneration
        ) {
            throw new Error('Render-target texture update submission belongs to another device');
        }
        if (this.#texture.updateRevision !== pending.sourceRevision) {
            throw new Error('Render-target attachment texture changed after its first frame use');
        }
        const current = this.captureAllocation();
        if (
            current.registryGeneration !== pending.registryGeneration ||
            current.deviceGeneration !== pending.deviceGeneration ||
            current.targetRevision !== pending.targetRevision ||
            current.textureHandle !== pending.textureHandle ||
            current.texture !== pending.texture ||
            current.viewHandle !== pending.viewHandle
        ) {
            throw new Error('Render-target attachment allocation changed during its update frame');
        }
    }

    commit(submission: RHISubmission): void {
        const pending = this.#pending;
        if (pending === null) return;
        this.prepareCommit(submission);
        this.#committedRevision = pending.sourceRevision;
        this.#allocation = pending;
        this.#pending = null;
    }

    rollback(): void {
        this.#pending = null;
    }

    private preparePublicUpdates(allocation: AttachmentAllocation): void {
        const pending = this.#pending;
        if (pending !== null) {
            if (this.#texture.updateRevision !== pending.sourceRevision) {
                throw new Error(
                    'Render-target attachment texture changed after its first frame use'
                );
            }
            if (
                allocation.registryGeneration !== pending.registryGeneration ||
                allocation.deviceGeneration !== pending.deviceGeneration ||
                allocation.targetRevision !== pending.targetRevision ||
                allocation.textureHandle !== pending.textureHandle ||
                allocation.texture !== pending.texture
            ) {
                throw new Error(
                    'Render-target attachment allocation changed during its update frame'
                );
            }
            return;
        }

        if (this.#attachmentIndex === null) {
            if (this.#texture.updateRevision !== this.#committedRevision) {
                throw new TypeError(
                    'Public updates to render-target depth/stencil textures are unsupported'
                );
            }
            return;
        }

        const snapshot = this.#texture.getTextureUpdatesSince(this.#committedRevision);
        if (snapshot.revision === this.#committedRevision) return;
        if (snapshot.requiresFullUpload || snapshot.subTextures.length === 0) {
            throw new TypeError(
                'Render-target color attachments accept only incremental updateSubTexture() writes; full-content public updates cannot preserve existing rendered contents'
            );
        }
        if ((allocation.texture.usage & RHITextureUsage.COPY_DST) === 0) {
            throw new Error('Render-target readable color attachment lacks COPY_DST usage');
        }

        const pendingUpdate: PendingAttachmentUpdate = {
            ...allocation,
            sourceRevision: snapshot.revision
        };
        this.#pending = pendingUpdate;
        try {
            const uploads = this.#getUploadBatch();
            uploads.enlist(this);
            for (const update of snapshot.subTextures) {
                if (update.mipLevel !== 0) {
                    throw new RangeError(
                        'Render-target color attachments expose only mip level zero'
                    );
                }
                if (
                    update.face !== undefined ||
                    update.layer !== undefined ||
                    update.z !== undefined ||
                    update.depth !== undefined
                ) {
                    throw new TypeError('Render-target color attachments accept only 2D updates');
                }
                if (typeof ImageData !== 'undefined' && update.image instanceof ImageData) {
                    if (
                        (allocation.format !== 'rgba8unorm' &&
                            allocation.format !== 'rgba8unorm-srgb') ||
                        this.#texture.format !== RGBA ||
                        this.#texture.type !== UNSIGNED_BYTE
                    ) {
                        throw new TypeError(
                            'ImageData render-target updates require RGBA UNSIGNED_BYTE storage'
                        );
                    }
                    uploads.writeTexture(
                        {
                            texture: allocation.texture,
                            mipLevel: 0,
                            origin: { x: update.x, y: update.y, z: 0 }
                        },
                        update.image.data,
                        { bytesPerRow: update.width * 4, rowsPerImage: update.height },
                        {
                            width: update.width,
                            height: update.height,
                            depthOrArrayLayers: 1
                        }
                    );
                    continue;
                }
                if (isRHIExternalImageSource(update.image)) {
                    if (
                        allocation.format !== 'rgba8unorm' &&
                        allocation.format !== 'rgba8unorm-srgb'
                    ) {
                        throw new TypeError(
                            'External-image render-target updates require rgba8unorm storage'
                        );
                    }
                    uploads.copyExternalImageToTexture(
                        { source: update.image, flipY: this.#texture.flipY },
                        {
                            texture: allocation.texture,
                            mipLevel: 0,
                            origin: { x: update.x, y: update.y, z: 0 },
                            premultipliedAlpha: this.#texture.premultiplyAlpha
                        },
                        {
                            width: update.width,
                            height: update.height,
                            depthOrArrayLayers: 1
                        }
                    );
                    continue;
                }
                if (!isTexturePixelData(update.image)) {
                    throw new TypeError('Render-target update source is not portable pixel data');
                }
                const data = texturePixelDataToTypedArray(update.image, this.#texture.type);
                const bytesPerRow = update.width * colorFormatBytesPerPixel(allocation.format);
                if (data.byteLength !== bytesPerRow * update.height) {
                    throw new RangeError(
                        'Render-target update byte length does not match its attachment format'
                    );
                }
                uploads.writeTexture(
                    {
                        texture: allocation.texture,
                        mipLevel: 0,
                        origin: { x: update.x, y: update.y, z: 0 }
                    },
                    data,
                    { bytesPerRow, rowsPerImage: update.height },
                    {
                        width: update.width,
                        height: update.height,
                        depthOrArrayLayers: 1
                    }
                );
            }
        } catch (error) {
            this.#pending = null;
            throw error;
        }
    }

    private ensureCurrentAllocation(): AttachmentAllocation {
        const current = this.captureAllocation();
        const previous = this.#allocation;
        if (
            current.registryGeneration !== previous.registryGeneration ||
            current.deviceGeneration !== previous.deviceGeneration ||
            current.targetRevision !== previous.targetRevision ||
            current.textureHandle !== previous.textureHandle ||
            current.texture !== previous.texture ||
            current.viewHandle !== previous.viewHandle
        ) {
            if (this.#pending !== null) {
                throw new Error(
                    'Render-target attachment allocation changed during its update frame'
                );
            }
            // Actual resize/recovery paths call rebaseAllocation() synchronously. This fallback
            // remains fail-safe for an out-of-band allocation replacement.
            this.#allocation = current;
            this.#committedRevision = this.#texture.updateRevision;
            rebaseTextureExternalAllocation(this.#texture);
        }
        return current;
    }

    private captureAllocation(): AttachmentAllocation {
        const record = this.target.resourceRecord;
        const attachmentIndex = this.#attachmentIndex;
        if (attachmentIndex !== null) {
            const attachment = record.colorAttachments[attachmentIndex];
            if (attachment === undefined) {
                throw new Error(`Render target lost color attachment ${String(attachmentIndex)}`);
            }
            return {
                registryGeneration: this.#registry.generation,
                deviceGeneration: this.#registry.deviceGeneration,
                targetRevision: record.revision,
                textureHandle: attachment.readableTexture,
                texture: this.#registry.resolve(attachment.readableTexture),
                viewHandle: attachment.readableView,
                format: attachment.format
            };
        }
        const depth = record.depthStencilAttachment;
        const viewHandle = depth?.sampledView ?? null;
        if (depth === null || viewHandle === null) {
            throw new Error('Render target lost its sampled depth attachment');
        }
        if (depth.attachmentLifetime !== 'persistent') {
            throw new Error('Sampled render-target depth attachment must be persistent');
        }
        return {
            registryGeneration: this.#registry.generation,
            deviceGeneration: this.#registry.deviceGeneration,
            targetRevision: record.revision,
            textureHandle: depth.texture,
            texture: this.#registry.resolve(depth.texture),
            viewHandle,
            format: depth.format
        };
    }
}
