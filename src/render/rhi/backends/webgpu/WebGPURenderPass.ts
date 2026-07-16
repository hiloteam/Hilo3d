import type {
    RHIDrawArgumentsRecord,
    RHIIndexBufferBindingRecord,
    RHIRenderPassDescriptor,
    RHIRenderPassEncoder,
    RHIRenderPassState,
    RHIVertexBufferBindingRecord
} from '../../core/RHICommands';
import type { RHIBindGroup, RHIGraphicsPipeline } from '../../core/RHIPipeline';
import type { RHIBuffer } from '../../core/RHIResources';
import {
    RHIBufferUsage,
    type RHIColor,
    type RHIIndexFormat,
    type RHIRect,
    type RHIViewport,
    type RHIUInt32View
} from '../../core/RHITypes';
import {
    RHIValidationError,
    createRHIRenderPassDescriptorSnapshotStorage,
    snapshotRHIRenderPassDescriptorInto,
    validateRHIRenderPassPipelineDepthStencilAccess,
    type RHIRenderPassDescriptorSnapshotStorage
} from '../../core/RHIValidation';
import {
    WebGPUObject,
    assertBufferRange,
    assertNonNegativeSafeInteger,
    assertPositiveSafeInteger
} from './WebGPUBase';
import type { WebGPUCommandContext } from './WebGPUCommands';
import type { WebGPUDevice } from './WebGPUDevice';
import { WebGPUBindGroup, WebGPUGraphicsPipeline } from './WebGPUPipeline';
import { WebGPUBuffer } from './WebGPUResources';

function validationFailure(
    code: ConstructorParameters<typeof RHIValidationError>[0],
    message: string,
    path: string
): never {
    throw new RHIValidationError(code, message, path);
}

function webGPUBuffer(device: WebGPUDevice, buffer: RHIBuffer, path: string): WebGPUBuffer {
    device.assertUsable(buffer, path);
    if (!(buffer instanceof WebGPUBuffer) || buffer.owner !== device) {
        return validationFailure('wrong-device', 'expected a WebGPU RHI buffer', path);
    }
    return buffer;
}

function firstAttachmentView(descriptor: Readonly<RHIRenderPassDescriptor>) {
    let view = descriptor.depthStencilAttachment?.view;
    let index = 0;
    while (index < descriptor.colorAttachments.length) {
        const attachment = descriptor.colorAttachments[index];
        index++;
        if (attachment !== null && attachment !== undefined) {
            view = attachment.view;
            break;
        }
    }
    return view;
}

/** Queue-owned pass backing returned as soon as the native encoder is ended or aborted. */
export class WebGPURenderPassStorage {
    readonly snapshot: RHIRenderPassDescriptorSnapshotStorage;
    readonly boundBindGroups: (WebGPUBindGroup | null)[];
    readonly boundVertexBuffers: (WebGPUBuffer | null)[];
    readonly boundVertexBufferOffsets: Float64Array;
    readonly boundVertexBufferSizes: Float64Array;

    constructor(readonly owner: WebGPUDevice) {
        this.snapshot = createRHIRenderPassDescriptorSnapshotStorage();
        this.boundBindGroups = new Array<WebGPUBindGroup | null>(
            owner.capabilities.limits.maxBindGroups
        ).fill(null);
        this.boundVertexBuffers = new Array<WebGPUBuffer | null>(
            owner.capabilities.limits.maxVertexBuffers
        ).fill(null);
        this.boundVertexBufferOffsets = new Float64Array(this.boundVertexBuffers.length);
        this.boundVertexBufferSizes = new Float64Array(this.boundVertexBuffers.length);
    }

    prepare(
        descriptor: RHIRenderPassDescriptor,
        context: WebGPUCommandContext
    ): Readonly<RHIRenderPassDescriptor> {
        if (snapshotRHIRenderPassDescriptorInto(this.owner, descriptor, this.snapshot)) {
            context.diagnostics.frameArenaGrowths += 1;
            context.diagnostics.transientAllocations += 1;
        }
        this.boundBindGroups.fill(null);
        this.boundVertexBuffers.fill(null);
        this.boundVertexBufferOffsets.fill(0);
        this.boundVertexBufferSizes.fill(0);
        return this.snapshot.descriptor;
    }

    release(): void {
        this.boundBindGroups.fill(null);
        this.boundVertexBuffers.fill(null);
    }
}

export class WebGPURenderPass extends WebGPUObject implements RHIRenderPassEncoder {
    readonly contextId: number;
    readonly #storage: WebGPURenderPassStorage;
    readonly #descriptor: Readonly<RHIRenderPassDescriptor>;
    readonly #nativePass: GPURenderPassEncoder;
    readonly #extentWidth: number;
    readonly #extentHeight: number;
    readonly #boundBindGroups: (WebGPUBindGroup | null)[];
    readonly #boundVertexBuffers: (WebGPUBuffer | null)[];
    readonly #boundVertexBufferOffsets: Float64Array;
    readonly #boundVertexBufferSizes: Float64Array;
    #passState: RHIRenderPassState = 'open';
    #pipeline: WebGPUGraphicsPipeline | null = null;
    #indexBuffer: WebGPUBuffer | null = null;
    #indexFormat: RHIIndexFormat = 'uint16';
    #indexOffset = 0;
    #indexSize = 0;
    #viewportStateChanged = false;
    #scissorStateChanged = false;

    constructor(
        readonly context: WebGPUCommandContext,
        nativePass: GPURenderPassEncoder,
        storage: WebGPURenderPassStorage
    ) {
        const descriptor = storage.snapshot.descriptor;
        super(context.owner, descriptor.label ?? 'WebGPU render pass');
        this.contextId = context.id;
        this.#nativePass = nativePass;
        this.#storage = storage;
        this.#descriptor = descriptor;
        const attachment = firstAttachmentView(descriptor);
        if (attachment === undefined) {
            this.#extentWidth = 0;
            this.#extentHeight = 0;
        } else {
            const divisor = 2 ** attachment.descriptor.baseMipLevel;
            this.#extentWidth = Math.max(1, Math.floor(attachment.texture.width / divisor));
            this.#extentHeight = Math.max(1, Math.floor(attachment.texture.height / divisor));
        }
        this.#boundBindGroups = storage.boundBindGroups;
        this.#boundVertexBuffers = storage.boundVertexBuffers;
        this.#boundVertexBufferOffsets = storage.boundVertexBufferOffsets;
        this.#boundVertexBufferSizes = storage.boundVertexBufferSizes;
    }

    get state(): RHIRenderPassState {
        return this.#passState;
    }

    setPipeline(pipeline: RHIGraphicsPipeline): void {
        this.assertOpen();
        this.context.owner.assertUsable(pipeline, 'pipeline');
        if (!(pipeline instanceof WebGPUGraphicsPipeline) || pipeline.owner !== this.owner) {
            validationFailure('wrong-device', 'expected a WebGPU RHI pipeline', 'pipeline');
        }
        this.validatePipelineCompatibility(pipeline);
        this.context.retain(pipeline);
        this.context.diagnostics.commandCount += 1;
        if (this.#pipeline === pipeline) return;
        this.#nativePass.setPipeline(pipeline.nativeHandle);
        this.#pipeline = pipeline;
        this.context.diagnostics.pipelineSwitches += 1;
        this.context.diagnostics.nativeStateCalls += 1;
    }

    setBindGroup(index: number, bindGroup: RHIBindGroup, dynamicOffsets?: RHIUInt32View): void {
        this.assertOpen();
        assertNonNegativeSafeInteger(index, 'bindGroup.index');
        if (index >= this.#boundBindGroups.length) {
            validationFailure('out-of-bounds', 'bind group index exceeds device limit', 'index');
        }
        this.context.owner.assertUsable(bindGroup, 'bindGroup');
        if (!(bindGroup instanceof WebGPUBindGroup) || bindGroup.owner !== this.owner) {
            validationFailure('wrong-device', 'expected a WebGPU RHI bind group', 'bindGroup');
        }
        if (this.#pipeline !== null) {
            this.validateBindGroupLayout(index, bindGroup, this.#pipeline);
        }
        this.validateDynamicOffsets(bindGroup, dynamicOffsets);
        this.context.retain(bindGroup);
        const resources = bindGroup.referencedResources;
        let resourceIndex = 0;
        while (resourceIndex < resources.length) {
            const resource = resources[resourceIndex];
            resourceIndex++;
            if (resource !== undefined) this.context.retain(resource);
        }
        this.context.diagnostics.commandCount += 1;
        if (dynamicOffsets === undefined && this.#boundBindGroups[index] === bindGroup) return;
        if (dynamicOffsets === undefined) {
            this.#nativePass.setBindGroup(index, bindGroup.nativeHandle);
        } else {
            this.#nativePass.setBindGroup(index, bindGroup.nativeHandle, dynamicOffsets);
        }
        this.#boundBindGroups[index] = bindGroup;
        this.context.diagnostics.bindGroupSwitches += 1;
        this.context.diagnostics.nativeStateCalls += 1;
    }

    setVertexBuffer(
        slot: number,
        buffer: RHIBuffer,
        offset = 0,
        size = buffer.size - offset
    ): void {
        this.assertOpen();
        assertNonNegativeSafeInteger(slot, 'vertexBuffer.slot');
        if (slot >= this.#boundVertexBuffers.length) {
            validationFailure('out-of-bounds', 'vertex buffer slot exceeds device limit', 'slot');
        }
        const nativeBuffer = webGPUBuffer(this.owner, buffer, 'vertexBuffer.buffer');
        if ((nativeBuffer.usage & RHIBufferUsage.VERTEX) === 0) {
            validationFailure(
                'invalid-descriptor',
                'buffer lacks VERTEX usage',
                'vertexBuffer.buffer'
            );
        }
        assertBufferRange(
            nativeBuffer.size,
            offset,
            size,
            'vertexBuffer',
            'vertexBuffer.offset',
            'vertexBuffer.size'
        );
        if (offset % 4 !== 0) {
            validationFailure(
                'invalid-descriptor',
                'vertex buffer offset must be 4-byte aligned',
                'vertexBuffer.offset'
            );
        }
        this.context.retain(nativeBuffer);
        this.context.diagnostics.commandCount += 1;
        const previousBuffer = this.#boundVertexBuffers[slot];
        if (
            previousBuffer === nativeBuffer &&
            this.#boundVertexBufferOffsets[slot] === offset &&
            this.#boundVertexBufferSizes[slot] === size
        ) {
            return;
        }
        this.#nativePass.setVertexBuffer(slot, nativeBuffer.nativeHandle, offset, size);
        this.#boundVertexBuffers[slot] = nativeBuffer;
        this.#boundVertexBufferOffsets[slot] = offset;
        this.#boundVertexBufferSizes[slot] = size;
        this.context.diagnostics.vertexBufferSwitches += 1;
        this.context.diagnostics.nativeStateCalls += 1;
    }

    setVertexBufferRecord(record: Readonly<RHIVertexBufferBindingRecord>): void {
        const slot = record.slot;
        const buffer = record.buffer;
        const offset = record.offset;
        const size = record.size ?? buffer.size - offset;
        this.assertOpen();
        assertNonNegativeSafeInteger(slot, 'vertexBuffer.slot');
        if (slot >= this.#boundVertexBuffers.length) {
            validationFailure('out-of-bounds', 'vertex buffer slot exceeds device limit', 'slot');
        }
        const nativeBuffer = webGPUBuffer(this.owner, buffer, 'vertexBuffer.buffer');
        if ((nativeBuffer.usage & RHIBufferUsage.VERTEX) === 0) {
            validationFailure(
                'invalid-descriptor',
                'buffer lacks VERTEX usage',
                'vertexBuffer.buffer'
            );
        }
        assertBufferRange(
            nativeBuffer.size,
            offset,
            size,
            'vertexBuffer',
            'vertexBuffer.offset',
            'vertexBuffer.size'
        );
        if (offset % 4 !== 0) {
            validationFailure(
                'invalid-descriptor',
                'vertex buffer offset must be 4-byte aligned',
                'vertexBuffer.offset'
            );
        }
        this.context.retain(nativeBuffer);
        this.context.diagnostics.commandCount += 1;
        const previousBuffer = this.#boundVertexBuffers[slot];
        if (
            previousBuffer === nativeBuffer &&
            this.#boundVertexBufferOffsets[slot] === offset &&
            this.#boundVertexBufferSizes[slot] === size
        ) {
            return;
        }
        this.#nativePass.setVertexBuffer(slot, nativeBuffer.nativeHandle, offset, size);
        this.#boundVertexBuffers[slot] = nativeBuffer;
        this.#boundVertexBufferOffsets[slot] = offset;
        this.#boundVertexBufferSizes[slot] = size;
        this.context.diagnostics.vertexBufferSwitches += 1;
        this.context.diagnostics.nativeStateCalls += 1;
    }

    setIndexBuffer(
        buffer: RHIBuffer,
        format: RHIIndexFormat,
        offset = 0,
        size = buffer.size - offset
    ): void {
        this.assertOpen();
        const nativeBuffer = webGPUBuffer(this.owner, buffer, 'indexBuffer.buffer');
        if ((nativeBuffer.usage & RHIBufferUsage.INDEX) === 0) {
            validationFailure(
                'invalid-descriptor',
                'buffer lacks INDEX usage',
                'indexBuffer.buffer'
            );
        }
        assertBufferRange(
            nativeBuffer.size,
            offset,
            size,
            'indexBuffer',
            'indexBuffer.offset',
            'indexBuffer.size'
        );
        const alignment = format === 'uint16' ? 2 : 4;
        if (offset % alignment !== 0 || size % alignment !== 0) {
            validationFailure(
                'invalid-descriptor',
                `index buffer range must be ${String(alignment)}-byte aligned`,
                'indexBuffer'
            );
        }
        this.context.retain(nativeBuffer);
        this.context.diagnostics.commandCount += 1;
        if (
            this.#indexBuffer === nativeBuffer &&
            this.#indexFormat === format &&
            this.#indexOffset === offset &&
            this.#indexSize === size
        ) {
            return;
        }
        this.#nativePass.setIndexBuffer(nativeBuffer.nativeHandle, format, offset, size);
        this.#indexBuffer = nativeBuffer;
        this.#indexFormat = format;
        this.#indexOffset = offset;
        this.#indexSize = size;
        this.context.diagnostics.nativeStateCalls += 1;
    }

    setIndexBufferRecord(record: Readonly<RHIIndexBufferBindingRecord>): void {
        const buffer = record.buffer;
        const format = record.format;
        const offset = record.offset;
        const size = record.size ?? buffer.size - offset;
        this.assertOpen();
        const nativeBuffer = webGPUBuffer(this.owner, buffer, 'indexBuffer.buffer');
        if ((nativeBuffer.usage & RHIBufferUsage.INDEX) === 0) {
            validationFailure(
                'invalid-descriptor',
                'buffer lacks INDEX usage',
                'indexBuffer.buffer'
            );
        }
        assertBufferRange(
            nativeBuffer.size,
            offset,
            size,
            'indexBuffer',
            'indexBuffer.offset',
            'indexBuffer.size'
        );
        const alignment = format === 'uint16' ? 2 : 4;
        if (offset % alignment !== 0 || size % alignment !== 0) {
            validationFailure(
                'invalid-descriptor',
                `index buffer range must be ${String(alignment)}-byte aligned`,
                'indexBuffer'
            );
        }
        this.context.retain(nativeBuffer);
        this.context.diagnostics.commandCount += 1;
        if (
            this.#indexBuffer === nativeBuffer &&
            this.#indexFormat === format &&
            this.#indexOffset === offset &&
            this.#indexSize === size
        ) {
            return;
        }
        this.#nativePass.setIndexBuffer(nativeBuffer.nativeHandle, format, offset, size);
        this.#indexBuffer = nativeBuffer;
        this.#indexFormat = format;
        this.#indexOffset = offset;
        this.#indexSize = size;
        this.context.diagnostics.nativeStateCalls += 1;
    }

    setViewport(
        x: number,
        y: number,
        width: number,
        height: number,
        minDepth: number,
        maxDepth: number
    ): void {
        this.assertOpen();
        if (!Number.isFinite(x))
            validationFailure('invalid-descriptor', 'must be finite', 'viewport.x');
        if (!Number.isFinite(y))
            validationFailure('invalid-descriptor', 'must be finite', 'viewport.y');
        if (!Number.isFinite(width))
            validationFailure('invalid-descriptor', 'must be finite', 'viewport.width');
        if (!Number.isFinite(height))
            validationFailure('invalid-descriptor', 'must be finite', 'viewport.height');
        if (!Number.isFinite(minDepth))
            validationFailure('invalid-descriptor', 'must be finite', 'viewport.minDepth');
        if (!Number.isFinite(maxDepth))
            validationFailure('invalid-descriptor', 'must be finite', 'viewport.maxDepth');
        if (width < 0 || height < 0 || minDepth < 0 || maxDepth > 1 || minDepth > maxDepth) {
            validationFailure('invalid-descriptor', 'contains an invalid range', 'viewport');
        }
        if (
            !this.#viewportStateChanged &&
            x === 0 &&
            y === 0 &&
            width === this.#extentWidth &&
            height === this.#extentHeight &&
            minDepth === 0 &&
            maxDepth === 1
        ) {
            this.context.diagnostics.commandCount += 1;
            return;
        }
        this.#viewportStateChanged = true;
        this.#nativePass.setViewport(x, y, width, height, minDepth, maxDepth);
        this.recordNativeStateCommand();
    }

    setViewportRecord(viewport: Readonly<RHIViewport>): void {
        this.assertOpen();
        if (!Number.isFinite(viewport.x))
            validationFailure('invalid-descriptor', 'must be finite', 'viewport.x');
        if (!Number.isFinite(viewport.y))
            validationFailure('invalid-descriptor', 'must be finite', 'viewport.y');
        if (!Number.isFinite(viewport.width))
            validationFailure('invalid-descriptor', 'must be finite', 'viewport.width');
        if (!Number.isFinite(viewport.height))
            validationFailure('invalid-descriptor', 'must be finite', 'viewport.height');
        if (!Number.isFinite(viewport.minDepth))
            validationFailure('invalid-descriptor', 'must be finite', 'viewport.minDepth');
        if (!Number.isFinite(viewport.maxDepth))
            validationFailure('invalid-descriptor', 'must be finite', 'viewport.maxDepth');
        if (
            viewport.width < 0 ||
            viewport.height < 0 ||
            viewport.minDepth < 0 ||
            viewport.maxDepth > 1 ||
            viewport.minDepth > viewport.maxDepth
        ) {
            validationFailure('invalid-descriptor', 'contains an invalid range', 'viewport');
        }
        if (
            !this.#viewportStateChanged &&
            viewport.x === 0 &&
            viewport.y === 0 &&
            viewport.width === this.#extentWidth &&
            viewport.height === this.#extentHeight &&
            viewport.minDepth === 0 &&
            viewport.maxDepth === 1
        ) {
            this.context.diagnostics.commandCount += 1;
            return;
        }
        this.#viewportStateChanged = true;
        this.#nativePass.setViewport(
            viewport.x,
            viewport.y,
            viewport.width,
            viewport.height,
            viewport.minDepth,
            viewport.maxDepth
        );
        this.recordNativeStateCommand();
    }

    setScissorRect(x: number, y: number, width: number, height: number): void {
        this.assertOpen();
        assertNonNegativeSafeInteger(x, 'scissor.x');
        assertNonNegativeSafeInteger(y, 'scissor.y');
        assertPositiveSafeInteger(width, 'scissor.width');
        assertPositiveSafeInteger(height, 'scissor.height');
        if (x > this.#extentWidth || width > this.#extentWidth - x) {
            validationFailure('out-of-bounds', 'exceeds attachment width', 'scissor.width');
        }
        if (y > this.#extentHeight || height > this.#extentHeight - y) {
            validationFailure('out-of-bounds', 'exceeds attachment height', 'scissor.height');
        }
        if (
            !this.#scissorStateChanged &&
            x === 0 &&
            y === 0 &&
            width === this.#extentWidth &&
            height === this.#extentHeight
        ) {
            this.context.diagnostics.commandCount += 1;
            return;
        }
        this.#scissorStateChanged = true;
        this.#nativePass.setScissorRect(x, y, width, height);
        this.recordNativeStateCommand();
    }

    setScissorRectRecord(rect: Readonly<RHIRect>): void {
        this.assertOpen();
        assertNonNegativeSafeInteger(rect.x, 'scissor.x');
        assertNonNegativeSafeInteger(rect.y, 'scissor.y');
        assertPositiveSafeInteger(rect.width, 'scissor.width');
        assertPositiveSafeInteger(rect.height, 'scissor.height');
        if (rect.x > this.#extentWidth || rect.width > this.#extentWidth - rect.x) {
            validationFailure('out-of-bounds', 'exceeds attachment width', 'scissor.width');
        }
        if (rect.y > this.#extentHeight || rect.height > this.#extentHeight - rect.y) {
            validationFailure('out-of-bounds', 'exceeds attachment height', 'scissor.height');
        }
        if (
            !this.#scissorStateChanged &&
            rect.x === 0 &&
            rect.y === 0 &&
            rect.width === this.#extentWidth &&
            rect.height === this.#extentHeight
        ) {
            this.context.diagnostics.commandCount += 1;
            return;
        }
        this.#scissorStateChanged = true;
        this.#nativePass.setScissorRect(rect.x, rect.y, rect.width, rect.height);
        this.recordNativeStateCommand();
    }

    setBlendConstant(color: RHIColor): void {
        this.assertOpen();
        if (
            !Number.isFinite(color.r) ||
            !Number.isFinite(color.g) ||
            !Number.isFinite(color.b) ||
            !Number.isFinite(color.a)
        ) {
            validationFailure('invalid-descriptor', 'components must be finite', 'blendConstant');
        }
        this.#nativePass.setBlendConstant(color);
        this.recordNativeStateCommand();
    }

    setStencilReference(reference: number): void {
        this.assertOpen();
        assertNonNegativeSafeInteger(reference, 'stencilReference');
        if (reference > 0xffffffff) {
            validationFailure('out-of-bounds', 'must fit in uint32', 'stencilReference');
        }
        this.#nativePass.setStencilReference(reference);
        this.recordNativeStateCommand();
    }

    draw(vertexCount: number, instanceCount = 1, firstVertex = 0, firstInstance = 0): void {
        this.assertOpen();
        const pipeline = this.assertPipelineAndBindings(false);
        void pipeline;
        assertPositiveSafeInteger(vertexCount, 'draw.vertexCount');
        assertPositiveSafeInteger(instanceCount, 'draw.instanceCount');
        assertNonNegativeSafeInteger(firstVertex, 'draw.firstVertex');
        assertNonNegativeSafeInteger(firstInstance, 'draw.firstInstance');
        this.#nativePass.draw(vertexCount, instanceCount, firstVertex, firstInstance);
        this.context.diagnostics.commandCount += 1;
        this.context.diagnostics.drawCount += 1;
        this.context.diagnostics.nativeStateCalls += 1;
    }

    drawRecord(record: Readonly<RHIDrawArgumentsRecord>): void {
        const vertexCount = record.elementCount;
        const instanceCount = record.instanceCount;
        const firstVertex = record.firstElement;
        const firstInstance = record.firstInstance;
        this.assertOpen();
        const pipeline = this.assertPipelineAndBindings(false);
        void pipeline;
        assertPositiveSafeInteger(vertexCount, 'draw.vertexCount');
        assertPositiveSafeInteger(instanceCount, 'draw.instanceCount');
        assertNonNegativeSafeInteger(firstVertex, 'draw.firstVertex');
        assertNonNegativeSafeInteger(firstInstance, 'draw.firstInstance');
        this.#nativePass.draw(vertexCount, instanceCount, firstVertex, firstInstance);
        this.context.diagnostics.commandCount += 1;
        this.context.diagnostics.drawCount += 1;
        this.context.diagnostics.nativeStateCalls += 1;
    }

    drawIndexed(
        indexCount: number,
        instanceCount = 1,
        firstIndex = 0,
        baseVertex = 0,
        firstInstance = 0
    ): void {
        this.assertOpen();
        this.assertPipelineAndBindings(true);
        assertPositiveSafeInteger(indexCount, 'drawIndexed.indexCount');
        assertPositiveSafeInteger(instanceCount, 'drawIndexed.instanceCount');
        assertNonNegativeSafeInteger(firstIndex, 'drawIndexed.firstIndex');
        if (!Number.isSafeInteger(baseVertex)) {
            validationFailure(
                'invalid-descriptor',
                'must be a safe integer',
                'drawIndexed.baseVertex'
            );
        }
        assertNonNegativeSafeInteger(firstInstance, 'drawIndexed.firstInstance');
        this.#nativePass.drawIndexed(
            indexCount,
            instanceCount,
            firstIndex,
            baseVertex,
            firstInstance
        );
        this.context.diagnostics.commandCount += 1;
        this.context.diagnostics.drawCount += 1;
        this.context.diagnostics.nativeStateCalls += 1;
    }

    drawIndexedRecord(record: Readonly<RHIDrawArgumentsRecord>): void {
        const indexCount = record.elementCount;
        const instanceCount = record.instanceCount;
        const firstIndex = record.firstElement;
        const baseVertex = record.baseVertex;
        const firstInstance = record.firstInstance;
        this.assertOpen();
        this.assertPipelineAndBindings(true);
        assertPositiveSafeInteger(indexCount, 'drawIndexed.indexCount');
        assertPositiveSafeInteger(instanceCount, 'drawIndexed.instanceCount');
        assertNonNegativeSafeInteger(firstIndex, 'drawIndexed.firstIndex');
        if (!Number.isSafeInteger(baseVertex)) {
            validationFailure(
                'invalid-descriptor',
                'must be a safe integer',
                'drawIndexed.baseVertex'
            );
        }
        assertNonNegativeSafeInteger(firstInstance, 'drawIndexed.firstInstance');
        this.#nativePass.drawIndexed(
            indexCount,
            instanceCount,
            firstIndex,
            baseVertex,
            firstInstance
        );
        this.context.diagnostics.commandCount += 1;
        this.context.diagnostics.drawCount += 1;
        this.context.diagnostics.nativeStateCalls += 1;
    }

    end(): void {
        this.assertOpen();
        this.#nativePass.end();
        this.context.diagnostics.commandCount += 1;
        this.context.diagnostics.nativeStateCalls += 1;
        this.#passState = 'ended';
        this.#pipeline = null;
        this.#indexBuffer = null;
        this.context.closePass(this, this.#storage);
    }

    /** @internal */
    abort(): void {
        if (this.#passState !== 'open') return;
        this.#passState = 'aborted';
        this.#pipeline = null;
        this.#indexBuffer = null;
        this.context.abortPass(this, this.#storage);
    }

    private recordNativeStateCommand(): void {
        this.context.diagnostics.commandCount += 1;
        this.context.diagnostics.nativeStateCalls += 1;
    }

    private assertOpen(): void {
        this.context.owner.assertUsable(this, 'renderPass');
        if (this.#passState !== 'open' || this.context.state !== 'render-pass') {
            validationFailure('invalid-state', `render pass is ${this.#passState}`, 'renderPass');
        }
    }

    private validatePipelineCompatibility(pipeline: WebGPUGraphicsPipeline): void {
        const fragment = pipeline.descriptor.fragment;
        if (fragment !== undefined) {
            const targets = fragment.targets;
            for (let index = 0; index < targets.length; index += 1) {
                const target = targets[index];
                if (target === null || target === undefined) continue;
                const attachment = this.#descriptor.colorAttachments[index];
                if (attachment === null || attachment === undefined) {
                    validationFailure(
                        'incompatible-layout',
                        'pipeline target has no render-pass attachment',
                        `pipeline.fragment.targets[${String(index)}]`
                    );
                }
                if (target.format !== attachment.view.format) {
                    validationFailure(
                        'incompatible-layout',
                        'pipeline target format does not match render pass',
                        `pipeline.fragment.targets[${String(index)}].format`
                    );
                }
            }
        }
        let firstAttachment = this.#descriptor.depthStencilAttachment?.view;
        let index = 0;
        while (index < this.#descriptor.colorAttachments.length) {
            const attachment = this.#descriptor.colorAttachments[index];
            index++;
            if (attachment !== null && attachment !== undefined) {
                firstAttachment = attachment.view;
                break;
            }
        }
        if (
            (pipeline.descriptor.multisample?.count ?? 1) !==
            (firstAttachment?.texture.sampleCount ?? 1)
        ) {
            validationFailure(
                'incompatible-layout',
                'pipeline sample count does not match render pass',
                'pipeline.multisample.count'
            );
        }
        const depthStencil = pipeline.descriptor.depthStencil;
        if (depthStencil !== undefined) {
            const attachment = this.#descriptor.depthStencilAttachment;
            if (attachment?.view.format !== depthStencil.format) {
                validationFailure(
                    'incompatible-layout',
                    'pipeline depth/stencil state does not match render pass',
                    'pipeline.depthStencil'
                );
            }
        }
        validateRHIRenderPassPipelineDepthStencilAccess(this.#descriptor, pipeline.descriptor);
    }

    private validateBindGroupLayout(
        index: number,
        bindGroup: WebGPUBindGroup,
        pipeline: WebGPUGraphicsPipeline
    ): void {
        if (pipeline.descriptor.layout.bindGroupLayouts[index] !== bindGroup.layout) {
            validationFailure(
                'incompatible-layout',
                'bind group layout does not match pipeline',
                `bindGroup[${String(index)}]`
            );
        }
    }

    private validateDynamicOffsets(
        bindGroup: WebGPUBindGroup,
        dynamicOffsets: RHIUInt32View | undefined
    ): void {
        const bindings = bindGroup.dynamicBufferBindings;
        const count = dynamicOffsets?.length ?? 0;
        if (count !== bindings.length) {
            validationFailure(
                'incompatible-layout',
                'dynamic offset count does not match bind group layout',
                'dynamicOffsets'
            );
        }
        for (let index = 0; index < bindings.length; index += 1) {
            const binding = bindings[index];
            const offset = dynamicOffsets?.[index];
            if (binding === undefined || offset === undefined) continue;
            if (offset % binding.alignment !== 0) {
                validationFailure(
                    'invalid-descriptor',
                    'dynamic offset does not meet device alignment',
                    `dynamicOffsets[${String(index)}]`
                );
            }
            if (
                binding.baseOffset > binding.buffer.size ||
                offset > binding.buffer.size - binding.baseOffset ||
                binding.size > binding.buffer.size - binding.baseOffset - offset
            ) {
                validationFailure(
                    'out-of-bounds',
                    'dynamic buffer binding exceeds buffer size',
                    `dynamicOffsets[${String(index)}]`
                );
            }
        }
    }

    private assertPipelineAndBindings(indexed: boolean): WebGPUGraphicsPipeline {
        const pipeline = this.#pipeline;
        if (pipeline === null) {
            return validationFailure(
                'invalid-state',
                'draw requires a graphics pipeline',
                'pipeline'
            );
        }
        for (let index = 0; index < pipeline.requiredBindGroups.length; index += 1) {
            if (pipeline.requiredBindGroups[index] !== true) continue;
            const bindGroup = this.#boundBindGroups[index];
            if (bindGroup === null || bindGroup === undefined) {
                validationFailure(
                    'invalid-state',
                    'draw requires all pipeline bind groups',
                    `bindGroup[${String(index)}]`
                );
            }
            this.validateBindGroupLayout(index, bindGroup, pipeline);
        }
        for (let slot = 0; slot < pipeline.requiredVertexBuffers.length; slot += 1) {
            if (
                pipeline.requiredVertexBuffers[slot] === true &&
                this.#boundVertexBuffers[slot] === null
            ) {
                validationFailure(
                    'invalid-state',
                    'draw requires all pipeline vertex buffers',
                    `vertexBuffer[${String(slot)}]`
                );
            }
        }
        if (indexed && this.#indexBuffer === null) {
            validationFailure(
                'invalid-state',
                'drawIndexed requires an index buffer',
                'indexBuffer'
            );
        }
        return pipeline;
    }
}
