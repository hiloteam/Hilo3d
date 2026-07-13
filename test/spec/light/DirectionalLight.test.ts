import { describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import { getLightShadow } from '../../../src/renderer/webgl/shadow/LightShadowRegistry';
import {
    releaseWebGLShadowMaps,
    renderWebGLShadowMaps
} from '../../../src/renderer/webgl/WebGLShadowMapManager';
import { createHilo3dEnvironment, testEnv } from '../../setup';

const DirectionalLight = Hilo3d.DirectionalLight;
const beginCameraPass = (camera: Hilo3d.Camera): void => {
    Hilo3d.semantic.setCamera(camera);
};

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
        const manager = new Hilo3d.LightManager().addLight(light);
        renderWebGLShadowMaps(manager, env.renderer, env.camera, beginCameraPass);
        expect(manager.getDirectionalInfo(env.camera).shadowMap).toHaveLength(1);
        expect(Reflect.has(light, 'lightShadow')).toBe(false);
        expect(Reflect.has(light, 'createShadowMap')).toBe(false);
    });

    it('uses shadow debug only for a camera helper', () => {
        const light = new DirectionalLight({ shadow: { debug: true, width: 32, height: 32 } });
        const env = createHilo3dEnvironment();
        const manager = new Hilo3d.LightManager().addLight(light);

        renderWebGLShadowMaps(manager, env.renderer, env.camera, beginCameraPass);

        expect(light.children.some(child => child instanceof Hilo3d.CameraHelper)).toBe(true);
    });

    it('scopes shadow runtimes per renderer and releases inactive debug helpers', () => {
        const first = createHilo3dEnvironment(true);
        const second = createHilo3dEnvironment(true);
        const light = new DirectionalLight({ shadow: { debug: true, width: 16, height: 16 } });
        const firstManager = new Hilo3d.LightManager().addLight(light);
        const secondManager = new Hilo3d.LightManager().addLight(light);

        renderWebGLShadowMaps(firstManager, first.renderer, first.camera, beginCameraPass);
        renderWebGLShadowMaps(secondManager, second.renderer, second.camera, beginCameraPass);

        const firstRuntime = getLightShadow(firstManager, light);
        const secondRuntime = getLightShadow(secondManager, light);
        expect(firstRuntime).not.toBeNull();
        expect(secondRuntime).not.toBeNull();
        expect(firstRuntime).not.toBe(secondRuntime);
        expect(light.children.filter(child => child instanceof Hilo3d.CameraHelper)).toHaveLength(
            2
        );

        firstManager.shadowEnabled = false;
        renderWebGLShadowMaps(firstManager, first.renderer, first.camera, beginCameraPass);
        expect(getLightShadow(firstManager, light)).toBeNull();
        expect(firstRuntime?.framebuffer).toBeNull();
        expect(light.children.filter(child => child instanceof Hilo3d.CameraHelper)).toHaveLength(
            1
        );

        releaseWebGLShadowMaps(secondManager);
        expect(getLightShadow(secondManager, light)).toBeNull();
        expect(light.children).toEqual([]);
    });

    it('restores renderer state when planar shadow rendering fails', () => {
        const { renderer, camera, state } = testEnv;
        const mesh = new Hilo3d.Mesh({
            geometry: new Hilo3d.BoxGeometry(),
            material: new Hilo3d.Material({ castShadows: true })
        });
        mesh.frustumTest = false;
        const light = new DirectionalLight({ shadow: { width: 32, height: 32 } });
        const previousForceMaterial = new Hilo3d.Material();
        const previousFramebuffer = state.currentFramebuffer;
        renderer.forceMaterial = previousForceMaterial;
        renderer.renderList.reset();
        renderer.renderList.addMesh(mesh, camera);
        Hilo3d.semantic.setCamera(camera);
        const viewport = vi.spyOn(renderer, 'viewport');
        const renderMesh = vi.spyOn(renderer, 'renderMesh').mockImplementation(() => {
            throw new Error('planned planar shadow render failure');
        });

        try {
            expect(() => {
                renderWebGLShadowMaps(
                    new Hilo3d.LightManager().addLight(light),
                    renderer,
                    camera,
                    beginCameraPass
                );
            }).toThrow('planned planar shadow render failure');
            expect(renderer.forceMaterial).toBe(previousForceMaterial);
            expect(state.currentFramebuffer).toBe(previousFramebuffer);
            expect(Hilo3d.semantic.camera).toBe(camera);
            expect(viewport).toHaveBeenCalled();
        } finally {
            renderMesh.mockRestore();
            viewport.mockRestore();
            renderer.forceMaterial = null;
            renderer.renderList.reset();
        }
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
