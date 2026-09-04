import {
    Collider,
    PHYSICS_RUNTIME_3D,
    RigidBody,
    createRapier3DPhysicsSystem
} from '@hilo3d/addon-physics/rapier3d';
import {
    BoxGeometry,
    Color,
    LocalTransform,
    PBRMaterial,
    SphereGeometry,
    type Entity
} from 'hilo3d';
import { createExampleRuntime } from '../shared/runtime';
import { createMeshEntity, quaternionFromDegrees } from '../shared/scene';

const runtime = await createExampleRuntime([
    createRapier3DPhysicsSystem({
        gravity: { x: 0, y: -9.81, z: 0 },
        fixedTimeStep: 1 / 60,
        maxSubSteps: 4
    })
]);
runtime.controls.setView({ x: 0, y: 1.6, z: 0 }, 14.5, 0.7, 1.05);
const dark = new PBRMaterial({
    baseColor: new Color(0.035, 0.08, 0.16),
    roughness: 0.74,
    metallic: 0.18
});
const palette = [
    new Color(0.1, 0.78, 1),
    new Color(0.54, 0.35, 1),
    new Color(1, 0.27, 0.48),
    new Color(1, 0.72, 0.16)
] as const;
const resettable: {
    readonly entity: Entity;
    readonly position: readonly [number, number, number];
}[] = [];

function fixedBox(
    position: readonly [number, number, number],
    size: readonly [number, number, number],
    rotationZ = 0
): void {
    const entity = createMeshEntity(runtime.world, {
        geometry: new BoxGeometry({ width: size[0], height: size[1], depth: size[2] }),
        material: dark,
        position,
        rotation: quaternionFromDegrees(0, 0, rotationZ)
    });
    runtime.world.add(entity, RigidBody, { type: 'fixed', dimension: '3d' });
    runtime.world.add(entity, Collider, {
        dimension: '3d',
        shape: { type: 'cuboid', halfExtents: { x: size[0] / 2, y: size[1] / 2, z: size[2] / 2 } },
        friction: 0.7,
        restitution: 0.05,
        restitutionCombineRule: 'max'
    });
}

fixedBox([0, -0.42, 0], [11, 0.5, 8]);
const restitution = [0.05, 0.35, 0.65, 0.95] as const;
for (let index = 0; index < restitution.length; index += 1) {
    const position = [-3.45 + index * 2.3, 4.4, -1.7] as const;
    const entity = createMeshEntity(runtime.world, {
        geometry: new SphereGeometry({ radius: 0.42, widthSegments: 28, heightSegments: 20 }),
        material: new PBRMaterial({
            baseColor: palette[index] ?? palette[0],
            roughness: 0.22,
            metallic: 0.28
        }),
        position
    });
    runtime.world.add(entity, RigidBody, {
        type: 'dynamic',
        dimension: '3d',
        interpolate: true,
        continuousCollisionDetection: true
    });
    runtime.world.add(entity, Collider, {
        dimension: '3d',
        shape: { type: 'ball', radius: 0.42 },
        restitution: restitution[index] ?? 0,
        restitutionCombineRule: 'max',
        friction: 0.4
    });
    resettable.push({ entity, position });
}
const friction = [0.02, 0.18, 0.55, 1.2] as const;
for (let index = 0; index < friction.length; index += 1) {
    const z = -2.7 + index * 1.75;
    fixedBox([0, 1.25, z], [6.6, 0.18, 1.15], -13);
    const position = [-2.35, 2.12, z] as const;
    const entity = createMeshEntity(runtime.world, {
        geometry: new BoxGeometry({ width: 0.68, height: 0.68, depth: 0.68 }),
        material: new PBRMaterial({
            baseColor: palette[index] ?? palette[0],
            roughness: 0.28 + index * 0.16
        }),
        position
    });
    runtime.world.add(entity, RigidBody, {
        type: 'dynamic',
        dimension: '3d',
        interpolate: true,
        angularDamping: 0.15
    });
    runtime.world.add(entity, Collider, {
        dimension: '3d',
        shape: { type: 'cuboid', halfExtents: { x: 0.34, y: 0.34, z: 0.34 } },
        friction: friction[index] ?? 0,
        frictionCombineRule: 'multiply',
        restitution: 0.02
    });
    resettable.push({ entity, position });
}
const physicsRuntime = runtime.world.getResource(PHYSICS_RUNTIME_3D);
let lastReset = performance.now();
runtime.start(() => {
    const now = performance.now();
    if (now - lastReset < 4800) return;
    lastReset = now;
    for (const item of resettable) {
        const handle = physicsRuntime.bodyHandle(runtime.world.entityIndex(item.entity));
        const body = handle === null ? null : physicsRuntime.physicsWorld.getRigidBody(handle);
        body?.setPose({
            position: { x: item.position[0], y: item.position[1], z: item.position[2] },
            rotation: { x: 0, y: 0, z: 0, w: 1 }
        });
        body?.setLinearVelocity({ x: 0, y: 0, z: 0 });
        body?.setAngularVelocity({ x: 0, y: 0, z: 0 });
        runtime.world.set(item.entity, LocalTransform, { position: item.position });
    }
});
