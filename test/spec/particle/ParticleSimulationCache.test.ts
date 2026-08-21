import { describe, expect, it } from 'vitest';
import { ParticleParameter, ParticleParameterSet } from '../../../src/particle/ParticleParameter';
import {
    PARTICLE_SIMULATION_CACHE_VERSION,
    type ParticleSimulationCache
} from '../../../src/particle/ParticleSimulationCache';
import ParticleSystem from '../../../src/particle/ParticleSystem';
import ParticleSystemDefinition from '../../../src/particle/ParticleSystemDefinition';

function cpuDefinition(): ParticleSystemDefinition {
    return ParticleSystemDefinition.create({
        emitters: [
            {
                name: 'cpu-cache',
                capacity: 64,
                execution: 'cpu',
                duration: 4,
                looping: true,
                fixedStep: 1 / 60,
                eventCapacity: 64,
                emission: { rateOverTime: 7, bursts: [{ time: 0, count: 2 }] },
                initialize: {
                    lifetime: { min: 0.4, max: 1.2 },
                    direction: [0, 1, 0],
                    speed: { min: 0.5, max: 2 }
                },
                modules: [
                    { type: 'gravity', force: [0, -2, 0] },
                    { type: 'drag', coefficient: 0.15 }
                ],
                renderers: [{ type: 'sprite' }]
            }
        ]
    });
}

describe('ParticleSimulationCache', () => {
    it('replays CPU scheduler, dense state, queued commands, and application events exactly', async () => {
        const definition = cpuDefinition();
        const parameters = new ParticleParameterSet();
        const system = new ParticleSystem({
            definition,
            parameters,
            seed: 0x1234,
            autoPlay: false,
            eventReadbackCapacity: 128
        });
        system.simulate(0.025).emit({ count: 3, position: [2, 3, 4], velocity: [1, 0, -1] });
        const cache = system.captureSimulation();

        const typedCache: ParticleSimulationCache = cache;
        expect(typedCache).toBe(cache);
        expect(cache.version).toBe(PARTICLE_SIMULATION_CACHE_VERSION);
        expect(cache.definitionHash).toBe(definition.hash);
        expect(cache.compiledPlanHash).toBe(system.compiledPlan.hash);
        expect(cache.seed).toBe(0x1234);
        expect(cache.parameterRevision).toBe(0);
        expect(cache.emitterCount).toBe(1);
        expect(cache.storageByteLength).toBeGreaterThan(0);
        expect(Object.isFrozen(cache)).toBe(true);

        system.timeScale = 2;
        system.play();
        system.simulate(0.7);
        const expectedHash = system.stateHash();
        const expectedAlive = system.aliveCount;
        const expectedEvents = await system.readEvents();

        system.restoreSimulation(cache);
        expect(system.playing).toBe(false);
        expect(system.timeScale).toBe(1);
        system.simulate(0.7);
        expect(system.stateHash()).toBe(expectedHash);
        expect(system.aliveCount).toBe(expectedAlive);
        expect(await system.readEvents()).toEqual(expectedEvents);

        system.restoreSimulation(cache).simulate(0.7);
        expect(system.stateHash()).toBe(expectedHash);
    });

    it('restores a compatible second CPU system sharing deterministic inputs', () => {
        const definition = cpuDefinition();
        const parameters = new ParticleParameterSet();
        const source = new ParticleSystem({
            definition,
            parameters,
            seed: 9,
            autoPlay: false
        });
        source.simulate(0.5);
        const cache = source.captureSimulation();
        source.simulate(0.25);
        const expected = source.stateHash();

        const target = new ParticleSystem({
            definition,
            parameters,
            seed: 9,
            autoPlay: false
        });
        target.restoreSimulation(cache).simulate(0.25);
        expect(target.stateHash()).toBe(expected);
    });

    it('reconstructs stateless CPU manual batches and pending commands', () => {
        const definition = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'stateless-cache',
                    capacity: 64,
                    execution: 'stateless',
                    duration: 5,
                    looping: true,
                    emission: { rateOverTime: 5 },
                    initialize: { lifetime: 2, direction: [1, 0, 0], speed: 0.5 },
                    renderers: [{ type: 'sprite' }]
                }
            ]
        });
        const system = new ParticleSystem({ definition, seed: 7, autoPlay: false });
        system.emit({ count: 2, position: [1, 2, 3] }).simulate(0.4);
        system.emit({ count: 3, velocity: [0, 1, 0] });
        const cache = system.captureSimulation();
        system.simulate(0.6);
        const expectedHash = system.stateHash();
        const expectedAlive = system.aliveCount;

        system.restoreSimulation(cache).simulate(0.6);
        expect(system.stateHash()).toBe(expectedHash);
        expect(system.aliveCount).toBe(expectedAlive);
        expect(cache.storageByteLength).toBe(0);
    });

    it('restores stateless GPU absolute time after a temporary CPU materialization', () => {
        const definition = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'gpu-stateless-cache',
                    capacity: 64,
                    execution: 'stateless',
                    duration: 8,
                    looping: true,
                    emission: { rateOverTime: 4 },
                    initialize: { lifetime: 2 },
                    renderers: [{ type: 'sprite' }]
                }
            ]
        });
        const system = new ParticleSystem({
            definition,
            seed: 5,
            compilationEnvironment: { backend: 'webgpu' }
        });
        system.update(1000);
        const cache = system.captureSimulation();
        expect(cache.elapsedSeconds).toBe(1);
        expect(system.stateHash()).toBe('gpu-stateless');

        system.emit(2).simulate(0.25);
        expect(system.stateHash()).not.toBe('gpu-stateless');
        system.restoreSimulation(cache);
        expect(system.elapsedSeconds).toBe(1);
        expect(system.stateHash()).toBe('gpu-stateless');
        system.update(1000);
        expect(system.elapsedSeconds).toBe(2);
    });

    it('fails closed for stale parameters and incompatible deterministic inputs', () => {
        const rate = new ParticleParameter('cache.rate', 'float', 2);
        const definition = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'parameter-cache',
                    capacity: 16,
                    execution: 'cpu',
                    emission: { rateOverTime: rate },
                    renderers: [{ type: 'sprite' }]
                }
            ]
        });
        const parameters = new ParticleParameterSet();
        const source = new ParticleSystem({
            definition,
            parameters,
            seed: 3,
            autoPlay: false
        });
        const cache = source.captureSimulation();

        parameters.set(rate, 4);
        expect(() => source.restoreSimulation(cache)).toThrow(/parameter revision is stale/u);
        const differentParameters = new ParticleSystem({
            definition,
            parameters: new ParticleParameterSet(),
            seed: 3,
            autoPlay: false
        });
        expect(() => differentParameters.restoreSimulation(cache)).toThrow(
            /same parameter-set identity/u
        );
        const differentSeed = new ParticleSystem({
            definition,
            parameters,
            seed: 4,
            autoPlay: false
        });
        expect(() => differentSeed.restoreSimulation(cache)).toThrow(/seed is incompatible/u);
        const sameDataDifferentIdentity = new ParticleSystem({
            definition: ParticleSystemDefinition.create({
                emitters: [
                    {
                        name: 'parameter-cache',
                        capacity: 16,
                        execution: 'cpu',
                        emission: { rateOverTime: rate },
                        renderers: [{ type: 'sprite' }]
                    }
                ]
            }),
            parameters,
            seed: 3,
            autoPlay: false
        });
        expect(() => sameDataDifferentIdentity.restoreSimulation(cache)).toThrow(
            /same immutable definition identity/u
        );
    });

    it('rejects stateful GPU capture instead of performing production-loop readback', () => {
        const system = new ParticleSystem({
            definition: ParticleSystemDefinition.create({
                emitters: [
                    {
                        name: 'gpu-stateful-cache',
                        capacity: 64,
                        execution: 'gpu',
                        renderers: [{ type: 'sprite' }]
                    }
                ]
            }),
            compilationEnvironment: { backend: 'webgpu' },
            autoPlay: false
        });
        expect(() => system.captureSimulation()).toThrow(
            /does not support stateful GPU emitter gpu-stateful-cache/u
        );
    });
});
