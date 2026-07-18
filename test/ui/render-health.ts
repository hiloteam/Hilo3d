import type { Page } from '@playwright/test';
import type { ExampleBackend } from './example-paths';

export interface RenderHealthSnapshot {
    readonly webgl2Contexts: number;
    readonly webgl2ClearCalls: number;
    readonly webgl2DrawCalls: number;
    readonly webgpuCanvasAcquisitions: number;
    readonly webgpuRenderPasses: number;
    readonly webgpuDrawCalls: number;
    /** Optional extended evidence used by WebGPU compute acceptance fixtures. */
    readonly webgpuComputePasses?: number;
    /** Optional native direct-plus-indirect dispatch count. */
    readonly webgpuDispatchCalls?: number;
    /** Optional native indirect raster draw count. */
    readonly webgpuIndirectDrawCalls?: number;
    readonly webgpuQueueSubmissions: number;
    readonly instrumentationErrors: readonly string[];
}

export interface FrameRenderHealth {
    readonly url: string;
    readonly snapshot: RenderHealthSnapshot;
}

export interface NativeRenderProgress {
    readonly drawCalls: number;
    readonly canvasAcquisitions: number;
    readonly queueSubmissions: number;
}

interface StableInstrumentationHealthDependencies {
    readonly waitForStableAnimationFrames: () => Promise<void>;
    readonly awaitTrackedGPUQueues: () => Promise<void>;
    readonly readRenderHealth: () => Promise<readonly FrameRenderHealth[]>;
}

/** Preserve native GPU validation diagnostics even when the browser object is not an Error. */
export function instrumentationErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'object' && error !== null) {
        const message: unknown = Reflect.get(error, 'message');
        if (typeof message === 'string' && message.length > 0) return message;
    }
    return String(error);
}

declare global {
    interface Window {
        __HILO3D_UI_RENDER_HEALTH__?: RenderHealthSnapshot;
        __HILO3D_UI_SAMPLE_WEBGL_ERRORS__?: () => void;
        __HILO3D_UI_AWAIT_GPU_QUEUES__?: () => Promise<void>;
    }
}

/** Install before navigation so the gate observes native graphics work instead of page markers. */
export async function installRenderHealthProbe(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const health: {
            webgl2Contexts: number;
            webgl2ClearCalls: number;
            webgl2DrawCalls: number;
            webgpuCanvasAcquisitions: number;
            webgpuRenderPasses: number;
            webgpuDrawCalls: number;
            webgpuComputePasses: number;
            webgpuDispatchCalls: number;
            webgpuIndirectDrawCalls: number;
            webgpuQueueSubmissions: number;
            instrumentationErrors: string[];
        } = {
            webgl2Contexts: 0,
            webgl2ClearCalls: 0,
            webgl2DrawCalls: 0,
            webgpuCanvasAcquisitions: 0,
            webgpuRenderPasses: 0,
            webgpuDrawCalls: 0,
            webgpuComputePasses: 0,
            webgpuDispatchCalls: 0,
            webgpuIndirectDrawCalls: 0,
            webgpuQueueSubmissions: 0,
            instrumentationErrors: []
        };
        Object.defineProperty(window, '__HILO3D_UI_RENDER_HEALTH__', {
            configurable: false,
            enumerable: false,
            writable: false,
            value: health
        });
        const finalWebGLErrorSamplers: (() => void)[] = [];
        Object.defineProperty(window, '__HILO3D_UI_SAMPLE_WEBGL_ERRORS__', {
            configurable: false,
            enumerable: false,
            writable: false,
            value: (): void => {
                finalWebGLErrorSamplers.forEach(sample => {
                    sample();
                });
            }
        });

        const recordInstrumentationError = (scope: string, error: unknown): void => {
            // This mirrors instrumentationErrorMessage outside the isolated init-script realm.
            // GPUValidationError is not consistently exposed as an instanceof Error by Chromium.
            const objectMessage =
                typeof error === 'object' && error !== null
                    ? (Reflect.get(error, 'message') as unknown)
                    : undefined;
            const message =
                error instanceof Error
                    ? error.message
                    : typeof objectMessage === 'string' && objectMessage.length > 0
                      ? objectMessage
                      : String(error);
            health.instrumentationErrors.push(`${scope}: ${message}`);
        };
        // A strong set is intentional: the probe lives for one page lifetime and must retain every
        // queue that could still have validation work pending at the final release gate.
        const trackedGPUQueues = new Set<GPUQueue>();
        Object.defineProperty(window, '__HILO3D_UI_AWAIT_GPU_QUEUES__', {
            configurable: false,
            enumerable: false,
            writable: false,
            value: async (): Promise<void> => {
                const queues = [...trackedGPUQueues];
                await Promise.all(
                    queues.map(async (queue, index) => {
                        try {
                            await queue.onSubmittedWorkDone();
                        } catch (error: unknown) {
                            recordInstrumentationError(
                                `webgpu.queue[${String(index)}].onSubmittedWorkDone`,
                                error
                            );
                            throw error;
                        }
                    })
                );
            }
        });

        const instrumentedWebGLContexts = new WeakSet<WebGL2RenderingContext>();
        const instrumentWebGL2 = (context: WebGL2RenderingContext): void => {
            if (instrumentedWebGLContexts.has(context)) return;
            instrumentedWebGLContexts.add(context);
            health.webgl2Contexts++;

            const webGLErrorName = (error: GLenum): string => {
                switch (error) {
                    case context.INVALID_ENUM:
                        return 'INVALID_ENUM';
                    case context.INVALID_VALUE:
                        return 'INVALID_VALUE';
                    case context.INVALID_OPERATION:
                        return 'INVALID_OPERATION';
                    case context.INVALID_FRAMEBUFFER_OPERATION:
                        return 'INVALID_FRAMEBUFFER_OPERATION';
                    case context.OUT_OF_MEMORY:
                        return 'OUT_OF_MEMORY';
                    case context.CONTEXT_LOST_WEBGL:
                        return 'CONTEXT_LOST_WEBGL';
                    default:
                        return 'UNKNOWN_ERROR';
                }
            };

            /** Drain only after retaining every native error; an invalid command is never progress. */
            const recordWebGLErrors = (method: string): boolean => {
                let valid = true;
                let error = context.getError();
                while (error !== context.NO_ERROR) {
                    valid = false;
                    const code = `0x${error.toString(16).padStart(4, '0')}`;
                    recordInstrumentationError(
                        `webgl2.${method}`,
                        `${webGLErrorName(error)} (${code})`
                    );
                    error = context.getError();
                }
                return valid;
            };
            finalWebGLErrorSamplers.push(() => {
                recordWebGLErrors('finalHealthSnapshot');
            });

            const wrap = (
                method:
                    | 'clear'
                    | 'drawArrays'
                    | 'drawArraysInstanced'
                    | 'drawElements'
                    | 'drawElementsInstanced',
                kind: 'clear' | 'draw'
            ): void => {
                try {
                    const nativeMethod = context[method] as unknown as (
                        ...parameters: unknown[]
                    ) => unknown;
                    Object.defineProperty(context, method, {
                        configurable: true,
                        writable: true,
                        value: (...parameters: unknown[]): unknown => {
                            const result = Reflect.apply(nativeMethod, context, parameters);
                            if (recordWebGLErrors(method)) {
                                if (kind === 'clear') health.webgl2ClearCalls++;
                                else health.webgl2DrawCalls++;
                            }
                            return result;
                        }
                    });
                } catch (error: unknown) {
                    recordInstrumentationError(`webgl2.${method}`, error);
                }
            };

            wrap('clear', 'clear');
            wrap('drawArrays', 'draw');
            wrap('drawArraysInstanced', 'draw');
            wrap('drawElements', 'draw');
            wrap('drawElementsInstanced', 'draw');
        };

        try {
            const nativeGetContext = Object.getOwnPropertyDescriptor(
                HTMLCanvasElement.prototype,
                'getContext'
            )?.value as
                | ((
                      this: HTMLCanvasElement,
                      contextId: string,
                      ...parameters: unknown[]
                  ) => unknown)
                | undefined;
            if (!nativeGetContext) throw new Error('HTMLCanvasElement.getContext is unavailable');
            Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
                configurable: true,
                writable: true,
                value(
                    this: HTMLCanvasElement,
                    contextId: string,
                    ...parameters: unknown[]
                ): unknown {
                    const context = Reflect.apply(nativeGetContext, this, [
                        contextId,
                        ...parameters
                    ]);
                    if (
                        contextId === 'webgl2' &&
                        typeof WebGL2RenderingContext !== 'undefined' &&
                        context instanceof WebGL2RenderingContext
                    ) {
                        instrumentWebGL2(context);
                    }
                    return context;
                }
            });
        } catch (error: unknown) {
            recordInstrumentationError('webgl2.getContext', error);
        }

        if (typeof GPUCanvasContext !== 'undefined') {
            try {
                const nativeGetCurrentTexture = Object.getOwnPropertyDescriptor(
                    GPUCanvasContext.prototype,
                    'getCurrentTexture'
                )?.value as ((this: GPUCanvasContext) => GPUTexture) | undefined;
                if (!nativeGetCurrentTexture) {
                    throw new Error('GPUCanvasContext.getCurrentTexture is unavailable');
                }
                Object.defineProperty(GPUCanvasContext.prototype, 'getCurrentTexture', {
                    configurable: true,
                    writable: true,
                    value(this: GPUCanvasContext): GPUTexture {
                        const texture = Reflect.apply(nativeGetCurrentTexture, this, []);
                        health.webgpuCanvasAcquisitions++;
                        return texture;
                    }
                });
            } catch (error: unknown) {
                recordInstrumentationError('webgpu.GPUCanvasContext.getCurrentTexture', error);
            }
        }

        if (typeof GPUCommandEncoder !== 'undefined') {
            try {
                const nativeBeginRenderPass = Object.getOwnPropertyDescriptor(
                    GPUCommandEncoder.prototype,
                    'beginRenderPass'
                )?.value as
                    | ((
                          this: GPUCommandEncoder,
                          descriptor: GPURenderPassDescriptor
                      ) => GPURenderPassEncoder)
                    | undefined;
                if (!nativeBeginRenderPass) {
                    throw new Error('GPUCommandEncoder.beginRenderPass is unavailable');
                }
                Object.defineProperty(GPUCommandEncoder.prototype, 'beginRenderPass', {
                    configurable: true,
                    writable: true,
                    value(
                        this: GPUCommandEncoder,
                        descriptor: GPURenderPassDescriptor
                    ): GPURenderPassEncoder {
                        const pass = Reflect.apply(nativeBeginRenderPass, this, [descriptor]) as
                            GPURenderPassEncoder | undefined;
                        if (!pass) {
                            throw new Error('native beginRenderPass did not return an encoder');
                        }
                        health.webgpuRenderPasses++;
                        return pass;
                    }
                });
            } catch (error: unknown) {
                recordInstrumentationError('webgpu.GPUCommandEncoder.beginRenderPass', error);
            }

            try {
                const nativeBeginComputePass = Object.getOwnPropertyDescriptor(
                    GPUCommandEncoder.prototype,
                    'beginComputePass'
                )?.value as
                    | ((
                          this: GPUCommandEncoder,
                          descriptor?: GPUComputePassDescriptor
                      ) => GPUComputePassEncoder)
                    | undefined;
                if (!nativeBeginComputePass) {
                    throw new Error('GPUCommandEncoder.beginComputePass is unavailable');
                }
                Object.defineProperty(GPUCommandEncoder.prototype, 'beginComputePass', {
                    configurable: true,
                    writable: true,
                    value(
                        this: GPUCommandEncoder,
                        descriptor?: GPUComputePassDescriptor
                    ): GPUComputePassEncoder {
                        const pass = Reflect.apply(nativeBeginComputePass, this, [descriptor]) as
                            GPUComputePassEncoder | undefined;
                        if (!pass) {
                            throw new Error('native beginComputePass did not return an encoder');
                        }
                        health.webgpuComputePasses++;
                        return pass;
                    }
                });
            } catch (error: unknown) {
                recordInstrumentationError('webgpu.GPUCommandEncoder.beginComputePass', error);
            }
        }

        if (typeof GPUComputePassEncoder !== 'undefined') {
            const wrapDispatch = (method: 'dispatchWorkgroups' | 'dispatchWorkgroupsIndirect') => {
                try {
                    const nativeDispatch = GPUComputePassEncoder.prototype[method] as unknown as (
                        ...parameters: unknown[]
                    ) => unknown;
                    Object.defineProperty(GPUComputePassEncoder.prototype, method, {
                        configurable: true,
                        writable: true,
                        value(this: GPUComputePassEncoder, ...parameters: unknown[]): unknown {
                            const result = Reflect.apply(nativeDispatch, this, parameters);
                            health.webgpuDispatchCalls++;
                            return result;
                        }
                    });
                } catch (error: unknown) {
                    recordInstrumentationError(`webgpu.GPUComputePassEncoder.${method}`, error);
                }
            };
            wrapDispatch('dispatchWorkgroups');
            wrapDispatch('dispatchWorkgroupsIndirect');
        }

        if (typeof GPURenderPassEncoder !== 'undefined') {
            const wrapDraw = (
                method: 'draw' | 'drawIndexed' | 'drawIndirect' | 'drawIndexedIndirect'
            ): void => {
                try {
                    const nativeDraw = GPURenderPassEncoder.prototype[method] as unknown as (
                        ...parameters: unknown[]
                    ) => unknown;
                    Object.defineProperty(GPURenderPassEncoder.prototype, method, {
                        configurable: true,
                        writable: true,
                        value(this: GPURenderPassEncoder, ...parameters: unknown[]): unknown {
                            const result = Reflect.apply(nativeDraw, this, parameters);
                            health.webgpuDrawCalls++;
                            if (method === 'drawIndirect' || method === 'drawIndexedIndirect') {
                                health.webgpuIndirectDrawCalls++;
                            }
                            return result;
                        }
                    });
                } catch (error: unknown) {
                    recordInstrumentationError(`webgpu.GPURenderPassEncoder.${method}`, error);
                }
            };
            wrapDraw('draw');
            wrapDraw('drawIndexed');
            wrapDraw('drawIndirect');
            wrapDraw('drawIndexedIndirect');
        }

        let gpuQueuePrototypeInstrumented = false;
        const instrumentedQueues = new WeakSet<GPUQueue>();
        const instrumentQueue = (queue: GPUQueue): void => {
            trackedGPUQueues.add(queue);
            if (instrumentedQueues.has(queue)) return;
            instrumentedQueues.add(queue);
            if (gpuQueuePrototypeInstrumented) return;
            const nativeSubmit = queue.submit.bind(queue);
            Object.defineProperty(queue, 'submit', {
                configurable: true,
                writable: true,
                value: (commandBuffers: Iterable<GPUCommandBuffer>): void => {
                    nativeSubmit(commandBuffers);
                    health.webgpuQueueSubmissions++;
                }
            });
        };

        if (typeof GPUQueue !== 'undefined') {
            try {
                const nativeSubmit = Object.getOwnPropertyDescriptor(GPUQueue.prototype, 'submit')
                    ?.value as
                    | ((this: GPUQueue, commandBuffers: Iterable<GPUCommandBuffer>) => void)
                    | undefined;
                if (!nativeSubmit) throw new Error('GPUQueue.submit is unavailable');
                Object.defineProperty(GPUQueue.prototype, 'submit', {
                    configurable: true,
                    writable: true,
                    value(this: GPUQueue, commandBuffers: Iterable<GPUCommandBuffer>): void {
                        Reflect.apply(nativeSubmit, this, [commandBuffers]);
                        health.webgpuQueueSubmissions++;
                    }
                });
                gpuQueuePrototypeInstrumented = true;
            } catch (error: unknown) {
                recordInstrumentationError('webgpu.GPUQueue.prototype.submit', error);
            }
        }

        const instrumentedDevices = new WeakSet<GPUDevice>();
        const instrumentDevice = (device: GPUDevice): void => {
            if (instrumentedDevices.has(device)) return;
            instrumentedDevices.add(device);
            instrumentQueue(device.queue);
            device.addEventListener('uncapturederror', event => {
                recordInstrumentationError('webgpu.device.uncapturederror', event.error);
            });
            void device.lost.then(info => {
                trackedGPUQueues.delete(device.queue);
                if (info.reason === 'destroyed') return;
                recordInstrumentationError(
                    'webgpu.device.lost',
                    info.message || `reason=${info.reason}`
                );
            });
        };

        let gpuAdapterPrototypeInstrumented = false;
        if (typeof GPUAdapter !== 'undefined') {
            try {
                const nativeRequestDevice = Object.getOwnPropertyDescriptor(
                    GPUAdapter.prototype,
                    'requestDevice'
                )?.value as
                    | ((this: GPUAdapter, descriptor?: GPUDeviceDescriptor) => Promise<GPUDevice>)
                    | undefined;
                if (!nativeRequestDevice)
                    throw new Error('GPUAdapter.requestDevice is unavailable');
                Object.defineProperty(GPUAdapter.prototype, 'requestDevice', {
                    configurable: true,
                    writable: true,
                    async value(
                        this: GPUAdapter,
                        descriptor?: GPUDeviceDescriptor
                    ): Promise<GPUDevice> {
                        const device = await Reflect.apply(nativeRequestDevice, this, [descriptor]);
                        instrumentDevice(device);
                        return device;
                    }
                });
                gpuAdapterPrototypeInstrumented = true;
            } catch (error: unknown) {
                recordInstrumentationError('webgpu.GPUAdapter.requestDevice', error);
            }
        }

        const gpu = Reflect.get(navigator, 'gpu') as GPU | undefined;
        if (!gpuAdapterPrototypeInstrumented && gpu) {
            try {
                const nativeRequestAdapter = gpu.requestAdapter.bind(gpu);
                Object.defineProperty(gpu, 'requestAdapter', {
                    configurable: true,
                    writable: true,
                    value: async (
                        options?: GPURequestAdapterOptions
                    ): Promise<GPUAdapter | null> => {
                        const adapter = await nativeRequestAdapter(options);
                        if (!adapter) return null;
                        const nativeRequestDevice = adapter.requestDevice.bind(adapter);
                        Object.defineProperty(adapter, 'requestDevice', {
                            configurable: true,
                            writable: true,
                            value: async (descriptor?: GPUDeviceDescriptor): Promise<GPUDevice> => {
                                const device = await nativeRequestDevice(descriptor);
                                instrumentDevice(device);
                                return device;
                            }
                        });
                        return adapter;
                    }
                });
            } catch (error: unknown) {
                recordInstrumentationError('webgpu.requestAdapter', error);
            }
        }
    });
}

export async function readRenderHealth(page: Page): Promise<readonly FrameRenderHealth[]> {
    const health = await Promise.all(
        page.frames().map(async frame => {
            try {
                const snapshot = await frame.evaluate(() => {
                    window.__HILO3D_UI_SAMPLE_WEBGL_ERRORS__?.();
                    return window.__HILO3D_UI_RENDER_HEALTH__
                        ? {
                              ...window.__HILO3D_UI_RENDER_HEALTH__,
                              instrumentationErrors: [
                                  ...window.__HILO3D_UI_RENDER_HEALTH__.instrumentationErrors
                              ]
                          }
                        : null;
                });
                return snapshot ? { url: frame.url(), snapshot } : null;
            } catch (error: unknown) {
                if (frame.isDetached()) return null;
                throw error;
            }
        })
    );
    return health.filter(item => item !== null);
}

/** Wait for two browser frames so asynchronous GPU validation has reached the page event loop. */
export async function waitForStableAnimationFrames(page: Page): Promise<void> {
    await page.evaluate(
        () =>
            new Promise<void>(resolve => {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        resolve();
                    });
                });
            })
    );
}

/** Fence every real GPU queue observed in every live frame before the final health snapshot. */
export async function awaitTrackedGPUQueues(page: Page): Promise<void> {
    const evaluateLiveFrames = async (operation: () => Promise<void>): Promise<void> => {
        await Promise.all(
            page.frames().map(async frame => {
                try {
                    await frame.evaluate(operation);
                } catch (error: unknown) {
                    if (frame.isDetached()) return;
                    throw error;
                }
            })
        );
    };
    await evaluateLiveFrames(async () => {
        await window.__HILO3D_UI_AWAIT_GPU_QUEUES__?.();
    });
    // Uncaptured-error and device-loss notifications are tasks, not queue-promise callbacks. Give
    // the page one task turn after the GPU timeline resolves before the caller reads final health.
    await evaluateLiveFrames(
        () =>
            new Promise<void>(resolve => {
                setTimeout(resolve, 0);
            })
    );
}

export function completedRenderCommands(
    health: readonly FrameRenderHealth[],
    backend: ExampleBackend
): number {
    const progress = nativeRenderProgress(health, backend);
    if (
        backend === 'webgpu' &&
        (progress.canvasAcquisitions === 0 || progress.queueSubmissions === 0)
    ) {
        return 0;
    }
    return progress.drawCalls;
}

/** Snapshot native work so interaction tests can require draw/submit progress after an action. */
export function nativeRenderProgress(
    health: readonly FrameRenderHealth[],
    backend: ExampleBackend
): NativeRenderProgress {
    if (backend === 'webgl2') {
        return {
            drawCalls: health.reduce((total, frame) => total + frame.snapshot.webgl2DrawCalls, 0),
            canvasAcquisitions: 0,
            queueSubmissions: 0
        };
    }
    return {
        drawCalls: health.reduce((total, frame) => total + frame.snapshot.webgpuDrawCalls, 0),
        canvasAcquisitions: health.reduce(
            (total, frame) => total + frame.snapshot.webgpuCanvasAcquisitions,
            0
        ),
        queueSubmissions: health.reduce(
            (total, frame) => total + frame.snapshot.webgpuQueueSubmissions,
            0
        )
    };
}

/** Require action-local native work, including a fresh queue submission on WebGPU. */
export function nativeRenderProgressAdvanced(
    before: NativeRenderProgress,
    after: NativeRenderProgress,
    backend: ExampleBackend
): boolean {
    if (after.drawCalls <= before.drawCalls) return false;
    return backend === 'webgl2' || after.queueSubmissions > before.queueSubmissions;
}

export function instrumentationErrors(
    health: readonly FrameRenderHealth[],
    backend: ExampleBackend
): readonly string[] {
    const scope = backend === 'webgpu' ? 'webgpu.' : 'webgl2.';
    return health.flatMap(frame =>
        frame.snapshot.instrumentationErrors
            .filter(message => message.startsWith(scope))
            .map(message => `${frame.url}: ${message}`)
    );
}

/** Reject hidden secondary-renderer work: backend selection is exclusive, never a fallback chain. */
export function unexpectedBackendUsage(
    health: readonly FrameRenderHealth[],
    backend: ExampleBackend
): readonly string[] {
    return health.flatMap(frame => {
        const { snapshot } = frame;
        if (backend === 'webgpu') {
            return snapshot.webgl2Contexts === 0
                ? []
                : [
                      `${frame.url}: selected WebGPU but created ${String(snapshot.webgl2Contexts)} WebGL2 context(s)`
                  ];
        }
        const webgpuWork =
            snapshot.webgpuCanvasAcquisitions +
            snapshot.webgpuRenderPasses +
            snapshot.webgpuDrawCalls +
            snapshot.webgpuQueueSubmissions;
        return webgpuWork === 0
            ? []
            : [
                  `${frame.url}: selected WebGL2 but issued ${String(webgpuWork)} WebGPU operation(s)`
              ];
    });
}

/**
 * Enforce the final instrumentation gate only after the stable-frame window. Keeping the two
 * operations together prevents callers from accidentally sampling validation errors too early.
 */
export async function assertStableInstrumentationHealth(
    backend: ExampleBackend,
    context: string,
    dependencies: StableInstrumentationHealthDependencies
): Promise<void> {
    await dependencies.waitForStableAnimationFrames();
    await dependencies.awaitTrackedGPUQueues();
    const health = await dependencies.readRenderHealth();
    const errors = [
        ...instrumentationErrors(health, backend),
        ...unexpectedBackendUsage(health, backend)
    ];
    if (errors.length === 0) return;

    throw new Error(`${context}:\n${errors.join('\n')}`);
}
