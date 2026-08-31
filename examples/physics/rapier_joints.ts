import {
    PHYSICS_WORLD_3D_SERVICE,
    bindNode3D,
    createRapier3DPhysicsPlugin,
    type PhysicsRigidBody
} from '@hilo3d/addon-physics/rapier3d';
import * as Hilo3d from '../../src/Hilo3d';
import { createExampleContext } from '../shared/init';

const plugin = createRapier3DPhysicsPlugin({
    gravity: { x: 0, y: -9.81, z: 0 },
    fixedTimeStep: 1 / 60,
    maxSubSteps: 5,
    solverIterations: 10
});
const { stage, camera, directionLight, ambientLight, orbitControls } = await createExampleContext({
    camera: { x: 8.5, y: 5.6, z: 11.5, far: 80 },
    stage: { plugins: [plugin] },
    controls: { target: new Hilo3d.Vector3(0, 2.6, 0), minDistance: 7, maxDistance: 22 }
});
const physics = stage.pluginHost.get(PHYSICS_WORLD_3D_SERVICE);
orbitControls.setView(camera.position, new Hilo3d.Vector3(0, 2.6, 0));
directionLight.amount = 5;
directionLight.direction = new Hilo3d.Vector3(-0.55, -1, -0.4);
ambientLight.amount = 0.68;

const cyan = new Hilo3d.Color(0.08, 0.8, 1);
const violet = new Hilo3d.Color(0.64, 0.3, 1);
const amber = new Hilo3d.Color(1, 0.63, 0.12);
const darkMaterial = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.035, 0.07, 0.14),
    roughness: 0.7,
    metallic: 0.2
});

const floor = physics.createRigidBody({ type: 'fixed', position: { x: 0, y: -0.3, z: 0 } });
physics.createCollider(
    { shape: { type: 'cuboid', halfExtents: { x: 5, y: 0.3, z: 3.5 } }, friction: 0.8 },
    floor
);
new Hilo3d.Mesh({
    y: -0.3,
    geometry: new Hilo3d.BoxGeometry({ width: 10, height: 0.6, depth: 7 }),
    material: darkMaterial,
    receiveShadows: true
}).addTo(stage);

function linkBody(x: number, y: number, z: number, color: Hilo3d.Color): PhysicsRigidBody<'3d'> {
    const body = physics.createRigidBody({
        type: 'dynamic',
        position: { x, y, z },
        linearDamping: 0.04,
        angularDamping: 0.05
    });
    physics.createCollider(
        {
            shape: {
                type: 'cuboid',
                halfExtents: { x: 0.18, y: 0.36, z: 0.18 },
                borderRadius: 0.05
            },
            density: 1.1,
            friction: 0.55
        },
        body
    );
    const mesh = new Hilo3d.Mesh({
        x,
        y,
        z,
        geometry: new Hilo3d.BoxGeometry({ width: 0.36, height: 0.72, depth: 0.36 }),
        material: new Hilo3d.PBRMaterial({ baseColor: color, roughness: 0.28, metallic: 0.3 }),
        castShadows: true
    }).addTo(stage);
    bindNode3D(physics, body, mesh);
    return body;
}

const chainAnchor = physics.createRigidBody({ type: 'fixed', position: { x: -2.6, y: 5.2, z: 0 } });
let previous = chainAnchor;
for (let index = 0; index < 7; index += 1) {
    const body = linkBody(-2.6, 4.72 - index * 0.72, 0, index % 2 === 0 ? cyan : violet);
    physics.createJoint(
        {
            type: 'revolute',
            anchor1: index === 0 ? { x: 0, y: 0, z: 0 } : { x: 0, y: -0.36, z: 0 },
            anchor2: { x: 0, y: 0.36, z: 0 },
            axis: { x: 0, y: 0, z: 1 }
        },
        previous,
        body
    );
    previous = body;
}
previous.applyImpulse({ x: 4.5, y: 0, z: 0 });

const springAnchor = physics.createRigidBody({ type: 'fixed', position: { x: 0.2, y: 4.8, z: 0 } });
const springWeight = physics.createRigidBody({
    type: 'dynamic',
    position: { x: 0.2, y: 2.25, z: 0 },
    linearDamping: 0.08,
    angularDamping: 0.3
});
physics.createCollider(
    { shape: { type: 'ball', radius: 0.52 }, density: 2.2, restitution: 0.15 },
    springWeight
);
physics.createJoint(
    {
        type: 'spring',
        restLength: 1.65,
        stiffness: 38,
        damping: 2.8,
        anchor1: { x: 0, y: 0, z: 0 },
        anchor2: { x: 0, y: 0, z: 0 }
    },
    springAnchor,
    springWeight
);
const springMesh = new Hilo3d.Mesh({
    x: 0.2,
    y: 2.25,
    geometry: new Hilo3d.SphereGeometry({ radius: 0.52, widthSegments: 28, heightSegments: 20 }),
    material: new Hilo3d.PBRMaterial({ baseColor: amber, roughness: 0.2, metallic: 0.38 }),
    castShadows: true
}).addTo(stage);
bindNode3D(physics, springWeight, springMesh);

const motorAnchor = physics.createRigidBody({ type: 'fixed', position: { x: 2.8, y: 2.3, z: 0 } });
const rotor = physics.createRigidBody({
    type: 'dynamic',
    position: { x: 2.8, y: 2.3, z: 0 },
    enabledTranslations: [false, false, false]
});
physics.createCollider(
    { shape: { type: 'cuboid', halfExtents: { x: 1.25, y: 0.16, z: 0.22 } }, density: 1.4 },
    rotor
);
physics
    .createJoint(
        {
            type: 'revolute',
            anchor1: { x: 0, y: 0, z: 0 },
            anchor2: { x: 0, y: 0, z: 0 },
            axis: { x: 0, y: 0, z: 1 }
        },
        motorAnchor,
        rotor
    )
    .configureMotor({ targetVelocity: 2.2, stiffness: 0, damping: 6 });
const rotorMesh = new Hilo3d.Mesh({
    x: 2.8,
    y: 2.3,
    geometry: new Hilo3d.BoxGeometry({ width: 2.5, height: 0.32, depth: 0.44 }),
    material: new Hilo3d.PBRMaterial({ baseColor: violet, roughness: 0.24, metallic: 0.42 }),
    castShadows: true
}).addTo(stage);
bindNode3D(physics, rotor, rotorMesh);

for (const [x, y] of [
    [-2.6, 5.2],
    [0.2, 4.8],
    [2.8, 2.3]
] as const) {
    new Hilo3d.Mesh({
        x,
        y,
        geometry: new Hilo3d.SphereGeometry({ radius: 0.2, widthSegments: 20, heightSegments: 14 }),
        material: darkMaterial
    }).addTo(stage);
}
