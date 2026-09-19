import { requireNumber } from '../../../math/numberArray';
import { RAY_BVH_LEAF_FLAG, RAY_BVH_NODE_FLOATS, RAY_TRIANGLE_FLOATS } from './SceneGeometry';

export interface SceneBVH {
    readonly triangles: Float32Array;
    readonly nodes: Float32Array;
    /** Original scene triangle index to packed triangle index. */
    readonly remap: Uint32Array;
    readonly nodeCount: number;
    readonly depth: number;
}

interface BuildNode {
    readonly start: number;
    readonly count: number;
    left: number;
    right: number;
}

/** Deterministic median splits guarantee bounded traversal even for coincident centroids. */
export function buildSceneBVH(input: Float32Array, triangleCount: number): SceneBVH {
    if (triangleCount === 0) {
        return {
            triangles: new Float32Array(RAY_TRIANGLE_FLOATS),
            nodes: new Float32Array(RAY_BVH_NODE_FLOATS),
            remap: new Uint32Array(0),
            nodeCount: 0,
            depth: 0
        };
    }
    const order = Array.from({ length: triangleCount }, (_value, index) => index);
    const centroids = new Float64Array(triangleCount * 3);
    for (let triangle = 0; triangle < triangleCount; triangle++) {
        for (let axis = 0; axis < 3; axis++) {
            const offset = triangle * RAY_TRIANGLE_FLOATS + axis;
            centroids[triangle * 3 + axis] =
                (requireNumber(input, offset) +
                    requireNumber(input, offset + 4) +
                    requireNumber(input, offset + 8)) /
                3;
        }
    }
    const buildNodes: BuildNode[] = [];
    let maximumDepth = 0;
    const split = (start: number, count: number, depth: number): number => {
        maximumDepth = Math.max(maximumDepth, depth);
        const nodeIndex = buildNodes.length;
        const node: BuildNode = { start, count, left: -1, right: -1 };
        buildNodes.push(node);
        if (count <= 4) return nodeIndex;
        let axis = 0;
        let widest = -1;
        for (let candidate = 0; candidate < 3; candidate++) {
            let low = Infinity;
            let high = -Infinity;
            for (let index = start; index < start + count; index++) {
                const value = requireNumber(centroids, requireNumber(order, index) * 3 + candidate);
                low = Math.min(low, value);
                high = Math.max(high, value);
            }
            if (high - low > widest) {
                widest = high - low;
                axis = candidate;
            }
        }
        const sorted = order
            .slice(start, start + count)
            .sort(
                (a, b) =>
                    requireNumber(centroids, a * 3 + axis) -
                        requireNumber(centroids, b * 3 + axis) || a - b
            );
        for (let index = 0; index < sorted.length; index++)
            order[start + index] = requireNumber(sorted, index);
        const leftCount = Math.floor(count / 2);
        node.left = split(start, leftCount, depth + 1);
        node.right = split(start + leftCount, count - leftCount, depth + 1);
        return nodeIndex;
    };
    split(0, triangleCount, 1);
    if (maximumDepth > 32) throw new RangeError('DDGI BVH exceeds the shader traversal stack');
    const triangles = new Float32Array(triangleCount * RAY_TRIANGLE_FLOATS);
    const remap = new Uint32Array(triangleCount);
    for (let index = 0; index < triangleCount; index++) {
        const original = requireNumber(order, index);
        remap[original] = index;
        triangles.set(
            input.subarray(original * RAY_TRIANGLE_FLOATS, (original + 1) * RAY_TRIANGLE_FLOATS),
            index * RAY_TRIANGLE_FLOATS
        );
    }
    const nodes = new Float32Array(buildNodes.length * RAY_BVH_NODE_FLOATS);
    const metadata = new Uint32Array(nodes.buffer);
    for (let index = 0; index < buildNodes.length; index++) {
        const node = buildNodes[index];
        if (!node) throw new RangeError('DDGI BVH builder lost a node');
        metadata[index * RAY_BVH_NODE_FLOATS + 3] = node.left < 0 ? node.start : node.left;
        metadata[index * RAY_BVH_NODE_FLOATS + 7] =
            node.left < 0 ? RAY_BVH_LEAF_FLAG | node.count : node.right;
    }
    refitSceneBVH(nodes, triangles, buildNodes.length);
    return { triangles, nodes, remap, nodeCount: buildNodes.length, depth: maximumDepth };
}

/** Refit preserves primitive identities and topology; reverse preorder visits children first. */
export function refitSceneBVH(
    nodes: Float32Array,
    triangles: Float32Array,
    nodeCount: number,
    previousNodes?: Float32Array
): readonly number[] {
    const metadata = new Uint32Array(nodes.buffer, nodes.byteOffset, nodes.length);
    const previousMetadata =
        previousNodes === undefined
            ? null
            : new Uint32Array(previousNodes.buffer, previousNodes.byteOffset, previousNodes.length);
    const dirtyNodes: number[] = [];
    for (let node = nodeCount - 1; node >= 0; node--) {
        const offset = node * RAY_BVH_NODE_FLOATS;
        const first = requireNumber(metadata, offset + 3);
        const second = requireNumber(metadata, offset + 7);
        const leaf = (second & RAY_BVH_LEAF_FLAG) !== 0;
        for (let axis = 0; axis < 3; axis++) {
            let low = Infinity;
            let high = -Infinity;
            if (leaf) {
                const count = second & ~RAY_BVH_LEAF_FLAG;
                for (let triangle = first; triangle < first + count; triangle++) {
                    for (let corner = 0; corner < 3; corner++) {
                        const value = requireNumber(
                            triangles,
                            triangle * RAY_TRIANGLE_FLOATS + corner * 4 + axis
                        );
                        low = Math.min(low, value);
                        high = Math.max(high, value);
                    }
                }
            } else {
                low = Math.min(
                    requireNumber(nodes, first * RAY_BVH_NODE_FLOATS + axis),
                    requireNumber(nodes, second * RAY_BVH_NODE_FLOATS + axis)
                );
                high = Math.max(
                    requireNumber(nodes, first * RAY_BVH_NODE_FLOATS + axis + 4),
                    requireNumber(nodes, second * RAY_BVH_NODE_FLOATS + axis + 4)
                );
            }
            nodes[offset + axis] = low;
            nodes[offset + axis + 4] = high;
        }
        if (previousMetadata !== null) {
            for (let component = 0; component < RAY_BVH_NODE_FLOATS; component++) {
                if (metadata[offset + component] !== previousMetadata[offset + component]) {
                    dirtyNodes.push(node);
                    break;
                }
            }
        }
    }
    return dirtyNodes;
}
