import { describe, expect, it } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import SkinnedMesh from '../../../src/core/SkinnedMesh';
import Skeleton from '../../../src/core/Skeleton';
import MorphGeometry from '../../../src/geometry/MorphGeometry';
import Matrix4 from '../../../src/math/Matrix4';
import Node from '../../../src/core/Node';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import GeometryData from '../../../src/geometry/GeometryData';
import PBRMaterial from '../../../src/material/PBRMaterial';
import Color from '../../../src/math/Color';
import Matrix3 from '../../../src/math/Matrix3';
import Vector3 from '../../../src/math/Vector3';
import DirectionalLight from '../../../src/light/DirectionalLight';
import { DecalProjector } from '../../../src/render/decals/DecalProjector';
import Texture from '../../../src/texture/Texture';
import { NEAREST } from '../../../src/constants/webgl';
import Renderer from '../../../src/render/Renderer';
import { ClusteredForwardPlusPipelineFactory } from '../../../src/render/pipeline/ClusteredForwardPlus';

function totals(bytes: Uint8Array): readonly [number, number, number] {
    const result: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < bytes.length; i += 4) {
        result[0] += bytes[i] ?? 0;
        result[1] += bytes[i + 1] ?? 0;
        result[2] += bytes[i + 2] ?? 0;
    }
    return result;
}

describe('DDGI real asset transport', () => {
    it('samples asymmetric UV1 emissive texels and alpha-mask blockers outside the camera, including uploads and recovery', async () => {
        const scene = new Node();
        const floorGeometry = new BoxGeometry({ width: 5, height: 0.2, depth: 5 });
        const floorMaterial = new PBRMaterial({
            baseColor: new Color(0.8, 0.8, 0.8),
            metallic: 0,
            roughness: 1
        });
        new Mesh({ geometry: floorGeometry, material: floorMaterial, y: -0.1 }).addTo(scene);
        const emitterGeometry = new BoxGeometry({ width: 0.1, height: 2.5, depth: 3 });
        const vertexCount = emitterGeometry.vertices?.count ?? 0;
        const uv1 = new Float32Array(vertexCount * 2).fill(0.75);
        emitterGeometry.uvs1 = new GeometryData(uv1, 2);
        const image = new Uint8Array([
            255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255
        ]);
        const emission = new Texture({
            image,
            width: 2,
            height: 2,
            magFilter: NEAREST,
            minFilter: NEAREST
        });
        const transform = new Matrix3();
        transform.elements[6] = -0.5;
        transform.elements[7] = -0.5;
        const emitterMaterial = new PBRMaterial({
            baseColor: new Color(0, 0, 0),
            emissionFactor: new Color(3, 3, 3),
            emission: { texture: emission, uvSet: 1, transform },
            metallic: 0,
            roughness: 1
        });
        new Mesh({
            geometry: emitterGeometry,
            material: emitterMaterial,
            x: -2.2,
            y: 1.3,
            useInstanced: true
        }).addTo(scene);
        const barrierBase = new BoxGeometry({ width: 0.12, height: 8, depth: 12 }).setAllRectUV([
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1]
        ]);
        const barrierVertexCount = barrierBase.vertices?.count ?? 0;
        const skinWeights = new Float32Array(barrierVertexCount * 4);
        const morphOffsets = new Float32Array(barrierVertexCount * 3);
        for (let vertex = 0; vertex < barrierVertexCount; vertex++) {
            skinWeights[vertex * 4] = 1;
            morphOffsets[vertex * 3] = 8;
        }
        const barrierGeometry = new MorphGeometry({
            vertices: barrierBase.vertices,
            normals: barrierBase.normals,
            uvs: barrierBase.uvs,
            indices: barrierBase.indices,
            skinIndices: new GeometryData(new Uint8Array(barrierVertexCount * 4), 4),
            skinWeights: new GeometryData(skinWeights, 4),
            weights: [0],
            targets: { vertices: [new GeometryData(morphOffsets, 3)] }
        });
        const mask = new Texture({
            image: new Uint8Array([255, 255, 255, 0]),
            width: 1,
            height: 1,
            magFilter: NEAREST,
            minFilter: NEAREST
        });
        const barrierMaterial = new PBRMaterial({
            baseColor: new Color(0, 0, 0),
            baseColorMap: mask,
            coverage: { mode: 'mask', cutoff: 0.5 },
            metallic: 0,
            roughness: 1
        });
        const joint = new Node();
        const barrier = new SkinnedMesh({
            skeleton: new Skeleton({
                jointNodeList: [joint],
                inverseBindMatrices: [new Matrix4()]
            }),
            geometry: barrierGeometry,
            material: barrierMaterial,
            x: -1.3,
            y: 2
        }).addTo(scene);
        joint.addTo(barrier);
        const factory = new ClusteredForwardPlusPipelineFactory({
            buckets: [
                { geometry: floorGeometry, material: floorMaterial },
                { geometry: emitterGeometry, material: emitterMaterial }
            ],
            maxObjects: 8,
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
                maxTriangles: 128,
                maxMeshes: 8,
                maxTextureTexels: 8,
                maxRayDistance: 16,
                hysteresis: 0,
                environment: new Color(0, 0, 0),
                bounceStrength: 0
            }
        });
        const renderer = await Renderer.create({
            domElement: document.createElement('canvas'),
            backend: 'webgpu',
            width: 32,
            height: 32,
            antialias: false,
            renderPipeline: factory
        });
        renderer.clearColor = new Color(0, 0, 0);
        let target = renderer.createRenderTarget({
            width: 32,
            height: 32,
            colorAttachments: [{ format: 'rgba8unorm' }],
            depthStencilAttachment: { format: 'depth32float' }
        });
        const camera = new PerspectiveCamera({ aspect: 1, near: 0.1, far: 12, fov: 24 });
        camera.setPosition(0, 2.5, 2.5).lookAt(new Vector3(0, 0, 0));
        const render = async (frames = 6): Promise<readonly [number, number, number]> => {
            for (let frame = 0; frame < frames; frame++) {
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
            }
            return totals((await target.readColorAttachment()).data);
        };
        try {
            const red = await render();
            expect(red[0]).toBeGreaterThan(1000);
            expect(red[0]).toBeGreaterThan(red[1] * 3);
            mask.image = new Uint8Array([255, 255, 255, 255]);
            const closed = await render();
            expect(closed[0]).toBeLessThan(red[0] * 0.2);
            joint.x = -8;
            const skinnedOpen = await render();
            expect(skinnedOpen[0]).toBeGreaterThan(red[0] * 0.65);
            joint.x = 0;
            barrierGeometry.weights[0] = 1;
            const morphedOpen = await render();
            expect(morphedOpen[0]).toBeGreaterThan(red[0] * 0.65);
            barrierGeometry.weights[0] = 0;
            mask.image = new Uint8Array([255, 255, 255, 0]);
            transform.elements[6] = 0;
            const green = await render();
            expect(green[1]).toBeGreaterThan(1000);
            expect(green[1]).toBeGreaterThan(green[0] * 3);
            transform.elements[6] = -0.5;
            transform.elements[7] = 0;
            const blue = await render();
            expect(blue[2]).toBeGreaterThan(1000);
            expect(blue[2]).toBeGreaterThan(blue[0] * 3);
            emission.image = new Uint8Array(16).fill(0);
            const dark = await render();
            expect(dark[2]).toBeLessThan(blue[2] * 0.05);
            emission.image = image;
            renderer.releaseGPUResources();
            target = renderer.createRenderTarget({
                width: 32,
                height: 32,
                colorAttachments: [{ format: 'rgba8unorm' }],
                depthStencilAttachment: { format: 'depth32float' }
            });
            const restored = await render();
            expect(restored[2]).toBeGreaterThan(blue[2] * 0.8);
            factory.setDynamicGlobalIlluminationIntensity(0);
            const disabled = await render(2);
            expect(disabled[2]).toBeLessThan(blue[2] * 0.05);
        } finally {
            target.destroy();
            renderer.destroy();
            emission.destroy();
            mask.destroy();
        }
    }, 120_000);

    it('transports projected decal pigment and normal changes from an offscreen lit wall', async () => {
        const scene = new Node();
        const floorGeometry = new BoxGeometry({ width: 5, height: 0.2, depth: 5 });
        const floorMaterial = new PBRMaterial({
            baseColor: new Color(0.8, 0.8, 0.8),
            metallic: 0,
            roughness: 1
        });
        new Mesh({ geometry: floorGeometry, material: floorMaterial, y: -0.1, layer: 1 }).addTo(
            scene
        );
        const wallGeometry = new BoxGeometry({ width: 0.1, height: 2.5, depth: 3 }).setAllRectUV([
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1]
        ]);
        const decalAtlas = new Texture({
            image: new Uint8Array([255, 0, 0, 255]),
            width: 1,
            height: 1,
            magFilter: NEAREST,
            minFilter: NEAREST
        });
        const normalAtlas = new Texture({
            image: new Uint8Array([128, 128, 255, 255]),
            width: 1,
            height: 1,
            magFilter: NEAREST,
            minFilter: NEAREST
        });
        const projector = new DecalProjector({
            transform: new Matrix4()
                .fromTranslation(new Vector3(-2.2, 1.3, 0))
                .rotateY(Math.PI / 2)
                .scale(new Vector3(4, 4, 0.5)),
            edgeFade: 0,
            normalFade: 0
        });
        const surfaceNormal = new Texture({
            image: new Uint8Array([128, 128, 255, 255]),
            width: 1,
            height: 1,
            magFilter: NEAREST,
            minFilter: NEAREST
        });
        const pigment = new Texture({
            image: new Uint8Array([255, 255, 255, 255]),
            width: 1,
            height: 1,
            magFilter: NEAREST,
            minFilter: NEAREST
        });
        const metal = new Texture({
            image: new Uint8Array([0, 0, 0, 255]),
            width: 1,
            height: 1,
            magFilter: NEAREST,
            minFilter: NEAREST
        });
        const wallMaterial = new PBRMaterial({
            baseColorMap: pigment,
            metallicMap: metal,
            normalMap: surfaceNormal,
            decals: { projectors: [projector], baseColorAtlas: decalAtlas, normalAtlas },
            baseColor: new Color(0.8, 0.8, 0.8),
            metallic: 1,
            roughness: 1
        });
        new Mesh({
            geometry: wallGeometry,
            material: wallMaterial,
            x: -2.2,
            y: 1.3,
            layer: 2
        }).addTo(scene);
        new DirectionalLight({
            color: new Color(1, 1, 1),
            amount: 5,
            direction: new Vector3(-1, 0, 0),
            lightLayerMask: 2
        }).addTo(scene);
        const factory = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry: floorGeometry, material: floorMaterial }],
            maxObjects: 8,
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
                maxTriangles: 128,
                maxMeshes: 4,
                maxTextureTexels: 8,
                maxRayDistance: 12,
                hysteresis: 0,
                environment: new Color(0, 0, 0),
                bounceStrength: 0
            }
        });
        const renderer = await Renderer.create({
            domElement: document.createElement('canvas'),
            backend: 'webgpu',
            width: 32,
            height: 32,
            antialias: false,
            renderPipeline: factory
        });
        renderer.clearColor = new Color(0, 0, 0);
        let target = renderer.createRenderTarget({
            width: 32,
            height: 32,
            colorAttachments: [{ format: 'rgba8unorm' }],
            depthStencilAttachment: { format: 'depth32float' }
        });
        const camera = new PerspectiveCamera({ aspect: 1, near: 0.1, far: 12, fov: 24 });
        camera.setPosition(0, 2.5, 2.5).lookAt(new Vector3(0, 0, 0));
        const render = async (frames: number): Promise<readonly [number, number, number]> => {
            for (let frame = 0; frame < frames; frame++) {
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
            }
            return totals((await target.readColorAttachment()).data);
        };
        try {
            factory.setDynamicGlobalIlluminationIntensity(0);
            const baseline = await render(2);
            expect(baseline[0]).toBeLessThan(50);
            factory.setDynamicGlobalIlluminationIntensity(1);
            const red = await render(4);
            expect(red[0]).toBeGreaterThan(baseline[0] + 500);
            expect(red[0]).toBeGreaterThan(red[2] * 2);
            decalAtlas.image = new Uint8Array([0, 255, 0, 255]);
            const green = await render(4);
            expect(green[1]).toBeGreaterThan(green[0] * 2);
            expect(green[1]).toBeGreaterThan(green[2] * 2);
            metal.image = new Uint8Array([255, 255, 255, 255]);
            const metallic = await render(4);
            expect(metallic[1]).toBeLessThan(green[1] * 0.05);
            metal.image = new Uint8Array([0, 0, 0, 255]);
            surfaceNormal.image = new Uint8Array([255, 128, 128, 255]);
            const surfaceTilt = await render(4);
            expect(surfaceTilt[1]).toBeLessThan(green[1] * 0.75);
            surfaceNormal.image = new Uint8Array([128, 128, 255, 255]);
            normalAtlas.image = new Uint8Array([255, 128, 128, 255]);
            const tilted = await render(4);
            expect(tilted[1]).toBeLessThan(green[1] * 0.75);
            normalAtlas.image = new Uint8Array([128, 128, 255, 255]);
            projector.update({ enabled: false });
            const unpainted = await render(4);
            expect(Math.abs(unpainted[0] - unpainted[1])).toBeLessThan(unpainted[1] * 0.05);
            pigment.image = new Uint8Array([0, 0, 255, 255]);
            const bluePigment = await render(4);
            expect(bluePigment[2]).toBeGreaterThan(bluePigment[0] * 2);
            expect(bluePigment[2]).toBeGreaterThan(500);
            pigment.image = new Uint8Array([255, 255, 255, 255]);
            projector.update({ enabled: true, layer: 0 });
            const excluded = await render(4);
            expect(Math.abs(excluded[0] - excluded[1])).toBeLessThan(excluded[1] * 0.05);
            projector.update({ layer: 0xffffffff });
            renderer.releaseGPUResources();
            target = renderer.createRenderTarget({
                width: 32,
                height: 32,
                colorAttachments: [{ format: 'rgba8unorm' }],
                depthStencilAttachment: { format: 'depth32float' }
            });
            const recovered = await render(4);
            expect(recovered[1]).toBeGreaterThan(green[1] * 0.8);
            expect(recovered[1]).toBeGreaterThan(recovered[0] * 2);
            factory.setDynamicGlobalIlluminationIntensity(0);
            expect((await render(2))[1]).toBeLessThan(50);
        } finally {
            target.destroy();
            renderer.destroy();
            decalAtlas.destroy();
            normalAtlas.destroy();
            surfaceNormal.destroy();
            pigment.destroy();
            metal.destroy();
        }
    }, 120_000);
});
