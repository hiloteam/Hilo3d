import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Node from '../../../src/core/Node';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import SphereGeometry from '../../../src/geometry/SphereGeometry';
import Mesh from '../../../src/core/Mesh';
import ParticleSystem from '../../../addon-particle/src/ParticleSystem';
import ParticleSystemDefinition from '../../../addon-particle/src/ParticleSystemDefinition';
import { compileParticleSystemDefinition } from '../../../addon-particle/src/ParticleCompiler';
import { compileParticleGPUPlan } from '../../../addon-particle/src/gpu/ParticleGPUPlan';
import { WgslComputeShaderCompiler } from '../../../src/render/shader/WgslComputeCompiler';
import { StorageGraphicsShaderCompiler } from '../../../src/render/shader/StorageGraphicsShaderCompiler';
import Renderer from '../../../src/render/Renderer';
import Texture from '../../../src/texture/Texture';

declare const __HILO3D_GITHUB_ACTIONS_COVERAGE__: boolean;

const bounds = {
    mode: 'manual' as const,
    min: [-4, -4, -4] as const,
    max: [4, 4, 4] as const
};

describe('ParticleSystem P5 portable topology', () => {
    it('buckets CPU mesh particles into one instanced draw per mesh', () => {
        const texture = new Texture();
        const system = new ParticleSystem({
            definition: ParticleSystemDefinition.create({
                emitters: [
                    {
                        name: 'mesh-buckets',
                        capacity: 8,
                        execution: 'cpu',
                        bounds,
                        renderers: [
                            {
                                type: 'mesh',
                                meshes: [
                                    { geometry: new BoxGeometry() },
                                    { geometry: new SphereGeometry() }
                                ],
                                texture,
                                coverage: 'opaque',
                                lighting: 'lambert',
                                motionVectors: true
                            }
                        ]
                    }
                ]
            }),
            autoPlay: false
        });
        system.emit(6).simulate(1 / 60);

        expect(system.children).toHaveLength(2);
        expect(
            system.children.reduce(
                (count, child) => count + (child instanceof Mesh ? child.instanceCount : 0),
                0
            )
        ).toBe(6);
        expect(system.children.every(child => child instanceof Mesh && !child.useInstanced)).toBe(
            true
        );
        for (const child of system.children) {
            if (!(child instanceof Mesh)) throw new Error('Expected a CPU particle mesh bridge');
            const forward = child.material?.definition.getPass('forward')?.shader;
            const motion = child.material?.definition.getPass('motion-vector')?.shader;
            expect(forward?.kind).toBe('glsl');
            expect(motion?.kind).toBe('glsl');
            if (forward?.kind !== 'glsl' || motion?.kind !== 'glsl') {
                throw new Error('Expected textured particle mesh GLSL passes');
            }
            expect(forward.fragmentSource).toContain(
                'texture(u_particleTexture, hiloTextureUV(v_particleUV))'
            );
            expect(motion.fragmentSource).toContain(
                'texture(u_particleTexture, hiloTextureUV(v_motionUV)).a'
            );
        }
    });

    it('compacts CPU ribbon members into one segment-instanced draw', () => {
        const texture = new Texture();
        const system = new ParticleSystem({
            definition: ParticleSystemDefinition.create({
                emitters: [
                    {
                        name: 'trail',
                        capacity: 8,
                        execution: 'cpu',
                        bounds,
                        initialize: { ribbonId: 0 },
                        renderers: [{ type: 'trail', texture, widthScale: 0.5 }]
                    }
                ]
            }),
            autoPlay: false
        });
        system.emit(5).simulate(1 / 60);

        const output = system.children[0];
        expect(output).toBeInstanceOf(Mesh);
        if (!(output instanceof Mesh)) throw new Error('Expected a ribbon mesh bridge');
        expect(output.instanceCount).toBe(4);
        expect(system.children).toHaveLength(1);
        const shader = output.material?.definition.getPass('forward')?.shader;
        expect(shader?.kind).toBe('glsl');
        if (shader?.kind !== 'glsl') throw new Error('Expected a textured CPU trail GLSL pass');
        expect(shader.fragmentSource).toContain(
            'texture(u_particleTexture, hiloTextureUV(v_particleUV))'
        );
    });

    it('fails unsupported ordering and motion-vector combinations before a frame', () => {
        expect(() =>
            ParticleSystemDefinition.create({
                emitters: [
                    {
                        name: 'transparent-motion',
                        capacity: 4,
                        renderers: [
                            {
                                type: 'mesh',
                                meshes: [{ geometry: new BoxGeometry() }],
                                motionVectors: true
                            }
                        ]
                    }
                ]
            })
        ).not.toThrow();
        const transparentMotion = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'transparent-motion',
                    capacity: 4,
                    renderers: [
                        {
                            type: 'mesh',
                            meshes: [{ geometry: new BoxGeometry() }],
                            motionVectors: true
                        }
                    ]
                }
            ]
        });
        expect(() => compileParticleSystemDefinition(transparentMotion)).toThrow(
            /motionVectors requires opaque or masked/u
        );

        const sortedRibbon = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'sorted-ribbon',
                    capacity: 4,
                    renderers: [{ type: 'ribbon', sort: 'distance' }]
                }
            ]
        });
        expect(() => compileParticleSystemDefinition(sortedRibbon)).toThrow(
            /cannot reorder ribbon topology/u
        );
        const qualityRibbon = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'quality-ribbon',
                    capacity: 4,
                    renderers: [{ type: 'ribbon' }]
                }
            ]
        });
        expect(() =>
            compileParticleSystemDefinition(qualityRibbon, {
                backend: 'webgl2',
                advancedQuality: { ribbons: false }
            })
        ).toThrow(/disabled ribbon quality/u);
    });

    it('renders portable mesh buckets and ribbons through WebGL2 shared scene draws', async () => {
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 24,
            height: 24,
            antialias: false
        });
        const system = new ParticleSystem({
            definition: ParticleSystemDefinition.create({
                emitters: [
                    {
                        name: 'portable-advanced',
                        capacity: 8,
                        execution: 'cpu',
                        bounds,
                        renderers: [
                            { type: 'sprite', alignment: 'view' },
                            {
                                type: 'mesh',
                                meshes: [
                                    { geometry: new BoxGeometry() },
                                    { geometry: new SphereGeometry() }
                                ],
                                coverage: 'opaque',
                                lighting: 'lambert'
                            },
                            { type: 'ribbon', lighting: 'lambert' }
                        ]
                    }
                ]
            }),
            autoPlay: false
        });
        const scene = new Node();
        scene.addChild(system);
        const camera = new PerspectiveCamera({ aspect: 1, near: 0.1, far: 10 });
        camera.z = 4;
        system.emit(5).simulate(1 / 60);
        try {
            renderer.render(scene, camera);
            await renderer.waitForIdle();
            renderer.render(scene, camera);
            await renderer.waitForIdle();
            expect(renderer.renderInfo.drawCount).toBeGreaterThanOrEqual(4);
        } finally {
            system.destroy(renderer);
            renderer.destroy();
        }
    });

    it('renders multiple same-layout CPU particle systems with independent instance buffers', async () => {
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 24,
            height: 24,
            antialias: false
        });
        const definition = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'same-layout',
                    capacity: 8,
                    execution: 'cpu',
                    bounds,
                    renderers: [{ type: 'sprite' }]
                }
            ]
        });
        const first = new ParticleSystem({ definition, autoPlay: false });
        const second = new ParticleSystem({ definition, autoPlay: false });
        second.x = 1;
        const scene = new Node();
        scene.addChild(first);
        scene.addChild(second);
        const camera = new PerspectiveCamera({ aspect: 1, near: 0.1, far: 10 });
        camera.z = 4;
        first.emit(2).simulate(1 / 60);
        second.emit(2).simulate(1 / 60);
        try {
            renderer.render(scene, camera);
            await renderer.waitForIdle();
            renderer.render(scene, camera);
            await renderer.waitForIdle();
            expect(renderer.renderInfo.drawCount).toBeGreaterThanOrEqual(2);
        } finally {
            first.destroy(renderer);
            second.destroy(renderer);
            renderer.destroy();
        }
    });
});

describe('ParticleSystem P5 WebGPU plans', () => {
    const computeCompiler = new WgslComputeShaderCompiler();
    const graphicsCompiler = new StorageGraphicsShaderCompiler();

    beforeAll(async () => {
        await Promise.all([computeCompiler.initialize(), graphicsCompiler.initialize()]);
    });

    it('compiles mesh buckets and ribbon compact/indirect stages to validated GPU artifacts', () => {
        const texture = new Texture();
        const definition = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'advanced-gpu',
                    capacity: 32,
                    execution: 'gpu',
                    bounds,
                    initialize: { meshIndex: { min: 0, max: 1 }, ribbonId: 0 },
                    renderers: [
                        {
                            type: 'mesh',
                            meshes: [
                                { geometry: new BoxGeometry() },
                                { geometry: new SphereGeometry() }
                            ],
                            texture,
                            coverage: 'opaque',
                            lighting: 'lambert'
                        },
                        {
                            type: 'ribbon',
                            texture,
                            lighting: 'lambert',
                            softParticle: { distance: 0.1 }
                        }
                    ]
                }
            ]
        });
        const emitter = compileParticleSystemDefinition(definition, { backend: 'webgpu' })
            .emitters[0];
        if (!emitter) throw new Error('Expected an advanced emitter plan');
        const plan = compileParticleGPUPlan(emitter);

        expect(plan.advancedRenderers).toHaveLength(2);
        for (const renderer of plan.advancedRenderers) {
            if (renderer.kind === 'mesh') {
                expect(renderer.assets).toHaveLength(2);
                for (const shader of [renderer.reset, renderer.build, renderer.finalize]) {
                    expect(() => computeCompiler.compile(shader)).not.toThrow();
                }
                for (const asset of renderer.assets) {
                    expect(asset.shader.fragmentSource).toContain(
                        'texture(u_particleTexture, hiloTextureUV(particleUV))'
                    );
                    expect(() => graphicsCompiler.compile(asset.shader, 'webgpu')).not.toThrow();
                }
            } else {
                expect(renderer.topologyCapacity).toBe(32);
                expect(renderer.shader.fragmentSource).toContain('bool hasSceneDepth');
                expect(renderer.shader.fragmentSource).toContain(
                    'texture(u_particleTexture, hiloTextureUV(particleUV))'
                );
                for (const shader of [
                    renderer.reset,
                    renderer.initializeTopology,
                    renderer.sortTopology,
                    renderer.buildSegments,
                    renderer.finalize
                ]) {
                    expect(() => computeCompiler.compile(shader)).not.toThrow();
                }
                expect(() => graphicsCompiler.compile(renderer.shader, 'webgpu')).not.toThrow();
            }
        }
    });
});

describe('ParticleSystem P5 WebGPU Render Graph integration', () => {
    const renderers: Renderer[] = [];

    afterEach(() => {
        for (const renderer of renderers.splice(0)) renderer.destroy();
    });

    it.skipIf(__HILO3D_GITHUB_ACTIONS_COVERAGE__)(
        'records mesh buckets and soft ribbon compact draws without readback',
        async () => {
            const renderer = await Renderer.create({
                backend: 'webgpu',
                domElement: document.createElement('canvas'),
                width: 24,
                height: 24,
                antialias: false
            });
            renderers.push(renderer);
            const system = new ParticleSystem({
                definition: ParticleSystemDefinition.create({
                    emitters: [
                        {
                            name: 'advanced-runtime',
                            capacity: 16,
                            execution: 'gpu',
                            bounds,
                            initialize: {
                                lifetime: 2,
                                size: 0.15,
                                meshIndex: { min: 0, max: 1 },
                                ribbonId: 0
                            },
                            renderers: [
                                {
                                    type: 'mesh',
                                    meshes: [
                                        { geometry: new BoxGeometry() },
                                        { geometry: new SphereGeometry() }
                                    ],
                                    coverage: 'opaque',
                                    lighting: 'lambert'
                                },
                                {
                                    type: 'trail',
                                    softParticle: { distance: 0.1 }
                                }
                            ]
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

            system.emit(6).simulate(1 / 60);
            renderer.render(scene, camera);
            await renderer.waitForIdle();
            system.simulate(1 / 60);
            renderer.render(scene, camera);
            await renderer.waitForIdle();

            expect(renderer.renderInfo.drawCount).toBeGreaterThanOrEqual(3);
            expect(system.aliveCount).toBe(0);
            system.destroy(renderer);
        }
    );
});
