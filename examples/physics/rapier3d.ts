import {
    Collider,
    PHYSICS_RUNTIME_3D,
    RigidBody,
    createRapier3DPhysicsSystem
} from '@hilo3d/addon-physics/rapier3d';
import { BoxGeometry, Color, PBRMaterial, SphereGeometry } from 'hilo3d';
import { createExampleRuntime } from '../shared/runtime';
import { createMeshEntity } from '../shared/scene';

const runtime = await createExampleRuntime([
    createRapier3DPhysicsSystem({
        gravity: { x: 0, y: -9.81, z: 0 },
        fixedTimeStep: 1 / 60,
        maxSubSteps: 4,
        solverIterations: 8,
        maxCcdSubsteps: 2
    })
]);
runtime.controls.setView({ x: 0, y: 2, z: 0 }, 12, 0.65, 1.05);
const ground = createMeshEntity(runtime.world, {
    geometry: new BoxGeometry({ width: 10, height: 0.6, depth: 10 }),
    material: new PBRMaterial({ baseColor: new Color(0.06, 0.13, 0.24), roughness: 0.82 }),
    position: [0, -0.3, 0]
});
runtime.world.add(ground, RigidBody, { type: 'fixed', dimension: '3d' });
runtime.world.add(ground, Collider, {
    dimension: '3d',
    shape: { type: 'cuboid', halfExtents: { x: 5, y: 0.3, z: 5 } },
    friction: 0.85,
    restitution: 0.1
});
const colors = [
    new Color(0.06, 0.72, 1),
    new Color(1, 0.24, 0.42),
    new Color(0.72, 0.34, 1),
    new Color(1, 0.65, 0.12)
] as const;
for (let index = 0; index < 24; index += 1) {
    const sphere = index % 3 === 0;
    const size = 0.28 + (index % 5) * 0.035;
    const entity = createMeshEntity(runtime.world, {
        geometry: sphere
            ? new SphereGeometry({ radius: size, heightSegments: 18, widthSegments: 24 })
            : new BoxGeometry({ width: size * 2, height: size * 2, depth: size * 2 }),
        material: new PBRMaterial({
            baseColor: colors[index % colors.length] ?? colors[0],
            roughness: 0.34,
            metallic: 0.2
        }),
        position: [
            ((index * 7) % 11) * 0.34 - 1.7,
            1.2 + index * 0.48,
            ((index * 5) % 9) * 0.3 - 1.2
        ]
    });
    runtime.world.add(entity, RigidBody, {
        type: 'dynamic',
        dimension: '3d',
        interpolate: true,
        linearDamping: 0.05,
        angularDamping: 0.08,
        continuousCollisionDetection: index % 4 === 0
    });
    runtime.world.add(entity, Collider, {
        dimension: '3d',
        shape: sphere
            ? { type: 'ball', radius: size }
            : { type: 'cuboid', halfExtents: { x: size, y: size, z: size } },
        density: 1,
        friction: 0.62,
        restitution: 0.28,
        collisionEvents: true
    });
}
const physicsRuntime = runtime.world.getResource(PHYSICS_RUNTIME_3D);
runtime.start(() => {
    const diagnostics = physicsRuntime.getDiagnostics();
    const bodyCount = document.getElementById('body-count');
    if (bodyCount) bodyCount.textContent = String(diagnostics.bodyCount);
    const contactCount = document.getElementById('contact-count');
    if (contactCount) contactCount.textContent = String(physicsRuntime.events.length);
});
