import { describe, expect, it, vi } from 'vitest';
import {
    AmbientLight,
    BoxGeometry,
    ClusteredForwardPlusPipelineFactory,
    Color,
    DirectionalLight,
    Mesh,
    MeshletGeometry,
    Node,
    PBRMaterial,
    PerspectiveCamera,
    Renderer,
    Texture,
    Vector3,
    encodeMeshletGeometryPage,
    meshletPageChecksum,
    type MeshletAssetManifest,
    type MeshletGeometryPage
} from '../../../src/Hilo3d';
import { RGBA, TEXTURE_2D, UNSIGNED_BYTE } from '../../../src/constants/webgl';
import { RGBA8 } from '../../../src/constants/webgl2';
import {
    RendererStorageBuffer,
    type StorageBuffer,
    type StorageBufferDescriptor
} from '../../../src/render/StorageBuffer';
import SharedRendererDriver from '../../../src/render/internal/SharedRendererDriver';
import { MeshletRuntime } from '../../../src/render/pipeline/internal/MeshletRuntime';
import {
    MeshletVirtualShadowRuntime,
    meshletVirtualShadowBufferLengths
} from '../../../src/render/pipeline/internal/MeshletVirtualShadows';
import type { RHIDevice } from '../../../src/render/rhi/core';

const PAGE_COUNT = 32;
const MAX_OBJECTS = 3;
const FINE_ID = 11;
const COARSE_ID = 29;
const OBSERVED = new Set([
    'Virtual shadow per-page selected caster buckets',
    'Virtual shadow per-page visible caster indices',
    'Virtual shadow aligned page bucket offsets',
    'Virtual shadow page bucket indirect arguments'
]);

function fixtureAsset() {
    const geometry = new BoxGeometry({ width: 1.6, height: 2, depth: 1.6 });
    geometry.setAllRectUV([
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0]
    ]);
    const position = geometry.vertices,
        normal = geometry.normals,
        uv = geometry.uvs,
        indices = geometry.indices;
    if (position === null || normal === null || uv === null || indices === null)
        throw new Error('Box fixture streams are missing');
    const coarseVertices = new Float32Array(position.count * 8);
    const fineVertices = new Float32Array((position.count + 6) * 8);
    for (let vertex = 0; vertex < position.count; vertex++) {
        const x = position.data[vertex * 3] ?? 0,
            y = position.data[vertex * 3 + 1] ?? 0,
            z = position.data[vertex * 3 + 2] ?? 0;
        const nx = normal.data[vertex * 3] ?? 0;
        const ny = normal.data[vertex * 3 + 1] ?? 0;
        const nz = normal.data[vertex * 3 + 2] ?? 0;
        const length = Math.hypot(nx, ny, nz);
        if (length === 0) throw new Error('Box fixture has an invalid normal');
        coarseVertices.set(
            [
                x,
                y,
                z,
                nx / length,
                ny / length,
                nz / length,
                uv.data[vertex * 2] ?? 0,
                uv.data[vertex * 2 + 1] ?? 0
            ],
            vertex * 8
        );
        fineVertices.set(coarseVertices.subarray(vertex * 8, vertex * 8 + 8), vertex * 8);
        if (y > 0) fineVertices[vertex * 8 + 1] = y + 0.25;
    }
    const cluster = (firstIndex: number, indexCount: number) => ({
        firstIndex,
        indexCount,
        bounds: [0, 0, 0, 2] as const,
        coneApex: [0, 0, 0] as const,
        coneAxis: [0, 0, 1] as const,
        coneCutoff: 1
    });
    const pageIndices = Uint32Array.from(indices.data);
    const fineIndices = new Uint32Array(72);
    for (let face = 0; face < 6; face++) {
        const first = face * 4;
        const center = position.count + face;
        for (let component = 0; component < 8; component++) {
            let sum = 0;
            for (let corner = 0; corner < 4; corner++)
                sum += fineVertices[(first + corner) * 8 + component] ?? 0;
            fineVertices[center * 8 + component] = sum / 4;
        }
        fineIndices.set(
            [
                first,
                first + 1,
                center,
                first + 1,
                first + 2,
                center,
                first + 2,
                first + 3,
                center,
                first + 3,
                first,
                center
            ],
            face * 12
        );
    }
    const fine: MeshletGeometryPage = {
        vertices: fineVertices,
        indices: fineIndices,
        meshlets: Array.from({ length: 6 }, (_unused, index) => cluster(index * 12, 12))
    };
    const coarse: MeshletGeometryPage = {
        vertices: coarseVertices,
        indices: pageIndices,
        meshlets: [cluster(0, pageIndices.length)]
    };
    const manifest: MeshletAssetManifest = {
        version: 1,
        vertexStride: 8,
        groups: [
            {
                id: 17,
                bounds: [0, 0, 0, 2],
                lods: [
                    { pageId: FINE_ID, error: 0 },
                    { pageId: COARSE_ID, error: 0.25 }
                ]
            }
        ],
        pages: [fine, coarse].map((page, index) => {
            const bytes = encodeMeshletGeometryPage(page);
            return {
                id: index === 0 ? FINE_ID : COARSE_ID,
                byteLength: bytes.byteLength,
                vertexCount: page.vertices.length / 8,
                indexCount: page.indices.length,
                meshletCount: page.meshlets.length,
                checksum: meshletPageChecksum(bytes)
            };
        })
    };
    return { geometry, manifest, fine, coarse };
}

async function createView(maxVisibleMeshlets: number, streamed = true) {
    const data = fixtureAsset();
    const meshlets = new MeshletGeometry(data.manifest, {
        maxResidentBytes: 8192,
        maxUploadBytesPerFrame: 8192,
        maxVisibleMeshlets,
        maximumProjectedError: 0
    });
    const texture = new Texture({
        image: new Uint8Array([
            220, 130, 40, 255, 50, 180, 210, 0, 60, 140, 240, 255, 240, 200, 80, 255
        ]),
        target: TEXTURE_2D,
        internalFormat: RGBA8,
        format: RGBA,
        type: UNSIGNED_BYTE,
        width: 2,
        height: 2
    });
    const material = new PBRMaterial({
        baseColor: new Color(0.8, 0.7, 0.6),
        baseColorMap: texture,
        coverage: { mode: 'mask', cutoff: 0.5 },
        metallic: 0,
        roughness: 0.8,
        cullMode: 'none'
    });
    const floor = new BoxGeometry({ width: 10, height: 0.2, depth: 10 });
    const floorMaterial = new PBRMaterial({
        baseColor: new Color(0.65, 0.7, 0.8),
        metallic: 0,
        roughness: 1
    });
    const factory = new ClusteredForwardPlusPipelineFactory({
        buckets: [
            { geometry: data.geometry, material, ...(streamed ? { meshlets } : {}) },
            { geometry: floor, material: floorMaterial }
        ],
        maxObjects: MAX_OBJECTS,
        maxLights: 4,
        maxLightIndices: 4096,
        maxLightsPerCluster: 4,
        maxViewportWidth: 64,
        maxViewportHeight: 64,
        hiZ: true,
        bloomStrength: 0,
        virtualShadows: {
            virtualResolution: 512,
            pageSize: 64,
            physicalPageCount: PAGE_COUNT,
            maxPageUpdatesPerFrame: PAGE_COUNT,
            directionalClipmapLevels: 1,
            firstDirectionalClipmapExtent: 32
        }
    });
    const observed = new Map<string, StorageBuffer>();
    const original = Reflect.get(SharedRendererDriver.prototype, 'createPipelineStorageBuffer');
    // Add only observer copy usage. Production compute/raster resources, commands and values are
    // unchanged, and these readbacks never feed back into page allocation or draw submission.
    const creation = vi
        .spyOn(SharedRendererDriver.prototype, 'createPipelineStorageBuffer')
        .mockImplementation(function (
            this: SharedRendererDriver,
            descriptor: Readonly<StorageBufferDescriptor>
        ): StorageBuffer {
            const observe = descriptor.label !== undefined && OBSERVED.has(descriptor.label);
            const buffer = original.call(
                this,
                observe && !descriptor.usage.includes('copy-source')
                    ? { ...descriptor, usage: [...descriptor.usage, 'copy-source'] }
                    : descriptor
            );
            if (observe) observed.set(buffer.label, buffer);
            return buffer;
        });
    const renderer = await (async () => {
        try {
            return await Renderer.create({
                backend: 'webgpu',
                domElement: document.createElement('canvas'),
                width: 64,
                height: 64,
                antialias: false,
                renderingProfile: 'high-end',
                renderPipeline: factory
            });
        } finally {
            creation.mockRestore();
        }
    })();
    renderer.clearColor = new Color(0.02, 0.02, 0.03);
    const target = renderer.createRenderTarget({
        width: 64,
        height: 64,
        colorAttachments: [{ format: 'rgba8unorm' }],
        depthStencilAttachment: { format: 'depth32float', depthMode: 'reversed' }
    });
    const scene = new Node();
    new Mesh({
        geometry: floor,
        material: floorMaterial,
        y: -0.1,
        castShadows: false,
        receiveShadows: true
    }).addTo(scene);
    const caster = new Mesh({
        geometry: data.geometry,
        material,
        y: 1.5,
        castShadows: true,
        receiveShadows: true
    }).addTo(scene);
    new AmbientLight({ amount: 0.15 }).addTo(scene);
    new DirectionalLight({
        direction: new Vector3(1, -2, -1),
        amount: 3,
        shadow: { width: 256, height: 256, cascadeCount: 2 }
    }).addTo(scene);
    const camera = new PerspectiveCamera({ aspect: 1, near: 0.1, far: 40, depthMode: 'reversed' });
    camera.setPosition(5, 4, 7).lookAt(new Vector3(0, 0.5, 0));
    const capture = async (frames = 1): Promise<Uint8Array> => {
        for (let frame = 0; frame < frames; frame++) {
            renderer.renderToTarget(target, scene, camera);
            await renderer.waitForIdle();
        }
        return (await target.readColorAttachment()).data;
    };
    const buffer = (label: string): StorageBuffer => {
        const value = observed.get(label);
        if (value === undefined) throw new Error(`Missing observed buffer ${label}`);
        return value;
    };
    const destroy = (): void => {
        target.destroy();
        scene.destroy(renderer);
        renderer.destroy();
        texture.destroy();
    };
    return {
        ...data,
        meshlets,
        renderer,
        factory,
        scene,
        caster,
        camera,
        target,
        capture,
        buffer,
        destroy
    };
}

async function uints(buffer: StorageBuffer): Promise<Uint32Array> {
    const value = await buffer.read();
    return new Uint32Array(value.data.buffer, value.data.byteOffset, value.data.byteLength / 4);
}
function maximumDifference(a: Uint8Array, b: Uint8Array): number {
    let result = 0;
    for (let index = 0; index < a.length; index++)
        result = Math.max(result, Math.abs((a[index] ?? 0) - (b[index] ?? 0)));
    return result;
}
function activePages(argumentsData: Uint32Array): number[] {
    const pages: number[] = [];
    for (let page = 0; page < PAGE_COUNT; page++)
        if ((argumentsData[page * 6 + 1] ?? 0) > 0) pages.push(page);
    return pages;
}
function currentRuntime(contexts: readonly unknown[]): MeshletRuntime {
    const value = contexts.at(-1);
    if (!(value instanceof MeshletRuntime))
        throw new Error('Meshlet virtual-shadow recording did not execute');
    return value;
}

async function verifyResidentPages(
    runtime: MeshletRuntime,
    expectedClusters: 1 | 6
): Promise<void> {
    const virtual = runtime.virtualShadows;
    if (virtual === null) throw new Error('Missing virtual meshlet outputs');
    expect(virtual.visible).not.toBe(runtime.visible);
    expect(virtual.indirect).not.toBe(runtime.indirect);
    const argumentsData = await uints(virtual.indirect),
        pages = activePages(argumentsData);
    expect(pages.length).toBeGreaterThanOrEqual(2);
    expect(pages.some(page => page > 1)).toBe(true);
    const visible = await uints(virtual.visible);
    if (!(runtime.arena instanceof RendererStorageBuffer))
        throw new Error('Expected renderer-owned arena');
    const arena = new Uint32Array(runtime.arena.cpuData());
    const lodOffset = arena[20] ?? 0;
    const pageWord = arena[lodOffset + (expectedClusters === 6 ? 1 : 5)] ?? 0;
    expect(pageWord).toBeGreaterThan(0);
    const clusterBase = arena[pageWord + 1] ?? 0;
    for (const page of pages) {
        expect(argumentsData.slice(page * 6, page * 6 + 5)).toEqual(
            new Uint32Array([192, expectedClusters, 0, 0, 0])
        );
        const seen = new Set<number>();
        for (let cluster = 0; cluster < expectedClusters; cluster++) {
            const offset = (page * runtime.geometry.options.maxVisibleMeshlets + cluster) * 3;
            expect(visible[offset]).toBe(1); // The floor occupies stable object slot zero.
            seen.add(visible[offset + 1] ?? 0);
        }
        expect(seen).toEqual(
            new Set(
                Array.from(
                    { length: expectedClusters },
                    (_unused, index) => clusterBase + index * 16
                )
            )
        );
    }
}

describe('Meshlet virtual shadow pages', () => {
    it('plans bounded per-page output and rejects unsigned shader address overflow', () => {
        expect(meshletVirtualShadowBufferLengths(8, 32)).toEqual({
            visible: 3072,
            indirect: 768,
            offsets: 8192
        });
        expect(() => meshletVirtualShadowBufferLengths(0, 32)).toThrow(/positive/);
        expect(() => meshletVirtualShadowBufferLengths(0x7fff_ffff, 256)).toThrow(/address space/);
    });

    it('renders resident masked clusters per physical page and retries page changes after discard and device recovery', async () => {
        const record = vi.spyOn(MeshletRuntime.prototype, 'recordVirtualShadowCull');
        const view = await createView(8);
        try {
            view.meshlets.setPageData(COARSE_ID, view.coarse);
            const coarse = await view.capture(4);
            const runtime = currentRuntime(record.mock.contexts);
            await verifyResidentPages(runtime, 1);
            expect(
                (await view.factory.readDiagnostics()).virtualShadows?.renderedPageCount
            ).toBeGreaterThan(1);
            view.meshlets.setPageData(FINE_ID, view.fine);
            const failed = vi
                .spyOn(MeshletVirtualShadowRuntime.prototype, 'record')
                .mockImplementationOnce(() => {
                    throw new Error('injected meshlet virtual caster failure');
                });
            expect(() => {
                view.renderer.renderToTarget(view.target, view.scene, view.camera);
            }).toThrow(/injected meshlet virtual caster failure/);
            failed.mockRestore();
            expect(runtime.getResidentPage(FINE_ID)).toBeNull();
            expect((await runtime.readDiagnostics()).residentPageCount).toBe(1);
            const fine = await view.capture(3);
            expect(maximumDifference(fine, coarse)).toBeGreaterThan(3);
            await verifyResidentPages(runtime, 6);
            expect(runtime.getResidentPage(FINE_ID)).not.toBeNull();
            const extension = view.renderer.getExtension('rhi') as {
                readonly device: RHIDevice;
            } | null;
            if (extension === null) throw new Error('Expected checked RHI extension');
            const oldDevice = extension.device;
            const restored = new Promise<void>(resolve => {
                view.renderer.on(
                    'webgpuDeviceRestored',
                    () => {
                        resolve();
                    },
                    true
                );
            });
            oldDevice.destroy();
            await restored;
            const recovered = await view.capture(4);
            expect(extension.device).not.toBe(oldDevice);
            expect(maximumDifference(recovered, fine)).toBeLessThanOrEqual(1);
            await verifyResidentPages(runtime, 6);
            view.meshlets.evictPage(FINE_ID);
            await view.capture(3);
            await verifyResidentPages(runtime, 1);
        } finally {
            view.destroy();
            record.mockRestore();
        }
    }, 60_000);

    it('keeps full fallback casters on overflow with exact object strides and zero firstInstance on nonzero physical pages', async () => {
        const record = vi.spyOn(MeshletRuntime.prototype, 'recordVirtualShadowCull');
        const view = await createView(1),
            reference = await createView(1, false);
        try {
            view.meshlets.setPageData(COARSE_ID, view.coarse);
            view.meshlets.setPageData(FINE_ID, view.fine);
            const actual = await view.capture(4),
                expected = await reference.capture(4);
            expect(maximumDifference(actual, expected)).toBeLessThanOrEqual(1);
            const runtime = currentRuntime(record.mock.contexts),
                virtual = runtime.virtualShadows;
            if (virtual === null) throw new Error('Missing virtual meshlet outputs');
            const argumentsData = await uints(virtual.indirect);
            const overflowing: number[] = [];
            for (let page = 0; page < PAGE_COUNT; page++) {
                expect(argumentsData[page * 6 + 1]).toBe(0);
                if ((argumentsData[page * 6 + 5] ?? 0) > 0) overflowing.push(page);
            }
            expect(overflowing.length).toBeGreaterThanOrEqual(2);
            expect(overflowing.some(page => page > 1)).toBe(true);
            const selected = await uints(
                view.buffer('Virtual shadow per-page selected caster buckets')
            );
            const fallback = await uints(
                view.buffer('Virtual shadow page bucket indirect arguments')
            );
            const offsets = await uints(view.buffer('Virtual shadow aligned page bucket offsets'));
            const visible = await uints(
                view.buffer('Virtual shadow per-page visible caster indices')
            );
            const bucketCount = 3;
            for (const page of overflowing) {
                expect(selected[page * MAX_OBJECTS]).toBe(0xffff_ffff);
                expect(selected[page * MAX_OBJECTS + 1]).toBe(0);
                const argument = page * bucketCount * 5;
                expect(fallback[argument + 1]).toBe(1);
                expect(fallback[argument + 4]).toBe(0);
                const offset = offsets[page * bucketCount * 64] ?? 0;
                expect(offset).toBe(page * 64);
                expect(visible[offset]).toBe(1);
            }
        } finally {
            view.destroy();
            reference.destroy();
            record.mockRestore();
        }
    }, 60_000);
});
