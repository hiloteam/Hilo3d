import { describe, expect, it, vi } from 'vitest';
import MeshletGeometry, {
    type MeshletGeometryOptions
} from '../../../src/geometry/meshlet/MeshletGeometry';
import {
    encodeMeshletGeometryPage,
    meshletPageChecksum,
    type MeshletAssetManifest,
    type MeshletGeometryPage
} from '../../../src/geometry/meshlet/MeshletAsset';
import {
    RendererStorageBuffer,
    type StorageBuffer,
    type StorageBufferHost
} from '../../../src/render/StorageBuffer';
import type {
    RenderPipelineContext,
    RenderPipelineCreateContext
} from '../../../src/render/pipeline/RenderPipeline';
import { MeshletRuntime } from '../../../src/render/pipeline/internal/MeshletRuntime';

const PAGE_TABLE_BYTES = 192;
const COARSE_BYTES = 220;
const FINE_BYTES = 232;
const ONE_PAGE_UPLOAD = PAGE_TABLE_BYTES + FINE_BYTES;
const THREE_PAGE_ARENA = PAGE_TABLE_BYTES + COARSE_BYTES * 2 + FINE_BYTES;

function unused(): never {
    throw new Error('Unexpected rendering operation in geometry residency fixture.');
}

function asset(options: MeshletGeometryOptions = {}): {
    geometry: MeshletGeometry;
    pages: readonly MeshletGeometryPage[];
} {
    const pages: MeshletGeometryPage[] = [6, 3, 6, 3].map(indexCount => ({
        vertices: new Float32Array([
            -1, -1, 0, 0, 0, 1, 0, 0, 1, -1, 0, 0, 0, 1, 1, 0, 1, 1, 0, 0, 0, 1, 1, 1, -1, 1, 0, 0,
            0, 1, 0, 1
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
    }));
    const manifest: MeshletAssetManifest = {
        version: 1,
        vertexStride: 8,
        pages: pages.map((page, id) => {
            const bytes = encodeMeshletGeometryPage(page);
            return {
                id,
                byteLength: bytes.byteLength,
                vertexCount: 4,
                indexCount: page.indices.length,
                meshletCount: 1,
                checksum: meshletPageChecksum(bytes)
            };
        }),
        groups: [0, 2].map(id => ({
            id,
            bounds: [0, 0, 0, 2],
            lods: [
                { pageId: id, error: 0 },
                { pageId: id + 1, error: 1 }
            ]
        }))
    };
    return {
        geometry: new MeshletGeometry(manifest, {
            maxResidentBytes: THREE_PAGE_ARENA,
            maxUploadBytesPerFrame: ONE_PAGE_UPLOAD,
            maxVisibleMeshlets: 8,
            ...options
        }),
        pages
    };
}

function install(
    geometry: MeshletGeometry,
    pages: readonly MeshletGeometryPage[],
    ...ids: number[]
): void {
    for (const id of ids) {
        const page = pages[id];
        if (!page) throw new Error('Missing residency fixture page.');
        geometry.setPageData(id, page);
    }
}

interface ArenaWrite {
    readonly buffer: RendererStorageBuffer;
    readonly byteOffset: number;
    readonly byteLength: number;
}

function fixture(
    geometry: MeshletGeometry,
    buffers: RendererStorageBuffer[] = [],
    temporal = false
): {
    readonly runtime: MeshletRuntime;
    readonly buffers: readonly RendererStorageBuffer[];
    readonly writes: readonly ArenaWrite[];
    stage(frameIndex: number): boolean;
    submit(): void;
    discard(): void;
    snapshot(): Uint32Array;
} {
    const writes: ArenaWrite[] = [];
    const submitted = new Map<StorageBuffer, Uint8Array>();
    const host: StorageBufferHost = {
        backend: 'webgpu',
        assertStorageBufferMutationAllowed(): void {
            /* No active native frame in this fixture. */
        },
        storageBufferWritten(): void {
            /* Upload writes are captured by the frame context. */
        },
        storageBufferDestroyed(): void {
            /* Public buffer identity owns the CPU allocation. */
        },
        readStorageBuffer(buffer, byteOffset, byteLength) {
            const bytes = submitted.get(buffer);
            if (!bytes) throw new Error('Readback from an unknown fixture buffer.');
            return Promise.resolve({
                data: bytes.slice(byteOffset, byteOffset + byteLength),
                byteOffset,
                byteLength
            });
        }
    };
    const creation: RenderPipelineCreateContext = {
        get capabilities(): never {
            return unused();
        },
        createRenderTarget: unused,
        warmupStorageGraphicsShaders: unused,
        createStorageBuffer(descriptor) {
            const buffer = new RendererStorageBuffer(host, descriptor);
            buffers.push(buffer);
            submitted.set(buffer, new Uint8Array(buffer.cpuData()).slice());
            return buffer;
        }
    };
    const runtime = new MeshletRuntime(geometry, creation, 0, 0, 4, 0, temporal, false);
    return {
        runtime,
        buffers,
        writes,
        stage(frameIndex): boolean {
            const context: RenderPipelineContext = {
                frameIndex,
                get scene(): never {
                    return unused();
                },
                get camera(): never {
                    return unused();
                },
                get viewport(): never {
                    return unused();
                },
                get clearColor(): never {
                    return unused();
                },
                get output(): never {
                    return unused();
                },
                get capabilities(): never {
                    return unused();
                },
                get useLogDepth(): never {
                    return unused();
                },
                get graph(): never {
                    return unused();
                },
                recordView: unused,
                prepareScene: unused,
                cull: unused,
                createRendererList: unused,
                createOrderedRendererList: unused,
                recordShadows: unused,
                acquirePassParameters: unused,
                writeStorageBuffer(buffer, byteOffset, data): void {
                    if (!(buffer instanceof RendererStorageBuffer))
                        throw new Error('Unknown fixture buffer.');
                    writes.push({ buffer, byteOffset, byteLength: data.byteLength });
                    buffer.writeFromRenderPipeline(byteOffset, data);
                }
            };
            return runtime.stage(context);
        },
        submit(): void {
            for (const buffer of buffers)
                submitted.set(buffer, new Uint8Array(buffer.cpuData()).slice());
            runtime.frameSubmitted();
            writes.length = 0;
        },
        discard(): void {
            runtime.frameDiscarded();
            writes.length = 0;
        },
        snapshot(): Uint32Array {
            const bytes = submitted.get(runtime.arena);
            if (!bytes) throw new Error('Missing submitted arena.');
            return new Uint32Array(bytes.slice().buffer);
        }
    };
}

/** Follow the page table consumed by the production shader, rather than the allocator's private map. */
function residentOffsets(
    words: Uint32Array,
    geometry: MeshletGeometry
): ReadonlyMap<number, number> {
    const offsets = new Map<number, number>();
    for (const [index, group] of geometry.manifest.groups.entries()) {
        const groupOffset = 16 + index * 8;
        const lodOffset = words[groupOffset + 4];
        if (lodOffset === undefined) throw new Error('Missing group table.');
        for (const [level, lod] of group.lods.entries()) {
            const offset = words[lodOffset + level * 4 + 1] ?? 0;
            if (offset > 0) offsets.set(lod.pageId, offset * 4);
        }
    }
    return offsets;
}

function expectBoundedPayloads(words: Uint32Array, geometry: MeshletGeometry): void {
    const ranges = [...residentOffsets(words, geometry)]
        .map(([id, start]) => {
            const page = geometry.manifest.pages.find(value => value.id === id);
            if (!page) throw new Error('Missing manifest page.');
            // Wire pages have a 32-byte header; the packed GPU page header is 16 bytes.
            const end = start + page.byteLength - 16;
            expect(start).toBeGreaterThanOrEqual(PAGE_TABLE_BYTES);
            expect(end).toBeLessThanOrEqual(words.byteLength);
            expect(start % 4).toBe(0);
            expect(words[start / 4]).toBe(page.meshletCount);
            const firstCluster = words[start / 4 + 1] ?? 0;
            expect(words[firstCluster + 13]).toBe(page.indexCount);
            return { start, end };
        })
        .sort((a, b) => a.start - b.start);
    for (let index = 1; index < ranges.length; index++) {
        const previous = ranges[index - 1],
            current = ranges[index];
        if (!previous || !current) throw new Error('Missing range.');
        expect(previous.end).toBeLessThanOrEqual(current.start);
    }
}

describe('meshlet renderer-local arena transactions', () => {
    it('charges every page and page-table write to the frame budget and defers whole pages', async () => {
        const { geometry, pages } = asset();
        install(geometry, pages, 0, 1, 2, 3);
        const owner = fixture(geometry);
        try {
            for (let frame = 0; frame < 3; frame++) {
                owner.stage(frame);
                const total = owner.writes.reduce((sum, write) => sum + write.byteLength, 0);
                expect(total).toBeLessThanOrEqual(ONE_PAGE_UPLOAD);
                expect(owner.writes.filter(write => write.byteOffset === 0)).toHaveLength(1);
                expect(owner.writes.filter(write => write.byteOffset > 0)).toHaveLength(1);
                const before = await owner.runtime.readDiagnostics();
                expect(before.residentPageCount).toBe(frame);
                owner.submit();
                expect((await owner.runtime.readDiagnostics()).lastUploadBytes).toBe(total);
                expectBoundedPayloads(owner.snapshot(), geometry);
            }
            expect(await owner.runtime.readDiagnostics()).toMatchObject({
                residentPageCount: 3,
                residentBytes: COARSE_BYTES * 2 + FINE_BYTES,
                deferredPageCount: 1,
                maxResidentBytes: THREE_PAGE_ARENA
            });
            expect([...residentOffsets(owner.snapshot(), geometry).keys()].sort()).toEqual([
                0, 1, 3
            ]);
        } finally {
            owner.runtime.destroy();
        }
    });

    it('reserves the complete coarse set before early fine pages occupy the arena', async () => {
        const { geometry, pages } = asset();
        install(geometry, pages, 0, 1, 2);
        const owner = fixture(geometry);
        try {
            owner.stage(0);
            owner.submit();
            owner.stage(1);
            owner.submit();
            expect([...residentOffsets(owner.snapshot(), geometry).keys()].sort()).toEqual([0, 1]);
            const fineOffset = residentOffsets(owner.snapshot(), geometry).get(0);
            install(geometry, pages, 3);
            owner.stage(2);
            owner.submit();
            const withCoarse = residentOffsets(owner.snapshot(), geometry);
            expect([...withCoarse.keys()].sort()).toEqual([0, 1, 3]);
            expect(withCoarse.get(0)).toBe(fineOffset);
            expectBoundedPayloads(owner.snapshot(), geometry);
            geometry.evictPage(0);
            owner.stage(3);
            owner.submit();
            const reused = residentOffsets(owner.snapshot(), geometry);
            expect([...reused.keys()].sort()).toEqual([1, 2, 3]);
            expect(reused.get(2)).toBe(fineOffset);
            expectBoundedPayloads(owner.snapshot(), geometry);
            expect((await owner.runtime.readDiagnostics()).residentBytes).toBe(
                COARSE_BYTES * 2 + FINE_BYTES
            );
        } finally {
            owner.runtime.destroy();
        }
    });

    it('publishes only valid submissions and restages discarded work at the same frame index', async () => {
        const { geometry, pages } = asset();
        install(geometry, pages, 1);
        const owner = fixture(geometry);
        try {
            const baseline = owner.snapshot();
            owner.stage(9);
            const firstBytes = owner.writes.reduce((sum, write) => sum + write.byteLength, 0);
            owner.stage(9);
            expect(owner.writes.reduce((sum, write) => sum + write.byteLength, 0)).toBe(firstBytes);
            expect(owner.snapshot()).toEqual(baseline);
            expect((await owner.runtime.readDiagnostics()).residentPageCount).toBe(0);
            owner.discard();
            expect((await owner.runtime.readDiagnostics()).uploadedBytes).toBe(0);
            owner.stage(9);
            expect(owner.writes.reduce((sum, write) => sum + write.byteLength, 0)).toBe(firstBytes);
            owner.submit();
            expect((await owner.runtime.readDiagnostics()).residentPageCount).toBe(1);
            expect([...residentOffsets(owner.snapshot(), geometry).keys()]).toEqual([1]);
            geometry.evictPage(1);
            owner.stage(10);
            expect((await owner.runtime.readDiagnostics()).residentPageCount).toBe(1);
            owner.discard();
            expect([...residentOffsets(owner.snapshot(), geometry).keys()]).toEqual([1]);
            owner.stage(10);
            owner.submit();
            expect((await owner.runtime.readDiagnostics()).residentPageCount).toBe(0);
            expect(residentOffsets(owner.snapshot(), geometry).size).toBe(0);
        } finally {
            owner.runtime.destroy();
        }
    });

    it('does not publish stale page-table pointers when a discarded page is removed before retry', async () => {
        const { geometry, pages } = asset();
        install(geometry, pages, 1);
        const owner = fixture(geometry);
        try {
            owner.stage(4);
            owner.discard();
            geometry.evictPage(1);
            install(geometry, pages, 3);
            owner.stage(4);
            owner.submit();
            expect([...residentOffsets(owner.snapshot(), geometry).keys()]).toEqual([3]);
            expect(await owner.runtime.readDiagnostics()).toMatchObject({
                residentPageCount: 1,
                residentBytes: COARSE_BYTES
            });
            expectBoundedPayloads(owner.snapshot(), geometry);
        } finally {
            owner.runtime.destroy();
        }
    });

    it('keeps renderer arenas independent while CPU availability and eviction are shared', async () => {
        const { geometry, pages } = asset();
        install(geometry, pages, 1);
        const first = fixture(geometry),
            second = fixture(geometry);
        try {
            first.stage(0);
            first.submit();
            expect((await first.runtime.readDiagnostics()).residentPageCount).toBe(1);
            expect((await second.runtime.readDiagnostics()).residentPageCount).toBe(0);
            expect(second.runtime.arena).not.toBe(first.runtime.arena);
            second.stage(0);
            second.submit();
            geometry.evictPage(1);
            expect(geometry.getPageData(1)).toBeNull();
            first.stage(1);
            first.submit();
            expect((await first.runtime.readDiagnostics()).residentPageCount).toBe(0);
            expect((await second.runtime.readDiagnostics()).residentPageCount).toBe(1);
            second.stage(1);
            second.submit();
            expect((await second.runtime.readDiagnostics()).residentPageCount).toBe(0);
            install(geometry, pages, 1);
            first.stage(2);
            first.submit();
            expect(residentOffsets(first.snapshot(), geometry).size).toBe(1);
            expect(residentOffsets(second.snapshot(), geometry).size).toBe(0);
        } finally {
            first.runtime.destroy();
            second.runtime.destroy();
        }
        expect(first.buffers.every(buffer => buffer.isDestroyed)).toBe(true);
        expect(second.buffers.every(buffer => buffer.isDestroyed)).toBe(true);
    });

    it('attempts every arena and temporal buffer after destruction failures and remains idempotent', () => {
        const { geometry, pages } = asset();
        install(geometry, pages, 1);
        const owner = fixture(geometry, [], true);
        owner.stage(0);
        owner.submit();
        install(geometry, pages, 3);
        owner.stage(1);
        const failures = [
            new Error('arena retirement failed'),
            new Error('history retirement failed')
        ] as const;
        const destroys = owner.buffers.map((buffer, index) => {
            const original = buffer.destroy.bind(buffer);
            return vi.spyOn(buffer, 'destroy').mockImplementation(() => {
                original();
                if (index === 0) throw failures[0];
                if (index === owner.buffers.length - 1) throw failures[1];
            });
        });
        try {
            let thrown: unknown;
            try {
                owner.runtime.destroy();
            } catch (error) {
                thrown = error;
            }
            expect(thrown).toBeInstanceOf(AggregateError);
            if (!(thrown instanceof AggregateError))
                throw new Error('Expected aggregate destruction failure');
            expect(thrown.errors).toEqual(failures);
            expect(thrown.cause).toBe(failures[0]);
            expect(owner.buffers.map(buffer => buffer.label)).toEqual(
                expect.arrayContaining(['Meshlet group history A', 'Meshlet group history B'])
            );
            expect(owner.buffers.every(buffer => buffer.isDestroyed)).toBe(true);
            for (const destroy of destroys) expect(destroy).toHaveBeenCalledTimes(1);
            expect(() => {
                owner.runtime.destroy();
            }).not.toThrow();
            for (const destroy of destroys) expect(destroy).toHaveBeenCalledTimes(1);
        } finally {
            for (const destroy of destroys) destroy.mockRestore();
        }
    });

    it('rejects impossible complete coarse residency and atomic page upload budgets before allocation', () => {
        for (const options of [
            { maxResidentBytes: PAGE_TABLE_BYTES + COARSE_BYTES * 2 - 4 },
            { maxUploadBytesPerFrame: ONE_PAGE_UPLOAD - 4 }
        ]) {
            const { geometry } = asset(options);
            const buffers: RendererStorageBuffer[] = [];
            expect(() => fixture(geometry, buffers)).toThrow(/coarsest|complete page/);
            expect(buffers).toHaveLength(0);
        }
    });
});
