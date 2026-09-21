import { describe, expect, it } from 'vitest';
import Camera2D, { DEFAULT_2D_LAYER } from '../../../src/camera/Camera2D';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import Stage from '../../../src/core/Stage';
import Sprite from '../../../src/2d/Sprite';
import PlaneGeometry from '../../../src/geometry/PlaneGeometry';
import BasicMaterial from '../../../src/material/BasicMaterial';
import Color from '../../../src/math/Color';
import Texture from '../../../src/texture/Texture';

describe('Camera2D grouped pointer ordering', () => {
    it('picks and dispatches to the front rendered Mesh/Sprite across nested sorting groups', async () => {
        const camera = new Camera2D({ width: 16, height: 16 });
        const stage = await Stage.create({
            backend: 'webgl2',
            width: 16,
            height: 16,
            pixelRatio: 1,
            camera
        });
        const target = stage.renderer.createRenderTarget({ width: 16, height: 16 });
        const green = new Texture({ image: new Uint8Array([0, 255, 0, 255]), width: 1, height: 1 });
        const blue = new Texture({ image: new Uint8Array([0, 0, 255, 255]), width: 1, height: 1 });
        const makeMesh = (name: string, diffuse: Color, renderOrder: number): Mesh =>
            new Mesh({
                name,
                x: 8,
                y: 8,
                layer: DEFAULT_2D_LAYER,
                renderOrder,
                geometry: new PlaneGeometry({ width: 16, height: 16 }),
                material: new BasicMaterial({
                    diffuse,
                    lightType: 'NONE',
                    compositing: { mode: 'alpha-blend', premultiplied: true },
                    state: { depthTest: false, depthWrite: false, cullMode: 'none' }
                })
            });
        const aMesh = makeMesh('a-mesh', new Color(1, 0, 0), 10);
        const aSprite = new Sprite({
            name: 'a-sprite',
            texture: green,
            x: 8,
            y: 8,
            width: 16,
            height: 16
        });
        const bMesh = makeMesh('b-mesh', new Color(1, 1, 0), 5);
        const bSprite = new Sprite({
            name: 'b-sprite',
            texture: blue,
            x: 8,
            y: 8,
            width: 16,
            height: 16,
            zIndex: 1000
        });
        const a = new Node({ sortingGroup: true }).addChild(aMesh).addChild(aSprite);
        const inner = new Node({ sortingGroup: true, zIndex: -1 }).addChild(bSprite);
        const b = new Node({ sortingGroup: true }).addChild(bMesh).addChild(inner);
        stage.addChild(a).addChild(b);
        const received: string[] = [];
        for (const mesh of [aMesh, aSprite, bMesh, bSprite]) {
            mesh.on('pointerdown', () => {
                received.push(mesh.name);
            });
        }
        stage.enableDOMEvent(['pointerdown']);
        const verifyFront = async (expected: Mesh, color: readonly number[]): Promise<void> => {
            stage.renderer.renderToTarget(target, stage, camera);
            await stage.renderer.waitForIdle();
            const pixels = await target.readColorAttachment();
            const offset = 8 * pixels.bytesPerRow + 8 * pixels.bytesPerPixel;
            expect(Array.from(pixels.data.subarray(offset, offset + 4))).toEqual(color);
            expect(stage.getMeshResultAtPoint(8, 8, true)?.mesh).toBe(expected);
            stage.updateDomViewport();
            const bounds = stage.canvas.getBoundingClientRect();
            stage.canvas.dispatchEvent(
                new PointerEvent('pointerdown', {
                    bubbles: true,
                    pointerId: 1,
                    pointerType: 'mouse',
                    isPrimary: true,
                    button: 0,
                    buttons: 1,
                    clientX: bounds.left + 8,
                    clientY: bounds.top + 8
                })
            );
            expect(received.at(-1)).toBe(expected.name);
        };
        try {
            await verifyFront(bMesh, [255, 255, 0, 255]);
            a.zIndex = 2;
            await verifyFront(aMesh, [255, 0, 0, 255]);
            a.zIndex = 0;
            inner.zIndex = 2;
            await verifyFront(bSprite, [0, 0, 255, 255]);
            inner.visible = false;
            await verifyFront(bMesh, [255, 255, 0, 255]);
            b.visible = false;
            await verifyFront(aMesh, [255, 0, 0, 255]);
            aMesh.layer = 1;
            await verifyFront(aSprite, [0, 255, 0, 255]);
            a.pointerEnabled = false;
            expect(stage.getMeshResultAtPoint(8, 8, true)?.mesh).toBe(stage);
        } finally {
            target.destroy();
            stage.destroy();
            green.destroy();
            blue.destroy();
        }
    });
});
