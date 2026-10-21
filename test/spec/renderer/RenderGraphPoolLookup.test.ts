import { describe, expect, it, vi } from 'vitest';
import { RenderGraph } from '../../../src/render/graph/RenderGraph';
import type { CompiledRGBufferResource } from '../../../src/render/graph/RenderGraphCompiler';
import {
    TransientResourcePool,
    type PooledRGResource
} from '../../../src/render/graph/RenderGraphTransientResourcePool';
import { RHIBufferUsage, type RHIDevice } from '../../../src/render/rhi/core';
import { FakeWebGLRHIBackend } from '../rhi/portable/FakeRHIBackend';

function bufferResource(device: RHIDevice): CompiledRGBufferResource {
    const graph = new RenderGraph();
    const builder = graph.createBuilder();
    const handle = builder.createBuffer('pooled scratch', {
        size: 16,
        usage: RHIBufferUsage.COPY_DST
    });
    builder.addPass(
        {
            name: 'initialize scratch',
            setup(pass) {
                pass.writeBuffer(handle, 'copy-destination');
                pass.markSideEffect();
            },
            execute(context) {
                void context;
            }
        },
        undefined
    );
    const resource = graph.compile(builder, device.capabilities).resourceByHandle.get(handle);
    graph.destroy();
    if (resource?.kind !== 'buffer') throw new Error('Expected compiled buffer');
    return resource;
}

function acquire(
    pool: TransientResourcePool,
    resource: CompiledRGBufferResource,
    device: RHIDevice
): PooledRGResource {
    const result: { poolEntry: PooledRGResource | null; allocated: boolean } = {
        poolEntry: null,
        allocated: false
    };
    pool.acquire(resource, device, result);
    if (result.poolEntry === null) throw new Error('Expected pooled resource');
    return result.poolEntry;
}

describe('Render Graph idle resource lookup', () => {
    it('does linear validation work when acquiring many identical resources', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const pool = new TransientResourcePool();
        const resource = bufferResource(device);
        const createBuffer = vi.spyOn(device, 'createBuffer');
        const count = 64;
        const entries: PooledRGResource[] = [];
        let inspections = 0;
        pool.beginFrame(device);
        for (let index = 0; index < count; index++) {
            const entry = acquire(pool, resource, device);
            entries.push(entry);
            let destroyed = false;
            Object.defineProperty(entry.buffer, 'destroyed', {
                configurable: true,
                get(): boolean {
                    inspections++;
                    return destroyed;
                },
                set(value: boolean): void {
                    destroyed = value;
                }
            });
        }
        // Leased resources are absent from lookup, including while growing the initial pool.
        expect(inspections).toBe(0);
        for (const entry of entries) pool.release(entry);
        inspections = 0;
        const reacquired = entries.map(() => acquire(pool, resource, device));
        expect(new Set(reacquired)).toEqual(new Set(entries));
        expect(inspections).toBeLessThanOrEqual(count * 2);
        expect(createBuffer).toHaveBeenCalledTimes(count);
        for (const entry of reacquired) pool.release(entry);
        pool.destroy();
        expect(entries.every(entry => entry.buffer?.destroyed)).toBe(true);
        backend.destroy();
    });

    it('keeps idle indexes valid after repeated release and discard', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const pool = new TransientResourcePool();
        const resource = bufferResource(device);
        pool.beginFrame(device);
        const first = acquire(pool, resource, device);
        const second = acquire(pool, resource, device);
        pool.release(first);
        pool.release(first);
        pool.release(second);
        pool.discard(first);
        pool.discard(first);
        pool.release(first);
        expect(acquire(pool, resource, device)).toBe(second);
        pool.destroy();
        expect(second.buffer?.destroyed).toBe(false);
        pool.release(second);
        expect(second.buffer?.destroyed).toBe(true);
        backend.destroy();
    });
});
