import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PhysicsWorld, Rapier3DBackend } from '@hilo/addon-physics/rapier3d';
import {
    CharacterExperiment,
    COURIER_PHYSICS,
    COURIER_START
} from '../../examples/physics/characterExperiment';

describe('clockwork courier physics contract', () => {
    let world: PhysicsWorld<'3d'>;
    let courier: CharacterExperiment;

    beforeEach(async () => {
        world = await PhysicsWorld.create({ backend: new Rapier3DBackend(), ...COURIER_PHYSICS });
        courier = new CharacterExperiment(world);
    });
    afterEach(() => {
        world.destroy();
    });

    function advance(seconds: number, sample?: () => void): void {
        for (let frame = 0; frame < Math.round(seconds * 60); frame += 1) {
            courier.prepare(1000 / 60);
            world.advance(1000 / 60);
            courier.sample();
            sample?.();
        }
    }

    it('completes a physical route across steps, down the ramp, through the gate, past a crate and over the hurdle', () => {
        let highest = 0;
        let detectedObstacle = false;
        advance(18, () => {
            highest = Math.max(highest, courier.body.pose.position.y);
            detectedObstacle ||= courier.obstacleDistance !== null;
        });
        expect(highest).toBeGreaterThan(1.2);
        expect(courier.laps).toBeGreaterThanOrEqual(1);
        expect(courier.jumps).toBeGreaterThanOrEqual(1);
        expect(courier.landings).toBeGreaterThanOrEqual(2);
        expect(detectedObstacle).toBe(true);
        const parcel = courier.crates[0];
        if (!parcel) throw new Error('The delivery route needs its movable parcel');
        expect(parcel.body.pose.position.x - parcel.position.x).toBeGreaterThan(1);
    });

    it('blocks at a step without assistance and climbs the same step when assistance is enabled', () => {
        courier.setStepAssist(false);
        courier.setDirection(1, 0);
        advance(2.2);
        expect(courier.body.pose.position.x).toBeLessThan(-3.95);
        courier.setStepAssist(true);
        advance(2.2);
        expect(courier.body.pose.position.x).toBeGreaterThan(-2.1);
        expect(courier.body.pose.position.y).toBeGreaterThan(1.1);
    });

    it('jumps from grounded state, remains airborne, then lands on the queried ground', () => {
        courier.setAutomatic(false);
        advance(0.5);
        expect(courier.grounded).toBe(true);
        const start = courier.body.pose.position.y;
        const landings = courier.landings;
        let highest = start;
        let airborne = false;
        courier.requestJump();
        advance(1.5, () => {
            highest = Math.max(highest, courier.body.pose.position.y);
            airborne ||= !courier.grounded;
        });
        expect(courier.jumps).toBe(1);
        expect(highest - start).toBeGreaterThan(0.75);
        expect(airborne).toBe(true);
        expect(courier.grounded).toBe(true);
        expect(courier.landings).toBe(landings + 1);
        expect(courier.body.pose.position.y).toBeCloseTo(start, 2);
        expect(courier.groundDistance).toBeGreaterThan(0.6);
        expect(courier.groundDistance).toBeLessThan(0.65);
    });

    it('slides tangentially along a wall without crossing the wall collider', () => {
        courier.body.setPose({
            position: { x: -3, y: 0.64, z: -2.5 },
            rotation: { x: 0, y: 0, z: 0, w: 1 }
        });
        courier.setDirection(1, -1);
        let detected = false;
        advance(2, () => {
            detected ||= courier.obstacleDistance !== null;
        });
        expect(courier.body.pose.position.z).toBeGreaterThan(-2.72);
        expect(courier.body.pose.position.x).toBeGreaterThan(-1.4);
        expect(courier.contacts).toBeGreaterThan(0);
        expect(detected).toBe(true);
    });

    it('respects pause and quarter speed, and resets the existing world and controller cleanly', () => {
        advance(2);
        world.paused = true;
        const before = world.getDiagnostics();
        const pose = courier.body.pose;
        advance(1);
        expect(courier.body.pose).toEqual(pose);
        expect(world.getDiagnostics().simulatedSteps).toBe(before.simulatedSteps);
        courier.reset();
        expect(courier.body.pose.position.x).toBeCloseTo(COURIER_START.x, 5);
        expect(courier.body.pose.position.y).toBeCloseTo(COURIER_START.y, 5);
        expect(courier.body.pose.position.z).toBeCloseTo(COURIER_START.z, 5);
        expect(courier.jumps).toBe(0);
        expect(courier.landings).toBe(0);
        expect(world.getDiagnostics().bodyCount).toBe(before.bodyCount);
        expect(world.getDiagnostics().characterControllerCount).toBe(1);
        world.paused = false;
        world.timeScale = 0.25;
        advance(0.8);
        expect(world.getDiagnostics().simulatedSteps - before.simulatedSteps).toBe(24);
        expect(courier.body.pose.position.x - COURIER_START.x).toBeGreaterThan(0.2);
        expect(courier.body.pose.position.x - COURIER_START.x).toBeLessThan(0.4);
    });
});
