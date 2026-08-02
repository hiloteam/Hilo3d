import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const Mesh = Hilo3d.Mesh;

describe('Mesh', () => {
    it('create', () => {
        const mesh = new Mesh();
        expect(mesh.isMesh).toBe(true);
        expect(mesh.className).toBe('Mesh');
    });

    it('clone', () => {
        const mesh = new Mesh({
            geometry: new Hilo3d.BoxGeometry(),
            material: new Hilo3d.BasicMaterial()
        });

        const clonedMesh = mesh.clone();
        expect(clonedMesh.geometry).toBe(mesh.geometry);
        expect(clonedMesh.material).toBe(mesh.material);
    });

    it('raycast', () => {
        let material = new Hilo3d.BasicMaterial({ cullMode: 'back' });
        const mesh = new Mesh({
            geometry: new Hilo3d.PlaneGeometry(),
            material
        });
        const ray = new Hilo3d.Ray({
            origin: new Hilo3d.Vector3(0, 0, 1),
            direction: new Hilo3d.Vector3(0, 0, -1)
        });

        let hits = mesh.raycast(ray);
        expect(hits?.at(0)?.elements).toEqual(new Float32Array([0, 0, 0]));

        material = new Hilo3d.BasicMaterial({ cullMode: 'front' });
        mesh.material = material;
        expect(mesh.raycast(ray)).toBeNull();

        ray.origin.z = -1;
        ray.direction.z = 1;
        hits = mesh.raycast(ray);
        expect(hits?.at(0)?.elements).toEqual(new Float32Array([0, 0, 0]));
    });
});
