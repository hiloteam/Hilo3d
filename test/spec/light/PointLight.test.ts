import { describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import { testEnv } from '../../setup';

const PointLight = Hilo3d.PointLight;

describe('PointLight', () => {
    it('create', () => {
        const light = new PointLight();
        expect(light.isPointLight).toBe(true);
        expect(light.className).toBe('PointLight');
        expect(light.constantAttenuation).toBeTypeOf('number');
        expect(light.linearAttenuation).toBeTypeOf('number');
        expect(light.quadraticAttenuation).toBeTypeOf('number');
    });

    it('toInfoArray', () => {
        const light = new PointLight({
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

    it('restores renderer state when cube-shadow rendering fails', () => {
        const { renderer, camera, state } = testEnv;
        const mesh = new Hilo3d.Mesh({
            geometry: new Hilo3d.BoxGeometry(),
            material: new Hilo3d.Material()
        });
        mesh.frustumTest = false;
        const light = new PointLight({
            shadow: { width: 32, height: 32 }
        });
        const previousForceMaterial = new Hilo3d.Material();
        const previousFramebuffer = state.currentFramebuffer;
        renderer.forceMaterial = previousForceMaterial;
        renderer.renderList.reset();
        renderer.renderList.addMesh(mesh, camera);
        Hilo3d.semantic.setCamera(camera);
        const viewport = vi.spyOn(renderer, 'viewport');
        const renderMesh = vi.spyOn(renderer, 'renderMesh').mockImplementation(() => {
            throw new Error('planned cube shadow render failure');
        });

        try {
            expect(() => {
                light.createShadowMap(renderer, camera);
            }).toThrow('planned cube shadow render failure');
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
});
