import { MeshoptClusterizer, type Bounds } from 'meshoptimizer/clusterizer';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';
import {
    decodeMeshletGeometryPage,
    encodeMeshletGeometryPage,
    meshletPageChecksum,
    snapshotMeshletAssetManifest,
    type MeshletAssetManifest,
    type MeshletDescriptor,
    type MeshletGeometryPage,
    type MeshletGroupDescriptor,
    type MeshletLODDescriptor,
    type MeshletPageDescriptor,
    type MeshletSphere
} from '../../src/geometry/meshlet/MeshletAsset';

/** One indexed, rigid, single-material primitive in local coordinates. */
export interface MeshletCookInput {
    readonly positions: Float32Array;
    readonly normals: Float32Array;
    readonly uv0: Float32Array;
    readonly indices: Uint32Array;
}

/** Deterministic offline simplification settings. Boundaries and attribute seams remain locked. */
export interface MeshletCookOptions {
    /** Desired fractions of each original group's triangles, descending and below 1. */
    readonly lodRatios?: readonly number[];
    /** Maximum cumulative absolute simplification error; defaults to 1% of source extent. */
    readonly maxError?: number;
}

/** Validated manifest and independent immutable-by-contract page byte snapshots. */
export interface CookedMeshletAsset {
    readonly manifest: MeshletAssetManifest;
    readonly pages: ReadonlyMap<number, Uint8Array>;
}

function read(values: ArrayLike<number>, index: number): number {
    const value = values[index];
    if (value === undefined) throw new RangeError('meshlet cooker input index is out of range');
    return value;
}

function validateInput(input: MeshletCookInput): void {
    if (
        !(input.positions instanceof Float32Array) ||
        !(input.normals instanceof Float32Array) ||
        !(input.uv0 instanceof Float32Array) ||
        !(input.indices instanceof Uint32Array)
    ) {
        throw new TypeError('cooker requires Float32 position/normal/UV arrays and Uint32 indices');
    }
    const count = input.positions.length / 3;
    if (
        !Number.isInteger(count) ||
        count < 3 ||
        input.normals.length !== count * 3 ||
        input.uv0.length !== count * 2 ||
        input.indices.length < 3 ||
        input.indices.length % 3 !== 0
    ) {
        throw new RangeError(
            'cooker requires matching position/normal/UV vertex counts and triangles'
        );
    }
    if (
        ![input.positions, input.normals, input.uv0].every(values => values.every(Number.isFinite))
    ) {
        throw new RangeError('cooker input attributes must be finite');
    }
    for (let index = 0; index < count; index++) {
        if (
            Math.abs(
                Math.hypot(
                    read(input.normals, index * 3),
                    read(input.normals, index * 3 + 1),
                    read(input.normals, index * 3 + 2)
                ) - 1
            ) > 0.001
        ) {
            throw new RangeError('cooker input normals must have unit length');
        }
    }
    if (input.indices.some(index => index >= count))
        throw new RangeError('cooker index is out of range');
    for (let offset = 0; offset < input.indices.length; offset += 3) {
        const a = read(input.indices, offset),
            b = read(input.indices, offset + 1),
            c = read(input.indices, offset + 2);
        const ux = read(input.positions, b * 3) - read(input.positions, a * 3);
        const uy = read(input.positions, b * 3 + 1) - read(input.positions, a * 3 + 1);
        const uz = read(input.positions, b * 3 + 2) - read(input.positions, a * 3 + 2);
        const vx = read(input.positions, c * 3) - read(input.positions, a * 3);
        const vy = read(input.positions, c * 3 + 1) - read(input.positions, a * 3 + 1);
        const vz = read(input.positions, c * 3 + 2) - read(input.positions, a * 3 + 2);
        if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) === 0) {
            throw new RangeError('cooker rejects degenerate source triangles');
        }
    }
}

function conservativeSphere(
    bounds: Bounds,
    indices: Uint32Array,
    positions: Float32Array
): MeshletSphere {
    const x = Math.fround(bounds.centerX),
        y = Math.fround(bounds.centerY),
        z = Math.fround(bounds.centerZ);
    let radius = bounds.radius;
    for (const index of indices) {
        radius = Math.max(
            radius,
            Math.hypot(
                read(positions, index * 3) - x,
                read(positions, index * 3 + 1) - y,
                read(positions, index * 3 + 2) - z
            )
        );
    }
    return [x, y, z, Math.fround(radius * 1.000001 + 0.0000001)];
}

function conservativeCone(
    bounds: Bounds,
    indices: Uint32Array,
    positions: Float32Array
): Pick<MeshletDescriptor, 'coneApex' | 'coneAxis' | 'coneCutoff'> {
    const disabled = {
        coneApex: [bounds.centerX, bounds.centerY, bounds.centerZ] as const,
        coneAxis: [0, 0, 0] as const,
        coneCutoff: 1
    };
    const originalLength = Math.hypot(bounds.coneAxisX, bounds.coneAxisY, bounds.coneAxisZ);
    if (bounds.coneCutoff >= 1 || !(originalLength > 0)) return disabled;
    const axis = [
        Math.fround(bounds.coneAxisX / originalLength),
        Math.fround(bounds.coneAxisY / originalLength),
        Math.fround(bounds.coneAxisZ / originalLength)
    ] as const;
    const axisLength = Math.hypot(...axis);
    let minimumAlignment = Infinity;
    const planes: {
        readonly x: number;
        readonly y: number;
        readonly z: number;
        readonly nx: number;
        readonly ny: number;
        readonly nz: number;
        readonly alignment: number;
    }[] = [];
    let scale = Math.max(
        1,
        Math.abs(bounds.coneApexX),
        Math.abs(bounds.coneApexY),
        Math.abs(bounds.coneApexZ)
    );
    for (let offset = 0; offset < indices.length; offset += 3) {
        const a = read(indices, offset),
            b = read(indices, offset + 1),
            c = read(indices, offset + 2);
        const ax = read(positions, a * 3),
            ay = read(positions, a * 3 + 1),
            az = read(positions, a * 3 + 2);
        scale = Math.max(scale, Math.abs(ax), Math.abs(ay), Math.abs(az));
        const ux = read(positions, b * 3) - ax,
            uy = read(positions, b * 3 + 1) - ay,
            uz = read(positions, b * 3 + 2) - az;
        const vx = read(positions, c * 3) - ax,
            vy = read(positions, c * 3 + 1) - ay,
            vz = read(positions, c * 3 + 2) - az;
        const nx = uy * vz - uz * vy,
            ny = uz * vx - ux * vz,
            nz = ux * vy - uy * vx;
        const normalLength = Math.hypot(nx, ny, nz);
        if (normalLength === 0) continue;
        const alignment = (nx * axis[0] + ny * axis[1] + nz * axis[2]) / normalLength;
        // A cone spanning a hemisphere has no safe backface rejection. Keep all triangles and
        // explicitly disable only this optimization, as version 1 already permits.
        if (!(alignment > 0)) return disabled;
        minimumAlignment = Math.min(minimumAlignment, alignment);
        planes.push({
            x: ax,
            y: ay,
            z: az,
            nx: nx / normalLength,
            ny: ny / normalLength,
            nz: nz / normalLength,
            alignment
        });
    }
    if (planes.length === 0) return disabled;
    // Recompute from actual Float32 triangles and the serialized axis. The WASM cutoff and a
    // fixed additive epsilon are insufficient for nearly flat cones when axis rounding changes
    // its length. Cover both the raw-axis validator and the raster consumer's normalized axis.
    const required = Math.max(
        Math.sqrt(Math.max(0, axisLength * axisLength - minimumAlignment * minimumAlignment)),
        Math.sqrt(Math.max(0, 1 - (minimumAlignment / axisLength) ** 2))
    );
    const coneCutoff = Math.fround(required + 0.000001);
    if (!(coneCutoff < 1)) return disabled;
    let apex = [
        Math.fround(bounds.coneApexX),
        Math.fround(bounds.coneApexY),
        Math.fround(bounds.coneApexZ)
    ] as const;
    for (let attempt = 0; attempt < 4; attempt++) {
        let retreat = 0;
        for (const plane of planes) {
            const distance =
                plane.nx * (apex[0] - plane.x) +
                plane.ny * (apex[1] - plane.y) +
                plane.nz * (apex[2] - plane.z);
            retreat = Math.max(retreat, distance / plane.alignment);
        }
        if (attempt > 0 && retreat === 0) return { coneApex: apex, coneAxis: axis, coneCutoff };
        retreat += scale * 0.000001 * 2 ** attempt;
        apex = [
            Math.fround(apex[0] - axis[0] * retreat),
            Math.fround(apex[1] - axis[1] * retreat),
            Math.fround(apex[2] - axis[2] * retreat)
        ];
    }
    // Extreme quantization can prevent a finite, conservative apex. Frustum/Hi-Z still apply.
    return disabled;
}

function buildPage(input: MeshletCookInput, indices: Uint32Array): MeshletGeometryPage {
    const clusters = MeshoptClusterizer.buildMeshlets(indices, input.positions, 3, 64, 64, 0.5);
    const bounds = MeshoptClusterizer.computeMeshletBounds(clusters, input.positions, 3);
    const vertices: number[] = [];
    const outputIndices: number[] = [];
    const remap = new Map<number, number>();
    const meshlets: MeshletDescriptor[] = [];
    for (let index = 0; index < clusters.meshletCount; index++) {
        const cluster = MeshoptClusterizer.extractMeshlet(clusters, index);
        const clusterBounds = bounds[index];
        if (!clusterBounds) throw new RangeError('meshoptimizer omitted cluster bounds');
        const sourceIndices = Uint32Array.from(cluster.triangles, local =>
            read(cluster.vertices, local)
        );
        const firstIndex = outputIndices.length;
        for (const source of sourceIndices) {
            let local = remap.get(source);
            if (local === undefined) {
                local = vertices.length / 8;
                remap.set(source, local);
                for (let component = 0; component < 3; component++)
                    vertices.push(read(input.positions, source * 3 + component));
                for (let component = 0; component < 3; component++)
                    vertices.push(read(input.normals, source * 3 + component));
                vertices.push(read(input.uv0, source * 2), read(input.uv0, source * 2 + 1));
            }
            outputIndices.push(local);
        }
        meshlets.push({
            firstIndex,
            indexCount: sourceIndices.length,
            bounds: conservativeSphere(clusterBounds, sourceIndices, input.positions),
            ...conservativeCone(clusterBounds, sourceIndices, input.positions)
        });
    }
    return {
        vertices: new Float32Array(vertices),
        indices: new Uint32Array(outputIndices),
        meshlets
    };
}

/**
 * Cook real meshoptimizer edge-collapse LODs with locked group boundaries. Each page contains
 * a complete group replacement; no triangle truncation or runtime meshoptimizer dependency occurs.
 */
export async function cookMeshletAsset(
    input: MeshletCookInput,
    options: MeshletCookOptions = {}
): Promise<CookedMeshletAsset> {
    validateInput(input);
    const ratios = options.lodRatios ?? [0.5, 0.25, 0.125];
    let previousRatio = 1;
    if (ratios.length > 8) throw new RangeError('cooker accepts at most eight coarser LODs');
    for (const ratio of ratios) {
        if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= previousRatio)
            throw new RangeError('LOD ratios must decrease strictly within (0, 1)');
        previousRatio = ratio;
    }
    await Promise.all([MeshoptClusterizer.ready, MeshoptSimplifier.ready]);
    const maxError = options.maxError ?? MeshoptSimplifier.getScale(input.positions, 3) * 0.01;
    if (!Number.isFinite(maxError) || maxError < 0)
        throw new RangeError('maxError must be finite and nonnegative');
    const attributes = new Float32Array((input.normals.length / 3) * 5);
    for (let vertex = 0; vertex < input.positions.length / 3; vertex++) {
        attributes.set(input.normals.subarray(vertex * 3, vertex * 3 + 3), vertex * 5);
        attributes.set(input.uv0.subarray(vertex * 2, vertex * 2 + 2), vertex * 5 + 3);
    }
    const partitions = MeshoptClusterizer.buildMeshlets(
        input.indices,
        input.positions,
        3,
        256,
        512,
        0
    );
    const groups: MeshletGroupDescriptor[] = [];
    const descriptors: MeshletPageDescriptor[] = [];
    const pages = new Map<number, Uint8Array>();
    function appendPage(indices: Uint32Array): number {
        const page = buildPage(input, indices);
        const bytes = encodeMeshletGeometryPage(page);
        const id = descriptors.length;
        const descriptor: MeshletPageDescriptor = {
            id,
            byteLength: bytes.byteLength,
            vertexCount: page.vertices.length / 8,
            indexCount: page.indices.length,
            meshletCount: page.meshlets.length,
            checksum: meshletPageChecksum(bytes)
        };
        // Verify the actual wire bytes, including float32 bounds/cone rounding, before publishing.
        decodeMeshletGeometryPage(bytes, descriptor);
        descriptors.push(descriptor);
        pages.set(id, bytes);
        return id;
    }
    for (let groupId = 0; groupId < partitions.meshletCount; groupId++) {
        const partition = MeshoptClusterizer.extractMeshlet(partitions, groupId);
        const fine = Uint32Array.from(partition.triangles, local =>
            read(partition.vertices, local)
        );
        const bounds = conservativeSphere(
            MeshoptClusterizer.computeClusterBounds(fine, input.positions, 3),
            fine,
            input.positions
        );
        const lods: MeshletLODDescriptor[] = [{ pageId: appendPage(fine), error: 0 }];
        let current: Uint32Array = fine;
        let error = 0;
        for (const ratio of ratios) {
            const target = Math.max(3, Math.floor((fine.length * ratio) / 3) * 3);
            if (target >= current.length) continue;
            const [simplified, localError] = MeshoptSimplifier.simplifyWithAttributes(
                current,
                input.positions,
                3,
                attributes,
                5,
                [0.5, 0.5, 0.5, 1, 1],
                null,
                target,
                Math.max(0, maxError - error),
                ['LockBorder', 'ErrorAbsolute']
            );
            if (simplified.length === 0 || simplified.length >= current.length) break;
            error += localError;
            current = simplified;
            lods.push({ pageId: appendPage(current), error });
        }
        groups.push({ id: groupId, bounds, lods });
    }
    return {
        manifest: snapshotMeshletAssetManifest({
            version: 1,
            vertexStride: 8,
            groups,
            pages: descriptors
        }),
        pages
    };
}
