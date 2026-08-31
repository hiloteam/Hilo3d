import {
    PHYSICS_WORLD_2D_SERVICE,
    bindNode2D,
    createRapier2DPhysicsSystem,
    type PhysicsRigidBody
} from '@hilo3d/addon-physics/rapier2d';
import * as Hilo3d from '../../src/Hilo3d';
import { createExampleContext } from '../shared/init';

const physicsSystem = createRapier2DPhysicsSystem({
    gravity: { x: 0, y: -8.5 },
    fixedTimeStep: 1 / 60,
    maxSubSteps: 5,
    solverIterations: 8
});
const { stage, camera, directionLight, ambientLight, orbitControls, ticker } =
    await createExampleContext({
        camera: { x: 0, y: 0.2, z: 15.5, far: 60 },
        stage: { systems: [physicsSystem], useInstanced: true },
        controls: { target: new Hilo3d.Vector3(0, 0.2, 0), minDistance: 12, maxDistance: 20 }
    });
const physics = stage.systems.get(PHYSICS_WORLD_2D_SERVICE);
orbitControls.setView(camera.position, new Hilo3d.Vector3(0, 0.2, 0));
directionLight.amount = 4.8;
directionLight.direction = new Hilo3d.Vector3(-0.4, -0.7, -1);
ambientLight.amount = 0.82;

const frameMaterial = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.035, 0.075, 0.14),
    roughness: 0.68,
    metallic: 0.22
});
const pegMaterial = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.18, 0.48, 0.68),
    roughness: 0.28,
    metallic: 0.46
});
const colors = [
    new Hilo3d.Color(0.08, 0.82, 1),
    new Hilo3d.Color(0.66, 0.32, 1),
    new Hilo3d.Color(1, 0.28, 0.5),
    new Hilo3d.Color(1, 0.7, 0.12)
] as const;

function fixedBox(x: number, y: number, width: number, height: number, rotation = 0): void {
    const body = physics.createRigidBody({ type: 'fixed', position: { x, y }, rotation });
    physics.createCollider(
        {
            shape: {
                type: 'cuboid',
                halfExtents: { x: width / 2, y: height / 2 },
                borderRadius: 0.04
            },
            friction: 0.55,
            restitution: 0.32
        },
        body
    );
    new Hilo3d.Mesh({
        x,
        y,
        rotationZ: (rotation * 180) / Math.PI,
        geometry: new Hilo3d.BoxGeometry({ width, height, depth: 0.34 }),
        material: frameMaterial,
        castShadows: true,
        receiveShadows: true
    }).addTo(stage);
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
        const body = physics.createRigidBody({ type: 'fixed', position: { x, y } });
        physics.createCollider({ shape: { type: 'ball', radius: 0.16 }, restitution: 0.5 }, body);
        new Hilo3d.Mesh({
            x,
            y,
            geometry: new Hilo3d.SphereGeometry({
                radius: 0.16,
                widthSegments: 18,
                heightSegments: 12
            }),
            material: pegMaterial,
            castShadows: true
        }).addTo(stage);
    }
}

const sensorBody = physics.createRigidBody({ type: 'fixed', position: { x: 0, y: -3.72 } });
const sensor = physics.createCollider(
    {
        shape: { type: 'cuboid', halfExtents: { x: 1.2, y: 0.15 } },
        sensor: true,
        collisionEvents: true
    },
    sensorBody
);
new Hilo3d.Mesh({
    y: -3.72,
    geometry: new Hilo3d.BoxGeometry({ width: 2.4, height: 0.12, depth: 0.15 }),
    material: new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.03, 0.9, 1),
        roughness: 0.18,
        metallic: 0.35
    })
}).addTo(stage);

const marbles: PhysicsRigidBody<'2d'>[] = [];
for (let index = 0; index < 24; index += 1) {
    const position = {
        x: -3.5 + (index % 8) * 0.88,
        y: 4.1 + Math.floor(index / 8) * 0.64
    };
    const radius = 0.2 + (index % 3) * 0.025;
    const body = physics.createRigidBody({
        type: 'dynamic',
        position,
        linearDamping: 0.025,
        angularDamping: 0.02,
        continuousCollisionDetection: index % 4 === 0
    });
    physics.createCollider(
        {
            shape: { type: 'ball', radius },
            density: 1,
            friction: 0.24,
            restitution: 0.48,
            collisionEvents: true
        },
        body
    );
    const mesh = new Hilo3d.Mesh({
        ...position,
        geometry: new Hilo3d.SphereGeometry({ radius, widthSegments: 20, heightSegments: 14 }),
        material: new Hilo3d.PBRMaterial({
            baseColor: colors[index % colors.length] ?? colors[0],
            roughness: 0.2,
            metallic: 0.35
        }),
        castShadows: true
    }).addTo(stage);
    bindNode2D(physics, body, mesh);
    marbles.push(body);
}

let sensorHits = 0;
sensor.on('collisionstart', () => {
    sensorHits += 1;
});
document.getElementById('marbles')?.replaceChildren(String(marbles.length));
const sensorHitsElement = document.getElementById('sensor-hits');
const diagnosticsTick: Hilo3d.Tickable = {
    tick(): void {
        if (sensorHitsElement) sensorHitsElement.textContent = String(sensorHits);
    }
};
ticker.addTick(diagnosticsTick);
