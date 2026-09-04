import { BoxGeometry, LocalTransform } from 'hilo3d';
import { createProceduralMaterial } from './shared/procedural';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity, quaternionFromDegrees } from './shared/scene';

const runtime = await createExampleRuntime();
const mesh = createMeshEntity(runtime.world, {
    geometry: new BoxGeometry({ width: 1.8, height: 1.8, depth: 1.8 }),
    material: createProceduralMaterial('grid'),
    castShadows: false
});
runtime.start(time => {
    runtime.world.set(mesh, LocalTransform, {
        rotation: quaternionFromDegrees(time * 22, time * 34)
    });
});
