import { describe, expect, it } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import PlaneGeometry from '../../../src/geometry/PlaneGeometry';
import DirectionalLight from '../../../src/light/DirectionalLight';
import PBRMaterial from '../../../src/material/PBRMaterial';
import Color from '../../../src/math/Color';
import Vector3 from '../../../src/math/Vector3';
import Renderer from '../../../src/render/Renderer';

const RADIANCE = 3;
const GRAZING_COSINE = 0.25;
const FRONT_COSINE = 0.8;

// Each rgba8unorm read can differ from the exact linear value by at most one byte
// step, allowing either backend's rounding. Divide each independent error by its
// own incident cosine and radiance, then add a small FP32 transform allowance.
const RECIPROCITY_TOLERANCE =
    (1 / (255 * RADIANCE)) * (1 / GRAZING_COSINE + 1 / FRONT_COSINE) + 0.00002;

describe.each(['webgl2', 'webgpu'] as const)('Rendered sheen reciprocity on %s', backend => {
    it('preserves the combined diffuse base and sheen when view and light directions swap', async () => {
        const renderer = await Renderer.create({
            backend,
            width: 1,
            height: 1,
            antialias: false,
            domElement: document.createElement('canvas'),
            clearColor: new Color(0, 0, 0, 0)
        });
        const output = renderer.createRenderTarget({
            width: 1,
            height: 1,
            colorAttachments: [{ format: 'rgba8unorm' }],
            depthStencilAttachment: { format: 'depth32float' }
        });
        const scene = new Node();
        new Mesh({
            geometry: new PlaneGeometry({ width: 20, height: 20 }),
            material: new PBRMaterial({
                baseColor: new Color(0.35, 0.25, 0.15),
                metallic: 0,
                roughness: 0.7,
                sheenColor: new Color(0.8, 0.55, 0.3),
                sheenRoughness: 0.5,
                opacity: 1
            })
        }).addTo(scene);
        const light = new DirectionalLight({
            amount: RADIANCE,
            color: new Color(1, 1, 1)
        }).addTo(scene);
        const camera = new PerspectiveCamera({ near: 0.1, far: 20, aspect: 1, fov: 45 });
        const origin = new Vector3();
        const grazing = new Vector3(Math.sqrt(1 - GRAZING_COSINE ** 2), 0, GRAZING_COSINE);
        const frontSine = Math.sqrt(1 - FRONT_COSINE ** 2);
        const front = new Vector3(
            frontSine * 0.3,
            frontSine * Math.sqrt(1 - 0.3 ** 2),
            FRONT_COSINE
        );
        const sample = async (view: Vector3, incoming: Vector3): Promise<Uint8Array> => {
            camera.x = view.x * 3;
            camera.y = view.y * 3;
            camera.z = view.z * 3;
            camera.lookAt(origin);
            light.direction.set(-incoming.x, -incoming.y, -incoming.z);
            // A one-pixel target samples NDC (0, 0), so both views hit precisely
            // the same world-space origin rather than adjacent surface points.
            renderer.renderToTarget(output, scene, camera);
            return (await output.readColorAttachment()).data;
        };
        try {
            const first = await sample(grazing, front);
            const reverse = await sample(front, grazing);
            expect(first[3]).toBe(255);
            expect(reverse[3]).toBe(255);
            for (const channel of [0, 1, 2]) {
                const firstByte = first[channel];
                const reverseByte = reverse[channel];
                if (firstByte === undefined || reverseByte === undefined) {
                    throw new Error('Missing rendered RGB channel');
                }
                expect(firstByte).toBeGreaterThan(3);
                expect(reverseByte).toBeGreaterThan(3);
                expect(firstByte).toBeLessThan(252);
                expect(reverseByte).toBeLessThan(252);
                const forwardBRDF = firstByte / (255 * RADIANCE * FRONT_COSINE);
                const reverseBRDF = reverseByte / (255 * RADIANCE * GRAZING_COSINE);
                expect(Math.abs(forwardBRDF - reverseBRDF)).toBeLessThanOrEqual(
                    RECIPROCITY_TOLERANCE
                );
            }
        } finally {
            output.destroy();
            renderer.destroy();
        }
    }, 30_000);
});
