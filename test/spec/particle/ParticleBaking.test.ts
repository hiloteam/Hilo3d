import { describe, expect, it } from 'vitest';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import {
    PARTICLE_BAKE_VERSION,
    type ParticleFlipbook
} from '../../../addon-particle/src/ParticleBaking';
import ParticleSystem from '../../../addon-particle/src/ParticleSystem';
import ParticleSystemDefinition from '../../../addon-particle/src/ParticleSystemDefinition';

function meshDefinition(): ParticleSystemDefinition {
    return ParticleSystemDefinition.create({
        emitters: [
            {
                name: 'mesh-cache',
                capacity: 32,
                execution: 'cpu',
                duration: 4,
                looping: true,
                fixedStep: 1 / 60,
                emission: { rateOverTime: 8, bursts: [{ time: 0, count: 2 }] },
                initialize: {
                    lifetime: 2,
                    direction: [1, 0, 0],
                    speed: { min: 0.5, max: 1.5 },
                    size: { min: 0.25, max: 0.75 },
                    rotation: { min: 0, max: 1 }
                },
                modules: [{ type: 'gravity', force: [0, -1, 0] }],
                renderers: [
                    {
                        type: 'mesh',
                        meshes: [{ geometry: new BoxGeometry() }],
                        orientation: 'velocity'
                    }
                ]
            }
        ]
    });
}

function spriteDefinition(): ParticleSystemDefinition {
    return ParticleSystemDefinition.create({
        emitters: [
            {
                name: 'flipbook',
                capacity: 16,
                execution: 'cpu',
                duration: 2,
                looping: true,
                fixedStep: 1 / 60,
                emission: { rateOverTime: 4 },
                initialize: { lifetime: 1 },
                renderers: [{ type: 'sprite' }]
            }
        ]
    });
}

describe('particle P6 baking', () => {
    it('bakes deterministic stable-ID-sorted mesh instance streams and restores pending state', () => {
        const definition = meshDefinition();
        const system = new ParticleSystem({ definition, seed: 17, autoPlay: false });
        const expected = new ParticleSystem({ definition, seed: 17, autoPlay: false });
        system.simulate(0.37).emit(3);
        expected.simulate(0.37).emit(3);

        const cache = system.bakeMeshCache({
            duration: 1,
            frameRate: 4,
            startTime: 0.25,
            includeEnd: true
        });

        expect(cache.version).toBe(PARTICLE_BAKE_VERSION);
        expect(cache.definitionHash).toBe(definition.hash);
        expect(cache.seed).toBe(17);
        expect(cache.frameCount).toBe(5);
        expect([...cache.frameTimes]).toEqual([0.25, 0.5, 0.75, 1, 1.25]);
        expect(cache.emitters).toHaveLength(1);
        const emitter = cache.emitters[0];
        expect(emitter).toBeDefined();
        if (emitter === undefined) throw new Error('Expected one baked mesh emitter');
        expect(emitter.frameOffsets).toHaveLength(cache.frameCount + 1);
        expect(emitter.positions).toHaveLength(emitter.stableIds.length * 3);
        expect(emitter.previousPositions).toHaveLength(emitter.stableIds.length * 3);
        expect(emitter.velocities).toHaveLength(emitter.stableIds.length * 3);
        expect(emitter.colors).toHaveLength(emitter.stableIds.length * 4);
        expect(emitter.sizes).toHaveLength(emitter.stableIds.length);
        expect(emitter.rotations).toHaveLength(emitter.stableIds.length);
        expect(emitter.meshIndices).toHaveLength(emitter.stableIds.length);
        expect(emitter.frameBounds).toHaveLength(cache.frameCount * 6);
        expect(cache.storageByteLength).toBeGreaterThan(0);
        for (let frameIndex = 0; frameIndex < cache.frameCount; frameIndex += 1) {
            const start = emitter.frameOffsets[frameIndex] ?? 0;
            const end = emitter.frameOffsets[frameIndex + 1] ?? 0;
            const ids = [...emitter.stableIds.subarray(start, end)];
            expect(ids).toEqual([...ids].sort((left, right) => left - right));
        }

        system.simulate(0.2);
        expected.simulate(0.2);
        expect(system.stateHash()).toBe(expected.stateHash());
        expect(system.aliveCount).toBe(expected.aliveCount);

        const repeated = system.bakeMeshCache({
            duration: 1,
            frameRate: 4,
            startTime: 0.25,
            includeEnd: true
        });
        expect(repeated.emitters[0]?.stableIds).toEqual(emitter.stableIds);
        expect(repeated.emitters[0]?.positions).toEqual(emitter.positions);
    });

    it('fails bounded mesh baking without losing the caller simulation branch', () => {
        const definition = meshDefinition();
        const system = new ParticleSystem({ definition, seed: 3, autoPlay: false });
        system.simulate(0.4);
        const before = system.stateHash();
        expect(() =>
            system.bakeMeshCache({
                duration: 1,
                frameRate: 30,
                maxSampledParticles: 1
            })
        ).toThrow(/sampled particle count exceeds 1/u);
        expect(system.stateHash()).toBe(before);
    });

    it('materializes stateless simulation into the same portable mesh-cache contract', () => {
        const definition = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'stateless-mesh-cache',
                    capacity: 24,
                    execution: 'stateless',
                    duration: 2,
                    looping: true,
                    emission: { rateOverTime: 6 },
                    initialize: { lifetime: 1, speed: 0.5, direction: [0, 1, 0] },
                    renderers: [{ type: 'mesh', meshes: [{ geometry: new BoxGeometry() }] }]
                }
            ]
        });
        const system = new ParticleSystem({ definition, seed: 11, autoPlay: false });
        const cache = system.bakeMeshCache({ duration: 0.5, frameRate: 4, includeEnd: true });
        expect(cache.frameCount).toBe(3);
        expect(cache.emitters[0]?.stableIds.length).toBeGreaterThan(0);
        expect(cache.emitters[0]?.positions.length).toBe(
            (cache.emitters[0]?.stableIds.length ?? 0) * 3
        );
    });

    it('packs copied real-readback frames into a near-square flipbook and restores state', async () => {
        const definition = spriteDefinition();
        const system = new ParticleSystem({ definition, seed: 4, autoPlay: false });
        system.simulate(0.35).emit(2);
        const before = system.captureSimulation();
        const reused = new Uint8Array(4);
        const times: number[] = [];

        const flipbook: ParticleFlipbook = await system.bakeFlipbook({
            duration: 1,
            frameRate: 3,
            captureFrame: context => {
                times.push(context.timeSeconds);
                reused.set([context.frameIndex + 1, 10, 20, 255]);
                return {
                    data: reused,
                    format: 'rgba8unorm',
                    width: 1,
                    height: 1,
                    bytesPerPixel: 4,
                    bytesPerRow: 4
                };
            }
        });

        expect(flipbook.version).toBe(PARTICLE_BAKE_VERSION);
        expect(flipbook.frameCount).toBe(3);
        expect(times).toEqual([0, 1 / 3, 2 / 3]);
        expect(flipbook).toMatchObject({
            frameWidth: 1,
            frameHeight: 1,
            columns: 2,
            rows: 2,
            width: 2,
            height: 2,
            format: 'rgba8unorm',
            bytesPerPixel: 4
        });
        expect([...flipbook.data]).toEqual([
            1, 10, 20, 255, 2, 10, 20, 255, 3, 10, 20, 255, 0, 0, 0, 0
        ]);
        expect([...flipbook.frameUVs]).toEqual([0, 0, 0.5, 0.5, 0.5, 0, 1, 0.5, 0, 0.5, 0.5, 1]);

        system.simulate(0.2);
        const branch = system.stateHash();
        system.restoreSimulation(before).simulate(0.2);
        expect(system.stateHash()).toBe(branch);
    });

    it('rejects inconsistent flipbook readbacks and restores after callback failure', async () => {
        const system = new ParticleSystem({
            definition: spriteDefinition(),
            seed: 8,
            autoPlay: false
        });
        system.simulate(0.3);
        const before = system.stateHash();
        await expect(
            system.bakeFlipbook({
                duration: 1,
                frameRate: 2,
                captureFrame: ({ frameIndex }) => ({
                    data: new Uint8Array(frameIndex === 0 ? 4 : 8),
                    format: 'rgba8unorm',
                    width: frameIndex === 0 ? 1 : 2,
                    height: 1,
                    bytesPerPixel: 4,
                    bytesPerRow: frameIndex === 0 ? 4 : 8
                })
            })
        ).rejects.toThrow(/one extent and color format/u);
        expect(system.stateHash()).toBe(before);

        await expect(
            system.bakeFlipbook({
                duration: 1,
                frameRate: 2,
                captureFrame: () => Promise.reject(new Error('capture failed'))
            })
        ).rejects.toThrow(/capture failed/u);
        expect(system.stateHash()).toBe(before);
    });

    it('suppresses runtime advancement and completion side effects during asynchronous baking', async () => {
        const system = new ParticleSystem({
            definition: ParticleSystemDefinition.create({
                emitters: [
                    {
                        name: 'bounded-bake',
                        capacity: 8,
                        execution: 'cpu',
                        duration: 0.2,
                        looping: false,
                        emission: { rateOverTime: 2 },
                        initialize: { lifetime: 0.1 },
                        renderers: [{ type: 'sprite' }]
                    }
                ]
            }),
            autoPlay: false
        });
        let completionCount = 0;
        system.on('complete', () => completionCount++);
        await system.bakeFlipbook({
            duration: 1,
            frameRate: 2,
            includeEnd: true,
            captureFrame: context => {
                context.system.update(10_000);
                expect(() => context.system.bakeMeshCache({ duration: 1, frameRate: 1 })).toThrow(
                    /already has an active bake/u
                );
                return {
                    data: new Uint8Array(4),
                    format: 'rgba8unorm',
                    width: 1,
                    height: 1,
                    bytesPerPixel: 4,
                    bytesPerRow: 4
                };
            }
        });
        expect(completionCount).toBe(0);
        expect(system.completed).toBe(false);
        expect(system.elapsedSeconds).toBe(0);
    });

    it('rejects absent mesh output, unsafe timelines, and stateful GPU baking', async () => {
        const sprite = new ParticleSystem({
            definition: spriteDefinition(),
            autoPlay: false
        });
        expect(() => sprite.bakeMeshCache({ duration: 1, frameRate: 30 })).toThrow(
            /no mesh emitter/u
        );
        expect(() => sprite.bakeMeshCache({ duration: 10, frameRate: 60, maxFrames: 10 })).toThrow(
            /frame count .* exceeds limit/u
        );

        const gpu = new ParticleSystem({
            definition: ParticleSystemDefinition.create({
                emitters: [
                    {
                        name: 'gpu-bake',
                        capacity: 16,
                        execution: 'gpu',
                        renderers: [{ type: 'sprite' }]
                    }
                ]
            }),
            compilationEnvironment: { backend: 'webgpu' },
            autoPlay: false
        });
        await expect(
            gpu.bakeFlipbook({
                duration: 1,
                frameRate: 1,
                captureFrame: () => ({
                    data: new Uint8Array(4),
                    format: 'rgba8unorm',
                    width: 1,
                    height: 1,
                    bytesPerPixel: 4,
                    bytesPerRow: 4
                })
            })
        ).rejects.toThrow(/does not support stateful GPU emitter gpu-bake/u);
    });
});
