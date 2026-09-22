import { describe, expect, it, vi } from 'vitest';
import Camera from '../../../src/camera/Camera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import Geometry from '../../../src/geometry/Geometry';
import GeometryData from '../../../src/geometry/GeometryData';
import ShaderMaterial from '../../../src/material/ShaderMaterial';
import Renderer from '../../../src/render/Renderer';
import type { RHIDevice } from '../../../src/render/rhi/core';
import Shader from '../../../src/shader/Shader';
import Texture from '../../../src/texture/Texture';
import { NEAREST } from '../../../src/constants/webgl';

describe('Managed ImageBitmap texture parity', () => {
    for (const backend of ['webgl2', 'webgpu'] as const) {
        it(`preserves asymmetric straight-alpha bitmap rows and recovery through ${backend}`, async () => {
            const original = [
                255, 0, 0, 255, 17, 83, 149, 1, 240, 128, 64, 128, 3, 7, 11, 255, 0, 255, 0, 255,
                80, 160, 240, 8, 0, 0, 255, 255, 123, 45, 201, 0
            ];
            const bitmap = await createImageBitmap(
                new ImageData(new Uint8ClampedArray(original), 2, 4),
                {
                    premultiplyAlpha: 'none',
                    imageOrientation: 'none',
                    colorSpaceConversion: 'none'
                }
            );
            const texture = new Texture({
                image: bitmap,
                isImageCanRelease: true,
                minFilter: NEAREST,
                magFilter: NEAREST
            });
            const coordinates = Shader.shaders['method/portableCoordinates.glsl'];
            if (typeof coordinates !== 'string') throw new Error('Portable UV helper is missing');
            const mesh = new Mesh({
                geometry: new Geometry({
                    vertices: new GeometryData(
                        new Float32Array([-1, 1, 0, -1, -1, 0, 1, -1, 0, 1, 1, 0]),
                        3
                    ),
                    uvs: new GeometryData(new Float32Array([0, 0, 0, 1, 1, 1, 1, 0]), 2),
                    indices: new GeometryData(new Uint16Array([0, 1, 2, 0, 2, 3]), 1)
                }),
                frustumTest: false,
                material: new ShaderMaterial({
                    attributes: { a_position: 'POSITION', a_uv: 'TEXCOORD_0' },
                    uniforms: { u_image: { get: () => texture } },
                    state: { depthTest: false, depthWrite: false, cullMode: 'none' },
                    vs: `#version 300 es
in vec3 a_position;
in vec2 a_uv;
out vec2 v_uv;
void main() { gl_Position = vec4(a_position, 1.0); v_uv = a_uv; }`,
                    fs: `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_image;
layout(location=0) out vec4 color;
${coordinates}
void main() { color = texture(u_image, hiloTextureUV(v_uv)); }`
                })
            });
            const renderer = await Renderer.create({
                backend,
                domElement: document.createElement('canvas'),
                width: 2,
                height: 4,
                antialias: false
            });
            const scene = new Node().addChild(mesh);
            const camera = new Camera();
            const target = renderer.createRenderTarget({ width: 2, height: 4 });
            const read = async (): Promise<number[]> => {
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
                return Array.from((await target.readColorAttachment()).data);
            };
            try {
                expect(await read()).toEqual(original);
                expect(texture.isImageReleased).toBe(true);
                texture.flipY = true;
                const reversed: number[] = [];
                for (let row = 3; row >= 0; row--)
                    reversed.push(...original.slice(row * 8, row * 8 + 8));
                expect(await read()).toEqual(reversed);
                texture.flipY = false;
                expect(await read()).toEqual(original);
                const extension = renderer.getExtension('rhi') as {
                    readonly device: RHIDevice;
                } | null;
                if (extension === null) throw new Error('RHI recovery extension is missing');
                const restored = vi.fn();
                const failed = vi.fn();
                renderer.on('rhiDeviceRestored', restored);
                renderer.on('rhiDeviceRecoveryFailed', failed);
                extension.device.destroy();
                await vi.waitFor(() => {
                    expect(failed).not.toHaveBeenCalled();
                    expect(restored).toHaveBeenCalledOnce();
                    expect(renderer.isReady).toBe(true);
                });
                expect(await read()).toEqual(original);
                expect(target.isDestroyed).toBe(false);
            } finally {
                scene.destroy(renderer);
                target.destroy();
                texture.destroy();
                renderer.destroy();
                bitmap.close();
            }
        });
    }
});
