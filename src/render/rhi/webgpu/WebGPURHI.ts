import type { RHI, RHIFeatureName, RHILimits, RHITextureFormat } from '../RHI';
import {
    WebGPUDestroyableObject,
    WebGPURHIDiagnostics,
    type WebGPUAdapterProbeOptions,
    type WebGPURHICreateOptions
} from './WebGPUBase';
import { WebGPUDevice } from './WebGPUDevice';
import {
    renderStageStorageLimit,
    type WebGPURenderStageStorageLimit,
    type WebGPUStorageResource
} from './WebGPULimits';
import { WebGPUSurface } from './WebGPUSurface';

function featureIsSupported(adapter: GPUAdapter, feature: RHIFeatureName): boolean {
    if (feature === 'compute-pipelines') return false;
    if (feature === 'buffer-mapping') return true;
    if (feature === 'draw-base-vertex' || feature === 'draw-first-instance') return true;
    if (feature === 'texture-1d') return adapter.limits.maxTextureDimension1D > 0;
    if (feature === 'storage-buffers') {
        return renderStageStorageLimit(adapter.limits, 'buffer').value > 0;
    }
    if (feature === 'storage-textures') {
        return renderStageStorageLimit(adapter.limits, 'texture').value > 0;
    }
    return adapter.features.has(feature);
}

function nativeRequiredFeatures(features: readonly RHIFeatureName[]): GPUFeatureName[] {
    const native: GPUFeatureName[] = [];
    for (const feature of features) {
        if (
            feature !== 'storage-buffers' &&
            feature !== 'storage-textures' &&
            feature !== 'buffer-mapping' &&
            feature !== 'texture-1d' &&
            feature !== 'draw-base-vertex' &&
            feature !== 'draw-first-instance' &&
            feature !== 'compute-pipelines'
        ) {
            native.push(feature);
        }
    }
    return native;
}

const NATIVE_LIMIT_NAMES = Object.freeze([
    'maxTextureDimension1D',
    'maxTextureDimension2D',
    'maxTextureDimension3D',
    'maxTextureArrayLayers',
    'maxBindGroups',
    'maxBindingsPerBindGroup',
    'maxDynamicUniformBuffersPerPipelineLayout',
    'maxSampledTexturesPerShaderStage',
    'maxSamplersPerShaderStage',
    'maxUniformBuffersPerShaderStage',
    'maxStorageBuffersPerShaderStage',
    'maxStorageTexturesPerShaderStage',
    'maxStorageBufferBindingSize',
    'minStorageBufferOffsetAlignment',
    'maxUniformBufferBindingSize',
    'maxVertexBuffers',
    'maxBufferSize',
    'maxVertexAttributes',
    'maxVertexBufferArrayStride',
    'minUniformBufferOffsetAlignment',
    'maxColorAttachments'
] as const satisfies readonly (keyof RHILimits)[]);
const NATIVE_LIMIT_NAME_SET: ReadonlySet<string> = new Set(NATIVE_LIMIT_NAMES);

function setRequiredLimitAtLeast(
    required: Record<string, number>,
    name: string,
    minimum: number
): void {
    required[name] = Math.max(required[name] ?? 0, minimum);
}

function requireRenderStageStorageLimit(
    required: Record<string, number>,
    resolved: WebGPURenderStageStorageLimit,
    minimum: number
): void {
    setRequiredLimitAtLeast(required, resolved.aggregateName, minimum);
    if (!resolved.usesStageSpecificLimits) return;
    setRequiredLimitAtLeast(required, resolved.vertexName, minimum);
    setRequiredLimitAtLeast(required, resolved.fragmentName, minimum);
}

function storageLimitForName(
    adapter: GPUAdapter,
    name: keyof RHILimits
): WebGPURenderStageStorageLimit | null {
    if (
        name === 'maxStorageBuffersPerShaderStage' ||
        name === 'maxStorageBufferBindingSize' ||
        name === 'minStorageBufferOffsetAlignment'
    ) {
        return renderStageStorageLimit(adapter.limits, 'buffer');
    }
    if (name === 'maxStorageTexturesPerShaderStage') {
        return renderStageStorageLimit(adapter.limits, 'texture');
    }
    return null;
}

function nativeRequiredLimits(
    adapter: GPUAdapter,
    required: Readonly<Partial<RHILimits>>
): Record<string, number> {
    for (const name of Object.keys(required)) {
        if (!NATIVE_LIMIT_NAME_SET.has(name)) {
            throw new TypeError(`Unknown portable WebGPU required limit ${name}`);
        }
    }
    const native: Record<string, number> = {};
    for (const name of NATIVE_LIMIT_NAMES) {
        const requested = required[name];
        if (requested === undefined || requested === 0) continue;
        if (!Number.isSafeInteger(requested) || requested < 0) {
            throw new RangeError(
                `Required WebGPU limit ${name} must be a non-negative safe integer`
            );
        }
        const storageLimit = storageLimitForName(adapter, name);
        const supported =
            name === 'maxStorageBuffersPerShaderStage' ||
            name === 'maxStorageTexturesPerShaderStage'
                ? storageLimit?.value
                : adapter.limits[name];
        const unsupported =
            storageLimit?.value === 0 ||
            typeof supported !== 'number' ||
            (name === 'minUniformBufferOffsetAlignment' ||
            name === 'minStorageBufferOffsetAlignment'
                ? supported > requested
                : supported < requested);
        if (unsupported) {
            throw new Error(
                `WebGPU adapter limit ${name} is ${String(supported)}; ${String(requested)} is required`
            );
        }
        native[name] = requested;
        if (
            name === 'maxStorageBuffersPerShaderStage' ||
            name === 'maxStorageTexturesPerShaderStage'
        ) {
            if (storageLimit) requireRenderStageStorageLimit(native, storageLimit, requested);
        }
    }
    if (
        (required.maxStorageBufferBindingSize ?? 0) > 0 ||
        (required.minStorageBufferOffsetAlignment ?? 0) > 0
    ) {
        requireRenderStageStorageLimit(
            native,
            renderStageStorageLimit(adapter.limits, 'buffer'),
            1
        );
    }
    return native;
}

function requirePortableStorageFeatureLimit(
    nativeLimits: Record<string, number>,
    adapter: GPUAdapter,
    resource: WebGPUStorageResource
): void {
    requireRenderStageStorageLimit(
        nativeLimits,
        renderStageStorageLimit(adapter.limits, resource),
        1
    );
}

function adapterIsFallback(adapter: GPUAdapter): boolean {
    const info: unknown = Reflect.get(adapter, 'info');
    return (
        typeof info === 'object' && info !== null && Reflect.get(info, 'isFallbackAdapter') === true
    );
}

function globalWebGPU(): GPU | null {
    const navigatorValue: unknown = Reflect.get(globalThis, 'navigator');
    const gpu: unknown =
        typeof navigatorValue === 'object' && navigatorValue !== null
            ? Reflect.get(navigatorValue, 'gpu')
            : undefined;
    return typeof gpu === 'object' && gpu !== null ? (gpu as GPU) : null;
}

function adapterOptions(
    options: Pick<WebGPUAdapterProbeOptions, 'powerPreference' | 'forceFallbackAdapter'>
): GPURequestAdapterOptions {
    return Object.freeze({
        ...(options.powerPreference === undefined
            ? {}
            : { powerPreference: options.powerPreference }),
        ...(options.forceFallbackAdapter === undefined
            ? {}
            : { forceFallbackAdapter: options.forceFallbackAdapter })
    });
}

interface RequestedWebGPUDevice {
    readonly adapter: GPUAdapter;
    readonly device: GPUDevice;
}

export class WebGPURHI extends WebGPUDestroyableObject implements RHI {
    readonly ready: Promise<void>;
    readonly #options: WebGPURHICreateOptions;
    readonly #gpu: GPU;
    readonly #adapterOptions: GPURequestAdapterOptions;
    readonly #requiredFeatures: readonly RHIFeatureName[];
    readonly #optionalFeatures: readonly RHIFeatureName[];
    readonly #nativeRequiredFeatures: readonly GPUFeatureName[];
    readonly #nativeOptionalFeatures: readonly GPUFeatureName[];
    readonly #requiredLimits: Readonly<Partial<RHILimits>>;
    readonly #rejectFallbackAdapter: boolean;
    readonly #adapterValidator: ((adapter: GPUAdapter) => void) | undefined;
    readonly #includeEmptyDeviceDescriptorFields: boolean;
    readonly #diagnostics: WebGPURHIDiagnostics | null;
    #adapter: GPUAdapter | null = null;
    #device: WebGPUDevice | null = null;
    #surface: WebGPUSurface | null = null;
    #context: GPUCanvasContext | null = null;
    #isReady = false;
    #generation = 0;
    #recovery: Promise<void> | null = null;

    constructor(options: WebGPURHICreateOptions) {
        super('WebGPU RHI');
        const gpu = globalWebGPU();
        if (!gpu) {
            throw new Error('WebGPU is unavailable in this execution context');
        }
        if (
            !Number.isSafeInteger(options.width) ||
            options.width < 0 ||
            !Number.isSafeInteger(options.height) ||
            options.height < 0
        ) {
            throw new RangeError('WebGPU surface dimensions must be non-negative safe integers');
        }
        this.#options = options;
        this.#gpu = gpu;
        this.#adapterOptions = adapterOptions(options);
        this.#requiredFeatures = Object.freeze([...(options.requiredFeatures ?? [])]);
        this.#optionalFeatures = Object.freeze([...(options.optionalFeatures ?? [])]);
        this.#nativeRequiredFeatures = Object.freeze([...(options.nativeRequiredFeatures ?? [])]);
        this.#nativeOptionalFeatures = Object.freeze([...(options.nativeOptionalFeatures ?? [])]);
        this.#requiredLimits = Object.freeze({ ...(options.requiredLimits ?? {}) });
        this.#rejectFallbackAdapter = options.rejectFallbackAdapter ?? false;
        this.#adapterValidator = options.adapterValidator;
        this.#includeEmptyDeviceDescriptorFields =
            options.includeEmptyDeviceDescriptorFields ?? false;
        this.#diagnostics =
            options.diagnostics || options.diagnosticsSink
                ? new WebGPURHIDiagnostics(options.diagnosticsSink ?? null)
                : null;
        options.canvas.width = options.width;
        options.canvas.height = options.height;
        this.ready = this.initialize();
    }

    static async create(options: WebGPURHICreateOptions): Promise<WebGPURHI> {
        const rhi = new WebGPURHI(options);
        await rhi.ready;
        return rhi;
    }

    /** Probe only adapter availability/capabilities; never request a device or canvas context. */
    static async isSupported(options: WebGPUAdapterProbeOptions = {}): Promise<boolean> {
        const gpu = globalWebGPU();
        if (!gpu) return false;
        try {
            const adapter = await gpu.requestAdapter(adapterOptions(options));
            if (!adapter) return false;
            options.adapterValidator?.(adapter);
            return true;
        } catch {
            return false;
        }
    }

    get device(): WebGPUDevice {
        if (!this.#device) throw new Error('WebGPU RHI device is not ready');
        return this.#device;
    }

    get surface(): WebGPUSurface {
        if (!this.#surface) throw new Error('WebGPU RHI surface is not ready');
        return this.#surface;
    }

    get isReady(): boolean {
        return this.#isReady && !this.destroyed;
    }

    get generation(): number {
        return this.#generation;
    }

    get diagnostics(): WebGPURHIDiagnostics | null {
        return this.#diagnostics;
    }

    /** @internal */
    get nativeAdapter(): GPUAdapter {
        if (!this.#adapter) throw new Error('WebGPU adapter is not ready');
        return this.#adapter;
    }

    /** @internal */
    get nativeDevice(): GPUDevice {
        return this.device.nativeHandle;
    }

    /** @internal */
    get nativeContext(): GPUCanvasContext {
        if (!this.#context) throw new Error('WebGPU canvas context is not ready');
        return this.#context;
    }

    /** @internal */
    get nativeHandle(): GPUDevice {
        return this.nativeDevice;
    }

    private async requestDevice(): Promise<RequestedWebGPUDevice> {
        const adapter = await this.#gpu.requestAdapter(this.#adapterOptions);
        if (!adapter) throw new Error('No WebGPU adapter satisfies the requested preference');
        if (this.#rejectFallbackAdapter && adapterIsFallback(adapter)) {
            throw new Error('WebGPU adapter selection returned a fallback adapter');
        }
        this.#adapterValidator?.(adapter);
        for (const feature of this.#requiredFeatures) {
            if (!featureIsSupported(adapter, feature)) {
                throw new Error(`WebGPU adapter does not support required feature ${feature}`);
            }
        }
        for (const feature of this.#nativeRequiredFeatures) {
            if (!adapter.features.has(feature)) {
                throw new Error(`WebGPU adapter does not support required feature ${feature}`);
            }
        }
        const requiredFeatures = new Set([
            ...nativeRequiredFeatures(this.#requiredFeatures),
            ...this.#nativeRequiredFeatures
        ]);
        const enabledPortableFeatures = new Set(this.#requiredFeatures);
        for (const feature of this.#optionalFeatures) {
            if (!featureIsSupported(adapter, feature)) continue;
            enabledPortableFeatures.add(feature);
            for (const nativeFeature of nativeRequiredFeatures([feature])) {
                requiredFeatures.add(nativeFeature);
            }
        }
        for (const feature of this.#nativeOptionalFeatures) {
            if (adapter.features.has(feature)) requiredFeatures.add(feature);
        }
        const requiredLimits = nativeRequiredLimits(adapter, this.#requiredLimits);
        if (enabledPortableFeatures.has('storage-buffers')) {
            requirePortableStorageFeatureLimit(requiredLimits, adapter, 'buffer');
        }
        if (enabledPortableFeatures.has('storage-textures')) {
            requirePortableStorageFeatureLimit(requiredLimits, adapter, 'texture');
        }
        const device = await adapter.requestDevice({
            ...(requiredFeatures.size === 0 && !this.#includeEmptyDeviceDescriptorFields
                ? {}
                : { requiredFeatures: [...requiredFeatures] }),
            ...(Object.keys(requiredLimits).length === 0 &&
            !this.#includeEmptyDeviceDescriptorFields
                ? {}
                : { requiredLimits })
        });
        return { adapter, device };
    }

    private async initialize(): Promise<void> {
        let nativeDevice: GPUDevice | null = null;
        try {
            const requested = await this.requestDevice();
            nativeDevice = requested.device;
            if (this.destroyed) {
                nativeDevice.destroy();
                nativeDevice = null;
                throw new Error('WebGPU RHI initialization was cancelled');
            }
            const context = this.#options.canvas.getContext('webgpu') as GPUCanvasContext | null;
            if (!context) throw new Error('Unable to create a WebGPU canvas context');
            const device = new WebGPUDevice(requested.adapter, requested.device, this.#diagnostics);
            const format = this.#gpu.getPreferredCanvasFormat() as RHITextureFormat;
            const surface = new WebGPUSurface(device, context, this.#options.canvas, {
                format,
                alphaMode: this.#options.alpha ? 'premultiplied' : 'opaque'
            });
            this.#adapter = requested.adapter;
            this.#device = device;
            this.#context = context;
            this.#surface = surface;
            this.#isReady = true;
            void device.lost.then(() => {
                if (this.#device === device) this.#isReady = false;
            });
        } catch (error: unknown) {
            this.#isReady = false;
            if (nativeDevice && this.#device?.nativeHandle !== nativeDevice) nativeDevice.destroy();
            throw error;
        }
    }

    /**
     * Replaces a lost native device. Engine-owned resources intentionally remain an upper-layer
     * concern and must be rebuilt after this promise resolves.
     */
    recover(): Promise<void> {
        this.assertAlive('WebGPU RHI');
        if (this.#recovery) return this.#recovery;
        const recovery = (async () => {
            try {
                const requested = await this.requestDevice();
                if (this.destroyed) {
                    requested.device.destroy();
                    throw new Error('WebGPU RHI recovery was cancelled');
                }
                const replacement = new WebGPUDevice(
                    requested.adapter,
                    requested.device,
                    this.#diagnostics
                );
                try {
                    this.surface.replaceDevice(replacement);
                } catch (error: unknown) {
                    replacement.destroy();
                    throw error;
                }
                const previous = this.#device;
                this.#adapter = requested.adapter;
                this.#device = replacement;
                this.#generation++;
                this.#isReady = true;
                if (previous && !previous.destroyed) previous.destroy();
                void replacement.lost.then(() => {
                    if (this.#device === replacement) this.#isReady = false;
                });
            } finally {
                this.#recovery = null;
            }
        })();
        this.#recovery = recovery;
        return recovery;
    }

    /** Unconfigure the current surface without destroying its canvas/context. @internal */
    suspendSurface(): void {
        this.surface.suspend();
    }

    destroy(): void {
        if (!this.markDestroyed()) return;
        this.#isReady = false;
        this.#surface?.destroy();
        this.#device?.destroy();
    }
}

export async function createWebGPURHI(options: WebGPURHICreateOptions): Promise<WebGPURHI> {
    return WebGPURHI.create(options);
}

export * from './WebGPUBase';
export * from './WebGPUBindings';
export * from './WebGPUCommands';
export * from './WebGPUDescriptors';
export * from './WebGPUDevice';
export * from './WebGPUNativeCache';
export * from './WebGPUResources';
export * from './WebGPUSurface';
