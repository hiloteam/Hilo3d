import { describe, expect, it, vi } from 'vitest';
import {
    RendererStorageBuffer,
    type StorageBufferHost,
    type StorageBufferReadback
} from '../../../src/render/StorageBuffer';

function createHost() {
    const storageBufferWritten = vi.fn<StorageBufferHost['storageBufferWritten']>();
    const storageBufferDestroyed = vi.fn<StorageBufferHost['storageBufferDestroyed']>();
    return {
        backend: 'webgpu',
        assertStorageBufferMutationAllowed: vi.fn(),
        storageBufferWritten,
        readStorageBuffer(buffer, byteOffset, byteLength): Promise<StorageBufferReadback> {
            return Promise.resolve({
                data: new Uint8Array(buffer.cpuData(), byteOffset, byteLength).slice(),
                byteOffset,
                byteLength
            });
        },
        storageBufferDestroyed
    } satisfies StorageBufferHost;
}

describe('RendererStorageBuffer', () => {
    it('snapshots initial data and exposes immutable usage and aligned ranges', () => {
        const initial = new Uint32Array([1, 2]);
        const buffer = new RendererStorageBuffer(createHost(), {
            label: 'particles',
            byteLength: 16,
            usage: ['storage', 'copy-source', 'copy-destination'],
            initialData: initial,
            recovery: 'reinitialize'
        });
        initial[0] = 99;

        expect(buffer.label).toBe('particles');
        expect(buffer.backend).toBe('webgpu');
        expect(buffer.recovery).toBe('reinitialize');
        expect([...buffer.usage]).toEqual(['storage', 'copy-source', 'copy-destination']);
        expect(new Uint32Array(buffer.cpuData())).toEqual(new Uint32Array([1, 2, 0, 0]));
        expect(buffer.range(4, 8)).toEqual({ buffer, byteOffset: 4, byteLength: 8 });
        expect(() => buffer.range(2, 4)).toThrow(/4-byte aligned/);
        expect(Reflect.get(buffer.usage, 'add')).toBeUndefined();
    });

    it('accepts ArrayBuffer initial data and snapshots it', () => {
        const initialData = new Uint32Array([3, 5]).buffer;
        const buffer = new RendererStorageBuffer(createHost(), {
            byteLength: 8,
            usage: ['storage'],
            initialData
        });

        new Uint32Array(initialData)[0] = 9;
        expect([...new Uint32Array(buffer.cpuData())]).toEqual([3, 5]);
    });

    it('tracks exact CPU writes and coalesces them into an aligned dirty span', () => {
        const host = createHost();
        const buffer = new RendererStorageBuffer(host, {
            byteLength: 16,
            usage: ['storage', 'copy-destination']
        });
        const baseline = buffer.revision;
        const span = { byteOffset: -1, byteLength: -1 };

        buffer.write(4, new Uint32Array([7]));
        buffer.write(12, new Uint32Array([9]));
        expect(buffer.getDirtySpanSince(baseline, span)).toBe(true);
        expect(span).toEqual({ byteOffset: 4, byteLength: 12 });
        expect(host.storageBufferWritten).toHaveBeenCalledTimes(2);

        const stableRevision = buffer.revision;
        buffer.write(4, new Uint32Array([7]));
        expect(buffer.revision).toBe(stableRevision);
        expect(host.storageBufferWritten).toHaveBeenCalledTimes(2);

        buffer.noteGPUWrite();
        buffer.write(4, new Uint32Array([7]));
        expect(buffer.revision).toBe(stableRevision + 1);
        expect(host.storageBufferWritten).toHaveBeenCalledTimes(3);
    });

    it('requires explicit copy usages for CPU writes and asynchronous readback', async () => {
        const readable = new RendererStorageBuffer(createHost(), {
            byteLength: 8,
            usage: ['storage', 'copy-source', 'copy-destination']
        });
        readable.write(0, new Uint32Array([3, 4]));
        await expect(readable.read(4, 4)).resolves.toEqual({
            data: new Uint8Array(new Uint32Array([4]).buffer),
            byteOffset: 4,
            byteLength: 4
        });

        const storageOnly = new RendererStorageBuffer(createHost(), {
            byteLength: 4,
            usage: ['storage']
        });
        expect(() => {
            storageOnly.write(0, new Uint32Array([1]));
        }).toThrow(/copy-destination/);
        await expect(storageOnly.read()).rejects.toThrow(/copy-source/);
    });

    it('validates descriptors and makes destruction idempotent', () => {
        const host = createHost();
        expect(
            () => new RendererStorageBuffer(host, { byteLength: 6, usage: ['storage'] })
        ).toThrow(/4-byte aligned/);
        expect(
            () =>
                new RendererStorageBuffer(host, {
                    byteLength: 4,
                    usage: ['storage', 'storage']
                })
        ).toThrow(/Duplicate/);
        expect(
            () =>
                new RendererStorageBuffer(host, {
                    byteLength: 4,
                    usage: ['storage'],
                    initialData: new Uint32Array(2)
                })
        ).toThrow(/exceeds/);

        const buffer = new RendererStorageBuffer(host, {
            byteLength: 4,
            usage: ['storage', 'copy-source']
        });
        buffer.destroy();
        buffer.destroy();
        expect(buffer.isDestroyed).toBe(true);
        expect(host.storageBufferDestroyed).toHaveBeenCalledTimes(1);
        expect(() => {
            buffer.range(0, 4);
        }).toThrow(/destroyed/);
    });
});
