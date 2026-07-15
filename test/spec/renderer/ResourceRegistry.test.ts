import {
    RendererRecoveringError,
    ResourceRegistry
} from '../../../src/render/renderer/ResourceRegistry';
import { RHIBufferUsage, type RHIBuffer } from '../../../src/render/rhi/core';
import { describe, expect, it } from 'vitest';
import {
    FakeWebGLRHIBackend,
    FakeWebGPURHIBackend,
    type FakeRHIBuffer,
    type FakeRHIDevice
} from '../rhi/portable/FakeRHIBackend';

function buffer(device: FakeRHIDevice, value = 0): FakeRHIBuffer {
    return device.createBuffer({
        size: 4,
        usage: RHIBufferUsage.COPY_SRC,
        initialData: new Uint8Array([value, 0, 0, 0])
    });
}

describe('ResourceRegistry', () => {
    it('snapshots source data and rebuilds a stable logical handle on a new device', () => {
        const backend = new FakeWebGLRHIBackend();
        const firstDevice = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const source = new Uint8Array([1, 2, 3, 4]);
        const handle = registry.registerBuffer({
            label: 'recoverable buffer',
            size: 4,
            usage: RHIBufferUsage.COPY_SRC,
            initialData: source
        });
        const first = registry.resolve(handle) as FakeRHIBuffer;
        source.fill(9);

        const secondDevice = backend.createDevice();
        registry.recover(secondDevice);
        const second = registry.resolve(handle) as FakeRHIBuffer;

        expect(second).not.toBe(first);
        expect(second.deviceId).toBe(secondDevice.id);
        expect([...second.snapshotBytes()]).toEqual([1, 2, 3, 4]);
        expect(first.destroyed).toBe(true);
        expect(registry.generation).toBe(2);
        expect(handle.label).toBe('recoverable buffer');
        registry.destroy();
        backend.destroy();
    });

    it('snapshots the adopted device generation and gates stale resources immediately on loss', () => {
        const backend = new FakeWebGLRHIBackend();
        const firstDevice = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const handle = registry.registerBuffer({
            label: 'generation-gated buffer',
            size: 4,
            usage: RHIBufferUsage.COPY_SRC
        });
        const original = registry.resolve(handle) as FakeRHIBuffer;

        firstDevice.advanceGeneration();

        expect(registry.deviceGeneration).toBe(1);
        expect(firstDevice.generation).toBe(2);
        expect(() => registry.resolve(handle)).toThrow(RendererRecoveringError);
        expect(registry.state).toBe('recovering');
        expect(() => registry.registerBuffer({ size: 4, usage: RHIBufferUsage.COPY_DST })).toThrow(
            RendererRecoveringError
        );

        const replacement = backend.createDevice();
        registry.recover(replacement);
        expect(registry.state).toBe('active');
        expect(registry.deviceGeneration).toBe(replacement.generation);
        expect(registry.resolve(handle)).not.toBe(original);
        expect(registry.resolve(handle).deviceId).toBe(replacement.id);
        expect(original.nativeReleased).toBe(true);

        registry.destroy();
        backend.destroy();
    });

    it('fails closed before allocating when recovery selects a different backend', () => {
        const webgl = new FakeWebGLRHIBackend();
        const webgpu = new FakeWebGPURHIBackend();
        const firstDevice = webgl.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const handle = registry.registerBuffer({ size: 4, usage: RHIBufferUsage.COPY_SRC });
        const replacement = webgpu.createDevice();

        expect(() => {
            registry.recover(replacement);
        }).toThrow(/same RHI backend/u);
        expect(registry.state).toBe('recovery-failed');
        expect(() => registry.resolve(handle)).toThrow(RendererRecoveringError);

        registry.destroy();
        webgpu.destroy();
        webgl.destroy();
    });

    it('rebuilds dependencies in registration order and resolves replacements', () => {
        const backend = new FakeWebGLRHIBackend();
        const firstDevice = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const order: string[] = [];
        const base = registry.register<RHIBuffer>({
            label: 'base',
            create(device) {
                order.push('base');
                return device.createBuffer({ size: 4, usage: RHIBufferUsage.COPY_SRC });
            }
        });
        registry.register<RHIBuffer>({
            label: 'dependent',
            dependencies: [base],
            create(device, resolve) {
                order.push(`dependent:${String(resolve(base).deviceId)}`);
                return device.createBuffer({ size: 4, usage: RHIBufferUsage.COPY_DST });
            }
        });
        order.length = 0;

        const secondDevice = backend.createDevice();
        registry.recover(secondDevice);
        expect(order).toEqual(['base', `dependent:${String(secondDevice.id)}`]);
        registry.destroy();
        backend.destroy();
    });

    it('rolls back replacement resources and blocks resolve after a failed recovery', () => {
        const backend = new FakeWebGLRHIBackend();
        const firstDevice = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        let recovery = false;
        let fail = true;
        const replacements: FakeRHIBuffer[] = [];
        const firstHandle = registry.register<RHIBuffer>({
            label: 'first',
            create(device) {
                const created = buffer(device as FakeRHIDevice, 1);
                if (recovery) replacements.push(created);
                return created;
            }
        });
        registry.register<RHIBuffer>({
            label: 'second',
            dependencies: [firstHandle],
            create(device) {
                if (recovery && fail) throw new Error('rebuild failed');
                return buffer(device as FakeRHIDevice, 2);
            }
        });
        const original = registry.resolve(firstHandle);
        recovery = true;
        const secondDevice = backend.createDevice();

        expect(() => {
            registry.recover(secondDevice);
        }).toThrow('rebuild failed');
        expect(registry.state).toBe('recovery-failed');
        expect(replacements[0]?.destroyed).toBe(true);
        expect(original.destroyed).toBe(false);
        expect(() => registry.resolve(firstHandle)).toThrow(RendererRecoveringError);

        fail = false;
        registry.recover(secondDevice);
        expect(registry.state).toBe('active');
        expect(registry.resolve(firstHandle).deviceId).toBe(secondDevice.id);
        expect(original.destroyed).toBe(true);
        registry.destroy();
        backend.destroy();
    });

    it('defers zero-reference retirement to the last completed frame and releases dependencies', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const base = registry.registerBuffer({ size: 4, usage: RHIBufferUsage.COPY_SRC });
        const dependent = registry.register<RHIBuffer>({
            dependencies: [base],
            create(owner) {
                return owner.createBuffer({ size: 4, usage: RHIBufferUsage.COPY_DST });
            }
        });
        const baseResource = registry.resolve(base);
        const dependentResource = registry.resolve(dependent);
        registry.markUsed(dependent, 5);
        registry.release(base);
        registry.release(dependent);

        expect(registry.collect(4)).toBe(0);
        expect(baseResource.destroyed).toBe(false);
        expect(dependentResource.destroyed).toBe(false);
        expect(registry.diagnostics()).toMatchObject({
            trackedResourceCount: 2,
            pendingReleaseCount: 1
        });

        expect(registry.collect(5)).toBe(2);
        expect(baseResource.destroyed).toBe(true);
        expect(dependentResource.destroyed).toBe(true);
        expect(registry.diagnostics().trackedResourceCount).toBe(0);
        backend.destroy();
    });

    it('discards only an exclusively owned resource that has never reached a submission', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const base = registry.registerBuffer({ size: 4, usage: RHIBufferUsage.COPY_SRC });
        const staged = registry.register<RHIBuffer>({
            dependencies: [base],
            create(owner) {
                return owner.createBuffer({ size: 4, usage: RHIBufferUsage.COPY_DST });
            }
        });
        const stagedResource = registry.resolve(staged);

        registry.discardUnsubmitted(staged);
        expect(stagedResource.destroyed).toBe(true);
        expect(() => registry.resolve(staged)).toThrow(/stale or released/u);
        expect(registry.resolve(base).destroyed).toBe(false);
        expect(registry.diagnostics()).toMatchObject({
            trackedResourceCount: 1,
            pendingReleaseCount: 0
        });

        const submitted = registry.registerBuffer({ size: 4, usage: RHIBufferUsage.COPY_SRC });
        registry.markUsed(submitted, 0);
        expect(() => {
            registry.discardUnsubmitted(submitted);
        }).toThrow(/unsubmitted/u);
        registry.release(submitted);
        expect(registry.collect(0)).toBe(1);

        registry.release(base);
        expect(registry.collect(0)).toBe(1);
        registry.destroy();
        backend.destroy();
    });
});
