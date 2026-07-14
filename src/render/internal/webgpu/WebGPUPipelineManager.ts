import { WebGPUDevice } from '../../rhi/webgpu/WebGPUDevice';
import {
    DEFAULT_WEBGPU_NATIVE_CACHE_CAPACITY,
    getWebGPUNativeDeviceCache,
    type WebGPUNativeDeviceCache
} from '../../rhi/webgpu/WebGPUNativeCache';
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

export const DEFAULT_WEBGPU_PIPELINE_CACHE_CAPACITY = DEFAULT_WEBGPU_NATIVE_CACHE_CAPACITY;

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

/**
 * Renderer-facing pipeline descriptor builder. Immutable native pipeline ownership lives in the
 * device-scoped RHI cache, including pending compilation deduplication and the settled LRU.
 */
export class WebGPUPipelineManager {
    private readonly rhiDevice: WebGPUDevice | null;
    private readonly nativeCache: WebGPUNativeDeviceCache;

    constructor(
        deviceOrOwner: GPUDevice | WebGPUDevice,
        rhiDeviceOrCapacity: WebGPUDevice | number = DEFAULT_WEBGPU_PIPELINE_CACHE_CAPACITY
    ) {
        if (deviceOrOwner instanceof WebGPUDevice) {
            this.rhiDevice = deviceOrOwner;
            this.nativeCache = deviceOrOwner.nativeCache;
            return;
        }
        if (typeof rhiDeviceOrCapacity === 'number') {
            this.rhiDevice = null;
            this.nativeCache = getWebGPUNativeDeviceCache(deviceOrOwner, {
                renderPipelineCapacity: rhiDeviceOrCapacity
            });
            return;
        }
        if (rhiDeviceOrCapacity.nativeDevice !== deviceOrOwner) {
            throw new TypeError('WebGPU pipeline manager and RHI device must share a GPUDevice');
        }
        this.rhiDevice = rhiDeviceOrCapacity;
        this.nativeCache = rhiDeviceOrCapacity.nativeCache;
    }

    get size(): number {
        return this.nativeCache.renderPipelineSize;
    }

    /** Exposed for diagnostics and deterministic cache tests; labels never affect the key. */
    getCacheKey(request: WebGPURenderPipelineRequest): string {
        const descriptor = descriptorFromRequest(request);
        return (
            this.rhiDevice?.getNativeRenderPipelineCacheKey(descriptor) ??
            this.nativeCache.getRenderPipelineCacheKey(descriptor)
        );
    }

    /**
     * Compile or reuse a pipeline. Concurrent requests for the same descriptor share one promise.
     * Failed compilations are evicted so a corrected/recovered device can retry.
     */
    getPipeline(request: WebGPURenderPipelineRequest): Promise<GPURenderPipeline> {
        const descriptor = descriptorFromRequest(request);
        return (
            this.rhiDevice?.createNativeRenderPipelineAsync(descriptor) ??
            this.nativeCache.createRenderPipelineAsync(descriptor)
        );
    }

    /** Compile synchronously for an on-demand draw while retaining the same complete cache key. */
    getPipelineSync(request: WebGPURenderPipelineRequest): GPURenderPipeline {
        const descriptor = descriptorFromRequest(request);
        return (
            this.rhiDevice?.createNativeRenderPipeline(descriptor) ??
            this.nativeCache.createRenderPipeline(descriptor)
        );
    }

    clear(): void {
        this.nativeCache.clearRenderPipelines();
    }
}
