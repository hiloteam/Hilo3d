import {
    BasicMaterial,
    BoxGeometry,
    Color,
    Geometry,
    MeshRenderer,
    PlaneGeometry,
    SphereGeometry
} from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity } from './shared/scene';

const runtime = await createExampleRuntime();
const tetrahedron = new Geometry();
tetrahedron.addFace([-0.5, -0.289, 0], [0, 0.577, 0], [0.5, -0.289, 0]);
tetrahedron.addFace([-0.5, -0.289, 0], [0.5, -0.289, 0], [0, 0, 0.9]);
tetrahedron.addFace([-0.5, -0.289, 0], [0, 0, 0.9], [0, 0.577, 0]);
tetrahedron.addFace([0, 0.577, 0], [0, 0, 0.9], [0.5, -0.289, 0]);
tetrahedron.calculateNormals();
const geometries = [
    new BoxGeometry(),
    new SphereGeometry({ radius: 0.5 }),
    new PlaneGeometry({ width: 0.8, height: 0.8 }),
    tetrahedron
] as const;
const material = new BasicMaterial({ diffuse: new Color(0.4, 0.6, 1), cullMode: 'none' });
const entity = createMeshEntity(runtime.world, { geometry: geometries[0], material });
let currentIndex = 0;
window.setInterval(() => {
    currentIndex = (currentIndex + 1) % geometries.length;
    const geometry = geometries[currentIndex];
    if (geometry) runtime.world.set(entity, MeshRenderer, { geometry, material });
}, 700);
runtime.start();
