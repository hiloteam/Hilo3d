import { describe, expect, it } from 'vitest';
import { createPhysicsBackendExtension } from '../../../addon-physics/src/PhysicsBackend';
import { PhysicsWorld } from '../../../addon-physics/src/PhysicsWorld';
import {
    RAPIER_2D_NATIVE_EXTENSION,
    Rapier2DBackend
} from '../../../addon-physics/src/rapier2d/Rapier2DBackend';
import {
    RAPIER_3D_NATIVE_EXTENSION,
    Rapier3DBackend
} from '../../../addon-physics/src/rapier3d/Rapier3DBackend';
import type {
    PhysicsJointDescriptor2D,
    PhysicsJointDescriptor3D,
    PhysicsShape2D,
    PhysicsShape3D
} from '../../../addon-physics/src/types';

describe('Rapier portable backend conformance', () => {
    it('constructs every declared 2D shape and joint through portable descriptors', async () => {
        const world = await PhysicsWorld.create({
            backend: new Rapier2DBackend(),
            gravity: { x: 0, y: -9.81 }
        });
        try {
            const parent = world.createRigidBody({ type: 'fixed' });
            const shapes: readonly PhysicsShape2D[] = [
                { type: 'ball', radius: 0.5 },
                {
                    type: 'cuboid',
                    halfExtents: { x: 0.5, y: 0.4 },
                    borderRadius: 0.05
                },
                { type: 'capsule', halfHeight: 0.5, radius: 0.2 },
                { type: 'segment', a: { x: -1, y: 0 }, b: { x: 1, y: 0 } },
                {
                    type: 'triangle',
                    a: { x: 0, y: 1 },
                    b: { x: -1, y: -1 },
                    c: { x: 1, y: -1 },
                    borderRadius: 0.02
                },
                {
                    type: 'polyline',
                    vertices: new Float32Array([-1, 0, 0, 1, 1, 0]),
                    indices: new Uint32Array([0, 1, 1, 2])
                },
                {
                    type: 'trimesh',
                    vertices: new Float32Array([-1, -1, 0, 1, 1, -1]),
                    indices: new Uint32Array([0, 1, 2])
                },
                {
                    type: 'convex-hull',
                    points: new Float32Array([-1, -1, 0, 1, 1, -1]),
                    borderRadius: 0.01
                },
                {
                    type: 'heightfield',
                    heights: new Float32Array([0, 0.5, 0]),
                    scale: { x: 2, y: 1 }
                },
                { type: 'halfspace', normal: { x: 0, y: 2 } }
            ];
            for (const shape of shapes) {
                expect(world.createCollider({ shape }, parent).valid).toBe(true);
            }

            const body1 = world.createRigidBody({ type: 'dynamic', position: { x: -1, y: 2 } });
            const body2 = world.createRigidBody({ type: 'dynamic', position: { x: 1, y: 2 } });
            const origin = { x: 0, y: 0 } as const;
            const joints: readonly PhysicsJointDescriptor2D[] = [
                { type: 'fixed', anchor1: origin, anchor2: origin },
                { type: 'revolute', anchor1: origin, anchor2: origin, limits: [-1, 1] },
                {
                    type: 'prismatic',
                    anchor1: origin,
                    anchor2: origin,
                    axis: { x: 2, y: 0 },
                    limits: [-0.5, 0.5]
                },
                { type: 'rope', length: 3, anchor1: origin, anchor2: origin },
                {
                    type: 'spring',
                    restLength: 2,
                    stiffness: 20,
                    damping: 1,
                    anchor1: origin,
                    anchor2: origin
                }
            ];
            const created = joints.map(descriptor => world.createJoint(descriptor, body1, body2));
            created[1]?.setLimits(-0.8, 0.8).configureMotor({
                targetVelocity: 1,
                stiffness: 4,
                damping: 0.5
            });
            expect(created.every(joint => joint.valid)).toBe(true);
            expect(world.getExtension(RAPIER_2D_NATIVE_EXTENSION)?.world).toBeDefined();
        } finally {
            world.destroy();
        }
    });

    it('constructs every declared 3D shape and joint and rejects unsafe descriptors', async () => {
        const world = await PhysicsWorld.create({
            backend: new Rapier3DBackend(),
            gravity: { x: 0, y: -9.81, z: 0 }
        });
        try {
            const parent = world.createRigidBody({ type: 'fixed' });
            const shapes: readonly PhysicsShape3D[] = [
                { type: 'ball', radius: 0.5 },
                {
                    type: 'cuboid',
                    halfExtents: { x: 0.5, y: 0.4, z: 0.3 },
                    borderRadius: 0.05
                },
                { type: 'capsule', halfHeight: 0.5, radius: 0.2 },
                { type: 'cylinder', halfHeight: 0.5, radius: 0.3, borderRadius: 0.02 },
                { type: 'cone', halfHeight: 0.5, radius: 0.3, borderRadius: 0.02 },
                {
                    type: 'trimesh',
                    vertices: new Float32Array([-1, 0, -1, 1, 0, -1, 0, 0, 1]),
                    indices: new Uint32Array([0, 1, 2])
                },
                {
                    type: 'convex-hull',
                    points: new Float32Array([0, 1, 0, -1, -1, -1, 1, -1, -1, 0, -1, 1]),
                    borderRadius: 0.01
                },
                {
                    type: 'heightfield',
                    rows: 2,
                    columns: 2,
                    heights: new Float32Array([0, 0.2, 0.4, 0, 0.1, 0.3, 0, 0.2, 0]),
                    scale: { x: 2, y: 1, z: 2 }
                }
            ];
            for (const shape of shapes) {
                expect(world.createCollider({ shape }, parent).valid).toBe(true);
            }

            const body1 = world.createRigidBody({
                type: 'dynamic',
                position: { x: -1, y: 2, z: 0 }
            });
            const body2 = world.createRigidBody({
                type: 'dynamic',
                position: { x: 1, y: 2, z: 0 }
            });
            const origin = { x: 0, y: 0, z: 0 } as const;
            const joints: readonly PhysicsJointDescriptor3D[] = [
                { type: 'fixed', anchor1: origin, anchor2: origin },
                { type: 'spherical', anchor1: origin, anchor2: origin },
                {
                    type: 'revolute',
                    anchor1: origin,
                    anchor2: origin,
                    axis: { x: 0, y: 2, z: 0 },
                    limits: [-1, 1]
                },
                {
                    type: 'prismatic',
                    anchor1: origin,
                    anchor2: origin,
                    axis: { x: 2, y: 0, z: 0 },
                    limits: [-0.5, 0.5]
                },
                { type: 'rope', length: 3, anchor1: origin, anchor2: origin },
                {
                    type: 'spring',
                    restLength: 2,
                    stiffness: 20,
                    damping: 1,
                    anchor1: origin,
                    anchor2: origin
                }
            ];
            const created = joints.map(descriptor => world.createJoint(descriptor, body1, body2));
            created[2]?.setLimits(-0.8, 0.8).configureMotor({ targetVelocity: 1 });
            expect(created.every(joint => joint.valid)).toBe(true);
            expect(world.getExtension(RAPIER_3D_NATIVE_EXTENSION)?.module).toBeDefined();
            expect(
                world.getExtension(createPhysicsBackendExtension<never>('test/missing'))
            ).toBeNull();

            expect(() =>
                world.createRigidBody({
                    type: 'dynamic',
                    position: { x: Number.NaN, y: 0, z: 0 }
                })
            ).toThrow('must be finite');
            expect(() =>
                world.createCollider(
                    {
                        shape: {
                            type: 'trimesh',
                            vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                            indices: new Uint32Array([0, 1, 3])
                        }
                    },
                    parent
                )
            ).toThrow('out-of-range');
            expect(() => {
                world.timeScale = Number.POSITIVE_INFINITY;
            }).toThrow('timeScale');
        } finally {
            world.destroy();
        }
    });
});
