import { BasicMaterial, GeometryData, PlaneGeometry } from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity } from './shared/scene';

const runtime = await createExampleRuntime();
const geometry = new PlaneGeometry();
geometry.colors = new GeometryData(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0]), 3);
createMeshEntity(runtime.world, {
    geometry,
    material: new BasicMaterial({ lightType: 'NONE', cullMode: 'none' })
});
runtime.start();
