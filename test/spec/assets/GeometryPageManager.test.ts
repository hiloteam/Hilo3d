import { describe, expect, it } from 'vitest';
import {
    MeshletGeometry,
    encodeMeshletGeometryPage,
    meshletPageChecksum,
    type MeshletAssetManifest,
    type MeshletGeometryPage,
    type MeshletPageDescriptor
} from '../../../src/Hilo3d';
import { GeometryPageManager } from '../../../addon-assets/src/GeometryPageManager';
import type {
    GeometryAssetSource,
    GeometryPageManagerOptions
} from '../../../addon-assets/src/GeometryPageTypes';

function fixture(options: GeometryPageManagerOptions = {}): {
    geometry: MeshletGeometry;
    manager: GeometryPageManager;
    source: GeometryAssetSource;
    payloads: readonly Uint8Array[];
    requests: number[];
} {
    const payloads = [6, 3, 6, 3, 6, 3].map(indexCount => {
        const page: MeshletGeometryPage = {
            vertices: new Float32Array([
                -1, -1, 0, 0, 0, 1, 0, 0, 1, -1, 0, 0, 0, 1, 1, 0, 1, 1, 0, 0, 0, 1, 1, 1, -1, 1, 0,
                0, 0, 1, 0, 1
            ]),
            indices: new Uint32Array([0, 1, 2, 0, 2, 3].slice(0, indexCount)),
            meshlets: [
                {
                    firstIndex: 0,
                    indexCount,
                    bounds: [0, 0, 0, 2],
                    coneApex: [0, 0, 0],
                    coneAxis: [0, 0, 1],
                    coneCutoff: 1
                }
            ]
        };
        return encodeMeshletGeometryPage(page);
    });
    const pages: MeshletPageDescriptor[] = payloads.map((bytes, id) => ({
        id,
        byteLength: bytes.byteLength,
        vertexCount: 4,
        indexCount: id % 2 === 0 ? 6 : 3,
        meshletCount: 1,
        checksum: meshletPageChecksum(bytes)
    }));
    const manifest: MeshletAssetManifest = {
        version: 1,
        vertexStride: 8,
        pages,
        groups: [0, 2, 4].map(id => ({
            id,
            bounds: [0, 0, 0, 2],
            lods: [
                { pageId: id, error: 0 },
                { pageId: id + 1, error: 1 }
            ]
        }))
    };
    const source: GeometryAssetSource = {
        id: 'courtyard',
        version: 'content-7',
        pages: pages.map(page => ({ pageId: page.id, url: `/page-${String(page.id)}.h3mp` }))
    };
    const geometry = new MeshletGeometry(manifest);
    const requests: number[] = [];
    const manager = new GeometryPageManager(geometry, source, {
        autoUpdate: false,
        fetch: input => {
            const url = input instanceof Request ? input.url : String(input);
            expect(url).toContain('hilo_asset_version=content-7');
            const id = Number(/page-(\d+)/.exec(url)?.[1]);
            requests.push(id);
            const payload = payloads[id];
            if (!payload) throw new Error('Missing test page.');
            return Promise.resolve(new Response(payload.slice()));
        },
        ...options
    });
    return { geometry, manager, source, payloads, requests };
}

async function turn(manager: GeometryPageManager): Promise<void> {
    manager.update();
    await new Promise(resolve => setTimeout(resolve, 0));
}

async function settle(manager: GeometryPageManager, ready: Promise<void>): Promise<void> {
    const state: { done: boolean; error: unknown } = { done: false, error: null };
    void ready.then(
        () => {
            state.done = true;
        },
        (error: unknown) => {
            state.done = true;
            state.error = error;
        }
    );
    for (let index = 0; index < 40 && !state.done; index++) await turn(manager);
    if (!state.done) throw new Error('Geometry demand did not settle.');
    if (state.error)
        throw state.error instanceof Error
            ? state.error
            : new Error('Geometry demand failed.', { cause: state.error });
}

describe('bounded geometry CPU page streaming', () => {
    it('loads coarse first, shares CPU availability and keeps a stable geometry', async () => {
        const { manager, geometry, requests } = fixture({ budgets: { concurrentRequests: 1 } });
        try {
            const first = manager.acquirePage(0);
            const second = manager.acquirePage(0);
            expect(first.geometry).toBe(geometry);
            expect(second.geometry).toBe(geometry);
            expect(geometry.hasPage(0)).toBe(false);
            await settle(manager, first.ready);
            await second.ready;
            expect(requests).toEqual([1, 0]);
            expect(geometry.hasPage(0)).toBe(true);
            expect(geometry.hasPage(1)).toBe(true);
            for (let index = 0; index < 3; index++) {
                expect(first.setDemand({ priority: 0, visible: true })).toBe(first.ready);
                await turn(manager);
            }
            expect(manager.getDiagnostics().cancellations).toBe(0);
            first.release();
            expect(geometry.hasPage(0)).toBe(true);
            second.release();
            expect(geometry.hasPage(0)).toBe(false);
            expect(geometry.hasPage(1)).toBe(false);
        } finally {
            manager.destroy();
        }
    });

    it('services higher priority coarse dependencies before fine page requests', async () => {
        const { manager, requests } = fixture({ budgets: { concurrentRequests: 1 } });
        try {
            const low = manager.acquirePage(0, { priority: 1 });
            const high = manager.acquirePage(2, { priority: 9 });
            await settle(manager, high.ready);
            await settle(manager, low.ready);
            expect(requests).toEqual([3, 1, 2, 0]);
        } finally {
            manager.destroy();
        }
    });

    it('holds coarse fallback visible and evicts only hidden pages under CPU pressure', async () => {
        const { manager, geometry } = fixture({ budgets: { cpuBytes: 1000 } });
        try {
            const old = manager.acquirePage(0);
            await settle(manager, old.ready);
            void old.setDemand({ visible: false });
            const current = manager.acquirePage(2);
            await settle(manager, current.ready);
            expect(geometry.hasPage(0)).toBe(false);
            expect(geometry.hasPage(2)).toBe(true);
            expect(geometry.hasPage(3)).toBe(true);
            expect(manager.getDiagnostics().evictions).toBe(1);
            expect(manager.getDiagnostics().cpuBytes).toBeLessThanOrEqual(1000);
            expect(manager.getDiagnostics().pages.find(page => page.pageId === 3)).toMatchObject({
                visible: true,
                coarseFallback: true,
                state: 'available'
            });
            current.release();
            await settle(manager, old.setDemand({ visible: true }));
            expect(geometry.hasPage(0)).toBe(true);
        } finally {
            manager.destroy();
        }
    });

    it('reports a bounded stall without evicting another visible working set', async () => {
        const { manager, geometry } = fixture({ budgets: { cpuBytes: 1000 } });
        try {
            const old = manager.acquirePage(0);
            await settle(manager, old.ready);
            const current = manager.acquirePage(2);
            for (let index = 0; index < 6; index++) await turn(manager);
            expect(geometry.hasPage(0)).toBe(true);
            expect(geometry.hasPage(1)).toBe(true);
            expect(geometry.hasPage(2)).toBe(false);
            expect(manager.getDiagnostics().pages.some(page => page.stall === 'cpu-budget')).toBe(
                true
            );
            expect(manager.getDiagnostics().cpuBytes).toBeLessThanOrEqual(1000);
            old.release();
            await settle(manager, current.ready);
        } finally {
            manager.destroy();
        }
    });

    it('reserves decode peak until installation so parallel fetched pages cannot block each other', async () => {
        const sample = fixture();
        const pageBytes = sample.payloads[1]?.byteLength ?? 0;
        sample.manager.destroy();
        const { manager, geometry } = fixture({
            budgets: { concurrentRequests: 3, decodesPerUpdate: 1, cpuBytes: pageBytes * 4 }
        });
        try {
            const first = manager.acquirePage(1);
            const second = manager.acquirePage(3);
            const third = manager.acquirePage(5);
            for (let index = 0; index < 6; index++) {
                await turn(manager);
                expect(manager.getDiagnostics().cpuBytes).toBeLessThanOrEqual(pageBytes * 4);
            }
            await Promise.all([first.ready, second.ready]);
            expect(geometry.hasPage(1)).toBe(true);
            expect(geometry.hasPage(3)).toBe(true);
            expect(manager.getDiagnostics().pages.find(page => page.pageId === 5)).toMatchObject({
                state: 'queued',
                stall: 'cpu-budget'
            });
            expect(manager.getDiagnostics().pages.some(page => page.state === 'fetched')).toBe(
                false
            );
            first.release();
            await settle(manager, third.ready);
        } finally {
            manager.destroy();
        }
    });

    it('snapshots source identity and excludes concurrent owners until destruction', async () => {
        const sample = fixture();
        sample.manager.destroy();
        const source = { ...sample.source, pages: sample.source.pages.map(page => ({ ...page })) };
        const requested: string[] = [];
        const manager = new GeometryPageManager(sample.geometry, source, {
            autoUpdate: false,
            fetch: input => {
                const url = input instanceof Request ? input.url : String(input);
                requested.push(url);
                return Promise.resolve(new Response(sample.payloads[1]?.slice()));
            }
        });
        try {
            expect(() => new GeometryPageManager(sample.geometry, source)).toThrow(
                /exclusive page manager/
            );
            source.id = 'different';
            source.version = 'changed';
            const base = source.pages[1];
            if (base) base.url = '/changed.h3mp';
            await settle(manager, manager.acquirePage(1).ready);
            expect(requested[0]).toContain('/page-1.h3mp?hilo_asset_version=content-7');
            expect(manager.getDiagnostics()).toMatchObject({
                id: 'courtyard',
                version: 'content-7'
            });
        } finally {
            manager.destroy();
        }
        expect(sample.geometry.hasPage(1)).toBe(false);
        const replacement = new GeometryPageManager(sample.geometry, sample.source, {
            autoUpdate: false
        });
        replacement.destroy();
    });

    it('cancels rejected response bodies and accepts encoded transport lengths without bypassing payload bounds', async () => {
        let cancellations = 0;
        for (const status of [200, 503]) {
            const { manager } = fixture({
                fetch: () =>
                    Promise.resolve(
                        new Response(
                            new ReadableStream<Uint8Array>({
                                cancel(): void {
                                    cancellations++;
                                }
                            }),
                            { status, headers: { 'Content-Length': '1' } }
                        )
                    )
            });
            try {
                await expect(settle(manager, manager.acquirePage(1).ready)).rejects.toThrow(
                    status === 200 ? /Content-Length/ : /503/
                );
                expect(manager.getDiagnostics().inFlightBytes).toBe(0);
                expect(manager.getDiagnostics().cpuBytes).toBe(0);
            } finally {
                manager.destroy();
            }
        }
        expect(cancellations).toBe(2);
        const sample = fixture();
        sample.manager.destroy();
        const { manager } = fixture({
            fetch: () =>
                Promise.resolve(
                    new Response(sample.payloads[1]?.slice(), {
                        headers: { 'Content-Length': '1', 'Content-Encoding': 'gzip' }
                    })
                )
        });
        try {
            await settle(manager, manager.acquirePage(1).ready);
        } finally {
            manager.destroy();
        }
    });

    it('rejects impossible atomic budgets and incomplete or duplicate source tables', () => {
        const { manager, source, geometry } = fixture();
        try {
            expect(
                () => new GeometryPageManager(geometry, { ...source, pages: source.pages.slice(1) })
            ).toThrow(/every manifest/);
            expect(() => new GeometryPageManager(geometry, { ...source, version: '' })).toThrow(
                /content version/
            );
            expect(
                () =>
                    new GeometryPageManager(geometry, {
                        ...source,
                        pages: source.pages.map(page => ({ ...page, pageId: 0 }))
                    })
            ).toThrow(/duplicate/);
            expect(() => manager.acquirePage(99)).toThrow(/Unknown/);
            expect(() => manager.acquirePage(0, { priority: Infinity })).toThrow(/Invalid/);
        } finally {
            manager.destroy();
        }
        for (const budgets of [
            { sourceBytes: 1 },
            { decodeBytesPerUpdate: 1 },
            { inFlightBytes: 1 },
            { cpuBytes: 900 },
            { queuedPages: 1 }
        ]) {
            const bounded = fixture({ budgets });
            try {
                expect(() => bounded.manager.acquirePage(0)).toThrow();
            } finally {
                bounded.manager.destroy();
            }
        }
    });

    it('bounds actual response bytes and retries checksum failures explicitly', async () => {
        const original = fixture();
        original.manager.destroy();
        let invalid = true;
        const { manager, geometry } = fixture({
            fetch: input => {
                const id = Number(
                    /page-(\d+)/.exec(input instanceof Request ? input.url : String(input))?.[1]
                );
                const bytes = original.payloads[id]?.slice();
                if (!bytes) throw new Error('Missing test page.');
                if (invalid) bytes[0] = 0;
                return Promise.resolve(new Response(bytes));
            }
        });
        try {
            const lease = manager.acquirePage(0);
            await expect(settle(manager, lease.ready)).rejects.toThrow(/checksum/);
            expect(geometry.hasPage(0)).toBe(false);
            invalid = false;
            await settle(manager, lease.retry());
            expect(geometry.hasPage(0)).toBe(true);
        } finally {
            manager.destroy();
        }
        for (const delta of [-1, 1]) {
            const bounded = fixture({
                fetch: input => {
                    const id = Number(
                        /page-(\d+)/.exec(input instanceof Request ? input.url : String(input))?.[1]
                    );
                    const expected = original.payloads[id]?.byteLength ?? 0;
                    return Promise.resolve(new Response(new Uint8Array(expected + delta)));
                }
            });
            try {
                await expect(
                    settle(bounded.manager, bounded.manager.acquirePage(0).ready)
                ).rejects.toThrow(/declared byte length/);
                expect(bounded.manager.getDiagnostics().inFlightBytes).toBe(0);
            } finally {
                bounded.manager.destroy();
            }
        }
    });

    it('cancels one claim without invalidating another and suppresses late responses after release', async () => {
        const { manager } = fixture();
        try {
            const controller = new AbortController();
            const first = manager.acquirePage(0, {}, controller.signal);
            const second = manager.acquirePage(0);
            controller.abort();
            await expect(first.ready).rejects.toMatchObject({ name: 'AbortError' });
            await settle(manager, second.ready);
        } finally {
            manager.destroy();
        }
        let finish: ((response: Response) => void) | undefined;
        const late = fixture({
            budgets: { concurrentRequests: 1 },
            fetch: () =>
                new Promise(resolve => {
                    finish = resolve;
                })
        });
        try {
            const lease = late.manager.acquirePage(0);
            late.manager.update();
            lease.release();
            finish?.(new Response(late.payloads[1]?.slice()));
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(late.geometry.hasPage(1)).toBe(false);
            expect(late.manager.getDiagnostics().activeRequests).toBe(0);
            expect(late.manager.getDiagnostics().cpuBytes).toBe(0);
            await expect(lease.ready).rejects.toMatchObject({ name: 'AbortError' });
        } finally {
            late.manager.destroy();
        }
    });

    it('cancels a pending body read on deadline and releases all CPU pages on destruction', async () => {
        let cancelled = false;
        const { manager, geometry } = fixture({
            requestTimeoutMilliseconds: 5,
            fetch: () =>
                Promise.resolve(
                    new Response(
                        new ReadableStream<Uint8Array>({
                            cancel(): void {
                                cancelled = true;
                            }
                        })
                    )
                )
        });
        try {
            const lease = manager.acquirePage(0);
            await expect(settle(manager, lease.ready)).rejects.toMatchObject({
                name: 'TimeoutError'
            });
            expect(cancelled).toBe(true);
            expect(manager.getDiagnostics().inFlightBytes).toBe(0);
        } finally {
            manager.destroy();
        }
        expect(geometry.hasPage(0)).toBe(false);
        expect(() => {
            manager.update();
        }).toThrow(/destroyed/);
    });
});
