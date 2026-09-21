import { describe, expect, it } from 'vitest';
import OrthographicCamera from '../../../src/camera/OrthographicCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import PlaneGeometry from '../../../src/geometry/PlaneGeometry';
import BasicMaterial from '../../../src/material/BasicMaterial';
import Color from '../../../src/math/Color';
import Renderer from '../../../src/render/Renderer';

describe('Atomic transparent subtree rendering', () => {
    for (const backend of ['webgl2', 'webgpu'] as const) {
        it(`keeps overlapping groups intact through shared Forward on ${backend}`, async () => {
            const renderer = await Renderer.create({
                backend,
                domElement: document.createElement('canvas'),
                width: 8,
                height: 8,
                antialias: false
            });
            const geometry = new PlaneGeometry();
            const makeMesh = (diffuse: Color, renderOrder: number): Mesh =>
                new Mesh({
                    geometry,
                    renderOrder,
                    material: new BasicMaterial({
                        diffuse,
                        lightType: 'NONE',
                        compositing: { mode: 'alpha-blend', premultiplied: true },
                        state: { depthTest: false, depthWrite: false, cullMode: 'none' }
                    })
                });
            const a = new Node()
                .addChild(makeMesh(new Color(1, 0, 0), 0))
                .addChild(makeMesh(new Color(0, 1, 0), 10));
            const b = new Node()
                .addChild(makeMesh(new Color(0, 0, 1), 0))
                .addChild(makeMesh(new Color(1, 1, 0), 5));
            const scene = new Node().addChild(a).addChild(b);
            const camera = new OrthographicCamera({ near: 0.1, far: 10, z: 2 });
            const target = renderer.createRenderTarget({ width: 8, height: 8 });
            const renderCenter = async (): Promise<number[]> => {
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
                const pixels = await target.readColorAttachment();
                const offset = 4 * pixels.bytesPerRow + 4 * pixels.bytesPerPixel;
                return Array.from(pixels.data.subarray(offset, offset + 4));
            };
            try {
                expect(await renderCenter()).toEqual([0, 255, 0, 255]);
                a.sortingGroup = b.sortingGroup = true;
                expect(await renderCenter()).toEqual([255, 255, 0, 255]);
                a.zIndex = 1;
                expect(await renderCenter()).toEqual([0, 255, 0, 255]);
                a.zIndex = 0;
                scene.addChild(a);
                expect(await renderCenter()).toEqual([0, 255, 0, 255]);
            } finally {
                scene.destroy(renderer);
                target.destroy();
                renderer.destroy();
            }
        });
    }
});
