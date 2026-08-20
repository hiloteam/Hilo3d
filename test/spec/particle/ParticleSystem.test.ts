import { describe, expect, it } from 'vitest';
import Mesh from '../../../src/core/Mesh';
import ParticleCurve from '../../../src/particle/ParticleCurve';
import ParticleGradient from '../../../src/particle/ParticleGradient';
import { ParticleParameter, ParticleParameterSet } from '../../../src/particle/ParticleParameter';
import ParticleSystem from '../../../src/particle/ParticleSystem';
import ParticleSystemDefinition from '../../../src/particle/ParticleSystemDefinition';
import { compileParticleSystemDefinition } from '../../../src/particle/ParticleCompiler';

function definition(): ParticleSystemDefinition {
    return ParticleSystemDefinition.create({
        emitters: [
            {
                name: 'main',
                capacity: 32,
                execution: 'cpu',
                duration: 2,
                looping: false,
                fixedStep: 1 / 60,
                emission: { rateOverTime: 6, bursts: [{ time: 0, count: 2 }] },
                shape: { type: 'sphere', radius: 1, distribution: 'volume' },
                initialize: {
                    lifetime: 1,
                    direction: [0, 1, 0],
                    speed: { min: 1, max: 2 },
                    size: 0.25,
                    color: [1, 0.5, 0.25, 1]
                },
                modules: [
                    { type: 'gravity', force: [0, -1, 0] },
                    { type: 'drag', coefficient: 0.1 },
                    {
                        type: 'size-over-lifetime',
                        curve: new ParticleCurve([
                            { time: 0, value: 1 },
                            { time: 1, value: 0 }
                        ])
                    },
                    {
                        type: 'color-over-lifetime',
                        gradient: new ParticleGradient([
                            { time: 0, color: [1, 1, 1, 1] },
                            { time: 1, color: [1, 0, 0, 0] }
                        ])
                    }
                ],
                renderers: [{ type: 'sprite', sort: 'distance' }]
            }
        ]
    });
}

describe('ParticleSystem P0/P1 contracts', () => {
    it('accepts particle-only construction parameters without invoking subclass setters early', () => {
        const system = new ParticleSystem({
            definition: definition(),
            autoPlay: false,
            timeScale: 0.5
        });
        expect(system.timeScale).toBe(0.5);
        expect(system.playing).toBe(false);
    });

    it('resolves live typed spawn parameters without recompiling the immutable plan', () => {
        const rate = new ParticleParameter('spawn.rate', 'float', 2);
        const size = new ParticleParameter('spawn.size', 'float', 0.25);
        const values = new ParticleParameterSet();
        const parameterized = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'parameterized',
                    capacity: 16,
                    execution: 'cpu',
                    duration: 10,
                    fixedStep: 0.5,
                    emission: { rateOverTime: rate },
                    initialize: { lifetime: 10, size },
                    bounds: { mode: 'manual', min: [-2, -2, -2], max: [2, 2, 2] },
                    renderers: [{ type: 'sprite' }]
                }
            ]
        });
        const system = new ParticleSystem({
            definition: parameterized,
            parameters: values,
            autoPlay: false
        });
        const plan = system.compiledPlan;
        system.simulate(0.5);
        expect(system.aliveCount).toBe(1);
        values.set(rate, 6).set(size, 0.5);
        system.simulate(0.5);
        expect(system.aliveCount).toBe(4);
        expect(system.compiledPlan).toBe(plan);
        expect(values.revision).toBe(2);
        values.set(rate, 6);
        expect(values.revision).toBe(2);

        const differentDefault = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'parameterized',
                    capacity: 16,
                    execution: 'cpu',
                    duration: 10,
                    fixedStep: 0.5,
                    emission: {
                        rateOverTime: new ParticleParameter('spawn.rate', 'float', 3)
                    },
                    initialize: { lifetime: 10, size },
                    bounds: { mode: 'manual', min: [-2, -2, -2], max: [2, 2, 2] },
                    renderers: [{ type: 'sprite' }]
                }
            ]
        });
        expect(differentDefault.hash).not.toBe(parameterized.hash);
    });

    it('accepts a full 2π authoring arc after the immutable float32 snapshot', () => {
        const fullArc = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'full-arc',
                    capacity: 8,
                    shape: { type: 'torus', radius: 1, tubeRadius: 0.2, arc: Math.PI * 2 },
                    renderers: [{ type: 'sprite' }]
                }
            ]
        });

        expect(() => compileParticleSystemDefinition(fullArc)).not.toThrow();
    });

    it('snapshots definitions, bakes liveness layouts, and rejects GPU on WebGL2', () => {
        const inputModules: { readonly type: 'drag'; readonly coefficient: number }[] = [
            { type: 'drag', coefficient: 0.25 }
        ];
        const snapshot = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'snapshot',
                    capacity: 8,
                    modules: inputModules,
                    renderers: [{ type: 'sprite' }]
                }
            ]
        });
        const hash = snapshot.hash;
        inputModules.push({ type: 'drag', coefficient: 1 });
        expect(snapshot.emitters[0]?.modules).toHaveLength(1);
        expect(snapshot.hash).toBe(hash);

        const compiled = compileParticleSystemDefinition(snapshot);
        expect(compiled.emitters[0]?.attributes.map(attribute => attribute.name)).toContain(
            'position'
        );
        expect(
            compiled.emitters[0]?.attributes.every(attribute => attribute.byteOffset % 16 === 0)
        ).toBe(true);

        const gpu = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'gpu',
                    capacity: 8,
                    execution: 'gpu',
                    renderers: [{ type: 'sprite' }]
                }
            ]
        });
        expect(() => compileParticleSystemDefinition(gpu, { backend: 'webgl2' })).toThrow(
            /explicitly requires WebGPU/u
        );

        const stateless = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'future-stateless',
                    capacity: 8,
                    execution: 'stateless',
                    renderers: [{ type: 'sprite' }]
                }
            ]
        });
        const compiledStateless = compileParticleSystemDefinition(stateless);
        expect(compiledStateless.emitters[0]).toMatchObject({
            kind: 'stateless',
            statelessEligible: true,
            persistentStateByteLength: 0
        });
    });

    it('reproduces fixed-step state and renders a dense range with one instanced Mesh', () => {
        const first = new ParticleSystem({
            definition: definition(),
            seed: 42,
            autoPlay: false
        });
        const second = new ParticleSystem({
            definition: definition(),
            seed: 42,
            autoPlay: false
        });
        first
            .emit(3)
            .simulate(1 / 60)
            .simulate(1 / 60);
        second.emit(3).simulate(2 / 60);

        expect(first.stateHash()).toBe(second.stateHash());
        expect(first.aliveCount).toBeGreaterThan(0);
        expect(first.children).toHaveLength(1);
        const mesh = first.children[0];
        expect(mesh).toBeInstanceOf(Mesh);
        expect((mesh as Mesh).instanceCount).toBe(first.aliveCount);
        expect((mesh as Mesh).visible).toBe(true);
        expect((mesh as Mesh).useInstanced).toBe(false);
    });

    it('keeps CPU sprite stretch relative and screen-size constraints in pixel space', () => {
        const system = new ParticleSystem({
            definition: ParticleSystemDefinition.create({
                emitters: [
                    {
                        name: 'sprite-sizing',
                        capacity: 8,
                        execution: 'cpu',
                        initialize: { size: 0.03 },
                        modules: [{ type: 'screen-space-size', scale: 1.5, range: [2, 24] }],
                        renderers: [{ type: 'sprite', alignment: 'stretched', stretchScale: 2 }]
                    }
                ]
            }),
            autoPlay: false
        });
        const mesh = system.children[0];
        expect(mesh).toBeInstanceOf(Mesh);
        const shader = (mesh as Mesh).material?.definition.getPass('forward')?.shader;
        expect(shader?.kind).toBe('glsl');
        if (shader?.kind !== 'glsl') throw new Error('Expected a GLSL CPU sprite shader');
        expect(shader.vertexSource).toContain(
            'corner.y *= 1.0 + length(a_particleVelocity) * 2.0;'
        );
        expect(shader.vertexSource).toContain(
            'particlePixelSize = clamp(particleSize * particleWorldToPixels * 1.5, 2.0, 24.0)'
        );
        expect(shader.vertexSource).toContain(
            'particleSize = particlePixelSize / particleWorldToPixels;'
        );
        expect(shader.vertexSource).not.toContain('length(a_particleVelocity) / particleSize');
    });

    it('initializes new CPU particles after the current simulation step', () => {
        const system = new ParticleSystem({
            definition: ParticleSystemDefinition.create({
                emitters: [
                    {
                        name: 'spawn-order',
                        capacity: 2,
                        execution: 'cpu',
                        fixedStep: 0.1,
                        initialize: { lifetime: 0.05 },
                        emission: { bursts: [{ time: 0, count: 1 }] },
                        renderers: [{ type: 'sprite' }]
                    }
                ]
            }),
            autoPlay: false
        });
        system.simulate(0.1);
        expect(system.aliveCount).toBe(1);
        system.simulate(0.1);
        expect(system.aliveCount).toBe(0);
    });

    it('rejects unsupported execution semantics and malformed authoring data', () => {
        const gpuTrigger = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'gpu-trigger',
                    capacity: 2,
                    execution: 'gpu',
                    modules: [{ type: 'trigger', volumes: [{ type: 'sphere', radius: 1 }] }],
                    renderers: [{ type: 'sprite' }]
                }
            ]
        });
        expect(() => compileParticleSystemDefinition(gpuTrigger, { backend: 'webgpu' })).toThrow(
            /trigger modules require CPU/u
        );

        const automaticTrigger = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'automatic-trigger',
                    capacity: 2,
                    modules: [{ type: 'trigger', volumes: [{ type: 'sphere', radius: 1 }] }],
                    renderers: [{ type: 'sprite' }]
                }
            ]
        });
        expect(
            compileParticleSystemDefinition(automaticTrigger, {
                backend: 'webgpu',
                preferGPUAboveCapacity: 1
            }).emitters[0]?.kind
        ).toBe('cpu-stateful');

        const gpuOverflow = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'gpu-overflow',
                    capacity: 2,
                    execution: 'gpu',
                    overflow: 'replace-oldest',
                    renderers: [{ type: 'sprite' }]
                }
            ]
        });
        expect(() => compileParticleSystemDefinition(gpuOverflow, { backend: 'webgpu' })).toThrow(
            /does not support replace-oldest/u
        );

        const invalidBurst = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'invalid-burst',
                    capacity: 2,
                    emission: { bursts: [{ time: 0, count: 1, cycles: 2, interval: 0 }] },
                    renderers: [{ type: 'sprite' }]
                }
            ]
        });
        expect(() => compileParticleSystemDefinition(invalidBurst)).toThrow(
            /interval must be positive/u
        );

        const invalidVectorRange = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'invalid-vector-range',
                    capacity: 2,
                    initialize: { position: { min: [1, 0, 0], max: [0, 1, 1] } },
                    renderers: [{ type: 'sprite' }]
                }
            ]
        });
        expect(() => compileParticleSystemDefinition(invalidVectorRange)).toThrow(
            /component-wise/u
        );

        const duplicateChannel = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'duplicate-channel',
                    capacity: 2,
                    modules: [
                        { type: 'custom-channel', name: 'data', valueType: 'float', value: 1 },
                        { type: 'custom-channel', name: 'data', valueType: 'float', value: 2 }
                    ],
                    renderers: [{ type: 'sprite' }]
                }
            ]
        });
        expect(() => compileParticleSystemDefinition(duplicateChannel)).toThrow(
            /duplicate custom channel/u
        );
    });

    it('supports play, pause, restart, manual emit and completion without exposing particles[]', () => {
        const system = new ParticleSystem({
            definition: definition(),
            seed: 7,
            autoPlay: false
        });
        expect(system.playing).toBe(false);
        system.play().update(1000 / 60);
        const hash = system.stateHash();
        system.pause().update(1000);
        expect(system.stateHash()).toBe(hash);
        system.restart();
        expect(system.playing).toBe(true);
        expect(system.elapsedSeconds).toBe(0);
        system.emit({ emitter: 'main', count: 1, position: [2, 3, 4] }).simulate(1 / 60);
        expect(system.aliveCount).toBeGreaterThan(0);
        expect(Reflect.has(system, 'particles')).toBe(false);
    });
});
