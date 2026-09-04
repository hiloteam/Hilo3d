import { LocalTransform, SphereGeometry } from 'hilo3d';
import { createProceduralMaterial } from './shared/procedural';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity, quaternionFromDegrees } from './shared/scene';

const runtime = await createExampleRuntime();
runtime.engine.renderer.clearColor.set(0, 0, 0, 1);
const mesh = createMeshEntity(runtime.world, {
    geometry: new SphereGeometry({ radius: 1, widthSegments: 64, heightSegments: 32 }),
    material: createProceduralMaterial('plasma'),
    castShadows: false
});
runtime.start(time => {
    runtime.world.set(mesh, LocalTransform, {
        rotation: quaternionFromDegrees(time * 18, time * 32)
    });
});
