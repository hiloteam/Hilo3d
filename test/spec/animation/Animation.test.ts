import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const Animation = Hilo3d.Animation;

describe('Animation', () => {
    it('create', () => {
        const animation = new Animation();
        expect(animation.isAnimation).toBe(true);
        expect(animation.className).toBe('Animation');
    });
});
