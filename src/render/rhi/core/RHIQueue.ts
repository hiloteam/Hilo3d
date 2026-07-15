import type { RHICommandContext, RHIFrameDiagnostics } from './RHICommands';
import type { RHIDeviceOwnedObject } from './RHIResources';

export interface RHIFrameDescriptor {
    readonly label?: string;
    readonly frameIndex?: number;
    /** Optional caller-owned reusable counters. The queue resets them at beginFrame. */
    readonly diagnostics?: RHIFrameDiagnostics;
}

export type RHIQueueState = 'idle' | 'frame-open' | 'lost' | 'destroyed';
export type RHISubmissionStatus = 'pending' | 'succeeded' | 'failed';

/**
 * Submission completion is the lifetime fence for every object referenced by its frame. The RHI
 * retains those native allocations until `done` settles, even after logical destroy().
 */
export interface RHISubmission extends RHIDeviceOwnedObject {
    readonly frameId: number;
    readonly status: RHISubmissionStatus;
    readonly done: Promise<void>;
    readonly error?: unknown;
}

/** The first RHI v2 revision exposes exactly one exclusive graphics frame scope. */
export interface RHIQueue extends RHIDeviceOwnedObject {
    readonly state: RHIQueueState;

    beginFrame(descriptor?: RHIFrameDescriptor): RHICommandContext;
    endFrame(context: RHICommandContext): RHISubmission;
    abortFrame(context: RHICommandContext, reason?: unknown): void;
    onSubmittedWorkDone(submission?: RHISubmission): Promise<void>;
}
