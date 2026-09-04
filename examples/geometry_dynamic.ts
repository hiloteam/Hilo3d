import { BasicMaterial, BoxGeometry, LazyTexture, Vector3 } from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity, quaternionFromDegrees } from './shared/scene';

const runtime = await createExampleRuntime();
const geometry = new BoxGeometry({ isStatic: false });
geometry.setAllRectUV([
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0]
]);
createMeshEntity(runtime.world, {
    geometry,
    material: new BasicMaterial({
        cullMode: 'none',
        diffuse: new LazyTexture({ src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href })
    }),
    rotation: quaternionFromDegrees(0, -60, 0)
});
const vertices = geometry.vertices;
if (!vertices) throw new Error('Dynamic box geometry requires vertices.');
const original = vertices.get(0);
if (!(original instanceof Vector3)) throw new TypeError('Expected a 3D box vertex.');
const animated = original.clone();
runtime.start(time => {
    animated.x = original.x + (Math.sin(time * 2) + 1) * 0.25;
    vertices.set(0, animated);
    geometry.calculateNormals();
    vertices.isDirty = true;
    if (geometry.normals) geometry.normals.isDirty = true;
});
