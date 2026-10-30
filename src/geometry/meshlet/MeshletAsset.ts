/** Local-space sphere stored as center XYZ and radius. */
export type MeshletSphere = readonly [number, number, number, number];

/** Local-space XYZ vector. */
export type MeshletVector3 = readonly [number, number, number];

/** One indexed cluster. Version 1 permits at most 64 vertices and 64 triangles. */
export interface MeshletDescriptor {
    readonly firstIndex: number;
    readonly indexCount: number;
    readonly bounds: MeshletSphere;
    readonly coneApex: MeshletVector3;
    readonly coneAxis: MeshletVector3;
    /** Conservative backface-cone cutoff; 1 disables cone rejection. */
    readonly coneCutoff: number;
}

/** One independent, uncompressed, complete group LOD page. */
export interface MeshletGeometryPage {
    /** Float32 position XYZ, unit normal XYZ (length tolerance 0.001), UV XY, repeated with stride 8. */
    readonly vertices: Float32Array;
    /** Page-local triangle indices; meshlets partition this array exactly. */
    readonly indices: Uint32Array;
    readonly meshlets: readonly MeshletDescriptor[];
}

/** Immutable wire size and decoded counts, verified before a page becomes resident. */
export interface MeshletPageDescriptor {
    readonly id: number;
    readonly byteLength: number;
    readonly vertexCount: number;
    readonly indexCount: number;
    readonly meshletCount: number;
    /** CRC-32/ISO-HDLC of the complete little-endian page bytes. */
    readonly checksum: number;
}

/** Complete replacement geometry, ordered from finest to coarsest within a group. */
export interface MeshletLODDescriptor {
    readonly pageId: number;
    /** Conservative cumulative simplification error in local position units. */
    readonly error: number;
}

/** Independently selectable region with fixed boundaries across its LOD pages. */
export interface MeshletGroupDescriptor {
    readonly id: number;
    readonly bounds: MeshletSphere;
    readonly lods: readonly MeshletLODDescriptor[];
}

/** Version 1 rigid, single-material geometry asset; every page belongs to exactly one group LOD. */
export interface MeshletAssetManifest {
    readonly version: 1;
    readonly vertexStride: 8;
    readonly groups: readonly MeshletGroupDescriptor[];
    readonly pages: readonly MeshletPageDescriptor[];
}

const MAGIC = 0x504d3348;
const HEADER_BYTES = 32;
const MESHLET_BYTES = 64;
const UINT32_MAX = 0xffffffff;

function record(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label} must be an object`);
    }
    return value as Record<string, unknown>;
}

function uint(value: unknown, label: string, minimum = 0): number {
    if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < minimum ||
        value > UINT32_MAX
    ) {
        throw new RangeError(`${label} must be an unsigned 32-bit integer >= ${String(minimum)}`);
    }
    return value;
}

function finite(value: unknown, label: string): number {
    if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        Math.abs(value) > 3.4028234663852886e38
    ) {
        throw new RangeError(`${label} must be a finite float32 value`);
    }
    return value;
}

function vector(value: unknown, label: string): MeshletVector3 {
    if (!Array.isArray(value) || value.length !== 3)
        throw new TypeError(`${label} must contain XYZ`);
    return Object.freeze([
        finite(value[0], label),
        finite(value[1], label),
        finite(value[2], label)
    ]);
}

function sphere(value: unknown, label: string): MeshletSphere {
    if (!Array.isArray(value) || value.length !== 4)
        throw new TypeError(`${label} must contain XYZ and radius`);
    const radius = finite(value[3], label);
    if (radius < 0) throw new RangeError(`${label} radius must be nonnegative`);
    return Object.freeze([
        finite(value[0], label),
        finite(value[1], label),
        finite(value[2], label),
        radius
    ]);
}

function array(value: unknown, label: string): readonly unknown[] {
    if (!Array.isArray(value) || value.length === 0)
        throw new TypeError(`${label} must be a nonempty array`);
    return value;
}

function wireByteLength(vertexCount: number, indexCount: number, meshletCount: number): number {
    return uint(
        HEADER_BYTES + meshletCount * MESHLET_BYTES + vertexCount * 32 + indexCount * 4,
        'page byteLength'
    );
}

function snapshotPageDescriptor(value: unknown): MeshletPageDescriptor {
    const input = record(value, 'page descriptor');
    const vertexCount = uint(input['vertexCount'], 'page vertexCount', 1);
    const indexCount = uint(input['indexCount'], 'page indexCount', 3);
    const meshletCount = uint(input['meshletCount'], 'page meshletCount', 1);
    const byteLength = uint(input['byteLength'], 'page byteLength', HEADER_BYTES);
    if (indexCount % 3 !== 0 || meshletCount > indexCount / 3 || indexCount > meshletCount * 192) {
        throw new RangeError('page triangle counts exceed the 64-triangle meshlet contract');
    }
    if (byteLength !== wireByteLength(vertexCount, indexCount, meshletCount)) {
        throw new RangeError('page byteLength does not match decoded counts');
    }
    return Object.freeze({
        id: uint(input['id'], 'page id'),
        byteLength,
        vertexCount,
        indexCount,
        meshletCount,
        checksum: uint(input['checksum'], 'page checksum')
    });
}

/** Validate untrusted manifest metadata and return a deeply frozen independent snapshot. */
export function snapshotMeshletAssetManifest(value: unknown): MeshletAssetManifest {
    const input = record(value, 'meshlet manifest');
    if (input['version'] !== 1 || input['vertexStride'] !== 8) {
        throw new RangeError('meshlet manifest requires version 1 and vertexStride 8');
    }
    const pages = array(input['pages'], 'manifest pages').map(snapshotPageDescriptor);
    const pagesById = new Map<number, MeshletPageDescriptor>();
    for (const page of pages) {
        if (pagesById.has(page.id)) throw new RangeError('duplicate page id');
        pagesById.set(page.id, page);
    }
    const ownedPages = new Set<number>();
    const groupIds = new Set<number>();
    const groups = array(input['groups'], 'manifest groups').map(
        (groupValue): MeshletGroupDescriptor => {
            const group = record(groupValue, 'meshlet group');
            const id = uint(group['id'], 'group id');
            if (groupIds.has(id)) throw new RangeError('duplicate group id');
            groupIds.add(id);
            let previousError = -1;
            let previousCount = Infinity;
            const lods = array(group['lods'], 'group lods').map(
                (entry, index): MeshletLODDescriptor => {
                    const lod = record(entry, 'group LOD');
                    const pageId = uint(lod['pageId'], 'LOD pageId');
                    const error = finite(lod['error'], 'LOD error');
                    const page = pagesById.get(pageId);
                    if (!page) throw new RangeError('LOD references a missing page');
                    if (ownedPages.has(pageId))
                        throw new RangeError('page must belong to exactly one group LOD');
                    if (error < 0 || error < previousError || (index === 0 && error !== 0)) {
                        throw new RangeError(
                            'LOD errors must begin at zero and increase monotonically'
                        );
                    }
                    if (page.indexCount >= previousCount)
                        throw new RangeError('coarser LODs must reduce triangle count');
                    ownedPages.add(pageId);
                    previousError = error;
                    previousCount = page.indexCount;
                    return Object.freeze({ pageId, error });
                }
            );
            return Object.freeze({
                id,
                bounds: sphere(group['bounds'], 'group bounds'),
                lods: Object.freeze(lods)
            });
        }
    );
    if (ownedPages.size !== pages.length) throw new RangeError('manifest contains unowned pages');
    return Object.freeze({
        version: 1,
        vertexStride: 8,
        groups: Object.freeze(groups),
        pages: Object.freeze(pages)
    });
}

function snapshotMeshlet(value: unknown): MeshletDescriptor {
    const meshlet = record(value, 'meshlet');
    const firstIndex = uint(meshlet['firstIndex'], 'meshlet firstIndex');
    const indexCount = uint(meshlet['indexCount'], 'meshlet indexCount', 3);
    if (firstIndex % 3 !== 0 || indexCount % 3 !== 0 || indexCount > 192) {
        throw new RangeError('meshlet must contain between 1 and 64 complete triangles');
    }
    const coneCutoff = finite(meshlet['coneCutoff'], 'meshlet coneCutoff');
    if (coneCutoff < 0 || coneCutoff > 1)
        throw new RangeError('meshlet coneCutoff must be in [0, 1]');
    const coneAxis = vector(meshlet['coneAxis'], 'meshlet coneAxis');
    if (coneCutoff < 1 && Math.abs(Math.hypot(...coneAxis) - 1) > 0.0001) {
        throw new RangeError('enabled meshlet coneAxis must be normalized');
    }
    return Object.freeze({
        firstIndex,
        indexCount,
        bounds: sphere(meshlet['bounds'], 'meshlet bounds'),
        coneApex: vector(meshlet['coneApex'], 'meshlet coneApex'),
        coneAxis,
        coneCutoff
    });
}

function component(vertices: Float32Array, index: number, offset: number): number {
    const value = vertices[index * 8 + offset];
    if (value === undefined) throw new RangeError('meshlet vertex index is out of range');
    return value;
}

function validateClusterGeometry(page: MeshletGeometryPage, meshlet: MeshletDescriptor): void {
    const referenced = new Set<number>();
    const cx = Math.fround(meshlet.bounds[0]),
        cy = Math.fround(meshlet.bounds[1]);
    const cz = Math.fround(meshlet.bounds[2]),
        radius = Math.fround(meshlet.bounds[3]);
    for (
        let offset = meshlet.firstIndex;
        offset < meshlet.firstIndex + meshlet.indexCount;
        offset += 3
    ) {
        const triangle: number[] = [];
        for (let corner = 0; corner < 3; corner++) {
            const index = page.indices[offset + corner];
            if (index === undefined || index >= page.vertices.length / 8)
                throw new RangeError('page index is out of range');
            referenced.add(index);
            const x = component(page.vertices, index, 0);
            const y = component(page.vertices, index, 1);
            const z = component(page.vertices, index, 2);
            if (Math.hypot(x - cx, y - cy, z - cz) > radius) {
                throw new RangeError('meshlet bounds do not contain their vertices');
            }
            triangle.push(x, y, z);
        }
        if (meshlet.coneCutoff === 1) continue;
        const [ax = 0, ay = 0, az = 0, bx = 0, by = 0, bz = 0, dx = 0, dy = 0, dz = 0] = triangle;
        const ux = bx - ax,
            uy = by - ay,
            uz = bz - az;
        const vx = dx - ax,
            vy = dy - ay,
            vz = dz - az;
        const nx = uy * vz - uz * vy,
            ny = uz * vx - ux * vz,
            nz = ux * vy - uy * vx;
        const length = Math.hypot(nx, ny, nz);
        if (length === 0) continue;
        const axisX = Math.fround(meshlet.coneAxis[0]),
            axisY = Math.fround(meshlet.coneAxis[1]),
            axisZ = Math.fround(meshlet.coneAxis[2]);
        const cutoff = Math.fround(meshlet.coneCutoff);
        const alignment = (nx * axisX + ny * axisY + nz * axisZ) / length;
        const apexDistance =
            (nx * (Math.fround(meshlet.coneApex[0]) - ax) +
                ny * (Math.fround(meshlet.coneApex[1]) - ay) +
                nz * (Math.fround(meshlet.coneApex[2]) - az)) /
            length;
        if (
            alignment < 0 ||
            alignment * alignment + cutoff * cutoff <
                axisX * axisX + axisY * axisY + axisZ * axisZ ||
            apexDistance > 0
        ) {
            throw new RangeError('meshlet cone is not conservative for its triangles');
        }
    }
    if (referenced.size > 64) throw new RangeError('meshlet exceeds 64 unique vertices');
}

function validatePage(page: MeshletGeometryPage): void {
    if (!(page.vertices instanceof Float32Array) || !(page.indices instanceof Uint32Array)) {
        throw new TypeError('meshlet page requires Float32 vertices and Uint32 indices');
    }
    if (
        page.vertices.length === 0 ||
        page.vertices.length % 8 !== 0 ||
        page.indices.length === 0 ||
        page.indices.length % 3 !== 0
    ) {
        throw new RangeError('meshlet page requires stride-8 vertices and complete triangles');
    }
    if (!page.vertices.every(Number.isFinite))
        throw new RangeError('meshlet page vertices must be finite');
    for (let vertex = 0; vertex < page.vertices.length / 8; vertex++) {
        if (
            Math.abs(
                Math.hypot(
                    component(page.vertices, vertex, 3),
                    component(page.vertices, vertex, 4),
                    component(page.vertices, vertex, 5)
                ) - 1
            ) > 0.001
        ) {
            throw new RangeError('meshlet page normals must have unit length');
        }
    }
    let nextIndex = 0;
    for (const entry of array(page.meshlets, 'page meshlets')) {
        const meshlet = snapshotMeshlet(entry);
        if (meshlet.firstIndex !== nextIndex)
            throw new RangeError('meshlets must partition the page index array exactly');
        nextIndex += meshlet.indexCount;
        if (nextIndex > page.indices.length)
            throw new RangeError('meshlet index range exceeds page');
        validateClusterGeometry(page, meshlet);
    }
    if (nextIndex !== page.indices.length)
        throw new RangeError('meshlets must cover every page index');
}

/** Check decoded arrays, cluster topology and conservative culling metadata against the manifest. */
export function validateMeshletGeometryPage(
    page: MeshletGeometryPage,
    descriptor: MeshletPageDescriptor
): void {
    const expected = snapshotPageDescriptor(descriptor);
    if (
        page.vertices.length !== expected.vertexCount * 8 ||
        page.indices.length !== expected.indexCount ||
        page.meshlets.length !== expected.meshletCount
    ) {
        throw new RangeError('decoded meshlet page counts differ from descriptor');
    }
    validatePage(page);
    if (decodedPageChecksum(page) !== expected.checksum) {
        throw new Error('decoded meshlet page checksum mismatch');
    }
}

function checksumByte(checksum: number, byte: number): number {
    let result = checksum ^ byte;
    for (let bit = 0; bit < 8; bit++) result = (result >>> 1) ^ (result & 1 ? 0xedb88320 : 0);
    return result;
}

function decodedPageChecksum(page: MeshletGeometryPage): number {
    let checksum = UINT32_MAX;
    const scratch = new DataView(new ArrayBuffer(4));
    function word(value: number): void {
        for (let shift = 0; shift < 32; shift += 8)
            checksum = checksumByte(checksum, (value >>> shift) & 255);
    }
    function float(value: number): void {
        scratch.setFloat32(0, value, true);
        word(scratch.getUint32(0, true));
    }
    for (const value of [
        MAGIC,
        1,
        8,
        page.vertices.length / 8,
        page.indices.length,
        page.meshlets.length,
        0,
        0
    ])
        word(value);
    for (const meshlet of page.meshlets) {
        word(meshlet.firstIndex);
        word(meshlet.indexCount);
        word(0);
        word(0);
        for (const value of meshlet.bounds) float(value);
        for (const value of meshlet.coneApex) float(value);
        float(meshlet.coneCutoff);
        for (const value of meshlet.coneAxis) float(value);
        word(0);
    }
    for (const value of page.vertices) float(value);
    for (const value of page.indices) word(value);
    return (checksum ^ UINT32_MAX) >>> 0;
}

/** Compute the version 1 page integrity checksum (CRC-32/ISO-HDLC). */
export function meshletPageChecksum(bytes: Uint8Array): number {
    let result = UINT32_MAX;
    for (const byte of bytes) result = checksumByte(result, byte);
    return (result ^ UINT32_MAX) >>> 0;
}

/** Serialize an independent uncompressed version 1 page in deterministic little-endian order. */
export function encodeMeshletGeometryPage(page: MeshletGeometryPage): Uint8Array {
    validatePage(page);
    return writePage(page);
}

function writePage(page: MeshletGeometryPage): Uint8Array {
    const bytes = new Uint8Array(
        wireByteLength(page.vertices.length / 8, page.indices.length, page.meshlets.length)
    );
    const view = new DataView(bytes.buffer);
    [MAGIC, 1, 8, page.vertices.length / 8, page.indices.length, page.meshlets.length].forEach(
        (value, index) => {
            view.setUint32(index * 4, value, true);
        }
    );
    page.meshlets.forEach((meshlet, index) => {
        const offset = HEADER_BYTES + index * MESHLET_BYTES;
        view.setUint32(offset, meshlet.firstIndex, true);
        view.setUint32(offset + 4, meshlet.indexCount, true);
        const floats = [
            ...meshlet.bounds,
            ...meshlet.coneApex,
            meshlet.coneCutoff,
            ...meshlet.coneAxis
        ];
        floats.forEach((value, componentIndex) => {
            view.setFloat32(offset + 16 + componentIndex * 4, value, true);
        });
    });
    let offset = HEADER_BYTES + page.meshlets.length * MESHLET_BYTES;
    for (const value of page.vertices) {
        view.setFloat32(offset, value, true);
        offset += 4;
    }
    for (const value of page.indices) {
        view.setUint32(offset, value, true);
        offset += 4;
    }
    return bytes;
}

/** Verify exact size, checksum and topology before returning independent decoded page arrays. */
export function decodeMeshletGeometryPage(
    bytes: Uint8Array,
    descriptor: MeshletPageDescriptor
): MeshletGeometryPage {
    const expected = snapshotPageDescriptor(descriptor);
    if (bytes.byteLength !== expected.byteLength)
        throw new RangeError('meshlet page byteLength mismatch');
    if (meshletPageChecksum(bytes) !== expected.checksum)
        throw new Error('meshlet page checksum mismatch');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (
        view.getUint32(0, true) !== MAGIC ||
        view.getUint32(4, true) !== 1 ||
        view.getUint32(8, true) !== 8
    ) {
        throw new RangeError('invalid meshlet page header or version');
    }
    if (
        view.getUint32(12, true) !== expected.vertexCount ||
        view.getUint32(16, true) !== expected.indexCount ||
        view.getUint32(20, true) !== expected.meshletCount ||
        view.getUint32(24, true) !== 0 ||
        view.getUint32(28, true) !== 0
    ) {
        throw new RangeError('meshlet page header does not match descriptor');
    }
    const meshlets: MeshletDescriptor[] = [];
    for (let index = 0; index < expected.meshletCount; index++) {
        const offset = HEADER_BYTES + index * MESHLET_BYTES;
        if (
            view.getUint32(offset + 8, true) !== 0 ||
            view.getUint32(offset + 12, true) !== 0 ||
            view.getUint32(offset + 60, true) !== 0
        ) {
            throw new RangeError('meshlet page reserved fields must be zero');
        }
        meshlets.push(
            snapshotMeshlet({
                firstIndex: view.getUint32(offset, true),
                indexCount: view.getUint32(offset + 4, true),
                bounds: [16, 20, 24, 28].map(componentOffset =>
                    view.getFloat32(offset + componentOffset, true)
                ),
                coneApex: [32, 36, 40].map(componentOffset =>
                    view.getFloat32(offset + componentOffset, true)
                ),
                coneCutoff: view.getFloat32(offset + 44, true),
                coneAxis: [48, 52, 56].map(componentOffset =>
                    view.getFloat32(offset + componentOffset, true)
                )
            })
        );
    }
    let offset = HEADER_BYTES + expected.meshletCount * MESHLET_BYTES;
    const vertices = new Float32Array(expected.vertexCount * 8);
    const indices = new Uint32Array(expected.indexCount);
    for (let index = 0; index < vertices.length; index++) {
        vertices[index] = view.getFloat32(offset, true);
        offset += 4;
    }
    for (let index = 0; index < indices.length; index++) {
        indices[index] = view.getUint32(offset, true);
        offset += 4;
    }
    const page: MeshletGeometryPage = Object.freeze({
        vertices,
        indices,
        meshlets: Object.freeze(meshlets)
    });
    validatePage(page);
    return page;
}
