import {
    PHYSICS_WORLD_3D_SERVICE,
    bindNode3D,
    createRapier3DPhysicsPlugin,
    type PhysicsQuaternion,
    type PhysicsRigidBody,
    type PhysicsVector3
} from '@hilo3d/addon-physics/rapier3d';
import * as Hilo3d from '../../src/Hilo3d';
import { createExampleContext } from '../shared/init';

const plugin = createRapier3DPhysicsPlugin({
    gravity: { x: 0, y: -9.81, z: 0 },
    fixedTimeStep: 1 / 60,
    maxSubSteps: 4
});
const { stage, camera, directionLight, ambientLight, orbitControls, ticker } =
    await createExampleContext({
        camera: { x: 9.5, y: 6.8, z: 11.5, far: 80 },
        stage: { plugins: [plugin] },
        controls: { target: new Hilo3d.Vector3(0, 1.6, 0), minDistance: 7, maxDistance: 22 }
    });
const physics = stage.pluginHost.get(PHYSICS_WORLD_3D_SERVICE);
orbitControls.setView(camera.position, new Hilo3d.Vector3(0, 1.6, 0));
directionLight.amount = 5.2;
directionLight.direction = new Hilo3d.Vector3(-0.7, -1, -0.35);
ambientLight.amount = 0.72;

const palette = [
    new Hilo3d.Color(0.1, 0.78, 1),
    new Hilo3d.Color(0.54, 0.35, 1),
    new Hilo3d.Color(1, 0.27, 0.48),
    new Hilo3d.Color(1, 0.72, 0.16)
] as const;
const dark = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.035, 0.08, 0.16),
    roughness: 0.74,
    metallic: 0.18
});
const resettableBodies: {
    readonly body: PhysicsRigidBody<'3d'>;
    readonly position: PhysicsVector3;
}[] = [];

function zRotation(degrees: number): PhysicsQuaternion {
    const half = (degrees * Math.PI) / 360;
    return { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };
}

function fixedBox(
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    rotationZ = 0
): void {
    const body = physics.createRigidBody({
        type: 'fixed',
        position: { x, y, z },
        rotation: zRotation(rotationZ)
    });
    physics.createCollider(
        {
            shape: { type: 'cuboid', halfExtents: { x: width / 2, y: height / 2, z: depth / 2 } },
            friction: 0.7,
            restitution: 0.05,
            restitutionCombineRule: 'max'
        },
        body
    );
    new Hilo3d.Mesh({
        x,
        y,
        z,
        rotationZ,
        geometry: new Hilo3d.BoxGeometry({ width, height, depth }),
        material: dark,
        receiveShadows: true
    }).addTo(stage);
}

fixedBox(0, -0.42, 0, 11, 0.5, 8);

const restitution = [0.05, 0.35, 0.65, 0.95] as const;
for (let index = 0; index < restitution.length; index += 1) {
    const coefficient = restitution[index];
    if (coefficient === undefined) continue;
    const x = -3.45 + index * 2.3;
    const position = { x, y: 4.4, z: -1.7 };
    const body = physics.createRigidBody({
        type: 'dynamic',
        position,
        linearDamping: 0.02,
        angularDamping: 0.03,
        continuousCollisionDetection: true
    });
    physics.createCollider(
        {
            shape: { type: 'ball', radius: 0.42 },
            restitution: coefficient,
            restitutionCombineRule: 'max',
            friction: 0.4
        },
        body
    );
    const mesh = new Hilo3d.Mesh({
        ...position,
        geometry: new Hilo3d.SphereGeometry({
            radius: 0.42,
            widthSegments: 28,
            heightSegments: 20
        }),
        material: new Hilo3d.PBRMaterial({
            baseColor: palette[index] ?? palette[0],
            roughness: 0.22,
            metallic: 0.28
        }),
        castShadows: true
    }).addTo(stage);
    bindNode3D(physics, body, mesh);
    resettableBodies.push({ body, position });
}

const slopeAngle = -13;
const friction = [0.02, 0.18, 0.55, 1.2] as const;
for (let index = 0; index < friction.length; index += 1) {
    const coefficient = friction[index];
    if (coefficient === undefined) continue;
    const z = -2.7 + index * 1.75;
    fixedBox(0, 1.25, z, 6.6, 0.18, 1.15, slopeAngle);
    const position = { x: -2.35, y: 2.12, z };
    const body = physics.createRigidBody({ type: 'dynamic', position, angularDamping: 0.15 });
    physics.createCollider(
        {
            shape: { type: 'cuboid', halfExtents: { x: 0.34, y: 0.34, z: 0.34 } },
            friction: coefficient,
            frictionCombineRule: 'multiply',
            restitution: 0.02
        },
        body
    );
    const mesh = new Hilo3d.Mesh({
        ...position,
        geometry: new Hilo3d.BoxGeometry({ width: 0.68, height: 0.68, depth: 0.68 }),
        material: new Hilo3d.PBRMaterial({
            baseColor: palette[index] ?? palette[0],
            roughness: 0.28 + index * 0.16,
            metallic: 0.12
        }),
        castShadows: true
    }).addTo(stage);
    bindNode3D(physics, body, mesh);
    resettableBodies.push({ body, position });
}

let cycleTime = 0;
ticker.addTick({
    tick(deltaTime: number): void {
        cycleTime += deltaTime;
        if (cycleTime < 4800) return;
        cycleTime = 0;
        for (const { body, position } of resettableBodies) {
            body.setPose({ position, rotation: { x: 0, y: 0, z: 0, w: 1 } });
            body.setLinearVelocity({ x: 0, y: 0, z: 0 });
            body.setAngularVelocity({ x: 0, y: 0, z: 0 });
        }
    }
});
