import {
    Collider,
    PHYSICS_RUNTIME_2D,
    RigidBody,
    createRapier2DPhysicsSystem
} from '@hilo3d/addon-physics/rapier2d';
import { BoxGeometry, Color, PBRMaterial, SphereGeometry } from 'hilo3d';
import { createExampleRuntime } from '../shared/runtime';
import { createMeshEntity, quaternionFromDegrees } from '../shared/scene';

const runtime = await createExampleRuntime([
    createRapier2DPhysicsSystem({
        gravity: { x: 0, y: -8.5 },
        fixedTimeStep: 1 / 60,
        maxSubSteps: 5,
        solverIterations: 8
    })
]);
runtime.controls.setView({ x: 0, y: 0, z: 0 }, 15.5, 0, Math.PI / 2);
const frameMaterial = new PBRMaterial({
    baseColor: new Color(0.035, 0.075, 0.14),
    roughness: 0.68,
    metallic: 0.22
});
const pegMaterial = new PBRMaterial({
    baseColor: new Color(0.18, 0.48, 0.68),
    roughness: 0.28,
    metallic: 0.46
});

function fixedBox(x: number, y: number, width: number, height: number, rotation = 0): void {
    const entity = createMeshEntity(runtime.world, {
        geometry: new BoxGeometry({ width, height, depth: 0.34 }),
        material: frameMaterial,
        position: [x, y, 0],
        rotation: quaternionFromDegrees(0, 0, (rotation * 180) / Math.PI)
    });
    runtime.world.add(entity, RigidBody, { type: 'fixed', dimension: '2d' });
    runtime.world.add(entity, Collider, {
        dimension: '2d',
        shape: { type: 'cuboid', halfExtents: { x: width / 2, y: height / 2 }, borderRadius: 0.04 },
        friction: 0.55,
        restitution: 0.32
    });
}

fixedBox(-4.8, 0, 0.28, 9.2);
fixedBox(4.8, 0, 0.28, 9.2);
fixedBox(0, -4.45, 9.8, 0.28);
fixedBox(-2.45, 2.9, 4.1, 0.2, -0.13);
fixedBox(2.45, 1.45, 4.1, 0.2, 0.13);
fixedBox(-2.15, -0.1, 3.4, 0.2, -0.16);
fixedBox(2.15, -1.6, 3.4, 0.2, 0.16);
for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 5; column += 1) {
        const x = -3.2 + column * 1.6 + (row % 2) * 0.8;
        const y = 2.2 - row * 1.2;
        const entity = createMeshEntity(runtime.world, {
            geometry: new SphereGeometry({ radius: 0.16, widthSegments: 18, heightSegments: 12 }),
            material: pegMaterial,
            position: [x, y, 0]
        });
        runtime.world.add(entity, RigidBody, { type: 'fixed', dimension: '2d' });
        runtime.world.add(entity, Collider, {
            dimension: '2d',
            shape: { type: 'ball', radius: 0.16 },
            restitution: 0.5
        });
    }
}
const colors = [
    new Color(0.08, 0.82, 1),
    new Color(0.66, 0.32, 1),
    new Color(1, 0.28, 0.5),
    new Color(1, 0.7, 0.12)
] as const;
for (let index = 0; index < 24; index += 1) {
    const radius = 0.2 + (index % 3) * 0.025;
    const entity = createMeshEntity(runtime.world, {
        geometry: new SphereGeometry({ radius, widthSegments: 20, heightSegments: 14 }),
        material: new PBRMaterial({
            baseColor: colors[index % colors.length] ?? colors[0],
            roughness: 0.2,
            metallic: 0.35
        }),
        position: [-3.5 + (index % 8) * 0.88, 4.1 + Math.floor(index / 8) * 0.64, 0]
    });
    runtime.world.add(entity, RigidBody, {
        type: 'dynamic',
        dimension: '2d',
        interpolate: true,
        linearDamping: 0.025,
        angularDamping: 0.02,
        continuousCollisionDetection: index % 4 === 0
    });
    runtime.world.add(entity, Collider, {
        dimension: '2d',
        shape: { type: 'ball', radius },
        density: 1,
        friction: 0.24,
        restitution: 0.48,
        collisionEvents: true
    });
}
const physicsRuntime = runtime.world.getResource(PHYSICS_RUNTIME_2D);
const marblesElement = document.getElementById('marbles');
if (marblesElement) marblesElement.textContent = '24';
runtime.start(() => {
    const sensorHits = document.getElementById('sensor-hits');
    if (sensorHits) sensorHits.textContent = String(physicsRuntime.events.length);
});
