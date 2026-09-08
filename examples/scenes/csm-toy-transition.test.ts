import { describe, expect, it } from 'vitest';
import { CsmToyTransition } from './csm-toy-transition';

describe('CSM toy time-of-day transition', () => {
    it('holds delayed lights dark, then fades over the full duration', () => {
        const fade = new CsmToyTransition(0, 1800);
        fade.setTarget(1, 100, 600);

        expect(fade.complete).toBe(false);
        expect(fade.sample(100)).toBe(0);
        expect(fade.sample(700)).toBe(0);
        expect(fade.sample(1600)).toBeCloseTo(0.5);
        expect(fade.complete).toBe(false);
        expect(fade.sample(2500)).toBe(1);
        expect(fade.complete).toBe(true);
    });

    it('reverses from the current intensity without snapping at either switch', () => {
        const fade = new CsmToyTransition(0, 5000);
        fade.setTarget(1, 0);
        const dusk = fade.sample(2000);
        expect(dusk).toBeGreaterThan(0);
        expect(dusk).toBeLessThan(1);

        fade.setTarget(0, 2000);
        expect(fade.sample(2000)).toBe(dusk);
        const morning = fade.sample(3000);
        expect(morning).toBeGreaterThan(0);
        expect(morning).toBeLessThan(dusk);

        fade.setTarget(1, 3000);
        expect(fade.sample(3000)).toBe(morning);
        expect(fade.sample(4000)).toBeGreaterThan(morning);
        expect(fade.sample(8000)).toBe(1);
        expect(fade.complete).toBe(true);
    });

    it('does not restart an in-progress transition when the selected time is clicked again', () => {
        const fade = new CsmToyTransition(0, 5000);
        fade.setTarget(1, 0);
        fade.sample(2500);
        fade.setTarget(1, 2500);

        expect(fade.sample(5000)).toBe(1);
        expect(fade.complete).toBe(true);
    });

    it('cancels a light before its delay expires without leaving a pending fade', () => {
        const fade = new CsmToyTransition(0, 1800);
        fade.setTarget(1, 0, 3000);
        fade.setTarget(0, 1000);

        expect(fade.complete).toBe(true);
        expect(fade.sample(6000)).toBe(0);
    });
});
