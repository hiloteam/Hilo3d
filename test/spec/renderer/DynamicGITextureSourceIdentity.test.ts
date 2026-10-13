import { describe, expect, it, vi } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import GeometryData from '../../../src/geometry/GeometryData';
import PBRMaterial from '../../../src/material/PBRMaterial';
import Color from '../../../src/math/Color';
import Vector3 from '../../../src/math/Vector3';
import Texture, {
    type TextureMipmap,
    type TextureUploadSource,
    getTextureRecoveryBacking
} from '../../../src/texture/Texture';
import {
    LINEAR,
    NEAREST,
    NEAREST_MIPMAP_NEAREST,
    RGBA,
    UNSIGNED_BYTE
} from '../../../src/constants/webgl';
import { RGBA8, SRGB8_ALPHA8 } from '../../../src/constants/webgl2';
import { COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT } from '../../../src/constants/webglExtensions';
import Renderer from '../../../src/render/Renderer';
import Shader from '../../../src/shader/Shader';
import { DEFAULT_MATERIAL_PIPELINE_STATE } from '../../../src/material/MaterialDefinition';
import { FullscreenRenderPass } from '../../../src/render/pipeline/passes/FullscreenRenderPass';
import { PORTABLE_FULLSCREEN_VERTEX_SOURCE } from '../../../src/render/pipeline/passes/internal/PortableFullscreenShader';
import type {
    RenderPipeline,
    RenderPipelineFactory,
    RenderPipelineContext
} from '../../../src/render/pipeline/RenderPipeline';
import type { RHIDevice } from '../../../src/render/rhi/core';
import { RayTracingScene } from '../../../src/render/gi/RayTracingScene';
import { sameRayTexture } from '../../../src/render/gi/scene/SceneMaterials';
import { ClusteredForwardPlusPipelineFactory } from '../../../src/render/pipeline/ClusteredForwardPlus';
import {
    registerRendererDiagnostics,
    unregisterRendererDiagnostics
} from '../../../src/render/diagnostics/RendererDiagnosticsRegistry';

function rgbaMips(color: readonly [number, number, number, number]): TextureMipmap[] {
    const level0 = new Uint8Array(16);
    for (let index = 0; index < 4; index++) level0.set(color, index * 4);
    return [
        { data: level0, width: 2, height: 2 },
        { data: new Uint8Array(color), width: 1, height: 1 }
    ];
}

function rayMesh(texture: Texture<unknown>, encoding: 'srgb' | 'linear' = 'srgb'): Mesh {
    const mesh = new Mesh({
        geometry: new BoxGeometry().setAllRectUV([
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1]
        ]),
        material: new PBRMaterial({
            metallic: 0,
            emissionFactor: new Color(1, 1, 1),
            emission: { texture, encoding }
        })
    });
    mesh.updateMatrixWorld();
    return mesh;
}

function mipTexture(internalFormat = RGBA8): Texture<unknown> {
    return new Texture({
        image: null,
        mipmaps: rgbaMips([255, 0, 0, 255]),
        width: 2,
        height: 2,
        internalFormat,
        format: RGBA,
        type: UNSIGNED_BYTE,
        magFilter: NEAREST,
        minFilter: NEAREST_MIPMAP_NEAREST
    });
}

describe('DDGI managed texture upload identities', () => {
    it('invalidates replaced mip chains without a content revision and preserves stable snapshots', () => {
        const texture = mipTexture();
        const prepare = vi.spyOn(
            texture as unknown as { prepareTextureUpload(): TextureUploadSource },
            'prepareTextureUpload'
        );
        const mesh = rayMesh(texture);
        const compiler = new RayTracingScene();
        const first = compiler.update(mesh);
        expect(prepare).toHaveBeenCalledOnce();
        expect(compiler.update(mesh)).toBe(first);
        expect(prepare).toHaveBeenCalledOnce();
        const originalChain = texture.mipmaps;
        const revision = texture.updateRevision;
        texture.mipmaps = rgbaMips([0, 255, 0, 255]);
        expect(texture.updateRevision).toBe(revision);
        const changed = compiler.update(mesh);
        expect(changed.revision).toBe(first.revision + 1);
        expect(prepare).toHaveBeenCalledTimes(2);
        expect(changed.triangleDirtyRanges).toEqual([]);
        expect(changed.materialDirtyRanges).toEqual([]);
        expect(first.textures[0]?.uploadSource.mipmaps).toBe(originalChain);
        expect(changed.textures[0]?.uploadSource.mipmaps).toBe(texture.mipmaps);
        expect(compiler.update(mesh)).toBe(changed);
        expect(prepare).toHaveBeenCalledTimes(2);
        // Like the shared texture cache, mutations inside an existing chain require needUpdate.
        const blueLevel = rgbaMips([0, 0, 255, 255])[0];
        if (!blueLevel) throw new Error('Expected replacement mip level');
        texture.mipmaps[0] = blueLevel;
        expect(compiler.update(mesh)).toBe(changed);
        texture.needUpdate = true;
        expect(compiler.update(mesh).revision).toBe(changed.revision + 1);
        expect(prepare).toHaveBeenCalledTimes(3);
    });

    it('uses retained upload backing after image release without reading the released image getter', () => {
        const texture = mipTexture();
        texture.isImageCanRelease = true;
        const mesh = rayMesh(texture);
        const compiler = new RayTracingScene();
        compiler.update(mesh);
        expect(texture.releaseImageIfAllowed()).toBe(true);
        expect(() => texture.image).toThrow(/released/);
        const backing = getTextureRecoveryBacking(texture);
        if (!backing) throw new Error('Expected release-safe source backing');
        const released = compiler.update(mesh);
        expect(released.textures[0]?.uploadSource.image).toBe(backing.image);
        expect(released.textures[0]?.uploadSource.mipmaps).toBe(backing.mipmaps);
        expect(texture.mipmaps).toBeNull();
        expect(compiler.update(mesh)).toBe(released);
    });

    it('tracks compressed and hardware-sRGB source metadata without applying a second implicit color decode', () => {
        const texture = new Texture({
            image: null,
            compressed: true,
            internalFormat: COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT,
            format: 0,
            type: 0,
            width: 4,
            height: 4,
            magFilter: NEAREST,
            minFilter: NEAREST_MIPMAP_NEAREST,
            mipmaps: [4, 2, 1].map(size => ({
                data: new Uint8Array(8),
                width: size,
                height: size
            }))
        });
        const mesh = rayMesh(texture, 'linear');
        const compiler = new RayTracingScene();
        const first = compiler.update(mesh);
        expect(first.materials[47]).toBe(0); // Explicit linear slot: hardware-sRGB supplies decoding.
        texture.mipmaps = [4, 2, 1].map(size => ({
            data: new Uint8Array(8).fill(1),
            width: size,
            height: size
        }));
        const changed = compiler.update(mesh);
        const oldSource = first.textures[0],
            newSource = changed.textures[0];
        if (!oldSource || !newSource) throw new Error('Expected transport source descriptors');
        expect(sameRayTexture(oldSource, newSource)).toBe(false);
        expect(newSource.stamp).toContain(COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT);
        const srgb = mipTexture(SRGB8_ALPHA8);
        const hardware = compiler.update(rayMesh(srgb, 'linear'));
        expect(hardware.materials[47]).toBe(0);
        expect(hardware.textures[0]?.stamp).toContain(SRGB8_ALPHA8);
    });

    it.each(['minFilter', 'magFilter'] as const)(
        'captures intrinsic canvas dimensions after changed %s synchronizes the upload recipe',
        field => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 2;
            const texture = new Texture({
                image: canvas,
                minFilter: NEAREST,
                magFilter: NEAREST
            });
            const mesh = rayMesh(texture);
            const compiler = new RayTracingScene();
            const first = compiler.update(mesh);
            canvas.width = 4;
            expect(texture.width).toBe(2);
            const revision = texture.updateRevision;
            if (field === 'minFilter') texture.minFilter = NEAREST_MIPMAP_NEAREST;
            else texture.magFilter = LINEAR;
            const changed = compiler.update(mesh);
            expect(texture.updateRevision).toBe(revision);
            expect(changed.textures[0]).toMatchObject({ width: 4, height: 2 });
            expect(changed.textureTexelCount).toBe(8);
            expect(first.textures[0]).toMatchObject({ width: 2, height: 2 });
            expect(compiler.update(mesh)).toBe(changed);
        }
    );
});

function totals(bytes: Uint8Array): readonly [number, number, number] {
    const sum: [number, number, number] = [0, 0, 0];
    for (let index = 0; index < bytes.length; index += 4) {
        sum[0] += bytes[index] ?? 0;
        sum[1] += bytes[index + 1] ?? 0;
        sum[2] += bytes[index + 2] ?? 0;
    }
    return sum;
}

describe('DDGI atlas source replacement pixels', () => {
    it.each(['explicit-mips', 'generated-canvas'] as const)(
        'rebuilds %s transport pixels only when the managed upload source changes',
        async kind => {
            const sourceCanvas = document.createElement('canvas');
            sourceCanvas.width = sourceCanvas.height = 2;
            const painter = sourceCanvas.getContext('2d');
            if (!painter) throw new Error('Expected 2D source-image context');
            painter.fillStyle = '#ff0000';
            painter.fillRect(0, 0, 2, 2);
            const emission =
                kind === 'explicit-mips'
                    ? mipTexture()
                    : new Texture({
                          image: sourceCanvas,
                          magFilter: NEAREST,
                          minFilter: NEAREST
                      });
            const scene = new Node();
            const floorGeometry = new BoxGeometry({
                width: 5,
                height: 0.2,
                depth: 5
            });
            const floorMaterial = new PBRMaterial({
                baseColor: new Color(0.8, 0.8, 0.8),
                metallic: 0,
                roughness: 1
            });
            new Mesh({
                geometry: floorGeometry,
                material: floorMaterial,
                y: -0.1
            }).addTo(scene);
            const emitterGeometry = new BoxGeometry({
                width: 0.1,
                height: 2.5,
                depth: 3
            });
            emitterGeometry.uvs = new GeometryData(
                new Float32Array((emitterGeometry.vertices?.count ?? 0) * 2).fill(0.875),
                2
            );
            const emitterMaterial = new PBRMaterial({
                metallic: 0,
                roughness: 1,
                baseColor: new Color(0, 0, 0),
                emissionFactor: new Color(3, 3, 3),
                emission
            });
            new Mesh({
                geometry: emitterGeometry,
                material: emitterMaterial,
                x: -2.2,
                y: 1.3
            }).addTo(scene);
            const factory = new ClusteredForwardPlusPipelineFactory({
                buckets: [
                    { geometry: floorGeometry, material: floorMaterial },
                    { geometry: emitterGeometry, material: emitterMaterial }
                ],
                maxObjects: 4,
                maxLights: 4,
                maxLightIndices: 64,
                maxLightsPerCluster: 4,
                maxViewportWidth: 32,
                maxViewportHeight: 32,
                hiZ: false,
                bloomStrength: 0,
                dynamicGlobalIllumination: {
                    origin: new Vector3(-1.5, 0.25, -1.5),
                    spacing: new Vector3(1, 0.75, 1),
                    probeCounts: [4, 3, 4],
                    maxProbesPerFrame: 48,
                    raysPerProbe: 128,
                    maxTriangles: 64,
                    maxMeshes: 4,
                    maxTextureTexels: 8,
                    maxRayDistance: 16,
                    hysteresis: 0,
                    environment: new Color(0, 0, 0),
                    bounceStrength: 0
                }
            });
            const canvas = document.createElement('canvas');
            const diagnostics = registerRendererDiagnostics(canvas);
            const renderer = await Renderer.create({
                backend: 'webgpu',
                domElement: canvas,
                width: 32,
                height: 32,
                antialias: false,
                renderPipeline: factory
            });
            renderer.clearColor = new Color(0, 0, 0);
            const output = renderer.createRenderTarget({
                width: 32,
                height: 32,
                colorAttachments: [{ format: 'rgba8unorm' }],
                depthStencilAttachment: { format: 'depth32float' }
            });
            const camera = new PerspectiveCamera({
                aspect: 1,
                near: 0.1,
                far: 12,
                fov: 24
            });
            camera.setPosition(0, 2.5, 2.5).lookAt(new Vector3(0, 0, 0));
            const render = async (
                copyFirstFrame: boolean
            ): Promise<readonly [number, number, number]> => {
                for (let frame = 0; frame < 4; frame++) {
                    renderer.renderToTarget(output, scene, camera);
                    await renderer.waitForIdle();
                    expect(
                        diagnostics
                            .snapshot()
                            .renderGraph?.passes.filter(
                                pass => pass.name === 'DDGI texture transport atlas upload'
                            )
                    ).toHaveLength(frame === 0 && copyFirstFrame ? 1 : 0);
                }
                return totals((await output.readColorAttachment()).data);
            };
            try {
                const red = await render(true);
                expect(red[0]).toBeGreaterThan(1000);
                expect(red[0]).toBeGreaterThan(red[1] * 3);
                const revision = emission.updateRevision;
                if (kind === 'explicit-mips') emission.mipmaps = rgbaMips([0, 255, 0, 255]);
                else {
                    sourceCanvas.width = 4;
                    painter.fillStyle = '#ff0000';
                    painter.fillRect(0, 0, 2, 2);
                    painter.fillStyle = '#00ff00';
                    painter.fillRect(2, 0, 2, 2);
                    emission.minFilter = NEAREST_MIPMAP_NEAREST;
                }
                expect(emission.updateRevision).toBe(revision);
                const green = await render(true);
                expect(green[1]).toBeGreaterThan(1000);
                expect(green[1]).toBeGreaterThan(green[0] * 3);
                expect(emission.width).toBe(kind === 'explicit-mips' ? 2 : 4);
                const stable = await render(false);
                expect(stable).toEqual(green);
                factory.setDynamicGlobalIlluminationIntensity(0);
                const disabled = await render(false);
                expect(disabled[1]).toBeLessThan(green[1] * 0.05);
            } finally {
                output.destroy();
                renderer.destroy();
                emission.destroy();
                unregisterRendererDiagnostics(canvas, diagnostics);
            }
        },
        120_000
    );
});

describe('first-pass managed texture import transactions', () => {
    it.each(['webgl2', 'webgpu'] as const)(
        'initializes two imports once, rolls back failure, and rebuilds released sources on %s',
        async backend => {
            const first = new Texture({
                width: 1,
                height: 1,
                image: new Uint8Array([255, 0, 0, 255]),
                minFilter: NEAREST,
                magFilter: NEAREST,
                isImageCanRelease: true
            });
            const second = new Texture({
                width: 1,
                height: 1,
                image: new Uint8Array([0, 255, 0, 255]),
                minFilter: NEAREST,
                magFilter: NEAREST,
                isImageCanRelease: true
            });
            const portableCoordinates = Shader.shaders['method/portableCoordinates.glsl'];
            if (portableCoordinates === undefined)
                throw new Error('Missing portable image coordinates');
            const shader = new Shader({
                vs: PORTABLE_FULLSCREEN_VERTEX_SOURCE,
                fs: `#version 300 es
precision highp float;
${portableCoordinates}
uniform sampler2D u_first;
uniform sampler2D u_second;
layout(location = 0) out vec4 color;
void main() {
    color = (texture(u_first, hiloTextureUV(vec2(0.5))) + texture(u_second, hiloTextureUV(vec2(0.5)))) * 0.5;
}`
            });
            const pass = new FullscreenRenderPass({
                name: 'first-pass two managed images',
                shader,
                pipelineState: {
                    ...DEFAULT_MATERIAL_PIPELINE_STATE,
                    depthTest: false,
                    depthWrite: false,
                    cullMode: 'none'
                }
            });
            let failAfterImports = false;
            const factory: RenderPipelineFactory = {
                name: 'managed texture imports before any pass',
                create(): RenderPipeline {
                    return {
                        name: 'managed texture imports before any pass',
                        record(context: RenderPipelineContext): void {
                            const a = context.graph.importTexture(first);
                            const b = context.graph.importTexture(second);
                            expect(context.graph.importTexture(first)).toBe(a);
                            expect(context.graph.importTexture(second)).toBe(b);
                            if (failAfterImports)
                                throw new Error('injected failure after managed texture imports');
                            context.graph.addPass(pass, {
                                inputTextures: [a, b],
                                colorAttachments: [
                                    {
                                        texture: context.graph.importOutput().color(0),
                                        loadOp: 'clear',
                                        storeOp: 'store',
                                        clearValue: { r: 0, g: 0, b: 0, a: 0 }
                                    }
                                ]
                            });
                        },
                        destroy(): void {
                            shader.destroy();
                        }
                    };
                }
            };
            const renderer = await Renderer.create({
                backend,
                domElement: document.createElement('canvas'),
                width: 4,
                height: 4,
                antialias: false,
                renderPipeline: factory
            });
            let output = renderer.createRenderTarget({
                width: 4,
                height: 4,
                colorAttachments: [{ format: 'rgba8unorm' }]
            });
            const scene = new Node();
            const camera = new PerspectiveCamera({ aspect: 1, z: 3 });
            const extension = renderer.getExtension('rhi') as { readonly device: RHIDevice } | null;
            if (!extension) throw new Error('Expected checked RHI extension');
            const beginFrame = vi.spyOn(extension.device.graphicsQueue, 'beginFrame');
            const pixels = async (): Promise<Uint8Array> =>
                (await output.readColorAttachment()).data;
            const expectColor = (bytes: Uint8Array, green: number, blue: number): void => {
                for (let index = 0; index < bytes.length; index += 4) {
                    expect(bytes[index]).toBeGreaterThanOrEqual(127);
                    expect(bytes[index]).toBeLessThanOrEqual(128);
                    expect(Math.abs((bytes[index + 1] ?? 0) - green)).toBeLessThanOrEqual(1);
                    expect(Math.abs((bytes[index + 2] ?? 0) - blue)).toBeLessThanOrEqual(1);
                    expect(bytes[index + 3]).toBe(255);
                }
            };
            try {
                renderer.renderToTarget(output, scene, camera);
                await renderer.waitForIdle();
                expectColor(await pixels(), 128, 0);
                expect(first.isImageReleased).toBe(true);
                expect(second.isImageReleased).toBe(true);
                first.image = new Uint8Array([0, 0, 255, 255]);
                second.image = new Uint8Array([255, 0, 0, 255]);
                failAfterImports = true;
                const submittedBeforeFailure = beginFrame.mock.calls.length;
                expect(() => {
                    renderer.renderToTarget(output, scene, camera);
                }).toThrow(/injected failure after managed texture imports/);
                expect(beginFrame).toHaveBeenCalledTimes(submittedBeforeFailure);
                expect(first.isImageReleased).toBe(false);
                expect(second.isImageReleased).toBe(false);
                expectColor(await pixels(), 128, 0);
                failAfterImports = false;
                renderer.renderToTarget(output, scene, camera);
                await renderer.waitForIdle();
                expectColor(await pixels(), 0, 128);
                expect(first.isImageReleased).toBe(true);
                expect(second.isImageReleased).toBe(true);
                expect(() => first.image).toThrow(/released/);
                renderer.releaseGPUResources();
                output = renderer.createRenderTarget({
                    width: 4,
                    height: 4,
                    colorAttachments: [{ format: 'rgba8unorm' }]
                });
                renderer.renderToTarget(output, scene, camera);
                await renderer.waitForIdle();
                expectColor(await pixels(), 0, 128);
            } finally {
                beginFrame.mockRestore();
                output.destroy();
                renderer.destroy();
                first.destroy();
                second.destroy();
            }
        },
        30_000
    );
});
