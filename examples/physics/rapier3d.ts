import {
    PHYSICS_WORLD_3D_SERVICE,
    bindNode3D,
    createRapier3DPhysicsPlugin
} from '@hilo3d/addon-physics/rapier3d';
import * as Hilo3d from '../../src/Hilo3d';
import { createExampleContext } from '../shared/init';

const physicsPlugin = createRapier3DPhysicsPlugin({
    gravity: { x: 0, y: -9.81, z: 0 },
    fixedTimeStep: 1 / 60,
    maxSubSteps: 4,
    maxDeltaSeconds: 0.1,
    solverIterations: 8,
    maxCcdSubsteps: 2
});

const { stage, camera, directionLight, ambientLight, orbitControls, ticker } =
    await createExampleContext({
        camera: { x: 7.2, y: 5.4, z: 8.4, far: 80 },
        stage: { plugins: [physicsPlugin], useInstanced: true },
        controls: { target: new Hilo3d.Vector3(0, 2, 0), minDistance: 5, maxDistance: 18 }
    });
const physics = stage.pluginHost.get(PHYSICS_WORLD_3D_SERVICE);

camera.lookAt(new Hilo3d.Vector3(0, 1.8, 0));
orbitControls.setView(camera.position, new Hilo3d.Vector3(0, 1.8, 0));
directionLight.amount = 5;
directionLight.direction = new Hilo3d.Vector3(-0.65, -1, -0.4);
ambientLight.amount = 0.65;

const ground = physics.createRigidBody({
    type: 'fixed',
    position: { x: 0, y: -0.3, z: 0 }
});
physics.createCollider(
    {
        shape: { type: 'cuboid', halfExtents: { x: 5, y: 0.3, z: 5 } },
        friction: 0.85,
        restitution: 0.1,
        collisionEvents: true
    },
    ground
);
new Hilo3d.Mesh({
    y: -0.3,
    geometry: new Hilo3d.BoxGeometry({ width: 10, height: 0.6, depth: 10 }),
    material: new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.06, 0.13, 0.24),
        roughness: 0.82,
        metallic: 0.08
    }),
    receiveShadows: true
}).addTo(stage);

const colors = [
    new Hilo3d.Color(0.06, 0.72, 1),
    new Hilo3d.Color(1, 0.24, 0.42),
    new Hilo3d.Color(0.72, 0.34, 1),
    new Hilo3d.Color(1, 0.65, 0.12)
] as const;

function createDynamicBody(index: number): void {
    const sphere = index % 3 === 0;
    const size = 0.28 + (index % 5) * 0.035;
    const position = {
        x: ((index * 7) % 11) * 0.34 - 1.7,
        y: 1.2 + index * 0.48,
        z: ((index * 5) % 9) * 0.3 - 1.2
    };
    const body = physics.createRigidBody({
        type: 'dynamic',
        position,
        linearDamping: 0.05,
        angularDamping: 0.08,
        continuousCollisionDetection: index % 4 === 0
    });
    physics.createCollider(
        {
            shape: sphere
                ? { type: 'ball', radius: size }
                : {
                      type: 'cuboid',
                      halfExtents: { x: size, y: size, z: size }
                  },
            density: 1,
            friction: 0.62,
            restitution: 0.28,
            collisionEvents: true
        },
        body
    );
    const mesh = new Hilo3d.Mesh({
        ...position,
        geometry: sphere
            ? new Hilo3d.SphereGeometry({ radius: size, heightSegments: 18, widthSegments: 24 })
            : new Hilo3d.BoxGeometry({ width: size * 2, height: size * 2, depth: size * 2 }),
        material: new Hilo3d.PBRMaterial({
            baseColor: colors[index % colors.length] ?? colors[0],
            roughness: 0.34,
            metallic: 0.2
        }),
        castShadows: true,
        receiveShadows: true
    }).addTo(stage);
    bindNode3D(physics, body, mesh);
}

for (let index = 0; index < 24; index += 1) createDynamicBody(index);

let contactCount = 0;
physics.on('collisionstart', () => {
    contactCount += 1;
});

const bodyCount = document.getElementById('body-count');
const contactCountElement = document.getElementById('contact-count');
const diagnosticsTick: Hilo3d.Tickable = {
    tick(): void {
        const diagnostics = physics.getDiagnostics();
        if (bodyCount) bodyCount.textContent = String(diagnostics.bodyCount);
        if (contactCountElement) contactCountElement.textContent = String(contactCount);
    }
};
ticker.addTick(diagnosticsTick);
