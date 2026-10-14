import Mesh from '../../../core/Mesh';
import Node from '../../../core/Node';
import {
    POINTS,
    LINES,
    LINE_STRIP,
    LINE_LOOP,
    TRIANGLES,
    TRIANGLE_STRIP,
    TRIANGLE_FAN
} from '../../../constants/webgl';
import type { RenderPipelineContext } from '../RenderPipeline';
import { createStd140Layout } from '../../ubo/Std140Layout';

/** @internal One immutable-per-invocation, 16-byte std140 record at global binding 12. */
export const WEIGHTED_TRANSPARENCY_LAYOUT = createStd140Layout({ u_weightedTransparency: 'vec4' });
/** @internal Limits both finite-accumulation proof and the FP16 subnormal quantization envelope. */
export const MAX_WEIGHTED_FRAGMENT_COUNT = 1_048_576;

function primitiveCount(mesh: Mesh): number {
    const geometry = mesh.geometry;
    if (geometry === null) return 0;
    const count = geometry.indices?.count ?? geometry.vertices?.count ?? 0;
    let primitives: number;
    switch (geometry.mode) {
        case POINTS:
            primitives = count;
            break;
        case LINES:
            primitives = Math.floor(count / 2);
            break;
        case LINE_STRIP:
            primitives = Math.max(0, count - 1);
            break;
        case LINE_LOOP:
            primitives = count;
            break;
        case TRIANGLES:
            primitives = Math.floor(count / 3);
            break;
        case TRIANGLE_STRIP:
        case TRIANGLE_FAN:
            primitives = Math.max(0, count - 2);
            break;
        default:
            throw new TypeError('Weighted transparency cannot bound this primitive topology');
    }
    return primitives * mesh.instanceCount;
}

/** @internal Conservative one-sample depth complexity including every planner batch member. */
export function weightedFragmentBound(
    context: Pick<RenderPipelineContext, 'scene' | 'camera'>,
    maximum: number
): number {
    let count = 0;
    context.scene.traverse(node => {
        if (!node.visible) return Node.TRAVERSE_STOP_CHILDREN;
        if (
            node instanceof Mesh &&
            !node.isDestroyed &&
            node.geometry !== null &&
            node.material?.transparencyClass === 'weighted-blended' &&
            (context.camera.visibility & node.layer) !== 0 &&
            (!node.frustumTest || context.camera.isMeshVisible(node))
        ) {
            count += primitiveCount(node);
            if (!Number.isSafeInteger(count) || count > maximum) {
                throw new RangeError('Weighted transparency exceeds maxFragmentCount');
            }
        }
        return undefined;
    });
    return count;
}

/** @internal N and every scale are dyadic; all bins share the exact same weighted-color formula. */
export function writeWeightedNormalization(count: number, output: Float32Array): void {
    const nextPowerOfTwo = 2 ** Math.ceil(Math.log2(Math.max(1, count)));
    const limit = 16384 / nextPowerOfTwo;
    const weightedRadianceBound = 8388608; // 65536 * 128; signed finite FP16 radiance, weight <= 128.
    const middleRange = 2 ** Math.round(Math.log2(Math.sqrt(weightedRadianceBound * limit)));
    output[0] = limit;
    output[1] = Math.min(1, limit / middleRange);
    output[2] = Math.min(1, limit / weightedRadianceBound);
    output[3] = 128;
}
