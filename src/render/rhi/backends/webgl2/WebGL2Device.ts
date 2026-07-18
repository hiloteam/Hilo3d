import {
    RHICacheCounter,
    type RHIObjectIdAllocator,
    type RHIExecutionInteropHost,
    RHIValidationError,
    allocateRHIDeviceId,
    assertRHIObjectOwnedBy,
    createRHIObjectIdAllocator,
    type RHIBindGroup,
    type RHIBindGroupDescriptor,
    type RHIBindGroupLayoutDescriptor,
    type RHIBindingResource,
    type RHIBuffer,
    type RHIBufferDescriptor,
    type RHIDevice,
    type RHIDeviceLostInfo,
    type RHIDeviceOwnedObject,
    type RHIComputePipeline,
    type RHIComputePipelineDescriptor,
    type RHIGraphicsPipeline,
    type RHIGraphicsPipelineDescriptor,
    type RHIPipelineLayoutDescriptor,
    type RHISampler,
    type RHISamplerDescriptor,
    type RHIShader,
    type RHIShaderDescriptor,
    type RHITexture,
    type RHITextureDescriptor,
    type RHITextureView
} from '../../core';
import type { RHIDiagnosticNativeObjectKind, RHIDiagnosticsSink } from '../../RHIDiagnosticsSink';
import { WebGL2Capabilities } from './WebGL2Capabilities';
import { WebGL2FramebufferCache, WebGL2Queue } from './WebGL2Commands';
import {
    WebGL2BindGroup,
    WebGL2BindGroupLayout,
    WebGL2GraphicsPipeline,
    WebGL2PipelineLayout
} from './WebGL2Pipeline';
import {
    WebGL2Buffer,
    WebGL2Sampler,
    WebGL2Shader,
    WebGL2Texture,
    WebGL2TextureView
} from './WebGL2Resources';
import { WebGL2StateTracker } from './WebGL2State';
import { WebGL2Surface } from './WebGL2Surface';
import {
    WebGL2NativePresentationState,
    resolveWebGL2NativeExtension
} from './WebGL2NativeExtension';
import {
    WEBGL2_BIND_GROUP_OBJECT_KIND,
    WEBGL2_BUFFER_OBJECT_KIND,
    WEBGL2_GRAPHICS_PIPELINE_OBJECT_KIND,
    WEBGL2_SAMPLER_OBJECT_KIND,
    WEBGL2_SHADER_OBJECT_KIND,
    WEBGL2_TEXTURE_OBJECT_KIND,
    WEBGL2_TEXTURE_VIEW_OBJECT_KIND,
    hasWebGL2ObjectKind,
    type WebGL2DestroyableBase
} from './WebGL2Internal';

export interface WebGL2DeviceOptions extends WebGLContextAttributes {
    readonly label?: string;
    /** @internal Allocation-free renderer diagnostics channel. */
    readonly diagnosticsSink?: RHIDiagnosticsSink;
}

interface Deferred<T> {
    readonly promise: Promise<T>;
    resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
    let resolvePromise: ((value: T) => void) | undefined;
    const promise = new Promise<T>(resolve => {
        resolvePromise = resolve;
    });
    return { promise, resolve: value => resolvePromise?.(value) };
}

function isContext(
    value: HTMLCanvasElement | WebGL2RenderingContext
): value is WebGL2RenderingContext {
    return 'createBuffer' in value && typeof value.createBuffer === 'function';
}

function emptyDiagnostics() {
    return {
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
    };
}

/** Concrete headless-capable WebGL2 RHI device. Commands execute immediately. */
export class WebGL2RHIDevice implements RHIDevice {
    readonly id = allocateRHIDeviceId();
    readonly backend = 'webgl2' as const;
    readonly capabilities: WebGL2Capabilities;
    readonly lost: Promise<RHIDeviceLostInfo>;
    readonly gl: WebGL2RenderingContext;
    readonly canvas: HTMLCanvasElement;
    readonly state: WebGL2StateTracker;
    readonly nativePresentation: WebGL2NativePresentationState;
    /** Native VAOs cached across render passes and pipelines for this device generation. */
    readonly vertexInputCacheMetrics = new RHICacheCounter();
    readonly framebufferCacheMetrics = new RHICacheCounter();
    readonly framebufferCache: WebGL2FramebufferCache;
    label?: string;
    destroyed = false;
    /** @internal Stable data-property access for backend hot-path generation checks. */
    generationValue = 1;
    readonly #objectIds: RHIObjectIdAllocator;
    readonly #destroyables = new Set<WebGL2DestroyableBase>();
    readonly #lostSignal = deferred<RHIDeviceLostInfo>();
    #lostState = false;
    readonly #graphicsQueue: WebGL2Queue;
    readonly #diagnosticsSink: RHIDiagnosticsSink | null;
    currentDiagnostics = emptyDiagnostics();

    constructor(
        source: HTMLCanvasElement | WebGL2RenderingContext,
        options: WebGL2DeviceOptions = {}
    ) {
        const { diagnosticsSink = null, label, ...contextAttributes } = options;
        const gl = isContext(source) ? source : source.getContext('webgl2', contextAttributes);
        if (gl === null) throw new Error('WebGL2 is unavailable');
        if (!(gl.canvas instanceof HTMLCanvasElement)) {
            throw new Error('RHI WebGL2 surfaces require an HTMLCanvasElement-backed context');
        }
        this.gl = gl;
        this.canvas = gl.canvas;
        this.label = label ?? 'WebGL2 RHI device';
        this.#diagnosticsSink = diagnosticsSink;
        this.#objectIds = createRHIObjectIdAllocator(this.id);
        this.capabilities = new WebGL2Capabilities(gl);
        this.state = new WebGL2StateTracker(gl);
        this.nativePresentation = new WebGL2NativePresentationState(this);
        this.framebufferCache = new WebGL2FramebufferCache(this, this.framebufferCacheMetrics);
        this.lost = this.#lostSignal.promise;
        this.#graphicsQueue = this.createQueue();
        this.canvas.addEventListener('webglcontextlost', this.handleContextLost, false);
    }

    get generation(): number {
        return this.generationValue;
    }

    get deviceGeneration(): number {
        return this.generationValue;
    }

    get graphicsQueue(): WebGL2Queue {
        return this.#graphicsQueue;
    }

    allocateObjectId(): number {
        return this.#objectIds.allocate();
    }

    registerDestroyable(object: WebGL2DestroyableBase): void {
        this.#destroyables.add(object);
    }

    unregisterDestroyable(object: WebGL2DestroyableBase): void {
        this.#destroyables.delete(object);
    }

    /** @internal Called only after a concrete WebGL object has been created successfully. */
    recordNativeObjectCreated(kind: RHIDiagnosticNativeObjectKind, count = 1): void {
        this.#diagnosticsSink?.recordNativeObjectCreated(kind, count);
    }

    /** @internal Called after explicit deletion or context-loss invalidation. */
    recordNativeObjectDestroyed(kind: RHIDiagnosticNativeObjectKind, count = 1): void {
        this.#diagnosticsSink?.recordNativeObjectDestroyed(kind, count);
    }

    assertObjectUsable(object: RHIDeviceOwnedObject, path = 'object'): void {
        assertRHIObjectOwnedBy(this, object, path);
        if (this.#lostState)
            throw new RHIValidationError('invalid-state', 'device context is lost', path);
    }

    assertNoNativeError(operation: string): void {
        const error = this.gl.getError();
        if (error !== this.gl.NO_ERROR) {
            this.discardNativeErrors();
            throw new Error(`${operation} failed with WebGL error 0x${error.toString(16)}`);
        }
    }

    /** @internal Clear sticky native errors on an aborted execution path. */
    discardNativeErrors(): void {
        while (this.gl.getError() !== this.gl.NO_ERROR) {
            // WebGL errors are a bounded sticky queue; drain it before the next frame.
        }
    }

    createBuffer(descriptor: RHIBufferDescriptor): WebGL2Buffer {
        this.assertAlive();
        return new WebGL2Buffer(this, descriptor);
    }

    createTexture(descriptor: RHITextureDescriptor): WebGL2Texture {
        this.assertAlive();
        return new WebGL2Texture(this, descriptor);
    }

    createSampler(descriptor: RHISamplerDescriptor = {}): WebGL2Sampler {
        this.assertAlive();
        return new WebGL2Sampler(this, descriptor);
    }

    createShader(descriptor: RHIShaderDescriptor): WebGL2Shader {
        this.assertAlive();
        return new WebGL2Shader(this, descriptor);
    }

    createBindGroupLayout(descriptor: RHIBindGroupLayoutDescriptor): WebGL2BindGroupLayout {
        this.assertAlive();
        return new WebGL2BindGroupLayout(this, descriptor);
    }

    createPipelineLayout(descriptor: RHIPipelineLayoutDescriptor): WebGL2PipelineLayout {
        this.assertAlive();
        return new WebGL2PipelineLayout(this, descriptor);
    }

    createBindGroup(descriptor: RHIBindGroupDescriptor): WebGL2BindGroup {
        this.assertAlive();
        return new WebGL2BindGroup(this, descriptor);
    }

    createGraphicsPipeline(descriptor: RHIGraphicsPipelineDescriptor): WebGL2GraphicsPipeline {
        this.assertAlive();
        return new WebGL2GraphicsPipeline(this, descriptor);
    }

    createComputePipeline(_descriptor: RHIComputePipelineDescriptor): RHIComputePipeline {
        this.assertAlive();
        throw new RHIValidationError(
            'unsupported-feature',
            'WebGL2 does not support compute pipelines',
            'computePipeline'
        );
    }

    createSurface(canvas: HTMLCanvasElement): WebGL2Surface {
        this.assertAlive();
        if (canvas !== this.canvas) {
            throw new RHIValidationError(
                'wrong-device',
                'WebGL2 surface must use the device context canvas',
                'surface.canvas'
            );
        }
        return new WebGL2Surface(this, canvas);
    }

    resolveInteropExtension(name: string, host: RHIExecutionInteropHost): object | null {
        this.assertAlive();
        return resolveWebGL2NativeExtension(this, name, host);
    }

    requireBuffer(value: RHIBuffer): WebGL2Buffer {
        const concrete = value as WebGL2Buffer;
        if (
            !this.destroyed &&
            hasWebGL2ObjectKind(value, WEBGL2_BUFFER_OBJECT_KIND) &&
            concrete.owner === this &&
            concrete.deviceId === this.id &&
            concrete.deviceGeneration === this.generationValue &&
            !concrete.destroyed
        ) {
            return concrete;
        }
        assertRHIObjectOwnedBy(this, value, 'buffer');
        if (!(value instanceof WebGL2Buffer))
            throw new RHIValidationError(
                'wrong-device',
                'buffer is not a WebGL2 backend object',
                'buffer'
            );
        return value;
    }

    requireTexture(value: RHITexture): WebGL2Texture {
        const concrete = value as WebGL2Texture;
        if (
            !this.destroyed &&
            hasWebGL2ObjectKind(value, WEBGL2_TEXTURE_OBJECT_KIND) &&
            concrete.owner === this &&
            concrete.deviceId === this.id &&
            concrete.deviceGeneration === this.generationValue &&
            !concrete.destroyed
        ) {
            return concrete;
        }
        assertRHIObjectOwnedBy(this, value, 'texture');
        if (!(value instanceof WebGL2Texture))
            throw new RHIValidationError(
                'wrong-device',
                'texture is not a WebGL2 backend object',
                'texture'
            );
        return value;
    }

    requireTextureView(value: RHIBindingResource | RHITextureView): WebGL2TextureView {
        const concrete = value as WebGL2TextureView;
        const texture = concrete.texture;
        if (
            !this.destroyed &&
            hasWebGL2ObjectKind(value, WEBGL2_TEXTURE_VIEW_OBJECT_KIND) &&
            concrete.owner === this &&
            concrete.deviceId === this.id &&
            concrete.deviceGeneration === this.generationValue &&
            !concrete.destroyed &&
            hasWebGL2ObjectKind(texture, WEBGL2_TEXTURE_OBJECT_KIND) &&
            texture.owner === this &&
            texture.deviceId === this.id &&
            texture.deviceGeneration === this.generationValue &&
            !texture.destroyed
        ) {
            return concrete;
        }
        if (!(value instanceof WebGL2TextureView))
            throw new RHIValidationError(
                'wrong-device',
                'resource is not a WebGL2 texture view',
                'textureView'
            );
        assertRHIObjectOwnedBy(this, value, 'textureView');
        assertRHIObjectOwnedBy(this, value.texture, 'textureView.texture');
        return value;
    }

    requireSampler(value: RHIBindingResource | RHISampler): WebGL2Sampler {
        const concrete = value as WebGL2Sampler;
        if (
            !this.destroyed &&
            hasWebGL2ObjectKind(value, WEBGL2_SAMPLER_OBJECT_KIND) &&
            concrete.owner === this &&
            concrete.deviceId === this.id &&
            concrete.deviceGeneration === this.generationValue &&
            !concrete.destroyed
        ) {
            return concrete;
        }
        if (!(value instanceof WebGL2Sampler))
            throw new RHIValidationError(
                'wrong-device',
                'resource is not a WebGL2 sampler',
                'sampler'
            );
        assertRHIObjectOwnedBy(this, value, 'sampler');
        return value;
    }

    requireShader(value: RHIShader): WebGL2Shader {
        const concrete = value as WebGL2Shader;
        if (
            !this.destroyed &&
            hasWebGL2ObjectKind(value, WEBGL2_SHADER_OBJECT_KIND) &&
            concrete.owner === this &&
            concrete.deviceId === this.id &&
            concrete.deviceGeneration === this.generationValue &&
            !concrete.destroyed
        ) {
            return concrete;
        }
        assertRHIObjectOwnedBy(this, value, 'shader');
        if (!(value instanceof WebGL2Shader))
            throw new RHIValidationError(
                'wrong-device',
                'shader is not a WebGL2 backend object',
                'shader'
            );
        return value;
    }

    requirePipeline(value: RHIGraphicsPipeline): WebGL2GraphicsPipeline {
        const concrete = value as WebGL2GraphicsPipeline;
        if (
            !this.destroyed &&
            hasWebGL2ObjectKind(value, WEBGL2_GRAPHICS_PIPELINE_OBJECT_KIND) &&
            concrete.owner === this &&
            concrete.deviceId === this.id &&
            concrete.deviceGeneration === this.generationValue &&
            !concrete.destroyed
        ) {
            return concrete;
        }
        assertRHIObjectOwnedBy(this, value, 'graphicsPipeline');
        if (!(value instanceof WebGL2GraphicsPipeline))
            throw new RHIValidationError(
                'wrong-device',
                'pipeline is not a WebGL2 backend object',
                'graphicsPipeline'
            );
        return value;
    }

    requireBindGroup(value: RHIBindGroup): WebGL2BindGroup {
        const concrete = value as WebGL2BindGroup;
        if (
            !this.destroyed &&
            hasWebGL2ObjectKind(value, WEBGL2_BIND_GROUP_OBJECT_KIND) &&
            concrete.owner === this &&
            concrete.deviceId === this.id &&
            concrete.deviceGeneration === this.generationValue &&
            !concrete.destroyed
        ) {
            return concrete;
        }
        assertRHIObjectOwnedBy(this, value, 'bindGroup');
        if (!(value instanceof WebGL2BindGroup))
            throw new RHIValidationError(
                'wrong-device',
                'bind group is not a WebGL2 backend object',
                'bindGroup'
            );
        return value;
    }

    destroy(): void {
        if (this.destroyed) return;
        const generation = this.generationValue;
        this.#graphicsQueue.handleDeviceDestroyed(new Error('WebGL2 device destroyed'));
        this.nativePresentation.release();
        this.framebufferCache.clear(false);
        this.destroyed = true;
        this.canvas.removeEventListener('webglcontextlost', this.handleContextLost, false);
        for (const object of [...this.#destroyables]) object.destroy();
        this.#lostSignal.resolve({
            reason: 'destroyed',
            message: 'WebGL2 device destroyed',
            generation
        });
    }

    private assertAlive(): void {
        if (this.destroyed)
            throw new RHIValidationError('destroyed-object', 'device is destroyed', 'device');
        if (this.#lostState)
            throw new RHIValidationError('invalid-state', 'WebGL2 context is lost', 'device');
    }

    private createQueue(): WebGL2Queue {
        return new WebGL2Queue(this);
    }

    private readonly handleContextLost = (event: Event): void => {
        if (this.destroyed || this.#lostState) return;
        if ('preventDefault' in event) event.preventDefault();
        const lostGeneration = this.generationValue;
        this.#lostState = true;
        this.generationValue++;
        this.#graphicsQueue.handleContextLost(new Error('WebGL2 context lost'));
        this.nativePresentation.release();
        this.framebufferCache.clear(true);
        for (const object of this.#destroyables) object.invalidateForDeviceLoss();
        this.#destroyables.clear();
        this.state.reset();
        this.#lostSignal.resolve({
            reason: 'context-lost',
            message: 'WebGL2 context lost',
            generation: lostGeneration
        });
    };
}

export function createWebGL2RHIDevice(
    source: HTMLCanvasElement | WebGL2RenderingContext,
    options: WebGL2DeviceOptions = {}
): WebGL2RHIDevice {
    return new WebGL2RHIDevice(source, options);
}

/** Probe availability without constructing capabilities, state, or any native resource. */
export function isWebGL2RHIAvailable(
    canvas: HTMLCanvasElement,
    options: WebGLContextAttributes = {}
): boolean {
    try {
        return canvas.getContext('webgl2', options) !== null;
    } catch {
        return false;
    }
}

/** Wait for the canvas-owned WebGL2 context generation to become usable again. */
export function waitForWebGL2RHIContextRestored(
    canvas: HTMLCanvasElement,
    options: WebGLContextAttributes = {}
): Promise<void> {
    let context: WebGL2RenderingContext | null;
    try {
        context = canvas.getContext('webgl2', options);
    } catch {
        return Promise.resolve();
    }
    if (!context?.isContextLost()) return Promise.resolve();
    return new Promise<void>(resolve => {
        const restored = (): void => {
            canvas.removeEventListener('webglcontextrestored', restored);
            resolve();
        };
        canvas.addEventListener('webglcontextrestored', restored);
        // Close the observation race if restoration completed between the first check and listener.
        if (!context.isContextLost()) restored();
    });
}
