import { GLTFLoader, LocalTransform, createAnimationSystem } from 'hilo3d';
import { createExampleRuntime } from '../shared/runtime';

const runtime = await createExampleRuntime([createAnimationSystem()]);
runtime.controls.setView({ x: 0, y: 0, z: 0 }, 5, 0.65, 1.1);
const model = await new GLTFLoader().load({ src: '../models/Tmall/Tmall.gltf' });
for (let index = 0; index < 101; index += 1) {
    const instance = model.instantiate(runtime.world);
    const isHero = index === 0;
    const scale = isHero ? 0.0018 : 0.00045;
    for (const root of instance.roots) {
        runtime.world.set(root, LocalTransform, {
            ...runtime.world.get(root, LocalTransform),
            position: isHero
                ? [0, 0, 0]
                : [Math.random() * 4 - 2, Math.random() * 3 - 1.5, Math.random() * 4 - 2],
            scale: [scale, scale, scale]
        });
    }
}
runtime.start();
