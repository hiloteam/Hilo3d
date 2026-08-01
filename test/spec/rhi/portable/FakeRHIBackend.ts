import type {
    RHICapabilities,
    RHIFeatureName,
    RHILimits,
    RHITextureFormatCapabilities
} from '../../../../src/render/rhi/core/RHICapabilities';
import type {
    RHICommandContext,
    RHICommandContextState,
    RHIComputePassDescriptor,
    RHIComputePassEncoder,
    RHIComputePassState,
    RHIDrawArgumentsRecord,
    RHIFrameDiagnostics,
    RHIImageCopyBuffer,
    RHIImageCopyExternalImage,
    RHIImageCopyExternalImageToTexture,
    RHIImageCopyTexture,
    RHIImageDataLayout,
    RHIIndexBufferBindingRecord,
    RHIRenderPassDescriptor,
    RHIRenderPassEncoder,
    RHIRenderPassState,
    RHIVertexBufferBindingRecord
} from '../../../../src/render/rhi/core/RHICommands';
import {
    validateRHIClearBuffer,
    validateRHIDispatchWorkgroups,
    validateRHIDispatchWorkgroupsIndirect,
    validateRHIDrawIndirect
} from '../../../../src/render/rhi/core/RHICommandValidation';
import {
    validateAndSnapshotRHIWriteBuffer,
    validateAndSnapshotRHIWriteTexture,
    validateRHICopyBufferToBuffer,
    validateRHICopyBufferToTexture,
    validateRHICopyTextureToBuffer,
    validateRHICopyTextureToTexture,
    validateRHICommandCopyExternalImageToTexture,
    validateRHICommandGenerateMipmaps
} from '../../../../src/render/rhi/core/RHICopyValidation';
import {
    normalizeRHIQuerySetDescriptor,
    validateRHIDebugLabel,
    validateRHIResolveQuerySet,
    validateRHITimestampWrites
} from '../../../../src/render/rhi/core/RHIQueryValidation';
import type {
    RHIBindGroup,
    RHIBindGroupDescriptor,
    RHIBindGroupEntry,
    RHIBindGroupLayout,
    RHIBindGroupLayoutDescriptor,
    RHIComputePipeline,
    RHIComputePipelineDescriptor,
    RHIGraphicsPipeline,
    RHIGraphicsPipelineDescriptor,
    RHIPipelineLayout,
    RHIPipelineLayoutDescriptor,
    RHIVertexInputBindings
} from '../../../../src/render/rhi/core/RHIPipeline';
import type {
    RHIFrameDescriptor,
    RHIQueue,
    RHIQueueState,
    RHISubmission,
    RHISubmissionStatus
} from '../../../../src/render/rhi/core/RHIQueue';
import type {
    RHIBuffer,
    RHIBufferDescriptor,
    RHIBufferMapMode,
    RHIBufferMapState,
    RHIDevice,
    RHIDeviceLostInfo,
    RHIDeviceLostReason,
    RHIDeviceOwnedObject,
    RHIDeviceOwnedDestroyable,
    RHINormalizedBufferDescriptor,
    RHINormalizedQuerySetDescriptor,
    RHINormalizedSamplerDescriptor,
    RHINormalizedShaderDescriptor,
    RHINormalizedTextureDescriptor,
    RHINormalizedTextureViewDescriptor,
    RHIResource,
    RHIResourceLifetime,
    RHIQuerySet,
    RHIQuerySetDescriptor,
    RHISampler,
    RHISamplerDescriptor,
    RHIShader,
    RHIShaderDescriptor,
    RHITexture,
    RHITextureDescriptor,
    RHITextureView,
    RHITextureViewDescriptor
} from '../../../../src/render/rhi/core/RHIResources';
import type {
    RHINormalizedSurfaceConfiguration,
    RHISurface,
    RHISurfaceConfiguration,
    RHISurfaceState
} from '../../../../src/render/rhi/core/RHISurface';
import {
    RHIBufferUsage,
    RHITextureUsage,
    type RHIBackend,
    type RHIColor,
    type RHIDataSource,
    type RHIExtent3D,
    type RHIIndexFormat,
    type RHIRect,
    type RHITextureFormat,
    type RHIUInt32View,
    type RHIViewport
} from '../../../../src/render/rhi/core/RHITypes';
import {
    RHIValidationError,
    assertRHIObjectOwnedBy,
    normalizeRHIBufferDescriptor,
    assertRHIBufferMapRange,
    assertRHIGetMappedRange,
    normalizeRHISamplerDescriptor,
    normalizeRHIShaderDescriptor,
    normalizeRHISurfaceConfiguration,
    normalizeRHITextureDescriptor,
    normalizeRHITextureViewDescriptor,
    snapshotRHIBindGroupDescriptor,
    snapshotRHIBindGroupLayoutDescriptor,
    snapshotRHIComputePipelineDescriptor,
    snapshotRHIDataSource,
    snapshotRHIGraphicsPipelineDescriptor,
    snapshotRHIPipelineLayoutDescriptor,
    snapshotRHIRenderPassDescriptor,
    validateRHIRenderPassPipelineDepthStencilAccess,
    type RHIValidationErrorCode
} from '../../../../src/render/rhi/core/RHIValidation';

export type FakeRHIExecutionMode = 'immediate' | 'deferred';

interface FakeRHICommand {
    readonly label: string;
    readonly apply?: () => void;
}

interface Deferred<T> {
    readonly promise: Promise<T>;
    resolve(value: T | PromiseLike<T>): void;
    reject(reason?: unknown): void;
}

let nextFakeDeviceId = 1;

function allocateFakeDeviceId(): number {
    return nextFakeDeviceId++;
}

function deferred<T>(): Deferred<T> {
    let resolvePromise: ((value: T | PromiseLike<T>) => void) | undefined;
    let rejectPromise: ((reason?: unknown) => void) | undefined;
    const promise = new Promise<T>((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
    });
    return {
        promise,
        resolve: value => resolvePromise?.(value),
        reject: reason => rejectPromise?.(reason)
    };
}

function assertFiniteInteger(value: number, name: string, minimum = 0): void {
    if (!Number.isSafeInteger(value) || value < minimum) {
        throw new Error(`${name} must be an integer greater than or equal to ${String(minimum)}`);
    }
}

function normalizedLifetime(lifetime: RHIResourceLifetime | undefined): RHIResourceLifetime {
    return lifetime ?? 'persistent';
}

function createDiagnostics(target?: RHIFrameDiagnostics): RHIFrameDiagnostics {
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

abstract class FakeDeviceObject implements RHIDeviceOwnedObject {
    readonly id: number;
    readonly deviceId: number;
    readonly deviceGeneration: number;
    label?: string;

    protected constructor(
        readonly owner: FakeRHIDevice,
        label = ''
    ) {
        this.id = owner.fakeBackend.allocateId();
        this.deviceId = owner.id;
        this.deviceGeneration = owner.generation;
        this.label = label;
    }
}

abstract class FakeDestroyableObject extends FakeDeviceObject implements RHIDeviceOwnedDestroyable {
    destroyed = false;
    nativeReleased = false;
    private retainCount = 0;

    protected constructor(owner: FakeRHIDevice, label = '') {
        super(owner, label);
        owner.register(this);
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.releaseIfUnused();
    }

    retainForFrame(): void {
        this.retainCount++;
    }

    releaseFromFrame(): void {
        if (this.retainCount === 0) {
            throw new Error(`RHI object ${String(this.id)} is not retained`);
        }
        this.retainCount--;
        this.releaseIfUnused();
    }

    invalidateNative(): void {
        this.releaseIfUnused();
    }

    private releaseIfUnused(): void {
        if (
            !this.nativeReleased &&
            this.retainCount === 0 &&
            (this.destroyed || this.deviceGeneration !== this.owner.generation)
        ) {
            this.nativeReleased = true;
            this.owner.unregister(this);
        }
    }
}

abstract class FakeResource<D extends object> extends FakeDestroyableObject implements RHIResource {
    abstract readonly descriptor: Readonly<D>;
    readonly lifetime: RHIResourceLifetime;

    protected constructor(owner: FakeRHIDevice, label: string, lifetime: RHIResourceLifetime) {
        super(owner, label);
        this.lifetime = lifetime;
    }
}

export class FakeRHIBuffer
    extends FakeResource<RHINormalizedBufferDescriptor>
    implements RHIBuffer
{
    readonly descriptor: Readonly<RHINormalizedBufferDescriptor>;
    readonly size: number;
    readonly usage: number;
    private readonly storage: ArrayBuffer;
    private currentMapState: RHIBufferMapState;
    private mappedOffset = 0;
    private mappedSize = 0;

    constructor(owner: FakeRHIDevice, source: RHIBufferDescriptor) {
        const descriptor = normalizeRHIBufferDescriptor(source, owner.capabilities);
        super(owner, descriptor.label, descriptor.lifetime);
        this.descriptor = descriptor;
        this.size = descriptor.size;
        this.usage = descriptor.usage;
        this.storage = new ArrayBuffer(descriptor.size);
        this.currentMapState = descriptor.mappedAtCreation ? 'mapped' : 'unmapped';
        if (descriptor.mappedAtCreation) this.mappedSize = descriptor.size;
        if (source.initialData) {
            const initialBytes = snapshotRHIDataSource(source.initialData);
            new Uint8Array(this.storage).set(initialBytes);
        }
    }

    get mapState(): RHIBufferMapState {
        return this.currentMapState;
    }

    async mapAsync(mode: RHIBufferMapMode, offset = 0, size = this.size - offset): Promise<void> {
        this.owner.assertUsable(this);
        if (this.currentMapState !== 'unmapped') throw new Error('buffer is already mapped');
        const requiredUsage = mode === 'read' ? RHIBufferUsage.MAP_READ : RHIBufferUsage.MAP_WRITE;
        if ((this.usage & requiredUsage) === 0)
            throw new Error(`buffer does not support ${mode} mapping`);
        assertRHIBufferMapRange(this.size, offset, size, 'buffer.map');
        this.currentMapState = 'pending';
        await Promise.resolve();
        this.mappedOffset = offset;
        this.mappedSize = size;
        this.currentMapState = 'mapped';
    }

    getMappedRange(offset = 0, size = this.size - offset): ArrayBuffer {
        this.owner.assertUsable(this);
        if (this.currentMapState !== 'mapped') throw new Error('buffer is not mapped');
        assertRHIGetMappedRange(
            this.mappedOffset,
            this.mappedSize,
            offset,
            size,
            'buffer.mappedRange'
        );
        return this.storage.slice(offset, offset + size);
    }

    unmap(): void {
        this.owner.assertUsable(this);
        if (this.currentMapState === 'unmapped') throw new Error('buffer is not mapped');
        this.currentMapState = 'unmapped';
        this.mappedOffset = 0;
        this.mappedSize = 0;
    }

    snapshotBytes(): Uint8Array {
        return new Uint8Array(this.storage.slice(0));
    }

    copyBytesFrom(
        source: FakeRHIBuffer,
        sourceOffset: number,
        destinationOffset: number,
        size: number
    ): void {
        const sourceBytes = new Uint8Array(source.storage, sourceOffset, size);
        new Uint8Array(this.storage, destinationOffset, size).set(sourceBytes);
    }

    writeBytes(destinationOffset: number, data: Uint8Array): void {
        new Uint8Array(this.storage, destinationOffset, data.byteLength).set(data);
    }

    clearBytes(offset: number, size: number): void {
        new Uint8Array(this.storage, offset, size).fill(0);
    }
}

export class FakeRHITexture
    extends FakeResource<RHINormalizedTextureDescriptor>
    implements RHITexture
{
    readonly descriptor: Readonly<RHINormalizedTextureDescriptor>;
    readonly width: number;
    readonly height: number;
    readonly depthOrArrayLayers: number;
    readonly mipLevelCount: number;
    readonly sampleCount: number;
    readonly dimension;
    readonly format;
    readonly usage: number;
    private lastWriteData: Uint8Array | undefined;

    constructor(owner: FakeRHIDevice, source: RHITextureDescriptor) {
        const descriptor = normalizeRHITextureDescriptor(source, owner.capabilities);
        super(owner, descriptor.label, descriptor.lifetime);
        this.descriptor = descriptor;
        this.width = descriptor.size.width;
        this.height = descriptor.size.height;
        this.depthOrArrayLayers = descriptor.size.depthOrArrayLayers;
        this.mipLevelCount = descriptor.mipLevelCount;
        this.sampleCount = descriptor.sampleCount;
        this.dimension = descriptor.dimension;
        this.format = descriptor.format;
        this.usage = descriptor.usage;
    }

    createView(source: RHITextureViewDescriptor = {}): RHITextureView {
        this.owner.assertUsable(this);
        return new FakeRHITextureView(this, source);
    }

    writeData(data: Uint8Array): void {
        this.lastWriteData = data;
    }

    snapshotLastWriteBytes(): Uint8Array {
        return this.lastWriteData?.slice() ?? new Uint8Array();
    }
}

export class FakeRHITextureView extends FakeDestroyableObject implements RHITextureView {
    readonly texture: FakeRHITexture;
    readonly descriptor: Readonly<RHINormalizedTextureViewDescriptor>;
    readonly format;
    readonly dimension;
    readonly aspect;

    constructor(texture: FakeRHITexture, source: RHITextureViewDescriptor) {
        const descriptor = normalizeRHITextureViewDescriptor(texture, source);
        super(texture.owner, descriptor.label);
        this.texture = texture;
        this.descriptor = descriptor;
        this.format = descriptor.format;
        this.dimension = descriptor.dimension;
        this.aspect = descriptor.aspect;
    }
}

export class FakeRHIQuerySet
    extends FakeResource<RHINormalizedQuerySetDescriptor>
    implements RHIQuerySet
{
    readonly descriptor: Readonly<RHINormalizedQuerySetDescriptor>;
    readonly type;
    readonly count;

    constructor(owner: FakeRHIDevice, source: RHIQuerySetDescriptor) {
        const descriptor = normalizeRHIQuerySetDescriptor(source, owner.capabilities);
        super(owner, descriptor.label, descriptor.lifetime);
        this.descriptor = descriptor;
        this.type = descriptor.type;
        this.count = descriptor.count;
    }
}

export class FakeRHISampler
    extends FakeResource<RHINormalizedSamplerDescriptor>
    implements RHISampler
{
    readonly descriptor: Readonly<RHINormalizedSamplerDescriptor>;

    constructor(owner: FakeRHIDevice, source: RHISamplerDescriptor = {}) {
        const descriptor = normalizeRHISamplerDescriptor(source, owner.capabilities);
        super(owner, descriptor.label, descriptor.lifetime);
        this.descriptor = descriptor;
    }
}

export class FakeRHIShader
    extends FakeResource<RHINormalizedShaderDescriptor>
    implements RHIShader
{
    readonly descriptor: Readonly<RHINormalizedShaderDescriptor>;
    readonly artifact;
    readonly stage;

    constructor(owner: FakeRHIDevice, source: RHIShaderDescriptor) {
        const descriptor = normalizeRHIShaderDescriptor(source, owner);
        super(owner, descriptor.label, descriptor.lifetime);
        this.descriptor = descriptor;
        this.artifact = descriptor.artifact;
        this.stage = descriptor.artifact.stage;
    }
}

class FakeBindGroupLayout
    extends FakeResource<RHIBindGroupLayoutDescriptor>
    implements RHIBindGroupLayout
{
    readonly descriptor: Readonly<RHIBindGroupLayoutDescriptor>;
    readonly entries;

    constructor(owner: FakeRHIDevice, source: RHIBindGroupLayoutDescriptor) {
        const descriptor = snapshotRHIBindGroupLayoutDescriptor(source, owner.capabilities);
        super(owner, descriptor.label ?? '', normalizedLifetime(descriptor.lifetime));
        this.descriptor = descriptor;
        this.entries = descriptor.entries;
    }
}

class FakePipelineLayout
    extends FakeResource<RHIPipelineLayoutDescriptor>
    implements RHIPipelineLayout
{
    readonly descriptor: Readonly<RHIPipelineLayoutDescriptor>;
    readonly bindGroupLayouts;

    constructor(owner: FakeRHIDevice, source: RHIPipelineLayoutDescriptor) {
        const descriptor = snapshotRHIPipelineLayoutDescriptor(owner, source);
        super(owner, descriptor.label ?? '', normalizedLifetime(descriptor.lifetime));
        this.descriptor = descriptor;
        this.bindGroupLayouts = descriptor.bindGroupLayouts;
    }
}

class FakeBindGroup extends FakeResource<RHIBindGroupDescriptor> implements RHIBindGroup {
    readonly descriptor: Readonly<RHIBindGroupDescriptor>;
    readonly layout;
    readonly entries: readonly RHIBindGroupEntry[];

    constructor(owner: FakeRHIDevice, source: RHIBindGroupDescriptor) {
        const descriptor = snapshotRHIBindGroupDescriptor(owner, source);
        super(owner, descriptor.label ?? '', normalizedLifetime(descriptor.lifetime));
        this.descriptor = descriptor;
        this.layout = descriptor.layout;
        this.entries = descriptor.entries;
    }

    referencedObjects(): readonly RHIDeviceOwnedObject[] {
        const objects: RHIDeviceOwnedObject[] = [];
        for (const entry of this.entries) {
            if ('buffer' in entry.resource) {
                objects.push(entry.resource.buffer);
            } else {
                objects.push(entry.resource);
                if ('texture' in entry.resource) objects.push(entry.resource.texture);
            }
        }
        return objects;
    }
}

class FakeGraphicsPipeline
    extends FakeResource<RHIGraphicsPipelineDescriptor>
    implements RHIGraphicsPipeline
{
    readonly descriptor: Readonly<RHIGraphicsPipelineDescriptor>;

    constructor(owner: FakeRHIDevice, source: RHIGraphicsPipelineDescriptor) {
        const descriptor = snapshotRHIGraphicsPipelineDescriptor(owner, source);
        super(owner, descriptor.label ?? '', normalizedLifetime(descriptor.lifetime));
        this.descriptor = descriptor;
    }

    getBindGroupLayout(index: number): RHIBindGroupLayout {
        assertFiniteInteger(index, 'bind group layout index');
        const layout = this.descriptor.layout.bindGroupLayouts[index];
        if (!layout) {
            throw new Error(`pipeline has no bind group layout at index ${String(index)}`);
        }
        return layout;
    }

    prepareVertexInput(bindings: Readonly<RHIVertexInputBindings>): void {
        void bindings;
    }
}

class FakeComputePipeline
    extends FakeResource<RHIComputePipelineDescriptor>
    implements RHIComputePipeline
{
    readonly descriptor: Readonly<RHIComputePipelineDescriptor>;
    readonly layout: RHIPipelineLayout;

    constructor(owner: FakeRHIDevice, source: RHIComputePipelineDescriptor) {
        const descriptor = snapshotRHIComputePipelineDescriptor(owner, source);
        super(owner, descriptor.label ?? '', normalizedLifetime(descriptor.lifetime));
        this.descriptor = descriptor;
        this.layout = descriptor.layout;
    }

    getBindGroupLayout(index: number): RHIBindGroupLayout {
        assertFiniteInteger(index, 'bind group layout index');
        const layout = this.layout.bindGroupLayouts[index];
        if (layout === undefined) {
            throw new Error(`pipeline has no bind group layout at index ${String(index)}`);
        }
        return layout;
    }
}

class FakeRHICapabilities implements RHICapabilities {
    readonly features: ReadonlySet<RHIFeatureName>;
    readonly limits: Readonly<RHILimits>;
    private readonly formatCapabilities: Readonly<
        Record<'color' | 'depth' | 'unsupported', RHITextureFormatCapabilities>
    >;

    constructor(backend: RHIBackend) {
        this.features = new Set<RHIFeatureName>([
            // WebGL2 implements mapAsync through getBufferSubData/bufferSubData, matching the
            // concrete RHI backend rather than the legacy RHI feature table.
            'buffer-mapping',
            ...(backend === 'webgpu'
                ? [
                      'texture-1d' as const,
                      'cube-map-arrays' as const,
                      'draw-base-vertex' as const,
                      'draw-first-instance' as const,
                      'indirect-draw' as const,
                      'storage-buffers' as const,
                      'storage-textures' as const,
                      'compute-pipelines' as const,
                      'shader-f16' as const,
                      'timestamp-query' as const,
                      'subgroups' as const
                  ]
                : [])
        ]);
        this.limits = Object.freeze({
            ...(backend === 'webgpu' ? { maxTextureDimension1D: 8192 } : {}),
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
            ...(backend === 'webgpu'
                ? {
                      maxStorageBuffersPerShaderStage: 8,
                      maxStorageTexturesPerShaderStage: 4,
                      maxStorageBufferBindingSize: 134_217_728,
                      minStorageBufferOffsetAlignment: 256,
                      maxDynamicStorageBuffersPerPipelineLayout: 4,
                      maxComputeWorkgroupStorageSize: 16_384,
                      maxComputeInvocationsPerWorkgroup: 256,
                      maxComputeWorkgroupSizeX: 256,
                      maxComputeWorkgroupSizeY: 256,
                      maxComputeWorkgroupSizeZ: 64,
                      maxComputeWorkgroupsPerDimension: 65_535,
                      subgroupMinSize: 4,
                      subgroupMaxSize: 32
                  }
                : {})
        });
        const color = Object.freeze({
            sampled: true,
            filterable: true,
            renderable: true,
            blendable: true,
            storage: backend === 'webgpu',
            sampleCounts: Object.freeze([1, 4])
        });
        const depth = Object.freeze({
            sampled: true,
            filterable: false,
            renderable: true,
            blendable: false,
            storage: false,
            sampleCounts: Object.freeze([1, 4])
        });
        const unsupported = Object.freeze({
            sampled: false,
            filterable: false,
            renderable: false,
            blendable: false,
            storage: false,
            sampleCounts: Object.freeze([] as number[])
        });
        this.formatCapabilities = Object.freeze({ color, depth, unsupported });
    }

    getTextureFormatCapabilities(format: RHITextureFormat) {
        if (format.startsWith('depth') || format === 'stencil8') {
            return this.formatCapabilities.depth;
        }
        if (
            format.startsWith('bc') ||
            format.startsWith('etc') ||
            format.startsWith('eac') ||
            format.startsWith('astc')
        ) {
            return this.formatCapabilities.unsupported;
        }
        return this.formatCapabilities.color;
    }
}

export class FakeRHIDevice implements RHIDevice {
    readonly id: number;
    readonly backend: RHIBackend;
    readonly capabilities: RHICapabilities;
    readonly lost: Promise<RHIDeviceLostInfo>;
    label?: string;
    destroyed = false;
    generation = 1;
    private readonly lostSignal = deferred<RHIDeviceLostInfo>();
    private readonly ownedObjects = new Set<FakeDestroyableObject>();
    private createdObjectCount = 0;
    private releasedNativeObjectCount = 0;
    private peakNativeObjectCount = 0;
    private currentGraphicsQueue: FakeRHIQueue;

    constructor(readonly fakeBackend: FakeRHIBackend) {
        this.id = allocateFakeDeviceId();
        this.backend = fakeBackend.backend;
        this.capabilities = new FakeRHICapabilities(this.backend);
        this.label = `fake ${this.backend} device`;
        this.lost = this.lostSignal.promise;
        this.currentGraphicsQueue = new FakeRHIQueue(this);
    }

    get deviceGeneration(): number {
        return this.generation;
    }

    get graphicsQueue(): FakeRHIQueue {
        return this.currentGraphicsQueue;
    }

    register(object: FakeDestroyableObject): void {
        this.ownedObjects.add(object);
        this.createdObjectCount++;
        if (this.ownedObjects.size > this.peakNativeObjectCount) {
            this.peakNativeObjectCount = this.ownedObjects.size;
        }
    }

    unregister(object: FakeDestroyableObject): void {
        if (this.ownedObjects.delete(object)) this.releasedNativeObjectCount++;
    }

    /** Test-only native ownership counters used by long-running lifecycle fixtures. */
    resourceDiagnostics(): Readonly<{
        createdObjectCount: number;
        releasedNativeObjectCount: number;
        liveNativeObjectCount: number;
        peakNativeObjectCount: number;
    }> {
        return Object.freeze({
            createdObjectCount: this.createdObjectCount,
            releasedNativeObjectCount: this.releasedNativeObjectCount,
            liveNativeObjectCount: this.ownedObjects.size,
            peakNativeObjectCount: this.peakNativeObjectCount
        });
    }

    assertUsable(object: RHIDeviceOwnedObject): void {
        assertRHIObjectOwnedBy(this, object);
    }

    retain(object: RHIDeviceOwnedObject): void {
        this.assertUsable(object);
        if (!(object instanceof FakeDestroyableObject)) {
            throw new Error('fake backend received a non-fake object');
        }
        object.retainForFrame();
    }

    release(object: RHIDeviceOwnedObject): void {
        if (!(object instanceof FakeDestroyableObject)) {
            throw new Error('fake backend received a non-fake object');
        }
        object.releaseFromFrame();
    }

    createBuffer(descriptor: RHIBufferDescriptor): FakeRHIBuffer {
        this.assertAlive();
        return new FakeRHIBuffer(this, descriptor);
    }

    createQuerySet(descriptor: RHIQuerySetDescriptor): FakeRHIQuerySet {
        this.assertAlive();
        return new FakeRHIQuerySet(this, descriptor);
    }

    createTexture(descriptor: RHITextureDescriptor): FakeRHITexture {
        this.assertAlive();
        return new FakeRHITexture(this, descriptor);
    }

    createSampler(descriptor: RHISamplerDescriptor = {}): FakeRHISampler {
        this.assertAlive();
        return new FakeRHISampler(this, descriptor);
    }

    createShader(descriptor: RHIShaderDescriptor): FakeRHIShader {
        this.assertAlive();
        return new FakeRHIShader(this, descriptor);
    }

    createBindGroupLayout(descriptor: RHIBindGroupLayoutDescriptor): RHIBindGroupLayout {
        this.assertAlive();
        return new FakeBindGroupLayout(this, descriptor);
    }

    createPipelineLayout(descriptor: RHIPipelineLayoutDescriptor): RHIPipelineLayout {
        this.assertAlive();
        return new FakePipelineLayout(this, descriptor);
    }

    createBindGroup(descriptor: RHIBindGroupDescriptor): RHIBindGroup {
        this.assertAlive();
        return new FakeBindGroup(this, descriptor);
    }

    createGraphicsPipeline(descriptor: RHIGraphicsPipelineDescriptor): RHIGraphicsPipeline {
        this.assertAlive();
        return new FakeGraphicsPipeline(this, descriptor);
    }

    createComputePipeline(descriptor: RHIComputePipelineDescriptor): RHIComputePipeline {
        this.assertAlive();
        if (this.backend !== 'webgpu') {
            throw new RHIValidationError(
                'unsupported-feature',
                'fake WebGL2 does not support compute pipelines',
                'computePipeline'
            );
        }
        return new FakeComputePipeline(this, descriptor);
    }

    createSurface(canvas: HTMLCanvasElement): FakeRHISurface {
        this.assertAlive();
        return new FakeRHISurface(this, canvas);
    }

    /** Test-only recovery hook. Existing device-owned objects become stale. */
    advanceGeneration(reason: RHIDeviceLostReason = 'reset'): void {
        this.assertAlive();
        const previousGeneration = this.generation;
        this.currentGraphicsQueue.prepareForGenerationChange(
            new Error(`fake device generation ${String(previousGeneration)} was lost`)
        );
        this.generation++;
        for (const object of this.ownedObjects) object.invalidateNative();
        this.currentGraphicsQueue = new FakeRHIQueue(this);
        this.lostSignal.resolve({
            reason,
            message: 'fake device generation advanced',
            generation: previousGeneration
        });
    }

    destroy(): void {
        if (this.destroyed) return;
        this.currentGraphicsQueue.destroyQueue(new Error('fake device was destroyed'));
        this.destroyed = true;
        for (const object of this.ownedObjects) object.destroy();
        this.lostSignal.resolve({
            reason: 'destroyed',
            message: 'fake device destroyed',
            generation: this.generation
        });
    }

    private assertAlive(): void {
        if (this.destroyed) throw new Error('device is destroyed');
    }
}

export class FakeRHISurface extends FakeDestroyableObject implements RHISurface {
    private surfaceState: RHISurfaceState = 'unconfigured';
    private normalizedConfiguration: Readonly<RHINormalizedSurfaceConfiguration> | null = null;
    private currentTexture: FakeRHITexture | null = null;
    private depthStencilTexture: FakeRHITexture | null = null;

    constructor(
        owner: FakeRHIDevice,
        readonly canvas: HTMLCanvasElement
    ) {
        super(owner, 'fake surface');
    }

    get state(): RHISurfaceState {
        return this.surfaceState;
    }

    get configuration(): Readonly<RHINormalizedSurfaceConfiguration> | null {
        return this.normalizedConfiguration;
    }

    configure(configuration: RHISurfaceConfiguration): void {
        this.owner.assertUsable(this);
        if (this.surfaceState === 'acquired') {
            throw new RHIValidationError(
                'invalid-state',
                'cannot configure while a surface texture is acquired',
                'surface'
            );
        }
        if (this.owner.graphicsQueue.state === 'frame-open') {
            throw new RHIValidationError(
                'invalid-state',
                'cannot configure while a frame is open',
                'surface'
            );
        }
        const normalized = normalizeRHISurfaceConfiguration(configuration, this.owner.capabilities);
        const nextDepthStencilTexture =
            normalized.depthStencilFormat === null
                ? null
                : this.owner.createTexture({
                      label: 'fake surface depth/stencil',
                      lifetime: 'persistent',
                      size: { width: normalized.width, height: normalized.height },
                      format: normalized.depthStencilFormat,
                      usage: RHITextureUsage.RENDER_ATTACHMENT
                  });
        const previousDepthStencilTexture = this.depthStencilTexture;
        this.depthStencilTexture = nextDepthStencilTexture;
        this.normalizedConfiguration = normalized;
        this.surfaceState = 'configured';
        previousDepthStencilTexture?.destroy();
    }

    getCurrentTexture(): RHITexture {
        this.owner.assertUsable(this);
        if (this.surfaceState !== 'configured' || this.normalizedConfiguration === null) {
            throw new RHIValidationError(
                'invalid-state',
                `surface is ${this.surfaceState}`,
                'surface'
            );
        }
        this.currentTexture = this.owner.createTexture({
            label: 'fake surface texture',
            lifetime: 'frame',
            size: {
                width: this.normalizedConfiguration.width,
                height: this.normalizedConfiguration.height
            },
            format: this.normalizedConfiguration.format,
            usage: this.normalizedConfiguration.usage
        });
        this.surfaceState = 'acquired';
        return this.currentTexture;
    }

    getDepthStencilTexture(): RHITexture | null {
        this.owner.assertUsable(this);
        if (this.surfaceState !== 'configured' && this.surfaceState !== 'acquired') {
            throw new RHIValidationError(
                'invalid-state',
                `surface is ${this.surfaceState}`,
                'surface'
            );
        }
        return this.depthStencilTexture;
    }

    present(): void {
        this.owner.assertUsable(this);
        if (this.surfaceState !== 'acquired' || !this.currentTexture) {
            throw new RHIValidationError(
                'invalid-state',
                'surface has no acquired texture',
                'surface'
            );
        }
        if (this.owner.graphicsQueue.state === 'frame-open') {
            throw new RHIValidationError(
                'invalid-state',
                'cannot present before the frame ends',
                'surface'
            );
        }
        this.owner.fakeBackend.execute(`present:${String(this.id)}`);
        this.currentTexture.destroy();
        this.currentTexture = null;
        this.surfaceState = 'configured';
    }

    override destroy(): void {
        if (this.destroyed) return;
        this.currentTexture?.destroy();
        this.currentTexture = null;
        this.depthStencilTexture?.destroy();
        this.depthStencilTexture = null;
        this.normalizedConfiguration = null;
        this.surfaceState = 'destroyed';
        super.destroy();
    }
}

function validationFailure(code: RHIValidationErrorCode, message: string, path: string): never {
    throw new RHIValidationError(code, message, path);
}

function assertCopyRange(buffer: RHIBuffer, offset: number, size: number, path: string): void {
    assertFiniteInteger(offset, `${path} offset`);
    assertFiniteInteger(size, `${path} size`, 1);
    if (offset + size > buffer.size) {
        validationFailure('out-of-bounds', 'copy range exceeds buffer size', path);
    }
}

export class FakeRHICommandContext extends FakeDeviceObject implements RHICommandContext {
    readonly frameId: number;
    readonly diagnostics: RHIFrameDiagnostics;
    private contextState: RHICommandContextState = 'open';
    private activePass: FakeRHIRenderPass | FakeRHIComputePass | null = null;
    private readonly deferredCommands: FakeRHICommand[] = [];
    private readonly retainedObjects = new Set<RHIDeviceOwnedObject>();
    private externalImageUploadPhase = true;
    private debugGroupDepth = 0;

    constructor(
        readonly queue: FakeRHIQueue,
        descriptor: RHIFrameDescriptor = {}
    ) {
        super(queue.owner, descriptor.label ?? 'fake frame context');
        this.frameId = queue.owner.fakeBackend.allocateFrameId();
        this.diagnostics = createDiagnostics(descriptor.diagnostics);
    }

    get state(): RHICommandContextState {
        return this.contextState;
    }

    writeBuffer(
        destination: RHIBuffer,
        destinationOffset: number,
        data: RHIDataSource,
        dataOffset = 0,
        size?: number
    ): void {
        this.assertOpen();
        const snapshot = validateAndSnapshotRHIWriteBuffer(
            this,
            destination,
            destinationOffset,
            data,
            dataOffset,
            size
        );
        this.retainAll([destination]);
        const write = (): void => {
            if (destination instanceof FakeRHIBuffer) {
                destination.writeBytes(destinationOffset, snapshot);
            }
        };
        this.closeExternalImageUploadPhase();
        this.issue(
            `write-buffer:${String(destination.id)}:${String(destinationOffset)}:${String(snapshot.byteLength)}`,
            write
        );
    }

    writeTexture(
        destination: RHIImageCopyTexture,
        data: RHIDataSource,
        dataLayout: RHIImageDataLayout,
        writeSize: RHIExtent3D
    ): void {
        this.assertOpen();
        const snapshot = validateAndSnapshotRHIWriteTexture(
            this,
            destination,
            data,
            dataLayout,
            writeSize
        );
        const texture = destination.texture;
        this.retainAll([texture]);
        const write = (): void => {
            if (texture instanceof FakeRHITexture) texture.writeData(snapshot);
        };
        this.closeExternalImageUploadPhase();
        this.issue(`write-texture:${String(texture.id)}`, write);
    }

    copyExternalImageToTexture(
        source: RHIImageCopyExternalImage,
        destination: RHIImageCopyExternalImageToTexture,
        copySize: RHIExtent3D
    ): void {
        this.assertOpen();
        validateRHICommandCopyExternalImageToTexture(this, source, destination, copySize);
        if (!this.externalImageUploadPhase) {
            validationFailure(
                'invalid-state',
                'external-image copies must precede every other frame command',
                'context'
            );
        }
        this.retainAll([destination.texture]);
        this.issue(`copy-external-texture:${String(destination.texture.id)}`);
    }

    generateMipmaps(texture: RHITexture): void {
        this.assertOpen();
        validateRHICommandGenerateMipmaps(this, texture);
        this.retainAll([texture]);
        this.closeExternalImageUploadPhase();
        this.issue(`generate-mipmaps:${String(texture.id)}`);
    }

    beginRenderPass(descriptor: RHIRenderPassDescriptor): RHIRenderPassEncoder {
        this.assertOpen();
        validateRHITimestampWrites(
            this.owner,
            descriptor.timestampWrites,
            'renderPass.timestampWrites'
        );
        const normalizedDescriptor = snapshotRHIRenderPassDescriptor(this.owner, descriptor);
        const attachments: RHIDeviceOwnedObject[] = [];
        for (const attachment of normalizedDescriptor.colorAttachments) {
            if (!attachment) continue;
            attachments.push(attachment.view, attachment.view.texture);
            if (attachment.resolveTarget) {
                attachments.push(attachment.resolveTarget, attachment.resolveTarget.texture);
            }
        }
        if (normalizedDescriptor.depthStencilAttachment) {
            attachments.push(
                normalizedDescriptor.depthStencilAttachment.view,
                normalizedDescriptor.depthStencilAttachment.view.texture
            );
        }
        if (descriptor.timestampWrites !== undefined) {
            attachments.push(descriptor.timestampWrites.querySet);
        }
        this.closeExternalImageUploadPhase();
        this.retainAll(attachments);
        this.contextState = 'render-pass';
        const pass = new FakeRHIRenderPass(this, normalizedDescriptor);
        this.activePass = pass;
        this.issue(`render-pass:${normalizedDescriptor.label ?? ''}:begin`);
        return pass;
    }

    beginComputePass(descriptor: RHIComputePassDescriptor = {}): RHIComputePassEncoder {
        this.assertOpen();
        if (!this.owner.capabilities.features.has('compute-pipelines')) {
            validationFailure(
                'unsupported-feature',
                'compute passes are unsupported',
                'computePass'
            );
        }
        validateRHITimestampWrites(
            this.owner,
            descriptor.timestampWrites,
            'computePass.timestampWrites'
        );
        if (descriptor.timestampWrites !== undefined) {
            this.retainAll([descriptor.timestampWrites.querySet]);
        }
        this.closeExternalImageUploadPhase();
        this.contextState = 'compute-pass';
        const pass = new FakeRHIComputePass(this, descriptor.label ?? '');
        this.activePass = pass;
        this.issue(`compute-pass:${descriptor.label ?? ''}:begin`);
        return pass;
    }

    clearBuffer(buffer: RHIBuffer, offset = 0, size?: number): void {
        this.assertOpen();
        if (this.owner.backend !== 'webgpu') {
            validationFailure('unsupported-feature', 'clearBuffer is unsupported', 'clearBuffer');
        }
        const resolvedSize = validateRHIClearBuffer(
            this.owner,
            buffer,
            offset,
            size ?? buffer.size - offset
        );
        this.retainAll([buffer]);
        this.closeExternalImageUploadPhase();
        this.diagnostics.bufferClearCount++;
        this.issue(
            `clear-buffer:${String(buffer.id)}:${String(offset)}:${String(resolvedSize)}`,
            () => {
                if (buffer instanceof FakeRHIBuffer) buffer.clearBytes(offset, resolvedSize);
            }
        );
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
        this.retainAll([source, destination]);
        this.closeExternalImageUploadPhase();
        const copy = (): void => {
            if (source instanceof FakeRHIBuffer && destination instanceof FakeRHIBuffer) {
                destination.copyBytesFrom(source, sourceOffset, destinationOffset, size);
            }
        };
        this.issue(
            `copy-buffer:${String(source.id)}:${String(destination.id)}:${String(size)}`,
            copy
        );
    }

    copyBufferToTexture(
        source: RHIImageCopyBuffer,
        destination: RHIImageCopyTexture,
        copySize: RHIExtent3D
    ): void {
        this.assertOpen();
        validateRHICopyBufferToTexture(this, source, destination, copySize);
        this.retainAll([source.buffer, destination.texture]);
        this.closeExternalImageUploadPhase();
        this.issue(
            `copy-buffer-texture:${String(source.buffer.id)}:${String(destination.texture.id)}`
        );
    }

    copyTextureToBuffer(
        source: RHIImageCopyTexture,
        destination: RHIImageCopyBuffer,
        copySize: RHIExtent3D
    ): void {
        this.assertOpen();
        validateRHICopyTextureToBuffer(this, source, destination, copySize);
        this.retainAll([source.texture, destination.buffer]);
        this.closeExternalImageUploadPhase();
        this.issue(
            `copy-texture-buffer:${String(source.texture.id)}:${String(destination.buffer.id)}`
        );
    }

    copyTextureToTexture(
        source: RHIImageCopyTexture,
        destination: RHIImageCopyTexture,
        copySize: RHIExtent3D
    ): void {
        this.assertOpen();
        validateRHICopyTextureToTexture(this, source, destination, copySize);
        this.retainAll([source.texture, destination.texture]);
        this.closeExternalImageUploadPhase();
        this.issue(`copy-texture:${String(source.texture.id)}:${String(destination.texture.id)}`);
    }

    resolveQuerySet(
        querySet: RHIQuerySet,
        firstQuery: number,
        queryCount: number,
        destination: RHIBuffer,
        destinationOffset = 0
    ): void {
        this.assertOpen();
        validateRHIResolveQuerySet(
            this.owner,
            querySet,
            firstQuery,
            queryCount,
            destination,
            destinationOffset
        );
        this.retainAll([querySet, destination]);
        this.closeExternalImageUploadPhase();
        this.issue(
            `resolve-query-set:${String(querySet.id)}:${String(firstQuery)}:${String(queryCount)}`,
            () => {
                if (destination instanceof FakeRHIBuffer) {
                    destination.writeBytes(destinationOffset, new Uint8Array(queryCount * 8));
                }
            }
        );
    }

    pushDebugGroup(label: string): void {
        this.assertOpen();
        validateRHIDebugLabel(label, 'context.debugGroup');
        this.debugGroupDepth += 1;
    }

    popDebugGroup(): void {
        this.assertOpen();
        if (this.debugGroupDepth === 0) {
            validationFailure('invalid-state', 'context debug group stack is empty', 'context');
        }
        this.debugGroupDepth -= 1;
    }

    insertDebugMarker(label: string): void {
        this.assertOpen();
        validateRHIDebugLabel(label, 'context.debugMarker');
    }

    issue(label: string, apply?: () => void): void {
        this.diagnostics.commandCount++;
        if (this.owner.fakeBackend.executionMode === 'immediate') {
            try {
                this.owner.fakeBackend.execute(label, apply);
            } catch (error) {
                try {
                    this.queue.abortAfterExecutionFailure(this);
                } catch (cleanupError) {
                    void cleanupError;
                }
                throw error;
            }
        } else {
            this.deferredCommands.push(apply ? { label, apply } : { label });
        }
    }

    retainAll(objects: readonly RHIDeviceOwnedObject[]): void {
        for (const object of objects) this.owner.assertUsable(object);
        for (const object of objects) {
            if (this.retainedObjects.has(object)) continue;
            this.owner.retain(object);
            this.retainedObjects.add(object);
        }
    }

    closePass(pass: FakeRHIRenderPass): void {
        if (this.activePass !== pass || this.contextState !== 'render-pass') {
            validationFailure('invalid-state', 'render pass is not active', 'renderPass');
        }
        this.activePass = null;
        this.contextState = 'open';
    }

    closeComputePass(pass: FakeRHIComputePass): void {
        if (this.activePass !== pass || this.contextState !== 'compute-pass') {
            validationFailure('invalid-state', 'compute pass is not active', 'computePass');
        }
        this.activePass = null;
        this.contextState = 'open';
    }

    finishForSubmission(): {
        readonly commands: readonly FakeRHICommand[];
        readonly references: readonly RHIDeviceOwnedObject[];
    } {
        this.assertOpen();
        if (this.debugGroupDepth !== 0) {
            validationFailure('invalid-state', 'context has unclosed debug groups', 'context');
        }
        this.contextState = 'ended';
        return {
            commands: this.deferredCommands,
            references: [...this.retainedObjects]
        };
    }

    abort(): readonly RHIDeviceOwnedObject[] {
        if (this.contextState === 'ended' || this.contextState === 'aborted') {
            validationFailure(
                'invalid-state',
                `command context is ${this.contextState}`,
                'context'
            );
        }
        this.activePass?.abort();
        this.activePass = null;
        this.debugGroupDepth = 0;
        this.contextState = 'aborted';
        this.deferredCommands.length = 0;
        return [...this.retainedObjects];
    }

    private assertOpen(): void {
        this.owner.assertUsable(this);
        if (this.contextState !== 'open') {
            validationFailure(
                'invalid-state',
                `command context is ${this.contextState}`,
                'context'
            );
        }
    }

    private closeExternalImageUploadPhase(): void {
        this.externalImageUploadPhase = false;
    }
}

class FakeRHIRenderPass extends FakeDeviceObject implements RHIRenderPassEncoder {
    readonly contextId: number;
    readonly descriptor: Readonly<RHIRenderPassDescriptor>;
    private passState: RHIRenderPassState = 'open';
    private pipeline: RHIGraphicsPipeline | null = null;
    private readonly bindGroups = new Map<number, RHIBindGroup>();
    private readonly vertexBuffers = new Set<number>();
    private hasIndexBuffer = false;
    private debugGroupDepth = 0;

    constructor(
        readonly context: FakeRHICommandContext,
        descriptor: Readonly<RHIRenderPassDescriptor>
    ) {
        super(context.owner, descriptor.label ?? '');
        this.contextId = context.id;
        this.descriptor = descriptor;
    }

    get state(): RHIRenderPassState {
        return this.passState;
    }

    setPipeline(pipeline: RHIGraphicsPipeline): void {
        this.assertOpen();
        this.context.owner.assertUsable(pipeline);
        this.validatePipelineCompatibility(pipeline);
        this.context.retainAll([pipeline]);
        if (this.pipeline !== pipeline) this.context.diagnostics.pipelineSwitches++;
        this.pipeline = pipeline;
        this.context.issue(`pipeline:${String(pipeline.id)}`);
    }

    setBindGroup(index: number, bindGroup: RHIBindGroup, dynamicOffsets?: RHIUInt32View): void {
        this.assertOpen();
        assertFiniteInteger(index, 'bind group index');
        if (index >= this.context.owner.capabilities.limits.maxBindGroups) {
            validationFailure(
                'out-of-bounds',
                'bind group index exceeds device limit',
                'bindGroup'
            );
        }
        this.context.owner.assertUsable(bindGroup);
        if (this.pipeline) this.validateBindGroupLayout(index, bindGroup, this.pipeline);
        this.validateDynamicOffsets(bindGroup, dynamicOffsets);
        const objects: RHIDeviceOwnedObject[] = [bindGroup];
        if (bindGroup instanceof FakeBindGroup) objects.push(...bindGroup.referencedObjects());
        this.context.retainAll(objects);
        this.bindGroups.set(index, bindGroup);
        this.context.diagnostics.bindGroupSwitches++;
        this.context.issue(`bind-group:${String(index)}:${String(bindGroup.id)}`);
    }

    setVertexBuffer(
        slot: number,
        buffer: RHIBuffer,
        offset = 0,
        size = buffer.size - offset
    ): void {
        this.assertOpen();
        assertFiniteInteger(slot, 'vertex buffer slot');
        this.context.owner.assertUsable(buffer);
        if ((buffer.usage & RHIBufferUsage.VERTEX) === 0) {
            validationFailure('invalid-descriptor', 'buffer lacks VERTEX usage', 'buffer');
        }
        assertCopyRange(buffer, offset, size, 'vertex buffer');
        this.context.retainAll([buffer]);
        this.vertexBuffers.add(slot);
        this.context.diagnostics.vertexBufferSwitches++;
        this.context.issue(`vertex-buffer:${String(slot)}:${String(buffer.id)}`);
    }

    setVertexBufferRecord(record: Readonly<RHIVertexBufferBindingRecord>): void {
        const slot = record.slot;
        const buffer = record.buffer;
        const offset = record.offset;
        const size = record.size ?? buffer.size - offset;
        this.assertOpen();
        assertFiniteInteger(slot, 'vertex buffer slot');
        this.context.owner.assertUsable(buffer);
        if ((buffer.usage & RHIBufferUsage.VERTEX) === 0) {
            validationFailure('invalid-descriptor', 'buffer lacks VERTEX usage', 'buffer');
        }
        assertCopyRange(buffer, offset, size, 'vertex buffer');
        this.context.retainAll([buffer]);
        this.vertexBuffers.add(slot);
        this.context.diagnostics.vertexBufferSwitches++;
        this.context.issue(`vertex-buffer:${String(slot)}:${String(buffer.id)}`);
    }

    setIndexBuffer(
        buffer: RHIBuffer,
        format: RHIIndexFormat,
        offset = 0,
        size = buffer.size - offset
    ): void {
        this.assertOpen();
        this.context.owner.assertUsable(buffer);
        if ((buffer.usage & RHIBufferUsage.INDEX) === 0) {
            validationFailure('invalid-descriptor', 'buffer lacks INDEX usage', 'buffer');
        }
        assertCopyRange(buffer, offset, size, 'index buffer');
        this.context.retainAll([buffer]);
        this.hasIndexBuffer = true;
        this.context.issue(`index-buffer:${format}:${String(buffer.id)}`);
    }

    setIndexBufferRecord(record: Readonly<RHIIndexBufferBindingRecord>): void {
        const buffer = record.buffer;
        const format = record.format;
        const offset = record.offset;
        const size = record.size ?? buffer.size - offset;
        this.assertOpen();
        this.context.owner.assertUsable(buffer);
        if ((buffer.usage & RHIBufferUsage.INDEX) === 0) {
            validationFailure('invalid-descriptor', 'buffer lacks INDEX usage', 'buffer');
        }
        assertCopyRange(buffer, offset, size, 'index buffer');
        this.context.retainAll([buffer]);
        this.hasIndexBuffer = true;
        this.context.issue(`index-buffer:${format}:${String(buffer.id)}`);
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
        for (const [name, value] of Object.entries({ x, y, width, height, minDepth, maxDepth })) {
            if (!Number.isFinite(value))
                validationFailure('invalid-descriptor', 'must be finite', name);
        }
        this.context.issue('viewport');
    }

    setViewportRecord(viewport: Readonly<RHIViewport>): void {
        this.assertOpen();
        if (
            !Number.isFinite(viewport.x) ||
            !Number.isFinite(viewport.y) ||
            !Number.isFinite(viewport.width) ||
            !Number.isFinite(viewport.height) ||
            !Number.isFinite(viewport.minDepth) ||
            !Number.isFinite(viewport.maxDepth)
        ) {
            validationFailure('invalid-descriptor', 'must be finite', 'viewport');
        }
        this.context.issue('viewport');
    }

    setScissorRect(x: number, y: number, width: number, height: number): void {
        this.assertOpen();
        assertFiniteInteger(x, 'scissor x');
        assertFiniteInteger(y, 'scissor y');
        assertFiniteInteger(width, 'scissor width', 1);
        assertFiniteInteger(height, 'scissor height', 1);
        this.context.issue('scissor');
    }

    setScissorRectRecord(rect: Readonly<RHIRect>): void {
        this.assertOpen();
        assertFiniteInteger(rect.x, 'scissor x');
        assertFiniteInteger(rect.y, 'scissor y');
        assertFiniteInteger(rect.width, 'scissor width', 1);
        assertFiniteInteger(rect.height, 'scissor height', 1);
        this.context.issue('scissor');
    }

    setBlendConstant(color: RHIColor): void {
        this.assertOpen();
        for (const value of Object.values(color)) {
            if (!Number.isFinite(value)) {
                validationFailure('invalid-descriptor', 'blend color must be finite', 'color');
            }
        }
        this.context.issue('blend-constant');
    }

    setStencilReference(reference: number): void {
        this.assertOpen();
        assertFiniteInteger(reference, 'stencil reference');
        this.context.issue('stencil-reference');
    }

    draw(vertexCount: number, instanceCount = 1, firstVertex = 0, firstInstance = 0): void {
        this.assertOpen();
        const pipeline = this.assertPipeline();
        assertFiniteInteger(vertexCount, 'vertex count', 1);
        assertFiniteInteger(instanceCount, 'instance count', 1);
        assertFiniteInteger(firstVertex, 'first vertex');
        assertFiniteInteger(firstInstance, 'first instance');
        if (
            firstInstance !== 0 &&
            !this.context.owner.capabilities.features.has('draw-first-instance')
        ) {
            validationFailure(
                'unsupported-feature',
                'first instance is unsupported',
                'firstInstance'
            );
        }
        this.assertRequiredBindings(pipeline);
        this.context.diagnostics.drawCount++;
        this.context.issue(`draw:${String(vertexCount)}`);
    }

    drawRecord(record: Readonly<RHIDrawArgumentsRecord>): void {
        const vertexCount = record.elementCount;
        const instanceCount = record.instanceCount;
        const firstVertex = record.firstElement;
        const firstInstance = record.firstInstance;
        this.assertOpen();
        const pipeline = this.assertPipeline();
        assertFiniteInteger(vertexCount, 'vertex count', 1);
        assertFiniteInteger(instanceCount, 'instance count', 1);
        assertFiniteInteger(firstVertex, 'first vertex');
        assertFiniteInteger(firstInstance, 'first instance');
        if (
            firstInstance !== 0 &&
            !this.context.owner.capabilities.features.has('draw-first-instance')
        ) {
            validationFailure(
                'unsupported-feature',
                'first instance is unsupported',
                'firstInstance'
            );
        }
        this.assertRequiredBindings(pipeline);
        this.context.diagnostics.drawCount++;
        this.context.issue(`draw:${String(vertexCount)}`);
    }

    drawIndexed(
        indexCount: number,
        instanceCount = 1,
        firstIndex = 0,
        baseVertex = 0,
        firstInstance = 0
    ): void {
        this.assertOpen();
        const pipeline = this.assertPipeline();
        assertFiniteInteger(indexCount, 'index count', 1);
        assertFiniteInteger(instanceCount, 'instance count', 1);
        assertFiniteInteger(firstIndex, 'first index');
        if (!Number.isSafeInteger(baseVertex)) {
            validationFailure('invalid-descriptor', 'base vertex must be an integer', 'baseVertex');
        }
        assertFiniteInteger(firstInstance, 'first instance');
        if (baseVertex !== 0 && !this.context.owner.capabilities.features.has('draw-base-vertex')) {
            validationFailure('unsupported-feature', 'base vertex is unsupported', 'baseVertex');
        }
        if (
            firstInstance !== 0 &&
            !this.context.owner.capabilities.features.has('draw-first-instance')
        ) {
            validationFailure(
                'unsupported-feature',
                'first instance is unsupported',
                'firstInstance'
            );
        }
        this.assertRequiredBindings(pipeline);
        if (!this.hasIndexBuffer) {
            validationFailure(
                'invalid-state',
                'drawIndexed requires an index buffer',
                'indexBuffer'
            );
        }
        this.context.diagnostics.drawCount++;
        this.context.issue(`draw-indexed:${String(indexCount)}`);
    }

    drawIndexedRecord(record: Readonly<RHIDrawArgumentsRecord>): void {
        const indexCount = record.elementCount;
        const instanceCount = record.instanceCount;
        const firstIndex = record.firstElement;
        const baseVertex = record.baseVertex;
        const firstInstance = record.firstInstance;
        this.assertOpen();
        const pipeline = this.assertPipeline();
        assertFiniteInteger(indexCount, 'index count', 1);
        assertFiniteInteger(instanceCount, 'instance count', 1);
        assertFiniteInteger(firstIndex, 'first index');
        if (!Number.isSafeInteger(baseVertex)) {
            validationFailure('invalid-descriptor', 'base vertex must be an integer', 'baseVertex');
        }
        assertFiniteInteger(firstInstance, 'first instance');
        if (baseVertex !== 0 && !this.context.owner.capabilities.features.has('draw-base-vertex')) {
            validationFailure('unsupported-feature', 'base vertex is unsupported', 'baseVertex');
        }
        if (
            firstInstance !== 0 &&
            !this.context.owner.capabilities.features.has('draw-first-instance')
        ) {
            validationFailure(
                'unsupported-feature',
                'first instance is unsupported',
                'firstInstance'
            );
        }
        this.assertRequiredBindings(pipeline);
        if (!this.hasIndexBuffer) {
            validationFailure(
                'invalid-state',
                'drawIndexed requires an index buffer',
                'indexBuffer'
            );
        }
        this.context.diagnostics.drawCount++;
        this.context.issue(`draw-indexed:${String(indexCount)}`);
    }

    drawIndirect(buffer: RHIBuffer, offset = 0): void {
        this.assertOpen();
        const pipeline = this.assertPipeline();
        this.assertRequiredBindings(pipeline);
        validateRHIDrawIndirect(this.context.owner, buffer, offset, false);
        this.context.retainAll([buffer]);
        this.context.diagnostics.drawCount++;
        this.context.diagnostics.indirectDrawCount++;
        this.context.issue(`draw-indirect:${String(buffer.id)}:${String(offset)}`);
    }

    drawIndexedIndirect(buffer: RHIBuffer, offset = 0): void {
        this.assertOpen();
        const pipeline = this.assertPipeline();
        this.assertRequiredBindings(pipeline);
        if (!this.hasIndexBuffer) {
            validationFailure(
                'invalid-state',
                'drawIndexedIndirect requires an index buffer',
                'indexBuffer'
            );
        }
        validateRHIDrawIndirect(this.context.owner, buffer, offset, true);
        this.context.retainAll([buffer]);
        this.context.diagnostics.drawCount++;
        this.context.diagnostics.indirectDrawCount++;
        this.context.issue(`draw-indexed-indirect:${String(buffer.id)}:${String(offset)}`);
    }

    pushDebugGroup(label: string): void {
        this.assertOpen();
        validateRHIDebugLabel(label, 'renderPass.debugGroup');
        this.debugGroupDepth += 1;
    }

    popDebugGroup(): void {
        this.assertOpen();
        if (this.debugGroupDepth === 0) {
            validationFailure(
                'invalid-state',
                'render pass debug group stack is empty',
                'renderPass'
            );
        }
        this.debugGroupDepth -= 1;
    }

    insertDebugMarker(label: string): void {
        this.assertOpen();
        validateRHIDebugLabel(label, 'renderPass.debugMarker');
    }

    end(): void {
        this.assertOpen();
        if (this.debugGroupDepth !== 0) {
            validationFailure(
                'invalid-state',
                'render pass has unclosed debug groups',
                'renderPass'
            );
        }
        this.context.issue('render-pass:end');
        this.passState = 'ended';
        this.context.closePass(this);
    }

    abort(): void {
        if (this.passState === 'open') {
            this.passState = 'aborted';
            this.debugGroupDepth = 0;
        }
    }

    private assertOpen(): void {
        this.context.owner.assertUsable(this);
        if (this.passState !== 'open' || this.context.state !== 'render-pass') {
            validationFailure('invalid-state', `render pass is ${this.passState}`, 'renderPass');
        }
    }

    private assertPipeline(): RHIGraphicsPipeline {
        if (!this.pipeline) {
            validationFailure('invalid-state', 'draw requires a graphics pipeline', 'renderPass');
        }
        return this.pipeline;
    }

    private validatePipelineCompatibility(pipeline: RHIGraphicsPipeline): void {
        const targets = pipeline.descriptor.fragment?.targets ?? [];
        const attachments = this.descriptor.colorAttachments;
        for (let index = 0; index < targets.length; index += 1) {
            const target = targets[index];
            if (target === null || target === undefined) continue;
            const attachment = attachments[index];
            if (attachment === null || attachment === undefined) {
                validationFailure(
                    'incompatible-layout',
                    'pipeline writes a color target with no render-pass attachment',
                    `pipeline.fragment.targets[${String(index)}]`
                );
            }
            if (target.format !== attachment.view.format) {
                validationFailure(
                    'incompatible-layout',
                    'pipeline color target format does not match render pass',
                    `pipeline.fragment.targets[${String(index)}].format`
                );
            }
        }

        const firstAttachment =
            attachments.find(attachment => attachment !== null)?.view ??
            this.descriptor.depthStencilAttachment?.view;
        const passSampleCount = firstAttachment?.texture.sampleCount ?? 1;
        const pipelineSampleCount = pipeline.descriptor.multisample?.count ?? 1;
        if (pipelineSampleCount !== passSampleCount) {
            validationFailure(
                'incompatible-layout',
                'pipeline sample count does not match render pass',
                'pipeline.multisample.count'
            );
        }

        const pipelineDepthStencil = pipeline.descriptor.depthStencil;
        if (pipelineDepthStencil !== undefined) {
            const attachment = this.descriptor.depthStencilAttachment;
            if (attachment === undefined) {
                validationFailure(
                    'incompatible-layout',
                    'pipeline requires a depth/stencil attachment',
                    'pipeline.depthStencil'
                );
            }
            if (pipelineDepthStencil.format !== attachment.view.format) {
                validationFailure(
                    'incompatible-layout',
                    'pipeline depth/stencil format does not match render pass',
                    'pipeline.depthStencil.format'
                );
            }
        }
        validateRHIRenderPassPipelineDepthStencilAccess(this.descriptor, pipeline.descriptor);
    }

    private validateBindGroupLayout(
        index: number,
        bindGroup: RHIBindGroup,
        pipeline: RHIGraphicsPipeline
    ): void {
        const expectedLayout = pipeline.descriptor.layout.bindGroupLayouts[index];
        if (expectedLayout === undefined || expectedLayout !== bindGroup.layout) {
            validationFailure(
                'incompatible-layout',
                'bind group layout does not match pipeline',
                `bindGroup[${String(index)}]`
            );
        }
    }

    private validateDynamicOffsets(
        bindGroup: RHIBindGroup,
        dynamicOffsets: RHIUInt32View | undefined
    ): void {
        const dynamicEntries = bindGroup.layout.entries
            .filter(entry => entry.buffer?.hasDynamicOffset === true)
            .sort((first, second) => first.binding - second.binding);
        const offsets = dynamicOffsets ?? new Uint32Array(0);
        if (offsets.length !== dynamicEntries.length) {
            validationFailure(
                'incompatible-layout',
                'dynamic offset count does not match bind group layout',
                'dynamicOffsets'
            );
        }

        for (let index = 0; index < dynamicEntries.length; index += 1) {
            const layoutEntry = dynamicEntries[index];
            const dynamicOffset = offsets[index];
            if (layoutEntry === undefined || dynamicOffset === undefined) continue;
            assertFiniteInteger(dynamicOffset, `dynamic offset ${String(index)}`);
            const bindGroupEntry = bindGroup.entries.find(
                entry => entry.binding === layoutEntry.binding
            );
            if (bindGroupEntry === undefined || !('buffer' in bindGroupEntry.resource)) {
                validationFailure(
                    'incompatible-layout',
                    'dynamic binding has no buffer resource',
                    `bindGroup.binding[${String(layoutEntry.binding)}]`
                );
            }
            const resource = bindGroupEntry.resource;
            const bufferType = layoutEntry.buffer?.type ?? 'uniform';
            const alignment =
                bufferType === 'uniform'
                    ? this.context.owner.capabilities.limits.minUniformBufferOffsetAlignment
                    : this.context.owner.capabilities.limits.minStorageBufferOffsetAlignment;
            if (alignment === undefined || dynamicOffset % alignment !== 0) {
                validationFailure(
                    'invalid-descriptor',
                    'dynamic offset does not meet device alignment',
                    `dynamicOffsets[${String(index)}]`
                );
            }
            const baseOffset = resource.offset ?? 0;
            const size = resource.size ?? resource.buffer.size - baseOffset;
            const effectiveOffset = baseOffset + dynamicOffset;
            if (!Number.isSafeInteger(effectiveOffset)) {
                validationFailure(
                    'out-of-bounds',
                    'dynamic buffer offset exceeds the safe integer range',
                    `dynamicOffsets[${String(index)}]`
                );
            }
            if (effectiveOffset + size > resource.buffer.size) {
                validationFailure(
                    'out-of-bounds',
                    'dynamic buffer binding exceeds buffer size',
                    `dynamicOffsets[${String(index)}]`
                );
            }
        }
    }

    private assertRequiredBindings(pipeline: RHIGraphicsPipeline): void {
        const requiredBindGroups = new Set<number>();
        for (const binding of pipeline.descriptor.vertex.shader.artifact.reflection.bindings) {
            requiredBindGroups.add(binding.group);
        }
        for (const binding of pipeline.descriptor.fragment?.shader.artifact.reflection.bindings ??
            []) {
            requiredBindGroups.add(binding.group);
        }
        for (const index of requiredBindGroups) {
            const bindGroup = this.bindGroups.get(index);
            if (bindGroup === undefined) {
                validationFailure(
                    'invalid-state',
                    'draw requires all pipeline bind groups',
                    `bindGroup[${String(index)}]`
                );
            }
            this.validateBindGroupLayout(index, bindGroup, pipeline);
        }

        const vertexInputs = new Set(
            (pipeline.descriptor.vertex.shader.artifact.reflection.vertexInputs ?? []).map(
                input => input.location
            )
        );
        for (let slot = 0; slot < (pipeline.descriptor.vertex.buffers?.length ?? 0); slot += 1) {
            const layout = pipeline.descriptor.vertex.buffers?.[slot];
            const isUsed = layout?.attributes.some(attribute =>
                vertexInputs.has(attribute.shaderLocation)
            );
            if (isUsed === true && !this.vertexBuffers.has(slot)) {
                validationFailure(
                    'invalid-state',
                    'draw requires all pipeline vertex buffers',
                    `vertexBuffer[${String(slot)}]`
                );
            }
        }
    }
}

class FakeRHIComputePass extends FakeDeviceObject implements RHIComputePassEncoder {
    readonly contextId: number;
    private passState: RHIComputePassState = 'open';
    private pipeline: RHIComputePipeline | null = null;
    private readonly bindGroups = new Map<number, RHIBindGroup>();
    private debugGroupDepth = 0;

    constructor(
        readonly context: FakeRHICommandContext,
        label: string
    ) {
        super(context.owner, label);
        this.contextId = context.id;
    }

    get state(): RHIComputePassState {
        return this.passState;
    }

    setPipeline(pipeline: RHIComputePipeline): void {
        this.assertOpen();
        this.context.owner.assertUsable(pipeline);
        if (!(pipeline instanceof FakeComputePipeline)) {
            validationFailure('wrong-device', 'expected a fake compute pipeline', 'pipeline');
        }
        this.context.retainAll([pipeline]);
        if (this.pipeline !== pipeline) {
            this.context.diagnostics.pipelineSwitches++;
            this.context.diagnostics.computePipelineSwitches++;
        }
        this.pipeline = pipeline;
        this.context.issue(`compute-pipeline:${String(pipeline.id)}`);
    }

    setBindGroup(index: number, bindGroup: RHIBindGroup, dynamicOffsets?: RHIUInt32View): void {
        this.assertOpen();
        assertFiniteInteger(index, 'bind group index');
        if (index >= this.context.owner.capabilities.limits.maxBindGroups) {
            validationFailure(
                'out-of-bounds',
                'bind group index exceeds device limit',
                'bindGroup'
            );
        }
        this.context.owner.assertUsable(bindGroup);
        if (this.pipeline !== null) this.validateBindGroupLayout(index, bindGroup, this.pipeline);
        this.validateDynamicOffsets(bindGroup, dynamicOffsets);
        const objects: RHIDeviceOwnedObject[] = [bindGroup];
        if (bindGroup instanceof FakeBindGroup) objects.push(...bindGroup.referencedObjects());
        this.context.retainAll(objects);
        this.bindGroups.set(index, bindGroup);
        this.context.diagnostics.bindGroupSwitches++;
        this.context.diagnostics.computeBindGroupSwitches++;
        this.context.issue(`compute-bind-group:${String(index)}:${String(bindGroup.id)}`);
    }

    dispatchWorkgroups(x: number, y = 1, z = 1): void {
        this.assertOpen();
        this.assertPipelineAndBindings();
        validateRHIDispatchWorkgroups(this.context.owner, x, y, z);
        this.context.diagnostics.dispatchCount++;
        this.context.diagnostics.dispatchedWorkgroupCount += x * y * z;
        this.context.issue(`dispatch:${String(x)}:${String(y)}:${String(z)}`);
    }

    dispatchWorkgroupsIndirect(buffer: RHIBuffer, offset = 0): void {
        this.assertOpen();
        this.assertPipelineAndBindings();
        validateRHIDispatchWorkgroupsIndirect(this.context.owner, buffer, offset);
        this.context.retainAll([buffer]);
        this.context.diagnostics.dispatchCount++;
        this.context.issue(`dispatch-indirect:${String(buffer.id)}:${String(offset)}`);
    }

    pushDebugGroup(label: string): void {
        this.assertOpen();
        validateRHIDebugLabel(label, 'computePass.debugGroup');
        this.debugGroupDepth += 1;
    }

    popDebugGroup(): void {
        this.assertOpen();
        if (this.debugGroupDepth === 0) {
            validationFailure(
                'invalid-state',
                'compute pass debug group stack is empty',
                'computePass'
            );
        }
        this.debugGroupDepth -= 1;
    }

    insertDebugMarker(label: string): void {
        this.assertOpen();
        validateRHIDebugLabel(label, 'computePass.debugMarker');
    }

    end(): void {
        this.assertOpen();
        if (this.debugGroupDepth !== 0) {
            validationFailure(
                'invalid-state',
                'compute pass has unclosed debug groups',
                'computePass'
            );
        }
        this.context.issue('compute-pass:end');
        this.passState = 'ended';
        this.pipeline = null;
        this.context.closeComputePass(this);
    }

    abort(): void {
        if (this.passState === 'open') {
            this.passState = 'aborted';
            this.pipeline = null;
            this.debugGroupDepth = 0;
        }
    }

    private assertOpen(): void {
        this.context.owner.assertUsable(this);
        if (this.passState !== 'open' || this.context.state !== 'compute-pass') {
            validationFailure('invalid-state', `compute pass is ${this.passState}`, 'computePass');
        }
    }

    private validateBindGroupLayout(
        index: number,
        bindGroup: RHIBindGroup,
        pipeline: RHIComputePipeline
    ): void {
        if (pipeline.layout.bindGroupLayouts[index] !== bindGroup.layout) {
            validationFailure(
                'incompatible-layout',
                'bind group layout does not match pipeline',
                `bindGroup[${String(index)}]`
            );
        }
    }

    private validateDynamicOffsets(
        bindGroup: RHIBindGroup,
        dynamicOffsets: RHIUInt32View | undefined
    ): void {
        const dynamicEntries = bindGroup.layout.entries
            .filter(entry => entry.buffer?.hasDynamicOffset === true)
            .sort((first, second) => first.binding - second.binding);
        const count = dynamicOffsets?.length ?? 0;
        if (count !== dynamicEntries.length) {
            validationFailure(
                'incompatible-layout',
                'dynamic offset count does not match bind group layout',
                'dynamicOffsets'
            );
        }
        for (let index = 0; index < dynamicEntries.length; index += 1) {
            const layoutEntry = dynamicEntries[index];
            const dynamicOffset = dynamicOffsets?.[index];
            if (layoutEntry === undefined || dynamicOffset === undefined) continue;
            const resource = bindGroup.entries.find(
                entry => entry.binding === layoutEntry.binding
            )?.resource;
            if (resource === undefined || !('buffer' in resource)) {
                validationFailure(
                    'incompatible-layout',
                    'dynamic binding has no buffer resource',
                    `bindGroup.binding[${String(layoutEntry.binding)}]`
                );
            }
            const bufferType = layoutEntry.buffer?.type ?? 'uniform';
            const alignment =
                bufferType === 'uniform'
                    ? this.context.owner.capabilities.limits.minUniformBufferOffsetAlignment
                    : this.context.owner.capabilities.limits.minStorageBufferOffsetAlignment;
            if (alignment === undefined || dynamicOffset % alignment !== 0) {
                validationFailure(
                    'invalid-descriptor',
                    'dynamic offset does not meet device alignment',
                    `dynamicOffsets[${String(index)}]`
                );
            }
            const baseOffset = resource.offset ?? 0;
            const size = resource.size ?? resource.buffer.size - baseOffset;
            if (baseOffset + dynamicOffset + size > resource.buffer.size) {
                validationFailure(
                    'out-of-bounds',
                    'dynamic buffer binding exceeds buffer size',
                    `dynamicOffsets[${String(index)}]`
                );
            }
        }
    }

    private assertPipelineAndBindings(): RHIComputePipeline {
        const pipeline = this.pipeline;
        if (pipeline === null) {
            return validationFailure(
                'invalid-state',
                'dispatch requires a compute pipeline',
                'pipeline'
            );
        }
        const requiredBindGroups = new Set<number>();
        for (const binding of pipeline.descriptor.compute.shader.artifact.reflection.bindings) {
            requiredBindGroups.add(binding.group);
        }
        for (const index of requiredBindGroups) {
            const bindGroup = this.bindGroups.get(index);
            if (bindGroup === undefined) {
                validationFailure(
                    'invalid-state',
                    'dispatch requires all pipeline bind groups',
                    `bindGroup[${String(index)}]`
                );
            }
            this.validateBindGroupLayout(index, bindGroup, pipeline);
        }
        return pipeline;
    }
}

export class FakeRHISubmission extends FakeDeviceObject implements RHISubmission {
    readonly frameId: number;
    readonly done: Promise<void>;
    private submissionStatus: RHISubmissionStatus = 'pending';
    private submissionError: unknown;
    private readonly completion = deferred<undefined>();
    private released = false;

    constructor(
        readonly queue: FakeRHIQueue,
        frameId: number,
        private readonly references: readonly RHIDeviceOwnedObject[]
    ) {
        super(queue.owner, `fake submission ${String(frameId)}`);
        this.frameId = frameId;
        this.done = this.completion.promise;
        void this.done.catch(() => undefined);
    }

    get status(): RHISubmissionStatus {
        return this.submissionStatus;
    }

    get error(): unknown {
        return this.submissionError;
    }

    succeed(): void {
        if (this.submissionStatus !== 'pending') return;
        this.submissionStatus = 'succeeded';
        this.releaseReferences();
        this.queue.forgetSubmission(this);
        this.completion.resolve(undefined);
    }

    fail(reason: unknown): void {
        if (this.submissionStatus !== 'pending') return;
        this.submissionStatus = 'failed';
        this.submissionError = reason;
        this.releaseReferences();
        this.queue.forgetSubmission(this);
        this.completion.reject(reason);
    }

    private releaseReferences(): void {
        if (this.released) return;
        this.released = true;
        for (const object of this.references) this.owner.release(object);
    }
}

export class FakeRHIQueue extends FakeDeviceObject implements RHIQueue {
    private queueState: RHIQueueState = 'idle';
    private activeContext: FakeRHICommandContext | null = null;
    private readonly pendingSubmissions = new Set<FakeRHISubmission>();

    constructor(owner: FakeRHIDevice) {
        super(owner, 'fake graphics queue');
    }

    get state(): RHIQueueState {
        return this.queueState;
    }

    beginFrame(descriptor: RHIFrameDescriptor = {}): FakeRHICommandContext {
        this.owner.assertUsable(this);
        if (this.queueState !== 'idle') {
            validationFailure('invalid-state', `queue is ${this.queueState}`, 'queue');
        }
        const context = new FakeRHICommandContext(this, descriptor);
        this.activeContext = context;
        this.queueState = 'frame-open';
        return context;
    }

    endFrame(context: RHICommandContext): FakeRHISubmission {
        const fakeContext = this.assertActiveContext(context);
        const finished = fakeContext.finishForSubmission();
        if (this.owner.fakeBackend.executionMode === 'deferred') {
            try {
                for (const command of finished.commands) {
                    this.owner.fakeBackend.execute(command.label, command.apply);
                }
            } catch (error) {
                for (const object of finished.references) this.owner.release(object);
                this.activeContext = null;
                this.queueState = 'idle';
                throw error;
            }
        }
        const submission = new FakeRHISubmission(this, context.frameId, finished.references);
        this.pendingSubmissions.add(submission);
        this.owner.fakeBackend.registerSubmission(submission);
        this.activeContext = null;
        this.queueState = 'idle';
        if (this.owner.fakeBackend.executionMode === 'immediate') submission.succeed();
        return submission;
    }

    abortFrame(context: RHICommandContext, _reason?: unknown): void {
        const fakeContext = this.assertActiveContext(context);
        const references = fakeContext.abort();
        for (const object of references) this.owner.release(object);
        this.activeContext = null;
        this.queueState = 'idle';
    }

    abortAfterExecutionFailure(context: FakeRHICommandContext): void {
        if (context !== this.activeContext) return;
        try {
            const references = context.abort();
            for (const object of references) this.owner.release(object);
        } finally {
            this.activeContext = null;
            this.queueState = 'idle';
        }
    }

    onSubmittedWorkDone(submission?: RHISubmission): Promise<void> {
        if (submission) {
            if (!(submission instanceof FakeRHISubmission) || submission.queue !== this) {
                return Promise.reject(new Error('submission belongs to another queue'));
            }
            return submission.done;
        }
        return Promise.all([...this.pendingSubmissions].map(item => item.done)).then(
            () => undefined
        );
    }

    prepareForGenerationChange(reason: unknown): void {
        if (this.activeContext) this.abortFrame(this.activeContext, 'device generation changed');
        this.failPendingSubmissions(reason);
        this.queueState = 'lost';
    }

    destroyQueue(reason: unknown): void {
        if (this.activeContext) this.abortFrame(this.activeContext, 'device destroyed');
        this.failPendingSubmissions(reason);
        this.queueState = 'destroyed';
    }

    pendingSubmission(): FakeRHISubmission | undefined {
        return this.pendingSubmissions.values().next().value;
    }

    forgetSubmission(submission: FakeRHISubmission): void {
        this.pendingSubmissions.delete(submission);
        this.owner.fakeBackend.forgetSubmission(submission);
    }

    private assertActiveContext(context: RHICommandContext): FakeRHICommandContext {
        this.owner.assertUsable(this);
        if (
            this.queueState !== 'frame-open' ||
            !(context instanceof FakeRHICommandContext) ||
            context !== this.activeContext ||
            context.queue !== this
        ) {
            validationFailure('invalid-state', 'context is not the active frame', 'context');
        }
        return context;
    }

    private failPendingSubmissions(reason: unknown): void {
        for (const submission of [...this.pendingSubmissions]) submission.fail(reason);
    }
}

export class FakeRHIBackend {
    readonly executionLog: string[] = [];
    private nextObjectId = 1;
    private nextFrameId = 1;
    private readonly devices: FakeRHIDevice[] = [];
    private readonly pendingSubmissions = new Set<FakeRHISubmission>();
    private nextExecutionFailure: Error | undefined;

    constructor(
        readonly backend: RHIBackend,
        readonly executionMode: FakeRHIExecutionMode
    ) {
        if (
            (backend === 'webgl2' && executionMode !== 'immediate') ||
            (backend === 'webgpu' && executionMode !== 'deferred')
        ) {
            throw new Error(`fake ${backend} must use its contract execution mode`);
        }
    }

    get executeCount(): number {
        return this.executionLog.length;
    }

    createDevice(): FakeRHIDevice {
        const device = new FakeRHIDevice(this);
        this.devices.push(device);
        return device;
    }

    allocateId(): number {
        return this.nextObjectId++;
    }

    allocateFrameId(): number {
        return this.nextFrameId++;
    }

    execute(command: string, apply?: () => void): void {
        if (this.nextExecutionFailure !== undefined) {
            const failure = this.nextExecutionFailure;
            this.nextExecutionFailure = undefined;
            throw failure;
        }
        apply?.();
        this.executionLog.push(command);
    }

    registerSubmission(submission: FakeRHISubmission): void {
        this.pendingSubmissions.add(submission);
    }

    forgetSubmission(submission: FakeRHISubmission): void {
        this.pendingSubmissions.delete(submission);
    }

    completeNextSubmission(): FakeRHISubmission {
        const submission = this.pendingSubmissions.values().next().value;
        if (!submission) throw new Error('fake backend has no pending submission');
        submission.succeed();
        return submission;
    }

    resetExecutionLog(): void {
        this.executionLog.length = 0;
    }

    failNextExecute(reason: unknown): void {
        this.nextExecutionFailure =
            reason instanceof Error
                ? reason
                : new Error(`fake execution failure: ${String(reason)}`);
    }

    destroy(): void {
        for (const device of this.devices) device.destroy();
        for (const submission of [...this.pendingSubmissions]) {
            submission.fail(new Error('fake backend was destroyed'));
        }
    }
}

/** Reference fake for WebGL's synchronous immediate command contract. */
export class FakeWebGLRHIBackend extends FakeRHIBackend {
    constructor() {
        super('webgl2', 'immediate');
    }
}

/** Reference fake for WebGPU's deferred encoding and asynchronous completion contract. */
export class FakeWebGPURHIBackend extends FakeRHIBackend {
    constructor() {
        super('webgpu', 'deferred');
    }
}
