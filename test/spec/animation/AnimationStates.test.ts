import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const AnimationStates = Hilo3d.AnimationStates;

describe('AnimationStates', () => {
    it('create', () => {
        const animationStates = new AnimationStates();
        expect(animationStates.isAnimationStates).toBe(true);
        expect(animationStates.className).toBe('AnimationStates');
    });

    it('accepts a scalar weight for a single morph target', () => {
        const geometry = new Hilo3d.MorphGeometry();
        const mesh = new Hilo3d.Mesh({ geometry });
        const animationStates = new AnimationStates({ type: 'Weights' });

        animationStates.updateNodeWeights(mesh, 0.5);

        expect(geometry.weights).toEqual([0.5]);
    });
});
