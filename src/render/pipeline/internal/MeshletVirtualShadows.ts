import type { StorageBuffer } from '../../StorageBuffer';
import ComputeShader from '../../compute/ComputeShader';
import type { RenderPipelineContext, RenderPipelineCreateContext } from '../RenderPipeline';
import { RenderPassParameterPool } from '../RenderPassParameterPool';
import {
    CLIPMAP_WGSL,
    PHYSICAL_PAGE_STRIDE_BYTES,
    type VirtualShadowCasterPreparation,
    type VirtualShadowMapSettings
} from '../VirtualShadowMaps';
import { computePass, FRAME_WGSL } from './clusteredComputePasses';
import { CULL_WORKGROUP_SIZE } from './clusteredLayout';
import {
    ClearBuffersParameters,
    ClearBuffersPass,
    MutableComputeParameters,
    type MutableGPUDrivenParameters
} from './clusteredPassParameters';

const INDIRECT_STRIDE_BYTES = 24;
const OFFSET_STRIDE_BYTES = 256;
const VISIBLE_ENTRY_BYTES = 12;

/** @internal Fixed allocations; validation happens before selecting a device or creating buffers. */
export function meshletVirtualShadowBufferLengths(
    maxVisibleMeshlets: number,
    physicalPageCount: number
): Readonly<{ visible: number; indirect: number; offsets: number }> {
    for (const [name, value] of [
        ['maxVisibleMeshlets', maxVisibleMeshlets],
        ['physicalPageCount', physicalPageCount]
    ] as const) {
        if (!Number.isSafeInteger(value) || value <= 0)
            throw new RangeError(`Meshlet virtual-shadow ${name} must be a positive safe integer`);
    }
    const visible = maxVisibleMeshlets * physicalPageCount * VISIBLE_ENTRY_BYTES;
    if (!Number.isSafeInteger(visible) || visible / 4 > 0x1_0000_0000) {
        throw new RangeError(
            'Meshlet virtual-shadow visibility exceeds the 32-bit shader address space'
        );
    }
    return Object.freeze({
        visible,
        indirect: physicalPageCount * INDIRECT_STRIDE_BYTES,
        offsets: physicalPageCount * OFFSET_STRIDE_BYTES
    });
}

const CULL_PASS = computePass(
    new ComputeShader({
        label: 'Meshlet virtual-shadow coherent LOD, page cull and bounded compact',
        source: `${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var<storage, read> clipmapData: array<vec4<u32>>;
@group(0) @binding(2) var<storage, read> physicalPages: array<u32>;
@group(0) @binding(3) var<storage, read> objects: array<ObjectRecord>;
@group(0) @binding(4) var<storage, read_write> selectedBuckets: array<u32>;
@group(0) @binding(5) var<storage, read_write> fallbackArguments: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read> geometry: array<u32>;
@group(0) @binding(7) var<storage, read_write> arguments: array<atomic<u32>>;
@group(0) @binding(8) var<storage, read_write> visible: array<u32>;
${CLIPMAP_WGSL}
fn f(index: u32) -> f32 { return bitcast<f32>(geometry[index]); }
fn v3(index: u32) -> vec3<f32> { return vec3<f32>(f(index), f(index + 1u), f(index + 2u)); }
fn conservativeScale(model: mat4x4<f32>) -> f32 {
    let a = abs(model[0].xyz); let b = abs(model[1].xyz); let c = abs(model[2].xyz);
    let norm1 = max(a.x+a.y+a.z, max(b.x+b.y+b.z, c.x+c.y+c.z));
    let rows = a+b+c;
    return sqrt(norm1 * max(rows.x, max(rows.y, rows.z)));
}
fn selectedPage(group: u32, model: mat4x4<f32>, matrix: mat4x4<f32>) -> u32 {
    let base = 16u + group * 8u;
    let lodOffset = geometry[base + 4u];
    let lodCount = geometry[base + 5u];
    let rowX = vec3<f32>(matrix[0].x, matrix[1].x, matrix[2].x);
    let rowY = vec3<f32>(matrix[0].y, matrix[1].y, matrix[2].y);
    let virtualResolution = clipmapFloat(0u).z * clipmapFloat(0u).w;
    // Orthographic shadow-texel error is independent of physical page and main camera. Every
    // page of this clipmap therefore chooses the same complete group LOD, including borders.
    let pixels = max(length(rowX), length(rowY)) * 0.5 * virtualResolution * conservativeScale(model);
    var chosen = 0u;
    for (var level = 0u; level < lodCount; level++) {
        let entry = lodOffset + level * 4u;
        let page = geometry[entry + 1u];
        if (page == 0u) { continue; }
        if (chosen == 0u) { chosen = page; }
        if (f(5u) == 0.0) { return chosen; }
        if (f(entry) * pixels <= f(5u)) { chosen = page; }
    }
    return chosen;
}
fn clusterVisible(cluster: u32, object: ObjectRecord, model: mat4x4<f32>, matrix: mat4x4<f32>, page: vec2<i32>, grid: u32) -> bool {
    if ((object.metadata.z & 2u) == 0u) { return true; }
    let center = model * vec4<f32>(v3(cluster), 1.0);
    let radius = f(cluster + 3u) * conservativeScale(model);
    let clip = matrix * center;
    if (clip.w <= 0.0) { return false; }
    let rowX = vec3<f32>(matrix[0].x, matrix[1].x, matrix[2].x);
    let rowY = vec3<f32>(matrix[0].y, matrix[1].y, matrix[2].y);
    let rowZ = vec3<f32>(matrix[0].z, matrix[1].z, matrix[2].z);
    let radiusNdc = vec3<f32>(length(rowX), length(rowY), length(rowZ)) * radius / clip.w;
    let centerNdc = clip.xyz / clip.w;
    let pageMinimum = vec2<f32>(page) / f32(grid) * 2.0 - vec2<f32>(1.0);
    let pageMaximum = vec2<f32>(page + vec2<i32>(1)) / f32(grid) * 2.0 - vec2<f32>(1.0);
    return !(centerNdc.x + radiusNdc.x < pageMinimum.x ||
        centerNdc.x - radiusNdc.x > pageMaximum.x ||
        centerNdc.y + radiusNdc.y < -pageMaximum.y ||
        centerNdc.y - radiusNdc.y > -pageMinimum.y ||
        centerNdc.z + radiusNdc.z < -1.0 || centerNdc.z - radiusNdc.z > 1.0);
}
@compute @workgroup_size(${String(CULL_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let maximumObjects = arrayLength(&objects);
    let physicalIndex = id.y;
    if (id.x >= frameData.counts.x || id.x >= maximumObjects || physicalIndex >= clipmapData[3u].w) { return; }
    let selectedIndex = physicalIndex * maximumObjects + id.x;
    let fallbackBucket = selectedBuckets[selectedIndex];
    let object = objects[id.x];
    if (fallbackBucket == 0xffffffffu || object.metadata.x != geometry[0u]) { return; }
    let base = physicalIndex * ${String(PHYSICAL_PAGE_STRIDE_BYTES / 4)}u;
    if (physicalPages[base + 6u] == 0u) { return; }
    let mapIndex = physicalPages[base];
    let identity = clipmapIdentity(mapIndex);
    let page = vec2<i32>(bitcast<i32>(physicalPages[base + 1u]) - bitcast<i32>(identity.x), bitcast<i32>(physicalPages[base + 2u]) - bitcast<i32>(identity.y));
    let grid = u32(clipmapFloat(0u).z + 0.5);
    if (any(page < vec2<i32>(0)) || any(page >= vec2<i32>(i32(grid)))) { return; }
    let model = objectModel(object);
    let matrix = clipmapMatrix(mapIndex);
    var count = 0u;
    for (var group = 0u; group < geometry[2u]; group++) {
        let geometryPage = selectedPage(group, model, matrix);
        if (geometryPage == 0u) { return; }
        let clusters = geometry[geometryPage];
        let first = geometry[geometryPage + 1u];
        for (var cluster = 0u; cluster < clusters; cluster++) {
            if (clusterVisible(first + cluster * 16u, object, model, matrix, page, grid)) { count++; }
        }
    }
    let argumentBase = physicalIndex * ${String(INDIRECT_STRIDE_BYTES / 4)}u;
    var start = atomicLoad(&arguments[argumentBase + 1u]);
    loop {
        if (count > geometry[4u] - min(start, geometry[4u])) {
            _ = atomicAdd(&arguments[argumentBase + 5u], 1u);
            return;
        }
        let reservation = atomicCompareExchangeWeak(&arguments[argumentBase + 1u], start, start + count);
        if (reservation.exchanged) { break; }
        start = reservation.old_value;
    }
    let bucketCount = clipmapData[3u].y;
    _ = atomicSub(&fallbackArguments[(physicalIndex * bucketCount + fallbackBucket) * 5u + 1u], 1u);
    selectedBuckets[selectedIndex] = 0xffffffffu;
    var output = physicalIndex * geometry[4u] + start;
    for (var group = 0u; group < geometry[2u]; group++) {
        let geometryPage = selectedPage(group, model, matrix);
        let clusters = geometry[geometryPage];
        let first = geometry[geometryPage + 1u];
        for (var index = 0u; index < clusters; index++) {
            let cluster = first + index * 16u;
            if (clusterVisible(cluster, object, model, matrix, page, grid)) {
                visible[output * 3u] = id.x;
                visible[output * 3u + 1u] = cluster;
                visible[output * 3u + 2u] = 0u;
                output++;
            }
        }
    }
}`,
        workgroupSize: [CULL_WORKGROUP_SIZE],
        bindings: [
            { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            { name: 'clipmapData', group: 0, binding: 1, kind: 'read-only-storage-buffer' },
            { name: 'physicalPages', group: 0, binding: 2, kind: 'read-only-storage-buffer' },
            { name: 'objects', group: 0, binding: 3, kind: 'read-only-storage-buffer' },
            {
                name: 'selectedBuckets',
                group: 0,
                binding: 4,
                kind: 'storage-buffer',
                access: 'read-write'
            },
            {
                name: 'fallbackArguments',
                group: 0,
                binding: 5,
                kind: 'storage-buffer',
                access: 'read-write'
            },
            { name: 'geometry', group: 0, binding: 6, kind: 'read-only-storage-buffer' },
            {
                name: 'arguments',
                group: 0,
                binding: 7,
                kind: 'storage-buffer',
                access: 'read-write'
            },
            {
                name: 'visible',
                group: 0,
                binding: 8,
                kind: 'storage-buffer',
                access: 'write-discard'
            }
        ]
    })
);

/** @internal Per-physical-page output; none of these mutable buffers alias scene/CSM outputs. */
export class MeshletVirtualShadowRuntime {
    readonly visible: StorageBuffer;
    readonly indirect: StorageBuffer;
    readonly offsets: StorageBuffer;
    readonly buffers: readonly StorageBuffer[];
    readonly #clearPass = new ClearBuffersPass();
    readonly #clearPool = new RenderPassParameterPool(
        () => new ClearBuffersParameters(),
        parameters => {
            parameters.reset();
        }
    );
    readonly #cullPool = new RenderPassParameterPool(() => new MutableComputeParameters(9, 0));

    constructor(
        readonly settings: Readonly<VirtualShadowMapSettings>,
        context: RenderPipelineCreateContext,
        readonly arena: StorageBuffer,
        readonly index: StorageBuffer,
        maxVisibleMeshlets: number
    ) {
        const sizes = meshletVirtualShadowBufferLengths(
            maxVisibleMeshlets,
            settings.physicalPageCount
        );
        const initialIndirect = new Uint32Array(sizes.indirect / 4);
        const initialOffsets = new Uint32Array(sizes.offsets / 4);
        for (let page = 0; page < settings.physicalPageCount; page++) {
            initialIndirect[(page * INDIRECT_STRIDE_BYTES) / 4] = 192;
            initialOffsets[(page * OFFSET_STRIDE_BYTES) / 4] = page * maxVisibleMeshlets;
        }
        this.visible = context.createStorageBuffer({
            label: 'Meshlet virtual-shadow per-page compact table',
            byteLength: sizes.visible,
            usage: ['storage', 'copy-source'],
            recovery: 'reinitialize'
        });
        this.indirect = context.createStorageBuffer({
            label: 'Meshlet virtual-shadow per-page indirect arguments',
            byteLength: sizes.indirect,
            usage: ['storage', 'indirect', 'copy-destination', 'copy-source'],
            initialData: initialIndirect,
            recovery: 'cpu-shadow'
        });
        this.offsets = context.createStorageBuffer({
            label: 'Meshlet virtual-shadow aligned page offsets',
            byteLength: sizes.offsets,
            usage: ['storage'],
            initialData: initialOffsets,
            recovery: 'cpu-shadow'
        });
        this.buffers = Object.freeze([this.visible, this.indirect, this.offsets]);
    }

    record(
        context: RenderPipelineContext,
        resources: Readonly<VirtualShadowCasterPreparation>
    ): void {
        const indirect = context.graph.importStorageBuffer(this.indirect);
        const clear = context.acquirePassParameters(this.#clearPool);
        for (let page = 0; page < this.settings.physicalPageCount; page++) {
            clear.add(indirect, page * INDIRECT_STRIDE_BYTES + 4, 4);
            clear.add(indirect, page * INDIRECT_STRIDE_BYTES + 20, 4);
        }
        context.graph.addPass(this.#clearPass, clear);
        const parameters = context.acquirePassParameters(this.#cullPool);
        parameters.setBuffer(0, resources.frameBuffer);
        parameters.setBuffer(1, resources.clipmapData);
        parameters.setBuffer(2, resources.physicalPages);
        parameters.setBuffer(3, resources.objects);
        parameters.setBuffer(4, resources.selectedBuckets);
        parameters.setBuffer(5, resources.shadowIndirectArguments);
        parameters.setBuffer(6, context.graph.importStorageBuffer(this.arena));
        parameters.setBuffer(7, indirect);
        parameters.setBuffer(8, context.graph.importStorageBuffer(this.visible));
        parameters.setDispatch(
            Math.max(1, Math.ceil(resources.activeObjectHighWater / CULL_WORKGROUP_SIZE)),
            this.settings.physicalPageCount
        );
        context.graph.addPass(CULL_PASS, parameters);
    }

    configureDraw(
        context: RenderPipelineContext,
        parameters: MutableGPUDrivenParameters,
        physicalPageIndex: number
    ): void {
        if (
            !Number.isInteger(physicalPageIndex) ||
            physicalPageIndex < 0 ||
            physicalPageIndex >= this.settings.physicalPageCount
        )
            throw new RangeError('Meshlet virtual-shadow physical page index is out of range');
        parameters.setBuffer(3, context.graph.importStorageBuffer(this.visible));
        parameters.setBufferRange(
            4,
            context.graph.importStorageBuffer(this.offsets),
            physicalPageIndex * OFFSET_STRIDE_BYTES,
            4
        );
        parameters.setBuffer(
            parameters.buffers.length - 1,
            context.graph.importStorageBuffer(this.arena)
        );
        parameters.indexBuffer.buffer = context.graph.importStorageBuffer(this.index);
        parameters.draw.buffer = context.graph.importStorageBuffer(this.indirect);
        parameters.draw.byteOffset = physicalPageIndex * INDIRECT_STRIDE_BYTES;
    }
}
