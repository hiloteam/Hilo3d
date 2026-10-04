import { describe, expect, it, vi } from 'vitest';
import { AssetThumbnailCache, type AssetThumbnailLease } from '../../../editor/asset-thumbnails';
import { AssetPanel } from '../../../editor/asset-panel';
import { importAsset, type ProjectAsset } from '../../../editor/assets';
import { createProject } from '../../../editor/project';
import { createDefaultScene } from '../../../editor/scene';

async function texture(
    width = 1024,
    height = 256,
    color = '#bc7044'
): Promise<Awaited<ReturnType<typeof importAsset>>> {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.fillStyle = color;
    context.fillRect(0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(value => {
            if (value) resolve(value);
            else reject(new Error('PNG unavailable'));
        });
    });
    return importAsset(new File([blob], 'Preview.png', { type: 'image/png' }));
}

function deferred(): { ready: Promise<void>; resolve(): void } {
    let release: () => void = () => undefined;
    const ready = new Promise<void>(resolve => {
        release = resolve;
    });
    return { ready, resolve: release };
}

describe('bounded asset thumbnail derivatives', () => {
    it('renders aspect-preserving thumbnails within256 pixels and shares a live cached derivative', async () => {
        const asset = await texture();
        const cache = new AssetThumbnailCache();
        const close = vi.spyOn(ImageBitmap.prototype, 'close');
        try {
            const first = await cache.acquire(asset);
            const second = await cache.acquire(asset);
            expect(first.width).toBe(256);
            expect(first.height).toBe(64);
            expect(second.url).toBe(first.url);
            const blob = await (await fetch(first.url)).blob();
            expect(blob.type).toBe('image/png');
            expect(blob.size).toBe(first.bytes);
            const bitmap = await createImageBitmap(blob);
            try {
                expect(bitmap.width).toBe(256);
                expect(bitmap.height).toBe(64);
            } finally {
                bitmap.close();
            }
            expect(close).toHaveBeenCalledTimes(2);
            expect(cache.memoryUsage).toMatchObject({ entries: 1, bytes: first.bytes, pinned: 1 });
            first.release();
            second.release();
            expect(cache.memoryUsage.pinned).toBe(0);
        } finally {
            cache.destroy();
            close.mockRestore();
        }
    });

    it('evicts unpinned derivatives, protects active image loads and revokes all owned URLs', async () => {
        const assets = await Promise.all([
            texture(128, 64, '#ff0000'),
            texture(128, 64, '#00ff00'),
            texture(128, 64, '#0000ff')
        ]);
        const firstAsset = assets[0];
        const secondAsset = assets[1];
        const thirdAsset = assets[2];
        const live = new Set<string>();
        const nativeCreate = URL.createObjectURL.bind(URL);
        const nativeRevoke = URL.revokeObjectURL.bind(URL);
        const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
            const url = nativeCreate(blob);
            live.add(url);
            return url;
        });
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(url => {
            live.delete(url);
            nativeRevoke(url);
        });
        const cache = new AssetThumbnailCache({ maxEntries: 2 });
        try {
            const first = await cache.acquire(firstAsset);
            const second = await cache.acquire(secondAsset);
            await expect(cache.acquire(thirdAsset)).rejects.toThrow('capacity');
            expect(cache.memoryUsage.entries).toBe(2);
            expect(live.size).toBe(2);
            first.release();
            const third = await cache.acquire(thirdAsset);
            expect(live.has(first.url)).toBe(false);
            expect(live.has(second.url)).toBe(true);
            expect(live.has(third.url)).toBe(true);
            expect(cache.memoryUsage.entries).toBe(2);
            second.release();
            third.release();
            cache.destroy();
            expect(live.size).toBe(0);
            expect(cache.memoryUsage).toEqual({ entries: 0, bytes: 0, pinned: 0 });
        } finally {
            cache.destroy();
            create.mockRestore();
            revoke.mockRestore();
        }
    });

    it('cancels queued work before decoding, and a rejected task does not poison the queue', async () => {
        const a = await texture(32, 16, '#ab3412');
        const b = await texture(32, 16, '#3456ab');
        const entered = deferred();
        const gate = deferred();
        const fetchSource = globalThis.fetch.bind(globalThis);
        let requests = 0;
        const transport = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
            requests += 1;
            const response = await fetchSource(url, options);
            if (requests === 1) {
                entered.resolve();
                await gate.ready;
            }
            return response;
        });
        const cache = new AssetThumbnailCache();
        const canceled = new AbortController();
        try {
            const first = cache.acquire(a);
            await entered.ready;
            const second = cache.acquire(b, canceled.signal);
            canceled.abort();
            gate.resolve();
            const lease = await first;
            await expect(second).rejects.toMatchObject({ name: 'AbortError' });
            expect(requests).toBe(1);
            lease.release();
            const recovered = await cache.acquire(b);
            expect(recovered.width).toBe(32);
            recovered.release();
        } finally {
            gate.resolve();
            cache.destroy();
            transport.mockRestore();
        }
    });

    it('rejects corrupt sources and enforces derivative bytes without leaking partial entries', async () => {
        const valid = await texture(128, 128);
        const cache = new AssetThumbnailCache({ maxBytes: 1 });
        try {
            await expect(
                cache.acquire({ ...valid, data: `AAAA${valid.data.slice(4)}` })
            ).rejects.toThrow('checksum');
            await expect(cache.acquire(valid)).rejects.toThrow('budget');
            expect(cache.memoryUsage).toEqual({ entries: 0, bytes: 0, pinned: 0 });
        } finally {
            cache.destroy();
        }
        expect(() => new AssetThumbnailCache({ maxEntries: 65 })).toThrow('maxEntries');
        expect(() => new AssetThumbnailCache({ maxBytes: 0 })).toThrow('maxBytes');
    });

    it('immediately revokes an in-flight source URL when its cache owner is disposed', async () => {
        const asset = await texture(512, 128, '#987654');
        const entered = deferred();
        const gate = deferred();
        const nativeFetch = globalThis.fetch.bind(globalThis);
        const nativeCreate = URL.createObjectURL.bind(URL);
        const nativeRevoke = URL.revokeObjectURL.bind(URL);
        const live = new Set<string>();
        const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
            const url = nativeCreate(blob);
            live.add(url);
            return url;
        });
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(url => {
            live.delete(url);
            nativeRevoke(url);
        });
        const transport = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
            const response = await nativeFetch(url, options);
            entered.resolve();
            await gate.ready;
            return response;
        });
        const cache = new AssetThumbnailCache();
        try {
            const pending = cache.acquire(asset);
            await entered.ready;
            expect(live.size).toBe(1);
            cache.destroy();
            expect(live.size).toBe(0);
            gate.resolve();
            await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
            expect(live.size).toBe(0);
            expect(cache.memoryUsage.entries).toBe(0);
        } finally {
            gate.resolve();
            cache.destroy();
            transport.mockRestore();
            create.mockRestore();
            revoke.mockRestore();
        }
    });

    it('disposes pending source URLs and discards stale project or tab preview completions', async () => {
        const asset = await texture(256, 128, '#abcdef');
        const entered = deferred();
        const gate = deferred();
        const fetchSource = globalThis.fetch.bind(globalThis);
        const transport = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
            const response = await fetchSource(url, options);
            entered.resolve();
            await gate.ready;
            return response;
        });
        const requests: Promise<AssetThumbnailLease>[] = [];
        const nativeAcquire = Reflect.get(AssetThumbnailCache.prototype, 'acquire');
        const acquisition = vi
            .spyOn(AssetThumbnailCache.prototype, 'acquire')
            .mockImplementation(function (
                this: AssetThumbnailCache,
                source: ProjectAsset,
                signal?: AbortSignal
            ): Promise<AssetThumbnailLease> {
                const request = nativeAcquire.call(this, source, signal);
                requests.push(request);
                return request;
            });
        let project = createProject(createDefaultScene());
        project.assets[asset.id] = asset;
        const host = document.createElement('div');
        host.style.cssText =
            'width:500px;height:300px;position:fixed;left:0;top:0;overflow:auto;z-index:99999';
        document.body.append(host);
        const panel = new AssetPanel({
            getProject: () => project,
            getSelected: () => null,
            onCommit: value => {
                project = value;
            },
            onSelect: () => undefined,
            onNotify: () => undefined
        });
        try {
            panel.render(host);
            await entered.ready;
            project = createProject(createDefaultScene(), 'Other Project');
            host.innerHTML = '<strong>Other asset tab</strong>';
            gate.resolve();
            expect(requests).toHaveLength(1);
            await Promise.allSettled(requests);
            await Promise.resolve();
            expect(host.textContent).toBe('Other asset tab');
            expect(host.querySelector('img')).toBeNull();
            panel.destroy();
            expect(host.querySelector('img')).toBeNull();
        } finally {
            gate.resolve();
            panel.destroy();
            host.remove();
            transport.mockRestore();
            acquisition.mockRestore();
        }
        const cache = new AssetThumbnailCache();
        const lease = await cache.acquire(asset);
        lease.release();
        cache.destroy();
        await expect(cache.acquire(asset)).rejects.toMatchObject({ name: 'AbortError' });
    });
});
