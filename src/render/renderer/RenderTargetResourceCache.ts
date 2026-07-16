import {
    RHICacheCounter,
    RHITextureUsage,
    getRHITextureFormatBlockInfo,
    normalizeRHITextureDescriptor,
    rhiTextureFormatHasDepth,
    rhiTextureFormatHasStencil,
    type RHIBackend,
    type RHIDeviceOwnedDestroyable,
    type RHILoadOp,
    type RHINormalizedTextureDescriptor,
    type RHIStoreOp,
    type RHITexture,
    type RHITextureFormat,
    type RHITextureView
} from '../rhi/core';
import type { ResourceRegistry, ResourceRegistryHandle } from './ResourceRegistry';

export type RenderTargetMultisampleAttachmentLifetime = 'persistent' | 'graph-transient';

export interface RenderTargetResourceDescriptor {
    readonly label?: string;
    readonly width: number;
    readonly height: number;
    /** Continuous color attachments up to the active device limit. */
    readonly colorFormats: readonly RHITextureFormat[];
    readonly sampleCount?: number;
    /**
     * Ownership of multisampled render sources. `graph-transient` is valid only for sampleCount 4;
     * the cache still owns each single-sample resolve/readable texture.
     */
    readonly multisampleAttachmentLifetime?: RenderTargetMultisampleAttachmentLifetime;
    readonly depthStencilFormat?: RHITextureFormat | null;
    /** Creates a persistent depth-only view for sampling the single-sample depth attachment. */
    readonly depthStencilSampled?: boolean;
}

interface RenderTargetColorResourceBase {
    readonly format: RHITextureFormat;
    readonly textureDescriptor: Readonly<RHINormalizedTextureDescriptor>;
    /** Present exactly when `sampleCount` is four. */
    readonly resolveTarget: ResourceRegistryHandle<RHITexture> | null;
    readonly resolveDescriptor: Readonly<RHINormalizedTextureDescriptor> | null;
    /** Single-sample COPY_SRC attachment consumed by post-process/copy/readback passes. */
    readonly readableTexture: ResourceRegistryHandle<RHITexture>;
    readonly readableDescriptor: Readonly<RHINormalizedTextureDescriptor>;
    /** Recoverable persistent default view used by fullscreen sampling/bind-group caches. */
    readonly readableView: ResourceRegistryHandle<RHITextureView>;
}

/** A null source handle is legal only for graph-owned multisampled attachments. */
export type RenderTargetColorResource = RenderTargetColorResourceBase &
    (
        | {
              readonly attachmentLifetime: 'persistent';
              /** Multisampled render attachment, or the persistent single-sample attachment. */
              readonly texture: ResourceRegistryHandle<RHITexture>;
          }
        | {
              readonly attachmentLifetime: 'graph-transient';
              /** The graph creates this source from `textureDescriptor` for each execution. */
              readonly texture: null;
          }
    );

interface RenderTargetDepthStencilResourceBase {
    readonly format: RHITextureFormat;
    readonly textureDescriptor: Readonly<RHINormalizedTextureDescriptor>;
    /** Present exactly when `depthStencilSampled` was requested. */
    readonly sampledView: ResourceRegistryHandle<RHITextureView> | null;
}

export type RenderTargetDepthStencilResource = RenderTargetDepthStencilResourceBase &
    (
        | {
              readonly attachmentLifetime: 'persistent';
              readonly texture: ResourceRegistryHandle<RHITexture>;
          }
        | {
              readonly attachmentLifetime: 'graph-transient';
              readonly texture: null;
              readonly sampledView: null;
          }
    );

/**
 * Stable logical target identity. Resize replaces only its immutable allocation snapshot; recovery
 * replaces the concrete resources behind the same registry handles.
 */
export interface RenderTargetResourceRecord {
    readonly owner: object;
    readonly token: number;
    readonly revision: number;
    readonly label: string;
    readonly backend: RHIBackend;
    readonly width: number;
    readonly height: number;
    readonly sampleCount: 1 | 4;
    readonly multisampleAttachmentLifetime: RenderTargetMultisampleAttachmentLifetime;
    readonly colorAttachments: readonly RenderTargetColorResource[];
    readonly depthStencilAttachment: RenderTargetDepthStencilResource | null;
}

interface MutableRenderTargetResourceRecord extends RenderTargetResourceRecord {
    revision: number;
    label: string;
    width: number;
    height: number;
    sampleCount: 1 | 4;
    multisampleAttachmentLifetime: RenderTargetMultisampleAttachmentLifetime;
    colorAttachments: readonly RenderTargetColorResource[];
    depthStencilAttachment: RenderTargetDepthStencilResource | null;
}

interface NormalizedTargetDescriptor {
    readonly label: string;
    readonly width: number;
    readonly height: number;
    readonly colorFormats: readonly RHITextureFormat[];
    readonly sampleCount: 1 | 4;
    readonly multisampleAttachmentLifetime: RenderTargetMultisampleAttachmentLifetime;
    readonly depthStencilFormat: RHITextureFormat | null;
    readonly depthStencilSampled: boolean;
}

interface StagedTargetAllocation {
    readonly colors: readonly RenderTargetColorResource[];
    readonly depth: RenderTargetDepthStencilResource | null;
}

export interface ResolvedRenderTargetResources {
    readonly colors: readonly {
        readonly attachmentLifetime: RenderTargetMultisampleAttachmentLifetime;
        readonly texture: RHITexture | null;
        readonly resolveTarget: RHITexture | null;
        readonly readableTexture: RHITexture;
        readonly readableView: RHITextureView;
    }[];
    readonly depthStencilAttachment: RHITexture | null;
    readonly depthStencilView: RHITextureView | null;
}

export interface RenderTargetAttachmentOperationPolicy {
    readonly colorOperations?: readonly Readonly<{
        readonly loadOp?: RHILoadOp;
        readonly storeOp?: RHIStoreOp;
    }>[];
    readonly depthLoadOp?: RHILoadOp;
    readonly depthStoreOp?: RHIStoreOp;
    readonly stencilLoadOp?: RHILoadOp;
    readonly stencilStoreOp?: RHIStoreOp;
}

let nextRenderTargetToken = 1;

function allocateRenderTargetToken(): number {
    if (nextRenderTargetToken === Number.MAX_SAFE_INTEGER) {
        throw new RangeError('Render target identity space is exhausted');
    }
    return nextRenderTargetToken++;
}

function requirePositiveSafeInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new RangeError(`${name} must be a positive safe integer`);
    }
}

/** Conservative policy: a source is transient only when no multisample value crosses the graph. */
export function selectRenderTargetMultisampleAttachmentLifetime(
    target: Readonly<RenderTargetResourceDescriptor>,
    operations: Readonly<RenderTargetAttachmentOperationPolicy>
): RenderTargetMultisampleAttachmentLifetime {
    if ((target.sampleCount ?? 1) !== 4) return 'persistent';
    for (let index = 0; index < target.colorFormats.length; index += 1) {
        const attachment = operations.colorOperations?.[index];
        if ((attachment?.loadOp ?? 'clear') !== 'clear') return 'persistent';
        if ((attachment?.storeOp ?? 'discard') !== 'discard') return 'persistent';
    }
    const depthStencilFormat = target.depthStencilFormat ?? null;
    if (depthStencilFormat === null) return 'graph-transient';
    if (rhiTextureFormatHasDepth(depthStencilFormat)) {
        if ((operations.depthLoadOp ?? 'clear') !== 'clear') return 'persistent';
        if ((operations.depthStoreOp ?? 'discard') !== 'discard') return 'persistent';
    }
    if (rhiTextureFormatHasStencil(depthStencilFormat)) {
        if ((operations.stencilLoadOp ?? 'clear') !== 'clear') return 'persistent';
        if ((operations.stencilStoreOp ?? 'discard') !== 'discard') return 'persistent';
    }
    return 'graph-transient';
}

function sameDescriptor(
    record: Readonly<RenderTargetResourceRecord>,
    descriptor: Readonly<NormalizedTargetDescriptor>
): boolean {
    if (
        record.label !== descriptor.label ||
        record.width !== descriptor.width ||
        record.height !== descriptor.height ||
        record.sampleCount !== descriptor.sampleCount ||
        record.multisampleAttachmentLifetime !== descriptor.multisampleAttachmentLifetime ||
        record.colorAttachments.length !== descriptor.colorFormats.length ||
        record.depthStencilAttachment?.format !== (descriptor.depthStencilFormat ?? undefined) ||
        (record.depthStencilAttachment !== null &&
            record.depthStencilAttachment.sampledView !== null) !== descriptor.depthStencilSampled
    ) {
        return false;
    }
    for (let index = 0; index < descriptor.colorFormats.length; index += 1) {
        if (record.colorAttachments[index]?.format !== descriptor.colorFormats[index]) return false;
    }
    return true;
}

function discardUnsubmittedHandles(
    registry: ResourceRegistry,
    handles: readonly ResourceRegistryHandle<RHIDeviceOwnedDestroyable>[]
): void {
    for (let index = handles.length - 1; index >= 0; index -= 1) {
        const handle = handles[index];
        if (handle !== undefined) registry.discardUnsubmitted(handle);
    }
}

function releaseRecordHandles(
    registry: ResourceRegistry,
    record: Readonly<RenderTargetResourceRecord>
): void {
    for (const color of record.colorAttachments) {
        registry.release(color.readableView);
        if (color.texture !== null) registry.release(color.texture);
        if (color.resolveTarget !== null) registry.release(color.resolveTarget);
    }
    if (record.depthStencilAttachment !== null) {
        if (record.depthStencilAttachment.sampledView !== null) {
            registry.release(record.depthStencilAttachment.sampledView);
        }
        if (record.depthStencilAttachment.texture !== null) {
            registry.release(record.depthStencilAttachment.texture);
        }
    }
}

/**
 * Recoverable persistent attachments for user render targets.
 *
 * The cache owns registry references, not concrete RHI objects. Calling `ResourceRegistry.recover`
 * on another device of the same backend transparently rebuilds every attachment while preserving
 * both the target record and its logical handles.
 */
export class RenderTargetResourceCache {
    /** Attachment/view/resolve-plan lookup outcomes shared by WebGL2 and WebGPU. */
    readonly metrics = new RHICacheCounter();
    #recordsByOwner = new WeakMap<object, MutableRenderTargetResourceRecord>();
    readonly #records = new Set<MutableRenderTargetResourceRecord>();
    #destroyed = false;

    constructor(readonly registry: ResourceRegistry) {}

    prepare(
        owner: object,
        source: Readonly<RenderTargetResourceDescriptor>,
        multisampleAttachmentLifetime = source.multisampleAttachmentLifetime
    ): Readonly<RenderTargetResourceRecord> {
        this.assertAlive();
        const current = this.#recordsByOwner.get(owner);
        const token = current?.token ?? allocateRenderTargetToken();
        const descriptor = this.normalizeDescriptor(source, token, multisampleAttachmentLifetime);
        if (current !== undefined && sameDescriptor(current, descriptor)) {
            this.metrics.recordHit();
            return current;
        }
        if (current?.revision === Number.MAX_SAFE_INTEGER) {
            throw new RangeError('Render target revision space is exhausted');
        }

        const staged = this.stageAllocation(token, (current?.revision ?? 0) + 1, descriptor);
        if (current === undefined) {
            const record: MutableRenderTargetResourceRecord = Object.seal({
                owner,
                token,
                revision: 1,
                label: descriptor.label,
                backend: this.registry.deviceBackend,
                width: descriptor.width,
                height: descriptor.height,
                sampleCount: descriptor.sampleCount,
                multisampleAttachmentLifetime: descriptor.multisampleAttachmentLifetime,
                colorAttachments: staged.colors,
                depthStencilAttachment: staged.depth
            });
            this.#recordsByOwner.set(owner, record);
            this.#records.add(record);
            this.metrics.recordMiss();
            this.metrics.recordInsertion();
            return record;
        }

        releaseRecordHandles(this.registry, current);
        current.revision++;
        current.label = descriptor.label;
        current.width = descriptor.width;
        current.height = descriptor.height;
        current.sampleCount = descriptor.sampleCount;
        current.multisampleAttachmentLifetime = descriptor.multisampleAttachmentLifetime;
        current.colorAttachments = staged.colors;
        current.depthStencilAttachment = staged.depth;
        this.metrics.recordMiss();
        this.metrics.recordReplacement();
        return current;
    }

    resize(owner: object, width: number, height: number): Readonly<RenderTargetResourceRecord> {
        this.assertAlive();
        const current = this.#recordsByOwner.get(owner);
        if (current === undefined) throw new Error('Render target owner is not prepared');
        return this.prepare(owner, {
            label: current.label,
            width,
            height,
            colorFormats: current.colorAttachments.map(attachment => attachment.format),
            sampleCount: current.sampleCount,
            multisampleAttachmentLifetime: current.multisampleAttachmentLifetime,
            depthStencilFormat: current.depthStencilAttachment?.format ?? null,
            depthStencilSampled: (current.depthStencilAttachment?.sampledView ?? null) !== null
        });
    }

    resolve(record: Readonly<RenderTargetResourceRecord>): ResolvedRenderTargetResources {
        const current = this.requireRecord(record);
        const colors = current.colorAttachments.map(attachment =>
            Object.freeze({
                attachmentLifetime: attachment.attachmentLifetime,
                texture:
                    attachment.texture === null ? null : this.registry.resolve(attachment.texture),
                resolveTarget:
                    attachment.resolveTarget === null
                        ? null
                        : this.registry.resolve(attachment.resolveTarget),
                readableTexture: this.registry.resolve(attachment.readableTexture),
                readableView: this.registry.resolve(attachment.readableView)
            })
        );
        const sampledDepthView = current.depthStencilAttachment?.sampledView ?? null;
        const depthTexture = current.depthStencilAttachment?.texture;
        return Object.freeze({
            colors: Object.freeze(colors),
            depthStencilAttachment:
                depthTexture === null || depthTexture === undefined
                    ? null
                    : this.registry.resolve(depthTexture),
            depthStencilView:
                sampledDepthView === null ? null : this.registry.resolve(sampledDepthView)
        });
    }

    markUsed(record: Readonly<RenderTargetResourceRecord>, frameIndex: number): void {
        const current = this.requireRecord(record);
        for (const color of current.colorAttachments) {
            if (color.texture !== null) this.registry.markUsed(color.texture, frameIndex);
            if (color.resolveTarget !== null) {
                this.registry.markUsed(color.resolveTarget, frameIndex);
            }
            this.registry.markUsed(color.readableView, frameIndex);
        }
        if (current.depthStencilAttachment !== null) {
            if (current.depthStencilAttachment.texture !== null) {
                this.registry.markUsed(current.depthStencilAttachment.texture, frameIndex);
            }
            if (current.depthStencilAttachment.sampledView !== null) {
                this.registry.markUsed(current.depthStencilAttachment.sampledView, frameIndex);
            }
        }
    }

    owns(record: Readonly<RenderTargetResourceRecord>): boolean {
        return this.#records.has(record);
    }

    release(owner: object): boolean {
        this.assertAlive();
        const record = this.#recordsByOwner.get(owner);
        if (record === undefined) return false;
        this.#recordsByOwner.delete(owner);
        this.#records.delete(record);
        releaseRecordHandles(this.registry, record);
        this.metrics.recordRemoval();
        return true;
    }

    destroy(): void {
        if (this.#destroyed) return;
        for (const record of this.#records) {
            releaseRecordHandles(this.registry, record);
        }
        this.#records.clear();
        this.#recordsByOwner = new WeakMap();
        this.metrics.clear();
        this.#destroyed = true;
    }

    private normalizeDescriptor(
        source: Readonly<RenderTargetResourceDescriptor>,
        token: number,
        lifetimeOverride: RenderTargetMultisampleAttachmentLifetime | undefined
    ): Readonly<NormalizedTargetDescriptor> {
        requirePositiveSafeInteger(source.width, 'Render target width');
        requirePositiveSafeInteger(source.height, 'Render target height');
        if (
            source.colorFormats.length > this.registry.deviceCapabilities.limits.maxColorAttachments
        ) {
            throw new RangeError('Render target exceeds the device color-attachment limit');
        }
        const sampleCount = source.sampleCount ?? 1;
        if (sampleCount !== 1 && sampleCount !== 4) {
            throw new RangeError('Render target sample count must be one or four');
        }
        const requestedLifetime: unknown = lifetimeOverride ?? 'persistent';
        if (requestedLifetime !== 'persistent' && requestedLifetime !== 'graph-transient') {
            throw new TypeError(
                'Render target multisample attachment lifetime must be persistent or graph-transient'
            );
        }
        const multisampleAttachmentLifetime = requestedLifetime;
        if (multisampleAttachmentLifetime === 'graph-transient' && sampleCount !== 4) {
            throw new TypeError(
                'Graph-transient render-target attachments require sampleCount four'
            );
        }
        const colorFormats = Object.freeze([...source.colorFormats]);
        for (let index = 0; index < colorFormats.length; index += 1) {
            const format = colorFormats[index];
            if (format === undefined) throw new Error('Render target color format is missing');
            if (rhiTextureFormatHasDepth(format) || rhiTextureFormatHasStencil(format)) {
                throw new Error(`Color attachment ${String(index)} requires a color format`);
            }
            if (getRHITextureFormatBlockInfo(format).bytesPerBlock === undefined) {
                throw new Error(`Color attachment ${String(index)} cannot be copied to a buffer`);
            }
        }
        const depthStencilFormat = source.depthStencilFormat ?? null;
        if (colorFormats.length === 0 && depthStencilFormat === null) {
            throw new RangeError(
                'Render target requires at least one color or depth/stencil attachment'
            );
        }
        if (
            depthStencilFormat !== null &&
            !rhiTextureFormatHasDepth(depthStencilFormat) &&
            !rhiTextureFormatHasStencil(depthStencilFormat)
        ) {
            throw new Error('Depth/stencil attachment requires a depth or stencil format');
        }
        const depthStencilSampled = source.depthStencilSampled ?? false;
        if (depthStencilSampled) {
            if (depthStencilFormat === null) {
                throw new Error('Sampleable depth requires a depth/stencil attachment');
            }
            if (!rhiTextureFormatHasDepth(depthStencilFormat)) {
                throw new Error('Sampleable depth requires a format with a depth aspect');
            }
            if (sampleCount !== 1) {
                throw new Error('Sampleable depth requires a single-sample render target');
            }
        }
        return Object.freeze({
            label: source.label ?? `Shared render target ${String(token)}`,
            width: source.width,
            height: source.height,
            colorFormats,
            sampleCount,
            multisampleAttachmentLifetime,
            depthStencilFormat,
            depthStencilSampled
        });
    }

    private stageAllocation(
        token: number,
        revision: number,
        target: Readonly<NormalizedTargetDescriptor>
    ): StagedTargetAllocation {
        const handles: ResourceRegistryHandle<RHIDeviceOwnedDestroyable>[] = [];
        const colors: RenderTargetColorResource[] = [];
        const allocationLabel = `${target.label} [${String(token)}.${String(revision)}]`;
        let depth: RenderTargetDepthStencilResource | null = null;
        try {
            for (let index = 0; index < target.colorFormats.length; index += 1) {
                const format = target.colorFormats[index];
                if (format === undefined) throw new Error('Render target color format is missing');
                const sourceDescriptor = this.textureDescriptor(
                    `${allocationLabel} color ${String(index)}`,
                    target,
                    format,
                    target.sampleCount,
                    target.sampleCount === 1,
                    false,
                    target.multisampleAttachmentLifetime === 'persistent'
                        ? 'persistent'
                        : 'transient'
                );
                const texture =
                    target.multisampleAttachmentLifetime === 'persistent'
                        ? this.registerTexture(sourceDescriptor)
                        : null;
                if (texture !== null) handles.push(texture);
                let resolveTarget: ResourceRegistryHandle<RHITexture> | null = null;
                let resolveDescriptor: Readonly<RHINormalizedTextureDescriptor> | null = null;
                if (target.sampleCount === 4) {
                    resolveDescriptor = this.textureDescriptor(
                        `${allocationLabel} color ${String(index)} resolve`,
                        target,
                        format,
                        1,
                        true,
                        false,
                        'persistent'
                    );
                    resolveTarget = this.registerTexture(resolveDescriptor);
                    handles.push(resolveTarget);
                }
                const readableTexture = resolveTarget ?? texture;
                if (readableTexture === null) {
                    throw new Error(
                        'Graph-transient color attachment is missing its resolve target'
                    );
                }
                const readableDescriptor = resolveDescriptor ?? sourceDescriptor;
                const readableView = this.registry.register<RHITextureView>({
                    label: `${allocationLabel} color ${String(index)} readable view`,
                    dependencies: [readableTexture],
                    create: (_device, resolve) =>
                        resolve(readableTexture).createView({
                            label: `${allocationLabel} color ${String(index)} readable view`
                        })
                });
                handles.push(readableView);
                const shared = {
                    format,
                    textureDescriptor: sourceDescriptor,
                    resolveTarget,
                    resolveDescriptor,
                    readableTexture,
                    readableDescriptor,
                    readableView
                };
                if (target.multisampleAttachmentLifetime === 'persistent') {
                    if (texture === null) {
                        throw new Error('Persistent color attachment source is missing');
                    }
                    colors.push(
                        Object.freeze({
                            ...shared,
                            attachmentLifetime: 'persistent' as const,
                            texture
                        })
                    );
                } else {
                    colors.push(
                        Object.freeze({
                            ...shared,
                            attachmentLifetime: 'graph-transient' as const,
                            texture: null
                        })
                    );
                }
            }
            if (target.depthStencilFormat !== null) {
                const textureDescriptor = this.textureDescriptor(
                    `${allocationLabel} depth-stencil`,
                    target,
                    target.depthStencilFormat,
                    target.sampleCount,
                    false,
                    target.depthStencilSampled,
                    target.multisampleAttachmentLifetime === 'persistent'
                        ? 'persistent'
                        : 'transient'
                );
                const texture =
                    target.multisampleAttachmentLifetime === 'persistent'
                        ? this.registerTexture(textureDescriptor)
                        : null;
                if (texture !== null) handles.push(texture);
                let sampledView: ResourceRegistryHandle<RHITextureView> | null = null;
                if (target.depthStencilSampled) {
                    if (texture === null) {
                        throw new Error('Sampled depth attachment cannot be graph-transient');
                    }
                    sampledView = this.registry.register<RHITextureView>({
                        label: `${allocationLabel} depth-only sampled view`,
                        dependencies: [texture],
                        create: (_device, resolve) =>
                            resolve(texture).createView({
                                label: `${allocationLabel} depth-only sampled view`,
                                dimension: '2d',
                                aspect: 'depth-only',
                                baseMipLevel: 0,
                                mipLevelCount: 1,
                                baseArrayLayer: 0,
                                arrayLayerCount: 1
                            })
                    });
                    handles.push(sampledView);
                }
                if (target.multisampleAttachmentLifetime === 'persistent') {
                    if (texture === null) {
                        throw new Error('Persistent depth/stencil attachment source is missing');
                    }
                    depth = Object.freeze({
                        format: target.depthStencilFormat,
                        attachmentLifetime: 'persistent' as const,
                        texture,
                        textureDescriptor,
                        sampledView
                    });
                } else {
                    depth = Object.freeze({
                        format: target.depthStencilFormat,
                        attachmentLifetime: 'graph-transient' as const,
                        texture: null,
                        textureDescriptor,
                        sampledView: null
                    });
                }
            }
        } catch (error) {
            discardUnsubmittedHandles(this.registry, handles);
            throw error;
        }
        return Object.freeze({
            colors: Object.freeze(colors),
            depth
        });
    }

    private textureDescriptor(
        label: string,
        target: Readonly<NormalizedTargetDescriptor>,
        format: RHITextureFormat,
        sampleCount: 1 | 4,
        readable: boolean,
        sampled = false,
        lifetime: 'persistent' | 'transient' = 'persistent'
    ): Readonly<RHINormalizedTextureDescriptor> {
        return normalizeRHITextureDescriptor(
            {
                label,
                lifetime,
                size: { width: target.width, height: target.height },
                mipLevelCount: 1,
                sampleCount,
                dimension: '2d',
                viewDimension: '2d',
                format,
                usage:
                    RHITextureUsage.RENDER_ATTACHMENT |
                    (readable
                        ? RHITextureUsage.COPY_SRC |
                          RHITextureUsage.COPY_DST |
                          RHITextureUsage.TEXTURE_BINDING
                        : 0) |
                    (sampled ? RHITextureUsage.TEXTURE_BINDING : 0)
            },
            this.registry.deviceCapabilities
        );
    }

    private registerTexture(
        descriptor: Readonly<RHINormalizedTextureDescriptor>
    ): ResourceRegistryHandle<RHITexture> {
        const backend = this.registry.deviceBackend;
        return this.registry.register<RHITexture>({
            label: descriptor.label,
            create: device => {
                if (device.backend !== backend) {
                    throw new Error(
                        `Render target backend ${backend} cannot be recovered on ${device.backend}`
                    );
                }
                return device.createTexture(descriptor);
            }
        });
    }

    private requireRecord(
        record: Readonly<RenderTargetResourceRecord>
    ): MutableRenderTargetResourceRecord {
        this.assertAlive();
        const current = record as MutableRenderTargetResourceRecord;
        if (!this.#records.has(current) || this.#recordsByOwner.get(current.owner) !== current) {
            throw new Error('Render target record is stale or belongs to another cache');
        }
        if (current.backend !== this.registry.deviceBackend) {
            throw new Error('Render target record belongs to another RHI backend');
        }
        return current;
    }

    private assertAlive(): void {
        if (this.#destroyed) throw new Error('Render target resource cache is destroyed');
    }
}
