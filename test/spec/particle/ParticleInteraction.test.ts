import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Node from '../../../src/core/Node';
import { compileParticleSystemDefinition } from '../../../src/particle/ParticleCompiler';
import { ParticleEventChannel } from '../../../src/particle/ParticleEventChannel';
import ParticleSystem from '../../../src/particle/ParticleSystem';
import ParticleSystemDefinition from '../../../src/particle/ParticleSystemDefinition';
import type { ParticleVector3 } from '../../../src/particle/ParticleTypes';
import { compileParticleGPUPlan } from '../../../src/particle/gpu/ParticleGPUPlan';
import { compileParticleGPUSubEmitterRoutes } from '../../../src/particle/gpu/ParticleGPUEventPlan';
import { StorageGraphicsShaderCompiler } from '../../../src/render/shader/StorageGraphicsShaderCompiler';
import { WgslComputeShaderCompiler } from '../../../src/render/shader/WgslComputeCompiler';
import Renderer from '../../../src/render/Renderer';

declare const __HILO3D_GITHUB_ACTIONS_COVERAGE__: boolean;

function collisionDefinition(eventCapacity = 8): ParticleSystemDefinition {
    return ParticleSystemDefinition.create({
        emitters: [
            {
                name: 'source',
                capacity: 8,
                execution: 'cpu',
                eventCapacity,
                fixedStep: 0.1,
                initialize: { lifetime: 2, size: 0.1 },
                modules: [
                    {
                        type: 'collision',
                        colliders: [{ type: 'plane', normal: [0, 1, 0] }],
                        bounce: 1,
                        event: 'impact'
                    },
                    {
                        type: 'sub-emitter',
                        event: 'impact',
                        emitter: 'sparks',
                        count: 2,
                        inheritVelocity: true
                    }
                ],
                renderers: [{ type: 'sprite' }]
            },
            {
                name: 'sparks',
                capacity: 8,
                execution: 'cpu',
                fixedStep: 0.1,
                initialize: { lifetime: 1 },
                renderers: [{ type: 'sprite' }]
            }
        ]
    });
}

describe('ParticleSystem P4 CPU interaction and events', () => {
    it('resolves analytic collisions, batches events, and routes sub-emitter spawn', async () => {
        const system = new ParticleSystem({
            definition: collisionDefinition(),
            autoPlay: false,
            eventReadbackCapacity: 8
        });
        const callback = vi.fn();
        system.on('impact', callback);
        system
            .emit({ emitter: 'source', count: 1, position: [0, 0.05, 0], velocity: [0, -1, 0] })
            .simulate(0.1)
            .simulate(0.1);

        const aggregate = await system.readEvents();
        expect(aggregate.counts).toMatchObject({ birth: 1, impact: 1 });
        expect(
            aggregate.events.find(event => event.name === 'impact')?.velocity[1]
        ).toBeGreaterThan(0);
        expect(callback).not.toHaveBeenCalled();

        system.simulate(0.1);
        expect(system.aliveCount).toBe(3);
    });

    it('tracks trigger enter/inside/exit state without per-particle callbacks', async () => {
        const system = new ParticleSystem({
            definition: ParticleSystemDefinition.create({
                emitters: [
                    {
                        name: 'triggered',
                        capacity: 2,
                        execution: 'cpu',
                        eventCapacity: 8,
                        fixedStep: 0.1,
                        initialize: { lifetime: 2 },
                        modules: [
                            {
                                type: 'trigger',
                                volumes: [{ type: 'sphere', radius: 0.15 }],
                                events: { enter: 'entered', inside: 'inside', exit: 'exited' }
                            }
                        ],
                        renderers: [{ type: 'sprite' }]
                    }
                ]
            }),
            autoPlay: false
        });
        system
            .emit({ count: 1, velocity: [1, 0, 0] })
            .simulate(0.1)
            .simulate(0.1)
            .simulate(0.1);

        const aggregate = await system.readEvents();
        expect(aggregate.counts).toMatchObject({ entered: 1, inside: 1, exited: 1 });
    });

    it('reports bounded event overflow and resets aggregate diagnostics after reading', async () => {
        const system = new ParticleSystem({
            definition: collisionDefinition(1),
            autoPlay: false,
            eventReadbackCapacity: 1
        });
        system
            .emit({ emitter: 'source', count: 1, position: [0, 0.05, 0], velocity: [0, -1, 0] })
            .simulate(0.1)
            .simulate(0.1);

        const first = await system.readEvents();
        expect(first.events).toHaveLength(1);
        expect(first.droppedCount).toBeGreaterThan(0);
        expect((await system.readEvents()).droppedCount).toBe(0);
    });
});

describe('ParticleEventChannel', () => {
    it('validates typed payloads, applies overflow policy, and feeds a resident system', () => {
        type Impact = Readonly<{
            position: ParticleVector3;
            velocity: ParticleVector3;
            kind: number;
        }>;
        const channel = new ParticleEventChannel<Impact>({
            name: 'impacts',
            capacity: 1,
            overflow: 'drop-oldest',
            schema: { position: 'vec3', velocity: 'vec3', kind: 'uint' }
        });
        expect(channel.submit({ position: [1, 2, 3], velocity: [0, 1, 0], kind: 1 })).toBe(true);
        expect(channel.submit({ position: [4, 5, 6], velocity: [1, 0, 0], kind: 2 })).toBe(true);
        expect(channel.droppedCount).toBe(1);
        expect(() =>
            channel.submit({ position: [0, 0, 0], velocity: [0, 0, 0], kind: -1 })
        ).toThrow(/unsigned/u);

        const system = new ParticleSystem({ definition: collisionDefinition(), autoPlay: false });
        expect(
            channel.emitTo(system, {
                emitter: 'sparks',
                positionField: 'position',
                velocityField: 'velocity'
            })
        ).toBe(1);
        system.simulate(0.1);
        expect(system.aliveCount).toBe(1);
    });
});

describe('ParticleSystem P4 WebGPU depth artifacts', () => {
    const computeCompiler = new WgslComputeShaderCompiler();
    const graphicsCompiler = new StorageGraphicsShaderCompiler();

    beforeAll(async () => {
        await Promise.all([computeCompiler.initialize(), graphicsCompiler.initialize()]);
    });

    it('generates Naga-valid analytic/depth collision and soft-particle shaders', () => {
        const definition = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'depth-interaction',
                    capacity: 64,
                    execution: 'gpu',
                    bounds: { mode: 'manual', min: [-4, -4, -4], max: [4, 4, 4] },
                    initialize: { lifetime: 2, size: 0.2 },
                    modules: [
                        {
                            type: 'collision',
                            colliders: [
                                { type: 'plane', normal: [0, 1, 0] },
                                { type: 'sphere', radius: 1 },
                                { type: 'box', size: [1, 1, 1] },
                                { type: 'capsule', start: [0, -1, 0], end: [0, 1, 0], radius: 0.25 }
                            ],
                            radiusScale: 1.5,
                            lifetimeLoss: 0.25
                        },
                        { type: 'scene-depth-collision', thickness: 0.01 }
                    ],
                    renderers: [
                        {
                            type: 'sprite',
                            softParticle: { distance: 0.02, contrast: 1.5 }
                        }
                    ]
                }
            ]
        });
        const emitter = compileParticleSystemDefinition(definition, { backend: 'webgpu' })
            .emitters[0];
        if (!emitter) throw new Error('Expected a GPU interaction plan');
        const gpu = compileParticleGPUPlan(emitter);
        expect(() => computeCompiler.compile(gpu.shaders.simulate)).not.toThrow();
        expect(gpu.shaders.simulate.source).toContain('particleSize * 0.5 * 1.5');
        expect(gpu.shaders.simulate.source).toContain('age += lifetime * 0.25');
        const renderer = gpu.renderers[0];
        if (!renderer) throw new Error('Expected a soft-particle renderer');
        expect(() => graphicsCompiler.compile(renderer.shader, 'webgpu')).not.toThrow();
        expect(renderer.shader.fragmentSource).toContain('bool hasSceneDepth');
        expect(renderer.shader.fragmentSource).toContain('sceneDepth > 0.000001');
        expect(renderer.shader.fragmentSource).toContain('sceneDepth < 0.999999');
        expect(renderer.shader.bindings).toContainEqual(
            expect.objectContaining({
                name: 'u_particleSceneDepth',
                kind: 'sampled-texture',
                sampleType: 'depth'
            })
        );
        expect(gpu.shaders.simulate.bindings).toContainEqual(
            expect.objectContaining({ name: 'particleSceneDepth', sampleType: 'depth' })
        );
    });

    it('rejects unsafe scene-depth execution and depth-write feedback configurations', () => {
        const input = {
            emitters: [
                {
                    name: 'invalid-soft',
                    capacity: 8,
                    execution: 'cpu' as const,
                    modules: [{ type: 'scene-depth-collision' as const }],
                    renderers: [
                        {
                            type: 'sprite' as const,
                            depthWrite: true,
                            softParticle: { distance: 0.1 }
                        }
                    ]
                }
            ]
        };
        const definition = ParticleSystemDefinition.create(input);
        expect(() => compileParticleSystemDefinition(definition, { backend: 'webgpu' })).toThrow(
            /explicit GPU execution/u
        );

        const invalidEmitter = input.emitters[0];
        if (!invalidEmitter) throw new Error('Expected an invalid soft-particle emitter');
        const gpuDefinition = ParticleSystemDefinition.create({
            emitters: [{ ...invalidEmitter, execution: 'gpu' }]
        });
        expect(() => compileParticleSystemDefinition(gpuDefinition, { backend: 'webgpu' })).toThrow(
            /cannot enable depthWrite/u
        );
    });

    it('compiles bounded GPU-resident sub-emitter routing without a readback binding', () => {
        const definition = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'gpu-source',
                    capacity: 64,
                    eventCapacity: 32,
                    execution: 'gpu',
                    bounds: { mode: 'manual', min: [-2, -2, -2], max: [2, 2, 2] },
                    modules: [
                        {
                            type: 'sub-emitter',
                            event: 'collision',
                            emitter: 'gpu-target',
                            count: 3,
                            inheritVelocity: true
                        }
                    ],
                    renderers: [{ type: 'sprite' }]
                },
                {
                    name: 'gpu-target',
                    capacity: 128,
                    execution: 'gpu',
                    bounds: { mode: 'manual', min: [-4, -4, -4], max: [4, 4, 4] },
                    renderers: [{ type: 'sprite' }]
                }
            ]
        });
        const compiled = compileParticleSystemDefinition(definition, { backend: 'webgpu' });
        const routes = compileParticleGPUSubEmitterRoutes(compiled);
        expect(routes).toHaveLength(1);
        const route = routes[0];
        if (!route) throw new Error('Expected a GPU sub-emitter route');
        expect(route).toMatchObject({
            targetEmitter: 'gpu-target',
            count: 3,
            inheritVelocity: true
        });
        expect(route.shader.bindings.every(binding => !binding.name.includes('readback'))).toBe(
            true
        );
        expect(() => computeCompiler.compile(route.shader)).not.toThrow();
    });
});

describe('ParticleSystem P4 GPU event graph integration', () => {
    const renderers: Renderer[] = [];

    afterEach(() => {
        for (const renderer of renderers.splice(0)) renderer.destroy();
    });

    it.skipIf(__HILO3D_GITHUB_ACTIONS_COVERAGE__)(
        'captures and routes GPU birth events without count readback',
        async () => {
            const renderer = await Renderer.create({
                backend: 'webgpu',
                domElement: document.createElement('canvas'),
                width: 16,
                height: 16,
                antialias: false
            });
            renderers.push(renderer);
            const bounds = {
                mode: 'manual' as const,
                min: [-2, -2, -2] as const,
                max: [2, 2, 2] as const
            };
            const system = new ParticleSystem({
                definition: ParticleSystemDefinition.create({
                    emitters: [
                        {
                            name: 'gpu-event-source',
                            capacity: 16,
                            eventCapacity: 16,
                            execution: 'gpu',
                            bounds,
                            modules: [
                                { type: 'scene-depth-collision', thickness: 0.01 },
                                {
                                    type: 'sub-emitter',
                                    event: 'birth',
                                    emitter: 'gpu-event-target',
                                    count: 2
                                }
                            ],
                            renderers: [{ type: 'sprite', softParticle: { distance: 0.1 } }]
                        },
                        {
                            name: 'gpu-event-target',
                            capacity: 32,
                            execution: 'gpu',
                            bounds,
                            renderers: [{ type: 'sprite', depthTest: false }]
                        }
                    ]
                }),
                autoPlay: false,
                compilationEnvironment: { backend: 'webgpu' }
            });
            const scene = new Node();
            scene.addChild(system);
            const camera = new PerspectiveCamera({ aspect: 1, near: 0.1, far: 10 });
            camera.z = 4;

            system.emit({ emitter: 'gpu-event-source', count: 1 }).simulate(1 / 60);
            renderer.render(scene, camera);
            await renderer.waitForIdle();
            system.simulate(1 / 60);
            renderer.render(scene, camera);
            await renderer.waitForIdle();

            expect(system.eventDiagnostics.pendingCount).toBe(0);
            expect(renderer.renderInfo.drawCount).toBeGreaterThan(0);
            system.destroy(renderer);
        }
    );
});
