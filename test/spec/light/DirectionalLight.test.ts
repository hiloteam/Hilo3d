import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import { createHilo3dEnvironment } from '../../setup';

const DirectionalLight = Hilo3d.DirectionalLight;

describe('DirectionalLight', () => {
    it('create', () => {
        const light = new DirectionalLight();
        expect(light.isDirectionalLight).toBe(true);
        expect(light.className).toBe('DirectionalLight');
        expect(light.direction.isVector3).toBe(true);
    });

    it('createShadowMap', () => {
        const light = new DirectionalLight({
            shadow: {
                minBias: 0.01,
                maxBias: 0.1
            }
        });

        const env = createHilo3dEnvironment();
        light.createShadowMap(env.renderer, env.camera);
        expect(light.lightShadow?.isLightShadow).toBe(true);
    });

    it('getWorldDirection', () => {
        const light = new DirectionalLight({
            direction: new Hilo3d.Vector3(0, 0.5, 0)
        });
        expect(light.getWorldDirection().elements).toEqual(new Float32Array([0, 1, 0]));
    });

    it('getViewDirection', () => {
        const camera = new Hilo3d.Camera({
            rotationX: 180
        });
        camera.updateViewMatrix();

        const light = new DirectionalLight({
            direction: new Hilo3d.Vector3(0, 0.5, 0)
        });
        expect(light.getViewDirection(camera).equals(new Hilo3d.Vector3(0, -1, 0))).toBe(true);
    });
});
