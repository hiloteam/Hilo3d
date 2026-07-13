import type { WebGPURenderState } from './WebGPURenderState';

export interface WebGPUVertexPipelineStage {
    readonly module: GPUShaderModule;
    readonly entryPoint?: string;
    readonly constants?: Readonly<Record<string, GPUPipelineConstantValue>>;
    readonly buffers?: readonly (GPUVertexBufferLayout | null)[];
}

export interface WebGPUFragmentPipelineStage {
    readonly module: GPUShaderModule;
    readonly entryPoint?: string;
    readonly constants?: Readonly<Record<string, GPUPipelineConstantValue>>;
}

export interface WebGPURenderPipelineRequest {
    readonly label?: string;
    /** Explicit layouts preserve the engine's four-bind-group ABI; auto layout is intentionally unsupported. */
    readonly layout: GPUPipelineLayout;
    readonly vertex: WebGPUVertexPipelineStage;
    readonly fragment?: WebGPUFragmentPipelineStage;
    readonly renderState: WebGPURenderState;
}

interface PipelinePreparation {
    readonly descriptor: GPURenderPipelineDescriptor;
    readonly key: string;
}

export const DEFAULT_WEBGPU_PIPELINE_CACHE_CAPACITY = 256;

function sortedConstants(
    constants: Readonly<Record<string, GPUPipelineConstantValue>> | undefined
): Record<string, GPUPipelineConstantValue> | undefined {
    if (!constants) return undefined;
    const result: Record<string, GPUPipelineConstantValue> = {};
    for (const name of Object.keys(constants).sort()) {
        const value = constants[name];
        if (value === undefined) continue;
        if (typeof value === 'number' && !Number.isFinite(value)) {
            throw new TypeError(`Pipeline constant ${name} must be finite`);
        }
        result[name] = value;
    }
    return Object.freeze(result);
}

function snapshotVertexBuffers(
    buffers: readonly (GPUVertexBufferLayout | null)[] | undefined
): (GPUVertexBufferLayout | null)[] | undefined {
    if (!buffers) return undefined;
    return buffers.map(buffer => {
        if (buffer === null) return null;
        const attributes = [...buffer.attributes]
            .map(attribute => ({
                format: attribute.format,
                offset: attribute.offset,
                shaderLocation: attribute.shaderLocation
            }))
            .sort(
                (left, right) =>
                    left.shaderLocation - right.shaderLocation || left.offset - right.offset
            );
        return {
            arrayStride: buffer.arrayStride,
            stepMode: buffer.stepMode ?? 'vertex',
            attributes
        };
    });
}

function snapshotColorTargets(
    targets: readonly (GPUColorTargetState | null)[]
): (GPUColorTargetState | null)[] {
    return targets.map(target => {
        if (target === null) return null;
        return {
            format: target.format,
            ...(target.writeMask === undefined ? {} : { writeMask: target.writeMask }),
            ...(target.blend
                ? {
                      blend: {
                          color: { ...target.blend.color },
                          alpha: { ...target.blend.alpha }
                      }
                  }
                : {})
        };
    });
}

function descriptorFromRequest(request: WebGPURenderPipelineRequest): GPURenderPipelineDescriptor {
    const constants = sortedConstants(request.vertex.constants);
    const buffers = snapshotVertexBuffers(request.vertex.buffers);
    const vertex: GPUVertexState = {
        module: request.vertex.module,
        ...(request.vertex.entryPoint === undefined
            ? {}
            : { entryPoint: request.vertex.entryPoint }),
        ...(constants === undefined ? {} : { constants }),
        ...(buffers === undefined ? {} : { buffers })
    };

    let fragment: GPUFragmentState | undefined;
    if (request.fragment) {
        const fragmentConstants = sortedConstants(request.fragment.constants);
        fragment = {
            module: request.fragment.module,
            ...(request.fragment.entryPoint === undefined
                ? {}
                : { entryPoint: request.fragment.entryPoint }),
            ...(fragmentConstants === undefined ? {} : { constants: fragmentConstants }),
            targets: snapshotColorTargets(request.renderState.colorTargets)
        };
    } else if (request.renderState.colorTargets.length > 0) {
        throw new Error('Color targets require a fragment shader stage');
    }

    return {
        ...(request.label === undefined ? {} : { label: request.label }),
        layout: request.layout,
        vertex,
        ...(fragment === undefined ? {} : { fragment }),
        primitive: { ...request.renderState.primitive },
        ...(request.renderState.depthStencil === undefined
            ? {}
            : {
                  depthStencil: {
                      ...request.renderState.depthStencil,
                      ...(request.renderState.depthStencil.stencilFront
                          ? { stencilFront: { ...request.renderState.depthStencil.stencilFront } }
                          : {}),
                      ...(request.renderState.depthStencil.stencilBack
                          ? { stencilBack: { ...request.renderState.depthStencil.stencilBack } }
                          : {})
                  }
              }),
        multisample: { ...request.renderState.multisample }
    };
}

function stageKey(
    stage: WebGPUVertexPipelineStage | WebGPUFragmentPipelineStage,
    objectId: (object: object) => number
): object {
    const constants = sortedConstants(stage.constants) ?? null;
    const buffers = 'buffers' in stage ? (snapshotVertexBuffers(stage.buffers) ?? null) : undefined;
    return {
        module: objectId(stage.module),
        entryPoint: stage.entryPoint ?? null,
        constants,
        ...(buffers === undefined ? {} : { buffers })
    };
}

/**
 * Per-device render-pipeline cache. Pending compilations remain deduplicated until they settle;
 * capacity bounds only the completed pipeline LRU.
 */
export class WebGPUPipelineManager {
    private readonly device: GPUDevice;
    private readonly capacity: number;
    /** Pending work is transient and must never be evicted because it is the in-flight deduplication key. */
    private readonly pendingPipelines = new Map<string, Promise<GPURenderPipeline>>();
    /** Map insertion order is the settled-pipeline LRU order, oldest first. */
    private readonly settledPipelines = new Map<string, GPURenderPipeline>();
    private readonly objectIds = new WeakMap<object, number>();
    private nextObjectId = 1;

    constructor(device: GPUDevice, capacity = DEFAULT_WEBGPU_PIPELINE_CACHE_CAPACITY) {
        if (!Number.isSafeInteger(capacity) || capacity < 1) {
            throw new RangeError('WebGPU pipeline cache capacity must be a positive integer');
        }
        this.device = device;
        this.capacity = capacity;
    }

    get size(): number {
        return this.pendingPipelines.size + this.settledPipelines.size;
    }

    private getObjectId(object: object): number {
        let id = this.objectIds.get(object);
        if (id === undefined) {
            id = this.nextObjectId++;
            this.objectIds.set(object, id);
        }
        return id;
    }

    private getSettled(key: string): GPURenderPipeline | undefined {
        const pipeline = this.settledPipelines.get(key);
        if (!pipeline) return undefined;
        this.settledPipelines.delete(key);
        this.settledPipelines.set(key, pipeline);
        return pipeline;
    }

    private settle(key: string, pipeline: GPURenderPipeline): void {
        this.settledPipelines.delete(key);
        this.settledPipelines.set(key, pipeline);
        while (this.settledPipelines.size > this.capacity) {
            const oldestKey = this.settledPipelines.keys().next().value;
            if (oldestKey === undefined) break;
            this.settledPipelines.delete(oldestKey);
        }
    }

    private prepare(request: WebGPURenderPipelineRequest): PipelinePreparation {
        const descriptor = descriptorFromRequest(request);
        const key = JSON.stringify({
            layout: this.getObjectId(request.layout),
            vertex: stageKey(request.vertex, object => this.getObjectId(object)),
            fragment: request.fragment
                ? stageKey(request.fragment, object => this.getObjectId(object))
                : null,
            renderState: {
                primitive: descriptor.primitive ?? null,
                colorTargets: descriptor.fragment?.targets ?? [],
                depthStencil: descriptor.depthStencil ?? null,
                multisample: descriptor.multisample ?? null
            }
        });
        return { descriptor, key };
    }

    /** Exposed for diagnostics and deterministic cache tests; labels never affect the key. */
    getCacheKey(request: WebGPURenderPipelineRequest): string {
        return this.prepare(request).key;
    }

    /**
     * Compile or reuse a pipeline. Concurrent requests for the same descriptor share one promise.
     * Failed compilations are evicted so a corrected/recovered device can retry.
     */
    getPipeline(request: WebGPURenderPipelineRequest): Promise<GPURenderPipeline> {
        const { descriptor, key } = this.prepare(request);
        const settled = this.getSettled(key);
        if (settled) return Promise.resolve(settled);

        const cached = this.pendingPipelines.get(key);
        if (cached) return cached;

        const compilation = this.device.createRenderPipelineAsync(descriptor);
        const pending = compilation.then(
            pipeline => {
                if (this.pendingPipelines.get(key) === pending) {
                    this.pendingPipelines.delete(key);
                    this.settle(key, pipeline);
                }
                return pipeline;
            },
            (error: unknown) => {
                if (this.pendingPipelines.get(key) === pending) {
                    this.pendingPipelines.delete(key);
                }
                throw error;
            }
        );
        this.pendingPipelines.set(key, pending);
        return pending;
    }

    /** Compile synchronously for an on-demand draw while retaining the same complete cache key. */
    getPipelineSync(request: WebGPURenderPipelineRequest): GPURenderPipeline {
        const { descriptor, key } = this.prepare(request);
        const settled = this.getSettled(key);
        if (settled) return settled;
        if (this.pendingPipelines.has(key)) {
            throw new Error(
                'Cannot synchronously compile a WebGPU pipeline while the same pipeline is compiling asynchronously'
            );
        }
        const pipeline = this.device.createRenderPipeline(descriptor);
        this.settle(key, pipeline);
        return pipeline;
    }

    clear(): void {
        this.pendingPipelines.clear();
        this.settledPipelines.clear();
    }
}
