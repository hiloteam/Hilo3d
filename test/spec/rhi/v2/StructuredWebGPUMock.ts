type MockOperation = () => void;

interface MockBufferData {
    readonly storage: ArrayBuffer;
    mapState: GPUBufferMapState;
}

interface MockTextureData {
    readonly width: number;
    readonly height: number;
    readonly depthOrArrayLayers: number;
    readonly mipLevelCount: number;
    readonly format: GPUTextureFormat;
    readonly subresources: Map<number, Uint8Array>;
}

interface MockTextureViewData {
    readonly texture: GPUTexture;
    readonly baseMipLevel: number;
    readonly baseArrayLayer: number;
}

interface MockCommandBufferData {
    readonly operations: readonly MockOperation[];
}

interface MockBindGroupData {
    readonly entries: readonly GPUBindGroupEntry[];
}

interface MockPipelineData {
    readonly label: string;
}

export interface StructuredWebGPUMock {
    readonly device: GPUDevice;
    readonly canvas: HTMLCanvasElement;
    readonly log: string[];
    loseDevice(message?: string): void;
}

function numericProperty(value: object, property: string, fallback: number): number {
    const candidate: unknown = Reflect.get(value, property);
    return typeof candidate === 'number' ? candidate : fallback;
}

function extent(value: GPUExtent3D): { width: number; height: number; depth: number } {
    if (Symbol.iterator in Object(value)) {
        const values = Array.from(value as Iterable<number>);
        return { width: values[0] ?? 1, height: values[1] ?? 1, depth: values[2] ?? 1 };
    }
    const object = value as GPUExtent3DDict;
    return {
        width: numericProperty(object, 'width', 1),
        height: numericProperty(object, 'height', 1),
        depth: numericProperty(object, 'depthOrArrayLayers', 1)
    };
}

function origin(value: GPUOrigin3D | undefined): { x: number; y: number; z: number } {
    if (value === undefined) return { x: 0, y: 0, z: 0 };
    if (Symbol.iterator in Object(value)) {
        const values = Array.from(value as Iterable<number>);
        return { x: values[0] ?? 0, y: values[1] ?? 0, z: values[2] ?? 0 };
    }
    const object = value as GPUOrigin3DDict;
    return {
        x: numericProperty(object, 'x', 0),
        y: numericProperty(object, 'y', 0),
        z: numericProperty(object, 'z', 0)
    };
}

function colorBytes(value: GPUColor | undefined): readonly number[] {
    if (value === undefined) return [0, 0, 0, 0];
    if (Symbol.iterator in Object(value)) {
        return Array.from(value as Iterable<number>).map(component =>
            Math.round(Math.min(1, Math.max(0, component)) * 255)
        );
    }
    const object = value as GPUColorDict;
    return [object.r, object.g, object.b, object.a].map(component =>
        Math.round(Math.min(1, Math.max(0, component)) * 255)
    );
}

/**
 * CPU-backed native WebGPU shape. It executes encoded copies, clears, draws, resolves, and
 * readbacks so the portable conformance scene observes actual buffer results.
 */
export function createStructuredWebGPUMock(): StructuredWebGPUMock {
    const log: string[] = [];
    const buffers = new WeakMap<object, MockBufferData>();
    const textures = new WeakMap<object, MockTextureData>();
    const views = new WeakMap<object, MockTextureViewData>();
    const commandBuffers = new WeakMap<object, MockCommandBufferData>();
    const bindGroups = new WeakMap<object, MockBindGroupData>();
    const pipelines = new WeakMap<object, MockPipelineData>();

    function requireBuffer(buffer: GPUBuffer): MockBufferData {
        const data = buffers.get(buffer);
        if (data === undefined) throw new Error('structured mock received an unknown buffer');
        return data;
    }

    function requireTexture(texture: GPUTexture): MockTextureData {
        const data = textures.get(texture);
        if (data === undefined) throw new Error('structured mock received an unknown texture');
        return data;
    }

    function requireView(view: GPUTextureView): MockTextureViewData {
        const data = views.get(view);
        if (data === undefined) throw new Error('structured mock received an unknown texture view');
        return data;
    }

    function mipWidth(texture: MockTextureData, mipLevel: number): number {
        return Math.max(1, Math.floor(texture.width / 2 ** mipLevel));
    }

    function mipHeight(texture: MockTextureData, mipLevel: number): number {
        return Math.max(1, Math.floor(texture.height / 2 ** mipLevel));
    }

    function subresourceKey(mipLevel: number, arrayLayer: number): number {
        return mipLevel * 65_536 + arrayLayer;
    }

    function subresource(
        nativeTexture: GPUTexture,
        mipLevel: number,
        arrayLayer: number
    ): Uint8Array {
        const texture = requireTexture(nativeTexture);
        const key = subresourceKey(mipLevel, arrayLayer);
        let bytes = texture.subresources.get(key);
        if (bytes === undefined) {
            bytes = new Uint8Array(mipWidth(texture, mipLevel) * mipHeight(texture, mipLevel) * 4);
            texture.subresources.set(key, bytes);
        }
        return bytes;
    }

    function createTextureView(
        texture: GPUTexture,
        descriptor: GPUTextureViewDescriptor = {}
    ): GPUTextureView {
        const nativeView = { label: descriptor.label ?? '' };
        views.set(nativeView, {
            texture,
            baseMipLevel: descriptor.baseMipLevel ?? 0,
            baseArrayLayer: descriptor.baseArrayLayer ?? 0
        });
        log.push(`texture.createView:${descriptor.dimension ?? 'default'}`);
        return nativeView;
    }

    function createTexture(descriptor: GPUTextureDescriptor): GPUTexture {
        const dimensions = extent(descriptor.size);
        const nativeTexture: GPUTexture = {
            label: descriptor.label ?? '',
            width: dimensions.width,
            height: dimensions.height,
            depthOrArrayLayers: dimensions.depth,
            mipLevelCount: descriptor.mipLevelCount ?? 1,
            sampleCount: descriptor.sampleCount ?? 1,
            dimension: descriptor.dimension ?? '2d',
            format: descriptor.format,
            usage: descriptor.usage,
            createView: viewDescriptor => createTextureView(nativeTexture, viewDescriptor),
            destroy: () => log.push(`texture.destroy:${descriptor.label ?? ''}`)
        };
        textures.set(nativeTexture, {
            width: dimensions.width,
            height: dimensions.height,
            depthOrArrayLayers: dimensions.depth,
            mipLevelCount: descriptor.mipLevelCount ?? 1,
            format: descriptor.format,
            subresources: new Map()
        });
        log.push(`createTexture:${descriptor.label ?? ''}`);
        return nativeTexture;
    }

    function createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer {
        const storage = new ArrayBuffer(descriptor.size);
        const data: MockBufferData = {
            storage,
            mapState: descriptor.mappedAtCreation === true ? 'mapped' : 'unmapped'
        };
        const nativeBuffer = {
            label: descriptor.label ?? '',
            size: descriptor.size,
            usage: descriptor.usage,
            get mapState() {
                return data.mapState;
            },
            mapAsync: () => {
                data.mapState = 'mapped';
                log.push(`buffer.mapAsync:${descriptor.label ?? ''}`);
                return Promise.resolve();
            },
            getMappedRange: (offset = 0, size = storage.byteLength - offset) => {
                const start = offset;
                const length = size;
                if (start === 0 && length === storage.byteLength) return storage;
                return storage.slice(start, start + length);
            },
            unmap: () => {
                data.mapState = 'unmapped';
                log.push(`buffer.unmap:${descriptor.label ?? ''}`);
            },
            destroy: () => log.push(`buffer.destroy:${descriptor.label ?? ''}`)
        } as GPUBuffer;
        buffers.set(nativeBuffer, data);
        log.push(`createBuffer:${descriptor.label ?? ''}`);
        return nativeBuffer;
    }

    function fillView(view: GPUTextureView, color: readonly number[]): void {
        const viewData = requireView(view);
        const target = subresource(
            viewData.texture,
            viewData.baseMipLevel,
            viewData.baseArrayLayer
        );
        for (let offset = 0; offset < target.length; offset += 4) {
            target[offset] = color[0] ?? 0;
            target[offset + 1] = color[1] ?? 0;
            target[offset + 2] = color[2] ?? 0;
            target[offset + 3] = color[3] ?? 0;
        }
    }

    function sampledColor(bindGroup: GPUBindGroup | undefined): readonly number[] {
        if (bindGroup === undefined) return [0, 0, 0, 255];
        const group = bindGroups.get(bindGroup);
        const textureEntry = group?.entries.find(entry => entry.binding === 0);
        if (textureEntry === undefined || !views.has(textureEntry.resource)) {
            return [0, 0, 0, 255];
        }
        const view = requireView(textureEntry.resource as GPUTextureView);
        return Array.from(
            subresource(view.texture, view.baseMipLevel, view.baseArrayLayer).subarray(0, 4)
        );
    }

    function executeDraw(
        pipeline: GPURenderPipeline,
        group: GPUBindGroup | undefined,
        attachments: readonly (GPURenderPassColorAttachment | null)[]
    ): void {
        const label = pipelines.get(pipeline)?.label ?? '';
        if (label === 'phase2:depth-rejected' || label === 'phase2:stencil-rejected') return;
        if (label === 'phase2:mrt') {
            const first = attachments[0];
            const second = attachments[1];
            if (first !== null && first !== undefined) fillView(first.view, [255, 0, 0, 255]);
            if (second !== null && second !== undefined) fillView(second.view, [0, 255, 0, 255]);
            return;
        }
        const color =
            label === 'phase2:indexed-textured' || label === 'phase2:cube'
                ? sampledColor(group)
                : [255, 0, 0, 255];
        const first = attachments[0];
        if (first !== null && first !== undefined) fillView(first.view, color);
    }

    function copyView(source: GPUTextureView, destination: GPUTextureView): void {
        const sourceView = requireView(source);
        const destinationView = requireView(destination);
        const sourceBytes = subresource(
            sourceView.texture,
            sourceView.baseMipLevel,
            sourceView.baseArrayLayer
        );
        const destinationBytes = subresource(
            destinationView.texture,
            destinationView.baseMipLevel,
            destinationView.baseArrayLayer
        );
        destinationBytes.set(sourceBytes.subarray(0, destinationBytes.length));
    }

    function createRenderPass(
        descriptor: GPURenderPassDescriptor,
        operations: MockOperation[]
    ): GPURenderPassEncoder {
        const attachments = Array.from(descriptor.colorAttachments);
        for (const attachment of attachments) {
            if (attachment?.loadOp === 'clear') {
                operations.push(() => {
                    fillView(attachment.view, colorBytes(attachment.clearValue));
                });
            }
        }
        let currentPipeline: GPURenderPipeline | null = null;
        const currentGroups: (GPUBindGroup | undefined)[] = [];
        return {
            setPipeline: (pipeline: GPURenderPipeline) => {
                currentPipeline = pipeline;
                log.push('pass.setPipeline');
            },
            setBindGroup: (index: number, group: GPUBindGroup | null) => {
                currentGroups[index] = group ?? undefined;
                log.push('pass.setBindGroup');
            },
            setVertexBuffer: () => log.push('pass.setVertexBuffer'),
            setIndexBuffer: () => log.push('pass.setIndexBuffer'),
            setViewport: () => log.push('pass.setViewport'),
            setScissorRect: () => log.push('pass.setScissorRect'),
            setBlendConstant: () => log.push('pass.setBlendConstant'),
            setStencilReference: () => log.push('pass.setStencilReference'),
            draw: () => {
                if (currentPipeline === null) throw new Error('draw has no pipeline');
                const pipeline = currentPipeline;
                const group = currentGroups[0];
                operations.push(() => {
                    executeDraw(pipeline, group, attachments);
                });
                log.push('pass.draw');
            },
            drawIndexed: () => {
                if (currentPipeline === null) throw new Error('drawIndexed has no pipeline');
                const pipeline = currentPipeline;
                const group = currentGroups[0];
                operations.push(() => {
                    executeDraw(pipeline, group, attachments);
                });
                log.push('pass.drawIndexed');
            },
            end: () => {
                for (const attachment of attachments) {
                    if (attachment?.resolveTarget !== undefined) {
                        const resolveTarget = attachment.resolveTarget;
                        operations.push(() => {
                            copyView(attachment.view, resolveTarget);
                        });
                    }
                }
                log.push('pass.end');
            }
        } as unknown as GPURenderPassEncoder;
    }

    function copyBufferToTexture(
        source: GPUTexelCopyBufferInfo,
        destination: GPUTexelCopyTextureInfo,
        copySize: GPUExtent3D
    ): void {
        const size = extent(copySize);
        const sourceBytes = new Uint8Array(requireBuffer(source.buffer).storage);
        const destinationTexture = requireTexture(destination.texture);
        const destinationOrigin = origin(destination.origin);
        const mipLevel = destination.mipLevel ?? 0;
        const bytesPerRow = source.bytesPerRow ?? size.width * 4;
        const rowsPerImage = source.rowsPerImage ?? size.height;
        const sourceOffset = source.offset ?? 0;
        const targetWidth = mipWidth(destinationTexture, mipLevel);
        for (let layer = 0; layer < size.depth; layer += 1) {
            const target = subresource(destination.texture, mipLevel, destinationOrigin.z + layer);
            for (let row = 0; row < size.height; row += 1) {
                const sourceStart =
                    sourceOffset + layer * rowsPerImage * bytesPerRow + row * bytesPerRow;
                const destinationStart =
                    (destinationOrigin.y + row) * targetWidth * 4 + destinationOrigin.x * 4;
                target.set(
                    sourceBytes.subarray(sourceStart, sourceStart + size.width * 4),
                    destinationStart
                );
            }
        }
    }

    function copyTextureToBuffer(
        source: GPUTexelCopyTextureInfo,
        destination: GPUTexelCopyBufferInfo,
        copySize: GPUExtent3D
    ): void {
        const size = extent(copySize);
        const sourceTexture = requireTexture(source.texture);
        const sourceOrigin = origin(source.origin);
        const mipLevel = source.mipLevel ?? 0;
        const destinationBytes = new Uint8Array(requireBuffer(destination.buffer).storage);
        const bytesPerRow = destination.bytesPerRow ?? size.width * 4;
        const rowsPerImage = destination.rowsPerImage ?? size.height;
        const destinationOffset = destination.offset ?? 0;
        const sourceWidth = mipWidth(sourceTexture, mipLevel);
        for (let layer = 0; layer < size.depth; layer += 1) {
            const sourceBytes = subresource(source.texture, mipLevel, sourceOrigin.z + layer);
            for (let row = 0; row < size.height; row += 1) {
                const sourceStart = (sourceOrigin.y + row) * sourceWidth * 4 + sourceOrigin.x * 4;
                const destinationStart =
                    destinationOffset + layer * rowsPerImage * bytesPerRow + row * bytesPerRow;
                destinationBytes.set(
                    sourceBytes.subarray(sourceStart, sourceStart + size.width * 4),
                    destinationStart
                );
            }
        }
    }

    function copyTextureToTexture(
        source: GPUTexelCopyTextureInfo,
        destination: GPUTexelCopyTextureInfo,
        copySize: GPUExtent3D
    ): void {
        const size = extent(copySize);
        const sourceTexture = requireTexture(source.texture);
        const destinationTexture = requireTexture(destination.texture);
        const sourceOrigin = origin(source.origin);
        const destinationOrigin = origin(destination.origin);
        const sourceMip = source.mipLevel ?? 0;
        const destinationMip = destination.mipLevel ?? 0;
        const sourceWidth = mipWidth(sourceTexture, sourceMip);
        const destinationWidth = mipWidth(destinationTexture, destinationMip);
        for (let layer = 0; layer < size.depth; layer += 1) {
            const sourceBytes = subresource(source.texture, sourceMip, sourceOrigin.z + layer);
            const destinationBytes = subresource(
                destination.texture,
                destinationMip,
                destinationOrigin.z + layer
            );
            for (let row = 0; row < size.height; row += 1) {
                const sourceStart = (sourceOrigin.y + row) * sourceWidth * 4 + sourceOrigin.x * 4;
                const destinationStart =
                    (destinationOrigin.y + row) * destinationWidth * 4 + destinationOrigin.x * 4;
                destinationBytes.set(
                    sourceBytes.subarray(sourceStart, sourceStart + size.width * 4),
                    destinationStart
                );
            }
        }
    }

    function createCommandEncoder(): GPUCommandEncoder {
        const operations: MockOperation[] = [];
        return {
            label: 'structured command encoder',
            beginRenderPass: (descriptor: GPURenderPassDescriptor) => {
                log.push('encoder.beginRenderPass');
                return createRenderPass(descriptor, operations);
            },
            copyBufferToBuffer: (
                source: GPUBuffer,
                sourceOffset: number,
                destination: GPUBuffer,
                destinationOffset: number,
                size: number
            ) => {
                operations.push(() => {
                    const sourceBytes = new Uint8Array(requireBuffer(source).storage);
                    const destinationBytes = new Uint8Array(requireBuffer(destination).storage);
                    destinationBytes.set(
                        sourceBytes.subarray(sourceOffset, sourceOffset + size),
                        destinationOffset
                    );
                });
                log.push('encoder.copyBufferToBuffer');
            },
            copyBufferToTexture: (
                source: GPUTexelCopyBufferInfo,
                destination: GPUTexelCopyTextureInfo,
                size: GPUExtent3D
            ) => {
                // WebIDL converts dictionaries before the native call returns. Snapshot here so
                // this deferred CPU mock observes the same semantics when production reuses its
                // queue-owned descriptor storage for a later command.
                const sourceSnapshot = {
                    buffer: source.buffer,
                    offset: source.offset,
                    bytesPerRow: source.bytesPerRow,
                    rowsPerImage: source.rowsPerImage
                } as unknown as GPUTexelCopyBufferInfo;
                const destinationOrigin = origin(destination.origin);
                const destinationSnapshot = {
                    texture: destination.texture,
                    mipLevel: destination.mipLevel,
                    origin: destinationOrigin,
                    aspect: destination.aspect
                } as unknown as GPUTexelCopyTextureInfo;
                const dimensions = extent(size);
                const sizeSnapshot: GPUExtent3DDict = {
                    width: dimensions.width,
                    height: dimensions.height,
                    depthOrArrayLayers: dimensions.depth
                };
                operations.push(() => {
                    copyBufferToTexture(sourceSnapshot, destinationSnapshot, sizeSnapshot);
                });
                log.push('encoder.copyBufferToTexture');
            },
            copyTextureToBuffer: (
                source: GPUTexelCopyTextureInfo,
                destination: GPUTexelCopyBufferInfo,
                size: GPUExtent3D
            ) => {
                operations.push(() => {
                    copyTextureToBuffer(source, destination, size);
                });
                log.push('encoder.copyTextureToBuffer');
            },
            copyTextureToTexture: (
                source: GPUTexelCopyTextureInfo,
                destination: GPUTexelCopyTextureInfo,
                size: GPUExtent3D
            ) => {
                operations.push(() => {
                    copyTextureToTexture(source, destination, size);
                });
                log.push('encoder.copyTextureToTexture');
            },
            finish: () => {
                const commandBuffer: GPUCommandBuffer = { label: 'structured command buffer' };
                commandBuffers.set(commandBuffer, { operations: [...operations] });
                log.push('encoder.finish');
                return commandBuffer;
            }
        } as unknown as GPUCommandEncoder;
    }

    const nativeQueue = {
        label: 'structured queue',
        writeBuffer: (
            destination: GPUBuffer,
            destinationOffset: number,
            source: AllowSharedBufferSource,
            sourceOffset = 0,
            size?: number
        ) => {
            const sourceBytes = ArrayBuffer.isView(source)
                ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
                : new Uint8Array(source);
            const nativeElementSize = ArrayBuffer.isView(source)
                ? (Reflect.get(source, 'BYTES_PER_ELEMENT') as unknown)
                : undefined;
            const elementSize =
                typeof nativeElementSize === 'number' && nativeElementSize > 0
                    ? nativeElementSize
                    : 1;
            const sourceByteOffset = sourceOffset * elementSize;
            const byteLength =
                size === undefined ? sourceBytes.byteLength - sourceByteOffset : size * elementSize;
            new Uint8Array(requireBuffer(destination).storage).set(
                sourceBytes.subarray(sourceByteOffset, sourceByteOffset + byteLength),
                destinationOffset
            );
            log.push('queue.writeBuffer');
        },
        submit: (submitted: Iterable<GPUCommandBuffer>) => {
            for (const commandBuffer of submitted) {
                const encoded = commandBuffers.get(commandBuffer);
                if (encoded === undefined) throw new Error('unknown structured command buffer');
                for (const operation of encoded.operations) operation();
            }
            log.push('queue.submit');
        },
        onSubmittedWorkDone: () => {
            log.push('queue.onSubmittedWorkDone');
            return Promise.resolve();
        }
    } as unknown as GPUQueue;

    const limits = {
        maxTextureDimension1D: 8192,
        maxTextureDimension2D: 8192,
        maxTextureDimension3D: 2048,
        maxTextureArrayLayers: 256,
        maxBindGroups: 4,
        maxBindingsPerBindGroup: 32,
        maxDynamicUniformBuffersPerPipelineLayout: 8,
        maxSampledTexturesPerShaderStage: 16,
        maxSamplersPerShaderStage: 16,
        maxUniformBuffersPerShaderStage: 12,
        maxUniformBufferBindingSize: 65_536,
        maxVertexBuffers: 8,
        maxBufferSize: 268_435_456,
        maxVertexAttributes: 16,
        maxVertexBufferArrayStride: 2048,
        minUniformBufferOffsetAlignment: 256,
        maxColorAttachments: 8,
        maxStorageBuffersPerShaderStage: 8,
        maxStorageTexturesPerShaderStage: 4,
        maxStorageBufferBindingSize: 134_217_728,
        minStorageBufferOffsetAlignment: 256
    } as unknown as GPUSupportedLimits;

    let resolveLost: ((info: GPUDeviceLostInfo) => void) | undefined;
    const lost = new Promise<GPUDeviceLostInfo>(resolve => {
        resolveLost = resolve;
    });
    const nativeDevice = {
        label: 'structured WebGPU device',
        features: new Set<GPUFeatureName>() as unknown as GPUSupportedFeatures,
        limits,
        queue: nativeQueue,
        lost,
        createBuffer,
        createTexture,
        createSampler: () => ({ label: 'structured sampler' }),
        createShaderModule: (descriptor: GPUShaderModuleDescriptor) =>
            ({ label: descriptor.label ?? '' }) as GPUShaderModule,
        createBindGroupLayout: (descriptor: GPUBindGroupLayoutDescriptor) => ({
            label: descriptor.label ?? ''
        }),
        createPipelineLayout: (descriptor: GPUPipelineLayoutDescriptor) => ({
            label: descriptor.label ?? ''
        }),
        createBindGroup: (descriptor: GPUBindGroupDescriptor) => {
            const group = { label: descriptor.label ?? '' };
            bindGroups.set(group, { entries: [...descriptor.entries] });
            return group;
        },
        createRenderPipeline: (descriptor: GPURenderPipelineDescriptor) => {
            const pipeline = { label: descriptor.label ?? '' } as GPURenderPipeline;
            pipelines.set(pipeline, { label: descriptor.label ?? '' });
            return pipeline;
        },
        createCommandEncoder,
        destroy: () => log.push('device.destroy')
    } as unknown as GPUDevice;

    const canvas = document.createElement('canvas');
    let configuration: GPUCanvasConfiguration | null = null;
    const canvasContext = {
        canvas,
        configure: (value: GPUCanvasConfiguration) => {
            configuration = value;
            log.push('surface.configure');
        },
        getCurrentTexture: () => {
            if (configuration === null) throw new Error('structured surface is not configured');
            log.push('surface.getCurrentTexture');
            return createTexture({
                label: 'structured surface texture',
                size: { width: canvas.width, height: canvas.height },
                format: configuration.format,
                usage: configuration.usage ?? 0x10
            });
        },
        unconfigure: () => {
            configuration = null;
            log.push('surface.unconfigure');
        }
    } as unknown as GPUCanvasContext;
    Object.defineProperty(canvas, 'getContext', {
        configurable: true,
        value: (name: string) => (name === 'webgpu' ? canvasContext : null)
    });

    return {
        device: nativeDevice,
        canvas,
        log,
        loseDevice: (message = 'structured device loss') => {
            resolveLost?.({ reason: 'unknown', message });
        }
    };
}
