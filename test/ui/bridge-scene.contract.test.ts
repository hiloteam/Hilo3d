import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PhysicsWorld, Rapier3DBackend } from '@hilo/addon-physics/rapier3d';
import {
    createBridgeExperiment,
    type BridgeExperiment
} from '../../examples/physics/bridgeExperiment';

describe('suspension atelier physics contract', () => {
    let world: PhysicsWorld<'3d'>;
    let bridge: BridgeExperiment;

    beforeEach(async () => {
        world = await PhysicsWorld.create({
            backend: new Rapier3DBackend(),
            gravity: { x: 0, y: -9.81, z: 0 },
            fixedTimeStep: 1 / 120,
            maxSubSteps: 8,
            solverIterations: 14,
            maxCcdSubsteps: 4
        });
        bridge = createBridgeExperiment(world);
    });
    afterEach(() => {
        world.destroy();
    });

    function advance(seconds: number, sample?: () => void): void {
        for (let frame = 0; frame < Math.round(seconds * 120); frame += 1) {
            world.advance(1000 / 120);
            sample?.();
        }
    }

    it('deflects under real cargo and recovers its unloaded span after removing the cargo', () => {
        advance(10);
        const before = world.getDiagnostics();
        const baseline = bridge.metrics().deflection;
        const center = bridge.deck[5];
        if (!center) throw new Error('The suspension bridge needs its center deck segment');
        const unloadedHeight = center.pose.position.y;
        const firstLoad = bridge.addLoad();
        const secondLoad = bridge.addLoad();
        if (!firstLoad || !secondLoad) throw new Error('The bridge must accept two cargo bodies');
        advance(10);
        const loaded = bridge.metrics().deflection;
        expect(loaded - baseline).toBeGreaterThan(0.15);
        expect(loaded).toBeLessThan(0.6);
        expect(center.pose.position.y).toBeLessThan(unloadedHeight - 0.1);
        expect(world.getDiagnostics().bodyCount).toBe(before.bodyCount + 2);
        expect(world.getDiagnostics().jointCount).toBe(before.jointCount);

        bridge.clearLoads();
        expect(firstLoad.valid).toBe(false);
        expect(secondLoad.valid).toBe(false);
        advance(15);
        expect(bridge.metrics().loads).toBe(0);
        expect(Math.abs(bridge.metrics().deflection - baseline)).toBeLessThan(0.015);
        expect(center.pose.position.y).toBeCloseTo(unloadedHeight, 2);
        expect(world.getDiagnostics().bodyCount).toBe(before.bodyCount);
        expect(world.getDiagnostics().colliderCount).toBe(before.colliderCount);
        expect(world.getDiagnostics().jointCount).toBe(before.jointCount);
    });

    it('bounds cargo at four bodies and releases every cargo collider before accepting new loads', () => {
        const baseline = world.getDiagnostics();
        const cargo = Array.from({ length: 4 }, () => bridge.addLoad());
        expect(cargo.every(body => body !== null)).toBe(true);
        expect(bridge.addLoad()).toBeNull();
        expect(bridge.metrics().loads).toBe(4);
        advance(4);
        expect(world.getDiagnostics().bodyCount).toBe(baseline.bodyCount + 4);
        expect(world.getDiagnostics().colliderCount).toBe(baseline.colliderCount + 4);
        expect(world.getDiagnostics().jointCount).toBe(baseline.jointCount);
        bridge.clearLoads();
        expect(cargo.every(body => body?.valid === false)).toBe(true);
        expect(world.getDiagnostics().bodyCount).toBe(baseline.bodyCount);
        expect(world.getDiagnostics().colliderCount).toBe(baseline.colliderCount);
        expect(bridge.addLoad()?.valid).toBe(true);
        expect(bridge.metrics().loads).toBe(1);
    });

    it('transfers a lateral impulse through the cable-supported deck without losing the span', () => {
        advance(2);
        bridge.sway();
        let maximumSway = 0;
        let minimumHeight = Infinity;
        let maximumHeight = -Infinity;
        let maximumX = 0;
        let maximumZ = 0;
        let finite = true;
        const structure = [...bridge.deck, ...bridge.cablePoints];
        advance(10, () => {
            maximumSway = Math.max(maximumSway, Math.abs(bridge.metrics().lateralDisplacement));
            for (const body of structure) {
                const position = body.pose.position;
                finite &&= Number.isFinite(position.x + position.y + position.z);
                minimumHeight = Math.min(minimumHeight, position.y);
                maximumHeight = Math.max(maximumHeight, position.y);
                maximumX = Math.max(maximumX, Math.abs(position.x));
                maximumZ = Math.max(maximumZ, Math.abs(position.z));
            }
        });
        expect(maximumSway).toBeGreaterThan(0.1);
        expect(maximumSway).toBeLessThan(0.6);
        expect(finite).toBe(true);
        expect(minimumHeight).toBeGreaterThan(0.2);
        expect(maximumHeight).toBeLessThan(5);
        expect(maximumX).toBeLessThan(6);
        expect(maximumZ).toBeLessThan(2);
        expect(bridge.metrics().joints).toBe(70);
    });

    it('freezes every structural body, advances at quarter speed and restores existing identities', () => {
        const structure = [...bridge.deck, ...bridge.cablePoints];
        const initial = structure.map(body => ({ body, pose: body.pose }));
        const before = world.getDiagnostics();
        const load = bridge.addLoad();
        if (!load) throw new Error('The bridge must accept its first cargo body');
        advance(2);
        world.paused = true;
        const steps = world.getDiagnostics().simulatedSteps;
        const paused = structure.map(body => body.pose);
        const pausedLoad = load.pose;
        advance(1);
        expect(world.getDiagnostics().simulatedSteps).toBe(steps);
        expect(structure.map(body => body.pose)).toEqual(paused);
        expect(load.pose).toEqual(pausedLoad);
        world.paused = false;
        world.timeScale = 0.25;
        advance(0.8);
        expect(world.getDiagnostics().simulatedSteps - steps).toBe(24);

        bridge.reset();
        expect(load.valid).toBe(false);
        expect(bridge.metrics().loads).toBe(0);
        expect(Math.abs(bridge.metrics().deflection)).toBeLessThan(0.00001);
        for (const { body, pose } of initial) {
            expect(body.valid).toBe(true);
            expect(body.pose.position.x).toBeCloseTo(pose.position.x, 5);
            expect(body.pose.position.y).toBeCloseTo(pose.position.y, 5);
            expect(body.pose.position.z).toBeCloseTo(pose.position.z, 5);
            expect(body.linearVelocity).toEqual({ x: 0, y: 0, z: 0 });
            expect(body.angularVelocity).toEqual({ x: 0, y: 0, z: 0 });
        }
        expect(world.getDiagnostics().bodyCount).toBe(before.bodyCount);
        expect(world.getDiagnostics().colliderCount).toBe(before.colliderCount);
        expect(world.getDiagnostics().jointCount).toBe(before.jointCount);
        expect(world.getDiagnostics().droppedTimeSeconds).toBe(0);
    });
});
