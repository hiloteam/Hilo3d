import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Node from '../../../src/core/Node';
import { ParticleBudgetManager } from '../../../src/particle/ParticleBudget';
import { compileParticleSystemDefinition } from '../../../src/particle/ParticleCompiler';
import ParticleSystem from '../../../src/particle/ParticleSystem';
import ParticleSystemDefinition from '../../../src/particle/ParticleSystemDefinition';
import { ParticleSystemPool } from '../../../src/particle/ParticleSystemPool';
import { ParticleStatelessRuntime } from '../../../src/particle/stateless/ParticleStatelessRuntime';
import { compileParticleStatelessGPUPlan } from '../../../src/particle/stateless/ParticleStatelessGPUPlan';
import Renderer from '../../../src/render/Renderer';
import { WgslComputeShaderCompiler } from '../../../src/render/shader/WgslComputeCompiler';

declare const __HILO3D_GITHUB_ACTIONS_COVERAGE__: boolean;

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

    it('keeps the supported WebGPU stateless path GPU-only until manual emission', () => {
        const definition = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'lazy-gpu-stateless',
                    capacity: 64,
                    execution: 'stateless',
                    duration: 4,
                    emission: { rateOverTime: 12 },
                    initialize: { lifetime: 2, direction: [0, 1, 0], speed: 0.5, size: 0.2 },
                    modules: [{ type: 'gravity', force: [0, -0.25, 0] }],
                    renderers: [{ type: 'sprite', depthTest: false }]
                }
            ]
        });
        const system = new ParticleSystem({
            definition,
            seed: 5,
            autoPlay: false,
            compilationEnvironment: { backend: 'webgpu' }
        });

        system.simulate(0.5);
        expect(system.hasGPUEmitters).toBe(true);
        expect(system.children).toHaveLength(0);
        expect(system.aliveCount).toBe(0);
        expect(system.stateHash()).toBe('gpu-stateless');

        system.emit(1).simulate(0);
        expect(system.hasGPUEmitters).toBe(false);
        expect(system.children).toHaveLength(1);
        expect(system.aliveCount).toBeGreaterThan(0);

        system.stop();
        expect(system.hasGPUEmitters).toBe(true);
        expect(system.children[0]?.visible).toBe(false);
    });

    it('keeps burst stable IDs invariant while continuous emission advances', () => {
        const definition = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'stable-burst',
                    capacity: 16,
                    execution: 'stateless',
                    duration: 10,
                    looping: false,
                    emission: { rateOverTime: 10, bursts: [{ time: 0, count: 1 }] },
                    initialize: { lifetime: 5 },
                    renderers: [{ type: 'sprite' }]
                }
            ]
        });
        const plan = compileParticleSystemDefinition(definition).emitters[0];
        if (!plan) throw new Error('Expected a stateless plan');
        const runtime = new ParticleStatelessRuntime(plan, 1);
        runtime.simulate(0.1, { position: [0, 0, 0] });
        const firstBurstId = runtime.state.u32('stable-id')[1];
        runtime.simulate(0.1, { position: [0, 0, 0] });
        expect(runtime.state.u32('stable-id')[2]).toBe(firstBurstId);
    });

    it('builds a Naga-valid no-state WebGPU renderer-data generator', () => {
        const definition = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'gpu-stateless',
                    capacity: 64,
                    execution: 'stateless',
                    emission: { rateOverTime: 12 },
                    initialize: {
                        lifetime: 2,
                        direction: [0, 1, 0],
                        speed: 0.5,
                        size: 0.2,
                        color: [1, 0.5, 0.25, 1]
                    },
                    modules: [
                        { type: 'gravity', force: [0, -0.25, 0] },
                        { type: 'drag', coefficient: 0.1 }
                    ],
                    renderers: [{ type: 'sprite', depthTest: false }]
                }
            ]
        });
        const emitter = compileParticleSystemDefinition(definition, { backend: 'webgpu' })
            .emitters[0];
        if (!emitter) throw new Error('Stateless emitter failed to compile');
        const gpu = compileParticleStatelessGPUPlan(emitter);
        expect(gpu.buffers.persistentStateByteLength).toBe(0);
        expect(gpu.recoveryPolicy).toBe('regenerate');
        expect(() => compiler.compile(gpu.generate)).not.toThrow();
    });
});

describe('ParticleSystem P3 scalability', () => {
    it('applies deterministic decisions to live particle runtimes', () => {
        const definition = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'budgeted',
                    capacity: 16,
                    execution: 'cpu',
                    duration: 10,
                    fixedStep: 1,
                    emission: { rateOverTime: 16 },
                    initialize: { lifetime: 10 },
                    renderers: [{ type: 'sprite', sort: 'distance' }]
                }
            ]
        });
        const system = new ParticleSystem({
            definition,
            budgetId: 'budgeted-system',
            autoPlay: false
        });
        system.simulate(1);
        expect(system.aliveCount).toBe(16);
        const manager = new ParticleBudgetManager({
            maxParticles: 3,
            spawnRateScale: 0,
            sorting: false,
            collision: false,
            ribbons: false,
            softParticles: false
        });
        const decisions = manager.apply([system]);
        expect(decisions[0]).toMatchObject({
            enabled: true,
            particleLimit: 3,
            spawnRateScale: 0,
            sorting: false,
            collision: false,
            ribbons: false,
            softParticles: false
        });
        expect(system.aliveCount).toBe(3);
        system.simulate(1);
        expect(system.aliveCount).toBe(3);
    });

    it('reuses stopped short-lived systems by immutable definition and seed', () => {
        const definition = statelessDefinition();
        const pool = new ParticleSystemPool(2);
        const first = pool.acquire({ definition, seed: 11, autoPlay: false });
        first.simulate(0.2);
        new ParticleBudgetManager({ maxParticles: 0 }).apply([first]);
        expect(first.aliveCount).toBe(0);
        first.name = 'mutated';
        first.x = 12;
        first.visible = false;
        pool.release(first);
        const reused = pool.acquire({ definition, seed: 11, autoPlay: false });
        expect(reused).toBe(first);
        expect(reused.playing).toBe(false);
        expect(reused.name).toBe('');
        expect(reused.x).toBe(0);
        expect(reused.visible).toBe(true);
        reused.simulate(0.2);
        expect(reused.aliveCount).toBeGreaterThan(0);
        expect(pool.activeCount).toBe(1);
        expect(pool.pooledCount).toBe(0);
    });

    it('does not reuse mismatched configurations and keeps failed releases active', () => {
        const definition = statelessDefinition();
        const pool = new ParticleSystemPool(1);
        const first = pool.acquire({ definition, seed: 11, autoPlay: false, name: 'first' });
        pool.release(first);
        const second = pool.acquire({ definition, seed: 11, autoPlay: false, name: 'second' });
        expect(second).not.toBe(first);
        expect(second.name).toBe('second');

        const full = new ParticleSystemPool(0);
        const active = full.acquire({ definition, autoPlay: false });
        expect(() => {
            full.release(active);
        }).toThrow(/renderer is required/u);
        expect(full.activeCount).toBe(1);
    });
});

describe('ParticleSystem P3 stateless WebGPU Render Graph integration', () => {
    const renderers: Renderer[] = [];

    afterEach(() => {
        for (const renderer of renderers.splice(0)) renderer.destroy();
    });

    it.skipIf(__HILO3D_GITHUB_ACTIONS_COVERAGE__)(
        'generates indirect renderer data and regenerates it after device recovery',
        async () => {
            const renderer = await Renderer.create({
                backend: 'webgpu',
                domElement: document.createElement('canvas'),
                width: 16,
                height: 16,
                antialias: false
            });
            renderers.push(renderer);
            const system = new ParticleSystem({
                definition: ParticleSystemDefinition.create({
                    emitters: [
                        {
                            name: 'stateless-graph',
                            capacity: 64,
                            execution: 'stateless',
                            duration: 4,
                            emission: { rateOverTime: 12 },
                            initialize: {
                                lifetime: 2,
                                direction: [0, 1, 0],
                                speed: 0.5,
                                size: 0.2
                            },
                            modules: [{ type: 'gravity', force: [0, -0.25, 0] }],
                            renderers: [{ type: 'sprite', depthTest: false }]
                        }
                    ]
                }),
                seed: 5,
                autoPlay: false,
                compilationEnvironment: { backend: 'webgpu' }
            });
            const scene = new Node();
            scene.addChild(system);
            const camera = new PerspectiveCamera({ aspect: 1, near: 0.1, far: 20 });
            camera.z = 5;
            system.simulate(0.5);
            expect(system.hasGPUEmitters).toBe(true);
            expect(system.children).toHaveLength(0);
            scene.updateMatrixWorld(true);
            expect(system.isGPUVisible(camera)).toBe(true);

            renderer.render(scene, camera);
            await renderer.waitForIdle();
            renderer.render(scene, camera);
            await renderer.waitForIdle();
            expect(renderer.renderInfo.drawCount).toBeGreaterThan(0);

            const rhi = renderer.getExtension('rhi') as {
                readonly device: { destroy(): void };
            } | null;
            if (rhi === null) throw new Error('Stateless recovery requires the RHI extension');
            const restored = new Promise<void>(resolve => {
                renderer.on(
                    'webgpuDeviceRestored',
                    () => {
                        resolve();
                    },
                    true
                );
            });
            rhi.device.destroy();
            await Promise.all([renderer.waitForIdle(), restored]);
            system.simulate(0.25);
            renderer.render(scene, camera);
            await renderer.waitForIdle();
            renderer.render(scene, camera);
            await renderer.waitForIdle();
            expect(renderer.renderInfo.drawCount).toBeGreaterThan(0);
            system.destroy(renderer);
        }
    );
});
