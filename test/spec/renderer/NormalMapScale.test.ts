import { describe, expect, it } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import { RGBA, UNSIGNED_BYTE } from '../../../src/constants/webgl';
import { RGBA8 } from '../../../src/constants/webgl2';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import PlaneGeometry from '../../../src/geometry/PlaneGeometry';
import DirectionalLight from '../../../src/light/DirectionalLight';
import PBRMaterial from '../../../src/material/PBRMaterial';
import Color from '../../../src/math/Color';
import Vector3 from '../../../src/math/Vector3';
import Renderer from '../../../src/render/Renderer';
import Texture from '../../../src/texture/Texture';

// A uniform tilted normal makes this a lighting contract, independent of texture filtering,
// temporal sampling, or a particular image baseline.
describe.each(['webgl2', 'webgpu'] as const)('normal map scale through %s', backend => {
    it('updates lighting through the material uniform, including scale zero', async () => {
        const renderer = await Renderer.create({
            backend,
            width: 16,
            height: 16,
            antialias: false,
            domElement: document.createElement('canvas')
        });
        const target = renderer.createRenderTarget({ width: 16, height: 16 });
        const normalMap = new Texture({
            image: new Uint8Array([240, 128, 192, 255]),
            width: 1,
            height: 1,
            internalFormat: RGBA8,
            format: RGBA,
            type: UNSIGNED_BYTE
        });
        const material = new PBRMaterial({
            baseColor: new Color(0.5, 0.5, 0.5),
            metallic: 0,
            roughness: 1,
            normalMap,
            normalScale: 1
        });
        const scene = new Node();
        new Mesh({ geometry: new PlaneGeometry({ width: 4, height: 4 }), material }).addTo(scene);
        new DirectionalLight({ amount: 1, direction: new Vector3(0, 0, -1) }).addTo(scene);
        const camera = new PerspectiveCamera({ near: 0.1, far: 10 });
        camera.setPosition(0, 0, 3).lookAt(new Vector3());
        const renderRed = async (): Promise<number> => {
            renderer.renderToTarget(target, scene, camera);
            const result = await target.readColorAttachment({ x: 8, y: 8, width: 1, height: 1 });
            return result.data[0] ?? 0;
        };
        try {
            const tilted = await renderRed();
            material.normalScale = 0;
            const flat = await renderRed();
            material.normalScale = 0.5;
            const half = await renderRed();
            material.normalScale = 1;
            const restored = await renderRed();
            expect(flat).toBeGreaterThan(tilted + 12);
            expect(half).toBeGreaterThan(tilted + 5);
            expect(half).toBeLessThan(flat - 5);
            expect(restored).toBe(tilted);
        } finally {
            target.destroy();
            renderer.destroy();
        }
    });
});
