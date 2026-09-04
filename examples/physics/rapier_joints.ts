import {
    Collider,
    PHYSICS_RUNTIME_3D,
    RigidBody,
    createRapier3DPhysicsSystem,
    type PhysicsRigidBody
} from '@hilo3d/addon-physics/rapier3d';
import { BoxGeometry, Color, PBRMaterial, SphereGeometry, type Entity } from 'hilo3d';
import { createExampleRuntime } from '../shared/runtime';
import { createMeshEntity } from '../shared/scene';

const runtime = await createExampleRuntime([
    createRapier3DPhysicsSystem({
        gravity: { x: 0, y: -9.81, z: 0 },
        fixedTimeStep: 1 / 60,
        maxSubSteps: 5,
        solverIterations: 10
    })
]);
runtime.controls.setView({ x: 0, y: 2.6, z: 0 }, 14, 0.7, 1.05);
const dark = new PBRMaterial({
    baseColor: new Color(0.035, 0.07, 0.14),
    roughness: 0.7,
    metallic: 0.2
});
const floor = createMeshEntity(runtime.world, {
    geometry: new BoxGeometry({ width: 10, height: 0.6, depth: 7 }),
    material: dark,
    position: [0, -0.3, 0]
});
runtime.world.add(floor, RigidBody, { type: 'fixed', dimension: '3d' });
runtime.world.add(floor, Collider, {
    dimension: '3d',
    shape: { type: 'cuboid', halfExtents: { x: 5, y: 0.3, z: 3.5 } },
    friction: 0.8
});

function bodyEntity(
    position: readonly [number, number, number],
    type: 'fixed' | 'dynamic',
    color: Color,
    scale: readonly [number, number, number]
): Entity {
    const entity = createMeshEntity(runtime.world, {
        geometry: new BoxGeometry({
            width: scale[0] * 2,
            height: scale[1] * 2,
            depth: scale[2] * 2
        }),
        material: new PBRMaterial({ baseColor: color, roughness: 0.28, metallic: 0.3 }),
        position
    });
    runtime.world.add(entity, RigidBody, { type, dimension: '3d', interpolate: true });
    runtime.world.add(entity, Collider, {
        dimension: '3d',
        shape: {
            type: 'cuboid',
            halfExtents: { x: scale[0], y: scale[1], z: scale[2] },
            borderRadius: 0.05
        },
        density: 1.1,
        friction: 0.55
    });
    return entity;
}

const cyan = new Color(0.08, 0.8, 1);
const violet = new Color(0.64, 0.3, 1);
const amber = new Color(1, 0.63, 0.12);
const chain: Entity[] = [bodyEntity([-2.6, 5.2, 0], 'fixed', dark.baseColor, [0.15, 0.15, 0.15])];
for (let index = 0; index < 7; index += 1) {
    chain.push(
        bodyEntity(
            [-2.6, 4.72 - index * 0.72, 0],
            'dynamic',
            index % 2 === 0 ? cyan : violet,
            [0.18, 0.36, 0.18]
        )
    );
}
const springAnchor = bodyEntity([0.2, 4.8, 0], 'fixed', dark.baseColor, [0.15, 0.15, 0.15]);
const springWeight = createMeshEntity(runtime.world, {
    geometry: new SphereGeometry({ radius: 0.52, widthSegments: 28, heightSegments: 20 }),
    material: new PBRMaterial({ baseColor: amber, roughness: 0.2, metallic: 0.38 }),
    position: [0.2, 2.25, 0]
});
runtime.world.add(springWeight, RigidBody, {
    type: 'dynamic',
    dimension: '3d',
    interpolate: true,
    linearDamping: 0.08
});
runtime.world.add(springWeight, Collider, {
    dimension: '3d',
    shape: { type: 'ball', radius: 0.52 },
    density: 2.2
});
const motorAnchor = bodyEntity([2.8, 2.3, 0], 'fixed', dark.baseColor, [0.15, 0.15, 0.15]);
const rotor = bodyEntity([2.8, 2.3, 0], 'dynamic', violet, [1.25, 0.16, 0.22]);
runtime.world.set(rotor, RigidBody, {
    type: 'dynamic',
    dimension: '3d',
    interpolate: true,
    enabledTranslations: [false, false, false]
});

const physicsRuntime = runtime.world.getResource(PHYSICS_RUNTIME_3D);
let jointsCreated = false;
function body(entity: Entity): PhysicsRigidBody<'3d'> | null {
    const handle = physicsRuntime.bodyHandle(runtime.world.entityIndex(entity));
    return handle === null ? null : physicsRuntime.physicsWorld.getRigidBody(handle);
}
runtime.start(() => {
    if (jointsCreated) return;
    const chainBodies = chain.map(body);
    const springAnchorBody = body(springAnchor);
    const springWeightBody = body(springWeight);
    const motorAnchorBody = body(motorAnchor);
    const rotorBody = body(rotor);
    if (
        chainBodies.some(value => value === null) ||
        !springAnchorBody ||
        !springWeightBody ||
        !motorAnchorBody ||
        !rotorBody
    )
        return;
    for (let index = 1; index < chainBodies.length; index += 1) {
        const first = chainBodies[index - 1];
        const second = chainBodies[index];
        if (!first || !second) continue;
        physicsRuntime.physicsWorld.createJoint(
            {
                type: 'revolute',
                anchor1: { x: 0, y: index === 1 ? 0 : -0.36, z: 0 },
                anchor2: { x: 0, y: 0.36, z: 0 },
                axis: { x: 0, y: 0, z: 1 }
            },
            first,
            second
        );
    }
    chainBodies.at(-1)?.applyImpulse({ x: 4.5, y: 0, z: 0 });
    physicsRuntime.physicsWorld.createJoint(
        {
            type: 'spring',
            restLength: 1.65,
            stiffness: 38,
            damping: 2.8,
            anchor1: { x: 0, y: 0, z: 0 },
            anchor2: { x: 0, y: 0, z: 0 }
        },
        springAnchorBody,
        springWeightBody
    );
    physicsRuntime.physicsWorld
        .createJoint(
            {
                type: 'revolute',
                anchor1: { x: 0, y: 0, z: 0 },
                anchor2: { x: 0, y: 0, z: 0 },
                axis: { x: 0, y: 0, z: 1 }
            },
            motorAnchorBody,
            rotorBody
        )
        .configureMotor({ targetVelocity: 2.2, stiffness: 0, damping: 6 });
    jointsCreated = true;
});
