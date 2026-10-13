import type Mesh from '../../../core/Mesh';
import SkinnedMesh from '../../../core/SkinnedMesh';
import MorphGeometry from '../../../geometry/MorphGeometry';
import type GeometryData from '../../../geometry/GeometryData';
import { requireNumber } from '../../../math/numberArray';
import {
    countStream,
    matchesStream,
    numbersEqual,
    readComponent,
    stamp,
    type SceneGeometry,
    type StreamStamp
} from './SceneGeometry';

export interface SceneDeformation {
    readonly base: SceneGeometry;
    readonly result: SceneGeometry;
    readonly joints: Float32Array;
    readonly weights: readonly number[];
    readonly streams: readonly (StreamStamp | null)[];
}

/** Mirrors built-in GLSL: decoded positions -> active morph slots -> weighted joint matrices.
 * Bounds are rebuilt from the resulting triangles, independent of renderer culling bounds.
 */
export function deformSceneGeometry(
    mesh: Mesh,
    base: SceneGeometry,
    previous: SceneDeformation | null
): SceneDeformation | null {
    const geometry = mesh.geometry;
    if (!geometry) throw new Error('Missing DDGI geometry during deformation');
    const morph = geometry instanceof MorphGeometry ? geometry : null;
    const skin = mesh instanceof SkinnedMesh ? mesh : null;
    if (!morph && !skin) return null;
    const joints = skin ? skin.getJointMat() : new Float32Array(0);
    if (joints.length > 128 * 16 || joints.some(value => !Number.isFinite(value)))
        throw new RangeError('DDGI skinning requires up to 128 finite joint matrices');
    for (let offset = 0; offset < joints.length; offset += 16) {
        if (
            joints[offset + 3] !== 0 ||
            joints[offset + 7] !== 0 ||
            joints[offset + 11] !== 0 ||
            Math.abs(requireNumber(joints, offset + 15) - 1) > 0.000001
        )
            throw new RangeError('DDGI joint matrices must be affine');
    }
    const weights = morph ? Array.from(morph.weights) : [];
    if (weights.length > 8 || weights.some(value => !Number.isFinite(value)))
        throw new RangeError('DDGI morphing requires up to 8 finite weights');
    const kinds = morph?.targets ? Object.keys(morph.targets) : [];
    if (kinds.some(kind => kind !== 'vertices' && kind !== 'normals' && kind !== 'tangents'))
        throw new TypeError(
            'DDGI morph targets must use built-in position, normal or tangent semantics'
        );
    const maximum = kinds.length > 0 ? Math.floor(8 / kinds.length) : 0;
    const counts = kinds.map(kind => Math.min(morph?.targets?.[kind]?.length ?? 0, maximum));
    if (counts.some(count => count !== counts[0]))
        throw new RangeError(
            'DDGI requires consistent active morph target counts across semantics'
        );
    const count = counts[0] ?? 0;
    const targets: (GeometryData | null)[] = [];
    for (const kind of ['vertices', 'normals', 'tangents']) {
        for (let slot = 0; slot < count; slot++)
            targets.push(kinds.includes(kind) ? (morph?.getMorphTarget(kind, slot) ?? null) : null);
    }
    const streams = [
        skin ? geometry.skinIndices : null,
        skin ? geometry.skinWeights : null,
        ...targets
    ];
    if (skin && (!geometry.skinIndices || !geometry.skinWeights || geometry.skinIndices.normalized))
        throw new TypeError(
            'DDGI skinned meshes require unnormalized joint indices and normalized weights'
        );
    if (
        previous?.base === base &&
        numbersEqual(previous.joints, joints) &&
        numbersEqual(previous.weights, weights) &&
        previous.streams.length === streams.length &&
        streams.every((stream, index) => matchesStream(previous.streams[index], stream))
    )
        return previous;
    const vertexCount = geometry.vertices ? countStream(geometry.vertices, 3) : 0;
    for (let index = 0; index < streams.length; index++) {
        const stream = streams[index];
        if (stream && countStream(stream, index < 2 ? 4 : 3) < vertexCount)
            throw new RangeError('DDGI deformation streams must contain every source vertex');
    }
    if (morph) {
        for (let kind = 0; kind < 3; kind++) {
            const name = ['vertices', 'normals', 'tangents'][kind];
            if (name && kinds.includes(name))
                for (let slot = 0; slot < count; slot++)
                    if (!targets[kind * count + slot])
                        throw new RangeError('DDGI active morph target is missing');
        }
    }
    const vertices = base.vertices.slice();
    const skinIndices = skin ? geometry.skinIndices : null;
    const skinWeights = skin ? geometry.skinWeights : null;
    const jointMatrix = new Float32Array(16);
    for (let triangle = 0; triangle < base.triangleCount; triangle++) {
        for (let corner = 0; corner < 3; corner++) {
            const vertex = requireNumber(base.indices, triangle * 3 + corner);
            const position = triangle * 72 + corner * 4;
            for (let kind = 0; kind < 3; kind++) {
                for (let slot = 0; slot < count; slot++) {
                    const target = targets[kind * count + slot];
                    if (!target) continue;
                    const weight = weights[slot] ?? 0;
                    const offsets =
                        kind === 0
                            ? [position]
                            : kind === 1
                              ? [position + 12]
                              : [position + 48, position + 60];
                    for (const offset of offsets)
                        for (let axis = 0; axis < 3; axis++)
                            vertices[offset + axis] =
                                requireNumber(vertices, offset + axis) +
                                readComponent(target, vertex, axis) * weight;
                }
            }
            if (skinIndices && skinWeights) {
                jointMatrix.fill(0);
                let weightSum = 0;
                for (let influence = 0; influence < 4; influence++) {
                    const joint = readComponent(skinIndices, vertex, influence);
                    const weight = readComponent(skinWeights, vertex, influence);
                    if (
                        !Number.isInteger(joint) ||
                        joint < 0 ||
                        (joint + 1) * 16 > joints.length ||
                        weight < 0
                    )
                        throw new RangeError('DDGI skin joint index or weight is invalid');
                    weightSum += weight;
                    for (let component = 0; component < 16; component++)
                        jointMatrix[component] =
                            requireNumber(jointMatrix, component) +
                            requireNumber(joints, joint * 16 + component) * weight;
                }
                if (!(weightSum > 0) || !Number.isFinite(weightSum))
                    throw new RangeError('DDGI skin weights must have a finite positive sum');
                // The raster position has homogeneous w = sum(weights). Its final clip divide
                // normalizes this sum, including ordinary UNORM weight rounding. Preserve the
                // resulting world geometry instead of rejecting valid quantized skins.
                for (let component = 0; component < 16; component++)
                    jointMatrix[component] = requireNumber(jointMatrix, component) / weightSum;
                // Canonical joint_main.vert transforms positions and normals; tangents retain
                // the built-in shader's current morph-only contract.
                for (const offset of [position, position + 12]) {
                    const x = requireNumber(vertices, offset),
                        y = requireNumber(vertices, offset + 1),
                        z = requireNumber(vertices, offset + 2);
                    for (let axis = 0; axis < 3; axis++)
                        vertices[offset + axis] =
                            x * requireNumber(jointMatrix, axis) +
                            y * requireNumber(jointMatrix, axis + 4) +
                            z * requireNumber(jointMatrix, axis + 8) +
                            (offset === position ? requireNumber(jointMatrix, axis + 12) : 0);
                }
            }
        }
    }
    if (vertices.some(value => !Number.isFinite(value)))
        throw new RangeError('DDGI deformed vertices exceed finite float32 range');
    return {
        base,
        result: { ...base, vertices },
        joints: joints.slice(),
        weights,
        streams: streams.map(stream => (stream ? stamp(stream) : null))
    };
}
