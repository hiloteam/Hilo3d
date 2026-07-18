import { RenderGraph } from '../../../src/render/graph/RenderGraph';
import type { RenderPassTemplate } from '../../../src/render/graph/RenderGraphBuilder';
import type { RGTextureHandle } from '../../../src/render/graph/RenderGraphResource';
import {
    RHIRecoveryCoordinator,
    type RHIReplacementDeviceRequest
} from '../../../src/render/renderer/RHIRecoveryCoordinator';
import { RenderTargetResourceCache } from '../../../src/render/renderer/RenderTargetResourceCache';
import {
    RendererRecoveringError,
    ResourceRegistry
} from '../../../src/render/renderer/ResourceRegistry';
import { SubmissionResourceTracker } from '../../../src/render/renderer/SubmissionResourceTracker';
import { RHIBufferUsage, type RHISubmission, type RHITexture } from '../../../src/render/rhi/core';
import { describe, expect, it, vi } from 'vitest';
import {
    FakeWebGLRHIBackend,
    FakeWebGPURHIBackend,
    type FakeRHIBackend,
    type FakeRHIDevice,
    type FakeRHISubmission
} from '../rhi/portable/FakeRHIBackend';

interface Deferred<T> {
    readonly promise: Promise<T>;
    resolve(value: T | PromiseLike<T>): void;
}

interface SelectionPassParameters {
    readonly texture: RGTextureHandle;
    select(texture: RHITexture): void;
}

const selectionPass: RenderPassTemplate<SelectionPassParameters> = {
    name: 'RecoveryTargetSelectionPass',
    setup(builder, params) {
        builder.readTexture(params.texture);
        builder.markSideEffect();
    },
    execute(context, params) {
        params.select(context.getTexture(params.texture));
    }
};

function deferred<T>(): Deferred<T> {
    let resolvePromise: ((value: T | PromiseLike<T>) => void) | undefined;
    const promise = new Promise<T>(resolve => {
        resolvePromise = resolve;
    });
    return {
        promise,
        resolve: value => resolvePromise?.(value)
    };
}

async function waitUntil(predicate: () => boolean, message: string): Promise<void> {
    for (let attempt = 0; attempt < 64; attempt += 1) {
        if (predicate()) return;
        await Promise.resolve();
    }
    throw new Error(message);
}

function submit(device: FakeRHIDevice, frameIndex: number): FakeRHISubmission {
    const context = device.graphicsQueue.beginFrame({ frameIndex });
    return device.graphicsQueue.endFrame(context);
}

async function completeSubmission(
    backend: FakeRHIBackend,
    submission: RHISubmission
): Promise<void> {
    if (backend.executionMode === 'deferred') {
        const completed = backend.completeNextSubmission();
        expect(completed).toBe(submission);
    }
    await submission.done;
}

describe.each([
    ['WebGL context loss', () => new FakeWebGLRHIBackend()],
    ['WebGPU device loss', () => new FakeWebGPURHIBackend()]
] as const)('Phase 6 recovery gate on %s', (_name, createBackend) => {
    it('gates build/execute and preserves logical target identity and recovered selection', async () => {
        const backend = createBackend();
        const firstDevice = backend.createDevice();
        const replacement = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const submissions = new SubmissionResourceTracker(registry);
        const targets = new RenderTargetResourceCache(registry);
        const owner = {};
        const target = targets.prepare(owner, {
            label: 'recoverable target selection',
            width: 8,
            height: 4,
            colorFormats: ['rgba8unorm']
        });
        const color = target.colorAttachments[0];
        if (color === undefined) throw new Error('Recovery fixture color attachment is missing');
        if (color.texture === null) {
            throw new Error('Recovery fixture requires a persistent color attachment');
        }
        const stableRecord = target;
        const stableToken = target.token;
        const stableTextureHandle = color.texture;
        const originalTexture = targets.resolve(target).colors[0]?.texture;
        if (originalTexture === null || originalTexture === undefined) {
            throw new Error('Recovery fixture texture is missing');
        }

        let selectedTexture: RHITexture | null = null;
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const imported = builder.importTextureProvider(
            'recoverable target provider',
            color.textureDescriptor,
            () => registry.resolve(stableTextureHandle),
            'persistent'
        );
        builder.addPass(
            selectionPass,
            Object.freeze({
                texture: imported,
                select(texture: RHITexture) {
                    selectedTexture = texture;
                }
            })
        );
        const compiled = graph.compile(builder, firstDevice.capabilities);

        const retired = registry.registerBuffer({
            label: 'pre-loss retired buffer',
            size: 4,
            usage: RHIBufferUsage.COPY_DST
        });
        registry.markUsed(retired, 7);
        registry.release(retired);
        const preLossSubmission = submit(firstDevice, 7);
        void submissions.track(7, preLossSubmission).catch(() => undefined);

        const replacementGate = deferred<FakeRHIDevice>();
        const factory = vi.fn(
            (_request: Readonly<RHIReplacementDeviceRequest>) => replacementGate.promise
        );
        const coordinator = new RHIRecoveryCoordinator({
            device: firstDevice,
            registry,
            submissions,
            createReplacementDevice: factory
        });

        firstDevice.advanceGeneration();
        await waitUntil(() => factory.mock.calls.length === 1, 'replacement factory did not start');

        expect(coordinator.state).toBe('recovering');
        expect(registry.state).toBe('recovering');
        expect(registry.deviceGeneration).toBe(1);
        expect(() => targets.resolve(target)).toThrow(RendererRecoveringError);
        expect(() =>
            targets.prepare({}, { width: 1, height: 1, colorFormats: ['rgba8unorm'] })
        ).toThrow(RendererRecoveringError);
        expect(() => graph.execute(compiled, firstDevice, { frameIndex: 8 })).toThrow(
            RendererRecoveringError
        );
        expect(selectedTexture).toBeNull();
        expect(firstDevice.graphicsQueue.state).toBe('idle');

        replacementGate.resolve(replacement);
        const recovery = coordinator.recoveryPromise;
        if (recovery === null) throw new Error('Recovery promise is unavailable');
        await recovery;

        expect(coordinator.state).toBe('ready');
        expect(registry.state).toBe('active');
        expect(registry.deviceId).toBe(replacement.id);
        expect(registry.deviceGeneration).toBe(replacement.generation);
        expect(target).toBe(stableRecord);
        expect(target.token).toBe(stableToken);
        expect(target.colorAttachments[0]?.texture).toBe(stableTextureHandle);
        expect(() => registry.resolve(retired)).toThrow(/stale or released/u);
        expect(registry.diagnostics()).toMatchObject({
            trackedResourceCount: 2,
            pendingReleaseCount: 0
        });

        const recoveredTexture = targets.resolve(target).colors[0]?.texture;
        expect(recoveredTexture).toBeDefined();
        expect(recoveredTexture).not.toBe(originalTexture);
        expect(recoveredTexture?.deviceId).toBe(replacement.id);
        expect(originalTexture.destroyed).toBe(true);

        targets.markUsed(target, 8);
        const recoveredExecution = graph.execute(compiled, replacement, { frameIndex: 8 });
        const recoveredDone = submissions.track(8, recoveredExecution.submission);
        await completeSubmission(backend, recoveredExecution.submission);
        await recoveredDone;
        expect(selectedTexture).toBe(recoveredTexture);

        targets.destroy();
        expect(submissions.flush()).toBe(2);
        expect(registry.diagnostics()).toMatchObject({
            trackedResourceCount: 0,
            pendingReleaseCount: 0
        });

        coordinator.destroy();
        submissions.destroy();
        graph.destroy();
        registry.destroy();
        backend.destroy();
    });
});

describe.each([
    ['WebGL immediate', () => new FakeWebGLRHIBackend()],
    ['WebGPU deferred', () => new FakeWebGPURHIBackend()]
] as const)('Phase 6 10,000-frame churn on %s', (_name, createBackend) => {
    it('keeps registry, pending release, submission, and native resource counts bounded', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const submissions = new SubmissionResourceTracker(registry);
        const targets = new RenderTargetResourceCache(registry);
        const inFlight: { submission: FakeRHISubmission; done: Promise<void> }[] = [];
        let maxTrackedResources = 0;
        let maxPendingReleases = 0;
        let maxPendingSubmissions = 0;

        for (let frameIndex = 0; frameIndex < 10_000; frameIndex += 1) {
            const owner = {};
            const target = targets.prepare(owner, {
                width: 2,
                height: 2,
                colorFormats: ['rgba8unorm']
            });
            const buffer = registry.registerBuffer({
                size: 4,
                usage: RHIBufferUsage.COPY_DST
            });
            targets.markUsed(target, frameIndex);
            registry.markUsed(buffer, frameIndex);
            expect(targets.release(owner)).toBe(true);
            registry.release(buffer);

            const submission = submit(device, frameIndex);
            const done = submissions.track(frameIndex, submission);
            inFlight.push({ submission, done });

            const diagnostics = registry.diagnostics();
            maxTrackedResources = Math.max(maxTrackedResources, diagnostics.trackedResourceCount);
            maxPendingReleases = Math.max(maxPendingReleases, diagnostics.pendingReleaseCount);
            maxPendingSubmissions = Math.max(
                maxPendingSubmissions,
                submissions.pendingSubmissionCount
            );

            const windowSize = backend.executionMode === 'deferred' ? 4 : 1;
            if (inFlight.length >= windowSize) {
                const oldest = inFlight.shift();
                if (oldest === undefined) throw new Error('Churn submission window is empty');
                await completeSubmission(backend, oldest.submission);
                await oldest.done;
            }
        }

        for (const pending of inFlight) {
            await completeSubmission(backend, pending.submission);
            await pending.done;
        }

        expect(submissions.pendingSubmissionCount).toBe(0);
        expect(registry.diagnostics()).toMatchObject({
            trackedResourceCount: 0,
            pendingReleaseCount: 0
        });
        expect(maxTrackedResources).toBeLessThanOrEqual(
            backend.executionMode === 'deferred' ? 12 : 3
        );
        expect(maxPendingReleases).toBeLessThanOrEqual(
            backend.executionMode === 'deferred' ? 8 : 2
        );
        expect(maxPendingSubmissions).toBeLessThanOrEqual(
            backend.executionMode === 'deferred' ? 4 : 1
        );

        const native = device.resourceDiagnostics();
        expect(native.createdObjectCount).toBe(30_000);
        expect(native.releasedNativeObjectCount).toBe(native.createdObjectCount);
        expect(native.liveNativeObjectCount).toBe(0);
        expect(native.peakNativeObjectCount).toBeLessThanOrEqual(
            backend.executionMode === 'deferred' ? 12 : 3
        );

        targets.destroy();
        submissions.destroy();
        registry.destroy();
        backend.destroy();
    }, 30_000);
});
