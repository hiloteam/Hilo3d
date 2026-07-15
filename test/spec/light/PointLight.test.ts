import { describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import CubeTexture from '../../../src/texture/CubeTexture';
import BuiltInUniformBlockManager from '../../../src/render/BuiltInUniformBlockManager';
import WebGL2Driver from '../../../src/render/internal/webgl2/WebGL2Driver';
import { getLightShadow } from '../../../src/render/internal/webgl2/shadow/LightShadowRegistry';
import {
    releaseWebGLShadowMaps,
    renderWebGLShadowMaps
} from '../../../src/render/internal/webgl2/WebGLShadowMapManager';
import {
    getWebGLTexture,
    getWebGLTextureCache
} from '../../../src/render/internal/webgl2/WebGLState';
import { createHilo3dEnvironment, testEnv } from '../../legacy-setup';

const PointLight = Hilo3d.PointLight;

function createLegacyRenderer(width: number, height: number): WebGL2Driver {
    const renderer = new WebGL2Driver({
        domElement: document.createElement('canvas'),
        width,
        height
    });
    renderer.initContext();
    return renderer;
}

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

    it('keeps cube-shadow runtime behind the public light contract', () => {
        const light = new PointLight({ shadow: { width: 32, height: 32 } });
        const env = createHilo3dEnvironment();
        const manager = new Hilo3d.LightManager().addLight(light);
        renderWebGLShadowMaps(manager, env.renderer, env.camera, camera => {
            Hilo3d.semantic.setCamera(camera);
        });

        expect(manager.getPointInfo(env.camera).shadowMap).toHaveLength(1);
        expect(Reflect.has(light, 'lightShadow')).toBe(false);
        expect(Reflect.has(light, 'createShadowMap')).toBe(false);
    });

    it('applies point-shadow clipping options and range on every WebGL2 cube pass', () => {
        const env = createHilo3dEnvironment();
        env.camera.near = 0.1;
        env.camera.far = 100;
        const light = new PointLight({
            range: 20,
            shadow: { width: 16, height: 16, cameraInfo: { near: 0.5 } }
        });
        const manager = new Hilo3d.LightManager().addLight(light);

        try {
            renderWebGLShadowMaps(manager, env.renderer, env.camera, camera => {
                Hilo3d.semantic.setCamera(camera);
            });
            const runtime = getLightShadow(manager, light);
            expect(runtime?.camera).toMatchObject({ near: 0.5, far: 20, fov: 90, aspect: 1 });

            if (!light.shadow?.cameraInfo) throw new Error('Expected point shadow cameraInfo');
            light.shadow.cameraInfo.far = 12;
            renderWebGLShadowMaps(manager, env.renderer, env.camera, camera => {
                Hilo3d.semantic.setCamera(camera);
            });
            expect(runtime?.camera).toMatchObject({ near: 0.5, far: 12, fov: 90, aspect: 1 });

            Reflect.set(light.shadow.cameraInfo, 'fov', 45);
            expect(() => {
                renderWebGLShadowMaps(manager, env.renderer, env.camera, camera => {
                    Hilo3d.semantic.setCamera(camera);
                });
            }).toThrow(/cannot override the six canonical cube-face cameras/);
        } finally {
            releaseWebGLShadowMaps(manager);
        }
    });

    it('creates a square native cube attachment for a non-square renderer', () => {
        const camera = new Hilo3d.PerspectiveCamera();
        const renderer = createLegacyRenderer(96, 64);
        const light = new PointLight({ shadow: {} });
        const manager = new Hilo3d.LightManager().addLight(light);

        try {
            renderWebGLShadowMaps(manager, renderer, camera, shadowCamera => {
                Hilo3d.semantic.setCamera(shadowCamera);
            });
            const runtime = getLightShadow(manager, light);
            const framebuffer = runtime?.framebuffer;
            const texture = framebuffer?.texture;
            expect(framebuffer?.width).toBe(64);
            expect(framebuffer?.height).toBe(64);
            expect(texture).toBeInstanceOf(CubeTexture);
            expect(framebuffer?.colorAttachmentInfos[0]?.texture).toBe(texture);
            if (!framebuffer || !(texture instanceof CubeTexture)) {
                throw new Error('Expected an initialized point-light cube shadow framebuffer.');
            }

            const glTexture = getWebGLTexture(renderer.state, texture);
            framebuffer.bind();
            try {
                expect(
                    renderer.gl.getFramebufferAttachmentParameter(
                        renderer.gl.FRAMEBUFFER,
                        renderer.gl.COLOR_ATTACHMENT0,
                        renderer.gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE
                    )
                ).toBe(renderer.gl.TEXTURE);
                expect(
                    renderer.gl.getFramebufferAttachmentParameter(
                        renderer.gl.FRAMEBUFFER,
                        renderer.gl.COLOR_ATTACHMENT0,
                        renderer.gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME
                    )
                ).toBe(glTexture);
            } finally {
                framebuffer.unbind();
            }
        } finally {
            releaseWebGLShadowMaps(manager);
            renderer.destroy();
        }
    });

    it('refreshes CameraBlock for all six cube faces and renders without WebGL errors', () => {
        const camera = new Hilo3d.PerspectiveCamera({
            near: 0.1,
            far: 100,
            aspect: 1,
            fov: 60,
            z: 4
        });
        const scene = new Hilo3d.Node();
        const renderer = createLegacyRenderer(32, 32);
        const light = new PointLight({ shadow: { width: 16, height: 16 } });
        const mesh = new Hilo3d.Mesh({
            geometry: new Hilo3d.BoxGeometry(),
            material: new Hilo3d.BasicMaterial({ lightType: 'NONE', castShadows: true }),
            frustumTest: false,
            z: -2
        });
        scene.addChild(light).addChild(mesh);

        const beginPass = vi.spyOn(BuiltInUniformBlockManager.prototype, 'beginPass');

        try {
            expect(renderer.gl.getError()).toBe(renderer.gl.NO_ERROR);
            renderer.render(scene, camera, true);

            const shadowPasses = beginPass.mock.calls.filter(
                ([passCamera]) => passCamera !== camera
            );
            expect(shadowPasses).toHaveLength(6);
            expect(shadowPasses.map(([, viewport]) => viewport)).toEqual(
                Array.from({ length: 6 }, () => [0, 0, 16, 16])
            );
            expect(beginPass.mock.calls.at(-1)?.[0]).toBe(camera);
            expect(beginPass.mock.calls.at(-1)?.[1]).toEqual([0, 0, 32, 32]);
            expect(renderer.gl.getError()).toBe(renderer.gl.NO_ERROR);
        } finally {
            beginPass.mockRestore();
            renderer.destroy();
        }
    });

    it('recovers transactionally after one incomplete cube framebuffer allocation', () => {
        const { renderer, camera, gl } = testEnv;
        const light = new PointLight({ shadow: { width: 16, height: 16 } });
        const manager = new Hilo3d.LightManager().addLight(light);
        const checkFramebufferStatus = vi
            .spyOn(gl, 'checkFramebufferStatus')
            .mockReturnValueOnce(gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT);
        renderer.renderList.reset();

        try {
            expect(() => {
                renderWebGLShadowMaps(manager, renderer, camera, activeCamera => {
                    Hilo3d.semantic.setCamera(activeCamera);
                });
            }).toThrow(
                `Framebuffer is incomplete (status ${String(gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT)})`
            );
            const runtime = getLightShadow(manager, light);
            const failedTexture = runtime?.framebuffer?.texture;
            expect(runtime?.framebuffer?.framebuffer).toBeNull();
            expect(failedTexture).toBeInstanceOf(CubeTexture);
            expect(runtime?.framebuffer?.colorAttachmentInfos[0]?.texture).toBe(failedTexture);
            if (!(failedTexture instanceof CubeTexture)) {
                throw new Error('Cube shadow recovery did not retain its logical texture');
            }
            expect(getWebGLTextureCache(renderer.state).get(failedTexture.id)).toBeUndefined();

            expect(() => {
                renderWebGLShadowMaps(manager, renderer, camera, activeCamera => {
                    Hilo3d.semantic.setCamera(activeCamera);
                });
            }).not.toThrow();
            expect(runtime?.framebuffer?.texture).toBe(failedTexture);
            expect(gl.isTexture(getWebGLTexture(renderer.state, failedTexture))).toBe(true);
            expect(checkFramebufferStatus).toHaveBeenCalledTimes(2);
        } finally {
            renderer.renderList.reset();
            releaseWebGLShadowMaps(manager);
        }
    });

    it('restores renderer state when cube-shadow rendering fails', () => {
        const camera = new Hilo3d.PerspectiveCamera({ near: 0.1, far: 100, z: 4 });
        const scene = new Hilo3d.Node();
        const renderer = createLegacyRenderer(32, 32);
        const { state } = renderer;
        const mesh = new Hilo3d.Mesh({
            geometry: new Hilo3d.BoxGeometry(),
            material: new Hilo3d.BasicMaterial({ castShadows: true }),
            z: -2
        });
        mesh.frustumTest = false;
        const light = new PointLight({
            shadow: { width: 32, height: 32 }
        });
        scene.addChild(light).addChild(mesh);
        const previousForceMaterial = new Hilo3d.Material();
        const previousFramebuffer = state.currentFramebuffer;
        renderer.forceMaterial = previousForceMaterial;
        Hilo3d.semantic.setCamera(camera);
        const beginPass = vi.spyOn(BuiltInUniformBlockManager.prototype, 'beginPass');
        const viewport = vi.spyOn(renderer, 'viewport');
        const renderMesh = vi.spyOn(renderer, 'renderMesh').mockImplementation(() => {
            throw new Error('planned cube shadow render failure');
        });

        try {
            expect(() => {
                renderer.render(scene, camera, true);
            }).toThrow('planned cube shadow render failure');
            expect(renderer.forceMaterial).toBe(previousForceMaterial);
            expect(state.currentFramebuffer).toBe(previousFramebuffer);
            expect(Hilo3d.semantic.camera).toBe(camera);
            expect(beginPass.mock.calls.at(-1)?.[0]).toBe(camera);
            expect(viewport).toHaveBeenCalled();
        } finally {
            renderMesh.mockRestore();
            viewport.mockRestore();
            beginPass.mockRestore();
            renderer.forceMaterial = null;
            renderer.destroy();
        }
    });
});
