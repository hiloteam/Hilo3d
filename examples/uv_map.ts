import { BasicMaterial, GLTFLoader, LazyTexture, LocalTransform, PlaneGeometry } from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity } from './shared/scene';

const runtime = await createExampleRuntime();
createMeshEntity(runtime.world, {
    geometry: new PlaneGeometry({ width: 1.8, height: 1.8 }),
    material: new BasicMaterial({
        diffuse: new LazyTexture({ src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href }),
        lightType: 'NONE'
    }),
    position: [-1.25, 0, 0]
});
const model = await new GLTFLoader().load({ src: './models/Tmall/Tmall.gltf' });
const instance = model.instantiate(runtime.world);
for (const root of instance.roots) {
    const transform = runtime.world.get(root, LocalTransform);
    runtime.world.set(root, LocalTransform, {
        position: [1.25, -0.8, 0],
        ...(transform.rotation === undefined ? {} : { rotation: transform.rotation }),
        scale: [0.001, 0.001, 0.001]
    });
}
runtime.start();
