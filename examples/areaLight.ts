import {
    AreaLight,
    BasicMaterial,
    BoxGeometry,
    Color,
    LocalTransform,
    PBRMaterial,
    PlaneGeometry
} from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity, quaternionFromDegrees } from './shared/scene';

const runtime = await createExampleRuntime();
runtime.engine.renderer.clearColor.set(0.03, 0.035, 0.05, 1);
runtime.controls.setView({ x: 0, y: 0, z: 0 }, 20, 0.95, 0.9);
const box = createMeshEntity(runtime.world, {
    geometry: new BoxGeometry(),
    material: new PBRMaterial({ baseColor: new Color(1, 1, 1), roughness: 0.4 }),
    scale: [2, 2, 2]
});
createMeshEntity(runtime.world, {
    geometry: new PlaneGeometry(),
    material: new PBRMaterial({ baseColor: new Color(0.55, 0.58, 0.65), cullMode: 'none' }),
    position: [0, -2.2, 0],
    rotation: quaternionFromDegrees(-90),
    scale: [16, 16, 1]
});
const lights = Array.from({ length: 6 }, (_, index) => {
    const entity = runtime.world.createEntity(LocalTransform);
    const color = [
        0.25 + ((index * 37) % 70) / 100,
        0.3 + ((index * 53) % 65) / 100,
        0.35 + ((index * 29) % 60) / 100
    ] as const;
    runtime.world.add(entity, AreaLight, { color, amount: 10, width: 2.5, height: 1.5 });
    createMeshEntity(runtime.world, {
        parent: entity,
        geometry: new PlaneGeometry(),
        material: new BasicMaterial({
            diffuse: new Color(color[0], color[1], color[2]),
            lightType: 'NONE',
            cullMode: 'none'
        }),
        scale: [2.5, 1.5, 1]
    });
    return entity;
});
runtime.start(time => {
    runtime.world.set(box, LocalTransform, {
        rotation: quaternionFromDegrees(time * 18, time * 28, 0),
        scale: [2, 2, 2]
    });
    lights.forEach((light, index) => {
        const angle = time * 0.45 + (index * Math.PI * 2) / lights.length;
        runtime.world.set(light, LocalTransform, {
            position: [Math.cos(angle) * 7, 2.5 + Math.sin(angle * 3), Math.sin(angle) * 7],
            rotation: quaternionFromDegrees(0, -angle * (180 / Math.PI) + 90, 0)
        });
    });
});
