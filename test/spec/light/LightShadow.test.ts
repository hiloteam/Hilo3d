import { describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import { testEnv } from '../../setup';

const LightShadow = Hilo3d.LightShadow;

describe('LightShadow', () => {
    it('create', () => {
        const lightShadow = new LightShadow({
            light: new Hilo3d.DirectionalLight(),
            renderer: testEnv.renderer
        });
        expect(lightShadow.isLightShadow).toBe(true);
        expect(lightShadow.className).toBe('LightShadow');
    });

    it('createFramebuffer', () => {
        const lightShadow = new LightShadow({
            light: new Hilo3d.DirectionalLight(),
            renderer: testEnv.renderer
        });
        lightShadow.createFramebuffer();
        const framebuffer = lightShadow.framebuffer;
        if (!framebuffer) throw new Error('Expected createFramebuffer() to create a framebuffer');
        expect(framebuffer.isFramebuffer).toBe(true);
        expect(framebuffer.width).toBe(lightShadow.width);
        expect(framebuffer.height).toBe(lightShadow.height);
    });

    it('restores renderer state when planar shadow rendering fails', () => {
        const { renderer, camera, state } = testEnv;
        const mesh = new Hilo3d.Mesh({
            geometry: new Hilo3d.BoxGeometry(),
            material: new Hilo3d.Material()
        });
        mesh.frustumTest = false;
        const lightShadow = new LightShadow({
            light: new Hilo3d.DirectionalLight(),
            renderer,
            width: 32,
            height: 32
        });
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
                lightShadow.createShadowMap(camera);
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
});
