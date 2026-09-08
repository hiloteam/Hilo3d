import { describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../src/Hilo3d';
import { createCsmToyNight } from './csm-toy-night';
import { createCsmToyWater } from './csm-toy-water';

function createNightScene(): {
    readonly night: ReturnType<typeof createCsmToyNight>;
    readonly lights: readonly Hilo3d.SpotLight[];
} {
    const scene = new Hilo3d.Node();
    const engine = new Hilo3d.Node().addTo(scene);
    const environment = new Hilo3d.CubeTexture();
    const night = createCsmToyNight(
        scene,
        {
            diffuseEnvMap: environment,
            specularEnvMap: environment,
            skyboxMap: environment,
            brdfLUT: new Hilo3d.Texture()
        },
        engine
    );
    const lights = [
        'ToyStreetlightStation',
        'ToyStreetlightBridge',
        'ToyStreetlightHarbor',
        'ToyTrainHeadlight',
        'ToyLighthouseBeacon'
    ].map(name => {
        const light = scene.getChildByName(name);
        if (!(light instanceof Hilo3d.SpotLight)) throw new Error(`Missing light ${name}`);
        return light;
    });
    return { night, lights };
}

describe('CSM toy dusk illumination', () => {
    it('gradually lights the town in order while scene motion is paused', () => {
        let now = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        const { night, lights } = createNightScene();
        const amounts = (): number[] => lights.map(light => light.amount);
        night.setEnabled(true);
        expect(amounts()).toEqual([0, 0, 0, 0, 0]);
        expect(night.transitionComplete).toBe(false);

        now = 900;
        night.tick(0, false);
        const early = amounts();
        expect(early[0]).toBeGreaterThan(0);
        expect(early.slice(1)).toEqual([0, 0, 0, 0]);

        now = 2100;
        night.tick(0, false);
        const middle = amounts();
        expect(middle[0]).toBeGreaterThan(early[0] ?? 0);
        expect(middle[1]).toBeGreaterThan(0);
        expect(middle[2]).toBeGreaterThan(0);
        expect(middle.slice(3)).toEqual([0, 0]);
        expect(night.transitionComplete).toBe(false);

        now = 5000;
        night.tick(0, false);
        expect(lights.every(light => light.amount > 0 && light.enabled)).toBe(true);
        expect(night.transitionComplete).toBe(true);
    });

    it('fades active lights out and can resume before they finish dimming', () => {
        let now = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        const { night, lights } = createNightScene();
        night.setEnabled(true);
        now = 5000;
        night.tick(0, false);
        const full = lights.map(light => light.amount);

        night.setEnabled(false);
        expect(lights.map(light => light.amount)).toEqual(full);
        expect(lights.every(light => light.enabled)).toBe(true);
        expect(night.transitionComplete).toBe(false);
        now = 5900;
        night.tick(0, false);
        const dimmed = lights.map(light => light.amount);
        expect(dimmed.every((amount, index) => amount > 0 && amount < (full[index] ?? 0))).toBe(
            true
        );

        night.setEnabled(true);
        expect(lights.map(light => light.amount)).toEqual(dimmed);
        now = 11_000;
        night.tick(0, false);
        expect(lights.map(light => light.amount)).toEqual(full);
        night.setEnabled(false);
        now = 13_000;
        night.tick(0, false);
        expect(lights.every(light => light.amount === 0 && !light.enabled)).toBe(true);
        expect(night.transitionComplete).toBe(true);
    });

    it('uses the same physical local-light attenuation contract as the town surfaces', () => {
        const water = createCsmToyWater();
        expect(water.material.getRenderOption()).toMatchObject({
            USE_PHYSICS_LIGHT: 1
        });
    });
});
