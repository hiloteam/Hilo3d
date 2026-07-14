export const DEFAULT_WEBGPU_NATIVE_CACHE_CAPACITY = 256;

export type WebGPUNativeCacheCounter =
    | 'samplerCreations'
    | 'bindGroupLayoutCreations'
    | 'pipelineLayoutCreations'
    | 'renderPipelineCreations'
    | 'samplerCacheHits'
    | 'bindGroupLayoutCacheHits'
    | 'pipelineLayoutCacheHits'
    | 'renderPipelineCacheHits';

export interface WebGPUNativeCacheDiagnostics {
    record(counter: WebGPUNativeCacheCounter): void;
}

interface WebGPUNativeDeviceCacheOptions {
    readonly diagnostics?: WebGPUNativeCacheDiagnostics | null;
    readonly renderPipelineCapacity?: number;
}

class BoundedCache<Value> {
    readonly #capacity: number;
    readonly #values = new Map<string, Value>();

    constructor(capacity: number) {
        if (!Number.isSafeInteger(capacity) || capacity < 1) {
            throw new RangeError('WebGPU cache capacity must be a positive integer');
        }
        this.#capacity = capacity;
    }

    get size(): number {
        return this.#values.size;
    }

    get(key: string): Value | undefined {
        const value = this.#values.get(key);
        if (value === undefined) return undefined;
        this.#values.delete(key);
        this.#values.set(key, value);
        return value;
    }

    set(key: string, value: Value): void {
        this.#values.delete(key);
        this.#values.set(key, value);
        while (this.#values.size > this.#capacity) {
            const oldestKey = this.#values.keys().next().value;
            if (oldestKey === undefined) break;
            this.#values.delete(oldestKey);
        }
    }

    clear(): void {
        this.#values.clear();
    }
}

function keyPart(value: string | number | boolean | null): string {
    const encoded = value === null ? '-' : String(value);
    return `${String(encoded.length)}:${encoded}`;
}

function samplerKey(descriptor: GPUSamplerDescriptor): string {
    let key = 's1';
    key += keyPart(descriptor.addressModeU ?? 'clamp-to-edge');
    key += keyPart(descriptor.addressModeV ?? 'clamp-to-edge');
    key += keyPart(descriptor.addressModeW ?? 'clamp-to-edge');
    key += keyPart(descriptor.magFilter ?? 'nearest');
    key += keyPart(descriptor.minFilter ?? 'nearest');
    key += keyPart(descriptor.mipmapFilter ?? 'nearest');
    key += keyPart(descriptor.lodMinClamp ?? 0);
    key += keyPart(descriptor.lodMaxClamp ?? 32);
    key += keyPart(descriptor.compare ?? null);
    key += keyPart(descriptor.maxAnisotropy ?? 1);
    return key;
}

function bindGroupLayoutEntryKey(entry: GPUBindGroupLayoutEntry): string {
    const resources = [
        entry.buffer,
        entry.sampler,
        entry.texture,
        entry.storageTexture,
        entry.externalTexture
    ].filter(resource => resource !== undefined);
    if (resources.length !== 1) {
        throw new TypeError(
            `Bind group layout binding ${String(entry.binding)} must declare exactly one resource kind`
        );
    }

    let resourceKey: string;
    if (entry.buffer) {
        resourceKey = 'b';
        resourceKey += keyPart(entry.buffer.type ?? 'uniform');
        resourceKey += keyPart(entry.buffer.hasDynamicOffset ?? false);
        resourceKey += keyPart(entry.buffer.minBindingSize ?? 0);
    } else if (entry.sampler) {
        resourceKey = 's';
        resourceKey += keyPart(entry.sampler.type ?? 'filtering');
    } else if (entry.texture) {
        resourceKey = 't';
        resourceKey += keyPart(entry.texture.sampleType ?? 'float');
        resourceKey += keyPart(entry.texture.viewDimension ?? '2d');
        resourceKey += keyPart(entry.texture.multisampled ?? false);
    } else if (entry.storageTexture) {
        resourceKey = 'w';
        resourceKey += keyPart(entry.storageTexture.access ?? 'write-only');
        resourceKey += keyPart(entry.storageTexture.format);
        resourceKey += keyPart(entry.storageTexture.viewDimension ?? '2d');
    } else {
        resourceKey = 'e';
    }
    let key = keyPart(entry.binding);
    key += keyPart(entry.visibility);
    key += resourceKey;
    return key;
}

function bindGroupLayoutKey(descriptor: GPUBindGroupLayoutDescriptor): string {
    const entries = [...descriptor.entries].sort((left, right) => left.binding - right.binding);
    let key = 'bgl1';
    key += keyPart(entries.length);
    let previousBinding = -1;
    for (const entry of entries) {
        if (entry.binding === previousBinding) {
            throw new TypeError(`Duplicate bind group layout binding ${String(entry.binding)}`);
        }
        previousBinding = entry.binding;
        const entryKey = bindGroupLayoutEntryKey(entry);
        key += keyPart(entryKey);
    }
    return key;
}

function appendConstants(
    key: string,
    constants: Readonly<Record<string, GPUPipelineConstantValue>> | undefined
): string {
    if (!constants) return key + keyPart(0);
    const names = Object.keys(constants).sort();
    key += keyPart(names.length);
    for (const name of names) {
        const value = constants[name];
        if (value === undefined) continue;
        if (typeof value === 'number' && !Number.isFinite(value)) {
            throw new TypeError(`Pipeline constant ${name} must be finite`);
        }
        key += keyPart(name) + keyPart(typeof value === 'boolean' ? 'boolean' : 'number');
        key += keyPart(value);
    }
    return key;
}

function appendProgrammableStage(
    key: string,
    stage: GPUProgrammableStage,
    objectId: (object: object) => number
): string {
    key += keyPart(objectId(stage.module)) + keyPart(stage.entryPoint ?? null);
    return appendConstants(key, stage.constants);
}

function appendStencilFace(key: string, face: GPUStencilFaceState | undefined): string {
    return (
        key +
        keyPart(face?.compare ?? 'always') +
        keyPart(face?.failOp ?? 'keep') +
        keyPart(face?.depthFailOp ?? 'keep') +
        keyPart(face?.passOp ?? 'keep')
    );
}

function renderPipelineKey(
    descriptor: GPURenderPipelineDescriptor,
    objectId: (object: object) => number
): string {
    if (descriptor.layout === 'auto') {
        throw new TypeError('WebGPU native pipeline caching requires an explicit pipeline layout');
    }
    let key = 'nrp1';
    key += keyPart(objectId(descriptor.layout));
    key = appendProgrammableStage(key, descriptor.vertex, objectId);

    const buffers = descriptor.vertex.buffers;
    key += keyPart(buffers?.length ?? 0);
    if (buffers) {
        for (const buffer of buffers) {
            if (buffer === null) {
                key += keyPart(null);
                continue;
            }
            key += keyPart(buffer.arrayStride) + keyPart(buffer.stepMode ?? 'vertex');
            const attributes = [...buffer.attributes].sort(
                (left, right) =>
                    left.shaderLocation - right.shaderLocation ||
                    left.offset - right.offset ||
                    left.format.localeCompare(right.format)
            );
            key += keyPart(attributes.length);
            for (const attribute of attributes) {
                key +=
                    keyPart(attribute.shaderLocation) +
                    keyPart(attribute.offset) +
                    keyPart(attribute.format);
            }
        }
    }

    key += keyPart(descriptor.primitive?.topology ?? 'triangle-list');
    key += keyPart(descriptor.primitive?.stripIndexFormat ?? null);
    key += keyPart(descriptor.primitive?.frontFace ?? 'ccw');
    key += keyPart(descriptor.primitive?.cullMode ?? 'none');
    key += keyPart(descriptor.primitive?.unclippedDepth ?? false);

    const depthStencil = descriptor.depthStencil;
    key += keyPart(depthStencil !== undefined);
    if (depthStencil) {
        key += keyPart(depthStencil.format);
        key += keyPart(depthStencil.depthWriteEnabled ?? false);
        key += keyPart(depthStencil.depthCompare ?? 'always');
        key = appendStencilFace(key, depthStencil.stencilFront);
        key = appendStencilFace(key, depthStencil.stencilBack);
        key += keyPart(depthStencil.stencilReadMask ?? 0xffffffff);
        key += keyPart(depthStencil.stencilWriteMask ?? 0xffffffff);
        key += keyPart(depthStencil.depthBias ?? 0);
        key += keyPart(depthStencil.depthBiasSlopeScale ?? 0);
        key += keyPart(depthStencil.depthBiasClamp ?? 0);
    }

    key += keyPart(descriptor.multisample?.count ?? 1);
    key += keyPart(descriptor.multisample?.mask ?? 0xffffffff);
    key += keyPart(descriptor.multisample?.alphaToCoverageEnabled ?? false);

    const fragment = descriptor.fragment;
    key += keyPart(fragment !== undefined);
    if (fragment) {
        key = appendProgrammableStage(key, fragment, objectId);
        key += keyPart(fragment.targets.length);
        for (const target of fragment.targets) {
            if (target === null) {
                key += keyPart(null);
                continue;
            }
            key += keyPart(target.format) + keyPart(target.writeMask ?? 0xf);
            key += keyPart(target.blend !== undefined);
            if (target.blend) {
                key += keyPart(target.blend.color.operation ?? 'add');
                key += keyPart(target.blend.color.srcFactor ?? 'one');
                key += keyPart(target.blend.color.dstFactor ?? 'zero');
                key += keyPart(target.blend.alpha.operation ?? 'add');
                key += keyPart(target.blend.alpha.srcFactor ?? 'one');
                key += keyPart(target.blend.alpha.dstFactor ?? 'zero');
            }
        }
    }
    return key;
}

/**
 * Immutable native WebGPU resources are cached once per GPUDevice. This internal path accepts
 * complete WebGPU descriptors (including specialization constants) without widening the portable
 * RHI contract.
 */
export class WebGPUNativeDeviceCache {
    readonly #device: GPUDevice;
    readonly #samplers = new BoundedCache<GPUSampler>(DEFAULT_WEBGPU_NATIVE_CACHE_CAPACITY);
    readonly #bindGroupLayouts = new BoundedCache<GPUBindGroupLayout>(
        DEFAULT_WEBGPU_NATIVE_CACHE_CAPACITY
    );
    readonly #pipelineLayouts = new BoundedCache<GPUPipelineLayout>(
        DEFAULT_WEBGPU_NATIVE_CACHE_CAPACITY
    );
    readonly #renderPipelines: BoundedCache<GPURenderPipeline>;
    readonly #pendingRenderPipelines = new Map<string, Promise<GPURenderPipeline>>();
    readonly #objectIds = new WeakMap<object, number>();
    #nextObjectId = 1;
    #renderPipelineGeneration = 0;
    #diagnostics: WebGPUNativeCacheDiagnostics | null;

    constructor(device: GPUDevice, options: WebGPUNativeDeviceCacheOptions = {}) {
        this.#device = device;
        this.#diagnostics = options.diagnostics ?? null;
        this.#renderPipelines = new BoundedCache(
            options.renderPipelineCapacity ?? DEFAULT_WEBGPU_NATIVE_CACHE_CAPACITY
        );
    }

    get renderPipelineSize(): number {
        return this.#renderPipelines.size + this.#pendingRenderPipelines.size;
    }

    /** @internal Exposed for deterministic cache lifecycle diagnostics. */
    get samplerSize(): number {
        return this.#samplers.size;
    }

    /** @internal Exposed for deterministic cache lifecycle diagnostics. */
    get bindGroupLayoutSize(): number {
        return this.#bindGroupLayouts.size;
    }

    /** @internal Exposed for deterministic cache lifecycle diagnostics. */
    get pipelineLayoutSize(): number {
        return this.#pipelineLayouts.size;
    }

    /** @internal */
    attachDiagnostics(diagnostics: WebGPUNativeCacheDiagnostics | null): void {
        this.#diagnostics = diagnostics;
    }

    #objectId(object: object): number {
        let id = this.#objectIds.get(object);
        if (id === undefined) {
            id = this.#nextObjectId++;
            this.#objectIds.set(object, id);
        }
        return id;
    }

    createSampler(descriptor: GPUSamplerDescriptor = {}): GPUSampler {
        const key = samplerKey(descriptor);
        const cached = this.#samplers.get(key);
        if (cached) {
            this.#diagnostics?.record('samplerCacheHits');
            return cached;
        }
        this.#diagnostics?.record('samplerCreations');
        const sampler = this.#device.createSampler(descriptor);
        this.#samplers.set(key, sampler);
        return sampler;
    }

    createBindGroupLayout(descriptor: GPUBindGroupLayoutDescriptor): GPUBindGroupLayout {
        const key = bindGroupLayoutKey(descriptor);
        const cached = this.#bindGroupLayouts.get(key);
        if (cached) {
            this.#diagnostics?.record('bindGroupLayoutCacheHits');
            return cached;
        }
        this.#diagnostics?.record('bindGroupLayoutCreations');
        const layout = this.#device.createBindGroupLayout(descriptor);
        this.#bindGroupLayouts.set(key, layout);
        return layout;
    }

    createPipelineLayout(descriptor: GPUPipelineLayoutDescriptor): GPUPipelineLayout {
        let key = 'pl1';
        key += keyPart(descriptor.bindGroupLayouts.length);
        for (const layout of descriptor.bindGroupLayouts) {
            key += keyPart(layout === null ? null : this.#objectId(layout));
        }
        const cached = this.#pipelineLayouts.get(key);
        if (cached) {
            this.#diagnostics?.record('pipelineLayoutCacheHits');
            return cached;
        }
        this.#diagnostics?.record('pipelineLayoutCreations');
        const layout = this.#device.createPipelineLayout(descriptor);
        this.#pipelineLayouts.set(key, layout);
        return layout;
    }

    getRenderPipelineCacheKey(descriptor: GPURenderPipelineDescriptor): string {
        return renderPipelineKey(descriptor, object => this.#objectId(object));
    }

    createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline {
        const key = this.getRenderPipelineCacheKey(descriptor);
        const cached = this.#renderPipelines.get(key);
        if (cached) {
            this.#diagnostics?.record('renderPipelineCacheHits');
            return cached;
        }
        if (this.#pendingRenderPipelines.has(key)) {
            throw new Error(
                'Cannot synchronously create a WebGPU pipeline while the same pipeline is compiling asynchronously'
            );
        }
        this.#diagnostics?.record('renderPipelineCreations');
        const pipeline = this.#device.createRenderPipeline(descriptor);
        this.#renderPipelines.set(key, pipeline);
        return pipeline;
    }

    createRenderPipelineAsync(descriptor: GPURenderPipelineDescriptor): Promise<GPURenderPipeline> {
        const key = this.getRenderPipelineCacheKey(descriptor);
        const cached = this.#renderPipelines.get(key);
        if (cached) {
            this.#diagnostics?.record('renderPipelineCacheHits');
            return Promise.resolve(cached);
        }
        const pending = this.#pendingRenderPipelines.get(key);
        if (pending) {
            this.#diagnostics?.record('renderPipelineCacheHits');
            return pending;
        }
        this.#diagnostics?.record('renderPipelineCreations');
        const generation = this.#renderPipelineGeneration;
        const compilation = this.#device.createRenderPipelineAsync(descriptor).then(
            pipeline => {
                if (
                    generation === this.#renderPipelineGeneration &&
                    this.#pendingRenderPipelines.get(key) === compilation
                ) {
                    this.#pendingRenderPipelines.delete(key);
                    this.#renderPipelines.set(key, pipeline);
                }
                return pipeline;
            },
            (error: unknown) => {
                if (this.#pendingRenderPipelines.get(key) === compilation) {
                    this.#pendingRenderPipelines.delete(key);
                }
                throw error;
            }
        );
        this.#pendingRenderPipelines.set(key, compilation);
        return compilation;
    }

    clearRenderPipelines(): void {
        this.#renderPipelineGeneration++;
        this.#pendingRenderPipelines.clear();
        this.#renderPipelines.clear();
    }

    clear(): void {
        this.#samplers.clear();
        this.#bindGroupLayouts.clear();
        this.#pipelineLayouts.clear();
        this.clearRenderPipelines();
    }
}

const caches = new WeakMap<GPUDevice, WebGPUNativeDeviceCache>();

/** @internal */
export function getWebGPUNativeDeviceCache(
    device: GPUDevice,
    options: WebGPUNativeDeviceCacheOptions = {}
): WebGPUNativeDeviceCache {
    const cached = caches.get(device);
    if (cached) {
        if (options.diagnostics !== undefined) {
            cached.attachDiagnostics(options.diagnostics);
        }
        return cached;
    }
    const created = new WebGPUNativeDeviceCache(device, options);
    caches.set(device, created);
    return created;
}
