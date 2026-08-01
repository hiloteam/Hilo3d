import type { RGPassBuilder, RenderPassTemplate } from '../../graph/RenderGraphBuilder';
import type { RGPassContext, RGPrepareContext } from '../../graph/RenderGraphExecutor';
import type {
    RGBufferHandle,
    RGBufferReadUse,
    RGBufferWriteUse,
    RGColorAttachmentDeclaration,
    RGDepthStencilAttachmentDeclaration,
    RGPassHandle,
    RGTextureAccessHandle
} from '../../graph/RenderGraphResource';
import {
    RHITextureUsage,
    rhiTextureFormatHasDepth,
    rhiTextureFormatHasStencil,
    type RHIBindGroup,
    type RHIColor,
    type RHILoadOp,
    type RHIRect,
    type RHIRenderPassDescriptor,
    type RHIRenderPassEncoder,
    type RHIStoreOp,
    type RHITexture,
    type RHITextureView,
    type RHIViewport
} from '../../rhi/core';
import { PreparedDraw } from '../PreparedDraw';

const MISSING_DRAW_ERROR = new Error('Shared draw pass contains an empty draw slot');
const UNPREPARED_PASS_ERROR = new Error('Shared draw pass was not prepared');

function requireCapacity(value: number | undefined, name: string): number {
    const capacity = value ?? 0;
    if (!Number.isSafeInteger(capacity) || capacity < 0) {
        throw new RangeError(`${name} capacity must be a non-negative safe integer`);
    }
    return capacity;
}

function requireFinite(value: number, name: string): void {
    if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function requirePositiveInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new RangeError(`${name} must be a positive safe integer`);
    }
}

function requireUInt32(value: number, name: string): void {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
        throw new RangeError(`${name} must be an unsigned 32-bit integer`);
    }
}

function copyColor(target: MutableColor, source: RHIColor): void {
    requireFinite(source.r, 'Clear color red');
    requireFinite(source.g, 'Clear color green');
    requireFinite(source.b, 'Clear color blue');
    requireFinite(source.a, 'Clear color alpha');
    target.r = source.r;
    target.g = source.g;
    target.b = source.b;
    target.a = source.a;
}

interface MutableColor {
    r: number;
    g: number;
    b: number;
    a: number;
}

interface MutableColorAttachmentDescriptor {
    view: RHITextureView | null;
    resolveTarget: RHITextureView | undefined;
    clearValue: MutableColor | undefined;
    loadOp: RHILoadOp;
    storeOp: RHIStoreOp;
}

interface ColorAttachmentSlot {
    texture: RGTextureAccessHandle | null;
    resolveTarget: RGTextureAccessHandle | null;
    readonly clearValue: MutableColor;
    readonly descriptor: MutableColorAttachmentDescriptor;
    readonly graphDeclaration: MutableGraphColorAttachmentDeclaration;
}

type MutableGraphColorAttachmentDeclaration = {
    -readonly [Key in keyof RGColorAttachmentDeclaration]: RGColorAttachmentDeclaration[Key];
};

type MutableGraphDepthStencilAttachmentDeclaration = {
    -readonly [
        Key in keyof RGDepthStencilAttachmentDeclaration
    ]: RGDepthStencilAttachmentDeclaration[Key];
};

interface MutableDepthStencilAttachmentDescriptor {
    view: RHITextureView | null;
    depthClearValue: number | undefined;
    depthLoadOp: RHILoadOp | undefined;
    depthStoreOp: RHIStoreOp | undefined;
    depthReadOnly: boolean | undefined;
    stencilClearValue: number | undefined;
    stencilLoadOp: RHILoadOp | undefined;
    stencilStoreOp: RHIStoreOp | undefined;
    stencilReadOnly: boolean | undefined;
}

interface MutableRenderPassDescriptor {
    label: string | undefined;
    readonly colorAttachments: (MutableColorAttachmentDescriptor | null)[];
    depthStencilAttachment: MutableDepthStencilAttachmentDescriptor | undefined;
}

type MutableRHIViewport = {
    -readonly [Key in keyof RHIViewport]: RHIViewport[Key];
};

type MutableRHIRect = {
    -readonly [Key in keyof RHIRect]: RHIRect[Key];
};

function createColorAttachmentSlot(): ColorAttachmentSlot {
    const clearValue: MutableColor = { r: 0, g: 0, b: 0, a: 0 };
    return {
        texture: null,
        resolveTarget: null,
        clearValue,
        descriptor: {
            view: null,
            resolveTarget: undefined,
            clearValue: undefined,
            loadOp: 'load',
            storeOp: 'store'
        },
        graphDeclaration: {
            texture: 0 as RGTextureAccessHandle,
            loadOp: 'load',
            storeOp: 'store'
        }
    };
}

function sameAttachmentShape(first: RHITexture, second: RHITexture): boolean {
    return (
        first.width === second.width &&
        first.height === second.height &&
        first.depthOrArrayLayers === second.depthOrArrayLayers
    );
}

function requireRenderAttachment(texture: RHITexture, name: string): void {
    if ((texture.usage & RHITextureUsage.RENDER_ATTACHMENT) === 0) {
        throw new Error(`${name} lacks RENDER_ATTACHMENT usage`);
    }
}

function requireAttachmentView(view: RHITextureView, name: string): void {
    if (view.dimension !== '2d' || view.descriptor.arrayLayerCount !== 1) {
        throw new Error(`${name} must select exactly one 2D texture layer`);
    }
}

function requireMatchingAttachment(
    reference: RHITexture,
    candidate: RHITexture,
    name: string
): void {
    if (!sameAttachmentShape(reference, candidate)) {
        throw new Error(`${name} dimensions do not match the render pass`);
    }
    if (reference.sampleCount !== candidate.sampleCount) {
        throw new Error(`${name} sample count does not match the render pass`);
    }
}

export interface SharedDrawPassCapacity {
    readonly colorAttachments?: number;
    readonly draws?: number;
    readonly readTextures?: number;
    readonly writeTextures?: number;
    readonly readBuffers?: number;
    readonly writeBuffers?: number;
    readonly dependencies?: number;
}

export interface SharedDrawPassColorAttachment {
    readonly texture: RGTextureAccessHandle;
    readonly resolveTarget?: RGTextureAccessHandle;
    readonly clearValue?: RHIColor;
    readonly loadOp: RHILoadOp;
    readonly storeOp: RHIStoreOp;
}

export interface SharedDrawPassDepthStencilAttachment {
    readonly texture: RGTextureAccessHandle;
    readonly depthClearValue?: number;
    readonly depthLoadOp?: RHILoadOp;
    readonly depthStoreOp?: RHIStoreOp;
    readonly depthReadOnly?: boolean;
    readonly stencilClearValue?: number;
    readonly stencilLoadOp?: RHILoadOp;
    readonly stencilStoreOp?: RHIStoreOp;
    readonly stencilReadOnly?: boolean;
}

export type SharedDrawPassPrepare = (
    context: RGPrepareContext,
    params: SharedDrawPassParameters
) => void;

/**
 * Reusable storage for a backend-neutral graphics pass.
 *
 * Arrays and attachment descriptor objects grow only when a new high-water mark is reached.
 * `prepareForExecute` resolves graph handles into those stable objects; `execute` performs only
 * stable record reads and RHI calls.
 */
export class SharedDrawPassParameters {
    label = '';
    sideEffect = false;

    private readonly colorSlots: ColorAttachmentSlot[] = [];
    private colorAttachmentCount = 0;
    private readonly depthStencilDescriptor: MutableDepthStencilAttachmentDescriptor = {
        view: null,
        depthClearValue: undefined,
        depthLoadOp: undefined,
        depthStoreOp: undefined,
        depthReadOnly: undefined,
        stencilClearValue: undefined,
        stencilLoadOp: undefined,
        stencilStoreOp: undefined,
        stencilReadOnly: undefined
    };
    private readonly depthStencilGraphDeclaration: MutableGraphDepthStencilAttachmentDeclaration = {
        texture: 0 as RGTextureAccessHandle
    };
    private depthStencilTexture: RGTextureAccessHandle | null = null;

    private readonly readTextures: (RGTextureAccessHandle | null)[] = [];
    private readTextureCount = 0;
    private readonly writeTextures: (RGTextureAccessHandle | null)[] = [];
    private writeTextureCount = 0;
    private readonly readBuffers: (RGBufferHandle | null)[] = [];
    private readonly readBufferUses: (RGBufferReadUse | null)[] = [];
    private readBufferCount = 0;
    private readonly writeBuffers: (RGBufferHandle | null)[] = [];
    private readonly writeBufferUses: (RGBufferWriteUse | null)[] = [];
    private writeBufferCount = 0;
    private readonly dependencies: (RGPassHandle | null)[] = [];
    private dependencyCount = 0;

    private readonly draws: (PreparedDraw | null)[] = [];
    private readonly drawSnapshots: (PreparedDraw | null)[] = [];
    private activeDrawCount = 0;
    private prepareCallback: SharedDrawPassPrepare | null = null;

    private hasViewport = false;
    private readonly viewport: MutableRHIViewport = {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        minDepth: 0,
        maxDepth: 1
    };
    private readonly drawViewportState = {
        minDepth: 0,
        maxDepth: 1
    };
    private hasScissor = false;
    private readonly scissor: MutableRHIRect = {
        x: 0,
        y: 0,
        width: 1,
        height: 1
    };
    private prepared = false;

    private readonly descriptor: MutableRenderPassDescriptor = {
        label: undefined,
        colorAttachments: [],
        depthStencilAttachment: undefined
    };

    constructor(capacity: SharedDrawPassCapacity = {}) {
        const colorCapacity = requireCapacity(capacity.colorAttachments, 'Color attachment');
        const drawCapacity = requireCapacity(capacity.draws, 'Draw');
        const readTextureCapacity = requireCapacity(capacity.readTextures, 'Read texture');
        const writeTextureCapacity = requireCapacity(capacity.writeTextures, 'Write texture');
        const readBufferCapacity = requireCapacity(capacity.readBuffers, 'Read buffer');
        const writeBufferCapacity = requireCapacity(capacity.writeBuffers, 'Write buffer');
        const dependencyCapacity = requireCapacity(capacity.dependencies, 'Dependency');
        for (let index = 0; index < colorCapacity; index += 1) {
            this.colorSlots.push(createColorAttachmentSlot());
        }
        for (let index = 0; index < drawCapacity; index += 1) this.draws.push(null);
        for (let index = 0; index < readTextureCapacity; index += 1) this.readTextures.push(null);
        for (let index = 0; index < writeTextureCapacity; index += 1) this.writeTextures.push(null);
        for (let index = 0; index < readBufferCapacity; index += 1) {
            this.readBuffers.push(null);
            this.readBufferUses.push(null);
        }
        for (let index = 0; index < writeBufferCapacity; index += 1) {
            this.writeBuffers.push(null);
            this.writeBufferUses.push(null);
        }
        for (let index = 0; index < dependencyCapacity; index += 1) this.dependencies.push(null);
    }

    get drawCount(): number {
        return this.activeDrawCount;
    }

    get colorCount(): number {
        return this.colorAttachmentCount;
    }

    /** Reset active counts while retaining all high-water storage. */
    reset(): void {
        for (let index = 0; index < this.activeDrawCount; index += 1) this.draws[index] = null;
        for (let index = 0; index < this.colorAttachmentCount; index += 1) {
            const slot = this.colorSlots[index];
            if (!slot) continue;
            slot.texture = null;
            slot.resolveTarget = null;
            slot.descriptor.view = null;
            slot.descriptor.resolveTarget = undefined;
        }
        this.depthStencilDescriptor.view = null;
        this.colorAttachmentCount = 0;
        this.depthStencilTexture = null;
        this.readTextureCount = 0;
        this.writeTextureCount = 0;
        this.readBufferCount = 0;
        this.writeBufferCount = 0;
        this.dependencyCount = 0;
        this.activeDrawCount = 0;
        this.prepareCallback = null;
        this.hasViewport = false;
        this.hasScissor = false;
        this.sideEffect = false;
        this.label = '';
        this.prepared = false;
        this.descriptor.colorAttachments.length = 0;
        this.descriptor.depthStencilAttachment = undefined;
    }

    addColorAttachment(attachment: SharedDrawPassColorAttachment): number {
        let slot = this.colorSlots[this.colorAttachmentCount];
        if (!slot) {
            slot = createColorAttachmentSlot();
            this.colorSlots.push(slot);
        }
        slot.texture = attachment.texture;
        slot.resolveTarget = attachment.resolveTarget ?? null;
        slot.descriptor.loadOp = attachment.loadOp;
        slot.descriptor.storeOp = attachment.storeOp;
        const graphDeclaration = slot.graphDeclaration;
        graphDeclaration.texture = attachment.texture;
        if (attachment.resolveTarget === undefined) delete graphDeclaration.resolveTarget;
        else graphDeclaration.resolveTarget = attachment.resolveTarget;
        graphDeclaration.loadOp = attachment.loadOp;
        graphDeclaration.storeOp = attachment.storeOp;
        if (attachment.clearValue === undefined) slot.descriptor.clearValue = undefined;
        else {
            copyColor(slot.clearValue, attachment.clearValue);
            slot.descriptor.clearValue = slot.clearValue;
        }
        if (slot.descriptor.clearValue === undefined) delete graphDeclaration.clearValue;
        else graphDeclaration.clearValue = slot.descriptor.clearValue;
        const index = this.colorAttachmentCount;
        this.colorAttachmentCount++;
        this.prepared = false;
        return index;
    }

    setDepthStencilAttachment(attachment: SharedDrawPassDepthStencilAttachment): void {
        if (attachment.depthClearValue !== undefined) {
            requireFinite(attachment.depthClearValue, 'Depth clear value');
            if (attachment.depthClearValue < 0 || attachment.depthClearValue > 1) {
                throw new RangeError('Depth clear value must be within zero and one');
            }
        }
        if (attachment.stencilClearValue !== undefined) {
            requireUInt32(attachment.stencilClearValue, 'Stencil clear value');
        }
        this.depthStencilTexture = attachment.texture;
        const descriptor = this.depthStencilDescriptor;
        descriptor.depthClearValue = attachment.depthClearValue;
        descriptor.depthLoadOp = attachment.depthLoadOp;
        descriptor.depthStoreOp = attachment.depthStoreOp;
        descriptor.depthReadOnly = attachment.depthReadOnly;
        descriptor.stencilClearValue = attachment.stencilClearValue;
        descriptor.stencilLoadOp = attachment.stencilLoadOp;
        descriptor.stencilStoreOp = attachment.stencilStoreOp;
        descriptor.stencilReadOnly = attachment.stencilReadOnly;
        const graphDeclaration = this.depthStencilGraphDeclaration;
        graphDeclaration.texture = attachment.texture;
        if (attachment.depthClearValue === undefined) delete graphDeclaration.depthClearValue;
        else graphDeclaration.depthClearValue = attachment.depthClearValue;
        if (attachment.depthLoadOp === undefined) delete graphDeclaration.depthLoadOp;
        else graphDeclaration.depthLoadOp = attachment.depthLoadOp;
        if (attachment.depthStoreOp === undefined) delete graphDeclaration.depthStoreOp;
        else graphDeclaration.depthStoreOp = attachment.depthStoreOp;
        if (attachment.depthReadOnly === undefined) delete graphDeclaration.depthReadOnly;
        else graphDeclaration.depthReadOnly = attachment.depthReadOnly;
        if (attachment.stencilClearValue === undefined) delete graphDeclaration.stencilClearValue;
        else graphDeclaration.stencilClearValue = attachment.stencilClearValue;
        if (attachment.stencilLoadOp === undefined) delete graphDeclaration.stencilLoadOp;
        else graphDeclaration.stencilLoadOp = attachment.stencilLoadOp;
        if (attachment.stencilStoreOp === undefined) delete graphDeclaration.stencilStoreOp;
        else graphDeclaration.stencilStoreOp = attachment.stencilStoreOp;
        if (attachment.stencilReadOnly === undefined) delete graphDeclaration.stencilReadOnly;
        else graphDeclaration.stencilReadOnly = attachment.stencilReadOnly;
        this.prepared = false;
    }

    addReadTexture(handle: RGTextureAccessHandle): void {
        this.readTextures[this.readTextureCount++] = handle;
    }

    addWriteTexture(handle: RGTextureAccessHandle): void {
        this.writeTextures[this.writeTextureCount++] = handle;
    }

    addReadBuffer(handle: RGBufferHandle, use: RGBufferReadUse): void {
        const index = this.readBufferCount++;
        this.readBuffers[index] = handle;
        this.readBufferUses[index] = use;
    }

    addWriteBuffer(handle: RGBufferHandle, use: RGBufferWriteUse): void {
        const index = this.writeBufferCount++;
        this.writeBuffers[index] = handle;
        this.writeBufferUses[index] = use;
    }

    dependsOn(handle: RGPassHandle): void {
        this.dependencies[this.dependencyCount++] = handle;
    }

    addDraw(draw: PreparedDraw): number {
        const index = this.activeDrawCount;
        this.draws[index] = draw;
        this.activeDrawCount++;
        return index;
    }

    /**
     * Add a pass-local copy of a cache-owned packet. Snapshot slots grow only at their historical
     * high-water mark and are reused by subsequent frames.
     */
    addDrawSnapshot(draw: PreparedDraw): number {
        const index = this.activeDrawCount;
        let snapshot = this.drawSnapshots[index];
        if (
            snapshot?.bindGroupCapacity !== draw.bindGroupCapacity ||
            snapshot.vertexBufferCapacity !== draw.vertexBufferCapacity
        ) {
            snapshot = new PreparedDraw(draw.bindGroupCapacity, draw.vertexBufferCapacity);
            this.drawSnapshots[index] = snapshot;
        }
        snapshot.copyFrom(draw);
        this.draws[index] = snapshot;
        this.activeDrawCount++;
        return index;
    }

    setDraw(index: number, draw: PreparedDraw): void {
        if (!Number.isSafeInteger(index) || index < 0 || index >= this.activeDrawCount) {
            throw new RangeError('Draw index is outside the active draw range');
        }
        this.draws[index] = draw;
    }

    setDrawCount(count: number): void {
        if (!Number.isSafeInteger(count) || count < 0) {
            throw new RangeError('Draw count must be a non-negative safe integer');
        }
        for (let index = this.activeDrawCount; index < count; index += 1) {
            if (index >= this.draws.length) this.draws.push(null);
            else this.draws[index] = null;
        }
        for (let index = count; index < this.activeDrawCount; index += 1) this.draws[index] = null;
        this.activeDrawCount = count;
    }

    clearDraws(): void {
        this.setDrawCount(0);
    }

    setPrepare(callback: SharedDrawPassPrepare | null): void {
        this.prepareCallback = callback;
    }

    /** @internal Overlay one prepare-resolved bind group on a contiguous draw range. */
    setPreparedBindGroupForRange(
        start: number,
        count: number,
        groupIndex: number,
        bindGroup: RHIBindGroup
    ): void {
        if (
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(count) ||
            start < 0 ||
            count < 0 ||
            start + count > this.activeDrawCount
        ) {
            throw new RangeError('Prepared bind-group range is outside the active pass draws');
        }
        const end = start + count;
        for (let index = start; index < end; index += 1) {
            const draw = this.draws[index];
            if (draw === null || draw === undefined) throw MISSING_DRAW_ERROR;
            draw.setPreparedBindGroup(groupIndex, bindGroup);
        }
    }

    /** @internal Overlay only packets that explicitly deferred the requested pass-global group. */
    setPreparedBindGroupForDeferredDraws(groupIndex: number, bindGroup: RHIBindGroup): void {
        for (let index = 0; index < this.activeDrawCount; index += 1) {
            const draw = this.draws[index];
            if (draw === null || draw === undefined) throw MISSING_DRAW_ERROR;
            if (draw.acceptsPreparedBindGroup(groupIndex)) {
                draw.setPreparedBindGroup(groupIndex, bindGroup);
            }
        }
    }

    setViewport(viewport: RHIViewport | null): void {
        this.hasViewport = viewport !== null;
        if (!viewport) return;
        requireFinite(viewport.x, 'Viewport x');
        requireFinite(viewport.y, 'Viewport y');
        requireFinite(viewport.width, 'Viewport width');
        requireFinite(viewport.height, 'Viewport height');
        requireFinite(viewport.minDepth, 'Viewport min depth');
        requireFinite(viewport.maxDepth, 'Viewport max depth');
        if (viewport.width <= 0 || viewport.height <= 0) {
            throw new RangeError('Viewport dimensions must be positive');
        }
        if (
            viewport.minDepth < 0 ||
            viewport.maxDepth > 1 ||
            viewport.minDepth > viewport.maxDepth
        ) {
            throw new RangeError('Viewport depth range must be ordered within zero and one');
        }
        this.viewport.x = viewport.x;
        this.viewport.y = viewport.y;
        this.viewport.width = viewport.width;
        this.viewport.height = viewport.height;
        this.viewport.minDepth = viewport.minDepth;
        this.viewport.maxDepth = viewport.maxDepth;
    }

    setScissor(scissor: RHIRect | null): void {
        this.hasScissor = scissor !== null;
        if (!scissor) return;
        if (
            !Number.isSafeInteger(scissor.x) ||
            !Number.isSafeInteger(scissor.y) ||
            scissor.x < 0 ||
            scissor.y < 0
        ) {
            throw new RangeError('Scissor origin must contain non-negative safe integers');
        }
        requirePositiveInteger(scissor.width, 'Scissor width');
        requirePositiveInteger(scissor.height, 'Scissor height');
        this.scissor.x = scissor.x;
        this.scissor.y = scissor.y;
        this.scissor.width = scissor.width;
        this.scissor.height = scissor.height;
    }

    /** @internal Called by a stable pass template during graph build. */
    declare(builder: RGPassBuilder, forceSideEffect: boolean): void {
        for (let index = 0; index < this.readTextureCount; index += 1) {
            const handle = this.readTextures[index];
            if (handle !== null && handle !== undefined) builder.readTexture(handle);
        }
        for (let index = 0; index < this.writeTextureCount; index += 1) {
            const handle = this.writeTextures[index];
            if (handle !== null && handle !== undefined) builder.writeTexture(handle);
        }
        for (let index = 0; index < this.readBufferCount; index += 1) {
            const handle = this.readBuffers[index];
            const use = this.readBufferUses[index];
            if (handle !== null && handle !== undefined && use !== null && use !== undefined) {
                builder.readBuffer(handle, use);
            }
        }
        for (let index = 0; index < this.writeBufferCount; index += 1) {
            const handle = this.writeBuffers[index];
            const use = this.writeBufferUses[index];
            if (handle !== null && handle !== undefined && use !== null && use !== undefined) {
                builder.writeBuffer(handle, use);
            }
        }
        for (let index = 0; index < this.colorAttachmentCount; index += 1) {
            const slot = this.colorSlots[index];
            if (!slot?.texture) throw new Error('Color attachment slot is incomplete');
            builder.useColorAttachment(slot.graphDeclaration);
        }
        const depthStencilTexture = this.depthStencilTexture;
        if (depthStencilTexture) {
            builder.useDepthStencilAttachment(this.depthStencilGraphDeclaration);
        }
        for (let index = 0; index < this.dependencyCount; index += 1) {
            const dependency = this.dependencies[index];
            if (dependency !== null && dependency !== undefined) builder.dependsOn(dependency);
        }
        if (forceSideEffect || this.sideEffect) builder.markSideEffect();
    }

    /** @internal Resolves graph resources and refreshes expensive draw state before beginFrame. */
    prepareForExecute(context: RGPrepareContext, defaultLabel: string): void {
        this.prepared = false;
        if (this.colorAttachmentCount === 0 && this.depthStencilTexture === null) {
            throw new Error('Shared draw pass requires at least one attachment');
        }
        this.descriptor.label = this.label.length === 0 ? defaultLabel : this.label;
        this.descriptor.colorAttachments.length = this.colorAttachmentCount;
        let reference: RHITexture | null = null;
        for (let index = 0; index < this.colorAttachmentCount; index += 1) {
            const slot = this.colorSlots[index];
            if (!slot?.texture) throw new Error('Color attachment slot is incomplete');
            const texture = context.getTexture(slot.texture);
            requireRenderAttachment(texture, `Color attachment ${String(index)}`);
            if (
                rhiTextureFormatHasDepth(texture.format) ||
                rhiTextureFormatHasStencil(texture.format)
            ) {
                throw new Error(`Color attachment ${String(index)} requires a color format`);
            }
            if (slot.descriptor.loadOp === 'clear' && slot.descriptor.clearValue === undefined) {
                throw new Error(`Color attachment ${String(index)} clear requires a clear value`);
            }
            if (reference)
                requireMatchingAttachment(reference, texture, `Color attachment ${String(index)}`);
            else reference = texture;
            const view = context.getTextureView(slot.texture);
            requireAttachmentView(view, `Color attachment ${String(index)}`);
            slot.descriptor.view = view;
            const resolveHandle = slot.resolveTarget;
            if (resolveHandle) {
                const resolveTexture = context.getTexture(resolveHandle);
                requireRenderAttachment(resolveTexture, `Resolve target ${String(index)}`);
                if (texture.sampleCount === 1 || resolveTexture.sampleCount !== 1) {
                    throw new Error(
                        'MSAA resolve requires a multisampled source and single-sample target'
                    );
                }
                if (
                    texture.format !== resolveTexture.format ||
                    !sameAttachmentShape(texture, resolveTexture)
                ) {
                    throw new Error('Resolve target format or dimensions do not match its source');
                }
                const resolveView = context.getTextureView(resolveHandle);
                requireAttachmentView(resolveView, `Resolve target ${String(index)}`);
                slot.descriptor.resolveTarget = resolveView;
            } else slot.descriptor.resolveTarget = undefined;
            this.descriptor.colorAttachments[index] = slot.descriptor;
        }

        const depthHandle = this.depthStencilTexture;
        if (depthHandle) {
            const depthTexture = context.getTexture(depthHandle);
            requireRenderAttachment(depthTexture, 'Depth/stencil attachment');
            if (
                !rhiTextureFormatHasDepth(depthTexture.format) &&
                !rhiTextureFormatHasStencil(depthTexture.format)
            ) {
                throw new Error('Depth/stencil attachment requires a depth or stencil format');
            }
            if (
                this.depthStencilDescriptor.depthLoadOp === 'clear' &&
                this.depthStencilDescriptor.depthClearValue === undefined
            ) {
                throw new Error('Depth clear requires a depth clear value');
            }
            if (
                this.depthStencilDescriptor.stencilLoadOp === 'clear' &&
                this.depthStencilDescriptor.stencilClearValue === undefined
            ) {
                throw new Error('Stencil clear requires a stencil clear value');
            }
            if (reference)
                requireMatchingAttachment(reference, depthTexture, 'Depth/stencil attachment');
            const view = context.getTextureView(depthHandle);
            requireAttachmentView(view, 'Depth/stencil attachment');
            this.depthStencilDescriptor.view = view;
            this.descriptor.depthStencilAttachment = this.depthStencilDescriptor;
        } else this.descriptor.depthStencilAttachment = undefined;

        this.prepareCallback?.(context, this);
        for (let index = 0; index < this.activeDrawCount; index += 1) {
            const draw = this.draws[index];
            if (!draw) throw MISSING_DRAW_ERROR;
            draw.prepareVertexInput();
        }
        this.prepared = true;
    }

    /** @internal Allocation-free steady-state command path. */
    execute(context: RGPassContext): void {
        if (!this.prepared) throw UNPREPARED_PASS_ERROR;
        const pass = context.commandContext.beginRenderPass(
            this.descriptor as unknown as RHIRenderPassDescriptor
        );
        if (this.hasViewport) {
            pass.setViewportRecord(this.viewport);
            this.drawViewportState.minDepth = this.viewport.minDepth;
            this.drawViewportState.maxDepth = this.viewport.maxDepth;
        }
        if (this.hasScissor) pass.setScissorRectRecord(this.scissor);
        let previousDraw: PreparedDraw | null = null;
        for (let index = 0; index < this.activeDrawCount; index += 1) {
            const draw = this.draws[index];
            if (!draw) throw MISSING_DRAW_ERROR;
            draw.execute(
                pass,
                this.hasViewport ? this.viewport : undefined,
                this.hasViewport ? this.drawViewportState : undefined,
                previousDraw
            );
            previousDraw = draw;
        }
        pass.end();
        this.prepared = false;
    }

    /** @internal Begin a prepared raster pass for a scriptable command facade. */
    beginExecute(context: RGPassContext): RHIRenderPassEncoder {
        if (!this.prepared) throw UNPREPARED_PASS_ERROR;
        const pass = context.commandContext.beginRenderPass(
            this.descriptor as unknown as RHIRenderPassDescriptor
        );
        if (this.hasViewport) {
            pass.setViewportRecord(this.viewport);
            this.drawViewportState.minDepth = this.viewport.minDepth;
            this.drawViewportState.maxDepth = this.viewport.maxDepth;
        }
        if (this.hasScissor) pass.setScissorRectRecord(this.scissor);
        return pass;
    }

    /** @internal Execute one setup-declared renderer-list range without allocating. */
    executeDrawRange(
        pass: RHIRenderPassEncoder,
        start: number,
        count: number,
        previousDraw: PreparedDraw | null
    ): PreparedDraw | null {
        if (!this.prepared) throw UNPREPARED_PASS_ERROR;
        if (
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(count) ||
            start < 0 ||
            count < 0 ||
            start + count > this.activeDrawCount
        ) {
            throw new RangeError('Draw range is outside the active pass draws');
        }
        const end = start + count;
        for (let index = start; index < end; index += 1) {
            const draw = this.draws[index];
            if (!draw) throw MISSING_DRAW_ERROR;
            draw.execute(
                pass,
                this.hasViewport ? this.viewport : undefined,
                this.hasViewport ? this.drawViewportState : undefined,
                previousDraw
            );
            previousDraw = draw;
        }
        return previousDraw;
    }

    /** @internal End a scriptable raster command scope and consume its prepared state. */
    endExecute(pass: RHIRenderPassEncoder): void {
        if (!this.prepared) throw UNPREPARED_PASS_ERROR;
        pass.end();
        this.prepared = false;
    }
}

/** Alias kept concise for frame planners that store many pass records. */
export { SharedDrawPassParameters as DrawPassParameters };

export function createSharedDrawPassTemplate(
    name: string,
    forceSideEffect = false
): RenderPassTemplate<SharedDrawPassParameters> {
    if (name.length === 0) throw new Error('Shared draw pass template name must be non-empty');
    const template: RenderPassTemplate<SharedDrawPassParameters> = {
        name,
        setup(builder, params) {
            params.declare(builder, forceSideEffect);
        },
        prepare(context, params) {
            params.prepareForExecute(context, name);
        },
        execute(context, params) {
            params.execute(context);
        }
    };
    return Object.freeze(template);
}
