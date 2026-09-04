import {
    BasicMaterial,
    Color,
    DirectionalLight,
    GLTFLoader,
    LocalTransform,
    PointLight,
    SphereGeometry,
    SpotLight
} from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity } from './shared/scene';

const runtime = await createExampleRuntime();
runtime.controls.setView({ x: 0, y: 0, z: 0 }, 4.5, 0.75, 1.05);
const model = await new GLTFLoader().load({ src: './models/light.gltf' });
const instance = model.instantiate(runtime.world);
const markerGeometry = new SphereGeometry({ radius: 0.05 });
for (const entity of instance.lightEntities) {
    let color: readonly [number, number, number] = [1, 1, 1];
    if (runtime.world.has(entity, PointLight)) {
        color = runtime.world.get(entity, PointLight).color ?? color;
    } else if (runtime.world.has(entity, SpotLight)) {
        color = runtime.world.get(entity, SpotLight).color ?? color;
    } else if (runtime.world.has(entity, DirectionalLight)) {
        color = runtime.world.get(entity, DirectionalLight).color ?? color;
    }
    createMeshEntity(runtime.world, {
        parent: entity,
        geometry: markerGeometry,
        material: new BasicMaterial({ lightType: 'NONE', diffuse: new Color(...color) }),
        scale: [0.6, 0.6, 0.6]
    });
}
for (const root of instance.roots) {
    runtime.world.set(root, LocalTransform, {
        ...runtime.world.get(root, LocalTransform),
        scale: [1.25, 1.25, 1.25]
    });
}
runtime.start();
