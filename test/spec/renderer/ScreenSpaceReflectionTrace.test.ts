import { describe, expect, it } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import PlaneGeometry from '../../../src/geometry/PlaneGeometry';
import PBRMaterial from '../../../src/material/PBRMaterial';
import Color from '../../../src/math/Color';
import Vector3 from '../../../src/math/Vector3';
import Renderer from '../../../src/render/Renderer';
import { ClusteredForwardPlusPipelineFactory } from '../../../src/render/pipeline/ClusteredForwardPlus';

describe.each(['standard', 'reversed'] as const)('SSR thin surfaces with %s depth', depthMode => {
    it('resolves a continuous reflection when stride is much larger than surface thickness', async () => {
        const floorGeometry = new PlaneGeometry({ width: 12, height: 12 });
        const floorMaterial = new PBRMaterial({
            metallic: 1,
            roughness: 0.08,
            baseColor: new Color(1, 1, 1)
        });
        const cardGeometry = new BoxGeometry({ width: 2, height: 1.4, depth: 0.04 });
        const cardMaterial = new PBRMaterial({ unlit: true, baseColor: new Color(1, 0, 0) });
        const factory = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry: floorGeometry, material: floorMaterial }],
            maxObjects: 2,
            maxLights: 1,
            maxLightIndices: 1,
            maxLightsPerCluster: 1,
            maxViewportWidth: 96,
            maxViewportHeight: 96,
            bloomStrength: 0,
            temporalAA: { historyWeight: 0, sharpness: 0 },
            screenSpaceReflections: {
                resolutionScale: 1,
                stride: 0.3,
                thickness: 0.002,
                maxRayDistance: 20,
                maxSteps: 96
            }
        });
        const renderer = await Renderer.create({
            backend: 'webgpu',
            width: 96,
            height: 96,
            antialias: false,
            renderPipeline: factory,
            domElement: document.createElement('canvas')
        });
        const target = renderer.createRenderTarget({
            width: 96,
            height: 96,
            colorAttachments: [{ format: 'rgba8unorm' }],
            depthStencilAttachment: { format: 'depth32float', depthMode }
        });
        const scene = new Node();
        new Mesh({ geometry: floorGeometry, material: floorMaterial, rotationX: -90 }).addTo(scene);
        new Mesh({ geometry: cardGeometry, material: cardMaterial, y: 0.9 }).addTo(scene);
        const camera = new PerspectiveCamera({ near: 0.1, far: 30, depthMode });
        camera.setPosition(0, 2.5, 5).lookAt(new Vector3(0, 0.4, 0));
        try {
            for (let frame = 0; frame < 4; frame++) {
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
            }
            const reflected = await target.readColorAttachment({
                x: 36,
                y: 62,
                width: 24,
                height: 12
            });
            let reflectedPixels = 0;
            for (let offset = 0; offset < reflected.data.length; offset += 4) {
                if (
                    (reflected.data[offset] ?? 0) > 30 &&
                    (reflected.data[offset] ?? 0) > (reflected.data[offset + 1] ?? 0) * 2
                )
                    reflectedPixels++;
            }
            // Check raw hits as well as the filtered image: spatial hole filling can hide
            // a broken traversal even when most of the reflection has no valid samples.
            expect(
                (await factory.readDiagnostics()).screenSpaceReflectionHitPixelCount
            ).toBeGreaterThan(350);
            expect(reflectedPixels).toBeGreaterThan(220);
            floorMaterial.roughness = 1;
            for (let frame = 0; frame < 2; frame++) {
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
            }
            const disabled = await target.readColorAttachment({
                x: 36,
                y: 62,
                width: 24,
                height: 12
            });
            expect(
                Math.max(...disabled.data.filter((_value, index) => index % 4 === 0))
            ).toBeLessThan(10);
        } finally {
            target.destroy();
            renderer.destroy();
        }
    }, 20_000);
});
