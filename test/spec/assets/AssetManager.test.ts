import { describe, expect, it } from 'vitest';
import { EventDispatcher, type Texture } from '../../../src/Hilo3d';
import {
    AssetManager,
    type AssetManagerOptions,
    type DecodedAssetTexture,
    type TextureAssetDecoder,
    type TextureAssetSource,
    type TextureDecodeRequest
} from '@hilo/addon-assets';

const source: TextureAssetSource = {
    id: 'brick',
    version: '1',
    url: '/brick.ktx2',
    byteLength: 8,
    width: 4,
    height: 4,
    mipLevelCount: 3
};
class Host extends EventDispatcher {
    readonly uploads: number[] = [];
    fail = false;
    gate: Promise<void> | null = null;
    supportsTextureCompression(): boolean {
        return false;
    }
    async uploadTextures(textures: readonly Texture<unknown>[]): Promise<void> {
        if (this.fail) {
            this.fail = false;
            throw new Error('submission failed');
        }
        this.uploads.push(textures[0]?.width ?? 0);
        if (this.gate) await this.gate;
    }
    async waitForIdle(): Promise<void> {
        if (this.gate) await this.gate;
    }
}
class Decoder implements TextureAssetDecoder {
    readonly levels: number[] = [];
    destroyed = false;
    decode(
        request: Readonly<TextureDecodeRequest>,
        signal: AbortSignal
    ): Promise<DecodedAssetTexture> {
        signal.throwIfAborted();
        this.levels.push(request.mipLevel);
        return Promise.resolve({
            format: 'rgba8',
            colorSpace: 'linear',
            mipLevel: request.mipLevel,
            mipmaps: Array.from(
                { length: request.source.mipLevelCount - request.mipLevel },
                (_, index) => {
                    const size = Math.max(
                        1,
                        Math.floor(request.source.width / 2 ** (index + request.mipLevel))
                    );
                    return {
                        width: size,
                        height: size,
                        data: new Uint8Array(size * size * 4).fill(255)
                    };
                }
            )
        });
    }
    destroy(): void {
        this.destroyed = true;
    }
}
function setup(options: AssetManagerOptions = {}): {
    host: Host;
    decoder: Decoder;
    manager: AssetManager;
} {
    const host = new Host(),
        decoder = new Decoder();
    const manager = new AssetManager(host, {
        autoUpdate: false,
        decoder,
        fetch: () => Promise.resolve(new Response(new Uint8Array(8))),
        ...options
    });
    return { host, decoder, manager };
}
async function settle(manager: AssetManager, promise: Promise<void>): Promise<void> {
    const state: { done: boolean; error: Error | null } = { done: false, error: null };
    void promise.then(
        () => {
            state.done = true;
        },
        (reason: unknown) => {
            state.error = reason instanceof Error ? reason : new Error(String(reason));
            state.done = true;
        }
    );
    for (let index = 0; index < 40 && !state.done; index++) {
        await manager.update();
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (!state.done) throw new Error('Asset did not settle.');
    if (state.error) throw state.error;
}

describe('bounded asset residency', () => {
    it('does not restart in-flight work when the same demand is refreshed every frame', async () => {
        const { manager, decoder } = setup();
        try {
            const lease = manager.acquireTexture(source);
            const shared = manager.acquireTexture(source);
            for (let index = 0; index < 12; index++) {
                expect(lease.setDemand({ mipLevel: 0, priority: 0, visible: true })).toBe(
                    lease.ready
                );
                await manager.update();
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            await Promise.all([lease.ready, shared.ready]);
            expect(decoder.levels).toEqual([2, 0]);
            expect(manager.getDiagnostics().cancellations).toBe(0);
        } finally {
            manager.destroy();
        }
    });

    it('shares stable identity, displays coarse mip first, promotes and downsizes demand', async () => {
        const { manager, host } = setup();
        try {
            const lease = manager.acquireTexture(source),
                sibling = manager.acquireTexture(source);
            expect(sibling.texture).toBe(lease.texture);
            await settle(manager, lease.ready);
            await sibling.ready;
            expect(host.uploads).toEqual([1, 4]);
            expect(manager.getDiagnostics().assets[0]?.residentMip).toBe(0);
            sibling.release();
            await lease.setDemand({ mipLevel: 2 });
            await manager.update();
            await manager.update();
            expect(lease.texture.width).toBe(1);
            lease.release();
            expect(manager.getDiagnostics().assets).toHaveLength(0);
        } finally {
            manager.destroy();
        }
    });

    it('uses exact versioned identities and refuses contradictory manifests', () => {
        const { manager } = setup();
        try {
            const a = manager.acquireTexture(source),
                b = manager.acquireTexture({ ...source, version: '2' });
            expect(a.texture).not.toBe(b.texture);
            expect(() => manager.acquireTexture({ ...source, url: '/different.ktx2' })).toThrow(
                /different immutable/
            );
            expect(() => manager.acquireTexture({ ...source, mipLevelCount: 2 })).toThrow(
                /full mip chain/
            );
        } finally {
            manager.destroy();
        }
    });

    it('applies priority and independently rejects impossible queue, upload and decode budgets', async () => {
        const requested: string[] = [];
        const { manager } = setup({
            budgets: { concurrentRequests: 1, queuedAssets: 2, uploadBytesPerFrame: 84 },
            fetch: input => {
                requested.push(input instanceof Request ? input.url : String(input));
                return Promise.resolve(new Response(new Uint8Array(8)));
            }
        });
        try {
            manager.acquireTexture(source, { priority: 1 });
            manager.acquireTexture({ ...source, id: 'urgent' }, { priority: 9 });
            await manager.update();
            expect(requested[0]).toContain('hilo_asset_version=1');
            expect(
                manager.getDiagnostics().assets.find(asset => asset.id === 'urgent')?.state
            ).toBe('loading');
            expect(() => manager.acquireTexture({ ...source, id: 'overflow' })).toThrow(
                /queue capacity/
            );
        } finally {
            manager.destroy();
        }
        const small = setup({ budgets: { uploadBytesPerFrame: 16 } });
        expect(() => small.manager.acquireTexture(source)).toThrow(/atomic upload/);
        small.manager.destroy();
        const bounded = setup({ budgets: { inFlightBytes: 8 } });
        expect(() => bounded.manager.acquireTexture(source)).toThrow(/in-flight budgets/);
        bounded.manager.destroy();
    });

    it('cancels the final claim while keeping a shared request for surviving owners', async () => {
        const { manager } = setup();
        try {
            const controller = new AbortController();
            const cancelled = manager.acquireTexture(source, {}, controller.signal);
            const survivor = manager.acquireTexture(source);
            controller.abort();
            await expect(cancelled.ready).rejects.toMatchObject({ name: 'AbortError' });
            await settle(manager, survivor.ready);
            expect(manager.getDiagnostics().assets[0]?.references).toBe(1);
        } finally {
            manager.destroy();
        }
    });

    it('discards stale decoder replies after a teleport changes demand', async () => {
        let finish: ((value: DecodedAssetTexture) => void) | undefined;
        const real = new Decoder();
        const { manager } = setup({
            decoder: {
                decode: () =>
                    new Promise(resolve => {
                        finish = resolve;
                    }),
                destroy(): void {
                    /* The fake decoder owns no worker. */
                }
            }
        });
        try {
            const lease = manager.acquireTexture(source);
            await manager.update();
            await new Promise(resolve => setTimeout(resolve, 0));
            const next = lease.setDemand({ visible: false });
            finish?.(
                await real.decode(
                    {
                        data: new ArrayBuffer(8),
                        source,
                        mipLevel: 2,
                        capabilities: { astc: false, bc: false, etc2: false }
                    },
                    new AbortController().signal
                )
            );
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(manager.getDiagnostics().assets[0]?.residentMip).toBeNull();
            expect(manager.getDiagnostics().inFlightBytes).toBe(0);
            lease.release();
            await expect(next).rejects.toMatchObject({ name: 'AbortError' });
        } finally {
            manager.destroy();
        }
    });

    it('retains resident quality on upload failure and retries with the same Texture', async () => {
        const { manager, host } = setup();
        try {
            const lease = manager.acquireTexture(source, { mipLevel: 2 });
            await settle(manager, lease.ready);
            const texture = lease.texture;
            host.fail = true;
            await expect(settle(manager, lease.setDemand({ mipLevel: 0 }))).rejects.toThrow(
                'submission failed'
            );
            expect(texture.width).toBe(1);
            await settle(manager, lease.retry());
            expect(lease.texture).toBe(texture);
            expect(texture.width).toBe(4);
        } finally {
            manager.destroy();
        }
    });

    it('evicts hidden residents under pressure and restores them on new demand', async () => {
        const { manager } = setup({ budgets: { residentBytes: 100 } });
        try {
            const first = manager.acquireTexture(source);
            await settle(manager, first.ready);
            void first.setDemand({ visible: false });
            const second = manager.acquireTexture({ ...source, id: 'next' });
            await settle(manager, second.ready);
            expect(manager.getDiagnostics().evictions).toBe(1);
            expect(first.texture.width).toBe(1);
            second.release();
            await settle(manager, first.setDemand({ mipLevel: 0 }));
            expect(first.texture.width).toBe(4);
            expect(manager.getDiagnostics().residentBytes).toBeLessThanOrEqual(100);
        } finally {
            manager.destroy();
        }
    });

    it('replays lost-device residency through the same upload budget and identity', async () => {
        const { manager, host } = setup();
        try {
            const lease = manager.acquireTexture(source);
            await settle(manager, lease.ready);
            const identity = lease.texture;
            host.fire('rhiDeviceLost');
            expect(identity.width).toBe(1);
            await manager.update();
            expect(manager.getDiagnostics().assets[0]?.stall).toBe('recovering');
            host.fire('rhiDeviceRestored');
            await manager.update();
            expect(lease.texture).toBe(identity);
            expect(identity.width).toBe(4);
        } finally {
            manager.destroy();
        }
    });

    it('rejects failed/oversized transport and tears down all pending claims', async () => {
        const { manager, decoder } = setup({
            fetch: () => Promise.resolve(new Response(new Uint8Array(9)))
        });
        const lease = manager.acquireTexture(source);
        await expect(settle(manager, lease.ready)).rejects.toThrow(/exceeds its declared/);
        await expect(manager.acquireTexture(source).ready).rejects.toThrow(/exceeds its declared/);
        const pending = manager.acquireTexture({ ...source, id: 'pending' });
        manager.destroy();
        manager.destroy();
        await expect(pending.ready).rejects.toMatchObject({ name: 'AbortError' });
        expect(decoder.destroyed).toBe(true);
        expect(() => manager.acquireTexture(source)).toThrow(/destroyed/);
    });

    it('charges retired allocations until the fence completes', async () => {
        const { manager, host } = setup();
        try {
            const lease = manager.acquireTexture(source);
            await settle(manager, lease.ready);
            let finish!: () => void;
            host.gate = new Promise(resolve => {
                finish = resolve;
            });
            lease.release();
            expect(manager.getDiagnostics().pendingRetirementBytes).toBe(84);
            expect(manager.getDiagnostics().residentBytes).toBe(84);
            finish();
            await host.gate;
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(manager.getDiagnostics().pendingRetirementBytes).toBe(0);
        } finally {
            manager.destroy();
        }
    });

    it('never exceeds one update upload budget when several textures become ready together', async () => {
        const { manager } = setup({ budgets: { uploadBytesPerFrame: 84, uploadsPerFrame: 1 } });
        try {
            const first = manager.acquireTexture(source);
            const second = manager.acquireTexture({ ...source, id: 'second' });
            for (let index = 0; index < 16; index++) {
                await manager.update();
                expect(manager.getDiagnostics().uploadBytesLastFrame).toBeLessThanOrEqual(84);
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            await Promise.all([first.ready, second.ready]);
            expect(manager.getDiagnostics().assets.every(entry => entry.residentMip === 0)).toBe(
                true
            );
        } finally {
            manager.destroy();
        }
    });

    it('aborts stalled transport at its deadline and reports a retryable failure', async () => {
        const { manager } = setup({
            requestTimeoutMilliseconds: 5,
            fetch: (_input, init) =>
                new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener(
                        'abort',
                        () => {
                            reject(new DOMException('Transport aborted.', 'AbortError'));
                        },
                        { once: true }
                    );
                })
        });
        try {
            const lease = manager.acquireTexture(source);
            await expect(settle(manager, lease.ready)).rejects.toMatchObject({
                name: 'TimeoutError'
            });
            expect(manager.getDiagnostics().activeRequests).toBe(0);
            expect(manager.getDiagnostics().inFlightBytes).toBe(0);
            expect(manager.getDiagnostics().assets[0]?.state).toBe('failed');
        } finally {
            manager.destroy();
        }
    });
});
