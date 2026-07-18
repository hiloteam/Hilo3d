import type { RHISubmission } from '../rhi/core';
import type { ResourceRegistry } from './ResourceRegistry';

interface TrackedSubmission {
    readonly frameIndex: number;
    readonly order: number;
    readonly deviceId: number;
    readonly deviceGeneration: number;
    settled: boolean;
}

interface IdleWaiter {
    resolve(): void;
    reject(reason: unknown): void;
}

interface TrackedFailure {
    readonly order: number;
    readonly deviceId: number;
    readonly deviceGeneration: number;
    readonly reason: unknown;
}

export interface SubmissionResourceTrackerDiagnostics {
    /** Fences that have not settled yet, independent of in-order retirement progress. */
    readonly pendingSubmissionCount: number;
    /** Highest frame whose tracked predecessors have all settled; -1 before the first completion. */
    readonly completedFrame: number;
    /** Cumulative logical resources retired through ResourceRegistry.collect(). */
    readonly collectedResourceCount: number;
}

function requireFrameIndex(frameIndex: number): void {
    if (!Number.isSafeInteger(frameIndex) || frameIndex < 0) {
        throw new RangeError('Submission frame index must be a non-negative safe integer');
    }
}

/**
 * Converts submission fences into conservative ResourceRegistry collection progress.
 *
 * A rejected fence still settles native ownership, so it advances the completion ledger while its
 * public promise and waitForIdle continue to report the original failure.
 */
export class SubmissionResourceTracker {
    readonly #submissions: TrackedSubmission[] = [];
    readonly #idleWaiters: IdleWaiter[] = [];
    #completionHead = 0;
    #nextOrder = 0;
    #lastTrackedFrame = -1;
    #completedFrame = -1;
    #pendingSubmissionCount = 0;
    #collectedResourceCount = 0;
    #submissionFailure: TrackedFailure | null = null;
    #internalFailure: TrackedFailure | null = null;
    #destroyed = false;

    constructor(readonly registry: ResourceRegistry) {
        if (registry.state === 'destroyed') {
            throw new Error('Cannot track submissions for a destroyed resource registry');
        }
    }

    get pendingSubmissionCount(): number {
        return this.#pendingSubmissionCount;
    }

    get completedFrame(): number {
        return this.#completedFrame;
    }

    get collectedResourceCount(): number {
        return this.#collectedResourceCount;
    }

    /** Track one strictly newer renderer frame and return the submission's original fence. */
    track(frameIndex: number, submission: RHISubmission): Promise<void> {
        if (this.#destroyed) throw new Error('Submission resource tracker is destroyed');
        requireFrameIndex(frameIndex);
        if (frameIndex <= this.#lastTrackedFrame) {
            throw new RangeError('Tracked submission frames must be strictly increasing');
        }
        if (submission.deviceId !== this.registry.deviceId) {
            throw new Error('Submission belongs to a different device than the resource registry');
        }
        if (submission.deviceGeneration !== this.registry.deviceGeneration) {
            throw new Error(
                'Submission belongs to a different device generation than the resource registry'
            );
        }
        if (this.#pendingSubmissionCount === Number.MAX_SAFE_INTEGER) {
            throw new RangeError('Pending submission count is exhausted');
        }
        if (this.#nextOrder === Number.MAX_SAFE_INTEGER) {
            throw new RangeError('Submission tracking order space is exhausted');
        }

        const tracked: TrackedSubmission = {
            frameIndex,
            order: this.#nextOrder++,
            deviceId: submission.deviceId,
            deviceGeneration: submission.deviceGeneration,
            settled: false
        };
        this.#lastTrackedFrame = frameIndex;
        this.#pendingSubmissionCount++;
        this.#submissions.push(tracked);

        const observer = submission.done.then(
            () => {
                this.settle(tracked, false, undefined);
            },
            (reason: unknown) => {
                this.settle(tracked, true, reason);
            }
        );
        // The observer is internal and must never surface an unhandled rejection. The original
        // submission.done promise is returned unchanged, so callers still observe its rejection.
        void observer.catch((reason: unknown) => {
            this.recordInternalFailure(tracked, reason);
            this.finishIdleWaitersIfReady();
        });
        return submission.done;
    }

    /** Collect against current in-order progress, or defer while the registry is recovering. */
    flush(): number {
        if (this.#destroyed) throw new Error('Submission resource tracker is destroyed');
        return this.collectCompletedResources();
    }

    /** Wait until every submission tracked before the next idle transition has settled. */
    async waitForIdle(): Promise<void> {
        if (this.#pendingSubmissionCount !== 0) {
            await new Promise<void>((resolve, reject) => {
                this.#idleWaiters.push({ resolve, reject });
            });
            return;
        }
        const failure = this.currentFailure();
        if (failure !== null) throw failure.reason;
    }

    /**
     * Acknowledge submission-fence failures handled at the current idle boundary.
     *
     * Recovery uses this only after it has rebuilt the device and synchronized every stable cache.
     * Tracker/collection failures are intentionally retained and continue to reject waitForIdle().
     */
    acknowledgeSubmissionFailures(deviceId: number, deviceGeneration: number): boolean {
        if (this.#destroyed) throw new Error('Submission resource tracker is destroyed');
        if (this.#pendingSubmissionCount !== 0) {
            throw new Error('Cannot acknowledge submission failures while fences are pending');
        }
        const failure = this.#submissionFailure;
        const acknowledged =
            failure !== null &&
            failure.deviceId === deviceId &&
            failure.deviceGeneration === deviceGeneration;
        if (!acknowledged) return false;
        this.#submissionFailure = null;
        return true;
    }

    diagnostics(): Readonly<SubmissionResourceTrackerDiagnostics> {
        return Object.freeze({
            pendingSubmissionCount: this.#pendingSubmissionCount,
            completedFrame: this.#completedFrame,
            collectedResourceCount: this.#collectedResourceCount
        });
    }

    /** Stop accepting submissions. Already tracked fences remain observed until they settle. */
    destroy(): void {
        this.#destroyed = true;
    }

    private settle(tracked: TrackedSubmission, failed: boolean, failure: unknown): void {
        if (tracked.settled) return;
        tracked.settled = true;
        this.#pendingSubmissionCount--;
        if (failed) this.recordSubmissionFailure(tracked, failure);
        try {
            if (this.advanceCompletedFrame() && !this.#destroyed) {
                this.collectCompletedResources();
            }
        } catch (error) {
            this.recordInternalFailure(tracked, error);
        }
        this.finishIdleWaitersIfReady();
    }

    private advanceCompletedFrame(): boolean {
        let advanced = false;
        while (this.#completionHead < this.#submissions.length) {
            const tracked = this.#submissions[this.#completionHead];
            if (!tracked?.settled) break;
            this.#completedFrame = tracked.frameIndex;
            this.#completionHead++;
            advanced = true;
        }
        if (this.#completionHead === this.#submissions.length) {
            this.#submissions.length = 0;
            this.#completionHead = 0;
        } else if (
            this.#completionHead >= 64 &&
            this.#completionHead * 2 >= this.#submissions.length
        ) {
            this.#submissions.splice(0, this.#completionHead);
            this.#completionHead = 0;
        }
        return advanced;
    }

    private collectCompletedResources(): number {
        if (this.#completedFrame < 0 || this.registry.state !== 'active') return 0;
        const collected = this.registry.collect(this.#completedFrame);
        this.#collectedResourceCount += collected;
        return collected;
    }

    private recordSubmissionFailure(tracked: TrackedSubmission, reason: unknown): void {
        if (this.#submissionFailure !== null && tracked.order >= this.#submissionFailure.order) {
            return;
        }
        this.#submissionFailure = {
            order: tracked.order,
            deviceId: tracked.deviceId,
            deviceGeneration: tracked.deviceGeneration,
            reason
        };
    }

    private recordInternalFailure(tracked: TrackedSubmission, reason: unknown): void {
        if (this.#internalFailure !== null && tracked.order >= this.#internalFailure.order) return;
        this.#internalFailure = {
            order: tracked.order,
            deviceId: tracked.deviceId,
            deviceGeneration: tracked.deviceGeneration,
            reason
        };
    }

    private currentFailure(): TrackedFailure | null {
        if (this.#submissionFailure === null) return this.#internalFailure;
        if (this.#internalFailure === null) return this.#submissionFailure;
        return this.#submissionFailure.order <= this.#internalFailure.order
            ? this.#submissionFailure
            : this.#internalFailure;
    }

    private finishIdleWaitersIfReady(): void {
        if (this.#pendingSubmissionCount !== 0 || this.#idleWaiters.length === 0) return;
        const waiters = this.#idleWaiters.splice(0);
        const failure = this.currentFailure();
        if (failure === null) {
            for (const waiter of waiters) waiter.resolve();
        } else {
            for (const waiter of waiters) waiter.reject(failure.reason);
        }
    }
}
