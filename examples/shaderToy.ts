import { PlaneGeometry } from 'hilo3d';
import { createProceduralMaterial } from './shared/procedural';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity } from './shared/scene';

const runtime = await createExampleRuntime();
runtime.engine.renderer.clearColor.set(0, 0, 0, 1);
runtime.controls.setView({ x: 0, y: 0, z: 0 }, 4.2, 0, Math.PI / 2);
createMeshEntity(runtime.world, {
    geometry: new PlaneGeometry({ width: 5.4, height: 3.2 }),
    material: createProceduralMaterial('rings'),
    castShadows: false,
    receiveShadows: false
});
runtime.start();
