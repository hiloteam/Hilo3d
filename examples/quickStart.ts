import { BasicMaterial, BoxGeometry, Color, LocalTransform, MeshRenderer } from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';

const runtime = await createExampleRuntime();
const cube = runtime.world.createEntity(LocalTransform);
runtime.world.add(cube, MeshRenderer, {
    geometry: new BoxGeometry({ width: 1.8, height: 1.8, depth: 1.8 }),
    material: new BasicMaterial({ diffuse: new Color(0.12, 0.78, 0.9) }),
    castShadows: true,
    receiveShadows: true
});
runtime.start(time => {
    runtime.world.set(cube, LocalTransform, {
        rotation: [Math.sin(time * 0.31) * 0.16, Math.sin(time * 0.5) * 0.45, 0, 1]
    });
});
