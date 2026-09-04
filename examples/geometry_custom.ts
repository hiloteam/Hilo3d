import { BasicMaterial, Geometry, GeometryData, LazyTexture, LocalTransform, math } from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity, quaternionFromDegrees } from './shared/scene';

const runtime = await createExampleRuntime();
const material = new BasicMaterial({
    diffuse: new LazyTexture({ src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href })
});
const verticesData = new Float32Array([
    0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.1, 0.5, -0.1, 0.1, 0.5, 0.1, -0.5, -0.5, -0.5, -0.5, -0.5,
    0.5, -0.1, 0.5, 0.1, -0.1, 0.5, -0.1, -0.1, 0.5, 0.1, 0.1, 0.5, 0.1, 0.1, 0.5, -0.1, -0.1, 0.5,
    -0.1, -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5,
    -0.5, 0.5, 0.1, 0.5, 0.1, -0.1, 0.5, 0.1, 0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.1, 0.5, -0.1,
    0.1, 0.5, -0.1
]);
const uvsData = new Float32Array([
    0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0,
    0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0
]);
const indicesData = new Uint16Array([
    0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11, 12, 13, 14, 12, 14, 15, 16, 17, 18, 16,
    18, 19, 20, 21, 22, 20, 22, 23
]);
const geometry = new Geometry({
    vertices: new GeometryData(verticesData, 3),
    uvs: new GeometryData(uvsData, 2),
    indices: new GeometryData(indicesData, 1)
});
const interleavedData = new Float32Array(120);
for (let index = 0; index < 24; index++) {
    interleavedData[index * 5] = verticesData[index * 3] ?? 0;
    interleavedData[index * 5 + 1] = verticesData[index * 3 + 1] ?? 0;
    interleavedData[index * 5 + 2] = verticesData[index * 3 + 2] ?? 0;
    interleavedData[index * 5 + 3] = uvsData[index * 2] ?? 0;
    interleavedData[index * 5 + 4] = uvsData[index * 2 + 1] ?? 0;
}
const bufferViewId = math.generateUUID('bufferViewId');
const interleavedGeometry = new Geometry({
    vertices: new GeometryData(interleavedData, 3, { stride: 20, bufferViewId }),
    uvs: new GeometryData(interleavedData, 2, { stride: 20, offset: 12, bufferViewId }),
    indices: new GeometryData(indicesData, 1)
});
const conventional = createMeshEntity(runtime.world, {
    geometry,
    material,
    position: [-0.7, 0, 0],
    scale: [0.8, 0.8, 0.8]
});
const interleaved = createMeshEntity(runtime.world, {
    geometry: interleavedGeometry,
    material,
    position: [0.7, 0, 0],
    scale: [0.8, 0.8, 0.8]
});
runtime.start(time => {
    runtime.world.set(conventional, LocalTransform, {
        position: [-0.7, 0, 0],
        rotation: quaternionFromDegrees(time * 30, time * 30, 0),
        scale: [0.8, 0.8, 0.8]
    });
    runtime.world.set(interleaved, LocalTransform, {
        position: [0.7, 0, 0],
        rotation: quaternionFromDegrees(-time * 30, -time * 30, 0),
        scale: [0.8, 0.8, 0.8]
    });
});
