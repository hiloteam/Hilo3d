import { beforeAll, describe, expect, it } from 'vitest';
import { ParticleBudgetManager } from '../../../src/particle/ParticleBudget';
import { compileParticleSystemDefinition } from '../../../src/particle/ParticleCompiler';
import ParticleSystem from '../../../src/particle/ParticleSystem';
import ParticleSystemDefinition from '../../../src/particle/ParticleSystemDefinition';
import { ParticleSystemPool } from '../../../src/particle/ParticleSystemPool';
import { compileParticleStatelessGPUPlan } from '../../../src/particle/stateless/ParticleStatelessGPUPlan';
import { WgslComputeShaderCompiler } from '../../../src/render/shader/WgslComputeCompiler';

function statelessDefinition(): ParticleSystemDefinition {
    return ParticleSystemDefinition.create({
        emitters: [
            {
                name: 'stateless-main',
                capacity: 128,
                execution: 'stateless',
                duration: 2,
                looping: false,
                emission: { rateOverTime: 60, bursts: [{ time: 0, count: 2 }] },
                shape: { type: 'sphere', radius: 0.25, distribution: 'volume' },
                initialize: {
                    lifetime: 1,
                    direction: [0, 1, 0],
                    speed: 1,
                    size: 0.1
                },
                modules: [
                    { type: 'gravity', force: [0, -0.5, 0] },
                    { type: 'drag', coefficient: 0.1 },
                    {
                        type: 'noise',
                        mode: 'position-offset',
                        field: 'vector',
                        strength: [0.1, 0.1, 0.1],
                        frequency: 0.5,
                        octaves: 2
                    },
                    { type: 'vortex-force', strength: 0.1 }
                ],
                renderers: [{ type: 'sprite', sort: 'distance' }]
            }
        ]
    });
}

describe('ParticleSystem P3 stateless execution', () => {
    const compiler = new WgslComputeShaderCompiler();

    beforeAll(async () => {
        await compiler.initialize();
    });

    it('classifies modules, reconstructs deterministic particles, and retains no simulation state', () => {
        const definition = statelessDefinition();
        const compiled = compileParticleSystemDefinition(definition, { backend: 'webgpu' });
        const emitter = compiled.emitters[0];
        if (!emitter) throw new Error('Stateless emitter failed to compile');
        expect(emitter.kind).toBe('stateless');
        expect(emitter.persistentStateByteLength).toBe(0);
        expect(emitter.statelessModules.map(metadata => metadata.support)).toEqual([
            'exact',
            'exact',
            'exact',
            'approximated'
        ]);

        const first = new ParticleSystem({ definition, seed: 7, autoPlay: false });
        const second = new ParticleSystem({ definition, seed: 7, autoPlay: false });
        first.simulate(0.25);
        second.simulate(0.1).simulate(0.15);
        expect(first.aliveCount).toBeGreaterThan(0);
        expect(first.aliveCount).toBe(second.aliveCount);
        expect(first.stateHash()).toBe(second.stateHash());
    });

    it('rejects stateful feedback with asset-level module reasons', () => {
        const definition = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'invalid-stateless',
                    capacity: 16,
                    execution: 'stateless',
                    modules: [
                        {
                            type: 'noise',
                            mode: 'force',
                            field: 'curl',
                            strength: [1, 1, 1],
                            frequency: 1,
                            octaves: 1
                        }
                    ],
                    renderers: [{ type: 'sprite' }]
                }
            ]
        });
        expect(() => compileParticleSystemDefinition(definition)).toThrow(
            /noise: force noise feeds velocity back/u
        );
    });

    it('auto-selects stateless but preserves explicit CPU stateful execution', () => {
        const automatic = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'automatic',
                    capacity: 16,
                    renderers: [{ type: 'sprite' }]
                }
            ]
        });
        const cpu = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'cpu',
                    capacity: 16,
                    execution: 'cpu',
                    renderers: [{ type: 'sprite' }]
                }
            ]
        });
        expect(compileParticleSystemDefinition(automatic).emitters[0]?.kind).toBe('stateless');
        expect(compileParticleSystemDefinition(cpu).emitters[0]?.kind).toBe('cpu-stateful');
    });

    it('builds a Naga-valid WebGPU generator with renderer data but zero state bytes', () => {
        const emitter = compileParticleSystemDefinition(statelessDefinition(), {
            backend: 'webgpu'
        }).emitters[0];
        if (!emitter) throw new Error('Stateless emitter failed to compile');
        const gpu = compileParticleStatelessGPUPlan(emitter);
        expect(gpu.buffers.persistentStateByteLength).toBe(0);
        expect(gpu.recoveryPolicy).toBe('regenerate');
        expect(() => compiler.compile(gpu.generate)).not.toThrow();
    });
});

describe('ParticleSystem P3 scalability', () => {
    it('resolves deterministic priority, distance, instance and quality degradation', () => {
        const manager = new ParticleBudgetManager({
            maxSystems: 1,
            maxEmitters: 2,
            maxParticles: 50,
            maxDistance: 20,
            sorting: false,
            spawnRateScale: 0.5
        });
        const requests = [
            {
                systemId: 'low',
                emitterId: 2,
                capacity: 40,
                estimatedAlive: 40,
                priority: 0,
                distance: 5
            },
            {
                systemId: 'high',
                emitterId: 1,
                capacity: 40,
                estimatedAlive: 40,
                priority: 10,
                distance: 2
            },
            {
                systemId: 'far',
                emitterId: 3,
                capacity: 10,
                estimatedAlive: 10,
                priority: 20,
                distance: 100
            }
        ] as const;
        const first = manager.resolve(requests);
        const repeated = [...manager.resolve([...requests].reverse())].reverse();
        expect(first).toEqual(repeated);
        expect(first[1]).toMatchObject({
            enabled: true,
            particleLimit: 40,
            spawnRateScale: 0.5,
            sorting: false
        });
        expect(first[0]?.reasons).toContain('system-budget');
        expect(first[2]?.reasons).toContain('distance');
    });

    it('reuses stopped short-lived systems by immutable definition and seed', () => {
        const definition = statelessDefinition();
        const pool = new ParticleSystemPool(2);
        const first = pool.acquire({ definition, seed: 11, autoPlay: false });
        pool.release(first);
        const reused = pool.acquire({ definition, seed: 11, autoPlay: false });
        expect(reused).toBe(first);
        expect(pool.activeCount).toBe(1);
        expect(pool.pooledCount).toBe(0);
    });
});
