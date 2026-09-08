import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PhysicsWorld, Rapier3DBackend } from '@hilo/addon-physics/rapier3d';
import {
    createMaterialExperiments,
    MATERIAL_EXPERIMENT_LAYOUT,
    MATERIAL_EXPERIMENT_PHYSICS,
    materialSlideDistance,
    type MaterialExperiments
} from '../../examples/physics/materialExperiments';

describe('material atelier physics contract', () => {
    let physics: PhysicsWorld<'3d'>;
    let experiments: MaterialExperiments;

    beforeEach(async () => {
        physics = await PhysicsWorld.create({
            backend: new Rapier3DBackend(),
            ...MATERIAL_EXPERIMENT_PHYSICS
        });
        experiments = createMaterialExperiments(physics);
    });

    afterEach(() => {
        physics.destroy();
    });

    function advance(seconds: number, sample?: () => void): void {
        const frames = Math.round(seconds / physics.fixedTimeStep);
        for (let frame = 0; frame < frames; frame += 1) {
            physics.advance(physics.fixedTimeStep * 1000);
            sample?.();
        }
    }

    it('shows four measured rebound heights consistent with the restitution coefficients', () => {
        const { impactSurfaceY, ballRadius, releaseY } = MATERIAL_EXPERIMENT_LAYOUT;
        const heights = experiments.bounceStations.map(() => 0);
        advance(3, () => {
            for (const [index, station] of experiments.bounceStations.entries()) {
                if (station.contacts !== 1) continue;
                heights[index] = Math.max(
                    heights[index] ?? 0,
                    station.body.pose.position.y - impactSurfaceY - ballRadius
                );
            }
        });
        const releaseHeight = releaseY - impactSurfaceY - ballRadius;
        for (const [index, station] of experiments.bounceStations.entries()) {
            const height = heights[index] ?? 0;
            expect(station.contacts).toBeGreaterThan(0);
            expect(height).toBeGreaterThan(heights[index - 1] ?? 0);
            expect(Math.abs(height - releaseHeight * station.coefficient ** 2)).toBeLessThan(0.045);
        }
    });

    it('lets the low-friction samples slide while keeping both high-friction samples on their ramps', () => {
        advance(1.5);
        const distances = experiments.frictionLanes.map(materialSlideDistance);
        expect(distances[0]).toBeGreaterThan(1.8);
        expect(distances[1]).toBeGreaterThan(0.8);
        expect(distances[0]).toBeGreaterThan(distances[1] ?? 0);
        expect(distances[2]).toBeLessThan(0.015);
        expect(distances[3]).toBeLessThan(0.015);

        advance(6.5);
        for (const lane of experiments.frictionLanes.slice(0, 2)) {
            expect(materialSlideDistance(lane)).toBeGreaterThan(6.5);
            expect(materialSlideDistance(lane)).toBeLessThan(7.15);
            expect(lane.body.pose.position.y).toBeGreaterThan(0.24);
        }
        for (const lane of experiments.frictionLanes.slice(2)) {
            expect(materialSlideDistance(lane)).toBeLessThan(0.015);
        }
    });

    it('freezes the whole apparatus when paused and uses the configured quarter-speed clock', () => {
        advance(0.4);
        const steps = physics.getDiagnostics().simulatedSteps;
        const poses = experiments.bounceStations.map(station => station.body.pose);
        const slides = experiments.frictionLanes.map(materialSlideDistance);
        physics.paused = true;
        advance(2);
        expect(physics.getDiagnostics().simulatedSteps).toBe(steps);
        expect(experiments.bounceStations.map(station => station.body.pose)).toEqual(poses);
        expect(experiments.frictionLanes.map(materialSlideDistance)).toEqual(slides);

        physics.paused = false;
        physics.timeScale = 0.25;
        advance(0.8);
        expect(physics.getDiagnostics().simulatedSteps - steps).toBe(24);
    });

    it('releases the same eight existing specimens again without accumulating bodies or contacts', () => {
        advance(3);
        const before = physics.getDiagnostics();
        expect(experiments.bounceStations.some(station => station.contacts > 0)).toBe(true);
        experiments.reset();
        for (const specimen of [...experiments.bounceStations, ...experiments.frictionLanes]) {
            const position = specimen.body.pose.position;
            expect(position.x).toBeCloseTo(specimen.position.x, 5);
            expect(position.y).toBeCloseTo(specimen.position.y, 5);
            expect(position.z).toBeCloseTo(specimen.position.z, 5);
            expect(specimen.body.linearVelocity).toEqual({ x: 0, y: 0, z: 0 });
            expect(specimen.body.angularVelocity).toEqual({ x: 0, y: 0, z: 0 });
        }
        expect(experiments.bounceStations.map(station => station.contacts)).toEqual([0, 0, 0, 0]);
        advance(1);
        expect(experiments.bounceStations.every(station => station.contacts > 0)).toBe(true);
        expect(physics.getDiagnostics().bodyCount).toBe(before.bodyCount);
        expect(physics.getDiagnostics().colliderCount).toBe(before.colliderCount);
    });
});
