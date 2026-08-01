import type { RHICapabilities } from '../../core/RHICapabilities';
import { normalizeRHIQuerySetDescriptor } from '../../core/RHIQueryValidation';
import {
    allocateRHIDeviceId,
    createRHIObjectIdAllocator,
    type RHIObjectIdAllocator
} from '../../core/RHIIdentity';
import type {
    RHIBindGroupDescriptor,
    RHIBindGroupLayoutDescriptor,
    RHIComputePipelineDescriptor,
    RHIGraphicsPipelineDescriptor,
    RHIPipelineLayoutDescriptor
} from '../../core/RHIPipeline';
import type {
    RHIBufferDescriptor,
    RHIDevice,
    RHIDeviceLostInfo,
    RHIDeviceOwnedObject,
    RHIGraphicsShaderArtifactInput,
    RHIQuerySetDescriptor,
    RHISamplerDescriptor,
    RHIShaderDescriptor,
    RHITextureDescriptor
} from '../../core/RHIResources';
import { RHICacheCounter } from '../../core/RHICacheDiagnostics';
import type { RHISurface } from '../../core/RHISurface';
import {
    RHIValidationError,
    normalizeRHIBufferDescriptor,
    normalizeRHISamplerDescriptor,
    normalizeRHIShaderDescriptor,
    normalizeRHITextureDescriptor,
    snapshotRHIBindGroupDescriptor,
    snapshotRHIBindGroupLayoutDescriptor,
    snapshotRHIComputePipelineDescriptor,
    snapshotRHIDataSource,
    snapshotRHIGraphicsPipelineDescriptor,
    snapshotRHIPipelineLayoutDescriptor
} from '../../core/RHIValidation';
import {
    WEBGPU_DESTROYED_STATE,
    type WebGPUDestroyableObject,
    createWebGPUDeferred,
    type WebGPUDeferred,
    type WebGPUNativeLifetimeDiagnostics,
    type WebGPUObjectOwner
} from './WebGPUBase';
import { WebGPUCapabilities } from './WebGPUCapabilities';
import { nativeWebGPUSamplerDescriptor, nativeWebGPUTextureDescriptor } from './WebGPUDescriptors';
import {
    WebGPUBindGroup,
    WebGPUBindGroupLayout,
    WebGPUComputePipeline,
    WebGPUGraphicsPipeline,
    WebGPUPipelineLayout,
    nativeWebGPUBindGroupEntry,
    nativeWebGPUBindGroupLayoutEntry,
    nativeWebGPUComputePipelineDescriptor,
    nativeWebGPUGraphicsPipelineDescriptor
} from './WebGPUPipeline';
import { WebGPUQueue } from './WebGPUQueue';
import {
    WebGPUBuffer,
    WebGPUQuerySet,
    WebGPUSampler,
    WebGPUShader,
    WebGPUTexture
} from './WebGPUResources';
import { WebGPUSurface } from './WebGPUSurface';
import { WebGPUFramebufferCache } from './WebGPUFramebufferCache';
import { WebGPUMipmapGenerator } from './WebGPUMipmapGenerator';
import type { RHIDiagnosticNativeObjectKind, RHIDiagnosticsSink } from '../../RHIDiagnosticsSink';

export interface CreateWebGPUDeviceOptions {
    readonly adapter?: GPUAdapter;
    readonly powerPreference?: GPUPowerPreference;
    readonly forceFallbackAdapter?: boolean;
    readonly rejectFallbackAdapter?: boolean;
    readonly requiredFeatures?: readonly GPUFeatureName[];
    readonly optionalFeatures?: readonly GPUFeatureName[];
    readonly requiredLimits?: GPUDeviceDescriptor['requiredLimits'];
    readonly label?: string;
    /** @internal Allocation-free renderer diagnostics channel. */
    readonly diagnosticsSink?: RHIDiagnosticsSink;
    /** @internal Prepared above the RHI through the engine GLSL/Naga compiler. */
    readonly mipmapShaderArtifacts?: Readonly<RHIGraphicsShaderArtifactInput>;
}

export type WebGPUSupportOptions = Omit<
    CreateWebGPUDeviceOptions,
    'adapter' | 'label' | 'diagnosticsSink' | 'mipmapShaderArtifacts'
>;

function webGPUAdapterIsFallback(adapter: GPUAdapter): boolean {
    const info: unknown = Reflect.get(adapter, 'info');
    return (
        (typeof info === 'object' &&
            info !== null &&
            Reflect.get(info, 'isFallbackAdapter') === true) ||
        Reflect.get(adapter, 'isFallbackAdapter') === true
    );
}

function requiresAppleMobileDirectUploadWorkaround(): boolean {
    if (typeof navigator === 'undefined') return false;
    const userAgent = navigator.userAgent;
    if (!userAgent.includes('AppleWebKit')) return false;
    return (
        /(?:iPad|iPhone|iPod)/u.test(userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
}

/** Concrete RHI device: all native API access remains inside this backend directory. */
export class WebGPUDevice implements RHIDevice, WebGPUObjectOwner {
    readonly id = allocateRHIDeviceId();
    readonly backend = 'webgpu' as const;
    readonly capabilities: RHICapabilities;
    readonly lost: Promise<RHIDeviceLostInfo>;
    readonly graphicsQueue: WebGPUQueue;
    /** WebGPU has no native VAO; renderer diagnostics use PreparedDraw vertex-input packets. */
    readonly vertexInputCacheMetrics = null;
    readonly framebufferCacheMetrics = new RHICacheCounter();
    readonly framebufferCache: WebGPUFramebufferCache;
    readonly mipmapGenerator: WebGPUMipmapGenerator;
    /**
     * @internal Apple mobile WebKit buffer and texture uploads use the direct queue path as an
     * implementation workaround, not as a WebGPU portability requirement.
     */
    readonly directUploadWorkaround: boolean;
    label: string;
    #generation = 1;
    #destroyed = false;
    #nativeLost = false;
    readonly #nativeHandle: GPUDevice;
    readonly #objectIds: RHIObjectIdAllocator;
    readonly #destroyables = new Set<WebGPUDestroyableObject>();
    readonly #surfaces = new WeakMap<HTMLCanvasElement, WebGPUSurface>();
    readonly #lostSignal: WebGPUDeferred<RHIDeviceLostInfo>;
    readonly #diagnosticsSink: RHIDiagnosticsSink | null;

    constructor(
        nativeHandle: GPUDevice,
        diagnosticsSink: RHIDiagnosticsSink | null = null,
        mipmapShaderArtifacts: Readonly<RHIGraphicsShaderArtifactInput> | null = null,
        adapterInfo?: Pick<GPUAdapterInfo, 'subgroupMinSize' | 'subgroupMaxSize'>
    ) {
        this.#nativeHandle = nativeHandle;
        this.#diagnosticsSink = diagnosticsSink;
        this.#objectIds = createRHIObjectIdAllocator(this.id);
        this.capabilities = new WebGPUCapabilities(nativeHandle, adapterInfo);
        this.label = nativeHandle.label;
        this.#lostSignal = createWebGPUDeferred<RHIDeviceLostInfo>();
        this.lost = this.#lostSignal.promise;
        this.directUploadWorkaround = requiresAppleMobileDirectUploadWorkaround();
        this.graphicsQueue = new WebGPUQueue(this, nativeHandle.queue);
        this.framebufferCache = new WebGPUFramebufferCache(this, this.framebufferCacheMetrics);
        this.mipmapGenerator = new WebGPUMipmapGenerator(this, mipmapShaderArtifacts);
        void nativeHandle.lost.then(info => {
            this.handleNativeLoss(info);
        });
    }

    get generation(): number {
        return this.#generation;
    }

    get deviceGeneration(): number {
        return this.#generation;
    }

    get destroyed(): boolean {
        return this.#destroyed;
    }

    /** @internal */
    get nativeHandle(): GPUDevice {
        return this.#nativeHandle;
    }

    /** @internal */
    allocateObjectId(): number {
        return this.#objectIds.allocate();
    }

    /** @internal */
    registerDestroyable(object: WebGPUDestroyableObject): void {
        this.#destroyables.add(object);
    }

    /** @internal */
    unregisterDestroyable(object: WebGPUDestroyableObject): void {
        this.#destroyables.delete(object);
    }

    /** @internal Native objects without a destroy operation remain creation-only. */
    recordNativeObjectCreated(
        kind: RHIDiagnosticNativeObjectKind,
        lifetime: WebGPUNativeLifetimeDiagnostics
    ): void {
        if (lifetime === 'complete') this.#diagnosticsSink?.recordNativeObjectCreated(kind);
        else this.#diagnosticsSink?.recordNativeObjectCreatedOnly(kind);
    }

    /** @internal Called only after an explicit native destroy boundary succeeds. */
    recordNativeObjectDestroyed(kind: RHIDiagnosticNativeObjectKind): void {
        this.#diagnosticsSink?.recordNativeObjectDestroyed(kind);
    }

    /** @internal */
    assertUsable(object: RHIDeviceOwnedObject, path = 'object'): void {
        if (this.#nativeLost) {
            if (object.deviceGeneration !== this.#generation) {
                throw new RHIValidationError(
                    'stale-generation',
                    `belongs to generation ${String(object.deviceGeneration)}, current generation is ${String(this.#generation)}`,
                    path
                );
            }
            throw new RHIValidationError('invalid-state', 'WebGPU device is lost', path);
        }
        if (this.#destroyed) {
            throw new RHIValidationError('destroyed-object', 'owner device is destroyed', path);
        }
        if (object.deviceId !== this.id) {
            throw new RHIValidationError(
                'wrong-device',
                `belongs to device ${String(object.deviceId)}`,
                path
            );
        }
        if (object.deviceGeneration !== this.#generation) {
            throw new RHIValidationError(
                'stale-generation',
                `belongs to generation ${String(object.deviceGeneration)}, current generation is ${String(this.#generation)}`,
                path
            );
        }
        if (
            (object as RHIDeviceOwnedObject & { [WEBGPU_DESTROYED_STATE]?: boolean })[
                WEBGPU_DESTROYED_STATE
            ] === true
        ) {
            throw new RHIValidationError('destroyed-object', 'has been destroyed', path);
        }
    }

    createBuffer(descriptor: RHIBufferDescriptor): WebGPUBuffer {
        this.assertOperational();
        const normalized = normalizeRHIBufferDescriptor(descriptor, this.capabilities);
        const initialData =
            descriptor.initialData === undefined
                ? undefined
                : snapshotRHIDataSource(descriptor.initialData);
        const initializeThroughMapping = initialData !== undefined;
        const nativeSize =
            normalized.mappedAtCreation || initializeThroughMapping
                ? Math.ceil(normalized.size / 4) * 4
                : normalized.size;
        const nativeBuffer = this.#nativeHandle.createBuffer({
            label: normalized.label,
            size: nativeSize,
            usage: normalized.usage,
            mappedAtCreation: normalized.mappedAtCreation || initializeThroughMapping
        });
        if (initialData !== undefined) {
            try {
                new Uint8Array(nativeBuffer.getMappedRange()).set(initialData);
                nativeBuffer.unmap();
            } catch (error) {
                nativeBuffer.destroy();
                throw error;
            }
        }
        return new WebGPUBuffer(this, nativeBuffer, normalized);
    }

    createTexture(descriptor: RHITextureDescriptor): WebGPUTexture {
        this.assertOperational();
        const normalized = normalizeRHITextureDescriptor(descriptor, this.capabilities);
        const nativeTexture = this.#nativeHandle.createTexture(
            nativeWebGPUTextureDescriptor(normalized)
        );
        const texture = new WebGPUTexture(this, nativeTexture, normalized);
        try {
            this.mipmapGenerator.prepare(texture);
            return texture;
        } catch (error) {
            texture.destroy();
            throw error;
        }
    }

    createSampler(descriptor: RHISamplerDescriptor = {}): WebGPUSampler {
        this.assertOperational();
        const normalized = normalizeRHISamplerDescriptor(descriptor, this.capabilities);
        const nativeSampler = this.#nativeHandle.createSampler(
            nativeWebGPUSamplerDescriptor(normalized)
        );
        return new WebGPUSampler(this, nativeSampler, normalized);
    }

    createShader(descriptor: RHIShaderDescriptor): WebGPUShader {
        this.assertOperational();
        const normalized = normalizeRHIShaderDescriptor(descriptor, this);
        const nativeShader = this.#nativeHandle.createShaderModule({
            label: normalized.label,
            code: normalized.artifact.code
        });
        return new WebGPUShader(this, nativeShader, normalized);
    }

    createQuerySet(descriptor: RHIQuerySetDescriptor): WebGPUQuerySet {
        this.assertOperational();
        const normalized = normalizeRHIQuerySetDescriptor(descriptor, this.capabilities);
        const nativeQuerySet = this.#nativeHandle.createQuerySet({
            label: normalized.label,
            type: normalized.type,
            count: normalized.count
        });
        return new WebGPUQuerySet(this, nativeQuerySet, normalized);
    }

    createBindGroupLayout(descriptor: RHIBindGroupLayoutDescriptor): WebGPUBindGroupLayout {
        this.assertOperational();
        const snapshot = snapshotRHIBindGroupLayoutDescriptor(descriptor, this.capabilities);
        const nativeLayout = this.#nativeHandle.createBindGroupLayout({
            ...(snapshot.label === undefined ? {} : { label: snapshot.label }),
            entries: snapshot.entries.map(nativeWebGPUBindGroupLayoutEntry)
        });
        return new WebGPUBindGroupLayout(this, nativeLayout, snapshot);
    }

    createPipelineLayout(descriptor: RHIPipelineLayoutDescriptor): WebGPUPipelineLayout {
        this.assertOperational();
        const snapshot = snapshotRHIPipelineLayoutDescriptor(this, descriptor);
        const nativeLayouts = snapshot.bindGroupLayouts.map((layout, index) => {
            if (!(layout instanceof WebGPUBindGroupLayout) || layout.owner !== this) {
                throw new RHIValidationError(
                    'wrong-device',
                    'expected a WebGPU RHI bind group layout',
                    `pipelineLayout.bindGroupLayouts[${String(index)}]`
                );
            }
            return layout.nativeHandle;
        });
        const nativeLayout = this.#nativeHandle.createPipelineLayout({
            ...(snapshot.label === undefined ? {} : { label: snapshot.label }),
            bindGroupLayouts: nativeLayouts
        });
        return new WebGPUPipelineLayout(this, nativeLayout, snapshot);
    }

    createBindGroup(descriptor: RHIBindGroupDescriptor): WebGPUBindGroup {
        this.assertOperational();
        const snapshot = snapshotRHIBindGroupDescriptor(this, descriptor);
        if (!(snapshot.layout instanceof WebGPUBindGroupLayout) || snapshot.layout.owner !== this) {
            throw new RHIValidationError(
                'wrong-device',
                'expected a WebGPU RHI bind group layout',
                'bindGroup.layout'
            );
        }
        const nativeBindGroup = this.#nativeHandle.createBindGroup({
            ...(snapshot.label === undefined ? {} : { label: snapshot.label }),
            layout: snapshot.layout.nativeHandle,
            entries: snapshot.entries.map(nativeWebGPUBindGroupEntry)
        });
        return new WebGPUBindGroup(this, nativeBindGroup, snapshot, snapshot.layout);
    }

    createGraphicsPipeline(descriptor: RHIGraphicsPipelineDescriptor): WebGPUGraphicsPipeline {
        this.assertOperational();
        const snapshot = snapshotRHIGraphicsPipelineDescriptor(this, descriptor);
        if (!(snapshot.layout instanceof WebGPUPipelineLayout) || snapshot.layout.owner !== this) {
            throw new RHIValidationError(
                'wrong-device',
                'expected a WebGPU RHI pipeline layout',
                'graphicsPipeline.layout'
            );
        }
        const vertexShader = snapshot.vertex.shader;
        if (!(vertexShader instanceof WebGPUShader) || vertexShader.owner !== this) {
            throw new RHIValidationError(
                'wrong-device',
                'expected a WebGPU RHI vertex shader',
                'graphicsPipeline.vertex.shader'
            );
        }
        const fragmentShader = snapshot.fragment?.shader;
        if (
            fragmentShader !== undefined &&
            (!(fragmentShader instanceof WebGPUShader) || fragmentShader.owner !== this)
        ) {
            throw new RHIValidationError(
                'wrong-device',
                'expected a WebGPU RHI fragment shader',
                'graphicsPipeline.fragment.shader'
            );
        }
        const nativePipeline = this.#nativeHandle.createRenderPipeline(
            nativeWebGPUGraphicsPipelineDescriptor(
                snapshot,
                snapshot.layout,
                vertexShader,
                fragmentShader
            )
        );
        return new WebGPUGraphicsPipeline(this, nativePipeline, snapshot);
    }

    createComputePipeline(descriptor: RHIComputePipelineDescriptor): WebGPUComputePipeline {
        this.assertOperational();
        const snapshot = snapshotRHIComputePipelineDescriptor(this, descriptor);
        if (!(snapshot.layout instanceof WebGPUPipelineLayout) || snapshot.layout.owner !== this) {
            throw new RHIValidationError(
                'wrong-device',
                'expected a WebGPU RHI pipeline layout',
                'computePipeline.layout'
            );
        }
        const shader = snapshot.compute.shader;
        if (!(shader instanceof WebGPUShader) || shader.owner !== this) {
            throw new RHIValidationError(
                'wrong-device',
                'expected a WebGPU RHI compute shader',
                'computePipeline.compute.shader'
            );
        }
        const nativePipeline = this.#nativeHandle.createComputePipeline(
            nativeWebGPUComputePipelineDescriptor(snapshot, snapshot.layout, shader)
        );
        return new WebGPUComputePipeline(this, nativePipeline, snapshot, snapshot.layout);
    }

    createSurface(canvas: HTMLCanvasElement): RHISurface {
        this.assertOperational();
        const existing = this.#surfaces.get(canvas);
        if (existing !== undefined && !existing.destroyed) return existing;
        const context = canvas.getContext('webgpu');
        if (context === null) {
            throw new Error('Canvas does not expose a WebGPU context');
        }
        const surface = new WebGPUSurface(this, context as unknown as GPUCanvasContext, canvas);
        this.#surfaces.set(canvas, surface);
        return surface;
    }

    destroy(): void {
        if (this.#destroyed) return;
        this.graphicsQueue.destroyQueue(new Error('WebGPU device was destroyed'));
        this.#destroyed = true;
        this.framebufferCache.clear();
        for (const object of this.#destroyables) object.destroy();
        this.#nativeHandle.destroy();
        this.#lostSignal.resolve(
            Object.freeze({
                reason: 'destroyed',
                message: 'WebGPU device destroyed',
                generation: this.#generation
            })
        );
    }

    private assertOperational(): void {
        if (this.#destroyed) {
            throw new RHIValidationError(
                'destroyed-object',
                'WebGPU device is destroyed',
                'device'
            );
        }
        if (this.#nativeLost) {
            throw new RHIValidationError('invalid-state', 'WebGPU device is lost', 'device');
        }
    }

    private handleNativeLoss(info: GPUDeviceLostInfo): void {
        if (this.#destroyed || this.#nativeLost) return;
        this.#nativeLost = true;
        this.framebufferCache.clear();
        const previousGeneration = this.#generation;
        const reason = new Error(info.message || 'WebGPU device was lost');
        this.graphicsQueue.lose(reason);
        this.#generation += 1;
        for (const object of this.#destroyables) object.invalidateGeneration();
        this.#lostSignal.resolve(
            Object.freeze({
                reason: info.reason === 'destroyed' ? 'destroyed' : 'unknown',
                message: info.message,
                generation: previousGeneration
            })
        );
    }
}

export async function createWebGPUDevice(
    options: CreateWebGPUDeviceOptions = {}
): Promise<WebGPUDevice> {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
        throw new Error('WebGPU is unavailable in this environment');
    }
    const adapter =
        options.adapter ??
        (await navigator.gpu.requestAdapter({
            ...(options.powerPreference === undefined
                ? {}
                : { powerPreference: options.powerPreference }),
            ...(options.forceFallbackAdapter === undefined
                ? {}
                : { forceFallbackAdapter: options.forceFallbackAdapter })
        }));
    if (adapter === null) throw new Error('No compatible WebGPU adapter is available');
    if (options.rejectFallbackAdapter === true && webGPUAdapterIsFallback(adapter)) {
        throw new Error('A fallback WebGPU adapter was rejected by renderer policy');
    }
    const requestedFeatures = new Set<GPUFeatureName>(options.requiredFeatures ?? []);
    for (const feature of options.optionalFeatures ?? []) {
        if (adapter.features.has(feature)) requestedFeatures.add(feature);
    }
    const nativeDevice = await adapter.requestDevice({
        ...(options.label === undefined ? {} : { label: options.label }),
        ...(requestedFeatures.size === 0 ? {} : { requiredFeatures: [...requestedFeatures] }),
        ...(options.requiredLimits === undefined ? {} : { requiredLimits: options.requiredLimits })
    });
    try {
        return new WebGPUDevice(
            nativeDevice,
            options.diagnosticsSink ?? null,
            options.mipmapShaderArtifacts ?? null,
            adapter.info
        );
    } catch (error) {
        nativeDevice.destroy();
        throw error;
    }
}

/** Probe adapter features and limits without requesting a device or creating native resources. */
export async function isWebGPURHIAvailable(options: WebGPUSupportOptions = {}): Promise<boolean> {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) return false;
    try {
        const adapter = await navigator.gpu.requestAdapter({
            ...(options.powerPreference === undefined
                ? {}
                : { powerPreference: options.powerPreference }),
            ...(options.forceFallbackAdapter === undefined
                ? {}
                : { forceFallbackAdapter: options.forceFallbackAdapter })
        });
        if (adapter === null) return false;
        if (options.rejectFallbackAdapter === true && webGPUAdapterIsFallback(adapter))
            return false;
        for (const feature of options.requiredFeatures ?? []) {
            if (!adapter.features.has(feature)) return false;
        }
        for (const [name, required] of Object.entries(options.requiredLimits ?? {})) {
            if (required === undefined) continue;
            const available: unknown = Reflect.get(adapter.limits, name);
            if (typeof available !== 'number' || available < required) return false;
        }
        return true;
    } catch {
        return false;
    }
}
