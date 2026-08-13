import type Camera from '../../camera/Camera';
import { RenderGraphFrame, type RenderGraphFrameBuildScope } from '../frame/RenderGraphFrame';
import type { RenderGraphFrameContext } from '../frame/RenderGraphFrameContext';
import type { RGExecutionResult } from '../graph/RenderGraphExecutor';
import type {
    RenderGraphTimelineSink,
    RenderGraphTimelineSnapshot
} from '../graph/RenderGraphTimeline';
import type { RHICapabilities } from '../rhi/core';
import type { RenderTarget } from '../RenderTarget';
import type { RendererScene } from '../RendererCore';
import type { StorageBuffer, StorageBufferDescriptor } from '../StorageBuffer';
import {
    createRenderPipelineCapabilities,
    validateRenderPipelineCapabilitySuperset,
    validateRenderPipelineRequirements
} from '../pipeline/RenderPipelineCapabilities';
import type {
    RenderPipeline,
    RenderPipelineCapabilities,
    RenderPipelineContext,
    RenderPipelineFactory,
    RenderPipelineRequirements
} from '../pipeline/RenderPipeline';

const attachedPipelineRuntimes = new WeakSet();

/** @internal Renderer-owned lifecycle invoked around the single application graph transaction. */
export interface RenderPipelineHostLifecycle {
    createFrameContext(frameIndex: number): RenderGraphFrameContext;
    beginFrame(frameIndex: number): void;
    completeFrame(frameIndex: number, execution: RGExecutionResult, uploadCount: number): void;
    failFrame(error: unknown): void;
    endFrame(submitted: boolean): void;
    createPipelineStorageBuffer(descriptor: Readonly<StorageBufferDescriptor>): StorageBuffer;
    createPipelineContext(
        scene: RendererScene,
        camera: Camera,
        target: RenderTarget | null,
        fireEvent: boolean,
        capabilities: RenderPipelineCapabilities,
        runtimeOwner: object
    ): RenderPipelineContext;
    endPipelineInvocation(completed: boolean): void;
    getRenderGraphTimelineSink?(): RenderGraphTimelineSink | null;
}

/**
 * @internal Owns the renderer's only application Render Graph transaction.
 *
 * Pipeline recording and ordinary Renderer commands share this boundary, so a caught recording
 * failure still poisons the complete frame before the RHI begins command execution.
 */
export class RenderPipelineHost {
    readonly #frame = new RenderGraphFrame();
    readonly #abortSignal = Object.freeze({
        throwIfAborted: (): void => {
            if (this.#aborted) throw this.createAbortedError();
        }
    });
    readonly #buildFrame = (scope: RenderGraphFrameBuildScope): void => {
        this.#activeScope = scope;
        try {
            const record = this.#record;
            if (record === null) throw new Error('Renderer frame recorder is unavailable');
            record();
            if (this.#aborted) throw this.createAbortedError();
        } finally {
            this.#activeScope = null;
        }
    };

    #activeScope: RenderGraphFrameBuildScope | null = null;
    #record: (() => void) | null = null;
    #activeFrameIndex: number | null = null;
    #nextFrameIndex = 0;
    #abortReason: unknown;
    #recording = false;
    #aborted = false;
    #destroyed = false;
    #runtime: RenderPipeline | null = null;
    #capabilities: RenderPipelineCapabilities | null = null;
    #minimumCapabilities: RenderPipelineCapabilities | null = null;
    #requirements: Readonly<RenderPipelineRequirements> | null = null;
    #pipelineInvocationActive = false;
    readonly #runtimeOwner = Object.freeze({});

    constructor(readonly lifecycle: RenderPipelineHostLifecycle) {}

    get recording(): boolean {
        return this.#recording;
    }

    get activeFrameIndex(): number | null {
        return this.#activeFrameIndex;
    }

    get active(): boolean {
        return this.#frame.active || this.#recording;
    }

    get initialized(): boolean {
        return this.#runtime !== null && this.#capabilities !== null;
    }

    async initialize(
        factory: RenderPipelineFactory,
        deviceCapabilities: RHICapabilities
    ): Promise<void> {
        this.assertAlive();
        if (this.#runtime !== null) throw new Error('RenderPipelineHost is already initialized');
        const capabilities = createRenderPipelineCapabilities(deviceCapabilities);
        const requirements = factory.requirements ?? {};
        validateRenderPipelineRequirements(requirements, capabilities, deviceCapabilities);
        const candidate: unknown = await factory.create(
            Object.freeze({
                capabilities,
                createStorageBuffer: this.lifecycle.createPipelineStorageBuffer.bind(this.lifecycle)
            })
        );
        if (
            ((typeof candidate === 'object' && candidate !== null) ||
                typeof candidate === 'function') &&
            attachedPipelineRuntimes.has(candidate)
        ) {
            throw new Error('Render pipeline runtime is already attached to another Renderer');
        }
        let runtime: RenderPipeline;
        try {
            if (
                (typeof candidate !== 'object' && typeof candidate !== 'function') ||
                candidate === null
            ) {
                throw new TypeError('Render pipeline factory must create a runtime object');
            }
            const name: unknown = Reflect.get(candidate, 'name');
            if (typeof name !== 'string' || name.length === 0) {
                throw new TypeError('Render pipeline runtime name must be non-empty');
            }
            if (
                typeof Reflect.get(candidate, 'record') !== 'function' ||
                typeof Reflect.get(candidate, 'destroy') !== 'function'
            ) {
                throw new TypeError(
                    'Render pipeline runtime must implement record() and destroy()'
                );
            }
            const usesTimeline: unknown = Reflect.get(candidate, 'usesRenderGraphTimeline');
            if (usesTimeline !== undefined && typeof usesTimeline !== 'boolean') {
                throw new TypeError('Render pipeline usesRenderGraphTimeline must be a boolean');
            }
            if (
                usesTimeline === true &&
                typeof Reflect.get(candidate, 'recordRenderGraphTimeline') !== 'function'
            ) {
                throw new TypeError(
                    'Render pipeline using the Render Graph timeline must implement recordRenderGraphTimeline()'
                );
            }
            runtime = candidate as RenderPipeline;
        } catch (validationError) {
            let cleanupError: unknown;
            if (
                ((typeof candidate === 'object' && candidate !== null) ||
                    typeof candidate === 'function') &&
                typeof Reflect.get(candidate, 'destroy') === 'function'
            ) {
                try {
                    Reflect.apply(
                        Reflect.get(candidate, 'destroy') as (...args: never[]) => unknown,
                        candidate,
                        []
                    );
                } catch (error) {
                    cleanupError = error;
                }
            }
            if (cleanupError !== undefined) {
                throw new AggregateError(
                    [validationError, cleanupError],
                    'Render pipeline validation and cleanup both failed',
                    { cause: validationError }
                );
            }
            throw validationError;
        }
        attachedPipelineRuntimes.add(runtime);
        this.#runtime = runtime;
        this.#capabilities = capabilities;
        this.#minimumCapabilities = capabilities;
        this.#requirements = requirements;
    }

    validateReplacementDevice(deviceCapabilities: RHICapabilities): void {
        void this.createValidatedReplacementCapabilities(deviceCapabilities);
    }

    adoptReplacementDevice(deviceCapabilities: RHICapabilities): void {
        this.#capabilities = this.createValidatedReplacementCapabilities(deviceCapabilities);
    }

    requireActiveScope(): RenderGraphFrameBuildScope {
        const scope = this.#activeScope;
        if (scope === null) throw new Error('Renderer graph build requires an active frame');
        return scope;
    }

    recordCommand(command: () => void): void {
        this.assertAlive();
        if (!this.#recording) {
            this.execute(command);
            return;
        }
        if (this.#aborted) throw this.createAbortedError();
        if (this.#activeScope === null) {
            const error = new Error(
                'Renderer commands are not supported during Render Graph prepare or execute'
            );
            this.abort(error);
            throw error;
        }
        try {
            command();
        } catch (error) {
            this.abort(error);
            throw error;
        }
    }

    recordPipeline(
        scene: RendererScene,
        camera: Camera,
        target: RenderTarget | null,
        fireEvent: boolean
    ): void {
        if (!this.#recording) {
            throw new Error('Render pipeline recording requires an active application frame');
        }
        if (this.#aborted) throw this.createAbortedError();
        if (this.#pipelineInvocationActive) {
            const error = new Error(
                'Nested renderer.render() calls from an active render pipeline invocation are not supported'
            );
            this.abort(error);
            throw error;
        }
        const runtime = this.#runtime;
        const capabilities = this.#capabilities;
        if (runtime === null || capabilities === null) {
            throw new Error('Render pipeline runtime is not initialized');
        }
        this.#pipelineInvocationActive = true;
        let completed = false;
        let contextCreated = false;
        try {
            const context = this.lifecycle.createPipelineContext(
                scene,
                camera,
                target,
                fireEvent,
                capabilities,
                this.#runtimeOwner
            );
            contextCreated = true;
            const result: unknown = runtime.record(context);
            if (
                ((typeof result === 'object' && result !== null) || typeof result === 'function') &&
                typeof Reflect.get(result, 'then') === 'function'
            ) {
                throw new TypeError('Render pipeline record() must be synchronous');
            }
            completed = true;
        } finally {
            try {
                if (contextCreated) this.lifecycle.endPipelineInvocation(completed);
            } finally {
                this.#pipelineInvocationActive = false;
            }
        }
    }

    execute(record: () => void): void {
        this.assertAlive();
        if (this.#recording) {
            const error = new Error('Nested renderer frames are not supported');
            this.abort(error);
            throw error;
        }

        const frameIndex = this.allocateFrameIndex();
        this.#recording = true;
        this.#activeFrameIndex = frameIndex;
        this.#aborted = false;
        this.#abortReason = undefined;
        this.#record = record;
        let firstFailure: unknown;
        let additionalFailures: unknown[] | null = null;
        let failureCount = 0;
        let submitted = false;
        let lifecycleStarted = false;
        try {
            lifecycleStarted = true;
            this.lifecycle.beginFrame(frameIndex);
            const context = this.lifecycle.createFrameContext(frameIndex);
            const diagnosticTimelineSink = this.lifecycle.getRenderGraphTimelineSink?.() ?? null;
            const runtime = this.#runtime;
            const adaptiveTimelineEnabled = runtime?.usesRenderGraphTimeline === true;
            const timelineSink: RenderGraphTimelineSink | null =
                diagnosticTimelineSink === null && !adaptiveTimelineEnabled
                    ? null
                    : Object.freeze({
                          recordRenderGraphTimeline: (
                              snapshot: Readonly<RenderGraphTimelineSnapshot>
                          ) => {
                              diagnosticTimelineSink?.recordRenderGraphTimeline(snapshot);
                              runtime?.recordRenderGraphTimeline?.(snapshot);
                          }
                      });
            const execution = this.#frame.execute(
                context,
                this.#buildFrame,
                this.#abortSignal,
                timelineSink
            );
            submitted = true;
            let submissionCallbackFailed = false;
            let submissionCallbackFailure: unknown;
            try {
                this.#runtime?.frameSubmitted?.(frameIndex);
            } catch (error) {
                submissionCallbackFailed = true;
                submissionCallbackFailure = error;
            }
            let completionFailed = false;
            let completionFailure: unknown;
            try {
                this.lifecycle.completeFrame(
                    frameIndex,
                    execution,
                    this.#frame.uploads.pendingCount
                );
            } catch (error) {
                completionFailed = true;
                completionFailure = error;
            }
            if (submissionCallbackFailed && completionFailed) {
                throw new AggregateError(
                    [submissionCallbackFailure, completionFailure],
                    'Render pipeline submission callback and frame completion both failed',
                    { cause: submissionCallbackFailure }
                );
            }
            if (completionFailed) throw completionFailure;
            if (submissionCallbackFailed) throw submissionCallbackFailure;
        } catch (error) {
            firstFailure = error;
            failureCount = 1;
            if (lifecycleStarted) {
                try {
                    if (!submitted) this.#runtime?.frameDiscarded?.(frameIndex);
                    this.lifecycle.failFrame(error);
                } catch (cleanupError) {
                    additionalFailures = [error, cleanupError];
                    failureCount = 2;
                }
            }
        } finally {
            this.#activeScope = null;
            if (lifecycleStarted) {
                try {
                    this.lifecycle.endFrame(submitted);
                } catch (cleanupError) {
                    if (failureCount === 0) {
                        firstFailure = cleanupError;
                        failureCount = 1;
                    } else {
                        additionalFailures ??= [firstFailure];
                        additionalFailures.push(cleanupError);
                        failureCount++;
                    }
                }
            }
            this.#record = null;
            this.#recording = false;
            this.#activeFrameIndex = null;
            this.#aborted = false;
            this.#abortReason = undefined;
        }
        if (failureCount === 1) throw firstFailure;
        if (failureCount > 1) {
            if (additionalFailures === null) {
                throw new Error('Renderer frame failure aggregation is inconsistent');
            }
            throw new AggregateError(
                additionalFailures,
                'Renderer frame and lifecycle cleanup both failed',
                {
                    cause: firstFailure
                }
            );
        }
    }

    abort(reason: unknown): void {
        if (!this.#recording || this.#aborted) return;
        this.#aborted = true;
        this.#abortReason = reason;
    }

    destroy(): void {
        if (this.active) throw new Error('Cannot destroy an active RenderPipelineHost');
        if (this.#destroyed) return;
        this.#destroyed = true;
        const runtime = this.#runtime;
        this.#runtime = null;
        this.#capabilities = null;
        this.#minimumCapabilities = null;
        this.#requirements = null;
        this.#pipelineInvocationActive = false;
        const failures: unknown[] = [];
        try {
            runtime?.destroy();
        } catch (error) {
            failures.push(error);
        }
        try {
            this.#frame.destroy();
        } catch (error) {
            failures.push(error);
        }
        if (failures.length !== 0) {
            throw new AggregateError(
                failures,
                'Render pipeline host failed while being destroyed',
                {
                    cause: failures[0]
                }
            );
        }
    }

    allocateFrameIndex(): number {
        if (this.#nextFrameIndex === Number.MAX_SAFE_INTEGER) {
            throw new RangeError('Renderer frame index space is exhausted');
        }
        return this.#nextFrameIndex++;
    }

    private createAbortedError(): Error {
        return new Error('Renderer frame recording was aborted after a command failed', {
            cause: this.#abortReason
        });
    }

    private createValidatedReplacementCapabilities(
        deviceCapabilities: RHICapabilities
    ): RenderPipelineCapabilities {
        const minimum = this.#minimumCapabilities;
        const requirements = this.#requirements;
        if (minimum === null || requirements === null) {
            throw new Error('Render pipeline runtime is not initialized');
        }
        const capabilities = createRenderPipelineCapabilities(deviceCapabilities);
        validateRenderPipelineRequirements(requirements, capabilities, deviceCapabilities);
        validateRenderPipelineCapabilitySuperset(minimum, capabilities);
        return capabilities;
    }

    private assertAlive(): void {
        if (this.#destroyed) throw new Error('Cannot use a destroyed RenderPipelineHost');
    }
}
