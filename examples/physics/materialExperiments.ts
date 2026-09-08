import type {
    PhysicsQuaternion,
    PhysicsRigidBody,
    PhysicsVector3,
    PhysicsWorld
} from '@hilo/addon-physics/rapier3d';

export const MATERIAL_EXPERIMENT_LAYOUT = {
    ballRadius: 0.33,
    impactSurfaceY: 0.82,
    releaseY: 4.48,
    slopeDegrees: -12,
    laneCenterY: 1.24,
    restitution: [0.12, 0.42, 0.68, 0.92],
    friction: [0.02, 0.12, 0.26, 0.72]
} as const;

export const MATERIAL_EXPERIMENT_PHYSICS = {
    gravity: { x: 0, y: -9.81, z: 0 },
    fixedTimeStep: 1 / 120,
    maxSubSteps: 8,
    solverIterations: 8,
    maxCcdSubsteps: 2
} as const;

export interface MaterialSpecimen {
    readonly body: PhysicsRigidBody<'3d'>;
    readonly position: PhysicsVector3;
    readonly rotation: PhysicsQuaternion;
    readonly coefficient: number;
}

export interface BounceSpecimen extends MaterialSpecimen {
    contacts: number;
    reboundHeight: number;
}

export interface MaterialExperiments {
    readonly bounceStations: readonly BounceSpecimen[];
    readonly frictionLanes: readonly MaterialSpecimen[];
    reset(): void;
}

const slopeRadians = (MATERIAL_EXPERIMENT_LAYOUT.slopeDegrees * Math.PI) / 180;
const slopeCos = Math.cos(slopeRadians);
const slopeSin = Math.sin(slopeRadians);
const identityRotation: PhysicsQuaternion = { x: 0, y: 0, z: 0, w: 1 };
const slopeRotation: PhysicsQuaternion = {
    x: 0,
    y: 0,
    z: Math.sin(slopeRadians / 2),
    w: Math.cos(slopeRadians / 2)
};

export function materialLanePosition(localX: number, localY: number, z: number): PhysicsVector3 {
    return {
        x: localX * slopeCos - localY * slopeSin,
        y: MATERIAL_EXPERIMENT_LAYOUT.laneCenterY + localX * slopeSin + localY * slopeCos,
        z
    };
}

export function materialSlideDistance(specimen: MaterialSpecimen): number {
    const position = specimen.body.pose.position;
    return Math.max(
        0,
        (position.x - specimen.position.x) * slopeCos +
            (position.y - specimen.position.y) * slopeSin
    );
}

/** The exhibit and its CPU contracts use the same physical apparatus, independent of rendering. */
export function createMaterialExperiments(physics: PhysicsWorld<'3d'>): MaterialExperiments {
    const bounceStations: BounceSpecimen[] = [];
    const frictionLanes: MaterialSpecimen[] = [];
    const { ballRadius, releaseY, restitution, friction } = MATERIAL_EXPERIMENT_LAYOUT;

    function fixedBox(
        position: PhysicsVector3,
        width: number,
        height: number,
        depth: number,
        rotation: PhysicsQuaternion = identityRotation
    ): void {
        const body = physics.createRigidBody({ type: 'fixed', position, rotation });
        physics.createCollider(
            {
                shape: {
                    type: 'cuboid',
                    halfExtents: { x: width / 2, y: height / 2, z: depth / 2 }
                },
                friction: 1,
                restitution: 0,
                restitutionCombineRule: 'max',
                frictionCombineRule: 'multiply'
            },
            body
        );
    }

    fixedBox({ x: 0, y: 0.11, z: 0.65 }, 11.4, 0.26, 8.9);
    for (const [index, coefficient] of restitution.entries()) {
        const position = { x: -4.05 + index * 2.7, y: releaseY, z: -2.08 };
        const pad = physics.createRigidBody({
            type: 'fixed',
            position: { x: position.x, y: 0.775, z: position.z }
        });
        physics.createCollider(
            {
                shape: { type: 'cylinder', radius: 0.62, halfHeight: 0.045 },
                restitution: 0,
                restitutionCombineRule: 'max',
                friction: 0.2
            },
            pad
        );
        const body = physics.createRigidBody({
            type: 'dynamic',
            position,
            enabledTranslations: [false, true, false],
            enabledRotations: [false, false, false],
            continuousCollisionDetection: true
        });
        const collider = physics.createCollider(
            {
                shape: { type: 'ball', radius: ballRadius },
                restitution: coefficient,
                restitutionCombineRule: 'max',
                friction: 0.2,
                collisionEvents: true
            },
            body
        );
        const station: BounceSpecimen = {
            body,
            position,
            rotation: identityRotation,
            coefficient,
            contacts: 0,
            reboundHeight: 0
        };
        collider.on('collisionstart', () => {
            station.contacts += 1;
        });
        bounceStations.push(station);
    }

    for (const [index, coefficient] of friction.entries()) {
        const z = 0.14 + index * 1.22;
        fixedBox(materialLanePosition(0, 0, z), 8.5, 0.206, 0.95, slopeRotation);
        fixedBox(materialLanePosition(3.95, 0.285, z), 0.19, 0.38, 0.79, slopeRotation);
        for (const side of [-1, 1]) {
            fixedBox(
                materialLanePosition(0, 0.2, z + side * 0.46),
                8.52,
                0.2,
                0.065,
                slopeRotation
            );
        }
        const position = materialLanePosition(-3.3, 0.365, z);
        // Free rotation is essential: locking it changes Rapier's contact/friction response.
        const body = physics.createRigidBody({
            type: 'dynamic',
            position,
            rotation: slopeRotation,
            continuousCollisionDetection: true
        });
        physics.createCollider(
            {
                shape: { type: 'cuboid', halfExtents: { x: 0.34, y: 0.25, z: 0.3 } },
                friction: coefficient,
                frictionCombineRule: 'multiply',
                restitution: 0
            },
            body
        );
        frictionLanes.push({ body, position, rotation: slopeRotation, coefficient });
    }

    return {
        bounceStations,
        frictionLanes,
        reset(): void {
            for (const specimen of [...bounceStations, ...frictionLanes]) {
                specimen.body.setPose({ position: specimen.position, rotation: specimen.rotation });
                specimen.body.setLinearVelocity({ x: 0, y: 0, z: 0 });
                specimen.body.setAngularVelocity({ x: 0, y: 0, z: 0 });
            }
            for (const station of bounceStations) {
                station.contacts = 0;
                station.reboundHeight = 0;
            }
        }
    };
}
