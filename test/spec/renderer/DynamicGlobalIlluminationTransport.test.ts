import { describe, expect, it } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import PointLight from '../../../src/light/PointLight';
import PBRMaterial from '../../../src/material/PBRMaterial';
import Color from '../../../src/math/Color';
import Vector3 from '../../../src/math/Vector3';
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

describe('DDGI offscreen visibility and dynamic direct-light transport', () => {
    it('blocks offscreen emissive transport when a rigid wall closes, then restores it when the wall moves away', async () => {
        const scene = new Node();
        const floorGeometry = new BoxGeometry({ width: 5, height: 0.2, depth: 5 });
        const floorMaterial = new PBRMaterial({
            baseColor: new Color(0.8, 0.8, 0.8),
            metallic: 0,
            roughness: 1
        });
        new Mesh({ geometry: floorGeometry, material: floorMaterial, y: -0.1 }).addTo(scene);
        const emitterGeometry = new BoxGeometry({ width: 0.1, height: 2.5, depth: 3 });
        const emitterMaterial = new PBRMaterial({
            baseColor: new Color(0, 0, 0),
            emissionFactor: new Color(3, 0, 0),
            metallic: 0,
            roughness: 1
        });
        new Mesh({ geometry: emitterGeometry, material: emitterMaterial, x: -2.2, y: 1.3 }).addTo(
            scene
        );
        const barrierGeometry = new BoxGeometry({ width: 0.12, height: 8, depth: 12 });
        const barrierMaterial = new PBRMaterial({
            baseColor: new Color(0, 0, 0),
            metallic: 0,
            roughness: 1
        });
        const barrier = new Mesh({
            geometry: barrierGeometry,
            material: barrierMaterial,
            x: -8,
            y: 2
        }).addTo(scene);
        const factory = new ClusteredForwardPlusPipelineFactory({
            buckets: [
                { geometry: floorGeometry, material: floorMaterial },
                { geometry: emitterGeometry, material: emitterMaterial },
                { geometry: barrierGeometry, material: barrierMaterial }
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
        const target = renderer.createRenderTarget({
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
            const open = await render(4);
            expect(open[0]).toBeGreaterThan(1000);
            barrier.x = -1.3;
            const closed = await render(6);
            expect(closed[0]).toBeLessThan(open[0] * 0.2);
            barrier.x = -8;
            const reopened = await render(6);
            expect(reopened[0]).toBeGreaterThan(open[0] * 0.65);
        } finally {
            target.destroy();
            renderer.destroy();
        }
    }, 120_000);

    it('converges without static flashes across budgeted 64-ray probe updates', async () => {
        const scene = new Node();
        const floorGeometry = new BoxGeometry({ width: 5, height: 0.2, depth: 5 });
        const floorMaterial = new PBRMaterial({
            baseColor: new Color(0.8, 0.8, 0.8),
            metallic: 0,
            roughness: 1
        });
        new Mesh({ geometry: floorGeometry, material: floorMaterial, y: -0.1 }).addTo(scene);
        const emitterGeometry = new BoxGeometry({ width: 0.1, height: 2.5, depth: 3 });
        const emitterMaterial = new PBRMaterial({
            baseColor: new Color(0, 0, 0),
            emissionFactor: new Color(3, 0, 0),
            metallic: 0,
            roughness: 1
        });
        new Mesh({ geometry: emitterGeometry, material: emitterMaterial, x: -2.2, y: 1.3 }).addTo(
            scene
        );
        const barrierGeometry = new BoxGeometry({ width: 0.12, height: 8, depth: 12 });
        const barrierMaterial = new PBRMaterial({
            baseColor: new Color(0, 0, 0),
            metallic: 0,
            roughness: 1
        });
        new Mesh({
            geometry: barrierGeometry,
            material: barrierMaterial,
            x: -8,
            y: 2
        }).addTo(scene);
        const factory = new ClusteredForwardPlusPipelineFactory({
            buckets: [
                { geometry: floorGeometry, material: floorMaterial },
                { geometry: emitterGeometry, material: emitterMaterial },
                { geometry: barrierGeometry, material: barrierMaterial }
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
                maxProbesPerFrame: 7,
                raysPerProbe: 64,
                maxTriangles: 128,
                maxRayDistance: 16,
                hysteresis: 0.88,
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
        const target = renderer.createRenderTarget({
            width: 32,
            height: 32,
            colorAttachments: [{ format: 'rgba8unorm' }],
            depthStencilAttachment: { format: 'depth32float' }
        });
        const camera = new PerspectiveCamera({ aspect: 1, near: 0.1, far: 12, fov: 24 });
        camera.setPosition(0, 2.5, 2.5).lookAt(new Vector3(0, 0, 0));
        const draw = async (): Promise<void> => {
            renderer.renderToTarget(target, scene, camera);
            await renderer.waitForIdle();
        };
        try {
            for (let frame = 0; frame < 70; frame++) await draw();
            let previous = (await target.readColorAttachment()).data;
            expect(totals(previous)[0]).toBeGreaterThan(1000);
            let maximumChannelChange = 0;
            let totalAbsoluteChange = 0;
            for (let frame = 0; frame < 28; frame++) {
                await draw();
                const current = (await target.readColorAttachment()).data;
                for (let pixel = 0; pixel < current.length; pixel += 4) {
                    for (let channel = 0; channel < 3; channel++) {
                        const difference = Math.abs(
                            (current[pixel + channel] ?? 0) - (previous[pixel + channel] ?? 0)
                        );
                        maximumChannelChange = Math.max(maximumChannelChange, difference);
                        totalAbsoluteChange += difference;
                    }
                }
                previous = current;
            }
            expect(maximumChannelChange).toBeLessThanOrEqual(1);
            expect(totalAbsoluteChange / (28 * 32 * 32 * 3)).toBeLessThan(0.03);
        } finally {
            target.destroy();
            renderer.destroy();
        }
    }, 120_000);

    it('transports a moving point lamp through offscreen surfaces and respects their per-mesh light layers', async () => {
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
        const wallGeometry = new BoxGeometry({ width: 0.1, height: 2.5, depth: 3 });
        const wallMaterial = new PBRMaterial({
            baseColor: new Color(0.8, 0.8, 0.8),
            metallic: 0,
            roughness: 1
        });
        new Mesh({
            geometry: wallGeometry,
            material: wallMaterial,
            x: -2.2,
            y: 1.3,
            layer: 2
        }).addTo(scene);
        const light = new PointLight({
            color: new Color(1, 0, 0),
            amount: 5,
            range: 0,
            x: -1.8,
            y: 1.5,
            lightLayerMask: 2
        }).addTo(scene);
        const factory = new ClusteredForwardPlusPipelineFactory({
            buckets: [
                { geometry: floorGeometry, material: floorMaterial },
                { geometry: wallGeometry, material: wallMaterial }
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
        const target = renderer.createRenderTarget({
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
            light.color.set(0, 0, 1, 1);
            light.z = 0.7;
            const blue = await render(4);
            expect(blue[2]).toBeGreaterThan(blue[0] * 2);
            // Keep the lamp white and change only an offscreen wall's diffuse pigment.
            // The visible floor has layer 1, so it cannot receive this lamp directly.
            light.color.set(1, 1, 1, 1);
            wallMaterial.baseColor.set(0.8, 0.02, 0.02, 1);
            wallMaterial.invalidateData();
            const paintedRed = await render(4);
            expect(paintedRed[0]).toBeGreaterThan(paintedRed[1] * 2);
            wallMaterial.baseColor.set(0.02, 0.8, 0.02, 1);
            wallMaterial.invalidateData();
            const paintedGreen = await render(4);
            expect(paintedGreen[1]).toBeGreaterThan(paintedGreen[0] * 2);
            expect(paintedGreen[1]).toBeGreaterThan(paintedGreen[2] * 2);
            light.lightLayerMask = 4;
            const masked = await render(4);
            expect(masked[1]).toBeLessThan(paintedGreen[1] * 0.1);
        } finally {
            target.destroy();
            renderer.destroy();
        }
    }, 120_000);
});
