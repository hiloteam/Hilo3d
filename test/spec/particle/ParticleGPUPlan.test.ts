import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Node from '../../../src/core/Node';
import { compileParticleSystemDefinition } from '../../../addon-particle/src/ParticleCompiler';
import ParticleCurve from '../../../addon-particle/src/ParticleCurve';
import ParticleGradient from '../../../addon-particle/src/ParticleGradient';
import ParticleSystem from '../../../addon-particle/src/ParticleSystem';
import ParticleSystemDefinition from '../../../addon-particle/src/ParticleSystemDefinition';
import { compileParticleGPUPlan } from '../../../addon-particle/src/gpu/ParticleGPUPlan';
import { ParticleGPUTransaction } from '../../../addon-particle/src/gpu/ParticleGPUTransaction';
import { WgslComputeShaderCompiler } from '../../../src/render/shader/WgslComputeCompiler';
import { StorageGraphicsShaderCompiler } from '../../../src/render/shader/StorageGraphicsShaderCompiler';
import Renderer from '../../../src/render/Renderer';
import Texture from '../../../src/texture/Texture';

declare const __HILO3D_GITHUB_ACTIONS_COVERAGE__: boolean;

describe('ParticleSystem P2 GPU artifacts', () => {
    const computeCompiler = new WgslComputeShaderCompiler();
    const graphicsCompiler = new StorageGraphicsShaderCompiler();

    beforeAll(async () => {
        await Promise.all([computeCompiler.initialize(), graphicsCompiler.initialize()]);
    });

    it('generates Naga-valid compute stages and constrained storage raster', () => {
        const definition = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'gpu-main',
                    capacity: 256,
                    execution: 'gpu',
                    bounds: { mode: 'manual', min: [-20, -20, -20], max: [20, 20, 20] },
                    initialize: { lifetime: 3, speed: 2, size: 0.2, mass: 1 },
                    modules: [
                        {
                            type: 'noise',
                            mode: 'force',
                            field: 'curl',
                            strength: [1, 1, 1],
                            frequency: 0.5,
                            octaves: 2
                        },
                        { type: 'vortex-force', strength: 0.5, axis: [0, 1, 0] },
                        { type: 'kill-distance', range: [0, 20] }
                    ],
                    renderers: [{ type: 'sprite', blend: 'additive', sort: 'distance' }]
                }
            ]
        });
        const emitter = compileParticleSystemDefinition(definition, { backend: 'webgpu' })
            .emitters[0];
        if (!emitter) throw new Error('GPU particle emitter failed to compile');
        const gpu = compileParticleGPUPlan(emitter);

        expect(gpu.recoveryPolicy).toBe('reinitialize');
        expect(gpu.workgroupCount).toBe(4);
        expect(gpu.sortStrategy).toBe('bitonic');
        for (const shader of [
            gpu.shaders.recovery,
            gpu.shaders.resetCounters,
            gpu.shaders.simulate,
            gpu.shaders.initialize,
            gpu.shaders.finalize,
            gpu.shaders.buildRenderer,
            gpu.shaders.sort
        ]) {
            if (!shader) continue;
            try {
                computeCompiler.compile(shader);
            } catch (error) {
                throw new Error(`${shader.label}: ${String(error)}`, { cause: error });
            }
        }
        const renderer = gpu.renderers.at(0);
        if (!renderer) throw new Error('Expected a compiled particle renderer');
        expect(() => graphicsCompiler.compile(renderer.shader, 'webgpu')).not.toThrow();
    });

    it('commits only staged success and rolls failures back to the prior buffer generation', () => {
        const transaction = new ParticleGPUTransaction(9, 'definition-hash');
        const staged = transaction.stage(1 / 60, 4);
        expect(staged.sourceIndex).toBe(1);
        expect(transaction.rollback()).toEqual(transaction.committed);
        expect(transaction.committed.revision).toBe(0);

        transaction.stage(1 / 60, 4);
        const committed = transaction.commit();
        expect(committed).toMatchObject({ revision: 1, spawnSequence: 4, sourceIndex: 1 });
        expect(transaction.recoverySnapshot()).toMatchObject({
            seed: 9,
            definitionHash: 'definition-hash',
            revision: 1
        });
    });

    it('selects and validates the large-capacity distance bucket profile', () => {
        const definition = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'large-sort',
                    capacity: 5000,
                    execution: 'gpu',
                    bounds: { mode: 'manual', min: [-10, -10, -10], max: [10, 10, 10] },
                    renderers: [{ type: 'sprite', sort: 'distance' }]
                }
            ]
        });
        const emitter = compileParticleSystemDefinition(definition, { backend: 'webgpu' })
            .emitters[0];
        if (!emitter) throw new Error('Large GPU particle emitter failed to compile');
        const gpu = compileParticleGPUPlan(emitter);
        expect(gpu.sortStrategy).toBe('radix-buckets');
        const sort = gpu.shaders.sort;
        if (!sort) throw new Error('Large distance sort shader is unavailable');
        expect(() => computeCompiler.compile(sort)).not.toThrow();
    });

    it('uses shared sprite pivot/stretch semantics and hierarchical GPU visibility', () => {
        const definition = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'visible-sprite',
                    capacity: 8,
                    execution: 'gpu',
                    bounds: { mode: 'manual', min: [-1, -1, -1], max: [1, 1, 1] },
                    renderers: [
                        {
                            type: 'sprite',
                            texture: new Texture(),
                            pivot: [0.25, 0.75],
                            alignment: 'stretched',
                            stretchScale: 2
                        }
                    ],
                    modules: [{ type: 'screen-space-size', scale: 1.5, range: [2, 24] }]
                }
            ]
        });
        const plan = compileParticleSystemDefinition(definition, { backend: 'webgpu' }).emitters[0];
        if (!plan) throw new Error('Expected a GPU sprite plan');
        const renderer = compileParticleGPUPlan(plan).renderers[0];
        if (!renderer) throw new Error('Expected a GPU sprite renderer');
        expect(renderer.shader.vertexSource).toContain(
            'particleCorner(localIndex) + vec2(0.5) - vec2(0.25, 0.75)'
        );
        expect(renderer.shader.vertexSource).toContain(
            'corner.y *= 1.0 + length(viewVelocity) * 2.0;'
        );
        expect(renderer.shader.vertexSource).toContain(
            'particlePixelSize = clamp(particleSize * particleWorldToPixels * 1.5, 2.0, 24.0)'
        );
        expect(renderer.shader.vertexSource).toContain(
            'particleSize = particlePixelSize / particleWorldToPixels;'
        );
        expect(renderer.shader.vertexSource).not.toContain('length(viewVelocity) / particleSize');
        expect(renderer.shader.fragmentSource).toContain('vec2 hiloTextureUV(vec2 uv)');
        expect(renderer.shader.fragmentSource).toContain(
            'texture(u_particleTexture, hiloTextureUV(particleUV))'
        );

        const parent = new Node({ visible: false });
        const system = new ParticleSystem({
            definition,
            autoPlay: false,
            compilationEnvironment: { backend: 'webgpu' }
        });
        parent.addChild(system);
        const camera = new PerspectiveCamera({ aspect: 1, near: 0.1, far: 20 });
        camera.z = 5;
        parent.updateMatrixWorld(true);
        expect(system.isGPUVisible(camera)).toBe(false);
        parent.visible = true;
        parent.updateMatrixWorld(true);
        expect(system.isGPUVisible(camera)).toBe(true);
        system.x = 100;
        parent.updateMatrixWorld(true);
        expect(system.isGPUVisible(camera)).toBe(false);
    });
});

describe('ParticleSystem P2 GPU Render Graph integration', () => {
    const renderers: Renderer[] = [];

    afterEach(() => {
        for (const renderer of renderers.splice(0)) renderer.destroy();
    });

    it.skipIf(__HILO3D_GITHUB_ACTIONS_COVERAGE__)(
        'records persistent simulation, compaction and indirect storage raster without readback',
        async () => {
            const renderer = await Renderer.create({
                backend: 'webgpu',
                domElement: document.createElement('canvas'),
                width: 16,
                height: 16,
                antialias: false
            });
            renderers.push(renderer);
            const fieldCanvas = document.createElement('canvas');
            fieldCanvas.width = 2;
            fieldCanvas.height = 2;
            const fieldContext = fieldCanvas.getContext('2d');
            if (fieldContext === null) throw new Error('Vector-field canvas is unavailable');
            fieldContext.fillStyle = 'rgb(128, 255, 128)';
            fieldContext.fillRect(0, 0, 2, 2);
            const vectorField = new Texture({ image: fieldCanvas, needUpdate: true });
            const system = new ParticleSystem({
                definition: ParticleSystemDefinition.create({
                    emitters: [
                        {
                            name: 'graph-gpu',
                            capacity: 64,
                            execution: 'gpu',
                            bounds: {
                                mode: 'manual',
                                min: [-4, -4, -4],
                                max: [4, 4, 4]
                            },
                            emission: { rateOverTime: 8 },
                            initialize: {
                                lifetime: 2,
                                direction: [0, 1, 0],
                                speed: 0.5,
                                size: 0.2,
                                color: [1, 0.5, 0.2, 1]
                            },
                            modules: [
                                { type: 'gravity', force: [0, -0.25, 0] },
                                { type: 'drag', coefficient: 0.05 },
                                { type: 'vector-field', texture: vectorField, strength: 0.01 },
                                {
                                    type: 'size-over-lifetime',
                                    curve: new ParticleCurve([
                                        { time: 0, value: 1 },
                                        { time: 1, value: 0 }
                                    ])
                                },
                                {
                                    type: 'color-by-speed',
                                    speedRange: [0, 1],
                                    gradient: new ParticleGradient([
                                        { time: 0, color: [1, 0, 0, 1] },
                                        { time: 1, color: [0, 0, 1, 0] }
                                    ])
                                },
                                {
                                    type: 'texture-sheet',
                                    mode: 'fps',
                                    rows: 2,
                                    columns: 2,
                                    fps: 8
                                }
                            ],
                            renderers: [
                                {
                                    type: 'sprite',
                                    blend: 'additive',
                                    depthTest: false,
                                    sort: 'distance'
                                }
                            ]
                        }
                    ]
                }),
                seed: 17,
                autoPlay: false,
                compilationEnvironment: { backend: 'webgpu' }
            });
            const scene = new Node();
            scene.addChild(system);
            const camera = new PerspectiveCamera({ aspect: 1, near: 0.1, far: 20 });
            camera.z = 5;
            system.emit(4).simulate(1 / 60);

            try {
                renderer.render(scene, camera);
            } catch (error) {
                const cause = error instanceof Error ? error.cause : undefined;
                throw new Error(`GPU particle graph recording failed: ${String(cause)}`, {
                    cause: error
                });
            }
            await renderer.waitForIdle();
            renderer.render(scene, camera);
            await renderer.waitForIdle();
            expect(renderer.renderInfo.drawCount).toBeGreaterThan(0);

            const definitionIdentity = system.definition;
            const rhi = renderer.getExtension('rhi') as {
                readonly device: { destroy(): void };
            } | null;
            if (rhi === null)
                throw new Error('Particle recovery requires the public RHI extension');
            const deviceLost = new Promise<void>(resolve => {
                renderer.on(
                    'webgpuDeviceLost',
                    () => {
                        resolve();
                    },
                    true
                );
            });
            const deviceRestored = new Promise<void>(resolve => {
                renderer.on(
                    'webgpuDeviceRestored',
                    () => {
                        resolve();
                    },
                    true
                );
            });
            rhi.device.destroy();
            await deviceLost;
            await Promise.all([renderer.waitForIdle(), deviceRestored]);
            system.emit(2).simulate(1 / 60);
            renderer.render(scene, camera);
            await renderer.waitForIdle();
            expect(system.definition).toBe(definitionIdentity);
            expect(renderer.renderInfo.drawCount).toBeGreaterThan(0);

            system.destroy(renderer);
        }
    );
});
