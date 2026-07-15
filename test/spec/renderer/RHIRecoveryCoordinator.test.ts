import { RHIBufferUsage, type RHIBuffer } from '../../../src/render/rhi/core';
import {
    RHIRecoveryCancelledError,
    RHIRecoveryCoordinator,
    type RHIRecoveryCoordinatorState,
    type RHIReplacementDeviceRequest
} from '../../../src/render/renderer/RHIRecoveryCoordinator';
import { ResourceRegistry } from '../../../src/render/renderer/ResourceRegistry';
import { SubmissionResourceTracker } from '../../../src/render/renderer/SubmissionResourceTracker';
import { describe, expect, it, vi } from 'vitest';
import {
    FakeRHISubmission,
    FakeWebGLRHIBackend,
    FakeWebGPURHIBackend,
    type FakeRHIBuffer,
    type FakeRHIBackend,
    type FakeRHIDevice
} from '../rhi/portable/FakeRHIBackend';

interface Deferred<T> {
    readonly promise: Promise<T>;
    resolve(value: T | PromiseLike<T>): void;
    reject(reason?: unknown): void;
}

function deferred<T>(): Deferred<T> {
    let resolvePromise: ((value: T | PromiseLike<T>) => void) | undefined;
    let rejectPromise: ((reason?: unknown) => void) | undefined;
    const promise = new Promise<T>((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
    });
    return {
        promise,
        resolve: value => resolvePromise?.(value),
        reject: reason => rejectPromise?.(reason)
    };
}

async function waitUntil(predicate: () => boolean, message: string): Promise<void> {
    for (let attempt = 0; attempt < 32; attempt++) {
        if (predicate()) return;
        await Promise.resolve();
    }
    throw new Error(message);
}

async function waitForRecoveryStart(coordinator: RHIRecoveryCoordinator): Promise<void> {
    await waitUntil(() => coordinator.recoveryPromise !== null, 'RHI recovery did not start');
}

function requireRecoveryPromise(coordinator: RHIRecoveryCoordinator): Promise<void> {
    const recovery = coordinator.recoveryPromise;
    if (!recovery) throw new Error('RHI recovery promise is unavailable');
    return recovery;
}

function createBuffer(registry: ResourceRegistry): {
    readonly handle: ReturnType<ResourceRegistry['registerBuffer']>;
    readonly resource: FakeRHIBuffer;
} {
    const handle = registry.registerBuffer({
        label: 'recovery coordinator buffer',
        size: 4,
        usage: RHIBufferUsage.COPY_DST,
        initialData: new Uint8Array([1, 2, 3, 4])
    });
    return { handle, resource: registry.resolve(handle) as FakeRHIBuffer };
}

function cleanup(
    coordinator: RHIRecoveryCoordinator,
    submissions: SubmissionResourceTracker,
    registry: ResourceRegistry,
    ...backends: FakeRHIBackend[]
): void {
    coordinator.destroy();
    submissions.destroy();
    registry.destroy();
    for (const backend of backends) backend.destroy();
}

describe.each([
    ['WebGL2', () => new FakeWebGLRHIBackend()],
    ['WebGPU', () => new FakeWebGPURHIBackend()]
] as const)('RHIRecoveryCoordinator on fake %s', (_name, createBackend) => {
    it('rebuilds the registry, synchronizes caches, and isolates observer exceptions', async () => {
        const backend = createBackend();
        const firstDevice = backend.createDevice();
        const replacement = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const submissions = new SubmissionResourceTracker(registry);
        const original = createBuffer(registry);
        const factory = vi.fn((request: Readonly<RHIReplacementDeviceRequest>) => {
            expect(request.backend).toBe(firstDevice.backend);
            expect(request.lostDevice).toBe(firstDevice);
            expect(request.loss).toMatchObject({ reason: 'reset', generation: 1 });
            expect(request.attempt).toBe(1);
            expect(submissions.pendingSubmissionCount).toBe(0);
            return replacement;
        });
        const coordinator = new RHIRecoveryCoordinator({
            device: firstDevice,
            registry,
            submissions,
            createReplacementDevice: factory
        });
        const synchronized = vi.fn(() => {
            expect(registry.deviceId).toBe(replacement.id);
            expect((registry.resolve(original.handle) as FakeRHIBuffer).deviceId).toBe(
                replacement.id
            );
        });
        coordinator.registerSynchronizer({ synchronizeAfterRecovery: synchronized });
        const states: RHIRecoveryCoordinatorState[] = [];
        coordinator.addListener(() => {
            throw new Error('observer failure must be isolated');
        });
        coordinator.addListener(event => {
            states.push(event.state);
        });

        firstDevice.advanceGeneration();
        await waitForRecoveryStart(coordinator);
        await requireRecoveryPromise(coordinator);

        expect(factory).toHaveBeenCalledOnce();
        expect(synchronized).toHaveBeenCalledOnce();
        expect(coordinator.state).toBe('ready');
        expect(coordinator.device).toBe(replacement);
        expect(coordinator.failure).toBeNull();
        expect(coordinator.lastLoss).toMatchObject({ reason: 'reset', generation: 1 });
        expect(registry.deviceId).toBe(replacement.id);
        expect(registry.generation).toBe(2);
        expect(registry.resolve(original.handle)).not.toBe(original.resource);
        expect(original.resource.destroyed).toBe(true);
        expect(states).toEqual(['recovering', 'ready']);
        expect(coordinator.listenerErrorCount).toBe(2);
        expect(coordinator.lastListenerError).toBeInstanceOf(Error);
        expect(coordinator.diagnostics()).toEqual({
            state: 'ready',
            attemptCount: 1,
            successfulRecoveryCount: 1,
            staleLossCount: 0,
            listenerErrorCount: 2
        });

        cleanup(coordinator, submissions, registry, backend);
    });

    it('fails closed when the replacement factory rejects', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const submissions = new SubmissionResourceTracker(registry);
        const failure = new Error('replacement factory failed');
        const synchronizeAfterRecovery = vi.fn();
        const coordinator = new RHIRecoveryCoordinator({
            device,
            registry,
            submissions,
            createReplacementDevice: () => Promise.reject(failure)
        });
        coordinator.registerSynchronizer({ synchronizeAfterRecovery });

        device.advanceGeneration();
        await waitForRecoveryStart(coordinator);
        await expect(requireRecoveryPromise(coordinator)).rejects.toBe(failure);

        expect(coordinator.state).toBe('failed');
        expect(coordinator.failure).toBe(failure);
        expect(coordinator.device).toBe(device);
        expect(registry.state).toBe('recovery-failed');
        expect(registry.deviceId).toBe(device.id);
        expect(registry.generation).toBe(1);
        expect(synchronizeAfterRecovery).not.toHaveBeenCalled();

        cleanup(coordinator, submissions, registry, backend);
    });
});

describe('RHIRecoveryCoordinator submission and cancellation boundaries', () => {
    it('does not call the factory until a controllable deferred submission settles', async () => {
        const backend = new FakeWebGPURHIBackend();
        const firstDevice = backend.createDevice();
        const replacement = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const submissions = new SubmissionResourceTracker(registry);
        const pending = new FakeRHISubmission(firstDevice.graphicsQueue, 17, []);
        void submissions.track(17, pending);
        const factory = vi.fn(() => replacement);
        const coordinator = new RHIRecoveryCoordinator({
            device: firstDevice,
            registry,
            submissions,
            createReplacementDevice: factory
        });

        firstDevice.advanceGeneration();
        await waitForRecoveryStart(coordinator);
        const recovery = requireRecoveryPromise(coordinator);
        await Promise.resolve();
        await Promise.resolve();
        expect(coordinator.state).toBe('recovering');
        expect(submissions.pendingSubmissionCount).toBe(1);
        expect(factory).not.toHaveBeenCalled();
        expect(registry.deviceId).toBe(firstDevice.id);

        pending.succeed();
        await recovery;
        expect(factory).toHaveBeenCalledOnce();
        expect(submissions.pendingSubmissionCount).toBe(0);
        expect(registry.deviceId).toBe(replacement.id);
        expect(coordinator.state).toBe('ready');

        cleanup(coordinator, submissions, registry, backend);
    });

    it('waits for submissions tracked while an asynchronous factory is running', async () => {
        const backend = new FakeWebGPURHIBackend();
        const firstDevice = backend.createDevice();
        const replacement = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const submissions = new SubmissionResourceTracker(registry);
        const waitForIdle = vi.spyOn(submissions, 'waitForIdle');
        const replacementGate = deferred<FakeRHIDevice>();
        const factory = vi.fn(() => replacementGate.promise);
        // A frame that finished on the adopted generation just before loss may reach the tracker
        // after asynchronous recovery has already started.
        const lateSubmission = new FakeRHISubmission(firstDevice.graphicsQueue, 18, []);
        const coordinator = new RHIRecoveryCoordinator({
            device: firstDevice,
            registry,
            submissions,
            createReplacementDevice: factory
        });

        firstDevice.advanceGeneration();
        await waitForRecoveryStart(coordinator);
        const recovery = requireRecoveryPromise(coordinator);
        await waitUntil(() => factory.mock.calls.length === 1, 'replacement factory did not start');

        void submissions.track(18, lateSubmission);
        replacementGate.resolve(replacement);
        await waitUntil(
            () => waitForIdle.mock.calls.length >= 2,
            'recovery did not recheck the submission boundary'
        );

        expect(submissions.pendingSubmissionCount).toBe(1);
        expect(coordinator.state).toBe('recovering');
        expect(registry.deviceId).toBe(firstDevice.id);
        expect(replacement.destroyed).toBe(false);

        lateSubmission.succeed();
        await recovery;
        expect(submissions.pendingSubmissionCount).toBe(0);
        expect(registry.deviceId).toBe(replacement.id);
        expect(coordinator.state).toBe('ready');

        cleanup(coordinator, submissions, registry, backend);
    });

    it('cancels immediately on destroy and disposes a late unadopted factory result', async () => {
        const backend = new FakeWebGPURHIBackend();
        const firstDevice = backend.createDevice();
        const lateReplacement = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const submissions = new SubmissionResourceTracker(registry);
        const replacement = deferred<FakeRHIDevice>();
        const factory = vi.fn(() => replacement.promise);
        const synchronizeAfterRecovery = vi.fn();
        const coordinator = new RHIRecoveryCoordinator({
            device: firstDevice,
            registry,
            submissions,
            createReplacementDevice: factory
        });
        coordinator.registerSynchronizer({ synchronizeAfterRecovery });

        firstDevice.advanceGeneration();
        await waitForRecoveryStart(coordinator);
        const recovery = requireRecoveryPromise(coordinator);
        await waitUntil(
            () => factory.mock.calls.length === 1,
            'replacement factory was not called'
        );
        coordinator.destroy();

        await expect(recovery).rejects.toBeInstanceOf(RHIRecoveryCancelledError);
        expect(coordinator.state).toBe('destroyed');
        expect(registry.state).toBe('recovery-failed');
        expect(registry.deviceId).toBe(firstDevice.id);
        expect(synchronizeAfterRecovery).not.toHaveBeenCalled();
        expect(firstDevice.destroyed).toBe(false);

        replacement.resolve(lateReplacement);
        await Promise.resolve();
        await Promise.resolve();
        expect(lateReplacement.destroyed).toBe(true);
        submissions.destroy();
        registry.destroy();
        backend.destroy();
    });
});

describe('RHIRecoveryCoordinator validation and failure atomicity', () => {
    it('rejects and disposes a replacement from a foreign backend', async () => {
        const webgl = new FakeWebGLRHIBackend();
        const webgpu = new FakeWebGPURHIBackend();
        const firstDevice = webgl.createDevice();
        const foreign = webgpu.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const submissions = new SubmissionResourceTracker(registry);
        const coordinator = new RHIRecoveryCoordinator({
            device: firstDevice,
            registry,
            submissions,
            createReplacementDevice: () => foreign
        });

        firstDevice.advanceGeneration();
        await waitForRecoveryStart(coordinator);
        await expect(requireRecoveryPromise(coordinator)).rejects.toThrow(/same backend/u);

        expect(coordinator.state).toBe('failed');
        expect(registry.state).toBe('recovery-failed');
        expect(registry.deviceId).toBe(firstDevice.id);
        expect(foreign.destroyed).toBe(true);
        cleanup(coordinator, submissions, registry, webgl, webgpu);
    });

    it('preserves original registry resources when reconstruction fails atomically', async () => {
        const backend = new FakeWebGLRHIBackend();
        const firstDevice = backend.createDevice();
        const candidate = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const submissions = new SubmissionResourceTracker(registry);
        const replacements: FakeRHIBuffer[] = [];
        const firstHandle = registry.register<RHIBuffer>({
            label: 'successful recovery prefix',
            create(device) {
                const buffer = device.createBuffer({ size: 4, usage: RHIBufferUsage.COPY_DST });
                if (device === candidate) replacements.push(buffer as FakeRHIBuffer);
                return buffer;
            }
        });
        const failure = new Error('injected registry rebuild failure');
        const secondHandle = registry.register<RHIBuffer>({
            label: 'failing recovery recipe',
            create(device) {
                if (device === candidate) throw failure;
                return device.createBuffer({ size: 4, usage: RHIBufferUsage.COPY_DST });
            }
        });
        const firstOriginal = registry.resolve(firstHandle) as FakeRHIBuffer;
        const secondOriginal = registry.resolve(secondHandle) as FakeRHIBuffer;
        const synchronizeAfterRecovery = vi.fn();
        const coordinator = new RHIRecoveryCoordinator({
            device: firstDevice,
            registry,
            submissions,
            createReplacementDevice: () => candidate
        });
        coordinator.registerSynchronizer({ synchronizeAfterRecovery });

        firstDevice.advanceGeneration();
        await waitForRecoveryStart(coordinator);
        await expect(requireRecoveryPromise(coordinator)).rejects.toBe(failure);
        await Promise.resolve();

        expect(coordinator.state).toBe('failed');
        expect(registry.state).toBe('recovery-failed');
        expect(registry.deviceId).toBe(firstDevice.id);
        expect(registry.generation).toBe(1);
        expect(firstOriginal.destroyed).toBe(false);
        expect(secondOriginal.destroyed).toBe(false);
        expect(replacements).toHaveLength(1);
        expect(replacements[0]?.destroyed).toBe(true);
        expect(candidate.destroyed).toBe(true);
        expect(synchronizeAfterRecovery).not.toHaveBeenCalled();
        expect(coordinator.diagnostics().staleLossCount).toBeGreaterThanOrEqual(1);

        cleanup(coordinator, submissions, registry, backend);
    });

    it('fails closed if a required post-recovery synchronizer throws', async () => {
        const backend = new FakeWebGLRHIBackend();
        const firstDevice = backend.createDevice();
        const replacement = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const submissions = new SubmissionResourceTracker(registry);
        const original = createBuffer(registry).resource;
        const failure = new Error('cache synchronization failed');
        const laterSynchronizer = vi.fn();
        const coordinator = new RHIRecoveryCoordinator({
            device: firstDevice,
            registry,
            submissions,
            createReplacementDevice: () => replacement
        });
        coordinator.registerSynchronizer({
            synchronizeAfterRecovery() {
                throw failure;
            }
        });
        coordinator.registerSynchronizer({ synchronizeAfterRecovery: laterSynchronizer });

        firstDevice.advanceGeneration();
        await waitForRecoveryStart(coordinator);
        await expect(requireRecoveryPromise(coordinator)).rejects.toBe(failure);

        expect(coordinator.state).toBe('failed');
        expect(coordinator.device).toBe(replacement);
        expect(registry.state).toBe('recovery-failed');
        expect(registry.deviceId).toBe(replacement.id);
        expect(registry.generation).toBe(2);
        expect(original.destroyed).toBe(true);
        expect(replacement.destroyed).toBe(false);
        expect(laterSynchronizer).not.toHaveBeenCalled();

        cleanup(coordinator, submissions, registry, backend);
    });

    it('rejects a replacement whose loss promise was already settled', async () => {
        const backend = new FakeWebGPURHIBackend();
        const firstDevice = backend.createDevice();
        const alreadyLost = backend.createDevice();
        alreadyLost.advanceGeneration();
        const registry = new ResourceRegistry(firstDevice);
        const submissions = new SubmissionResourceTracker(registry);
        const coordinator = new RHIRecoveryCoordinator({
            device: firstDevice,
            registry,
            submissions,
            createReplacementDevice: () => alreadyLost
        });

        firstDevice.advanceGeneration();
        await waitForRecoveryStart(coordinator);
        await expect(requireRecoveryPromise(coordinator)).rejects.toThrow(/already lost/u);
        expect(coordinator.state).toBe('failed');
        expect(registry.deviceId).toBe(firstDevice.id);
        expect(alreadyLost.destroyed).toBe(true);

        cleanup(coordinator, submissions, registry, backend);
    });
});

describe('RHIRecoveryCoordinator consecutive losses', () => {
    it('serializes replacement factories across consecutive device losses', async () => {
        const backend = new FakeWebGPURHIBackend();
        const firstDevice = backend.createDevice();
        const secondDevice = backend.createDevice();
        const thirdDevice = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const submissions = new SubmissionResourceTracker(registry);
        const gates = [deferred<FakeRHIDevice>(), deferred<FakeRHIDevice>()];
        let activeFactories = 0;
        let maxActiveFactories = 0;
        let callIndex = 0;
        const factory = vi.fn(async () => {
            const index = callIndex++;
            activeFactories++;
            maxActiveFactories = Math.max(maxActiveFactories, activeFactories);
            try {
                const gate = gates[index];
                if (!gate) throw new Error('unexpected replacement request');
                return await gate.promise;
            } finally {
                activeFactories--;
            }
        });
        const synchronizeAfterRecovery = vi.fn();
        const coordinator = new RHIRecoveryCoordinator({
            device: firstDevice,
            registry,
            submissions,
            createReplacementDevice: factory
        });
        coordinator.registerSynchronizer({ synchronizeAfterRecovery });

        firstDevice.advanceGeneration();
        await waitForRecoveryStart(coordinator);
        const firstRecovery = requireRecoveryPromise(coordinator);
        await waitUntil(() => factory.mock.calls.length === 1, 'first factory did not start');
        gates[0]?.resolve(secondDevice);
        await firstRecovery;
        expect(coordinator.device).toBe(secondDevice);

        secondDevice.advanceGeneration();
        await waitUntil(
            () => coordinator.diagnostics().attemptCount === 2,
            'second recovery did not start'
        );
        const secondRecovery = coordinator.recoveryPromise;
        if (!secondRecovery) throw new Error('second recovery promise is unavailable');
        await waitUntil(() => factory.mock.calls.length === 2, 'second factory did not start');
        gates[1]?.resolve(thirdDevice);
        await secondRecovery;

        expect(maxActiveFactories).toBe(1);
        expect(factory).toHaveBeenCalledTimes(2);
        expect(synchronizeAfterRecovery).toHaveBeenCalledTimes(2);
        expect(coordinator.state).toBe('ready');
        expect(coordinator.device).toBe(thirdDevice);
        expect(registry.deviceId).toBe(thirdDevice.id);
        expect(registry.generation).toBe(3);
        expect(coordinator.diagnostics()).toMatchObject({
            attemptCount: 2,
            successfulRecoveryCount: 2
        });

        cleanup(coordinator, submissions, registry, backend);
    });
});
