import { describe, expect, it } from 'vitest';
import { RHIBufferUsage, type RHIBuffer } from '../../../src/render/rhi/core';
import { ResourceRegistry, SubmissionResourceTracker } from '../../../src/render/renderer/index';
import {
    FakeWebGLRHIBackend,
    FakeWebGPURHIBackend,
    type FakeRHIBuffer,
    type FakeRHIDevice,
    type FakeRHISubmission
} from '../rhi/portable/FakeRHIBackend';

function submit(device: FakeRHIDevice): FakeRHISubmission {
    const frame = device.graphicsQueue.beginFrame();
    return device.graphicsQueue.endFrame(frame);
}

function releasedBuffer(
    registry: ResourceRegistry,
    frameIndex: number
): { readonly resource: FakeRHIBuffer } {
    const handle = registry.registerBuffer({ size: 4, usage: RHIBufferUsage.COPY_DST });
    const resource = registry.resolve(handle) as FakeRHIBuffer;
    registry.markUsed(handle, frameIndex);
    registry.release(handle);
    return { resource };
}

describe('SubmissionResourceTracker', () => {
    it('collects an immediate submission and enforces strictly increasing frames', async () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const tracker = new SubmissionResourceTracker(registry);
        const { resource } = releasedBuffer(registry, 1);

        await tracker.track(1, submit(device));
        await tracker.waitForIdle();

        expect(resource.destroyed).toBe(true);
        expect(tracker.diagnostics()).toEqual({
            pendingSubmissionCount: 0,
            completedFrame: 1,
            collectedResourceCount: 1
        });
        expect(() => tracker.track(1, submit(device))).toThrow(/strictly increasing/u);
        tracker.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('waits for deferred submissions in track order when fences settle out of order', async () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const tracker = new SubmissionResourceTracker(registry);
        const firstResource = releasedBuffer(registry, 1).resource;
        const secondResource = releasedBuffer(registry, 2).resource;
        const firstSubmission = submit(device);
        const secondSubmission = submit(device);
        const first = tracker.track(1, firstSubmission);
        const second = tracker.track(2, secondSubmission);
        let idleResolved = false;
        const idle = tracker.waitForIdle().then(() => {
            idleResolved = true;
        });

        secondSubmission.succeed();
        await second;

        expect(tracker.diagnostics()).toEqual({
            pendingSubmissionCount: 1,
            completedFrame: -1,
            collectedResourceCount: 0
        });
        expect(firstResource.destroyed).toBe(false);
        expect(secondResource.destroyed).toBe(false);
        expect(idleResolved).toBe(false);

        firstSubmission.succeed();
        await Promise.all([first, idle]);

        expect(firstResource.destroyed).toBe(true);
        expect(secondResource.destroyed).toBe(true);
        expect(tracker.diagnostics()).toEqual({
            pendingSubmissionCount: 0,
            completedFrame: 2,
            collectedResourceCount: 2
        });
        tracker.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('advances and collects after a failed fence while preserving the original rejection', async () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const tracker = new SubmissionResourceTracker(registry);
        const { resource } = releasedBuffer(registry, 5);
        const firstSubmission = submit(device);
        const secondSubmission = submit(device);
        const firstFailure = new Error('first tracked fence failed');
        const secondFailure = new Error('later tracked fence failed first');
        const first = tracker.track(5, firstSubmission);
        const second = tracker.track(6, secondSubmission);
        const idle = tracker.waitForIdle();

        expect(first).toBe(firstSubmission.done);
        expect(second).toBe(secondSubmission.done);
        secondSubmission.fail(secondFailure);
        await expect(second).rejects.toBe(secondFailure);
        expect(tracker.diagnostics().completedFrame).toBe(-1);
        expect(resource.destroyed).toBe(false);
        firstSubmission.fail(firstFailure);

        await expect(first).rejects.toBe(firstFailure);
        await expect(idle).rejects.toBe(firstFailure);
        expect(resource.destroyed).toBe(true);
        expect(tracker.diagnostics()).toEqual({
            pendingSubmissionCount: 0,
            completedFrame: 6,
            collectedResourceCount: 1
        });
        tracker.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('acknowledges only an idle submission-failure boundary and reports later failures', async () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const tracker = new SubmissionResourceTracker(registry);
        const firstSubmission = submit(device);
        const firstFailure = new Error('handled device-loss fence failure');
        const firstTracked = tracker.track(1, firstSubmission);

        expect(() => tracker.acknowledgeSubmissionFailures(device.id, device.generation)).toThrow(
            /fences are pending/u
        );
        firstSubmission.fail(firstFailure);
        await expect(firstTracked).rejects.toBe(firstFailure);
        await expect(tracker.waitForIdle()).rejects.toBe(firstFailure);

        expect(tracker.acknowledgeSubmissionFailures(device.id + 1, device.generation)).toBe(false);
        expect(tracker.acknowledgeSubmissionFailures(device.id, device.generation + 1)).toBe(false);
        expect(tracker.acknowledgeSubmissionFailures(device.id, device.generation)).toBe(true);
        expect(tracker.acknowledgeSubmissionFailures(device.id, device.generation)).toBe(false);
        await expect(tracker.waitForIdle()).resolves.toBeUndefined();

        const secondSubmission = submit(device);
        const secondFailure = new Error('new submission failure');
        const secondTracked = tracker.track(2, secondSubmission);
        secondSubmission.fail(secondFailure);
        await expect(secondTracked).rejects.toBe(secondFailure);
        await expect(tracker.waitForIdle()).rejects.toBe(secondFailure);

        tracker.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('pauses collection during failed recovery and flushes after recovery succeeds', async () => {
        const backend = new FakeWebGPURHIBackend();
        const firstDevice = backend.createDevice();
        const secondDevice = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const tracker = new SubmissionResourceTracker(registry);
        let failRecovery = false;
        let flushDuringRecovery = false;
        let recoveryFlushResult: number | null = null;
        const handle = registry.register<RHIBuffer>({
            label: 'recoverable tracked buffer',
            create(device) {
                if (failRecovery) throw new Error('injected recovery failure');
                if (flushDuringRecovery) recoveryFlushResult = tracker.flush();
                return device.createBuffer({ size: 4, usage: RHIBufferUsage.COPY_DST });
            }
        });
        const original = registry.resolve(handle) as FakeRHIBuffer;
        registry.markUsed(handle, 3);
        registry.release(handle);
        const submission = submit(firstDevice);
        const tracked = tracker.track(3, submission);

        failRecovery = true;
        expect(() => {
            registry.recover(secondDevice);
        }).toThrow('injected recovery failure');
        submission.succeed();
        await tracked;

        expect(registry.state).toBe('recovery-failed');
        expect(original.destroyed).toBe(false);
        expect(tracker.diagnostics().collectedResourceCount).toBe(0);
        expect(tracker.flush()).toBe(0);

        failRecovery = false;
        flushDuringRecovery = true;
        registry.recover(secondDevice);
        expect(recoveryFlushResult).toBe(0);
        const replacement = registry.resolve(handle) as FakeRHIBuffer;
        expect(replacement.destroyed).toBe(false);

        expect(tracker.flush()).toBe(1);
        expect(replacement.destroyed).toBe(true);
        expect(tracker.diagnostics().collectedResourceCount).toBe(1);
        tracker.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('rejects submissions owned by a different device without consuming the frame', async () => {
        const backend = new FakeWebGLRHIBackend();
        const registryDevice = backend.createDevice();
        const otherDevice = backend.createDevice();
        const registry = new ResourceRegistry(registryDevice);
        const tracker = new SubmissionResourceTracker(registry);

        expect(() => tracker.track(0, submit(otherDevice))).toThrow(/different device/u);
        await tracker.track(0, submit(registryDevice));
        expect(tracker.diagnostics().completedFrame).toBe(0);
        tracker.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('rejects a newer generation on the same device without consuming the frame', async () => {
        const backend = new FakeWebGLRHIBackend();
        const firstDevice = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const tracker = new SubmissionResourceTracker(registry);

        firstDevice.advanceGeneration();
        expect(() => tracker.track(0, submit(firstDevice))).toThrow(/different device generation/u);

        const replacement = backend.createDevice();
        registry.recover(replacement);
        await tracker.track(0, submit(replacement));
        expect(tracker.completedFrame).toBe(0);

        tracker.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('rejects new tracking after destroy while safely observing a late failed fence', async () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const tracker = new SubmissionResourceTracker(registry);
        const submission = submit(device);
        const failure = new Error('late failure after tracker destroy');
        void tracker.track(0, submission);
        const idle = tracker.waitForIdle();

        tracker.destroy();
        expect(() => tracker.track(1, submission)).toThrow(/tracker is destroyed/u);
        submission.fail(failure);

        await expect(idle).rejects.toBe(failure);
        expect(tracker.diagnostics()).toEqual({
            pendingSubmissionCount: 0,
            completedFrame: 0,
            collectedResourceCount: 0
        });
        registry.destroy();
        backend.destroy();
    });
});
