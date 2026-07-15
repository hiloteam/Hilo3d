import type { RHIBackend, RHIDevice, RHIDeviceLostInfo } from '../rhi/core';
import type { ResourceRegistry } from './ResourceRegistry';
import type { SubmissionResourceTracker } from './SubmissionResourceTracker';

export type RHIRecoveryCoordinatorState = 'ready' | 'recovering' | 'failed' | 'destroyed';

export interface RHIReplacementDeviceRequest {
    readonly backend: RHIBackend;
    readonly lostDevice: RHIDevice;
    readonly loss: Readonly<RHIDeviceLostInfo>;
    readonly attempt: number;
}

/** The application owns backend selection and native setup; the coordinator never creates it. */
export type RHIReplacementDeviceFactory = (
    request: Readonly<RHIReplacementDeviceRequest>
) => RHIDevice | PromiseLike<RHIDevice>;

/** Stable cache hook called after ResourceRegistry has atomically adopted the replacement device. */
export interface RHIRecoverySynchronizer {
    synchronizeAfterRecovery(): void;
}

export interface RHIRecoveryCoordinatorEvent {
    readonly state: RHIRecoveryCoordinatorState;
    readonly device: RHIDevice;
    readonly attempt: number;
    readonly loss: Readonly<RHIDeviceLostInfo> | null;
    readonly error: Error | null;
}

export type RHIRecoveryCoordinatorListener = (event: Readonly<RHIRecoveryCoordinatorEvent>) => void;

export interface RHIRecoveryCoordinatorOptions {
    readonly device: RHIDevice;
    readonly registry: ResourceRegistry;
    readonly submissions: SubmissionResourceTracker;
    readonly createReplacementDevice: RHIReplacementDeviceFactory;
}

export interface RHIRecoveryCoordinatorDiagnostics {
    readonly state: RHIRecoveryCoordinatorState;
    readonly attemptCount: number;
    readonly successfulRecoveryCount: number;
    readonly staleLossCount: number;
    readonly listenerErrorCount: number;
}

interface DeviceObservation {
    readonly token: number;
    readonly device: RHIDevice;
    readonly generation: number;
}

interface RecoveryJob {
    readonly attempt: number;
    readonly lostDevice: RHIDevice;
    readonly loss: Readonly<RHIDeviceLostInfo>;
}

interface RecoveryAttemptControl {
    cancelled: boolean;
    cancellationError: RHIRecoveryCancelledError | null;
    rejectCancellation: ((error: RHIRecoveryCancelledError) => void) | null;
    candidate: RHIDevice | null;
    adopted: boolean;
    discarded: boolean;
}

function asError(reason: unknown, prefix: string): Error {
    return reason instanceof Error ? reason : new Error(`${prefix}: ${String(reason)}`);
}

function isDevice(value: unknown): value is RHIDevice {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as Partial<RHIDevice>;
    const lost: unknown = candidate.lost;
    return (
        (candidate.backend === 'webgl2' || candidate.backend === 'webgpu') &&
        typeof candidate.id === 'number' &&
        typeof candidate.generation === 'number' &&
        typeof candidate.destroyed === 'boolean' &&
        typeof candidate.destroy === 'function' &&
        typeof candidate.createBuffer === 'function' &&
        typeof lost === 'object' &&
        lost !== null &&
        typeof Reflect.get(lost, 'then') === 'function'
    );
}

function isSynchronizer(value: unknown): value is RHIRecoverySynchronizer {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof Reflect.get(value, 'synchronizeAfterRecovery') === 'function'
    );
}

function deviceIsDestroyed(device: RHIDevice): boolean {
    return device.destroyed;
}

export class RHIRecoveryCancelledError extends Error {
    constructor(message = 'RHI resource recovery was cancelled') {
        super(message);
        this.name = 'RHIRecoveryCancelledError';
    }
}

/**
 * Shared, backend-neutral device-loss recovery sequencing.
 *
 * It observes only the currently adopted device. A recovery waits for every already tracked
 * submission fence to settle, calls the injected replacement factory, atomically rebuilds the
 * ResourceRegistry, then synchronizes stable renderer caches. Rendering code can use `state` as a
 * fail-closed gate. The coordinator neither imports nor constructs a concrete backend.
 */
export class RHIRecoveryCoordinator {
    readonly registry: ResourceRegistry;
    readonly submissions: SubmissionResourceTracker;
    readonly #createReplacementDevice: RHIReplacementDeviceFactory;
    readonly #synchronizers = new Set<RHIRecoverySynchronizer>();
    readonly #listeners = new Set<RHIRecoveryCoordinatorListener>();
    readonly #attemptControls = new Set<RecoveryAttemptControl>();
    #device: RHIDevice;
    #state: RHIRecoveryCoordinatorState = 'ready';
    #failure: Error | null = null;
    #lastLoss: Readonly<RHIDeviceLostInfo> | null = null;
    #recoveryPromise: Promise<void> | null = null;
    #serial: Promise<void> = Promise.resolve();
    #nextObservationToken = 1;
    #currentObservationToken = 0;
    #attemptCount = 0;
    #successfulRecoveryCount = 0;
    #staleLossCount = 0;
    #listenerErrorCount = 0;
    #lastListenerError: unknown;

    constructor(options: RHIRecoveryCoordinatorOptions) {
        const { device, registry, submissions, createReplacementDevice } = options;
        if (device.destroyed) {
            throw new Error('Cannot coordinate recovery for a destroyed RHI device');
        }
        if (registry.state !== 'active') {
            throw new Error('RHI recovery requires an active ResourceRegistry');
        }
        if (
            registry.deviceId !== device.id ||
            registry.deviceGeneration !== device.generation ||
            registry.deviceBackend !== device.backend
        ) {
            throw new Error('Initial RHI device does not match the ResourceRegistry');
        }
        if (submissions.registry !== registry) {
            throw new Error('Submission tracker and recovery coordinator must share one registry');
        }
        if (typeof createReplacementDevice !== 'function') {
            throw new TypeError('RHI recovery requires a replacement-device factory');
        }
        this.#device = device;
        this.registry = registry;
        this.submissions = submissions;
        this.#createReplacementDevice = createReplacementDevice;
        const observation = this.observeDevice(device);
        this.#currentObservationToken = observation.token;
    }

    get state(): RHIRecoveryCoordinatorState {
        return this.#state;
    }

    get device(): RHIDevice {
        return this.#device;
    }

    get recoveryPromise(): Promise<void> | null {
        return this.#recoveryPromise;
    }

    get failure(): Error | null {
        return this.#failure;
    }

    get lastLoss(): Readonly<RHIDeviceLostInfo> | null {
        return this.#lastLoss;
    }

    get listenerErrorCount(): number {
        return this.#listenerErrorCount;
    }

    get lastListenerError(): unknown {
        return this.#lastListenerError;
    }

    registerSynchronizer(synchronizer: RHIRecoverySynchronizer): () => void {
        this.assertNotDestroyed();
        if (!isSynchronizer(synchronizer)) {
            throw new TypeError('Recovery synchronizer must expose synchronizeAfterRecovery()');
        }
        this.#synchronizers.add(synchronizer);
        let registered = true;
        return () => {
            if (!registered) return;
            registered = false;
            this.#synchronizers.delete(synchronizer);
        };
    }

    addListener(listener: RHIRecoveryCoordinatorListener): () => void {
        this.assertNotDestroyed();
        if (typeof listener !== 'function') {
            throw new TypeError('Recovery listener must be a function');
        }
        this.#listeners.add(listener);
        let registered = true;
        return () => {
            if (!registered) return;
            registered = false;
            this.#listeners.delete(listener);
        };
    }

    diagnostics(): Readonly<RHIRecoveryCoordinatorDiagnostics> {
        return Object.freeze({
            state: this.#state,
            attemptCount: this.#attemptCount,
            successfulRecoveryCount: this.#successfulRecoveryCount,
            staleLossCount: this.#staleLossCount,
            listenerErrorCount: this.#listenerErrorCount
        });
    }

    /** Cancel asynchronous recovery without destroying the registry, tracker, or active device. */
    destroy(): void {
        if (this.#state === 'destroyed') return;
        if (this.#state === 'recovering') this.registry.failRecovery();
        this.#state = 'destroyed';
        this.#currentObservationToken = 0;
        const cancellation = new RHIRecoveryCancelledError();
        for (const control of this.#attemptControls) this.cancelAttempt(control, cancellation);
        this.emit();
        this.#listeners.clear();
        this.#synchronizers.clear();
    }

    private observeDevice(device: RHIDevice): DeviceObservation {
        if (this.#nextObservationToken === Number.MAX_SAFE_INTEGER) {
            throw new RangeError('RHI device observation token space is exhausted');
        }
        const observation: DeviceObservation = {
            token: this.#nextObservationToken++,
            device,
            generation: device.generation
        };
        void device.lost.then(
            info => {
                this.handleObservedLoss(observation, info);
            },
            (reason: unknown) => {
                const failure = asError(reason, 'RHI device.lost rejected');
                this.handleObservedLoss(
                    observation,
                    Object.freeze({
                        reason: 'unknown',
                        message: failure.message,
                        generation: observation.generation
                    })
                );
            }
        );
        return observation;
    }

    private handleObservedLoss(
        observation: DeviceObservation,
        info: Readonly<RHIDeviceLostInfo>
    ): void {
        try {
            if (
                this.#state === 'destroyed' ||
                this.#device !== observation.device ||
                this.#currentObservationToken !== observation.token ||
                info.generation !== observation.generation ||
                this.#state !== 'ready'
            ) {
                this.#staleLossCount++;
                return;
            }
            this.enqueueRecovery(observation.device, info);
        } catch (reason) {
            if (this.#state === 'destroyed') return;
            this.#failure = asError(reason, 'RHI device-loss observer failed');
            this.#state = 'failed';
            this.emit();
        }
    }

    private enqueueRecovery(lostDevice: RHIDevice, loss: Readonly<RHIDeviceLostInfo>): void {
        if (this.#attemptCount === Number.MAX_SAFE_INTEGER) {
            throw new RangeError('RHI recovery attempt space is exhausted');
        }
        // Provisioning may be asynchronous. Close the shared logical-resource gate before the
        // first listener or replacement factory can start another frame against stale resources.
        this.registry.beginRecovery();
        const job: RecoveryJob = {
            attempt: ++this.#attemptCount,
            lostDevice,
            loss: Object.freeze({ ...loss })
        };
        const control: RecoveryAttemptControl = {
            cancelled: false,
            cancellationError: null,
            rejectCancellation: null,
            candidate: null,
            adopted: false,
            discarded: false
        };
        this.#attemptControls.add(control);
        this.#lastLoss = job.loss;
        this.#failure = null;
        this.#state = 'recovering';
        this.emit();

        const previous = this.#serial;
        const operation = previous.then(() => this.runRecovery(job, control));
        this.#serial = operation.then(
            () => undefined,
            () => undefined
        );
        this.#recoveryPromise = operation;
    }

    private async runRecovery(job: RecoveryJob, control: RecoveryAttemptControl): Promise<void> {
        try {
            await this.performRecovery(job, control);
        } catch (reason) {
            const failure = control.cancelled
                ? (control.cancellationError ?? new RHIRecoveryCancelledError())
                : asError(reason, 'RHI recovery failed');
            this.registry.failRecovery();
            if (this.#state !== 'destroyed') {
                this.#failure = failure;
                this.#state = 'failed';
                this.emit();
            }
            throw failure;
        } finally {
            this.#attemptControls.delete(control);
        }
    }

    private async performRecovery(
        job: RecoveryJob,
        control: RecoveryAttemptControl
    ): Promise<void> {
        this.throwIfCancelled(control);
        // Drain work submitted before the loss before asking the application to provision another
        // device. A second boundary check below closes the window while an async factory runs.
        await this.waitForSubmissionBoundary(control);
        this.throwIfCancelled(control);
        const request = Object.freeze({
            backend: job.lostDevice.backend,
            lostDevice: job.lostDevice,
            loss: job.loss,
            attempt: job.attempt
        } satisfies RHIReplacementDeviceRequest);
        const factoryResult = Promise.resolve().then(() => this.#createReplacementDevice(request));
        void factoryResult.then(
            value => {
                if (isDevice(value)) {
                    control.candidate = value;
                    if (control.cancelled && !control.adopted) {
                        this.discardCandidate(control);
                    }
                }
            },
            () => undefined
        );

        try {
            const candidateValue = await this.awaitCancellable(factoryResult, control);
            if (!isDevice(candidateValue)) {
                throw new TypeError('Replacement-device factory returned an invalid RHI device');
            }
            control.candidate = candidateValue;
            this.throwIfCancelled(control);
            if (deviceIsDestroyed(candidateValue)) {
                throw new Error('Replacement RHI device is already destroyed');
            }
            if (candidateValue.backend !== job.lostDevice.backend) {
                throw new TypeError('Replacement RHI device must use the same backend');
            }

            let candidateGeneration = candidateValue.generation;
            for (;;) {
                // Work may still have been tracked while an asynchronous factory was running.
                // Recheck until both the submission boundary and replacement-loss probe are
                // stable in one turn, then recover synchronously before another turn can submit.
                await this.waitForSubmissionBoundary(control);
                this.throwIfCancelled(control);
                if (deviceIsDestroyed(candidateValue)) {
                    throw new Error('Replacement RHI device was destroyed before recovery');
                }

                candidateGeneration = candidateValue.generation;
                const priorLoss = await this.awaitCancellable(
                    this.probeSettledLoss(candidateValue),
                    control
                );
                if (priorLoss) {
                    throw new Error(
                        `Replacement RHI device is already lost: ${priorLoss.message || priorLoss.reason}`
                    );
                }
                this.throwIfCancelled(control);
                if (candidateValue.generation !== candidateGeneration) {
                    throw new Error('Replacement RHI device was lost before registry recovery');
                }
                if (this.submissions.pendingSubmissionCount === 0) break;
            }

            const observation = this.observeDevice(candidateValue);
            this.registry.recover(candidateValue);
            control.adopted = true;
            this.#device = candidateValue;
            this.#currentObservationToken = observation.token;
            if (candidateValue.generation !== candidateGeneration) {
                throw new Error('Replacement RHI device was lost during registry recovery');
            }

            // Submission fences settled while the registry was gated, so their zero-reference
            // resources could not be retired. Collect them immediately on the rebuilt generation.
            this.submissions.flush();

            const synchronizers = [...this.#synchronizers];
            for (const synchronizer of synchronizers) {
                synchronizer.synchronizeAfterRecovery();
                this.throwIfCancelled(control);
            }

            this.#successfulRecoveryCount++;
            this.#failure = null;
            this.#state = 'ready';
            this.emit();
        } finally {
            if (!control.adopted) this.discardCandidate(control);
        }
    }

    private async waitForSubmissionBoundary(control: RecoveryAttemptControl): Promise<void> {
        try {
            await this.awaitCancellable(this.submissions.waitForIdle(), control);
        } catch (reason) {
            if (control.cancelled) {
                throw control.cancellationError ?? new RHIRecoveryCancelledError();
            }
            // Device loss commonly rejects pending fences. Once every fence settled, that failure
            // is evidence of the boundary rather than a reason to abandon resource reconstruction.
            if (this.submissions.pendingSubmissionCount !== 0) {
                throw asError(reason, 'Submission boundary failed');
            }
        }
        if (this.submissions.pendingSubmissionCount !== 0) {
            throw new Error('Submission boundary remained active during RHI recovery');
        }
        this.submissions.flush();
    }

    private probeSettledLoss(device: RHIDevice): Promise<Readonly<RHIDeviceLostInfo> | null> {
        return new Promise((resolve, reject) => {
            let decided = false;
            void device.lost.then(
                info => {
                    if (decided) return;
                    decided = true;
                    resolve(info);
                },
                (reason: unknown) => {
                    if (decided) return;
                    decided = true;
                    reject(asError(reason, 'Replacement device.lost rejected'));
                }
            );
            void Promise.resolve().then(() => {
                if (decided) return;
                decided = true;
                resolve(null);
            });
        });
    }

    private awaitCancellable<T>(
        source: PromiseLike<T>,
        control: RecoveryAttemptControl
    ): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            let settled = false;
            const finish = (callback: () => void): void => {
                if (settled) return;
                settled = true;
                if (control.rejectCancellation === cancel) {
                    control.rejectCancellation = null;
                }
                callback();
            };
            const cancel = (error: RHIRecoveryCancelledError): void => {
                finish(() => {
                    reject(error);
                });
            };
            control.rejectCancellation = cancel;
            void Promise.resolve(source).then(
                value => {
                    finish(() => {
                        resolve(value);
                    });
                },
                (reason: unknown) => {
                    finish(() => {
                        reject(asError(reason, 'Recovery operation rejected'));
                    });
                }
            );
            if (control.cancelled) {
                cancel(control.cancellationError ?? new RHIRecoveryCancelledError());
            }
        });
    }

    private cancelAttempt(control: RecoveryAttemptControl, error: RHIRecoveryCancelledError): void {
        if (control.cancelled) return;
        control.cancelled = true;
        control.cancellationError = error;
        control.rejectCancellation?.(error);
        if (control.candidate && !control.adopted) this.discardCandidate(control);
    }

    private throwIfCancelled(control: RecoveryAttemptControl): void {
        if (!control.cancelled && this.#state !== 'destroyed') return;
        throw control.cancellationError ?? new RHIRecoveryCancelledError();
    }

    private discardCandidate(control: RecoveryAttemptControl): void {
        const candidate = control.candidate;
        if (control.discarded || control.adopted || !candidate || candidate === this.#device) {
            return;
        }
        control.discarded = true;
        try {
            candidate.destroy();
        } catch {
            // Cleanup failure must not replace the recovery/cancellation cause.
        }
    }

    private emit(): void {
        if (this.#listeners.size === 0) return;
        const event = Object.freeze({
            state: this.#state,
            device: this.#device,
            attempt: this.#attemptCount,
            loss: this.#lastLoss,
            error: this.#failure
        } satisfies RHIRecoveryCoordinatorEvent);
        const listeners = [...this.#listeners];
        for (const listener of listeners) {
            try {
                listener(event);
            } catch (reason) {
                this.#listenerErrorCount++;
                this.#lastListenerError = reason;
            }
        }
    }

    private assertNotDestroyed(): void {
        if (this.#state === 'destroyed') {
            throw new Error('RHI recovery coordinator is destroyed');
        }
    }
}
