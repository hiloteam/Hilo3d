import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import { MeshDrawListPlanner } from '../../../src/render/renderer/MeshDrawListPlanner';
import { NagaShaderTranslator } from '../../../src/render/shader/GlslToWgsl';
import { testEnv } from '../../renderer-setup';

function texture(width = 64, height = 32, flipY = true): Hilo3d.Texture {
    return new Hilo3d.Texture({ width, height, flipY });
}

describe('SpriteFrame', () => {
    it('converts top-left pixel rectangles to backend-portable UV transforms', () => {
        const source = texture();
        const frame = new Hilo3d.SpriteFrame({
            texture: source,
            x: 16,
            y: 8,
            width: 16,
            height: 8
        });

        expect(Array.from(frame.writeUVRect(new Float32Array(4)))).toEqual([0.25, 0.5, 0.25, 0.25]);

        source.flipY = false;
        expect(Array.from(frame.writeUVRect(new Float32Array(4)))).toEqual([
            0.25, 0.5, 0.25, -0.25
        ]);
    });
});

describe('Sprite', () => {
    const translator = new NagaShaderTranslator();

    beforeAll(async () => {
        Hilo3d.Shader.init(testEnv.shaderRenderer);
        await translator.initialize();
    });

    it('shares geometry/material and splits large texture batches at the portable limit', () => {
        const source = texture();
        const sprites = Array.from({ length: 300 }, () => new Hilo3d.Sprite({ texture: source }));
        const planner = new MeshDrawListPlanner();
        const plan = planner.build(sprites);

        expect(new Set(sprites.map(sprite => sprite.geometry)).size).toBe(1);
        expect(new Set(sprites.map(sprite => sprite.material)).size).toBe(1);
        expect(plan.opaqueMeshes).toEqual([]);
        expect(plan.transparentMeshes).toEqual([]);
        expect(plan.instancedBatches.map(batch => batch.meshes.length)).toEqual([128, 128, 44]);
        expect(planner.diagnostics()).toMatchObject({
            activeOwnerCount: 300,
            activeInstancedBatchCount: 3,
            largestInstancedBatchCapacity: 128
        });
    });

    it('advances atlas animation by mutating stable instance storage', () => {
        const source = texture();
        const sprite = new Hilo3d.Sprite({
            frames: [
                new Hilo3d.SpriteFrame({
                    texture: source,
                    x: 0,
                    y: 0,
                    width: 16,
                    height: 16
                }),
                new Hilo3d.SpriteFrame({
                    texture: source,
                    x: 16,
                    y: 0,
                    width: 16,
                    height: 16
                })
            ],
            frameRate: 10
        });
        const uvStorage = sprite.spriteUVRect;
        const sizeStorage = sprite.spriteSizeAnchor;

        sprite.update(100);

        expect(sprite.currentFrame).toBe(1);
        expect(sprite.spriteUVRect).toBe(uvStorage);
        expect(sprite.spriteSizeAnchor).toBe(sizeStorage);
        expect(sprite.width).toBe(16);
        expect(sprite.height).toBe(16);
    });

    it('opts sequence animation into Node traversal without consuming onUpdate', () => {
        const source = texture();
        const sprite = new Hilo3d.Sprite({
            frames: [
                new Hilo3d.SpriteFrame({
                    texture: source,
                    x: 0,
                    y: 0,
                    width: 16,
                    height: 16
                }),
                new Hilo3d.SpriteFrame({
                    texture: source,
                    x: 16,
                    y: 0,
                    width: 16,
                    height: 16
                })
            ],
            frameRate: 10
        });
        let updateCount = 0;
        sprite.onUpdate = () => {
            updateCount += 1;
        };
        const root = new Hilo3d.Node().addChild(sprite);

        root.traverseUpdate(100);

        expect(sprite.currentFrame).toBe(1);
        expect(updateCount).toBe(1);
    });

    it('keeps single-frame sprites out of the animation update hot path', () => {
        const sprite = new Hilo3d.Sprite({ texture: texture() });
        const update = vi.spyOn(sprite, 'update');
        const root = new Hilo3d.Node().addChild(sprite);

        root.traverseUpdate(16);

        expect(update).not.toHaveBeenCalled();
    });

    it('uses logical size and anchor for click ray tests', () => {
        const sprite = new Hilo3d.Sprite({
            texture: texture(),
            width: 40,
            height: 20,
            anchorX: 0,
            anchorY: 0
        });
        sprite.updateMatrixWorld(true);

        expect(
            sprite.raycast(
                new Hilo3d.Ray({
                    origin: new Hilo3d.Vector3(20, 10, 5),
                    direction: new Hilo3d.Vector3(0, 0, -1)
                })
            )
        ).toHaveLength(1);
        expect(
            sprite.raycast(
                new Hilo3d.Ray({
                    origin: new Hilo3d.Vector3(-1, 10, 5),
                    direction: new Hilo3d.Vector3(0, 0, -1)
                })
            )
        ).toBeNull();
    });

    it('translates its single GLSL source through Naga with the WebGPU instance ABI', () => {
        const sprite = new Hilo3d.Sprite({ texture: texture() });
        const material = sprite.material;
        if (!material) throw new Error('Sprite lost its material.');
        const shader = Hilo3d.Shader.getShader(
            sprite,
            material,
            true,
            new Hilo3d.LightManager(),
            null,
            false,
            testEnv.shaderRenderer
        );
        if (!shader) throw new Error('Sprite shader was not created.');

        const translated = translator.translate(shader.vs, shader.fs);
        const inputNames = translated.vertexInputs.map(input => input.name);
        const blockNames = translated.uniformBlocks.map(block => block.name);

        expect(inputNames).toEqual([
            'a_position',
            'a_texcoord0',
            'i_uvRect',
            'i_sizeAnchor',
            'i_tint'
        ]);
        expect(blockNames).toContain('CameraBlock');
        expect(blockNames).toContain('InstanceBlock');
        expect(translated.samplers).toMatchObject([{ name: 'u_spriteTexture' }]);
    });

    it.skipIf(typeof navigator === 'undefined' || !('gpu' in navigator))(
        'creates a real WebGPU sprite pipeline and renders it offscreen',
        async testContext => {
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
                testContext.skip();
                return;
            }
            const stage = await Hilo3d.Stage.create({
                backend: 'webgpu',
                width: 32,
                height: 16,
                pixelRatio: 1,
                camera: new Hilo3d.Camera2D({ width: 32, height: 16 })
            });
            const source = document.createElement('canvas');
            source.width = 2;
            source.height = 2;
            const sourceContext = source.getContext('2d');
            if (!sourceContext) throw new Error('WebGPU Sprite test requires Canvas 2D.');
            sourceContext.fillStyle = '#ff0000';
            sourceContext.fillRect(0, 0, 1, 1);
            sourceContext.fillStyle = '#00ff00';
            sourceContext.fillRect(1, 0, 1, 1);
            sourceContext.fillStyle = '#0000ff';
            sourceContext.fillRect(0, 1, 1, 1);
            sourceContext.fillStyle = '#ffff00';
            sourceContext.fillRect(1, 1, 1, 1);
            stage.addChild(
                new Hilo3d.Sprite({
                    texture: new Hilo3d.Texture({
                        image: source,
                        flipY: true,
                        minFilter: Hilo3d.constants.webgl.NEAREST,
                        magFilter: Hilo3d.constants.webgl.NEAREST
                    }),
                    x: 8,
                    y: 8,
                    width: 16,
                    height: 16
                })
            );
            stage.addChild(
                new Hilo3d.Sprite({
                    texture: new Hilo3d.Texture({
                        image: new Uint8Array([
                            255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255
                        ]),
                        width: 2,
                        height: 2,
                        flipY: true,
                        minFilter: Hilo3d.constants.webgl.NEAREST,
                        magFilter: Hilo3d.constants.webgl.NEAREST
                    }),
                    x: 24,
                    y: 8,
                    width: 16,
                    height: 16
                })
            );
            const target = stage.renderer.createRenderTarget({
                width: 32,
                height: 16,
                colorAttachments: [{ format: 'rgba8unorm' }],
                depthStencilAttachment: false
            });
            try {
                const camera = stage.camera;
                if (!camera) throw new Error('WebGPU Sprite test lost its camera.');
                stage.renderer.renderToTarget(target, stage, camera);
                const readback = await target.readColorAttachment();
                const pixel = (x: number, y: number): number[] => {
                    const offset = y * readback.bytesPerRow + x * readback.bytesPerPixel;
                    return Array.from(readback.data.slice(offset, offset + readback.bytesPerPixel));
                };
                expect([pixel(20, 4), pixel(28, 4), pixel(20, 12), pixel(28, 12)]).toEqual([
                    [255, 0, 0, 255],
                    [0, 255, 0, 255],
                    [0, 0, 255, 255],
                    [255, 255, 0, 255]
                ]);
                expect([pixel(4, 4), pixel(12, 4), pixel(4, 12), pixel(12, 12)]).toEqual([
                    [255, 0, 0, 255],
                    [0, 255, 0, 255],
                    [0, 0, 255, 255],
                    [255, 255, 0, 255]
                ]);
            } finally {
                target.destroy();
                stage.destroy();
            }
        }
    );
});
