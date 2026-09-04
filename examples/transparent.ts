import { BasicMaterial, BoxGeometry, Color, LocalTransform } from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity, quaternionFromDegrees } from './shared/scene';

const runtime = await createExampleRuntime();
const root = runtime.world.createEntity(LocalTransform, {
    rotation: quaternionFromDegrees(0, -70, 0),
    scale: [0.4, 0.4, 0.4]
});
const geometry = new BoxGeometry();
const entities = Array.from({ length: 8 }, (_, index) =>
    createMeshEntity(runtime.world, {
        parent: root,
        geometry,
        material: new BasicMaterial({
            compositing: { mode: 'alpha-blend', premultiplied: true },
            opacity: 0.5,
            diffuse: new Color(
                ((index * 37) % 100) / 100,
                ((index * 61) % 100) / 100,
                ((index * 83) % 100) / 100
            )
        }),
        position: [-3.8 + index, 0, 0]
    })
);
runtime.start(time => {
    entities.forEach((entity, index) => {
        runtime.world.set(entity, LocalTransform, {
            position: [-3.8 + index, 0, 0],
            rotation: quaternionFromDegrees(time * 28 + index * 36, 0, 0)
        });
    });
});
