import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import { renderWebGLShadowMaps } from '../../../src/renderer/webgl/WebGLShadowMapManager';
import { createHilo3dEnvironment } from '../../setup';

const SpotLight = Hilo3d.SpotLight;
const beginCameraPass = (camera: Hilo3d.Camera): void => {
    Hilo3d.semantic.setCamera(camera);
};

describe('SpotLight', () => {
    it('create', () => {
        const light = new SpotLight({
            cutoff: 30,
            outerCutoff: 45
        });
        expect(light.isSpotLight).toBe(true);
        expect(light.className).toBe('SpotLight');
        expect(light.direction.isVector3).toBe(true);
        expect(light.constantAttenuation).toBeTypeOf('number');
        expect(light.linearAttenuation).toBeTypeOf('number');
        expect(light.quadraticAttenuation).toBeTypeOf('number');
        expect(light.outerCutoff).toBeTypeOf('number');
        expect(light.cutoff).toBeTypeOf('number');
        expect(light.outerCutoff).toBe(45);
        expect(light.cutoff).toBe(30);
    });

    it('accepts cone-angle boundary values', () => {
        const light = new SpotLight({ cutoff: 0, outerCutoff: 180 });
        expect(light.cutoff).toBe(0);
        expect(light.outerCutoff).toBe(180);
    });

    it.each([-1, 181, Number.POSITIVE_INFINITY, Number.NaN])(
        'rejects an invalid cone angle: %s',
        angle => {
            expect(() => new SpotLight({ cutoff: angle })).toThrow(RangeError);
            expect(() => new SpotLight({ outerCutoff: angle })).toThrow(RangeError);
        }
    );

    it('toInfoArray', () => {
        const light = new SpotLight({
            constantAttenuation: 0.1,
            linearAttenuation: 0.2,
            quadraticAttenuation: 0.3
        });

        const res: number[] = [];
        light.toInfoArray(res, 3);
        expect(res[3]).toBe(light.constantAttenuation);
        expect(res[4]).toBe(light.linearAttenuation);
        expect(res[5]).toBe(light.quadraticAttenuation);
    });

    it('createShadowMap', () => {
        const light = new SpotLight({
            shadow: {
                minBias: 0.01,
                maxBias: 0.1
            }
        });

        const env = createHilo3dEnvironment();
        const manager = new Hilo3d.LightManager().addLight(light);
        renderWebGLShadowMaps(manager, env.renderer, env.camera, beginCameraPass);
        expect(manager.getSpotInfo(env.camera).shadowMap).toHaveLength(1);
        expect(Reflect.has(light, 'lightShadow')).toBe(false);
        expect(Reflect.has(light, 'createShadowMap')).toBe(false);
    });

    it('getWorldDirection', () => {
        const light = new SpotLight({
            direction: new Hilo3d.Vector3(0, 0.5, 0)
        });
        expect(light.getWorldDirection().elements).toEqual(new Float32Array([0, 1, 0]));
    });

    it('getViewDirection', () => {
        const camera = new Hilo3d.Camera({
            rotationX: 180
        });
        camera.updateViewMatrix();

        const light = new SpotLight({
            direction: new Hilo3d.Vector3(0, 0.5, 0)
        });
        expect(light.getViewDirection(camera).equals(new Hilo3d.Vector3(0, -1, 0))).toBe(true);
    });
});
