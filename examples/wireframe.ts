import { GLTFLoader, LocalTransform } from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';

const runtime = await createExampleRuntime();
const model = await new GLTFLoader().load({
    src: './models/Tmall/Tmall.gltf',
    pbrMaterialDefaults: { state: { wireframe: true } }
});
const instance = model.instantiate(runtime.world);
for (const root of instance.roots) {
    const transform = runtime.world.get(root, LocalTransform);
    runtime.world.set(root, LocalTransform, {
        ...(transform.position === undefined ? {} : { position: transform.position }),
        ...(transform.rotation === undefined ? {} : { rotation: transform.rotation }),
        scale: [0.001, 0.001, 0.001]
    });
}
runtime.start();
