import { describe, expect, it, vi } from 'vitest';
import OrthographicCamera from '../../../src/camera/OrthographicCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import PlaneGeometry from '../../../src/geometry/PlaneGeometry';
import BasicMaterial from '../../../src/material/BasicMaterial';
import Color from '../../../src/math/Color';
import Renderer from '../../../src/render/Renderer';

describe('WebGL2 native context-loss recovery', () => {
    it('signals a pre-event render failure, restores the same target and redraws matching pixels', async () => {
        const canvas = document.createElement('canvas');
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: canvas,
            width: 8,
            height: 8,
            antialias: false
        });
        const native = canvas.getContext('webgl2');
        const extension = native?.getExtension('WEBGL_lose_context');
        if (!native || !extension)
            throw new Error('Context-loss fixture requires WEBGL_lose_context');
        const scene = new Node().addChild(
            new Mesh({
                geometry: new PlaneGeometry(),
                material: new BasicMaterial({
                    lightType: 'NONE',
                    diffuse: new Color(1, 0, 0),
                    state: { depthTest: false, depthWrite: false, cullMode: 'none' }
                })
            })
        );
        const camera = new OrthographicCamera({ near: 0.1, far: 10, z: 2 });
        const target = renderer.createRenderTarget({ width: 8, height: 8 });
        const loss = vi.fn();
        const restored = vi.fn();
        const failed = vi.fn();
        renderer.on('rhiDeviceLost', loss);
        renderer.on('rhiDeviceRestored', restored);
        renderer.on('rhiDeviceRecoveryFailed', failed);
        try {
            renderer.renderToTarget(target, scene, camera);
            await renderer.waitForIdle();
            const before = (await target.readColorAttachment()).data.slice();
            expect(before[(4 * 8 + 4) * 4]).toBeGreaterThan(240);
            const nativeLost = new Promise<Event>(resolve => {
                canvas.addEventListener('webglcontextlost', resolve, { once: true });
            });
            extension.loseContext();
            expect(renderer.isReady).toBe(true);
            expect(() => {
                renderer.renderToTarget(target, scene, camera);
            }).toThrow(/context is lost/u);
            await Promise.resolve();
            expect(loss).toHaveBeenCalledOnce();
            expect(renderer.isReady).toBe(false);
            const event = await nativeLost;
            expect(event.defaultPrevented).toBe(true);
            // Restoration is allowed after the context-lost DOM dispatch has completed.
            await new Promise<void>(resolve => {
                globalThis.setTimeout(resolve, 0);
            });
            extension.restoreContext();
            await vi.waitFor(
                () => {
                    expect(renderer.isReady).toBe(true);
                    expect(restored).toHaveBeenCalledOnce();
                },
                { timeout: 5_000 }
            );
            renderer.renderToTarget(target, scene, camera);
            await renderer.waitForIdle();
            const after = (await target.readColorAttachment()).data;
            expect(after).toEqual(before);
            expect(target.isDestroyed).toBe(false);
            expect(loss).toHaveBeenCalledOnce();
            expect(failed).not.toHaveBeenCalled();
        } finally {
            target.destroy();
            renderer.destroy();
        }
    });
});
