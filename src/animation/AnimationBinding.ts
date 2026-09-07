import { animationItem } from './animationArray';
import { quat } from 'gl-matrix';
import type Node from '../core/Node';
import Mesh from '../core/Mesh';
import MorphGeometry from '../geometry/MorphGeometry';
import type { AnimationProperty, AnimationTrack } from './AnimationTrack';

/** Custom numeric channel adapter. Capture the reference value once; write receives reusable storage. */
export interface AnimationPropertyBinding {
    reference: ArrayLike<number>;
    write: (value: Float32Array) => void;
}
/** Resolve application channels while binding a character, never during pose evaluation. */
export type AnimationBindingResolver = (
    node: Node,
    property: AnimationProperty,
    components: number
) => AnimationPropertyBinding;

/** @internal Per-instance storage and pre-resolved property writer. */
export class PoseBinding {
    readonly reference: Float32Array;
    readonly value: Float32Array;
    readonly sum: Float32Array;
    readonly sample: Float32Array;
    readonly rotation: boolean;
    readonly write: (value: Float32Array) => void;
    readonly delta = new Float32Array(4);
    readonly identity = new Float32Array([0, 0, 0, 1]);
    total = 0;
    constructor(
        readonly node: Node,
        readonly track: AnimationTrack,
        resolver?: AnimationBindingResolver
    ) {
        this.rotation = track.property === 'rotation';
        const n = track.components;
        let adapter: AnimationPropertyBinding;
        switch (track.property) {
            case 'translation':
                adapter = {
                    reference: [node.x, node.y, node.z],
                    write: value => {
                        node.setPosition(
                            animationItem(value, 0),
                            animationItem(value, 1),
                            animationItem(value, 2)
                        );
                    }
                };
                break;
            case 'scale':
                adapter = {
                    reference: [node.scaleX, node.scaleY, node.scaleZ],
                    write: value => {
                        node.setScale(
                            animationItem(value, 0),
                            animationItem(value, 1),
                            animationItem(value, 2)
                        );
                    }
                };
                break;
            case 'rotation':
                adapter = {
                    reference: node.quaternion.elements,
                    write: value => {
                        node.quaternion.fromArray(value);
                    }
                };
                break;
            case 'weights': {
                const geometries: MorphGeometry[] = [];
                node.traverse(child => {
                    if (
                        child instanceof Mesh &&
                        child.geometry instanceof MorphGeometry &&
                        !geometries.includes(child.geometry)
                    )
                        geometries.push(child.geometry);
                });
                if (!geometries.length)
                    throw new RangeError(`No morph geometry for ${track.target}.`);
                const reference = new Float32Array(n);
                const first = animationItem(geometries, 0);
                for (let i = 0; i < n; i++) reference[i] = first.weights[i] ?? 0;
                const sorted = new Float32Array(n);
                const indices = Array.from({ length: n }, (_, index) => index);
                adapter = {
                    reference,
                    write: value => {
                        sorted.set(value);
                        for (let i = 0; i < n; i++) indices[i] = i;
                        // Stable absolute-weight ranking preserves negative morph influences.
                        for (let i = 1; i < n; i++) {
                            const weight = animationItem(sorted, i);
                            const index = animationItem(indices, i);
                            let j = i;
                            while (
                                j > 0 &&
                                Math.abs(animationItem(sorted, j - 1)) < Math.abs(weight)
                            ) {
                                sorted[j] = animationItem(sorted, j - 1);
                                indices[j] = animationItem(indices, j - 1);
                                j--;
                            }
                            sorted[j] = weight;
                            indices[j] = index;
                        }
                        for (const geometry of geometries) geometry.update(sorted, indices);
                    }
                };
                break;
            }
            default:
                if (!resolver)
                    throw new RangeError(
                        `Custom animation binding required for ${track.property}.`
                    );
                adapter = resolver(node, track.property, n);
        }
        if (adapter.reference.length !== n)
            throw new RangeError('Animation reference component count mismatch.');
        this.reference = Float32Array.from(adapter.reference);
        for (const value of this.reference)
            if (!Number.isFinite(value))
                throw new RangeError('Animation reference must be finite.');
        if (this.rotation) quat.normalize(this.reference, this.reference);
        this.value = this.reference.slice();
        this.sum = new Float32Array(n);
        this.sample = new Float32Array(n);
        this.write = adapter.write;
    }
    accumulate(weight: number): void {
        let sign = 1;
        if (this.rotation) {
            let dot = 0;
            for (let i = 0; i < 4; i++)
                dot += animationItem(this.reference, i) * animationItem(this.sample, i);
            if (dot < 0) sign = -1;
        }
        for (let i = 0; i < this.sum.length; i++)
            this.sum[i] =
                animationItem(this.sum, i) + animationItem(this.sample, i) * weight * sign;
        this.total += weight;
    }
    blend(weight: number, additive: boolean): void {
        if (this.total === 0 || weight === 0) return;
        const remainder = Math.max(0, 1 - this.total);
        const divisor = Math.max(1, this.total);
        const lower = additive ? this.reference : this.value;
        let lowerSign = 1;
        if (this.rotation) {
            let dot = 0;
            for (let i = 0; i < 4; i++)
                dot += animationItem(this.reference, i) * animationItem(lower, i);
            if (dot < 0) lowerSign = -1;
        }
        for (let i = 0; i < this.sum.length; i++)
            this.sum[i] =
                (animationItem(this.sum, i) + animationItem(lower, i) * remainder * lowerSign) /
                divisor;
        if (this.rotation) {
            if (
                Math.hypot(
                    animationItem(this.sum, 0),
                    animationItem(this.sum, 1),
                    animationItem(this.sum, 2),
                    animationItem(this.sum, 3)
                ) < 1e-8
            )
                this.sum.set(this.reference);
            quat.normalize(this.sum, this.sum);
            if (additive) {
                quat.invert(this.delta, this.reference);
                quat.multiply(this.delta, this.delta, this.sum);
                quat.slerp(this.delta, this.identity, this.delta, weight);
                quat.multiply(this.value, this.value, this.delta);
                quat.normalize(this.value, this.value);
            } else quat.slerp(this.value, this.value, this.sum, weight);
        } else
            for (let i = 0; i < this.value.length; i++) {
                this.value[i] =
                    animationItem(this.value, i) +
                    (animationItem(this.sum, i) -
                        (additive
                            ? animationItem(this.reference, i)
                            : animationItem(this.value, i))) *
                        weight;
            }
    }
}
