import type {
    PhysicsCharacterController,
    PhysicsCollider,
    PhysicsPose3D,
    PhysicsRigidBody,
    PhysicsShape3D,
    PhysicsVector3,
    PhysicsWorld
} from '@hilo/addon-physics/rapier3d';

export const COURIER_PHYSICS = {
    gravity: { x: 0, y: -9.81, z: 0 },
    fixedTimeStep: 1 / 120,
    maxSubSteps: 8,
    maxDeltaSeconds: 0.1,
    solverIterations: 8
} as const;
export const COURIER_START: PhysicsVector3 = { x: -4.7, y: 0.66, z: 1.6 };
export const COURIER_SHAPE: PhysicsShape3D = { type: 'capsule', radius: 0.29, halfHeight: 0.31 };
const identity = { x: 0, y: 0, z: 0, w: 1 } as const;
const route = [
    { x: -0.25, z: 1.6 },
    { x: 4.7, z: 1.6 },
    { x: 4.7, z: -1.75 },
    { x: -4.7, z: -1.75 },
    { x: -4.7, z: 1.6 }
] as const;

export interface CourierTerrain {
    readonly kind: 'step' | 'deck' | 'ramp' | 'column' | 'lintel' | 'hurdle' | 'wall';
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly width: number;
    readonly height: number;
    readonly depth: number;
    readonly rotationZ?: number;
}

export const COURIER_TERRAIN: readonly CourierTerrain[] = [
    { kind: 'step', x: -3.6, y: 0.1, z: 1.6, width: 0.7, height: 0.2, depth: 1.75 },
    { kind: 'step', x: -2.9, y: 0.2, z: 1.6, width: 0.7, height: 0.4, depth: 1.75 },
    { kind: 'step', x: -2.2, y: 0.3, z: 1.6, width: 0.7, height: 0.6, depth: 1.75 },
    { kind: 'deck', x: -0.62, y: 0.3, z: 1.6, width: 2.46, height: 0.6, depth: 1.75 },
    {
        kind: 'ramp',
        x: 1.53,
        y: 0.29,
        z: 1.6,
        width: 2.02,
        height: 0.12,
        depth: 1.75,
        rotationZ: -17
    },
    { kind: 'column', x: 2.98, y: 0.76, z: 0.54, width: 0.32, height: 1.52, depth: 0.32 },
    { kind: 'column', x: 2.98, y: 0.76, z: 2.66, width: 0.32, height: 1.52, depth: 0.32 },
    { kind: 'lintel', x: 2.98, y: 1.57, z: 1.6, width: 0.48, height: 0.22, depth: 2.52 },
    { kind: 'hurdle', x: -0.78, y: 0.28, z: -1.75, width: 0.3, height: 0.56, depth: 1.5 },
    { kind: 'wall', x: 0, y: 0.45, z: -3.09, width: 11.4, height: 0.9, depth: 0.18 },
    { kind: 'wall', x: -5.75, y: 0.25, z: 0, width: 0.18, height: 0.5, depth: 6.0 },
    { kind: 'wall', x: 5.75, y: 0.25, z: 0, width: 0.18, height: 0.5, depth: 6.0 }
];

interface CourierCrate {
    readonly body: PhysicsRigidBody<'3d'>;
    readonly position: PhysicsVector3;
}

/** Shared controller policy used by the exhibit and CPU acceptance tests. */
export class CharacterExperiment {
    readonly body: PhysicsRigidBody<'3d'>;
    readonly collider: PhysicsCollider<'3d'>;
    readonly crates: readonly CourierCrate[];
    grounded = false;
    automatic = true;
    stepAssist = true;
    jumps = 0;
    landings = 0;
    contacts = 0;
    laps = 0;
    heading: PhysicsVector3 = { x: 1, y: 0, z: 0 };
    obstacleDistance: number | null = null;
    groundDistance: number | null = null;
    private controller: PhysicsCharacterController<'3d'>;
    private targetPose: PhysicsPose3D;
    private verticalVelocity = 0;
    private jumpRequested = false;
    private manualX = 0;
    private manualZ = 0;
    private pulseSeconds = 0;
    private waypoint = 0;
    private readonly hurdleHandles = new Set<number>();

    constructor(readonly physics: PhysicsWorld<'3d'>) {
        const ground = physics.createRigidBody({
            type: 'fixed',
            position: { x: 0, y: -0.22, z: 0 }
        });
        physics.createCollider(
            {
                shape: { type: 'cuboid', halfExtents: { x: 5.95, y: 0.22, z: 3.25 } },
                friction: 0.65
            },
            ground
        );
        for (const piece of COURIER_TERRAIN) {
            const angle = ((piece.rotationZ ?? 0) * Math.PI) / 360;
            const body = physics.createRigidBody({
                type: 'fixed',
                position: { x: piece.x, y: piece.y, z: piece.z },
                rotation: { x: 0, y: 0, z: Math.sin(angle), w: Math.cos(angle) }
            });
            const collider = physics.createCollider(
                {
                    shape: {
                        type: 'cuboid',
                        halfExtents: { x: piece.width / 2, y: piece.height / 2, z: piece.depth / 2 }
                    },
                    friction: 0.65
                },
                body
            );
            if (piece.kind === 'hurdle') this.hurdleHandles.add(collider.handle);
        }
        // The three depot drums also block manual movement through the centre of the yard.
        for (let index = 0; index < 3; index += 1) {
            const drum = physics.createRigidBody({
                type: 'fixed',
                position: { x: -3.08 + index * 0.68, y: 0.18, z: -0.15 }
            });
            physics.createCollider(
                { shape: { type: 'cylinder', radius: 0.2, halfHeight: 0.18 }, friction: 0.6 },
                drum
            );
        }
        this.body = physics.createRigidBody({
            type: 'kinematic-position',
            position: COURIER_START
        });
        this.collider = physics.createCollider({ shape: COURIER_SHAPE, friction: 0.35 }, this.body);
        this.targetPose = { position: COURIER_START, rotation: identity };
        physics.bindTransform(
            this.body,
            {
                readPose: (): PhysicsPose3D => this.targetPose,
                writePose: (pose: PhysicsPose3D): void => {
                    this.targetPose = pose;
                }
            },
            { sync: 'target-to-physics' }
        );
        this.controller = this.createController();
        this.crates = [3.85, 4.5].map((x, index) => {
            const position = { x, y: 0.25, z: index === 0 ? 1.6 : -0.22 };
            const body = physics.createRigidBody({
                type: 'dynamic',
                position,
                linearDamping: 0.1,
                angularDamping: 0.15,
                continuousCollisionDetection: true
            });
            physics.createCollider(
                {
                    shape: { type: 'cuboid', halfExtents: { x: 0.22, y: 0.22, z: 0.22 } },
                    density: 0.7,
                    friction: 0.5,
                    restitution: 0.05
                },
                body
            );
            return { body, position };
        });
    }

    private createController(): PhysicsCharacterController<'3d'> {
        return this.physics.createCharacterController({
            offset: 0.02,
            up: { x: 0, y: 1, z: 0 },
            slide: true,
            autostep: this.stepAssist
                ? { maxHeight: 0.27, minWidth: 0.22, includeDynamicBodies: false }
                : false,
            maxSlopeClimbAngle: Math.PI / 4,
            minSlopeSlideAngle: Math.PI / 3,
            snapToGroundDistance: 0.22,
            applyImpulsesToDynamicBodies: true,
            characterMass: 4,
            normalNudgeFactor: 0.001
        });
    }

    setStepAssist(enabled: boolean): void {
        this.stepAssist = enabled;
        this.controller.destroy();
        this.controller = this.createController();
    }

    setAutomatic(enabled: boolean): void {
        this.automatic = enabled;
        this.manualX = 0;
        this.manualZ = 0;
        this.pulseSeconds = 0;
    }

    setDirection(x: number, z: number, pulseSeconds = 0): void {
        this.automatic = false;
        const length = Math.max(1, Math.hypot(x, z));
        this.manualX = x / length;
        this.manualZ = z / length;
        this.pulseSeconds = pulseSeconds;
    }

    requestJump(): void {
        this.jumpRequested = true;
    }

    reset(): void {
        this.body.setPose({ position: COURIER_START, rotation: identity });
        this.body.setLinearVelocity({ x: 0, y: 0, z: 0 });
        this.verticalVelocity = 0;
        this.grounded = false;
        this.jumps = 0;
        this.landings = 0;
        this.contacts = 0;
        this.laps = 0;
        this.waypoint = 0;
        this.jumpRequested = false;
        this.obstacleDistance = null;
        this.groundDistance = null;
        this.heading = { x: 1, y: 0, z: 0 };
        this.setAutomatic(true);
        this.setStepAssist(this.stepAssist);
        for (const crate of this.crates) {
            crate.body.setPose({ position: crate.position, rotation: identity });
            crate.body.setLinearVelocity({ x: 0, y: 0, z: 0 });
            crate.body.setAngularVelocity({ x: 0, y: 0, z: 0 });
        }
    }

    /** Runs before PhysicsWorld.advance; its existing scheduler distributes the checked target across substeps. */
    prepare(deltaMilliseconds: number): void {
        const world = this.physics;
        if (world.paused || world.timeScale === 0) return;
        const accepted = Math.min(
            (deltaMilliseconds / 1000) * world.timeScale,
            world.maxDeltaSeconds
        );
        const steps = Math.min(
            world.maxSubSteps,
            Math.floor((world.getDiagnostics().accumulatorSeconds + accepted) / world.fixedTimeStep)
        );
        const dt = steps * world.fixedTimeStep;
        if (dt === 0) return;
        const position = this.body.pose.position;
        let x = this.manualX;
        let z = this.manualZ;
        if (this.automatic) {
            let target = route[this.waypoint] ?? route[0];
            if (Math.hypot(target.x - position.x, target.z - position.z) < 0.18) {
                this.waypoint = (this.waypoint + 1) % route.length;
                if (this.waypoint === 0) this.laps += 1;
                target = route[this.waypoint] ?? target;
            }
            const distance = Math.max(
                0.001,
                Math.hypot(target.x - position.x, target.z - position.z)
            );
            x = (target.x - position.x) / distance;
            z = (target.z - position.z) / distance;
        }
        if (Math.hypot(x, z) > 0.01) this.heading = { x, y: 0, z };
        const hit = world.castShape(
            {
                position: { x: position.x, y: position.y + 0.045, z: position.z },
                rotation: identity
            },
            this.heading,
            COURIER_SHAPE,
            {
                maxTimeOfImpact: 0.9,
                filter: { excludeRigidBody: this.body.handle, excludeSensors: true }
            }
        );
        this.obstacleDistance = hit?.timeOfImpact ?? null;
        if (
            this.automatic &&
            this.grounded &&
            hit &&
            this.hurdleHandles.has(hit.colliderHandle) &&
            hit.timeOfImpact < 0.72
        )
            this.jumpRequested = true;
        const jumping = this.jumpRequested && this.grounded;
        this.jumpRequested = false;
        if (jumping) {
            this.verticalVelocity = 4.6;
            this.jumps += 1;
        } else
            this.verticalVelocity = this.grounded
                ? -0.7
                : Math.max(-9, this.verticalVelocity - 9.81 * dt);
        const movement = this.controller.computeMovement(
            this.collider,
            { x: x * 1.65 * dt, y: this.verticalVelocity * dt, z: z * 1.65 * dt },
            { excludeRigidBody: this.body.handle, excludeSensors: true }
        );
        if (movement.grounded && !this.grounded) this.landings += 1;
        this.grounded = movement.grounded;
        this.contacts += movement.collisions.length;
        if (this.verticalVelocity > 0 && movement.translation.y < this.verticalVelocity * dt * 0.5)
            this.verticalVelocity = 0;
        this.targetPose = {
            position: {
                x: position.x + movement.translation.x,
                y: position.y + movement.translation.y,
                z: position.z + movement.translation.z
            },
            rotation: identity
        };
        if (this.pulseSeconds > 0) {
            this.pulseSeconds -= dt;
            if (this.pulseSeconds <= 0) {
                this.manualX = 0;
                this.manualZ = 0;
            }
        }
    }

    /** Queries observe the last completed fixed step, after simulation has made poses authoritative. */
    sample(): void {
        const position = this.body.pose.position;
        const hit = this.physics.castRay(position, { x: 0, y: -1, z: 0 }, 3, true, {
            excludeRigidBody: this.body.handle,
            excludeSensors: true
        });
        this.groundDistance = hit?.distance ?? null;
    }
}
