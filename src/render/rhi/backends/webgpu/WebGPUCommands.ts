import type {
    RHICommandContext,
    RHICommandContextState,
    RHIComputePassDescriptor,
    RHIFrameDiagnostics,
    RHIImageCopyBuffer,
    RHIImageCopyExternalImage,
    RHIImageCopyExternalImageToTexture,
    RHIImageDataLayout,
    RHIImageCopyTexture,
    RHIRenderPassDescriptor
} from '../../core/RHICommands';
import { validateRHIClearBuffer } from '../../core/RHICommandValidation';
import {
    validateRHICopyBufferToBuffer,
    validateRHICopyBufferToTexture,
    validateRHICopyTextureToBuffer,
    validateRHICopyTextureToTexture,
    validateRHICommandCopyExternalImageToTexture,
    validateRHICommandGenerateMipmaps,
    validateRHIWriteBuffer,
    validateRHIWriteTexture,
    getRHITextureFormatBlockInfo
} from '../../core/RHICopyValidation';
import type { RHIBuffer, RHIDeviceOwnedObject, RHITexture } from '../../core/RHIResources';
import type { RHIFrameDescriptor } from '../../core/RHIQueue';
import type { RHIDataSource, RHIExtent3D } from '../../core/RHITypes';
import { RHIValidationError } from '../../core/RHIValidation';
import { WebGPUDestroyableObject, WebGPUObject } from './WebGPUBase';
import { nativeWebGPUOrigin } from './WebGPUDescriptors';
import type { WebGPUDevice } from './WebGPUDevice';
import { WebGPUBuffer, WebGPUTexture } from './WebGPUResources';
import type { WebGPUQueue, WebGPUUploadAllocation } from './WebGPUQueue';
import { WebGPURenderPass, type WebGPURenderPassStorage } from './WebGPURenderPass';
import { WebGPUComputePass, type WebGPUComputePassStorage } from './WebGPUComputePass';

export function resetWebGPUFrameDiagnostics(target?: RHIFrameDiagnostics): RHIFrameDiagnostics {
    const diagnostics =
        target ??
        ({
            commandCount: 0,
            drawCount: 0,
            indirectDrawCount: 0,
            dispatchCount: 0,
            dispatchedWorkgroupCount: 0,
            bufferClearCount: 0,
            pipelineSwitches: 0,
            bindGroupSwitches: 0,
            computePipelineSwitches: 0,
            computeBindGroupSwitches: 0,
            vertexBufferSwitches: 0,
            nativeStateCalls: 0,
            frameArenaGrowths: 0,
            transientAllocations: 0,
            cacheHits: 0,
            cacheMisses: 0
        } satisfies RHIFrameDiagnostics);
    diagnostics.commandCount = 0;
    diagnostics.drawCount = 0;
    diagnostics.indirectDrawCount = 0;
    diagnostics.dispatchCount = 0;
    diagnostics.dispatchedWorkgroupCount = 0;
    diagnostics.bufferClearCount = 0;
    diagnostics.pipelineSwitches = 0;
    diagnostics.bindGroupSwitches = 0;
    diagnostics.computePipelineSwitches = 0;
    diagnostics.computeBindGroupSwitches = 0;
    diagnostics.vertexBufferSwitches = 0;
    diagnostics.nativeStateCalls = 0;
    diagnostics.frameArenaGrowths = 0;
    diagnostics.transientAllocations = 0;
    diagnostics.cacheHits = 0;
    diagnostics.cacheMisses = 0;
    return diagnostics;
}

/** Queue-pooled strong references retained until one frame completes or aborts. */
export interface WebGPUFrameReferences {
    readonly objects: (WebGPUDestroyableObject | null)[];
    count: number;
    readonly directUploadSources: Uint8Array[];
    directUploadSourceCount: number;
}

function validationFailure(
    code: ConstructorParameters<typeof RHIValidationError>[0],
    message: string,
    path: string
): never {
    throw new RHIValidationError(code, message, path);
}

/** WebGPU buffer-texture copies address the physical texel-block extent at compressed mip edges. */
function nativeTextureCopyExtent(value: RHIExtent3D, copy: RHIImageCopyTexture): GPUExtent3DDict {
    const block = getRHITextureFormatBlockInfo(copy.texture.format, copy.aspect ?? 'all');
    const width = Math.ceil(value.width / block.blockWidth) * block.blockWidth;
    const height = Math.ceil((value.height ?? 1) / block.blockHeight) * block.blockHeight;
    return {
        width,
        height,
        depthOrArrayLayers: value.depthOrArrayLayers ?? 1
    };
}

function webGPUBuffer(device: WebGPUDevice, buffer: RHIBuffer, path: string): WebGPUBuffer {
    device.assertUsable(buffer, path);
    if (!(buffer instanceof WebGPUBuffer) || buffer.owner !== device) {
        return validationFailure('wrong-device', 'expected a WebGPU RHI buffer', path);
    }
    return buffer;
}

function webGPUTexture(
    device: WebGPUDevice,
    texture: RHIImageCopyTexture['texture'],
    path: string
): WebGPUTexture {
    device.assertUsable(texture, path);
    if (!(texture instanceof WebGPUTexture) || texture.owner !== device) {
        return validationFailure('wrong-device', 'expected a WebGPU RHI texture', path);
    }
    return texture;
}

function nativeImageCopyTexture(
    device: WebGPUDevice,
    copy: RHIImageCopyTexture,
    path: string
): GPUTexelCopyTextureInfo {
    const texture = webGPUTexture(device, copy.texture, `${path}.texture`);
    return {
        texture: texture.nativeHandle,
        mipLevel: copy.mipLevel ?? 0,
        origin: nativeWebGPUOrigin(copy.origin),
        aspect: copy.aspect ?? 'all'
    };
}

function nativeImageCopyBuffer(
    device: WebGPUDevice,
    copy: RHIImageCopyBuffer,
    path: string
): GPUTexelCopyBufferInfo {
    const buffer = webGPUBuffer(device, copy.buffer, `${path}.buffer`);
    return {
        buffer: buffer.nativeHandle,
        offset: copy.offset ?? 0,
        ...(copy.bytesPerRow === undefined ? {} : { bytesPerRow: copy.bytesPerRow }),
        ...(copy.rowsPerImage === undefined ? {} : { rowsPerImage: copy.rowsPerImage })
    };
}

export class WebGPUCommandContext extends WebGPUObject implements RHICommandContext {
    readonly frameId: number;
    readonly diagnostics: RHIFrameDiagnostics;
    readonly #nativeEncoder: GPUCommandEncoder;
    #contextState: RHICommandContextState = 'open';
    #activePass: WebGPURenderPass | WebGPUComputePass | null = null;
    #externalImageUploadPhase = true;
    #directUploadPhase: boolean;
    readonly #retainedReferences: WebGPUFrameReferences;
    readonly #uploadAllocation: WebGPUUploadAllocation = { buffer: null, offset: 0 };

    constructor(
        readonly queue: WebGPUQueue,
        nativeEncoder: GPUCommandEncoder,
        descriptor: RHIFrameDescriptor,
        retainedReferences: WebGPUFrameReferences
    ) {
        super(queue.owner, descriptor.label ?? 'WebGPU frame context');
        this.#nativeEncoder = nativeEncoder;
        this.#retainedReferences = retainedReferences;
        this.#directUploadPhase = queue.owner.directUploadWorkaround;
        this.frameId = this.id;
        this.diagnostics = resetWebGPUFrameDiagnostics(descriptor.diagnostics);
    }

    get state(): RHICommandContextState {
        return this.#contextState;
    }

    /** @internal */
    get nativeHandle(): GPUCommandEncoder {
        return this.#nativeEncoder;
    }

    writeBuffer(
        destination: RHIBuffer,
        destinationOffset: number,
        data: RHIDataSource,
        dataOffset = 0,
        size?: number
    ): void {
        this.assertOpen();
        validateRHIWriteBuffer(this.owner, destination, destinationOffset, data, dataOffset, size);
        const writeSize = size ?? data.byteLength - dataOffset;
        const nativeDestination = webGPUBuffer(this.owner, destination, 'destination');
        if (this.#directUploadPhase) {
            const source = this.queue.sourceBytes(data);
            const snapshot = this.directUploadSnapshot(source, dataOffset, writeSize);
            this.queue.nativeHandle.writeBuffer(
                nativeDestination.nativeHandle,
                destinationOffset,
                snapshot.buffer,
                0,
                writeSize
            );
            this.retain(nativeDestination);
            this.#externalImageUploadPhase = false;
            this.recordNativeCommand();
            return;
        }
        this.queue.stageUpload(
            data,
            dataOffset,
            writeSize,
            this.diagnostics,
            this.#uploadAllocation
        );
        const staging = this.#uploadAllocation.buffer;
        if (staging === null) throw new Error('WebGPU upload arena did not return a buffer');
        this.retain(nativeDestination);
        this.closeExternalImageUploadPhase();
        this.#nativeEncoder.copyBufferToBuffer(
            staging,
            this.#uploadAllocation.offset,
            nativeDestination.nativeHandle,
            destinationOffset,
            writeSize
        );
        this.recordNativeCommand();
    }

    private directUploadSnapshot(
        source: Uint8Array,
        sourceOffset: number,
        byteLength: number
    ): Uint8Array {
        const index = this.#retainedReferences.directUploadSourceCount++;
        let snapshot = this.#retainedReferences.directUploadSources[index];
        if (snapshot === undefined || snapshot.byteLength < byteLength) {
            snapshot = new Uint8Array(byteLength);
            this.#retainedReferences.directUploadSources[index] = snapshot;
            this.diagnostics.frameArenaGrowths++;
            this.diagnostics.transientAllocations++;
        }
        snapshot.set(source.subarray(sourceOffset, sourceOffset + byteLength), 0);
        return snapshot;
    }

    writeTexture(
        destination: RHIImageCopyTexture,
        data: RHIDataSource,
        dataLayout: RHIImageDataLayout,
        writeSize: RHIExtent3D
    ): void {
        this.assertOpen();
        validateRHIWriteTexture(this.owner, destination, data, dataLayout, writeSize);
        const aspect = destination.aspect ?? 'all';
        const block = getRHITextureFormatBlockInfo(destination.texture.format, aspect);
        const bytesPerBlock = block.bytesPerBlock;
        if (bytesPerBlock === undefined) {
            validationFailure(
                'unsupported-format',
                'texture aspect has no portable upload footprint',
                'destination.aspect'
            );
        }
        const width = writeSize.width;
        const height = writeSize.height ?? 1;
        const depth = writeSize.depthOrArrayLayers ?? 1;
        const blockRows = Math.ceil(height / block.blockHeight);
        const tightRowBytes = Math.ceil(width / block.blockWidth) * bytesPerBlock;
        const sourceBytesPerRow = dataLayout.bytesPerRow ?? tightRowBytes;
        const sourceRowsPerImage = dataLayout.rowsPerImage ?? blockRows;
        const sourceOffset = dataLayout.offset ?? 0;
        const stagingBytesPerRow = Math.ceil(tightRowBytes / 256) * 256;
        const requiredBytes =
            (depth - 1) * blockRows * stagingBytesPerRow +
            (blockRows - 1) * stagingBytesPerRow +
            tightRowBytes;
        const stagingSize = Math.ceil(requiredBytes / 4) * 4;
        const sourceBytes = this.queue.sourceBytes(data);
        const repacked = this.queue.textureUploadScratch(stagingSize, this.diagnostics);
        repacked.fill(0, 0, stagingSize);
        for (let image = 0; image < depth; image += 1) {
            for (let row = 0; row < blockRows; row += 1) {
                const sourceStart =
                    sourceOffset +
                    image * sourceRowsPerImage * sourceBytesPerRow +
                    row * sourceBytesPerRow;
                const destinationStart =
                    image * blockRows * stagingBytesPerRow + row * stagingBytesPerRow;
                for (let byte = 0; byte < tightRowBytes; byte += 1) {
                    repacked[destinationStart + byte] = sourceBytes[sourceStart + byte] ?? 0;
                }
            }
        }
        const concreteDestination = webGPUTexture(
            this.owner,
            destination.texture,
            'destination.texture'
        );
        this.retain(concreteDestination);
        const nativeOrigin = this.queue.textureUploadOrigin;
        nativeOrigin.x = destination.origin?.x ?? 0;
        nativeOrigin.y = destination.origin?.y ?? 0;
        nativeOrigin.z = destination.origin?.z ?? 0;
        const nativeDestination = this.queue.textureUploadDestination;
        nativeDestination.texture = concreteDestination.nativeHandle;
        nativeDestination.mipLevel = destination.mipLevel ?? 0;
        nativeDestination.aspect = aspect;
        const nativeExtent = this.queue.textureUploadExtent;
        nativeExtent.width = Math.ceil(width / block.blockWidth) * block.blockWidth;
        nativeExtent.height = Math.ceil(height / block.blockHeight) * block.blockHeight;
        nativeExtent.depthOrArrayLayers = depth;
        if (this.#directUploadPhase) {
            const snapshot = this.directUploadSnapshot(repacked, 0, stagingSize);
            this.queue.nativeHandle.writeTexture(
                nativeDestination,
                snapshot.buffer,
                {
                    offset: 0,
                    bytesPerRow: stagingBytesPerRow,
                    rowsPerImage: blockRows
                },
                nativeExtent
            );
            this.#externalImageUploadPhase = false;
            this.recordNativeCommand();
            return;
        }
        this.queue.stageUpload(
            repacked,
            0,
            stagingSize,
            this.diagnostics,
            this.#uploadAllocation,
            Math.max(4, bytesPerBlock)
        );
        const staging = this.#uploadAllocation.buffer;
        if (staging === null) throw new Error('WebGPU upload arena did not return a buffer');
        this.closeExternalImageUploadPhase();
        const nativeSource = this.queue.textureUploadSource;
        nativeSource.buffer = staging;
        nativeSource.offset = this.#uploadAllocation.offset;
        nativeSource.bytesPerRow = stagingBytesPerRow;
        nativeSource.rowsPerImage = blockRows;
        this.#nativeEncoder.copyBufferToTexture(nativeSource, nativeDestination, nativeExtent);
        this.recordNativeCommand();
    }

    copyExternalImageToTexture(
        source: RHIImageCopyExternalImage,
        destination: RHIImageCopyExternalImageToTexture,
        copySize: RHIExtent3D
    ): void {
        this.assertOpen();
        validateRHICommandCopyExternalImageToTexture(
            this,
            source,
            destination,
            copySize,
            this.queue.externalImageDimensions
        );
        if (!this.#externalImageUploadPhase) {
            validationFailure(
                'invalid-state',
                'external-image copies must precede every other frame command',
                'context'
            );
        }
        const texture = webGPUTexture(this.owner, destination.texture, 'destination.texture');
        const stagedSource = this.queue.externalImages.prepare(
            source.source,
            this.queue.externalImageDimensions
        );
        if (stagedSource === null) return;
        this.retain(texture);
        const nativeSourceOrigin = this.queue.externalImageSourceOrigin;
        nativeSourceOrigin.x = source.origin?.x ?? 0;
        nativeSourceOrigin.y = source.origin?.y ?? 0;
        const nativeSource = this.queue.externalImageSource;
        nativeSource.source = stagedSource;
        nativeSource.flipY = source.flipY ?? false;
        const nativeDestinationOrigin = this.queue.externalImageDestinationOrigin;
        nativeDestinationOrigin.x = destination.origin?.x ?? 0;
        nativeDestinationOrigin.y = destination.origin?.y ?? 0;
        nativeDestinationOrigin.z = destination.origin?.z ?? 0;
        const nativeDestination = this.queue.externalImageDestination;
        nativeDestination.texture = texture.nativeHandle;
        nativeDestination.mipLevel = destination.mipLevel ?? 0;
        nativeDestination.premultipliedAlpha = destination.premultipliedAlpha ?? false;
        const nativeExtent = this.queue.externalImageExtent;
        nativeExtent.width = copySize.width;
        nativeExtent.height = copySize.height ?? 1;
        nativeExtent.depthOrArrayLayers = 1;
        this.queue.nativeHandle.copyExternalImageToTexture(
            nativeSource,
            nativeDestination,
            nativeExtent
        );
        this.queue.externalImages.copied(source.source);
        this.recordNativeCommand();
    }

    generateMipmaps(texture: RHITexture): void {
        this.assertOpen();
        validateRHICommandGenerateMipmaps(this, texture);
        const concrete = webGPUTexture(this.owner, texture, 'texture');
        this.retain(concrete);
        this.closeExternalImageUploadPhase();
        const passCount = this.owner.mipmapGenerator.encode(this.#nativeEncoder, concrete);
        this.diagnostics.commandCount += 1;
        this.diagnostics.nativeStateCalls += passCount * 5;
    }

    beginRenderPass(descriptor: RHIRenderPassDescriptor): WebGPURenderPass {
        this.assertOpen();
        const storage = this.queue.acquireRenderPassStorage(descriptor, this);
        const snapshot = storage.snapshot.descriptor;
        this.closeExternalImageUploadPhase();
        let nativePass: GPURenderPassEncoder;
        try {
            nativePass = this.#nativeEncoder.beginRenderPass(
                this.owner.framebufferCache.lookup(snapshot)
            );
        } catch (error) {
            this.queue.releaseRenderPassStorage(storage);
            throw error;
        }
        let index = 0;
        while (index < snapshot.colorAttachments.length) {
            const attachment = snapshot.colorAttachments[index];
            index++;
            if (attachment === null) continue;
            if (attachment === undefined) continue;
            this.retain(attachment.view);
            this.retain(attachment.view.texture);
            if (attachment.resolveTarget !== undefined) {
                this.retain(attachment.resolveTarget);
                this.retain(attachment.resolveTarget.texture);
            }
        }
        if (snapshot.depthStencilAttachment !== undefined) {
            this.retain(snapshot.depthStencilAttachment.view);
            this.retain(snapshot.depthStencilAttachment.view.texture);
        }
        this.#contextState = 'render-pass';
        this.diagnostics.commandCount += 1;
        this.diagnostics.nativeStateCalls += 1;
        const pass = new WebGPURenderPass(this, nativePass, storage);
        this.#activePass = pass;
        return pass;
    }

    beginComputePass(descriptor: RHIComputePassDescriptor = {}): WebGPUComputePass {
        this.assertOpen();
        if (!this.owner.capabilities.features.has('compute-pipelines')) {
            validationFailure('unsupported-feature', 'compute passes are unsupported', 'context');
        }
        const storage = this.queue.acquireComputePassStorage(descriptor, this);
        this.closeExternalImageUploadPhase();
        let nativePass: GPUComputePassEncoder;
        try {
            nativePass = this.#nativeEncoder.beginComputePass(storage.nativeDescriptor);
        } catch (error) {
            this.queue.releaseComputePassStorage(storage);
            throw error;
        }
        this.#contextState = 'compute-pass';
        this.diagnostics.commandCount += 1;
        this.diagnostics.nativeStateCalls += 1;
        const pass = new WebGPUComputePass(this, nativePass, storage, descriptor.label ?? '');
        this.#activePass = pass;
        return pass;
    }

    clearBuffer(buffer: RHIBuffer, offset = 0, size?: number): void {
        this.assertOpen();
        const resolvedSize = validateRHIClearBuffer(
            this.owner,
            buffer,
            offset,
            size ?? buffer.size - offset
        );
        const nativeBuffer = webGPUBuffer(this.owner, buffer, 'clearBuffer.buffer');
        this.retain(nativeBuffer);
        this.closeExternalImageUploadPhase();
        this.#nativeEncoder.clearBuffer(nativeBuffer.nativeHandle, offset, resolvedSize);
        this.diagnostics.bufferClearCount += 1;
        this.recordNativeCommand();
    }

    copyBufferToBuffer(
        source: RHIBuffer,
        sourceOffset: number,
        destination: RHIBuffer,
        destinationOffset: number,
        size: number
    ): void {
        this.assertOpen();
        validateRHICopyBufferToBuffer(
            this,
            source,
            sourceOffset,
            destination,
            destinationOffset,
            size
        );
        const nativeSource = webGPUBuffer(this.owner, source, 'source');
        const nativeDestination = webGPUBuffer(this.owner, destination, 'destination');
        this.retain(nativeSource);
        this.retain(nativeDestination);
        this.closeExternalImageUploadPhase();
        this.#nativeEncoder.copyBufferToBuffer(
            nativeSource.nativeHandle,
            sourceOffset,
            nativeDestination.nativeHandle,
            destinationOffset,
            size
        );
        this.recordNativeCommand();
    }

    copyBufferToTexture(
        source: RHIImageCopyBuffer,
        destination: RHIImageCopyTexture,
        copySize: RHIExtent3D
    ): void {
        this.assertOpen();
        validateRHICopyBufferToTexture(this, source, destination, copySize);
        this.retain(source.buffer);
        this.retain(destination.texture);
        this.closeExternalImageUploadPhase();
        this.#nativeEncoder.copyBufferToTexture(
            nativeImageCopyBuffer(this.owner, source, 'source'),
            nativeImageCopyTexture(this.owner, destination, 'destination'),
            nativeTextureCopyExtent(copySize, destination)
        );
        this.recordNativeCommand();
    }

    copyTextureToBuffer(
        source: RHIImageCopyTexture,
        destination: RHIImageCopyBuffer,
        copySize: RHIExtent3D
    ): void {
        this.assertOpen();
        validateRHICopyTextureToBuffer(this, source, destination, copySize);
        this.retain(source.texture);
        this.retain(destination.buffer);
        this.closeExternalImageUploadPhase();
        this.#nativeEncoder.copyTextureToBuffer(
            nativeImageCopyTexture(this.owner, source, 'source'),
            nativeImageCopyBuffer(this.owner, destination, 'destination'),
            nativeTextureCopyExtent(copySize, source)
        );
        this.recordNativeCommand();
    }

    copyTextureToTexture(
        source: RHIImageCopyTexture,
        destination: RHIImageCopyTexture,
        copySize: RHIExtent3D
    ): void {
        this.assertOpen();
        validateRHICopyTextureToTexture(this, source, destination, copySize);
        this.retain(source.texture);
        this.retain(destination.texture);
        this.closeExternalImageUploadPhase();
        this.#nativeEncoder.copyTextureToTexture(
            nativeImageCopyTexture(this.owner, source, 'source'),
            nativeImageCopyTexture(this.owner, destination, 'destination'),
            nativeTextureCopyExtent(copySize, source)
        );
        this.recordNativeCommand();
    }

    /** @internal */
    retain(object: RHIDeviceOwnedObject): void {
        this.owner.assertUsable(object, 'frame.resource');
        if (!(object instanceof WebGPUDestroyableObject) || object.owner !== this.owner) {
            validationFailure('wrong-device', 'expected a WebGPU RHI object', 'frame.resource');
        }
        if (!object.retainForFrame(this.frameId)) return;
        const index = this.#retainedReferences.count;
        this.#retainedReferences.objects[index] = object;
        this.#retainedReferences.count = index + 1;
    }

    /** @internal */
    closePass(pass: WebGPURenderPass, storage: WebGPURenderPassStorage): void {
        if (this.#activePass !== pass || this.#contextState !== 'render-pass') {
            validationFailure('invalid-state', 'render pass is not active', 'renderPass');
        }
        this.#activePass = null;
        this.#contextState = 'open';
        this.queue.releaseRenderPassStorage(storage);
    }

    /** @internal Release pass backing while the context itself transitions to aborted. */
    abortPass(pass: WebGPURenderPass, storage: WebGPURenderPassStorage): void {
        if (this.#activePass !== pass) return;
        this.#activePass = null;
        this.queue.releaseRenderPassStorage(storage);
    }

    /** @internal */
    closeComputePass(pass: WebGPUComputePass, storage: WebGPUComputePassStorage): void {
        if (this.#activePass !== pass || this.#contextState !== 'compute-pass') {
            validationFailure('invalid-state', 'compute pass is not active', 'computePass');
        }
        this.#activePass = null;
        this.#contextState = 'open';
        this.queue.releaseComputePassStorage(storage);
    }

    /** @internal Release pass backing while the context itself transitions to aborted. */
    abortComputePass(pass: WebGPUComputePass, storage: WebGPUComputePassStorage): void {
        if (this.#activePass !== pass) return;
        this.#activePass = null;
        this.queue.releaseComputePassStorage(storage);
    }

    /** @internal */
    get retainedReferences(): WebGPUFrameReferences {
        return this.#retainedReferences;
    }

    /** @internal */
    finishForSubmission(): GPUCommandBuffer {
        this.assertOpen();
        const commandBuffer = this.#nativeEncoder.finish();
        this.owner.recordNativeObjectCreated('commandBuffer', 'creation-only');
        this.#contextState = 'ended';
        return commandBuffer;
    }

    /** @internal */
    abort(): WebGPUFrameReferences {
        if (this.#contextState === 'ended' || this.#contextState === 'aborted') {
            validationFailure(
                'invalid-state',
                `command context is ${this.#contextState}`,
                'context'
            );
        }
        this.#activePass?.abort();
        this.#activePass = null;
        this.#contextState = 'aborted';
        return this.#retainedReferences;
    }

    private recordNativeCommand(): void {
        this.diagnostics.commandCount += 1;
        this.diagnostics.nativeStateCalls += 1;
    }

    private closeExternalImageUploadPhase(): void {
        this.#externalImageUploadPhase = false;
        this.#directUploadPhase = false;
    }

    private assertOpen(): void {
        this.owner.assertUsable(this, 'context');
        if (this.#contextState !== 'open') {
            validationFailure(
                'invalid-state',
                `command context is ${this.#contextState}`,
                'context'
            );
        }
    }
}
