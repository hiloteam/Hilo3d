import type { RHIUploadBatch, RHIUploadBatchParticipant } from '../frame/RHIUploadBatch';
import type { RHIDeviceOwnedDestroyable, RHISubmission } from '../rhi/core';
import type { ResourceRegistry, ResourceRegistryHandle } from './ResourceRegistry';

type FrameResourceUseTrackerState = 'idle' | 'active' | 'destroyed';

/**
 * Transactional last-used-frame publication for non-upload renderer resources.
 *
 * Build-time `use` calls retain logical handles so cache replacement cannot retire resources that
 * are already referenced by a PreparedDraw. The frame index becomes visible only after graph
 * execution returns a valid submission; failures release every retain without advancing lifetime.
 */
export class FrameResourceUseTracker implements RHIUploadBatchParticipant {
    readonly #handles: (ResourceRegistryHandle<RHIDeviceOwnedDestroyable> | null)[] = [];
    #handleCount = 0;
    #frameIndex = 0;
    #state: FrameResourceUseTrackerState = 'idle';

    constructor(readonly registry: ResourceRegistry) {}

    get active(): boolean {
        return this.#state === 'active';
    }

    get stagedUseCount(): number {
        return this.#handleCount;
    }

    beginFrame(frameIndex: number, uploads: RHIUploadBatch): void {
        if (this.#state === 'destroyed') throw new Error('Frame resource-use tracker is destroyed');
        if (this.#state === 'active')
            throw new Error('Frame resource-use tracker is already active');
        if (!Number.isSafeInteger(frameIndex) || frameIndex < 0) {
            throw new RangeError('Resource-use frame index must be a non-negative safe integer');
        }
        this.#frameIndex = frameIndex;
        this.#state = 'active';
        uploads.enlist(this);
    }

    use(handle: ResourceRegistryHandle<RHIDeviceOwnedDestroyable>): void {
        this.assertActive();
        this.registry.retain(handle);
        this.#handles[this.#handleCount++] = handle;
    }

    prepareCommit(submission: RHISubmission): void {
        this.assertActive();
        if (submission.status === 'failed') {
            throw new Error('Cannot commit resource uses for a failed submission');
        }
        if (submission.deviceId !== this.registry.deviceId) {
            throw new Error('Resource-use submission belongs to another RHI device');
        }
        for (let index = 0; index < this.#handleCount; index += 1) {
            const handle = this.#handles[index];
            if (handle !== null && handle !== undefined) this.registry.resolve(handle);
        }
    }

    commit(submission: RHISubmission): void {
        this.prepareCommit(submission);
        try {
            for (let index = 0; index < this.#handleCount; index += 1) {
                const handle = this.#handles[index];
                if (handle !== null && handle !== undefined) {
                    this.registry.markUsed(handle, this.#frameIndex);
                }
            }
        } finally {
            this.releaseStagedHandles();
            this.#state = 'idle';
        }
    }

    rollback(): void {
        if (this.#state !== 'active') return;
        try {
            this.releaseStagedHandles();
        } finally {
            this.#state = 'idle';
        }
    }

    destroy(): void {
        if (this.#state === 'destroyed') return;
        if (this.#state === 'active') {
            throw new Error('Cannot destroy an active frame resource-use tracker');
        }
        this.#handles.length = 0;
        this.#state = 'destroyed';
    }

    private releaseStagedHandles(): void {
        let firstError: Error | undefined;
        for (let index = this.#handleCount - 1; index >= 0; index -= 1) {
            const handle = this.#handles[index];
            this.#handles[index] = null;
            if (handle === null || handle === undefined) continue;
            try {
                this.registry.release(handle);
            } catch (error) {
                firstError ??=
                    error instanceof Error
                        ? error
                        : new Error('Failed to release a staged renderer resource');
            }
        }
        this.#handleCount = 0;
        if (firstError !== undefined) throw firstError;
    }

    private assertActive(): void {
        if (this.#state !== 'active') {
            if (this.#state === 'destroyed') {
                throw new Error('Frame resource-use tracker is destroyed');
            }
            throw new Error('Frame resource-use tracker requires beginFrame before use');
        }
    }
}
