import { TRIANGLES } from '../../constants/webgl';
import Mesh from '../../core/Mesh';
import Node from '../../core/Node';
import type Geometry from '../../geometry/Geometry';
import PBRMaterial from '../../material/PBRMaterial';
import { requireNumber } from '../../math/numberArray';
import { buildSceneBVH, refitSceneBVH, type SceneBVH } from './scene/SceneBVH';
import {
    extractGeometry,
    matchesGeometry,
    normalTransform,
    numbersEqual,
    RAY_TRIANGLE_FLOATS,
    RAY_BVH_NODE_FLOATS,
    RAY_BVH_LEAF_FLAG,
    writeWorldTriangles,
    type SceneGeometry
} from './scene/SceneGeometry';

export { RAY_TRIANGLE_FLOATS, RAY_BVH_NODE_FLOATS, RAY_BVH_LEAF_FLAG };

export type RayTracingSceneExclusion =
    'material' | 'deformation' | 'topology' | 'instances' | 'vertex-colors' | 'surface-texture';

export interface RayTracingSceneOptions {
    readonly maxTriangles?: number;
    readonly maxMeshes?: number;
    /** Unsupported surface/deformation classes are counted or fail before graph execution. */
    readonly unsupported?: 'exclude' | 'error';
    /** Approximation is opt-in: material-factor ignores surface maps only for ray transport. */
    readonly texturePolicy?: 'material-factor' | 'exclude' | 'error';
}

export interface RayTracingSceneDiagnostics {
    readonly meshCount: number;
    readonly triangleCount: number;
    readonly nodeCount: number;
    readonly bvhDepth: number;
    readonly excludedMeshCount: number;
    readonly exclusions: Readonly<Record<RayTracingSceneExclusion, number>>;
    readonly texturedMeshCount: number;
    readonly update: 'rebuild' | 'refit' | 'material';
    readonly changedMeshCount: number;
    readonly bytes: number;
}

/** Byte-aligned replacement range relative to the beginning of one packed scene array. */
export interface RayTracingSceneDirtyRange {
    readonly byteOffset: number;
    readonly byteLength: number;
}

const EMPTY_DIRTY_RANGES: readonly RayTracingSceneDirtyRange[] = Object.freeze([]);

function coalesceDirtyRanges(
    indices: number[],
    stride: number
): readonly RayTracingSceneDirtyRange[] {
    if (indices.length === 0) return EMPTY_DIRTY_RANGES;
    indices.sort((a, b) => a - b);
    const ranges: RayTracingSceneDirtyRange[] = [];
    let start = requireNumber(indices, 0);
    let end = start + 1;
    for (let index = 1; index < indices.length; index++) {
        const slot = requireNumber(indices, index);
        if (slot <= end) {
            end = Math.max(end, slot + 1);
            continue;
        }
        ranges.push(
            Object.freeze({ byteOffset: start * stride, byteLength: (end - start) * stride })
        );
        start = slot;
        end = slot + 1;
    }
    ranges.push(Object.freeze({ byteOffset: start * stride, byteLength: (end - start) * stride }));
    return Object.freeze(ranges);
}

/**
 * Complete, camera-independent CPU transport scene. Arrays are immutable by ownership: callers
 * may upload/read them but must not modify them. Previous snapshots remain valid across updates.
 * A renderer commits its uploaded revision only after submission; a failed graph can retry this
 * same snapshot without losing dirty data.
 *
 * Triangle ABI (32 floats): p0,p1,p2,n0,n1,n2,diffuse,emissive as eight vec4s. Position/normal W is
 * reserved zero, except p0.w which stores bitcast u32(mesh.layer). Diffuse.xyz is linear baseColor * (1-metallic); diffuse.w stores numeric flags
 * (bit 0: double sided). Emissive.xyz is linear radiance and emissive.w is the scene mesh ordinal.
 * BVH ABI (8 floats): min.xyz + bitcast u32(left/first), max.xyz + bitcast u32(right/leafCount).
 * A high bit in leafCount marks a leaf; its remaining bits are 1..4. Root is node zero.
 */
export interface RayTracingSceneSnapshot {
    readonly revision: number;
    /** Delta ranges apply only to this prior CPU revision; skipped revisions require full upload. */
    readonly baseRevision: number;
    readonly triangles: Float32Array;
    readonly nodes: Float32Array;
    readonly triangleDirtyRanges: readonly RayTracingSceneDirtyRange[];
    readonly nodeDirtyRanges: readonly RayTracingSceneDirtyRange[];
    readonly triangleCount: number;
    readonly nodeCount: number;
    readonly diagnostics: RayTracingSceneDiagnostics;
}

interface MeshRecord {
    readonly mesh: Mesh;
    readonly geometry: SceneGeometry;
    readonly matrix: readonly number[];
    readonly normalMatrix: readonly number[];
    readonly material: PBRMaterial;
    readonly materialRevision: number;
    readonly factors: readonly number[];
    readonly triangleOffset: number;
    readonly objectIndex: number;
    readonly layerMask: number;
    readonly reverseWinding: boolean;
}

function limit(value: number, name: string, maximum: number): number {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
        throw new RangeError(`DDGI ${name} must be an integer between 1 and ${String(maximum)}`);
    }
    return value;
}

function emptyExclusions(): Record<RayTracingSceneExclusion, number> {
    return {
        material: 0,
        deformation: 0,
        topology: 0,
        instances: 0,
        'vertex-colors': 0,
        'surface-texture': 0
    };
}

function unsupportedMesh(mesh: Mesh): RayTracingSceneExclusion | null {
    const geometry = mesh.geometry;
    const material = mesh.material;
    if (
        !(material instanceof PBRMaterial) ||
        material.lightType !== 'PBR' ||
        material.forwardQueue !== 'opaque' ||
        material.coverage.mode !== 'opaque'
    )
        return 'material';
    if (
        mesh.isSkinnedMesh ||
        geometry?.isMorphGeometry ||
        geometry?.skinIndices ||
        geometry?.skinWeights
    )
        return 'deformation';
    if (
        !geometry?.vertices ||
        geometry.mode !== TRIANGLES ||
        material.definition.getPass('forward')?.state.wireframe
    )
        return 'topology';
    if (mesh.instanceCount !== 1 || geometry.vertices.stepMode !== 'vertex') return 'instances';
    if (geometry.colors) return 'vertex-colors';
    return null;
}

function hasSurfaceTexture(material: PBRMaterial): boolean {
    for (const slot of material.definition.textureSlots) {
        if (
            slot.name === 'diffuseEnvironment' ||
            slot.name === 'specularEnvironment' ||
            slot.name === 'brdfLUT'
        )
            continue;
        if (material.getTextureSlot(slot.name) !== null) return true;
    }
    return false;
}

function materialFactors(material: PBRMaterial, output: number[]): void {
    const diffuseWeight = material.isSpecularGlossiness
        ? 1 - Math.max(material.specular.r, material.specular.g, material.specular.b)
        : 1 - material.metallic;
    output[0] = material.baseColor.r * diffuseWeight;
    output[1] = material.baseColor.g * diffuseWeight;
    output[2] = material.baseColor.b * diffuseWeight;
    output[3] = material.definition.getPass('forward')?.state.cullMode === 'none' ? 1 : 0;
    output[4] = material.emissionFactor.r;
    output[5] = material.emissionFactor.g;
    output[6] = material.emissionFactor.b;
    for (const value of output) {
        if (!Number.isFinite(Math.fround(value)) || value < 0)
            throw new RangeError('DDGI material factors must be finite nonnegative float32 values');
    }
}

/** Internal shared-frontend extraction and bounded software BVH for WebGPU DDGI. */
export class RayTracingScene {
    private readonly maxTriangles: number;
    private readonly maxMeshes: number;
    private readonly unsupported: 'exclude' | 'error';
    private readonly texturePolicy: 'material-factor' | 'exclude' | 'error';
    private geometryCache = new WeakMap<Geometry, SceneGeometry>();
    private records = new Map<Mesh, MeshRecord>();
    private readonly stagedRecords: MeshRecord[] = [];
    private readonly factors = new Array<number>(7).fill(0);
    private bvh: SceneBVH = buildSceneBVH(new Float32Array(0), 0);
    private current: RayTracingSceneSnapshot | null = null;
    private revision = 0;

    constructor(options: RayTracingSceneOptions = {}) {
        this.maxTriangles = limit(options.maxTriangles ?? 65536, 'maxTriangles', 1048576);
        this.maxMeshes = limit(options.maxMeshes ?? 16384, 'maxMeshes', 1048576);
        const unsupported: unknown = options.unsupported ?? 'exclude';
        const texturePolicy: unknown = options.texturePolicy ?? 'error';
        if (unsupported !== 'exclude' && unsupported !== 'error')
            throw new TypeError('Unknown DDGI unsupported surface policy');
        if (
            texturePolicy !== 'material-factor' &&
            texturePolicy !== 'exclude' &&
            texturePolicy !== 'error'
        )
            throw new TypeError('Unknown DDGI texture policy');
        this.unsupported = unsupported;
        this.texturePolicy = texturePolicy;
    }

    /**
     * Collects all hierarchically visible meshes in the layer mask, regardless of view frustum.
     * The caller updates world matrices once in the shared scene frontend before this call.
     * Exact matrix values are compared because Node.worldMatrixVersion advances every frame.
     * An unchanged scene returns the same snapshot and performs no per-triangle work/allocation.
     */
    update(root: Node, layerMask = 0xffffffff): RayTracingSceneSnapshot {
        if (!Number.isInteger(layerMask) || layerMask < -2147483648 || layerMask > 0xffffffff)
            throw new RangeError('DDGI scene layerMask must be a 32-bit mask');
        this.stagedRecords.length = 0;
        const stagedGeometry = new Map<Geometry, SceneGeometry>();
        const exclusions = emptyExclusions();
        let triangleCount = 0;
        let changedMeshCount = 0;
        let texturedMeshCount = 0;
        let excludedMeshCount = 0;
        const changes = { topology: false, bounds: false };
        root.traverse(node => {
            if (!node.visible) return Node.TRAVERSE_STOP_CHILDREN;
            if (!(node instanceof Mesh) || (node.layer & layerMask) === 0 || node.isDestroyed)
                return Node.TRAVERSE_STOP_NONE;
            let reason = unsupportedMesh(node);
            const material = node.material;
            if (reason === null && material instanceof PBRMaterial && hasSurfaceTexture(material)) {
                texturedMeshCount++;
                if (this.texturePolicy === 'error')
                    throw new TypeError(
                        `DDGI mesh ${node.name || node.id} has surface textures; choose an explicit texture policy`
                    );
                if (this.texturePolicy === 'exclude') reason = 'surface-texture';
            }
            if (reason !== null) {
                if (this.unsupported === 'error' && reason !== 'surface-texture')
                    throw new TypeError(
                        `DDGI mesh ${node.name || node.id} is unsupported: ${reason}`
                    );
                exclusions[reason]++;
                excludedMeshCount++;
                return Node.TRAVERSE_STOP_NONE;
            }
            const geometry = node.geometry;
            if (!geometry || !(material instanceof PBRMaterial))
                throw new TypeError('DDGI scene changed during traversal');
            const objectIndex = this.stagedRecords.length;
            if (objectIndex >= this.maxMeshes)
                throw new RangeError('DDGI scene mesh budget exceeded');
            let local = stagedGeometry.get(geometry) ?? this.geometryCache.get(geometry);
            if (!local || !matchesGeometry(local, geometry)) {
                local = extractGeometry(geometry, this.maxTriangles);
                stagedGeometry.set(geometry, local);
            }
            if (triangleCount + local.triangleCount > this.maxTriangles)
                throw new RangeError('DDGI scene triangle budget exceeded');
            materialFactors(material, this.factors);
            const previous = this.records.get(node);
            const matrix = node.worldMatrix.elements;
            const sameTransform = previous !== undefined && numbersEqual(previous.matrix, matrix);
            const sameGeometry = previous?.geometry === local;
            const sameOrder =
                previous?.triangleOffset === triangleCount && previous.objectIndex === objectIndex;
            const sameMaterial =
                previous?.material === material &&
                previous.materialRevision === material.revision &&
                numbersEqual(previous.factors, this.factors);
            let record: MeshRecord;
            if (
                previous &&
                sameTransform &&
                sameGeometry &&
                sameOrder &&
                sameMaterial &&
                previous.layerMask === node.layer
            ) {
                record = previous;
            } else {
                const normalMatrix = sameTransform
                    ? previous.normalMatrix
                    : normalTransform(matrix);
                record = {
                    mesh: node,
                    geometry: local,
                    matrix: sameTransform ? previous.matrix : Array.from(matrix),
                    normalMatrix,
                    material,
                    materialRevision: material.revision,
                    factors: this.factors.slice(),
                    triangleOffset: triangleCount,
                    objectIndex,
                    layerMask: node.layer,
                    reverseWinding:
                        (material.definition.getPass('forward')?.state.frontFace === 'cw') !==
                        (material.definition.getPass('forward')?.state.cullMode === 'front')
                };
                changedMeshCount++;
                changes.bounds ||= !sameTransform || !sameGeometry;
                changes.topology ||=
                    !previous ||
                    !sameOrder ||
                    previous.geometry.triangleCount !== local.triangleCount;
            }
            this.stagedRecords.push(record);
            triangleCount += local.triangleCount;
            return Node.TRAVERSE_STOP_NONE;
        });
        changes.topology ||=
            this.records.size !== this.stagedRecords.length ||
            this.current?.triangleCount !== triangleCount;
        const previousDiagnostics = this.current?.diagnostics;
        const diagnosticsChanged =
            previousDiagnostics?.texturedMeshCount !== texturedMeshCount ||
            previousDiagnostics.excludedMeshCount !== excludedMeshCount ||
            Object.keys(exclusions).some(
                key =>
                    exclusions[key as RayTracingSceneExclusion] !==
                    previousDiagnostics.exclusions[key as RayTracingSceneExclusion]
            );
        if (this.current && !changes.topology && changedMeshCount === 0 && !diagnosticsChanged)
            return this.current;

        // All mutable buffers belong to this candidate. An extraction/validation error cannot
        // corrupt the previous snapshot or its topology, even after a partially written object.
        let nextBVH: SceneBVH;
        let triangleDirtyRanges = EMPTY_DIRTY_RANGES;
        let nodeDirtyRanges = EMPTY_DIRTY_RANGES;
        const update = changes.topology ? 'rebuild' : changes.bounds ? 'refit' : 'material';
        if (changes.topology) {
            const triangles = new Float32Array(Math.max(1, triangleCount) * RAY_TRIANGLE_FLOATS);
            for (const record of this.stagedRecords)
                writeWorldTriangles(
                    triangles,
                    record.geometry,
                    record.matrix,
                    record.normalMatrix,
                    record.factors,
                    record.objectIndex,
                    record.layerMask,
                    record.reverseWinding,
                    record.triangleOffset,
                    null
                );
            nextBVH = buildSceneBVH(triangles, triangleCount);
            triangleDirtyRanges = Object.freeze([
                Object.freeze({ byteOffset: 0, byteLength: nextBVH.triangles.byteLength })
            ]);
            nodeDirtyRanges = Object.freeze([
                Object.freeze({ byteOffset: 0, byteLength: nextBVH.nodes.byteLength })
            ]);
        } else if (changedMeshCount > 0) {
            const triangles = this.bvh.triangles.slice();
            const dirtyTriangles: number[] = [];
            for (const record of this.stagedRecords) {
                if (this.records.get(record.mesh) !== record) {
                    writeWorldTriangles(
                        triangles,
                        record.geometry,
                        record.matrix,
                        record.normalMatrix,
                        record.factors,
                        record.objectIndex,
                        record.layerMask,
                        record.reverseWinding,
                        record.triangleOffset,
                        this.bvh.remap
                    );
                    for (let triangle = 0; triangle < record.geometry.triangleCount; triangle++) {
                        dirtyTriangles.push(
                            requireNumber(this.bvh.remap, record.triangleOffset + triangle)
                        );
                    }
                }
            }
            triangleDirtyRanges = coalesceDirtyRanges(dirtyTriangles, RAY_TRIANGLE_FLOATS * 4);
            const nodes = changes.bounds ? this.bvh.nodes.slice() : this.bvh.nodes;
            if (changes.bounds) {
                const dirtyNodes = refitSceneBVH(
                    nodes,
                    triangles,
                    this.bvh.nodeCount,
                    this.bvh.nodes
                );
                nodeDirtyRanges = coalesceDirtyRanges(
                    Array.from(dirtyNodes),
                    RAY_BVH_NODE_FLOATS * 4
                );
            }
            nextBVH = { ...this.bvh, triangles, nodes };
        } else nextBVH = this.bvh;

        const diagnostics: RayTracingSceneDiagnostics = Object.freeze({
            meshCount: this.stagedRecords.length,
            triangleCount,
            nodeCount: nextBVH.nodeCount,
            bvhDepth: nextBVH.depth,
            excludedMeshCount,
            exclusions: Object.freeze(exclusions),
            texturedMeshCount,
            update,
            changedMeshCount,
            bytes: nextBVH.triangles.byteLength + nextBVH.nodes.byteLength
        });
        const snapshot: RayTracingSceneSnapshot = Object.freeze({
            revision: this.revision + 1,
            baseRevision: this.revision,
            triangles: nextBVH.triangles,
            nodes: nextBVH.nodes,
            triangleDirtyRanges,
            nodeDirtyRanges,
            triangleCount,
            nodeCount: nextBVH.nodeCount,
            diagnostics
        });
        const records = new Map<Mesh, MeshRecord>();
        for (const record of this.stagedRecords) records.set(record.mesh, record);
        for (const [geometry, local] of stagedGeometry) this.geometryCache.set(geometry, local);
        this.records = records;
        this.bvh = nextBVH;
        this.current = snapshot;
        this.revision = snapshot.revision;
        return snapshot;
    }

    /** Release references on detach/destroy; revisions remain monotonic across recovery. */
    clear(): void {
        this.geometryCache = new WeakMap();
        this.records.clear();
        this.stagedRecords.length = 0;
        this.current = null;
        this.bvh = buildSceneBVH(new Float32Array(0), 0);
    }
}

export interface RayTracingSceneRay {
    readonly origin: readonly [number, number, number];
    readonly direction: readonly [number, number, number];
    readonly minDistance?: number;
    readonly maxDistance?: number;
}

export interface RayTracingSceneHit {
    readonly distance: number;
    readonly triangleIndex: number;
    readonly meshIndex: number;
    readonly barycentric: readonly [number, number, number];
    readonly normal: readonly [number, number, number];
    readonly backface: boolean;
}

/** CPU oracle with the same double-sided Möller–Trumbore and slab contracts as compute. */
export function traceRayTracingScene(
    snapshot: RayTracingSceneSnapshot,
    ray: RayTracingSceneRay
): RayTracingSceneHit | null {
    const { origin, direction } = ray;
    if (
        [...origin, ...direction].some(value => !Number.isFinite(value)) ||
        Math.abs(Math.hypot(...direction) - 1) > 1e-5
    )
        throw new RangeError('DDGI oracle rays require finite positions and normalized directions');
    const minimum = ray.minDistance ?? 1e-4;
    let closest = ray.maxDistance ?? Infinity;
    if (!Number.isFinite(minimum) || minimum < 0 || Number.isNaN(closest) || closest <= minimum)
        throw new RangeError('DDGI oracle ray distance interval is invalid');
    if (snapshot.nodeCount === 0) return null;
    const stack = [0];
    const metadata = new Uint32Array(
        snapshot.nodes.buffer,
        snapshot.nodes.byteOffset,
        snapshot.nodes.length
    );
    let hit: RayTracingSceneHit | null = null;
    while (stack.length > 0) {
        const node = stack.pop();
        if (node === undefined) break;
        const offset = node * 8;
        let near = minimum,
            far = closest;
        for (let axis = 0; axis < 3; axis++) {
            const o = requireNumber(origin, axis),
                d = requireNumber(direction, axis);
            const low = requireNumber(snapshot.nodes, offset + axis),
                high = requireNumber(snapshot.nodes, offset + axis + 4);
            if (Math.abs(d) < 1e-20) {
                if (o < low || o > high) far = -Infinity;
            } else {
                const a = (low - o) / d,
                    b = (high - o) / d;
                near = Math.max(near, Math.min(a, b));
                far = Math.min(far, Math.max(a, b));
            }
        }
        if (far < near) continue;
        const first = requireNumber(metadata, offset + 3),
            second = requireNumber(metadata, offset + 7);
        if ((second & 0x80000000) === 0) {
            stack.push(second, first);
            continue;
        }
        const count = second & 0x7fffffff;
        for (let triangle = first; triangle < first + count; triangle++) {
            const base = triangle * RAY_TRIANGLE_FLOATS;
            const values = snapshot.triangles;
            const ax = requireNumber(values, base),
                ay = requireNumber(values, base + 1),
                az = requireNumber(values, base + 2);
            const e1x = requireNumber(values, base + 4) - ax,
                e1y = requireNumber(values, base + 5) - ay,
                e1z = requireNumber(values, base + 6) - az;
            const e2x = requireNumber(values, base + 8) - ax,
                e2y = requireNumber(values, base + 9) - ay,
                e2z = requireNumber(values, base + 10) - az;
            const px = direction[1] * e2z - direction[2] * e2y,
                py = direction[2] * e2x - direction[0] * e2z,
                pz = direction[0] * e2y - direction[1] * e2x;
            const determinant = e1x * px + e1y * py + e1z * pz;
            if (Math.abs(determinant) < 1e-8) continue;
            const tx = origin[0] - ax,
                ty = origin[1] - ay,
                tz = origin[2] - az;
            const u = (tx * px + ty * py + tz * pz) / determinant;
            if (u < 0 || u > 1) continue;
            const qx = ty * e1z - tz * e1y,
                qy = tz * e1x - tx * e1z,
                qz = tx * e1y - ty * e1x;
            const v = (direction[0] * qx + direction[1] * qy + direction[2] * qz) / determinant;
            if (v < 0 || u + v > 1) continue;
            const distance = (e2x * qx + e2y * qy + e2z * qz) / determinant;
            if (distance <= minimum || distance >= closest) continue;
            const normal: [number, number, number] = [0, 0, 0];
            for (let axis = 0; axis < 3; axis++)
                normal[axis] =
                    requireNumber(values, base + 12 + axis) * (1 - u - v) +
                    requireNumber(values, base + 16 + axis) * u +
                    requireNumber(values, base + 20 + axis) * v;
            const normalLength = Math.hypot(...normal);
            if (normalLength > 1e-20)
                for (let axis = 0; axis < 3; axis++)
                    normal[axis] = requireNumber(normal, axis) / normalLength;
            closest = distance;
            hit = {
                distance,
                triangleIndex: triangle,
                meshIndex: requireNumber(values, base + 31),
                barycentric: [1 - u - v, u, v],
                normal,
                backface: determinant < 0
            };
        }
    }
    return hit;
}
