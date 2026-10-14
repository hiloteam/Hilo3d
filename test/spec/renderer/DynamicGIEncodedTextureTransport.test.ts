import { describe, expect, it } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import GeometryData from '../../../src/geometry/GeometryData';
import KTXLoader from '../../../src/loader/KTXLoader';
import PBRMaterial from '../../../src/material/PBRMaterial';
import Color from '../../../src/math/Color';
import Vector3 from '../../../src/math/Vector3';
import Matrix3 from '../../../src/math/Matrix3';
import Texture from '../../../src/texture/Texture';
import { NEAREST, RGBA, UNSIGNED_BYTE } from '../../../src/constants/webgl';
import { HALF_FLOAT, RGBA16F, RGBA8 } from '../../../src/constants/webgl2';
import { COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT } from '../../../src/constants/webglExtensions';
import Renderer from '../../../src/render/Renderer';
import { ClusteredForwardPlusPipelineFactory } from '../../../src/render/pipeline/ClusteredForwardPlus';
import { createSceneTextureNormalizationShader } from '../../../src/render/gi/SceneTextureAtlas';
import { FullscreenRenderPass } from '../../../src/render/pipeline/passes/FullscreenRenderPass';
import { DEFAULT_MATERIAL_PIPELINE_STATE } from '../../../src/material/MaterialDefinition';

interface TransportFixture {
    readonly renderer: Renderer;
    readonly material: PBRMaterial;
    readonly factory: ClusteredForwardPlusPipelineFactory;
    capture(frames?: number): Promise<Uint8Array>;
    releaseGPUResources(): void;
    destroy(): void;
}

async function transportFixture(texture: Texture<unknown>): Promise<TransportFixture> {
    const scene = new Node();
    const floorGeometry = new BoxGeometry({ width: 5, height: 0.2, depth: 5 });
    const floorMaterial = new PBRMaterial({
        baseColor: new Color(0.8, 0.8, 0.8),
        metallic: 0,
        roughness: 1
    });
    new Mesh({ geometry: floorGeometry, material: floorMaterial, y: -0.1 }).addTo(scene);
    const emitterGeometry = new BoxGeometry({ width: 0.1, height: 2.5, depth: 3 });
    emitterGeometry.uvs = new GeometryData(
        new Float32Array((emitterGeometry.vertices?.count ?? 0) * 2).fill(0.5),
        2
    );
    const material = new PBRMaterial({
        baseColor: new Color(0, 0, 0),
        metallic: 0,
        roughness: 1,
        emission: { texture, encoding: 'linear' },
        emissionFactor: new Color(1, 1, 1)
    });
    new Mesh({ geometry: emitterGeometry, material, x: -2.2, y: 1.3 }).addTo(scene);
    const factory = new ClusteredForwardPlusPipelineFactory({
        buckets: [
            { geometry: floorGeometry, material: floorMaterial },
            { geometry: emitterGeometry, material }
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
            maxTextureTexels: 16,
            maxRayDistance: 16,
            hysteresis: 0,
            environment: new Color(0, 0, 0),
            bounceStrength: 0
        }
    });
    const renderer = await Renderer.create({
        backend: 'webgpu',
        domElement: document.createElement('canvas'),
        width: 32,
        height: 32,
        antialias: false,
        renderPipeline: factory
    });
    renderer.clearColor = new Color(0, 0, 0);
    const createTarget = (): ReturnType<Renderer['createRenderTarget']> =>
        renderer.createRenderTarget({
            width: 32,
            height: 32,
            colorAttachments: [{ format: 'rgba8unorm' }],
            depthStencilAttachment: { format: 'depth32float' }
        });
    let target = createTarget();
    const camera = new PerspectiveCamera({ aspect: 1, near: 0.1, far: 12, fov: 24 });
    camera.setPosition(0, 2.5, 2.5).lookAt(new Vector3(0, 0, 0));
    return {
        renderer,
        material,
        factory,
        async capture(frames = 4): Promise<Uint8Array> {
            for (let frame = 0; frame < frames; frame++) {
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
            }
            return (await target.readColorAttachment()).data.slice();
        },
        releaseGPUResources(): void {
            renderer.releaseGPUResources();
            target = createTarget();
        },
        destroy(): void {
            target.destroy();
            renderer.destroy();
        }
    };
}

function redEnergy(pixels: Uint8Array): number {
    let result = 0;
    for (let index = 0; index < pixels.length; index += 4) result += pixels[index] ?? 0;
    return result;
}

function maximumRGBDifference(a: Uint8Array, b: Uint8Array): number {
    expect(a.length).toBe(b.length);
    let difference = 0;
    for (let index = 0; index < a.length; index++) {
        if (index % 4 === 3) continue;
        difference = Math.max(difference, Math.abs((a[index] ?? 0) - (b[index] ?? 0)));
    }
    return difference;
}

function rgbaReference(red: number): Texture<Uint8Array> {
    return new Texture({
        width: 1,
        height: 1,
        internalFormat: RGBA8,
        format: RGBA,
        type: UNSIGNED_BYTE,
        image: new Uint8Array([red, 0, 0, 255]),
        minFilter: NEAREST,
        magFilter: NEAREST
    });
}

/** Same KTX 1.1 single-face layout as the maintained KTXLoader contract tests. */
function midRedBC1SRGB(selectors = 0): Texture<Uint8Array> {
    const bytes = new ArrayBuffer(64 + 4 + 8);
    new Uint8Array(bytes).set([
        0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a
    ]);
    const header = new DataView(bytes, 12);
    const values = [
        0x04030201,
        0,
        1,
        0,
        COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT,
        RGBA,
        4,
        4,
        0,
        0,
        1,
        1,
        0
    ];
    values.forEach((value, index) => {
        header.setUint32(index * 4, value, true);
    });
    const data = new DataView(bytes);
    data.setUint32(64, 8, true);
    // RGB565 endpoint (16, 0, 0) expands to approximately byte red 132. Every two-bit
    // selector is zero, so all sixteen texels select that endpoint with opaque alpha.
    data.setUint16(68, 0x8000, true);
    data.setUint16(70, 0, true);
    data.setUint32(72, selectors, true);
    return new KTXLoader().createTexture(
        { src: bytes, minFilter: NEAREST, magFilter: NEAREST, isImageCanRelease: true },
        bytes
    );
}

describe('DDGI native encoded texture transport', () => {
    it.each(['webgl2', 'webgpu'] as const)(
        'preserves asymmetric managed-image rows through %s raster normalization',
        async backend => {
            const pixels = new Uint8Array([
                255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255
            ]);
            const source = new Texture({
                image: pixels,
                width: 2,
                height: 2,
                internalFormat: RGBA8,
                format: RGBA,
                type: UNSIGNED_BYTE,
                minFilter: NEAREST,
                magFilter: NEAREST
            });
            const shader = createSceneTextureNormalizationShader();
            const pass = new FullscreenRenderPass({
                name: 'GI normalization parity',
                shader,
                pipelineState: {
                    ...DEFAULT_MATERIAL_PIPELINE_STATE,
                    depthTest: false,
                    depthWrite: false,
                    cullMode: 'none'
                }
            });
            const renderer = await Renderer.create({
                backend,
                width: 2,
                height: 2,
                domElement: document.createElement('canvas'),
                antialias: false,
                renderPipeline: {
                    name: 'GI normalization parity',
                    create: () => ({
                        name: 'GI normalization parity',
                        record(frame): void {
                            frame.graph.addPass(pass, {
                                inputTextures: [frame.graph.importTexture(source)],
                                colorAttachments: [
                                    {
                                        texture: frame.graph.importOutput().color(0),
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
                    })
                }
            });
            const target = renderer.createRenderTarget({
                width: 2,
                height: 2,
                colorAttachments: [{ format: 'rgba8unorm' }]
            });
            try {
                renderer.renderToTarget(target, new Node(), new PerspectiveCamera());
                await renderer.waitForIdle();
                expect(Array.from((await target.readColorAttachment()).data)).toEqual(
                    Array.from(pixels)
                );
            } finally {
                target.destroy();
                renderer.destroy();
                source.destroy();
            }
        }
    );

    it('preserves radiance above one from real RGBA16F texels and restores half-float recovery data', async () => {
        const hdr = new Texture({
            width: 1,
            height: 1,
            internalFormat: RGBA16F,
            format: RGBA,
            type: HALF_FLOAT,
            image: new Uint16Array([0x4400, 0, 0, 0x3c00]), // Linear RGBA = (4, 0, 0, 1).
            minFilter: NEAREST,
            magFilter: NEAREST,
            isImageCanRelease: true
        });
        const unitRed = rgbaReference(255);
        const fixture = await transportFixture(hdr);
        try {
            const fromHDR = await fixture.capture();
            expect(redEnergy(fromHDR)).toBeGreaterThan(1000);
            expect(hdr.isImageReleased).toBe(true);
            fixture.material.setTextureSlot('emission', { texture: unitRed, encoding: 'linear' });
            fixture.material.emissionFactor.set(4, 4, 4, 1);
            const scaledReference = await fixture.capture();
            expect(maximumRGBDifference(fromHDR, scaledReference)).toBeLessThanOrEqual(1);
            fixture.material.emissionFactor.set(1, 1, 1, 1);
            const clippedReference = await fixture.capture();
            expect(redEnergy(fromHDR)).toBeGreaterThan(redEnergy(clippedReference) * 1.25);
            fixture.material.setTextureSlot('emission', { texture: hdr, encoding: 'linear' });
            expect(maximumRGBDifference(await fixture.capture(8), fromHDR)).toBeLessThanOrEqual(1);
            fixture.releaseGPUResources();
            const restored = await fixture.capture();
            expect(maximumRGBDifference(restored, fromHDR)).toBeLessThanOrEqual(1);
            fixture.factory.setDynamicGlobalIlluminationIntensity(0);
            expect(redEnergy(await fixture.capture(2))).toBeLessThan(redEnergy(fromHDR) * 0.05);
        } finally {
            fixture.destroy();
            hdr.destroy();
            unitRed.destroy();
        }
    }, 120_000);

    it('transports native BC1 KTX hardware-sRGB samples with the same energy as an uncompressed sRGB reference', async () => {
        const compressed = midRedBC1SRGB();
        const directional = midRedBC1SRGB(0x55550000);
        const reference = rgbaReference(132);
        const fixture = await transportFixture(compressed);
        try {
            // The standard software-WebGPU test lane supports the existing BC capability.
            // Failure is explicit if a runner cannot provide it; this evidence is never skipped.
            expect(fixture.renderer.supportsTextureCompression('bc')).toBe(true);
            expect(compressed.compressed).toBe(true);
            expect(compressed.internalFormat).toBe(COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT);
            fixture.material.emissionFactor.set(4, 4, 4, 1);
            const nativeSRGB = await fixture.capture();
            expect(redEnergy(nativeSRGB)).toBeGreaterThan(1000);
            expect(compressed.isImageReleased).toBe(true);
            // BC1-sRGB is already decoded by textureLoad. An ordinary rgba8unorm reference
            // instead requests the shared material sRGB conversion exactly once.
            fixture.material.setTextureSlot('emission', { texture: reference, encoding: 'srgb' });
            const decodedReference = await fixture.capture();
            expect(maximumRGBDifference(nativeSRGB, decodedReference)).toBeLessThanOrEqual(2);
            fixture.material.setTextureSlot('emission', { texture: reference, encoding: 'linear' });
            const wrongEncoding = await fixture.capture();
            expect(redEnergy(wrongEncoding)).toBeGreaterThan(redEnergy(nativeSRGB) * 1.15);
            fixture.material.setTextureSlot('emission', {
                texture: compressed,
                encoding: 'linear'
            });
            const stableCompressed = await fixture.capture(8);
            expect(
                maximumRGBDifference(stableCompressed, nativeSRGB),
                JSON.stringify({
                    nativeEnergy: redEnergy(nativeSRGB),
                    stableEnergy: redEnergy(stableCompressed),
                    wrongEncodingEnergy: redEnergy(wrongEncoding)
                })
            ).toBeLessThanOrEqual(2);
            fixture.releaseGPUResources();
            const restored = await fixture.capture();
            expect(maximumRGBDifference(restored, nativeSRGB)).toBeLessThanOrEqual(2);
            const top = new Matrix3();
            top.elements[7] = -0.25;
            fixture.material.setTextureSlot('emission', {
                texture: directional,
                encoding: 'linear',
                transform: top
            });
            expect(maximumRGBDifference(await fixture.capture(), nativeSRGB)).toBeLessThanOrEqual(
                2
            );
            const bottom = new Matrix3();
            bottom.elements[7] = 0.25;
            fixture.material.setTextureSlot('emission', {
                texture: directional,
                encoding: 'linear',
                transform: bottom
            });
            expect(redEnergy(await fixture.capture())).toBeLessThan(redEnergy(nativeSRGB) * 0.05);
            fixture.material.setTextureSlot('emission', {
                texture: compressed,
                encoding: 'linear'
            });
            expect(maximumRGBDifference(await fixture.capture(), nativeSRGB)).toBeLessThanOrEqual(
                2
            );
            fixture.factory.setDynamicGlobalIlluminationIntensity(0);
            expect(redEnergy(await fixture.capture(2))).toBeLessThan(redEnergy(nativeSRGB) * 0.05);
        } finally {
            fixture.destroy();
            compressed.destroy();
            directional.destroy();
            reference.destroy();
        }
    }, 120_000);
});
