import { Collider, RigidBody, createRapier3DPhysicsSystem } from '@hilo3d/addon-physics/rapier3d';
import { BasicMaterial, BoxGeometry, Color, LocalTransform, MeshRenderer } from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';

const physics = createRapier3DPhysicsSystem({
    gravity: { x: 0, y: -9.81, z: 0 },
    fixedTimeStep: 1 / 60,
    maxSubSteps: 4
});
const runtime = await createExampleRuntime([physics]);
const geometry = new BoxGeometry();
for (let index = 0; index < 18; index++) {
    const entity = runtime.world.createEntity();
    runtime.world.add(entity, LocalTransform, { position: [0, index + 0.5, 0] });
    runtime.world.add(entity, MeshRenderer, {
        geometry,
        material: new BasicMaterial({ diffuse: new Color(0.2, 0.45 + index * 0.02, 0.9) })
    });
    runtime.world.add(entity, RigidBody, { type: 'dynamic', dimension: '3d', interpolate: true });
    runtime.world.add(entity, Collider, {
        dimension: '3d',
        shape: { type: 'cuboid', halfExtents: { x: 0.5, y: 0.5, z: 0.5 } },
        friction: 0.7
    });
}
const ground = runtime.world.createEntity();
runtime.world.add(ground, LocalTransform, { position: [0, -1, 0], scale: [12, 1, 12] });
runtime.world.add(ground, MeshRenderer, {
    geometry,
    material: new BasicMaterial({ diffuse: new Color(0.08, 0.13, 0.2) })
});
runtime.world.add(ground, RigidBody, { type: 'fixed', dimension: '3d' });
runtime.world.add(ground, Collider, {
    dimension: '3d',
    shape: { type: 'cuboid', halfExtents: { x: 6, y: 0.5, z: 6 } }
});
runtime.start();
