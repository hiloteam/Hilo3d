import type {
    RHIBindGroup,
    RHIBuffer,
    RHIBufferSource,
    RHICommandBuffer,
    RHICommandEncoder,
    RHIColor,
    RHIExtent3D,
    RHIImageCopyBuffer,
    RHIImageCopyExternalImage,
    RHIImageCopyTexture,
    RHIImageDataLayout,
    RHIIndexFormat,
    RHIQueue,
    RHIRenderPassDescriptor,
    RHIRenderPassEncoder,
    RHIRenderPipeline
} from '../RHI';
import type { WebGPUDevice } from './WebGPUDevice';
import {
    WebGPUObject,
    assertOwner,
    labelOf,
    owners,
    type WebGPURHIDiagnostics
} from './WebGPUBase';
import { extent3D, origin3D } from './WebGPUDescriptors';
import { WebGPUBuffer, WebGPUTexture, WebGPUTextureView } from './WebGPUResources';
import { WebGPUBindGroup, WebGPURenderPipeline } from './WebGPUBindings';

function imageCopyTexture(
    value: RHIImageCopyTexture,
    device: WebGPUDevice
): GPUTexelCopyTextureInfo {
    if (!(value.texture instanceof WebGPUTexture)) {
        throw new TypeError('Expected a WebGPU texture');
    }
    assertOwner(value.texture, device, 'Texture');
    if (value.texture.destroyed) throw new Error('WebGPU texture is destroyed');
    return {
        texture: value.texture.nativeHandle,
        ...(value.mipLevel === undefined ? {} : { mipLevel: value.mipLevel }),
        ...(value.origin === undefined ? {} : { origin: origin3D(value.origin) }),
        ...(value.aspect === undefined ? {} : { aspect: value.aspect })
    };
}

function imageCopyBuffer(value: RHIImageCopyBuffer, device: WebGPUDevice): GPUTexelCopyBufferInfo {
    if (!(value.buffer instanceof WebGPUBuffer)) {
        throw new TypeError('Expected a WebGPU buffer');
    }
    assertOwner(value.buffer, device, 'Buffer');
    if (value.buffer.destroyed) throw new Error('WebGPU buffer is destroyed');
    return {
        buffer: value.buffer.nativeHandle,
        ...(value.offset === undefined ? {} : { offset: value.offset }),
        ...(value.bytesPerRow === undefined ? {} : { bytesPerRow: value.bytesPerRow }),
        ...(value.rowsPerImage === undefined ? {} : { rowsPerImage: value.rowsPerImage })
    };
}

function imageDataLayout(value: RHIImageDataLayout): GPUTexelCopyBufferLayout {
    return {
        ...(value.offset === undefined ? {} : { offset: value.offset }),
        ...(value.bytesPerRow === undefined ? {} : { bytesPerRow: value.bytesPerRow }),
        ...(value.rowsPerImage === undefined ? {} : { rowsPerImage: value.rowsPerImage })
    };
}

function renderPassDescriptor(
    descriptor: RHIRenderPassDescriptor,
    device: WebGPUDevice
): GPURenderPassDescriptor {
    return {
        ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
        colorAttachments: descriptor.colorAttachments.map(attachment => {
            if (attachment === null) return null;
            if (!(attachment.view instanceof WebGPUTextureView)) {
                throw new TypeError('Expected a WebGPU color attachment view');
            }
            assertOwner(attachment.view, device, 'Texture view');
            let resolveTarget: GPUTextureView | undefined;
            if (attachment.resolveTarget !== undefined) {
                if (!(attachment.resolveTarget instanceof WebGPUTextureView)) {
                    throw new TypeError('Expected a WebGPU resolve attachment view');
                }
                assertOwner(attachment.resolveTarget, device, 'Texture view');
                resolveTarget = attachment.resolveTarget.nativeHandle;
            }
            return {
                view: attachment.view.nativeHandle,
                ...(resolveTarget === undefined ? {} : { resolveTarget }),
                ...(attachment.clearValue === undefined
                    ? {}
                    : { clearValue: { ...attachment.clearValue } }),
                loadOp: attachment.loadOp,
                storeOp: attachment.storeOp
            };
        }),
        ...(descriptor.depthStencilAttachment === undefined
            ? {}
            : (() => {
                  const attachment = descriptor.depthStencilAttachment;
                  if (!(attachment.view instanceof WebGPUTextureView)) {
                      throw new TypeError('Expected a WebGPU depth/stencil attachment view');
                  }
                  assertOwner(attachment.view, device, 'Texture view');
                  return {
                      depthStencilAttachment: {
                          view: attachment.view.nativeHandle,
                          ...(attachment.depthClearValue === undefined
                              ? {}
                              : { depthClearValue: attachment.depthClearValue }),
                          ...(attachment.depthLoadOp === undefined
                              ? {}
                              : { depthLoadOp: attachment.depthLoadOp }),
                          ...(attachment.depthStoreOp === undefined
                              ? {}
                              : { depthStoreOp: attachment.depthStoreOp }),
                          ...(attachment.depthReadOnly === undefined
                              ? {}
                              : { depthReadOnly: attachment.depthReadOnly }),
                          ...(attachment.stencilClearValue === undefined
                              ? {}
                              : { stencilClearValue: attachment.stencilClearValue }),
                          ...(attachment.stencilLoadOp === undefined
                              ? {}
                              : { stencilLoadOp: attachment.stencilLoadOp }),
                          ...(attachment.stencilStoreOp === undefined
                              ? {}
                              : { stencilStoreOp: attachment.stencilStoreOp }),
                          ...(attachment.stencilReadOnly === undefined
                              ? {}
                              : { stencilReadOnly: attachment.stencilReadOnly })
                      }
                  };
              })())
    };
}

export class WebGPURenderPassEncoder implements RHIRenderPassEncoder {
    readonly label: string;
    readonly #device: WebGPUDevice;
    readonly #nativeHandle: GPURenderPassEncoder;
    readonly #onEnd: () => void;
    #ended = false;

    constructor(
        device: WebGPUDevice,
        nativeHandle: GPURenderPassEncoder,
        label: string,
        onEnd: () => void
    ) {
        this.#device = device;
        this.#nativeHandle = nativeHandle;
        this.label = label;
        this.#onEnd = onEnd;
    }

    /** @internal */
    get nativeHandle(): GPURenderPassEncoder {
        return this.#nativeHandle;
    }

    private assertOpen(): void {
        if (this.#ended) throw new Error('WebGPU render pass is ended');
    }

    setPipeline(pipeline: RHIRenderPipeline): void {
        this.assertOpen();
        if (!(pipeline instanceof WebGPURenderPipeline)) {
            throw new TypeError('Expected a WebGPU render pipeline');
        }
        assertOwner(pipeline, this.#device, 'Render pipeline');
        this.#nativeHandle.setPipeline(pipeline.nativeHandle);
    }

    setBindGroup(index: number, bindGroup: RHIBindGroup, dynamicOffsets?: readonly number[]): void {
        this.assertOpen();
        if (!(bindGroup instanceof WebGPUBindGroup)) {
            throw new TypeError('Expected a WebGPU bind group');
        }
        assertOwner(bindGroup, this.#device, 'Bind group');
        this.#nativeHandle.setBindGroup(index, bindGroup.nativeHandle, dynamicOffsets);
    }

    setVertexBuffer(slot: number, buffer: RHIBuffer, offset?: number, size?: number): void {
        this.assertOpen();
        if (!(buffer instanceof WebGPUBuffer)) throw new TypeError('Expected a WebGPU buffer');
        assertOwner(buffer, this.#device, 'Buffer');
        if (buffer.destroyed) throw new Error('WebGPU buffer is destroyed');
        this.#nativeHandle.setVertexBuffer(slot, buffer.nativeHandle, offset, size);
    }

    setIndexBuffer(
        buffer: RHIBuffer,
        indexFormat: RHIIndexFormat,
        offset?: number,
        size?: number
    ): void {
        this.assertOpen();
        if (!(buffer instanceof WebGPUBuffer)) throw new TypeError('Expected a WebGPU buffer');
        assertOwner(buffer, this.#device, 'Buffer');
        if (buffer.destroyed) throw new Error('WebGPU buffer is destroyed');
        this.#nativeHandle.setIndexBuffer(buffer.nativeHandle, indexFormat, offset, size);
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
        this.#nativeHandle.setViewport(x, y, width, height, minDepth, maxDepth);
    }

    setScissorRect(x: number, y: number, width: number, height: number): void {
        this.assertOpen();
        this.#nativeHandle.setScissorRect(x, y, width, height);
    }

    setBlendConstant(color: RHIColor): void {
        this.assertOpen();
        this.#nativeHandle.setBlendConstant(color);
    }

    setStencilReference(reference: number): void {
        this.assertOpen();
        this.#nativeHandle.setStencilReference(reference);
    }

    draw(vertexCount: number, instanceCount = 1, firstVertex = 0, firstInstance = 0): void {
        this.assertOpen();
        this.#nativeHandle.draw(vertexCount, instanceCount, firstVertex, firstInstance);
    }

    drawIndexed(
        indexCount: number,
        instanceCount = 1,
        firstIndex = 0,
        baseVertex = 0,
        firstInstance = 0
    ): void {
        this.assertOpen();
        this.#nativeHandle.drawIndexed(
            indexCount,
            instanceCount,
            firstIndex,
            baseVertex,
            firstInstance
        );
    }

    end(): void {
        this.assertOpen();
        this.#nativeHandle.end();
        this.#ended = true;
        this.#onEnd();
    }
}

export class WebGPUCommandBuffer extends WebGPUObject implements RHICommandBuffer {
    readonly #nativeHandle: GPUCommandBuffer;

    constructor(device: WebGPUDevice, nativeHandle: GPUCommandBuffer) {
        super(labelOf(nativeHandle));
        this.#nativeHandle = nativeHandle;
        owners.set(this, device);
    }

    /** @internal */
    get nativeHandle(): GPUCommandBuffer {
        return this.#nativeHandle;
    }
}

export class WebGPUCommandEncoder implements RHICommandEncoder {
    readonly label: string;
    readonly #device: WebGPUDevice;
    readonly #nativeHandle: GPUCommandEncoder;
    #state: 'recording' | 'pass' | 'finished' = 'recording';

    constructor(device: WebGPUDevice, nativeHandle: GPUCommandEncoder, label = '') {
        this.#device = device;
        this.#nativeHandle = nativeHandle;
        this.label = label;
    }

    /** @internal */
    get nativeHandle(): GPUCommandEncoder {
        return this.#nativeHandle;
    }

    private assertRecording(): void {
        if (this.#state === 'pass') throw new Error('A WebGPU render pass is still active');
        if (this.#state === 'finished') throw new Error('WebGPU command encoder is finished');
    }

    beginRenderPass(descriptor: RHIRenderPassDescriptor): WebGPURenderPassEncoder {
        this.assertRecording();
        const nativePass = this.#nativeHandle.beginRenderPass(
            renderPassDescriptor(descriptor, this.#device)
        );
        this.#state = 'pass';
        return new WebGPURenderPassEncoder(this.#device, nativePass, descriptor.label ?? '', () => {
            this.#state = 'recording';
        });
    }

    copyBufferToBuffer(
        source: RHIBuffer,
        sourceOffset: number,
        destination: RHIBuffer,
        destinationOffset: number,
        size: number
    ): void {
        this.assertRecording();
        if (!(source instanceof WebGPUBuffer) || !(destination instanceof WebGPUBuffer)) {
            throw new TypeError('Expected WebGPU buffers');
        }
        assertOwner(source, this.#device, 'Source buffer');
        assertOwner(destination, this.#device, 'Destination buffer');
        if (source.destroyed || destination.destroyed)
            throw new Error('WebGPU buffer is destroyed');
        this.#nativeHandle.copyBufferToBuffer(
            source.nativeHandle,
            sourceOffset,
            destination.nativeHandle,
            destinationOffset,
            size
        );
    }

    copyTextureToBuffer(
        source: RHIImageCopyTexture,
        destination: RHIImageCopyBuffer,
        copySize: RHIExtent3D
    ): void {
        this.assertRecording();
        this.#nativeHandle.copyTextureToBuffer(
            imageCopyTexture(source, this.#device),
            imageCopyBuffer(destination, this.#device),
            extent3D(copySize)
        );
    }

    copyBufferToTexture(
        source: RHIImageCopyBuffer,
        destination: RHIImageCopyTexture,
        copySize: RHIExtent3D
    ): void {
        this.assertRecording();
        this.#nativeHandle.copyBufferToTexture(
            imageCopyBuffer(source, this.#device),
            imageCopyTexture(destination, this.#device),
            extent3D(copySize)
        );
    }

    copyTextureToTexture(
        source: RHIImageCopyTexture,
        destination: RHIImageCopyTexture,
        copySize: RHIExtent3D
    ): void {
        this.assertRecording();
        this.#nativeHandle.copyTextureToTexture(
            imageCopyTexture(source, this.#device),
            imageCopyTexture(destination, this.#device),
            extent3D(copySize)
        );
    }

    finish(): WebGPUCommandBuffer {
        this.assertRecording();
        const commandBuffer = new WebGPUCommandBuffer(this.#device, this.#nativeHandle.finish());
        this.#state = 'finished';
        return commandBuffer;
    }
}

export class WebGPUQueue extends WebGPUObject implements RHIQueue {
    readonly #device: WebGPUDevice;
    readonly #nativeHandle: GPUQueue;
    readonly #diagnostics: WebGPURHIDiagnostics | null;
    readonly #nativeSubmitScratch: GPUCommandBuffer[] = [];

    constructor(
        device: WebGPUDevice,
        nativeHandle: GPUQueue,
        diagnostics: WebGPURHIDiagnostics | null
    ) {
        super(labelOf(nativeHandle));
        this.#device = device;
        this.#nativeHandle = nativeHandle;
        this.#diagnostics = diagnostics;
        owners.set(this, device);
    }

    /** @internal */
    get nativeHandle(): GPUQueue {
        return this.#nativeHandle;
    }

    submit(commandBuffers: readonly RHICommandBuffer[]): void {
        const nativeBuffers = this.#nativeSubmitScratch;
        nativeBuffers.length = 0;
        try {
            for (const commandBuffer of commandBuffers) {
                if (!(commandBuffer instanceof WebGPUCommandBuffer)) {
                    throw new TypeError('Expected a WebGPU command buffer');
                }
                assertOwner(commandBuffer, this.#device, 'Command buffer');
            }
            for (const commandBuffer of commandBuffers) {
                nativeBuffers.push((commandBuffer as WebGPUCommandBuffer).nativeHandle);
            }
            this.#nativeHandle.submit(nativeBuffers);
            this.#diagnostics?.record('submissions');
        } finally {
            nativeBuffers.length = 0;
        }
    }

    writeBuffer(
        buffer: RHIBuffer,
        bufferOffset: number,
        data: RHIBufferSource,
        dataOffset?: number,
        size?: number
    ): void {
        if (!(buffer instanceof WebGPUBuffer)) throw new TypeError('Expected a WebGPU buffer');
        assertOwner(buffer, this.#device, 'Buffer');
        if (buffer.destroyed) throw new Error('WebGPU buffer is destroyed');
        this.#nativeHandle.writeBuffer(buffer.nativeHandle, bufferOffset, data, dataOffset, size);
    }

    writeTexture(
        destination: RHIImageCopyTexture,
        data: RHIBufferSource,
        dataLayout: RHIImageDataLayout,
        size: RHIExtent3D
    ): void {
        this.#nativeHandle.writeTexture(
            imageCopyTexture(destination, this.#device),
            data,
            imageDataLayout(dataLayout),
            extent3D(size)
        );
    }

    copyExternalImageToTexture(
        source: RHIImageCopyExternalImage,
        destination: RHIImageCopyTexture,
        copySize: RHIExtent3D
    ): void {
        this.#nativeHandle.copyExternalImageToTexture(
            {
                source: source.source,
                ...(source.origin === undefined
                    ? {}
                    : {
                          origin: {
                              ...(source.origin.x === undefined ? {} : { x: source.origin.x }),
                              ...(source.origin.y === undefined ? {} : { y: source.origin.y })
                          }
                      }),
                ...(source.flipY === undefined ? {} : { flipY: source.flipY })
            },
            imageCopyTexture(destination, this.#device),
            extent3D(copySize)
        );
    }

    onSubmittedWorkDone(): Promise<void> {
        return this.#nativeHandle.onSubmittedWorkDone();
    }
}
