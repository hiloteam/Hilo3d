import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const LightManager = Hilo3d.LightManager;

describe('LightManager', () => {
    it('create', () => {
        const lightManager = new LightManager();
        expect(lightManager.isLightManager).toBe(true);
        expect(lightManager.className).toBe('LightManager');

        expect(lightManager.ambientLights).toBeInstanceOf(Array);
        expect(lightManager.directionalLights).toBeInstanceOf(Array);
        expect(lightManager.pointLights).toBeInstanceOf(Array);
        expect(lightManager.spotLights).toBeInstanceOf(Array);
    });

    it('getShadowMapCount & reset', () => {
        const lightManager = new LightManager();
        lightManager.addLight(
            new Hilo3d.PointLight({
                shadow: {}
            })
        );
        lightManager.addLight(new Hilo3d.PointLight());
        lightManager.addLight(
            new Hilo3d.PointLight({
                shadow: {}
            })
        );

        expect(lightManager.getShadowMapCount('POINT_LIGHTS')).toBe(2);

        lightManager.addLight(new Hilo3d.SpotLight({ shadow: {} }));
        lightManager.addLight(new Hilo3d.AreaLight());
        expect(lightManager.getShadowMapCount('SPOT_LIGHTS')).toBe(1);
        expect(lightManager.getShadowMapCount('AREA_LIGHTS')).toBe(0);

        lightManager.reset();
        expect(lightManager.getShadowMapCount('POINT_LIGHTS')).toBe(0);
    });

    it('getRenderOption', () => {
        const lightManager = new LightManager();
        expect(lightManager.getRenderOption()['HAS_LIGHT']).toBeUndefined();
        lightManager.addLight(new Hilo3d.PointLight());
        lightManager.addLight(new Hilo3d.PointLight());
        lightManager.addLight(new Hilo3d.SpotLight());
        lightManager.updateInfo(new Hilo3d.Camera());
        expect(lightManager.getRenderOption()['POINT_LIGHTS']).toBe(2);
    });
});
