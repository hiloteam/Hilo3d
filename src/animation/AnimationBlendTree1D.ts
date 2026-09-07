import { animationItem } from './animationArray';
import type { AnimationClip } from './AnimationClip';

/** A threshold on a scalar parameter, such as character speed in metres per second. */
export interface AnimationBlendSample {
    threshold: number;
    clip: AnimationClip;
}
/** Immutable 1D motion asset. Adjacent clips share normalized gait phase, including unequal durations. */
export class AnimationBlendTree1D {
    readonly name: string;
    readonly parameter: string;
    readonly samples: readonly AnimationBlendSample[];
    constructor(name: string, parameter: string, samples: readonly AnimationBlendSample[]) {
        if (samples.length < 2) throw new RangeError('A blend tree needs at least two samples.');
        this.name = name;
        this.parameter = parameter;
        const sorted = samples
            .map(sample => Object.freeze({ ...sample }))
            .sort((a, b) => a.threshold - b.threshold);
        for (let i = 0; i < sorted.length; i++) {
            const sample = animationItem(sorted, i);
            if (
                !Number.isFinite(sample.threshold) ||
                (i > 0 && sample.threshold === animationItem(sorted, i - 1).threshold)
            ) {
                throw new RangeError('Blend thresholds must be finite and unique.');
            }
        }
        this.samples = Object.freeze(sorted);
        Object.freeze(this);
    }
}
/** A state can play one clip or a continuously parameterized locomotion blend. */
export type AnimationMotion = AnimationClip | AnimationBlendTree1D;
