import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const Tween = Hilo3d.Tween;
const Ease = Hilo3d.Tween.Ease;

describe('Tween', () => {
    let target: { x: number; y: number };

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        Tween.removeAll();
        target = { x: 0, y: 0 };
    });

    afterEach(() => {
        Tween.removeAll();
        vi.useRealTimers();
    });

    it('interpolates from and to values after its delay', () => {
        const onStart = vi.fn();
        const onComplete = vi.fn();
        Tween.fromTo(
            target,
            { x: 50, y: 50 },
            { x: 100, y: 100 },
            {
                duration: 300,
                delay: 200,
                onStart,
                onComplete
            }
        );

        vi.setSystemTime(199);
        Tween.tick();
        expect(onStart).not.toHaveBeenCalled();

        vi.setSystemTime(200);
        Tween.tick();
        expect(onStart).toHaveBeenCalledOnce();
        expect(target).toEqual({ x: 50, y: 50 });

        vi.setSystemTime(500);
        Tween.tick();
        expect(onComplete).toHaveBeenCalledOnce();
        expect(target).toEqual({ x: 100, y: 100 });
    });

    it('removes a tween through its public API', () => {
        const onUpdate = vi.fn();
        const tween = Tween.to(target, { x: 100 }, { duration: 100, onUpdate });
        Tween.remove(tween);

        vi.setSystemTime(100);
        Tween.tick();
        expect(onUpdate).not.toHaveBeenCalled();
        expect(target.x).toBe(0);
    });

    it('removes all active tweens', () => {
        const firstUpdate = vi.fn();
        const secondUpdate = vi.fn();
        Tween.to(target, { x: 100 }, { duration: 100, onUpdate: firstUpdate });
        Tween.to(target, { y: 100 }, { duration: 100, onUpdate: secondUpdate });
        Tween.removeAll();

        vi.setSystemTime(100);
        Tween.tick();
        expect(firstUpdate).not.toHaveBeenCalled();
        expect(secondUpdate).not.toHaveBeenCalled();
    });

    it('seeks using normalized public time values', () => {
        const tween = new Tween(
            target,
            { x: 0, y: 0 },
            { x: 100, y: 100 },
            {
                paused: true,
                duration: 1
            }
        );

        tween.seek(0);
        expect(target).toEqual({ x: 0, y: 0 });
        tween.seek(0.8);
        expect(target).toEqual({ x: 80, y: 80 });
        tween.seek(1);
        expect(target).toEqual({ x: 100, y: 100 });
    });

    const easeFunctions = {
        Linear: [Ease.Linear.EaseNone],
        Quad: [Ease.Quad.EaseIn, Ease.Quad.EaseOut, Ease.Quad.EaseInOut],
        Cubic: [Ease.Cubic.EaseIn, Ease.Cubic.EaseOut, Ease.Cubic.EaseInOut],
        Quart: [Ease.Quart.EaseIn, Ease.Quart.EaseOut, Ease.Quart.EaseInOut],
        Quint: [Ease.Quint.EaseIn, Ease.Quint.EaseOut, Ease.Quint.EaseInOut],
        Sine: [Ease.Sine.EaseIn, Ease.Sine.EaseOut, Ease.Sine.EaseInOut],
        Expo: [Ease.Expo.EaseIn, Ease.Expo.EaseOut, Ease.Expo.EaseInOut],
        Circ: [Ease.Circ.EaseIn, Ease.Circ.EaseOut, Ease.Circ.EaseInOut],
        Elastic: [Ease.Elastic.EaseIn, Ease.Elastic.EaseOut, Ease.Elastic.EaseInOut],
        Back: [Ease.Back.EaseIn, Ease.Back.EaseOut, Ease.Back.EaseInOut],
        Bounce: [Ease.Bounce.EaseIn, Ease.Bounce.EaseOut, Ease.Bounce.EaseInOut]
    } as const;

    for (const [name, functions] of Object.entries(easeFunctions)) {
        it(`${name} easing preserves its endpoints`, () => {
            for (const ease of functions) {
                expect(ease(0)).toBeCloseTo(0, 3);
                expect(ease(1)).toBeCloseTo(1, 3);
            }
        });
    }
});
