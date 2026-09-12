import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../src/Hilo3d';
import { createCsmToyWeather } from './csm-toy-weather';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('CSM lightning wall-clock lifetime', () => {
    it('expires after a slow frame even with weather motion paused', () => {
        let now = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        const weather = createCsmToyWeather(new Hilo3d.Node());
        weather.setWeather('storm');
        weather.setMotion(false);
        weather.triggerLightning();
        expect(weather.lightningFlash).toBeGreaterThan(0);
        now = 2000;
        // A tiny animation delta must not stretch a wall-clock visual pulse.
        weather.tick(16);
        expect(weather.lightningFlash).toBe(0);
        weather.triggerLightning();
        expect(weather.lightningFlash).toBeGreaterThan(0);
        now = 4000;
        weather.tick(0);
        expect(weather.lightningFlash).toBe(0);
    });
});
