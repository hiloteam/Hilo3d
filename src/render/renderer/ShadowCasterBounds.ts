import type Mesh from '../../core/Mesh';
import SkinnedMesh from '../../core/SkinnedMesh';
import type Geometry from '../../geometry/Geometry';
import type GeometryData from '../../geometry/GeometryData';
import MorphGeometry from '../../geometry/MorphGeometry';
import Matrix4 from '../../math/Matrix4';

/** @internal Conservative local-space bounds for the canonical position/morph/skin vertex path. */
export interface ShadowCasterBoundsValue {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    zMin: number;
    zMax: number;
}

interface StreamSnapshot {
    readonly stream: GeometryData;
    readonly data: GeometryData['data'];
    readonly revision: number;
    readonly size: number;
    readonly stride: number;
    readonly offset: number;
    readonly normalized: boolean;
    readonly stepMode: GeometryData['stepMode'];
}
interface StreamBounds {
    readonly snapshot: StreamSnapshot;
    readonly bounds: ShadowCasterBoundsValue;
}
interface SkinInfluences {
    readonly indices: StreamSnapshot;
    readonly weights: StreamSnapshot;
    readonly vertexCount: number;
    readonly jointCount: number;
    readonly activeJoints: readonly number[];
}

function emptyBounds(): ShadowCasterBoundsValue {
    return {
        xMin: Infinity,
        xMax: -Infinity,
        yMin: Infinity,
        yMax: -Infinity,
        zMin: Infinity,
        zMax: -Infinity
    };
}
function reset(bounds: ShadowCasterBoundsValue): void {
    bounds.xMin = bounds.yMin = bounds.zMin = Infinity;
    bounds.xMax = bounds.yMax = bounds.zMax = -Infinity;
}
function include(bounds: ShadowCasterBoundsValue, x: number, y: number, z: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z))
        throw new RangeError('Shadow caster positions and deformations must be finite');
    bounds.xMin = Math.min(bounds.xMin, x);
    bounds.xMax = Math.max(bounds.xMax, x);
    bounds.yMin = Math.min(bounds.yMin, y);
    bounds.yMax = Math.max(bounds.yMax, y);
    bounds.zMin = Math.min(bounds.zMin, z);
    bounds.zMax = Math.max(bounds.zMax, z);
}
function snapshot(stream: GeometryData): StreamSnapshot {
    return {
        stream,
        data: stream.data,
        revision: stream.revision,
        size: stream.size,
        stride: stream.stride,
        offset: stream.offset,
        normalized: stream.normalized,
        stepMode: stream.stepMode
    };
}
function matches(previous: StreamSnapshot | undefined, stream: GeometryData): boolean {
    return (
        previous?.stream === stream &&
        previous.data === stream.data &&
        previous.revision === stream.revision &&
        previous.size === stream.size &&
        previous.stride === stream.stride &&
        previous.offset === stream.offset &&
        previous.normalized === stream.normalized &&
        previous.stepMode === stream.stepMode
    );
}
function count(stream: GeometryData, size: number): number {
    const bytes = stream.data.BYTES_PER_ELEMENT;
    const stride = stream.stride === 0 ? stream.size : stream.stride / bytes;
    const offset = stream.offset / bytes;
    if (
        stream.size !== size ||
        stream.stepMode !== 'vertex' ||
        !Number.isSafeInteger(stride) ||
        stride < size ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset + size > stream.data.length
    )
        throw new RangeError('Shadow caster vertex stream layout is invalid');
    return Math.floor((stream.data.length - offset - size) / stride) + 1;
}
function component(stream: GeometryData, vertex: number, axis: number): number {
    const stride =
        stream.stride === 0 ? stream.size : stream.stride / stream.data.BYTES_PER_ELEMENT;
    const offset = stream.offset / stream.data.BYTES_PER_ELEMENT + vertex * stride + axis;
    let value = stream.data[offset];
    if (value === undefined || !Number.isFinite(value))
        throw new RangeError('Shadow caster stream values must be finite');
    if (stream.normalized) {
        const data = stream.data;
        if (data instanceof Int8Array) value = Math.max(-1, value / 127);
        else if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) value /= 255;
        else if (data instanceof Int16Array) value = Math.max(-1, value / 32767);
        else if (data instanceof Uint16Array) value /= 65535;
        else if (data instanceof Int32Array) value = Math.max(-1, value / 2147483647);
        else if (data instanceof Uint32Array) value /= 4294967295;
    }
    return value;
}

/**
 * Renderer-owned CPU bound recipes. Vertex streams are scanned only after a data/layout revision;
 * animated poses combine cached intervals and at most 128 joint boxes once per scene preparation.
 * The same conservative bounds serve every directional cascade and light in that preparation.
 */
export class ShadowCasterBounds {
    readonly #streams = new WeakMap<GeometryData, StreamBounds>();
    readonly #geometryRevisions = new WeakMap<Geometry, number>();
    readonly #skins = new WeakMap<Geometry, SkinInfluences>();
    readonly #meshes = new WeakMap<
        Mesh,
        { epoch: number; readonly bounds: ShadowCasterBoundsValue }
    >();
    readonly #matrix = new Matrix4();
    readonly #morphed = emptyBounds();
    #epoch = 0;

    begin(): void {
        this.#epoch++;
    }

    get(mesh: Mesh): Readonly<ShadowCasterBoundsValue> {
        let cached = this.#meshes.get(mesh);
        if (cached?.epoch === this.#epoch) return cached.bounds;
        if (cached === undefined) {
            cached = { epoch: -1, bounds: emptyBounds() };
            this.#meshes.set(mesh, cached);
        }
        const geometry = mesh.geometry;
        const vertices = geometry?.vertices;
        if (!geometry || !vertices) throw new TypeError('Shadow caster requires position data');
        const forceBounds = this.#geometryRevisions.get(geometry) !== geometry.revision;
        this.#geometryRevisions.set(geometry, geometry.revision);
        const base = this.streamBounds(vertices, forceBounds);
        const result = cached.bounds;
        reset(result);
        if (geometry.positionDecodeMat !== null) {
            this.#matrix.fromArray(geometry.positionDecodeMat);
            this.transformBounds(base, this.#matrix, result);
        } else Object.assign(result, base);
        if (geometry instanceof MorphGeometry && geometry.targets?.['vertices'] !== undefined) {
            let kinds = 0;
            for (const kind in geometry.targets) {
                if (Object.hasOwn(geometry.targets, kind)) kinds++;
            }
            const targetCount = Math.min(
                geometry.targets['vertices'].length,
                Math.floor(8 / kinds)
            );
            for (let slot = 0; slot < targetCount; slot++) {
                const weight = geometry.weights[slot] ?? 0;
                if (!Number.isFinite(weight))
                    throw new RangeError('Shadow morph weights must be finite');
                if (weight === 0) continue;
                const target = geometry.getMorphTarget('vertices', slot);
                if (!target || count(target, 3) < count(vertices, 3))
                    throw new RangeError('Shadow morph target must cover every vertex');
                const delta = this.streamBounds(target, forceBounds);
                result.xMin += Math.min(delta.xMin * weight, delta.xMax * weight);
                result.xMax += Math.max(delta.xMin * weight, delta.xMax * weight);
                result.yMin += Math.min(delta.yMin * weight, delta.yMax * weight);
                result.yMax += Math.max(delta.yMin * weight, delta.yMax * weight);
                result.zMin += Math.min(delta.zMin * weight, delta.zMax * weight);
                result.zMax += Math.max(delta.zMin * weight, delta.zMax * weight);
            }
        }
        if (mesh instanceof SkinnedMesh) {
            const joints = mesh.getJointMat();
            const influences = this.skinInfluences(
                geometry,
                joints.length / 16,
                count(vertices, 3)
            );
            Object.assign(this.#morphed, result);
            reset(result);
            for (const joint of influences.activeJoints) {
                this.#matrix.fromArray(joints, joint * 16);
                const matrix = this.#matrix.elements;
                if (
                    matrix[3] !== 0 ||
                    matrix[7] !== 0 ||
                    matrix[11] !== 0 ||
                    Math.abs(matrix[15] - 1) > 0.000001
                )
                    throw new RangeError('Shadow skinning requires finite affine joint matrices');
                this.transformBounds(this.#morphed, this.#matrix, result);
            }
        }
        if (
            !Number.isFinite(result.xMin) ||
            !Number.isFinite(result.xMax) ||
            !Number.isFinite(result.yMin) ||
            !Number.isFinite(result.yMax) ||
            !Number.isFinite(result.zMin) ||
            !Number.isFinite(result.zMax)
        )
            throw new RangeError('Shadow caster bounds must remain finite');
        cached.epoch = this.#epoch;
        return result;
    }

    private streamBounds(stream: GeometryData, force = false): Readonly<ShadowCasterBoundsValue> {
        const previous = this.#streams.get(stream);
        if (!force && previous !== undefined && matches(previous.snapshot, stream))
            return previous.bounds;
        const vertexCount = count(stream, 3);
        const bounds = emptyBounds();
        for (let vertex = 0; vertex < vertexCount; vertex++)
            include(
                bounds,
                component(stream, vertex, 0),
                component(stream, vertex, 1),
                component(stream, vertex, 2)
            );
        this.#streams.set(stream, { snapshot: snapshot(stream), bounds });
        return bounds;
    }

    private skinInfluences(
        geometry: Geometry,
        jointCount: number,
        vertexCount: number
    ): SkinInfluences {
        const indices = geometry.skinIndices;
        const weights = geometry.skinWeights;
        if (
            !indices ||
            !weights ||
            indices.normalized ||
            !Number.isSafeInteger(jointCount) ||
            jointCount < 1 ||
            jointCount > 128
        )
            throw new RangeError(
                'Shadow skinning requires joint/weight streams and one to 128 joints'
            );
        const previous = this.#skins.get(geometry);
        if (
            previous?.jointCount === jointCount &&
            previous.vertexCount === vertexCount &&
            matches(previous.indices, indices) &&
            matches(previous.weights, weights)
        )
            return previous;
        if (count(indices, 4) < vertexCount || count(weights, 4) < vertexCount)
            throw new RangeError('Shadow skin streams must cover every vertex');
        const active = new Set<number>();
        for (let vertex = 0; vertex < vertexCount; vertex++) {
            let sum = 0;
            for (let axis = 0; axis < 4; axis++) {
                const index = component(indices, vertex, axis);
                const weight = component(weights, vertex, axis);
                if (!Number.isSafeInteger(index) || index < 0 || index >= jointCount || weight < 0)
                    throw new RangeError('Shadow skin index or weight is invalid');
                if (weight > 0) active.add(index);
                sum += weight;
            }
            // The canonical vertex shader preserves the summed homogeneous W, so the
            // final clip divide normalizes every positive sum, including quantized weights.
            if (sum <= 0) throw new RangeError('Shadow skin weights must have a positive sum');
        }
        const result = {
            indices: snapshot(indices),
            weights: snapshot(weights),
            jointCount,
            vertexCount,
            activeJoints: [...active]
        };
        this.#skins.set(geometry, result);
        return result;
    }

    private transformBounds(
        bounds: Readonly<ShadowCasterBoundsValue>,
        matrix: Matrix4,
        output: ShadowCasterBoundsValue
    ): void {
        for (let corner = 0; corner < 8; corner++) {
            const x = (corner & 1) === 0 ? bounds.xMin : bounds.xMax;
            const y = (corner & 2) === 0 ? bounds.yMin : bounds.yMax;
            const z = (corner & 4) === 0 ? bounds.zMin : bounds.zMax;
            const values = matrix.elements;
            // Canonical position decode consumes xyz without a homogeneous divide. Skin
            // matrices are validated affine, so this also preserves their exact convention.
            include(
                output,
                x * values[0] + y * values[4] + z * values[8] + values[12],
                x * values[1] + y * values[5] + z * values[9] + values[13],
                x * values[2] + y * values[6] + z * values[10] + values[14]
            );
        }
    }
}
