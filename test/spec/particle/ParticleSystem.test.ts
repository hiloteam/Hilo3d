import { describe, expect, it } from 'vitest';
import Mesh from '../../../src/core/Mesh';
import ParticleCurve from '../../../src/particle/ParticleCurve';
import ParticleGradient from '../../../src/particle/ParticleGradient';
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
