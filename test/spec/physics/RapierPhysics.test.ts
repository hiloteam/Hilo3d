import { describe, expect, it, vi } from 'vitest';
import { PhysicsWorld } from '../../../addon-physics/src/PhysicsWorld';
import { Rapier2DBackend } from '../../../addon-physics/src/rapier2d/Rapier2DBackend';
import { Rapier3DBackend } from '../../../addon-physics/src/rapier3d/Rapier3DBackend';

describe('Rapier physics adapters', () => {
    it('bounds fixed-step overload and exposes scheduler diagnostics', async () => {
        const world = await PhysicsWorld.create({
            backend: new Rapier2DBackend(),
            gravity: { x: 0, y: -9.81 },
            fixedTimeStep: 0.02,
            maxSubSteps: 2,
            maxDeltaSeconds: 0.1
        });
        try {
            const result = world.advance(1_000);
            expect(result.steps).toBe(2);
            expect(result.droppedTimeSeconds).toBeCloseTo(0.96, 8);
            expect(world.getDiagnostics()).toMatchObject({
                simulatedSteps: 2,
                droppedTimeSeconds: result.droppedTimeSeconds
            });
        } finally {
            world.destroy();
        }
    });

    it('simulates, queries, emits events, snapshots, and invalidates stale 3D wrappers', async () => {
        const world = await PhysicsWorld.create({
            backend: new Rapier3DBackend(),
            gravity: { x: 0, y: -9.81, z: 0 },
            fixedTimeStep: 1 / 60,
            maxSubSteps: 4,
            maxCcdSubsteps: 2
        });
        try {
            const ground = world.createRigidBody({
                type: 'fixed',
                position: { x: 0, y: -0.5, z: 0 }
            });
            world.createCollider(
                {
                    shape: { type: 'cuboid', halfExtents: { x: 5, y: 0.5, z: 5 } },
                    collisionEvents: true
                },
                ground
            );
            const body = world.createRigidBody({
                type: 'dynamic',
                position: { x: 0, y: 3, z: 0 },
                continuousCollisionDetection: true
            });
            const collider = world.createCollider(
                {
                    shape: { type: 'ball', radius: 0.5 },
                    restitution: 0,
                    collisionEvents: true,
                    contactForceEventThreshold: 0
                },
                body
            );
            const collisionStart = vi.fn();
            const contactForce = vi.fn();
            world.on('collisionstart', collisionStart);
            collider.on('contactforce', contactForce);

            for (let index = 0; index < 150; index += 1) world.advance(1_000 / 60);

            expect(body.pose.position.y).toBeGreaterThan(0.4);
            expect(body.pose.position.y).toBeLessThan(0.7);
            expect(collisionStart).toHaveBeenCalled();
            expect(contactForce).toHaveBeenCalled();

            const rayHit = world.castRay({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 10, true, {
                excludeRigidBody: body.handle
            });
            expect(rayHit?.colliderHandle).not.toBe(collider.handle);
            expect(rayHit?.point.y).toBeCloseTo(0, 4);
            const shapeHit = world.castShape(
                {
                    position: { x: 0, y: 3, z: 0 },
                    rotation: { x: 0, y: 0, z: 0, w: 1 }
                },
                { x: 0, y: -5, z: 0 },
                { type: 'ball', radius: 0.25 },
                { filter: { excludeRigidBody: body.handle } }
            );
            expect(shapeHit?.colliderHandle).toBe(rayHit?.colliderHandle);
            expect(shapeHit?.timeOfImpact).toBeGreaterThan(0);
            expect(
                world.overlapShape(body.pose, { type: 'ball', radius: 0.6 }, { maxResults: 4 })
            ).toContain(collider);
            expect(world.projectPoint({ x: 0, y: 2, z: 0 })?.colliderHandle).toBe(collider.handle);
            expect(world.debugRender().vertices.length).toBeGreaterThan(0);

            const characterBody = world.createRigidBody({
                type: 'kinematic-position',
                position: { x: 2, y: 2, z: 0 }
            });
            const characterCollider = world.createCollider(
                { shape: { type: 'capsule', halfHeight: 0.5, radius: 0.25 } },
                characterBody
            );
            const character = world.createCharacterController({
                offset: 0.01,
                autostep: { maxHeight: 0.3, minWidth: 0.2 },
                maxSlopeClimbAngle: Math.PI / 4,
                minSlopeSlideAngle: Math.PI / 3,
                snapToGroundDistance: 0.2,
                slide: true
            });
            world.advance(1_000 / 60);
            const characterMovement = character.computeMovement(
                characterCollider,
                { x: 0, y: -3, z: 0 },
                { excludeRigidBody: characterBody.handle }
            );
            expect(characterMovement.translation.y).toBeGreaterThan(-3);
            expect(characterMovement.collisions.length).toBeGreaterThan(0);
            expect(world.getDiagnostics().characterControllerCount).toBe(1);

            const snapshot = world.takeSnapshot();
            const handle = body.handle;
            body.applyImpulse({ x: 2, y: 6, z: 0 });
            for (let index = 0; index < 10; index += 1) world.advance(1_000 / 60);
            world.restoreSnapshot(snapshot);

            expect(body.valid).toBe(false);
            expect(character.valid).toBe(false);
            const restored = world.getRigidBody(handle);
            expect(restored?.valid).toBe(true);
            expect(restored?.pose.position.y).toBeCloseTo(0.5, 3);
            expect(world.getDiagnostics().bindingCount).toBe(0);
            expect(world.getDiagnostics().characterControllerCount).toBe(0);
        } finally {
            world.destroy();
        }
    });

    it('keeps the 2D adapter independent and supports sensor events and filtered rays', async () => {
        const world = await PhysicsWorld.create({
            backend: new Rapier2DBackend(),
            gravity: { x: 0, y: -9.81 },
            fixedTimeStep: 1 / 60
        });
        try {
            const sensor = world.createCollider({
                shape: { type: 'cuboid', halfExtents: { x: 1, y: 0.25 } },
                localPosition: { x: 0, y: 1 },
                sensor: true,
                collisionEvents: true
            });
            const groundBody = world.createRigidBody({
                type: 'fixed',
                position: { x: 0, y: -0.25 }
            });
            world.createCollider(
                { shape: { type: 'cuboid', halfExtents: { x: 5, y: 0.25 } } },
                groundBody
            );
            const body = world.createRigidBody({
                type: 'dynamic',
                position: { x: 0, y: 3 }
            });
            const collider = world.createCollider(
                { shape: { type: 'ball', radius: 0.2 }, collisionEvents: true },
                body
            );
            const collisionStart = vi.fn();
            sensor.on('collisionstart', collisionStart);

            world.advance(1_000 / 60);
            const hit = world.castRay({ x: 0, y: 4 }, { x: 0, y: -1 }, 8, true, {
                excludeSensors: true
            });
            expect(hit?.colliderHandle).toBe(collider.handle);
            expect(
                world.overlapShape(body.pose, { type: 'ball', radius: 0.25 }, { maxResults: 2 })
            ).toContain(collider);

            const characterBody = world.createRigidBody({
                type: 'kinematic-position',
                position: { x: 2, y: 2 }
            });
            const characterCollider = world.createCollider(
                { shape: { type: 'capsule', halfHeight: 0.4, radius: 0.2 } },
                characterBody
            );
            const character = world.createCharacterController({
                offset: 0.01,
                snapToGroundDistance: 0.2
            });
            world.advance(1_000 / 60);
            const movement = character.computeMovement(
                characterCollider,
                { x: 0, y: -3 },
                { excludeRigidBody: characterBody.handle, excludeSensors: true }
            );
            expect(movement.translation.y).toBeGreaterThan(-3);
            expect(movement.collisions.length).toBeGreaterThan(0);

            for (let index = 0; index < 90; index += 1) world.advance(1_000 / 60);

            expect(collisionStart).toHaveBeenCalled();
        } finally {
            world.destroy();
        }
    });
});
