import type { RHIBackend, RHIBindGroupLayoutEntry, RHICreateOptions, RHIFeatureName } from '../RHI';
import type { WebGPUDevice } from './WebGPUDevice';

const WEBGPU_BACKEND: RHIBackend = 'webgpu';
export const WEBGPU_MAP_READ = 0x1;
export const WEBGPU_MAP_WRITE = 0x2;
export const DEFAULT_TEXTURE_USAGE = 0x10;
export const EMPTY_BIND_GROUP_LAYOUT_ENTRIES: readonly RHIBindGroupLayoutEntry[] = Object.freeze(
    []
);

let nextObjectId = 1;

export const owners = new WeakMap<object, WebGPUDevice>();

function nextId(): number {
    return nextObjectId++;
}

export function labelOf(nativeObject: { readonly label?: string }, requested?: string): string {
    return requested ?? nativeObject.label ?? '';
}

export function assertOwner(object: object, device: WebGPUDevice, kind: string): void {
    if (owners.get(object) !== device) {
        throw new TypeError(`${kind} belongs to a different WebGPU device`);
    }
}

export abstract class WebGPUObject {
    readonly id = nextId();
    readonly backend = WEBGPU_BACKEND;
    readonly label: string;

    protected constructor(label: string) {
        this.label = label;
    }
}

export abstract class WebGPUDestroyableObject extends WebGPUObject {
    #destroyed = false;

    get destroyed(): boolean {
        return this.#destroyed;
    }

    protected assertAlive(kind: string): void {
        if (this.#destroyed) throw new Error(`${kind} is destroyed`);
    }

    protected markDestroyed(): boolean {
        if (this.#destroyed) return false;
        this.#destroyed = true;
        return true;
    }
}

export interface WebGPURHIDiagnosticsSnapshot {
    readonly bufferCreations: number;
    readonly textureCreations: number;
    readonly samplerCreations: number;
    readonly shaderModuleCreations: number;
    readonly bindGroupLayoutCreations: number;
    readonly pipelineLayoutCreations: number;
    readonly bindGroupCreations: number;
    readonly renderPipelineCreations: number;
    readonly commandEncoderCreations: number;
    readonly submissions: number;
    readonly samplerCacheHits: number;
    readonly bindGroupLayoutCacheHits: number;
    readonly pipelineLayoutCacheHits: number;
    readonly renderPipelineCacheHits: number;
}

type DiagnosticCounter = keyof WebGPURHIDiagnosticsSnapshot;

/** Opt-in counters intended for contract tests and renderer diagnostics. */
export class WebGPURHIDiagnostics implements WebGPURHIDiagnosticsSnapshot {
    bufferCreations = 0;
    textureCreations = 0;
    samplerCreations = 0;
    shaderModuleCreations = 0;
    bindGroupLayoutCreations = 0;
    pipelineLayoutCreations = 0;
    bindGroupCreations = 0;
    renderPipelineCreations = 0;
    commandEncoderCreations = 0;
    submissions = 0;
    samplerCacheHits = 0;
    bindGroupLayoutCacheHits = 0;
    pipelineLayoutCacheHits = 0;
    renderPipelineCacheHits = 0;

    /** @internal */
    record(counter: DiagnosticCounter): void {
        this[counter]++;
    }

    snapshot(): Readonly<WebGPURHIDiagnosticsSnapshot> {
        return Object.freeze({
            bufferCreations: this.bufferCreations,
            textureCreations: this.textureCreations,
            samplerCreations: this.samplerCreations,
            shaderModuleCreations: this.shaderModuleCreations,
            bindGroupLayoutCreations: this.bindGroupLayoutCreations,
            pipelineLayoutCreations: this.pipelineLayoutCreations,
            bindGroupCreations: this.bindGroupCreations,
            renderPipelineCreations: this.renderPipelineCreations,
            commandEncoderCreations: this.commandEncoderCreations,
            submissions: this.submissions,
            samplerCacheHits: this.samplerCacheHits,
            bindGroupLayoutCacheHits: this.bindGroupLayoutCacheHits,
            pipelineLayoutCacheHits: this.pipelineLayoutCacheHits,
            renderPipelineCacheHits: this.renderPipelineCacheHits
        });
    }
}

export interface WebGPURHICreateOptions extends RHICreateOptions {
    /** Keep disabled in production unless counters are actively consumed. */
    readonly diagnostics?: boolean;
    readonly forceFallbackAdapter?: boolean;
    readonly rejectFallbackAdapter?: boolean;
    /** Native features to enable when the selected adapter exposes them. @internal */
    readonly optionalFeatures?: readonly RHIFeatureName[];
    /** Renderer-only native features kept outside the portable RHI capability surface. @internal */
    readonly nativeRequiredFeatures?: readonly GPUFeatureName[];
    /** Renderer-only native optional features kept outside the portable capability surface. @internal */
    readonly nativeOptionalFeatures?: readonly GPUFeatureName[];
    /** Engine-specific adapter validation performed before requesting a device. @internal */
    readonly adapterValidator?: (adapter: GPUAdapter) => void;
    /** Preserve legacy native descriptor shape for renderer integration. @internal */
    readonly includeEmptyDeviceDescriptorFields?: boolean;
}

/** Adapter-only probe options. The callback must not create a device or GPU resource. */
export interface WebGPUAdapterProbeOptions {
    readonly powerPreference?: GPUPowerPreference;
    readonly forceFallbackAdapter?: boolean;
    readonly adapterValidator?: (adapter: GPUAdapter) => void;
}
