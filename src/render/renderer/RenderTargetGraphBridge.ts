import type { RGBufferHandle, RGPassHandle, RGTextureHandle } from '../graph/RenderGraphResource';
import type { RenderGraphBuilder, RenderPassTemplate } from '../graph/RenderGraphBuilder';
import {
    getRHITextureFormatBlockInfo,
    type RHIExtent3D,
    type RHIImageDataLayout,
    type RHIOrigin3D,
    type RHITextureFormat
} from '../rhi/core';
import type { ExternalTextureGraphDependency } from './ExternalTextureBindingRegistry';
import type { SharedDrawPassParameters } from './passes';
import type {
    RenderTargetResourceCache,
    RenderTargetMultisampleAttachmentLifetime,
    RenderTargetResourceRecord
} from './RenderTargetResourceCache';

interface CachedRenderTargetGraphImport {
    multisampleAttachmentLifetime: RenderTargetMultisampleAttachmentLifetime | null;
    imported: Readonly<RenderTargetGraphImport> | null;
    readonly readableColors: (RGTextureHandle | null)[];
    depthStencil: RGTextureHandle | null;
}

const importsByBuilder = new WeakMap<
    RenderGraphBuilder,
    Map<Readonly<RenderTargetResourceRecord>, CachedRenderTargetGraphImport>
>();

export interface RenderTargetGraphColorAttachment {
    readonly format: RHITextureFormat;
    readonly texture: RGTextureHandle;
    readonly resolveTarget: RGTextureHandle | null;
    /** Always single-sampled; aliases `texture` when the target itself is single-sampled. */
    readonly readableTexture: RGTextureHandle;
}

export interface RenderTargetColorCopyRegion {
    readonly x?: number;
    readonly y?: number;
    readonly width?: number;
    readonly height?: number;
}

export interface RenderTargetColorAttachmentCopyPlan {
    readonly attachmentIndex: number;
    readonly format: RHITextureFormat;
    readonly source: RGTextureHandle;
    readonly sourceOrigin: Readonly<Required<RHIOrigin3D>>;
    readonly copySize: Readonly<Required<RHIExtent3D>>;
    readonly destinationLayout: Readonly<Required<RHIImageDataLayout>>;
    /** Minimum four-byte-aligned staging-buffer size for this copy. */
    readonly byteLength: number;
}

/** @deprecated Compatibility name for an attachment-zero copy plan. */
export type RenderTargetAttachment0CopyPlan = RenderTargetColorAttachmentCopyPlan;

/** One-frame graph identities imported from a stable persistent render-target record. */
export interface RenderTargetGraphImport {
    readonly targetToken: number;
    readonly targetRevision: number;
    readonly width: number;
    readonly height: number;
    readonly sampleCount: 1 | 4;
    readonly colorAttachments: readonly RenderTargetGraphColorAttachment[];
    readonly depthStencilAttachment: RGTextureHandle | null;
    /** Full-size readback plans in color-attachment order. */
    readonly colorCopies: readonly Readonly<RenderTargetColorAttachmentCopyPlan>[];
    /** Null for a depth-only target. */
    readonly attachment0Copy: Readonly<RenderTargetColorAttachmentCopyPlan> | null;
}

interface Attachment0CopyPassParameters {
    readonly source: RGTextureHandle;
    readonly sourceOrigin: Readonly<Required<RHIOrigin3D>>;
    readonly destination: RGBufferHandle;
    readonly copySize: Readonly<Required<RHIExtent3D>>;
    readonly destinationLayout: Readonly<Required<RHIImageDataLayout>>;
}

/** Stable shared copy/readback staging pass; CPU mapping remains an upper-layer policy. */
const attachment0CopyPassTemplate: RenderPassTemplate<Attachment0CopyPassParameters> = {
    name: 'RenderTargetAttachment0CopyPass',
    setup(builder, params) {
        builder.readTexture(params.source);
        builder.writeBuffer(params.destination, 'copy-destination');
        builder.markSideEffect();
    },
    execute(context, params) {
        context.commandContext.copyTextureToBuffer(
            { texture: context.getTexture(params.source), origin: params.sourceOrigin },
            {
                buffer: context.getBuffer(params.destination),
                offset: params.destinationLayout.offset,
                bytesPerRow: params.destinationLayout.bytesPerRow,
                rowsPerImage: params.destinationLayout.rowsPerImage
            },
            params.copySize
        );
    }
};

export const RenderTargetAttachment0CopyPassTemplate = Object.freeze(attachment0CopyPassTemplate);

function align(value: number, alignment: number, name: string): number {
    const result = Math.ceil(value / alignment) * alignment;
    if (!Number.isSafeInteger(result))
        throw new RangeError(`${name} exceeds the safe integer range`);
    return result;
}

function multiply(first: number, second: number, name: string): number {
    const result = first * second;
    if (!Number.isSafeInteger(result))
        throw new RangeError(`${name} exceeds the safe integer range`);
    return result;
}

function nonNegativeSafeInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name} must be a non-negative safe integer`);
    }
}

function positiveSafeInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer`);
    }
}

function createCopyPlan(
    attachmentIndex: number,
    source: RGTextureHandle,
    format: RHITextureFormat,
    targetWidth: number,
    targetHeight: number,
    region: Readonly<RenderTargetColorCopyRegion> = {}
): Readonly<RenderTargetColorAttachmentCopyPlan> {
    const x = region.x ?? 0;
    const y = region.y ?? 0;
    nonNegativeSafeInteger(x, 'Readback x');
    nonNegativeSafeInteger(y, 'Readback y');
    if (x >= targetWidth || y >= targetHeight) {
        throw new RangeError('Readback origin lies outside the color attachment');
    }
    const width = region.width ?? targetWidth - x;
    const height = region.height ?? targetHeight - y;
    positiveSafeInteger(width, 'Readback width');
    positiveSafeInteger(height, 'Readback height');
    if (x + width > targetWidth || y + height > targetHeight) {
        throw new RangeError('Readback region exceeds the color attachment');
    }
    const block = getRHITextureFormatBlockInfo(format);
    const bytesPerBlock = block.bytesPerBlock;
    if (bytesPerBlock === undefined) {
        throw new Error(`Render target format ${format} has no portable readback footprint`);
    }
    if (x % block.blockWidth !== 0 || y % block.blockHeight !== 0) {
        throw new RangeError('Readback origin must align to the texture format block dimensions');
    }
    if (width % block.blockWidth !== 0 && x + width !== targetWidth) {
        throw new RangeError('Readback width must be block-aligned unless it reaches the edge');
    }
    if (height % block.blockHeight !== 0 && y + height !== targetHeight) {
        throw new RangeError('Readback height must be block-aligned unless it reaches the edge');
    }
    const blockColumns = Math.ceil(width / block.blockWidth);
    const blockRows = Math.ceil(height / block.blockHeight);
    const tightRowBytes = multiply(blockColumns, bytesPerBlock, 'Readback row size');
    const bytesPerRow = align(tightRowBytes, 256, 'Readback row stride');
    const precedingRows = multiply(Math.max(0, blockRows - 1), bytesPerRow, 'Readback size');
    const byteLength = align(precedingRows + tightRowBytes, 4, 'Readback buffer size');
    return Object.freeze({
        attachmentIndex,
        format,
        source,
        sourceOrigin: Object.freeze({ x, y, z: 0 }),
        copySize: Object.freeze({ width, height, depthOrArrayLayers: 1 }),
        destinationLayout: Object.freeze({
            offset: 0,
            bytesPerRow,
            rowsPerImage: blockRows
        }),
        byteLength
    });
}

/**
 * Imports persistent target attachments through lazy registry providers. Graph construction does
 * not resolve or create concrete GPU resources, and a same-backend registry recovery is therefore
 * observed automatically at graph execution time.
 */
export class RenderTargetGraphBridge {
    readonly #sampledReadScratch: RGTextureHandle[] = [];

    constructor(readonly resources: RenderTargetResourceCache) {}

    import(
        builder: RenderGraphBuilder,
        record: Readonly<RenderTargetResourceRecord>
    ): Readonly<RenderTargetGraphImport> {
        if (!this.resources.owns(record)) {
            throw new Error('Render target record is stale or belongs to another cache');
        }
        const registry = this.resources.registry;
        if (record.backend !== registry.deviceBackend) {
            throw new Error('Render target record belongs to another RHI backend');
        }

        const multisampleAttachmentLifetime = record.multisampleAttachmentLifetime;
        const transientMultisampleAttachments = multisampleAttachmentLifetime === 'graph-transient';
        if (transientMultisampleAttachments && record.sampleCount !== 4) {
            throw new Error('Graph-transient render-target attachments require sampleCount four');
        }
        let imports = importsByBuilder.get(builder);
        if (imports === undefined) {
            imports = new Map();
            importsByBuilder.set(builder, imports);
        }
        let cached = imports.get(record);
        if (cached === undefined) {
            cached = {
                multisampleAttachmentLifetime: null,
                imported: null,
                readableColors: new Array<RGTextureHandle | null>(
                    record.colorAttachments.length
                ).fill(null),
                depthStencil: null
            };
            imports.set(record, cached);
        } else if (cached.readableColors.length !== record.colorAttachments.length) {
            throw new Error('Render target attachments changed during graph construction');
        }
        if (cached.multisampleAttachmentLifetime !== null) {
            if (cached.multisampleAttachmentLifetime !== multisampleAttachmentLifetime) {
                throw new Error(
                    'One render target cannot change multisample attachment lifetime in the same graph'
                );
            }
            const imported = cached.imported;
            if (imported === null)
                throw new Error('Render-target graph import cache is incomplete');
            return imported;
        }
        cached.multisampleAttachmentLifetime = multisampleAttachmentLifetime;

        const colors = new Array<RenderTargetGraphColorAttachment>(record.colorAttachments.length);
        const colorCopies = new Array<RenderTargetColorAttachmentCopyPlan>(
            record.colorAttachments.length
        );
        for (let index = 0; index < record.colorAttachments.length; index += 1) {
            const color = record.colorAttachments[index];
            if (color === undefined) throw new Error('Render target color attachment is missing');
            if (color.attachmentLifetime !== multisampleAttachmentLifetime) {
                throw new Error('Render-target color attachment lifetime metadata is inconsistent');
            }
            let readableTexture = cached.readableColors[index];
            if (readableTexture === null || readableTexture === undefined) {
                const readableHandle = color.readableTexture;
                readableTexture = builder.importTextureProvider(
                    `${record.label} color ${String(index)}${record.sampleCount === 4 ? ' resolve' : ''}`,
                    color.readableDescriptor,
                    () => registry.resolve(readableHandle),
                    'persistent'
                );
                cached.readableColors[index] = readableTexture;
            }
            let texture: RGTextureHandle;
            if (record.sampleCount === 1) {
                texture = readableTexture;
            } else if (transientMultisampleAttachments) {
                texture = builder.createTexture(
                    `${record.label} color ${String(index)} multisample transient`,
                    color.textureDescriptor
                );
            } else {
                if (color.attachmentLifetime !== 'persistent') {
                    throw new Error(
                        'Persistent graph import requires a persistent render-target color attachment'
                    );
                }
                const textureHandle = color.texture;
                texture = builder.importTextureProvider(
                    `${record.label} color ${String(index)}`,
                    color.textureDescriptor,
                    () => registry.resolve(textureHandle),
                    'persistent'
                );
            }
            let resolveTarget: RGTextureHandle | null = null;
            if (color.resolveTarget !== null && color.resolveDescriptor !== null) {
                resolveTarget = readableTexture;
            }
            colors[index] = Object.freeze({
                format: color.format,
                texture,
                resolveTarget,
                readableTexture
            });
            colorCopies[index] = createCopyPlan(
                index,
                resolveTarget ?? texture,
                color.format,
                record.width,
                record.height
            );
        }

        let depthStencilAttachment: RGTextureHandle | null = null;
        const depth = record.depthStencilAttachment;
        if (depth !== null) {
            if (depth.attachmentLifetime !== multisampleAttachmentLifetime) {
                throw new Error(
                    'Render-target depth/stencil attachment lifetime metadata is inconsistent'
                );
            }
            if (transientMultisampleAttachments) {
                if (cached.depthStencil !== null) {
                    throw new Error(
                        'A sampled render-target depth attachment cannot become transient in the same graph'
                    );
                }
                depthStencilAttachment = builder.createTexture(
                    `${record.label} depth-stencil multisample transient`,
                    depth.textureDescriptor
                );
            } else {
                if (depth.attachmentLifetime !== 'persistent') {
                    throw new Error(
                        'Persistent graph import requires a persistent render-target depth attachment'
                    );
                }
                const depthHandle = depth.texture;
                depthStencilAttachment = cached.depthStencil;
                if (depthStencilAttachment === null) {
                    depthStencilAttachment = builder.importTextureProvider(
                        `${record.label} depth-stencil`,
                        depth.textureDescriptor,
                        () => registry.resolve(depthHandle),
                        'persistent'
                    );
                    cached.depthStencil = depthStencilAttachment;
                }
            }
        }
        const frozenColorCopies = Object.freeze(colorCopies);
        const imported = Object.freeze({
            targetToken: record.token,
            targetRevision: record.revision,
            width: record.width,
            height: record.height,
            sampleCount: record.sampleCount,
            colorAttachments: Object.freeze(colors),
            depthStencilAttachment,
            colorCopies: frozenColorCopies,
            attachment0Copy: frozenColorCopies[0] ?? null
        });
        cached.imported = imported;
        return imported;
    }

    /**
     * Reference a public render-target attachment as a sampled graph input. This may run before
     * its producer pass is built; a later full import reuses the same persistent readable handle
     * while independently choosing persistent or transient multisample source attachments.
     */
    referenceSampledTexture(
        builder: RenderGraphBuilder,
        dependency: ExternalTextureGraphDependency
    ): RGTextureHandle {
        const record = dependency.record;
        if (!this.resources.owns(record)) {
            throw new Error('Sampled render target is stale or belongs to another cache');
        }
        const registry = this.resources.registry;
        if (record.backend !== registry.deviceBackend) {
            throw new Error('Sampled render target belongs to another RHI backend');
        }
        let imports = importsByBuilder.get(builder);
        if (imports === undefined) {
            imports = new Map();
            importsByBuilder.set(builder, imports);
        }
        let cached = imports.get(record);
        if (cached === undefined) {
            cached = {
                multisampleAttachmentLifetime: null,
                imported: null,
                readableColors: new Array<RGTextureHandle | null>(
                    record.colorAttachments.length
                ).fill(null),
                depthStencil: null
            };
            imports.set(record, cached);
        } else if (cached.readableColors.length !== record.colorAttachments.length) {
            throw new Error('Render target attachments changed during graph construction');
        }

        const imported = cached.imported;
        if (dependency.attachment === 'color') {
            if (
                !Number.isSafeInteger(dependency.attachmentIndex) ||
                dependency.attachmentIndex < 0
            ) {
                throw new RangeError('Sampled render-target color attachment index is invalid');
            }
            const color = record.colorAttachments[dependency.attachmentIndex];
            if (color === undefined) {
                throw new RangeError(
                    `Sampled render-target color attachment ${String(dependency.attachmentIndex)} does not exist`
                );
            }
            const importedColor = imported?.colorAttachments[dependency.attachmentIndex];
            if (importedColor !== undefined) {
                builder.readTextureFromLastGraphWriter(importedColor.readableTexture);
                return importedColor.readableTexture;
            }
            let readable = cached.readableColors[dependency.attachmentIndex];
            if (readable === null || readable === undefined) {
                const readableHandle = color.readableTexture;
                readable = builder.importTextureProvider(
                    `${record.label} color ${String(dependency.attachmentIndex)}${record.sampleCount === 4 ? ' resolve' : ''}`,
                    color.readableDescriptor,
                    () => registry.resolve(readableHandle),
                    'persistent'
                );
                cached.readableColors[dependency.attachmentIndex] = readable;
            }
            builder.readTextureFromLastGraphWriter(readable);
            return readable;
        }

        const depth = record.depthStencilAttachment;
        if (depth?.sampledView === null || depth?.sampledView === undefined) {
            throw new Error('Sampled render target lost its sampleable depth attachment');
        }
        const importedDepthStencil = imported?.depthStencilAttachment;
        if (importedDepthStencil !== null && importedDepthStencil !== undefined) {
            builder.readTextureFromLastGraphWriter(importedDepthStencil);
            return importedDepthStencil;
        }
        let depthStencil = cached.depthStencil;
        if (depthStencil === null) {
            const depthHandle = depth.texture;
            depthStencil = builder.importTextureProvider(
                `${record.label} sampled depth-stencil`,
                depth.textureDescriptor,
                () => registry.resolve(depthHandle),
                'persistent'
            );
            cached.depthStencil = depthStencil;
        }
        builder.readTextureFromLastGraphWriter(depthStencil);
        return depthStencil;
    }

    /** Map and deduplicate one processor pass's sampled producer identities. */
    addSampledTextureReads(
        builder: RenderGraphBuilder,
        pass: SharedDrawPassParameters,
        dependencies: readonly ExternalTextureGraphDependency[]
    ): number {
        let count = 0;
        for (const dependency of dependencies) {
            const texture = this.referenceSampledTexture(builder, dependency);
            let duplicate = false;
            for (let index = 0; index < count; index += 1) {
                if (this.#sampledReadScratch[index] !== texture) continue;
                duplicate = true;
                break;
            }
            if (duplicate) continue;
            this.#sampledReadScratch[count++] = texture;
            pass.addReadTexture(texture);
        }
        return count;
    }

    createColorAttachmentCopyPlan(
        target: Readonly<RenderTargetGraphImport>,
        attachmentIndex = 0,
        region?: Readonly<RenderTargetColorCopyRegion>
    ): Readonly<RenderTargetColorAttachmentCopyPlan> {
        nonNegativeSafeInteger(attachmentIndex, 'Color attachment index');
        const attachment = target.colorAttachments[attachmentIndex];
        if (attachment === undefined) {
            throw new RangeError(`Color attachment ${String(attachmentIndex)} does not exist`);
        }
        if (region === undefined) {
            const fullPlan = target.colorCopies[attachmentIndex];
            if (fullPlan === undefined) {
                throw new Error('Render-target color-copy metadata is inconsistent');
            }
            return fullPlan;
        }
        return createCopyPlan(
            attachmentIndex,
            attachment.readableTexture,
            attachment.format,
            target.width,
            target.height,
            region
        );
    }

    addColorAttachmentCopyPass(
        builder: RenderGraphBuilder,
        target: Readonly<RenderTargetGraphImport>,
        attachmentIndex: number,
        destination: RGBufferHandle,
        region?: Readonly<RenderTargetColorCopyRegion>
    ): RGPassHandle {
        const plan = this.createColorAttachmentCopyPlan(target, attachmentIndex, region);
        return this.addColorCopyPlanPass(builder, plan, destination);
    }

    addColorCopyPlanPass(
        builder: RenderGraphBuilder,
        plan: Readonly<RenderTargetColorAttachmentCopyPlan>,
        destination: RGBufferHandle
    ): RGPassHandle {
        return builder.addPass(
            RenderTargetAttachment0CopyPassTemplate,
            Object.freeze({
                source: plan.source,
                sourceOrigin: plan.sourceOrigin,
                destination,
                copySize: plan.copySize,
                destinationLayout: plan.destinationLayout
            })
        );
    }

    addAttachment0CopyPass(
        builder: RenderGraphBuilder,
        target: Readonly<RenderTargetGraphImport>,
        destination: RGBufferHandle
    ): RGPassHandle {
        const plan = target.attachment0Copy;
        if (plan === null) {
            throw new Error('Attachment 0 copy requires a render target color attachment');
        }
        return this.addColorCopyPlanPass(builder, plan, destination);
    }
}
