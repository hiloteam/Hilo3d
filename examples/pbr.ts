import { GLTFLoader, LocalTransform } from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { quaternionFromDegrees } from './shared/scene';

const runtime = await createExampleRuntime();
const model = await new GLTFLoader().load({ src: './models/BoomBox/BoomBox.gltf' });
const instance = model.instantiate(runtime.world);
for (const root of instance.roots) {
    const transform = runtime.world.get(root, LocalTransform);
    runtime.world.set(root, LocalTransform, {
        ...(transform.position === undefined ? {} : { position: transform.position }),
        rotation: quaternionFromDegrees(0, 160, 0),
        ...(transform.scale === undefined ? {} : { scale: transform.scale })
    });
}
runtime.start();
