import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const container = document.querySelector<HTMLElement>('#stage');
if (!container) throw new Error('Expected the shared test stage container to exist');

describe('display:geometry', () => {
    const camera = new Hilo3d.PerspectiveCamera({
        aspect: innerWidth / innerHeight,
        far: 100,
        near: 0.1,
        z: 3
    });
    let stage: Hilo3d.Stage<'webgl2'>;
    const material = new Hilo3d.BasicMaterial();
    const mesh = new Hilo3d.Mesh({ material, rotationX: -60, rotationY: 30 });

    beforeAll(async () => {
        stage = await Hilo3d.Stage.create({
            backend: 'webgl2',
            container,
            camera,
            clearColor: new Hilo3d.Color(1, 1, 1),
            width: innerWidth,
            height: innerHeight
        });
        new Hilo3d.DirectionalLight({
            color: new Hilo3d.Color(1, 1, 1),
            direction: new Hilo3d.Vector3(0.7, -1, -0.5)
        }).addTo(stage);
        new Hilo3d.AmbientLight({ color: new Hilo3d.Color(1, 1, 1), amount: 0.5 }).addTo(stage);
        stage.addChild(mesh);
    });

    afterAll(() => {
        stage.destroy();
    });

    beforeEach(() => {
        if (!(material.diffuse instanceof Hilo3d.Color)) {
            throw new TypeError('Expected the fixture to use a color diffuse value');
        }
        material.diffuse.set(0.3, 0.6, 0.9, 1);
    });

    it.each([
        ['box', () => new Hilo3d.BoxGeometry()],
        ['sphere', () => new Hilo3d.SphereGeometry()],
        ['plane', () => new Hilo3d.PlaneGeometry()]
    ])('renders a %s geometry through the stage', (_name, createGeometry) => {
        const geometry = createGeometry();
        mesh.geometry = geometry;

        expect(() => stage.tick(0)).not.toThrow();
        expect(mesh.geometry).toBe(geometry);
        expect(stage.renderer.domElement).toBeInstanceOf(HTMLCanvasElement);
    });
});
