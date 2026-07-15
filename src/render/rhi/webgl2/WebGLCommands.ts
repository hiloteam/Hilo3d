import {
    RHIBufferUsage,
    type RHIBindGroup,
    type RHIBuffer,
    type RHIColor,
    type RHICommandBuffer,
    type RHICommandEncoder,
    type RHIExtent3D,
    type RHIImageCopyBuffer,
    type RHIImageCopyTexture,
    type RHIIndexFormat,
    type RHIRenderPassDescriptor,
    type RHIRenderPassEncoder,
    type RHIRenderPipeline
} from '../RHI';
import {
    WebGLObjectBase,
    labelOf,
    requireFinite,
    requireInteger,
    requireRange,
    hasUsage
} from './WebGLInternal';
import type { WebGLRHITextureView } from './WebGLResources';
import type {
    BoundGroupState,
    IndexBufferBindingState,
    VertexBufferBindingState,
    WebGLRHIRenderPipeline
} from './WebGLPipeline';
import type { WebGLRHIDevice } from './WebGLDevice';

export interface WebGLRenderPassTarget {
    readonly framebuffer: WebGLFramebuffer | null;
    readonly width: number;
    readonly height: number;
    readonly sampleCount: number;
    readonly colorViews: readonly (WebGLRHITextureView | null)[];
    readonly depthStencilView: WebGLRHITextureView | null;
}

function sameNumericValues(left: readonly number[], right: readonly number[]): boolean {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index++) {
        if (left[index] !== right[index]) return false;
    }
    return true;
}

function snapshotRenderPassDescriptor(
    descriptor: RHIRenderPassDescriptor
): RHIRenderPassDescriptor {
    const colorAttachments = descriptor.colorAttachments.map(attachment => {
        if (!attachment) return null;
        const clearValue = attachment.clearValue
            ? Object.freeze({ ...attachment.clearValue })
            : undefined;
        return Object.freeze({
            view: attachment.view,
            ...(attachment.resolveTarget === undefined
                ? {}
                : { resolveTarget: attachment.resolveTarget }),
            ...(clearValue ? { clearValue } : {}),
            loadOp: attachment.loadOp,
            storeOp: attachment.storeOp
        });
    });
    const depthStencilAttachment = descriptor.depthStencilAttachment
        ? Object.freeze({ ...descriptor.depthStencilAttachment })
        : undefined;
    return Object.freeze({
        ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
        colorAttachments: Object.freeze(colorAttachments),
        ...(depthStencilAttachment ? { depthStencilAttachment } : {})
    });
}

export class WebGLRHIRenderPassEncoder implements RHIRenderPassEncoder {
    readonly label: string;
    readonly encoder: WebGLRHICommandEncoder;
    readonly descriptor: RHIRenderPassDescriptor;
    readonly target: WebGLRenderPassTarget;
    private pipeline: WebGLRHIRenderPipeline | null = null;
    private readonly groups: (BoundGroupState | undefined)[] = [];
    private readonly vertexBuffers: (VertexBufferBindingState | undefined)[] = [];
    private indexBuffer: IndexBufferBindingState | null = null;
    private vertexArrayDirty = true;
    private bindingsDirty = true;
    private stencilReference = 0;
    private ended = false;

    constructor(encoder: WebGLRHICommandEncoder, descriptor: RHIRenderPassDescriptor) {
        const snapshot = snapshotRenderPassDescriptor(descriptor);
        this.encoder = encoder;
        for (let index = 0; index < encoder.device.limits.maxBindGroups; index++) {
            this.groups.push({ group: null, dynamicOffsets: [] });
        }
        this.descriptor = snapshot;
        this.label = labelOf(snapshot.label);
        this.target = encoder.device.beginRenderPass(snapshot);
        encoder.device.diagnostics?.recordRenderPass();
        this.clearAttachments();
        const { state, gl } = encoder.device;
        state.enable(gl.SCISSOR_TEST, false);
        state.viewport(0, 0, this.target.width, this.target.height);
        state.depthRange(0, 1);
    }

    setPipeline(pipeline: RHIRenderPipeline): void {
        this.assertActive();
        const concrete = this.encoder.device.requirePipeline(pipeline);
        concrete.assertUsable();
        this.validatePipelineAttachments(concrete);
        if (this.pipeline === concrete) return;
        this.pipeline = concrete;
        concrete.applyPipelineState(this.stencilReference);
        this.vertexArrayDirty = true;
        this.bindingsDirty = true;
    }

    setBindGroup(
        index: number,
        bindGroup: RHIBindGroup,
        dynamicOffsets: readonly number[] = []
    ): void {
        this.assertActive();
        requireInteger(index, 'Bind group index');
        const group = this.encoder.device.requireBindGroup(bindGroup);
        group.assertUsable();
        for (const offset of dynamicOffsets) requireInteger(offset, 'Dynamic offset');
        const previous = this.groups[index];
        if (!previous) throw new RangeError('Bind group index exceeds the device limit');
        if (previous.group === group && sameNumericValues(previous.dynamicOffsets, dynamicOffsets))
            return;
        previous.group = group;
        previous.dynamicOffsets.length = dynamicOffsets.length;
        for (let offsetIndex = 0; offsetIndex < dynamicOffsets.length; offsetIndex++) {
            previous.dynamicOffsets[offsetIndex] = dynamicOffsets[offsetIndex] ?? 0;
        }
        this.bindingsDirty = true;
    }

    setVertexBuffer(slot: number, buffer: RHIBuffer, offset = 0, size?: number): void {
        this.assertActive();
        requireInteger(slot, 'Vertex buffer slot');
        if (slot >= this.encoder.device.limits.maxVertexBuffers)
            throw new RangeError('Vertex buffer slot exceeds the device limit');
        const concrete = this.encoder.device.requireBuffer(buffer);
        concrete.assertUsable();
        if (!hasUsage(concrete.usage, RHIBufferUsage.VERTEX)) {
            throw new Error('Buffer was not created with VERTEX usage');
        }
        const byteLength = size ?? concrete.size - offset;
        requireRange(offset, byteLength, concrete.size, 'Vertex buffer');
        const previous = this.vertexBuffers[slot];
        if (
            previous?.buffer === concrete &&
            previous.offset === offset &&
            previous.size === byteLength
        )
            return;
        if (previous) {
            previous.buffer = concrete;
            previous.offset = offset;
            previous.size = byteLength;
        } else {
            this.vertexBuffers[slot] = { buffer: concrete, offset, size: byteLength };
        }
        this.vertexArrayDirty = true;
    }

    setIndexBuffer(
        buffer: RHIBuffer,
        indexFormat: RHIIndexFormat,
        offset = 0,
        size?: number
    ): void {
        this.assertActive();
        const concrete = this.encoder.device.requireBuffer(buffer);
        concrete.assertUsable();
        if (!hasUsage(concrete.usage, RHIBufferUsage.INDEX)) {
            throw new Error('Buffer was not created with INDEX usage');
        }
        const byteLength = size ?? concrete.size - offset;
        requireRange(offset, byteLength, concrete.size, 'Index buffer');
        const alignment = indexFormat === 'uint16' ? 2 : 4;
        if (offset % alignment !== 0 || byteLength % alignment !== 0) {
            throw new RangeError('Index buffer range is not aligned to its index format');
        }
        const previous = this.indexBuffer;
        if (
            previous?.buffer === concrete &&
            previous.format === indexFormat &&
            previous.offset === offset &&
            previous.size === byteLength
        )
            return;
        if (previous) {
            previous.buffer = concrete;
            previous.format = indexFormat;
            previous.offset = offset;
            previous.size = byteLength;
        } else {
            this.indexBuffer = {
                buffer: concrete,
                format: indexFormat,
                offset,
                size: byteLength
            };
        }
        this.vertexArrayDirty = true;
    }

    setViewport(
        x: number,
        y: number,
        width: number,
        height: number,
        minDepth: number,
        maxDepth: number
    ): void {
        this.assertActive();
        requireFinite(x, 'Viewport x');
        requireFinite(y, 'Viewport y');
        requireFinite(width, 'Viewport width');
        requireFinite(height, 'Viewport height');
        if (width < 0 || height < 0) throw new RangeError('Viewport dimensions cannot be negative');
        if (minDepth < 0 || maxDepth > 1 || minDepth > maxDepth) {
            throw new RangeError('Viewport depth range must be ordered within [0, 1]');
        }
        // RHI framebuffer coordinates follow WebGPU's top-left origin.
        this.encoder.device.state.viewport(x, this.target.height - y - height, width, height);
        this.encoder.device.state.depthRange(minDepth, maxDepth);
    }

    setScissorRect(x: number, y: number, width: number, height: number): void {
        this.assertActive();
        requireInteger(x, 'Scissor x');
        requireInteger(y, 'Scissor y');
        requireInteger(width, 'Scissor width');
        requireInteger(height, 'Scissor height');
        if (x + width > this.target.width || y + height > this.target.height) {
            throw new RangeError('Scissor rectangle exceeds the render target');
        }
        const { gl, state } = this.encoder.device;
        state.enable(gl.SCISSOR_TEST, true);
        state.scissor(x, this.target.height - y - height, width, height);
    }

    setBlendConstant(color: RHIColor): void {
        this.assertActive();
        requireFinite(color.r, 'Blend constant red');
        requireFinite(color.g, 'Blend constant green');
        requireFinite(color.b, 'Blend constant blue');
        requireFinite(color.a, 'Blend constant alpha');
        this.encoder.device.state.blendColor(color.r, color.g, color.b, color.a);
    }

    setStencilReference(reference: number): void {
        this.assertActive();
        requireInteger(reference, 'Stencil reference');
        this.stencilReference = reference;
        if (this.pipeline) this.pipeline.applyPipelineState(reference);
    }

    draw(vertexCount: number, instanceCount = 1, firstVertex = 0, firstInstance = 0): void {
        this.assertActive();
        requireInteger(vertexCount, 'Vertex count');
        requireInteger(instanceCount, 'Instance count');
        requireInteger(firstVertex, 'First vertex');
        requireInteger(firstInstance, 'First instance');
        if (firstInstance !== 0)
            throw new Error('WebGL 2 RHI does not support non-zero firstInstance');
        const pipeline = this.prepareDraw();
        if (vertexCount === 0 || instanceCount === 0) return;
        const gl = this.encoder.device.gl;
        if (instanceCount === 1) gl.drawArrays(pipeline.topology, firstVertex, vertexCount);
        else gl.drawArraysInstanced(pipeline.topology, firstVertex, vertexCount, instanceCount);
        this.encoder.device.diagnostics?.recordDraw();
    }

    drawIndexed(
        indexCount: number,
        instanceCount = 1,
        firstIndex = 0,
        baseVertex = 0,
        firstInstance = 0
    ): void {
        this.assertActive();
        requireInteger(indexCount, 'Index count');
        requireInteger(instanceCount, 'Instance count');
        requireInteger(firstIndex, 'First index');
        if (!Number.isSafeInteger(baseVertex))
            throw new RangeError('Base vertex must be a safe integer');
        requireInteger(firstInstance, 'First instance');
        if (baseVertex !== 0) throw new Error('WebGL 2 RHI does not support non-zero baseVertex');
        if (firstInstance !== 0)
            throw new Error('WebGL 2 RHI does not support non-zero firstInstance');
        const indexBuffer = this.indexBuffer;
        if (!indexBuffer) throw new Error('drawIndexed requires an index buffer');
        const indexByteSize = indexBuffer.format === 'uint16' ? 2 : 4;
        if ((firstIndex + indexCount) * indexByteSize > indexBuffer.size) {
            throw new RangeError('Indexed draw exceeds the bound index buffer range');
        }
        const pipeline = this.prepareDraw();
        if (indexCount === 0 || instanceCount === 0) return;
        const gl = this.encoder.device.gl;
        const type = indexBuffer.format === 'uint16' ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT;
        const byteOffset = indexBuffer.offset + firstIndex * indexByteSize;
        if (instanceCount === 1) gl.drawElements(pipeline.topology, indexCount, type, byteOffset);
        else
            gl.drawElementsInstanced(
                pipeline.topology,
                indexCount,
                type,
                byteOffset,
                instanceCount
            );
        this.encoder.device.diagnostics?.recordDraw();
    }

    end(): void {
        this.assertActive();
        this.encoder.device.endRenderPass(this.target, this.descriptor);
        this.ended = true;
        this.encoder.endPass(this);
    }

    private assertActive(): void {
        if (this.ended) throw new Error('Render pass has already ended');
        this.encoder.assertEncoding();
        if (this.encoder.activePass !== this) throw new Error('Render pass is not active');
    }

    private prepareDraw(): WebGLRHIRenderPipeline {
        const pipeline = this.pipeline;
        if (!pipeline) throw new Error('A render pipeline must be set before drawing');
        if (this.bindingsDirty) {
            pipeline.applyBindings(this.groups);
            this.bindingsDirty = false;
        }
        if (this.vertexArrayDirty) {
            const vertexArray = pipeline.vertexArrayFor(this.vertexBuffers, this.indexBuffer);
            this.encoder.device.state.bindVertexArray(vertexArray);
            this.vertexArrayDirty = false;
        }
        return pipeline;
    }

    private clearAttachments(): void {
        const { gl, state } = this.encoder.device;
        state.enable(gl.SCISSOR_TEST, false);
        for (let index = 0; index < this.descriptor.colorAttachments.length; index++) {
            const attachment = this.descriptor.colorAttachments[index];
            if (attachment?.loadOp !== 'clear') continue;
            const view = this.encoder.device.requireTextureView(attachment.view);
            const color = attachment.clearValue;
            state.colorMask(true, true, true, true);
            state.scratchF32[0] = color?.r ?? 0;
            state.scratchF32[1] = color?.g ?? 0;
            state.scratchF32[2] = color?.b ?? 0;
            state.scratchF32[3] = color?.a ?? 0;
            if (view.texture.formatInfo.kind === 'sint') {
                state.scratchI32[0] = color?.r ?? 0;
                state.scratchI32[1] = color?.g ?? 0;
                state.scratchI32[2] = color?.b ?? 0;
                state.scratchI32[3] = color?.a ?? 0;
                gl.clearBufferiv(gl.COLOR, index, state.scratchI32);
            } else if (view.texture.formatInfo.kind === 'uint') {
                state.scratchU32[0] = color?.r ?? 0;
                state.scratchU32[1] = color?.g ?? 0;
                state.scratchU32[2] = color?.b ?? 0;
                state.scratchU32[3] = color?.a ?? 0;
                gl.clearBufferuiv(gl.COLOR, index, state.scratchU32);
            } else {
                gl.clearBufferfv(gl.COLOR, index, state.scratchF32);
            }
        }
        const depthStencil = this.descriptor.depthStencilAttachment;
        if (!depthStencil) return;
        const view = this.encoder.device.requireTextureView(depthStencil.view);
        const hasDepth =
            view.texture.formatInfo.kind === 'depth' ||
            view.texture.formatInfo.kind === 'depth-stencil';
        const hasStencil =
            view.texture.formatInfo.kind === 'stencil' ||
            view.texture.formatInfo.kind === 'depth-stencil';
        const clearDepth = hasDepth && depthStencil.depthLoadOp === 'clear';
        const clearStencil = hasStencil && depthStencil.stencilLoadOp === 'clear';
        if (clearDepth) state.depthMask(true);
        if (clearStencil) {
            state.stencilMaskSeparate(gl.FRONT, 0xffffffff);
            state.stencilMaskSeparate(gl.BACK, 0xffffffff);
        }
        if (clearDepth && clearStencil) {
            gl.clearBufferfi(
                gl.DEPTH_STENCIL,
                0,
                depthStencil.depthClearValue ?? 1,
                depthStencil.stencilClearValue ?? 0
            );
        } else if (clearDepth) {
            state.scratchF32[0] = depthStencil.depthClearValue ?? 1;
            gl.clearBufferfv(gl.DEPTH, 0, state.scratchF32);
        } else if (clearStencil) {
            state.scratchI32[0] = depthStencil.stencilClearValue ?? 0;
            gl.clearBufferiv(gl.STENCIL, 0, state.scratchI32);
        }
    }

    private validatePipelineAttachments(pipeline: WebGLRHIRenderPipeline): void {
        const targets = pipeline.descriptor.fragment?.targets ?? [];
        for (let index = 0; index < targets.length; index++) {
            const target = targets[index];
            const attachment = this.descriptor.colorAttachments[index];
            if (
                target &&
                (!attachment ||
                    this.encoder.device.requireTextureView(attachment.view).format !==
                        target.format)
            ) {
                throw new Error(
                    `Pipeline color target ${String(index)} does not match the render pass`
                );
            }
        }
        const expectedDepth = pipeline.descriptor.depthStencil?.format;
        const actualDepth = this.descriptor.depthStencilAttachment
            ? this.encoder.device.requireTextureView(this.descriptor.depthStencilAttachment.view)
                  .format
            : undefined;
        if (expectedDepth !== actualDepth)
            throw new Error('Pipeline depth-stencil format does not match the render pass');
        const depthStencilAttachment = this.descriptor.depthStencilAttachment;
        if (
            depthStencilAttachment?.depthReadOnly === true &&
            pipeline.descriptor.depthStencil?.depthWriteEnabled === true
        ) {
            throw new Error('A depth-read-only render pass cannot use a depth-writing pipeline');
        }
        if (
            depthStencilAttachment?.stencilReadOnly === true &&
            (pipeline.descriptor.depthStencil?.stencilWriteMask ?? 0xffffffff) !== 0
        ) {
            throw new Error(
                'A stencil-read-only render pass requires a pipeline stencilWriteMask of zero'
            );
        }
        if ((pipeline.descriptor.multisample?.count ?? 1) !== this.target.sampleCount) {
            throw new Error('Pipeline sample count does not match the render pass');
        }
    }
}

export class WebGLRHICommandBuffer extends WebGLObjectBase implements RHICommandBuffer {
    readonly device: WebGLRHIDevice;
    submitted = false;

    constructor(device: WebGLRHIDevice, label?: string) {
        super(label);
        this.device = device;
        device.diagnostics?.recordCommandBuffer();
    }
}

export class WebGLRHICommandEncoder implements RHICommandEncoder {
    readonly label: string;
    readonly device: WebGLRHIDevice;
    activePass: WebGLRHIRenderPassEncoder | null = null;
    private finished = false;

    constructor(device: WebGLRHIDevice, label?: string) {
        this.device = device;
        this.label = labelOf(label);
        device.diagnostics?.recordCommandEncoder();
    }

    beginRenderPass(descriptor: RHIRenderPassDescriptor): WebGLRHIRenderPassEncoder {
        this.assertEncoding();
        if (this.activePass) throw new Error('A command encoder cannot have nested render passes');
        const pass = new WebGLRHIRenderPassEncoder(this, descriptor);
        this.activePass = pass;
        return pass;
    }

    copyBufferToBuffer(
        source: RHIBuffer,
        sourceOffset: number,
        destination: RHIBuffer,
        destinationOffset: number,
        size: number
    ): void {
        this.assertOutsidePass();
        this.device.copyBufferToBuffer(source, sourceOffset, destination, destinationOffset, size);
    }

    copyTextureToBuffer(
        source: RHIImageCopyTexture,
        destination: RHIImageCopyBuffer,
        copySize: RHIExtent3D
    ): void {
        this.assertOutsidePass();
        this.device.copyTextureToBuffer(source, destination, copySize);
    }

    copyBufferToTexture(
        source: RHIImageCopyBuffer,
        destination: RHIImageCopyTexture,
        copySize: RHIExtent3D
    ): void {
        this.assertOutsidePass();
        this.device.copyBufferToTexture(source, destination, copySize);
    }

    copyTextureToTexture(
        source: RHIImageCopyTexture,
        destination: RHIImageCopyTexture,
        copySize: RHIExtent3D
    ): void {
        this.assertOutsidePass();
        this.device.copyTextureToTexture(source, destination, copySize);
    }

    finish(): WebGLRHICommandBuffer {
        this.assertEncoding();
        if (this.activePass)
            throw new Error('Cannot finish a command encoder with an active render pass');
        this.finished = true;
        // GL commands have already executed. The command buffer is a single-use logical submit token.
        return new WebGLRHICommandBuffer(this.device, this.label);
    }

    endPass(pass: WebGLRHIRenderPassEncoder): void {
        if (this.activePass !== pass)
            throw new Error('Cannot end a render pass that is not active');
        this.activePass = null;
    }

    assertEncoding(): void {
        this.device.assertAlive();
        if (this.finished) throw new Error('Command encoder has already been finished');
    }

    private assertOutsidePass(): void {
        this.assertEncoding();
        if (this.activePass)
            throw new Error('Copy commands cannot be encoded inside a render pass');
    }
}
