import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rhiBenchmarkAllocationProfilerWarmupFrames } from '../../benchmarks/rhi/fixture-contract';
import PerspectiveCamera from '../../src/camera/PerspectiveCamera';
import Node from '../../src/core/Node';
import type Shader from '../../src/shader/Shader';
import Texture from '../../src/texture/Texture';
import type { RendererFrame, RendererScene } from '../../src/render/RendererCore';
import type {
    RenderTarget,
    RenderTargetColorAttachmentReadback,
    RenderTargetParameters
} from '../../src/render/RenderTarget';
import { ShaderArtifactCompiler } from '../../src/render/renderer/ShaderArtifactCompiler';
import { prepareGLSLForNaga } from '../../src/render/shader/GlslToWgsl';
import {
    RHI_PRODUCTION_SMOKE_DISCARDED_ALLOCATION_PROFILES,
    RHI_PRODUCTION_SMOKE_MEASURED_ALLOCATION_PROFILES,
    RHI_PRODUCTION_SMOKE_POST_SUSPEND_WARMUP_FRAMES,
    RHI_PRODUCTION_SMOKE_PROFILE_MEASURED_CHUNK_FRAMES,
    RHI_PRODUCTION_SMOKE_PROFILER_WARMUP_FRAMES,
    RHI_PRODUCTION_SMOKE_PROFILER_QUIESCENCE_PROBE_FRAMES,
    RHI_PRODUCTION_SMOKE_HOT_PATH_TODO_BUDGET_BYTES,
    RHI_PRODUCTION_SMOKE_PROFILER_QUIESCENCE_STABLE_FRAMES,
    RHI_PRODUCTION_SMOKE_PROFILER_RESTART_NOOP_TASKS,
    RHI_PRODUCTION_SMOKE_PROFILER_RESTART_RENDER_FRAMES,
    RHI_PRODUCTION_SMOKE_SCENARIOS,
    RHI_PRODUCTION_SMOKE_WARMUP_FRAMES,
    summarizeRHIProductionSmokeAllocations
} from '../../scripts/performance/smoke-rhi-production-fixture';
import {
    MRT_MSAA_POSTPROCESS_COMBINE_FRAGMENT_SOURCE,
    MRT_MSAA_POSTPROCESS_EFFECT_PASS_COUNT,
    MRT_MSAA_POSTPROCESS_FINAL_FRAGMENT_SOURCE,
    MRT_MSAA_POSTPROCESS_SWIZZLE_FRAGMENT_SOURCE,
    MRT_MSAA_POSTPROCESS_VERTEX_SOURCE,
    createMRTMSAAPostProcessWorkload,
    mrtMSAAPostProcessPrimaryDrawCount,
    mrtMSAAPostProcessSourceTargetParameters,
    recordMRTMSAAPostProcessWorkload
} from './fixtures/rhi-postprocess-workload';
import {
    RHI_PRODUCTION_MAX_IN_FLIGHT_FRAMES,
    benchmarkInFlightBatchIsFull,
    benchmarkMaterialIndex,
    benchmarkMeshCastsShadow,
    benchmarkMeshDepth,
    benchmarkPrimaryDrawCount
} from './fixtures/rhi-scene-workload';

class FakeRenderTarget implements RenderTarget {
    readonly backend = 'webgl2' as const;
    readonly label: string;
    readonly sampleCount: 1 | 4;
    readonly colorAttachmentCount: number;
    readonly colorFormats: readonly 'rgba8unorm'[];
    readonly depthStencilFormat = null;
    readonly #textures: Texture<Uint8Array>[];
    #destroyed = false;

    constructor(
        readonly width: number,
        readonly height: number,
        sampleCount: 1 | 4,
        colorAttachmentCount: number,
        label: string
    ) {
        this.sampleCount = sampleCount;
        this.colorAttachmentCount = colorAttachmentCount;
        this.label = label;
        this.colorFormats = Object.freeze(
            Array<'rgba8unorm'>(colorAttachmentCount).fill('rgba8unorm')
        );
        this.#textures = Array.from(
            { length: colorAttachmentCount },
            () =>
                new Texture({
                    width: 1,
                    height: 1,
                    image: new Uint8Array([0, 0, 0, 255])
                })
        );
    }

    get isDestroyed(): boolean {
        return this.#destroyed;
    }

    getColorTexture(index = 0): Texture<unknown> {
        const texture = this.#textures[index];
        if (!texture) throw new RangeError('fake color attachment is out of range');
        return texture;
    }

    getDepthTexture(): null {
        return null;
    }

    readColorAttachment(): Promise<RenderTargetColorAttachmentReadback> {
        return Promise.resolve({
            data: new Uint8Array(4),
            format: 'rgba8unorm',
            width: 1,
            height: 1,
            bytesPerPixel: 4,
            bytesPerRow: 4
        });
    }

    resize(): void {
        throw new Error('fake target resize is not used');
    }

    destroy(): void {
        this.#destroyed = true;
    }
}

function sourceTarget(): FakeRenderTarget {
    const parameters = mrtMSAAPostProcessSourceTargetParameters(1280, 720);
    return new FakeRenderTarget(
        parameters.width,
        parameters.height,
        parameters.sampleCount ?? 1,
        parameters.colorAttachments?.length ?? 1,
        parameters.label ?? 'unnamed source'
    );
}

describe('RHI production MRT/MSAA post-process workload', () => {
    it('builds two distinct intermediates with a real three-effect texture dependency chain', () => {
        expect(mrtMSAAPostProcessSourceTargetParameters(1280, 720)).toMatchObject({
            width: 1280,
            height: 720,
            sampleCount: 4,
            depthStencilAttachment: false,
            colorAttachments: [
                { format: 'rgba8unorm' },
                { format: 'rgba8unorm' },
                { format: 'rgba8unorm' },
                { format: 'rgba8unorm' }
            ]
        });
        const descriptors: RenderTargetParameters[] = [];
        const factory = {
            createRenderTarget(parameters: RenderTargetParameters): RenderTarget {
                descriptors.push(parameters);
                return new FakeRenderTarget(
                    parameters.width,
                    parameters.height,
                    parameters.sampleCount ?? 1,
                    parameters.colorAttachments?.length ?? 1,
                    parameters.label ?? 'unnamed target'
                );
            }
        };
        const source = sourceTarget();
        const workload = createMRTMSAAPostProcessWorkload(factory, source, 1280, 720);
        const [combine, swizzle, final] = workload.passes;

        expect(workload.source).toBe(source);
        expect(workload.passes).toHaveLength(MRT_MSAA_POSTPROCESS_EFFECT_PASS_COUNT);
        expect(new Set(workload.passes.map(pass => pass.output).filter(Boolean)).size).toBe(2);
        expect(final.output).toBeNull();
        expect(descriptors).toHaveLength(2);
        for (const descriptor of descriptors) {
            expect(descriptor).toMatchObject({
                width: 1280,
                height: 720,
                sampleCount: 1,
                depthStencilAttachment: false,
                colorAttachments: [{ format: 'rgba8unorm' }]
            });
            expect(descriptor.label).toMatch(/^mrt-msaa-postprocess intermediate \d$/u);
        }

        expect(combine.inputTextures).toEqual([
            source.getColorTexture(0),
            source.getColorTexture(1),
            source.getColorTexture(2),
            source.getColorTexture(3)
        ]);
        if (!combine.output || !swizzle.output) throw new Error('intermediate output is missing');
        expect(swizzle.inputTextures).toEqual([combine.output.getColorTexture(0)]);
        expect(final.inputTextures).toEqual([swizzle.output.getColorTexture(0)]);
        for (let index = 0; index < combine.inputTextures.length; index += 1) {
            expect(combine.material.getUniformData(`u_mrt${String(index)}`, combine.mesh, {})).toBe(
                combine.inputTextures[index]
            );
        }
        expect(swizzle.material.getUniformData('u_source', swizzle.mesh, {})).toBe(
            combine.output.getColorTexture(0)
        );
        expect(final.material.getUniformData('u_source', final.mesh, {})).toBe(
            swizzle.output.getColorTexture(0)
        );
    });

    it('records source -> A -> B -> C with the third effect drawn directly to the surface', () => {
        const factory = {
            createRenderTarget(parameters: RenderTargetParameters): RenderTarget {
                return new FakeRenderTarget(
                    parameters.width,
                    parameters.height,
                    parameters.sampleCount ?? 1,
                    parameters.colorAttachments?.length ?? 1,
                    parameters.label ?? 'unnamed target'
                );
            }
        };
        const source = sourceTarget();
        const workload = createMRTMSAAPostProcessWorkload(factory, source, 1280, 720);
        const sourceStage = new Node() as RendererScene;
        const camera = new PerspectiveCamera();
        const renderCalls: {
            readonly target: RenderTarget;
            readonly stage: RendererScene;
            readonly camera: PerspectiveCamera;
            readonly fireEvent: boolean | undefined;
        }[] = [];
        const surfaceCalls: {
            readonly stage: RendererScene;
            readonly camera: PerspectiveCamera;
            readonly fireEvent: boolean | undefined;
        }[] = [];
        const frame: Pick<RendererFrame, 'render' | 'renderToTarget'> = {
            render(stage, passCamera, fireEvent) {
                surfaceCalls.push({
                    stage,
                    camera: passCamera as PerspectiveCamera,
                    fireEvent
                });
            },
            renderToTarget(target, stage, passCamera, fireEvent) {
                renderCalls.push({
                    target,
                    stage,
                    camera: passCamera as PerspectiveCamera,
                    fireEvent
                });
            }
        };

        recordMRTMSAAPostProcessWorkload(frame, workload, sourceStage, camera);

        expect(renderCalls.map(call => call.target)).toEqual([
            source,
            workload.passes[0].output,
            workload.passes[1].output
        ]);
        expect(renderCalls.map(call => call.stage)).toEqual([
            sourceStage,
            workload.passes[0].stage,
            workload.passes[1].stage
        ]);
        expect(renderCalls.every(call => call.camera === camera && call.fireEvent === false)).toBe(
            true
        );
        expect(surfaceCalls).toEqual([
            { stage: workload.passes[2].stage, camera, fireEvent: false }
        ]);

        const primaryDraws = mrtMSAAPostProcessPrimaryDrawCount(256);
        expect(primaryDraws).toBe(253);
        expect(primaryDraws + workload.passes.length).toBe(256);
    });

    it('compiles WebGL2 artifacts and prepares every effect for WebGPU translation', () => {
        const fragments = [
            {
                source: MRT_MSAA_POSTPROCESS_COMBINE_FRAGMENT_SOURCE,
                samplers: ['u_mrt0', 'u_mrt1', 'u_mrt2', 'u_mrt3']
            },
            {
                source: MRT_MSAA_POSTPROCESS_SWIZZLE_FRAGMENT_SOURCE,
                samplers: ['u_source']
            },
            {
                source: MRT_MSAA_POSTPROCESS_FINAL_FRAGMENT_SOURCE,
                samplers: ['u_source']
            }
        ] as const;

        const compiler = new ShaderArtifactCompiler();
        for (const fragment of fragments) {
            const shader = {
                vs: MRT_MSAA_POSTPROCESS_VERTEX_SOURCE,
                fs: fragment.source
            } as Shader;
            const webgl2 = compiler.compile(shader, 'webgl2');
            expect(webgl2.metadata.fragmentOutputs).toEqual([
                { name: 'color', type: 'vec4', location: 0 }
            ]);
            expect(webgl2.metadata.samplers.map(binding => binding.name)).toEqual(
                fragment.samplers
            );

            const webgpu = prepareGLSLForNaga(shader.vs, shader.fs);
            expect(webgpu.fragmentOutputs).toEqual([{ name: 'color', type: 'vec4', location: 0 }]);
            expect(webgpu.samplers.map(binding => binding.name)).toEqual(fragment.samplers);
        }
    });
});

describe('RHI production shadow draw contract', () => {
    it.each([
        { id: 'pbr-lights-shadows', total: 512, postProcess: 0, variants: 8 },
        { id: 'first-complex-frame', total: 512, postProcess: 3, variants: 64 },
        { id: 'scene-churn-10000-frame', total: 256, postProcess: 0, variants: 16 }
    ])('keeps exactly one caster while using every material variant in $id', scenario => {
        const primary = benchmarkPrimaryDrawCount(scenario.total, scenario.postProcess, 1);
        const materialIndices = Array.from({ length: primary }, (_, drawIndex) =>
            benchmarkMaterialIndex(drawIndex, scenario.variants, true)
        );
        const casterCount = Array.from({ length: primary }, (_, drawIndex) =>
            benchmarkMeshCastsShadow(drawIndex, true)
        ).filter(Boolean).length;

        expect(materialIndices[0]).toBe(0);
        expect(materialIndices.slice(1)).not.toContain(0);
        expect(new Set(materialIndices).size).toBe(scenario.variants);
        expect(casterCount).toBe(1);
        expect(primary + casterCount + scenario.postProcess).toBe(scenario.total);
    });

    it('keeps the sole scene-churn caster in stable slot zero across replacements', () => {
        const casterSlots = Array.from({ length: 255 }, (_, slot) =>
            benchmarkMeshCastsShadow(slot, true)
        );
        expect(casterSlots.filter(Boolean)).toHaveLength(1);

        for (let frame = 0; frame < 510; frame += 1) {
            const slot = frame % casterSlots.length;
            casterSlots[slot] = benchmarkMeshCastsShadow(slot, true);
            expect(casterSlots.filter(Boolean)).toHaveLength(1);
        }
    });

    it('gives each churn slot a stable depth so render-list sorting cannot change the pixels', () => {
        const initialDepths = Array.from({ length: 255 }, (_, slot) =>
            benchmarkMeshDepth(slot, true)
        );
        expect(initialDepths[0]).toBe(0);
        expect(initialDepths.every((depth, slot) => depth === -slot * 0.002)).toBe(true);
        expect(new Set(initialDepths)).toHaveLength(initialDepths.length);

        for (let frame = 0; frame < 510; frame += 1) {
            const slot = frame % initialDepths.length;
            expect(benchmarkMeshDepth(slot, true)).toBe(initialDepths[slot]);
        }
        expect(benchmarkMeshDepth(254, false)).toBe(0);
    });
});

describe('RHI production in-flight frame contract', () => {
    it('settles every fixed three-frame batch and rejects an overrun', () => {
        expect(RHI_PRODUCTION_MAX_IN_FLIGHT_FRAMES).toBe(3);
        expect([0, 1, 2, 3].map(benchmarkInFlightBatchIsFull)).toEqual([false, false, false, true]);
        expect(() => benchmarkInFlightBatchIsFull(4)).toThrow(/exceeded its fixed limit/u);
    });

    it('keeps sample-frame completion waits outside the renderer timing window', async () => {
        const repositoryRoot = resolve(new URL('../..', import.meta.url).pathname);
        const source = await readFile(
            resolve(repositoryRoot, 'test/performance/fixtures/rhi-production.ts'),
            'utf8'
        );
        const methodStart = source.indexOf('    async sampleTimingFrames(');
        const methodEnd = source.indexOf('    async sampleGpuFrames(', methodStart);
        const method = source.slice(methodStart, methodEnd);
        const measureStart = method.indexOf('this.#probe.measureRenderer(() => {');
        const measureEnd = method.indexOf('            });', measureStart);
        const batchWait = method.indexOf('await this.#renderer.waitForIdle();');

        expect(methodStart).toBeGreaterThanOrEqual(0);
        expect(methodEnd).toBeGreaterThan(methodStart);
        expect(measureStart).toBeGreaterThanOrEqual(0);
        expect(measureEnd).toBeGreaterThan(measureStart);
        expect(batchWait).toBeGreaterThan(measureEnd);
        expect(method.slice(measureStart, measureEnd)).not.toContain('waitForIdle');
        expect(method).toContain('benchmarkInFlightBatchIsFull(inFlightFrames)');
    });

    it('suspends timing wrappers for the whole allocation phase and excludes workload mutation', async () => {
        const repositoryRoot = resolve(new URL('../..', import.meta.url).pathname);
        const source = await readFile(
            resolve(repositoryRoot, 'test/performance/fixtures/rhi-production.ts'),
            'utf8'
        );
        const beginStart = source.indexOf('    beginAllocationSampling(): void {');
        const renderStart = source.indexOf('    renderAllocationFrame(): void {', beginStart);
        const settleStart = source.indexOf('    async settleAllocationFrame()', renderStart);
        const endStart = source.indexOf('    endAllocationSampling(): void {', settleStart);
        const endEnd = source.indexOf('    async completeRound()', endStart);
        const begin = source.slice(beginStart, renderStart);
        const render = source.slice(renderStart, settleStart);
        const end = source.slice(endStart, endEnd);

        expect(beginStart).toBeGreaterThanOrEqual(0);
        expect(renderStart).toBeGreaterThan(beginStart);
        expect(settleStart).toBeGreaterThan(renderStart);
        expect(endStart).toBeGreaterThan(settleStart);
        expect(endEnd).toBeGreaterThan(endStart);
        expect(begin).toContain('this.#probe.suspend();');
        expect(begin).not.toContain('this.#probe.resume();');
        expect(render.indexOf('this.updateScenario();')).toBeLessThan(
            render.indexOf('this.renderAllocationRendererBoundary();')
        );
        expect(render).not.toContain('this.renderFrame();');
        expect(render).not.toContain('this.#probe.');
        expect(end).toContain('this.#probe.resume();');
    });
});

describe('RHI production fixture smoke contract', () => {
    it('uses fixed profiler warm-up and maximum/median allocation aggregation', () => {
        expect(RHI_PRODUCTION_SMOKE_WARMUP_FRAMES).toBe(30);
        expect(RHI_PRODUCTION_SMOKE_DISCARDED_ALLOCATION_PROFILES).toBe(0);
        expect(RHI_PRODUCTION_SMOKE_POST_SUSPEND_WARMUP_FRAMES).toBe(30);
        expect(RHI_PRODUCTION_SMOKE_PROFILER_WARMUP_FRAMES).toBe(288);
        expect(rhiBenchmarkAllocationProfilerWarmupFrames(512)).toBe(288);
        expect(rhiBenchmarkAllocationProfilerWarmupFrames(256)).toBe(288);
        expect(rhiBenchmarkAllocationProfilerWarmupFrames(1_000)).toBe(288);
        expect(rhiBenchmarkAllocationProfilerWarmupFrames(10_000)).toBe(288);
        expect(rhiBenchmarkAllocationProfilerWarmupFrames(79)).toBe(288);
        expect(() => rhiBenchmarkAllocationProfilerWarmupFrames(0)).toThrow(/positive/u);
        expect(RHI_PRODUCTION_SMOKE_PROFILER_RESTART_RENDER_FRAMES).toBe(1);
        expect(RHI_PRODUCTION_SMOKE_PROFILER_RESTART_NOOP_TASKS).toBe(32);
        expect(RHI_PRODUCTION_SMOKE_PROFILE_MEASURED_CHUNK_FRAMES).toBe(7);
        expect(RHI_PRODUCTION_SMOKE_PROFILER_QUIESCENCE_STABLE_FRAMES).toBe(5);
        expect(RHI_PRODUCTION_SMOKE_HOT_PATH_TODO_BUDGET_BYTES).toBe(16 * 1024);
        expect(RHI_PRODUCTION_SMOKE_PROFILER_QUIESCENCE_PROBE_FRAMES).toBe(21);
        expect(RHI_PRODUCTION_SMOKE_MEASURED_ALLOCATION_PROFILES).toBe(21);
        expect(RHI_PRODUCTION_SMOKE_SCENARIOS).toEqual([
            'pbr-lights-shadows',
            'mrt-msaa-postprocess',
            'dynamic-geometry-texture-upload',
            'scene-churn-10000-frame'
        ]);
        expect(
            summarizeRHIProductionSmokeAllocations([
                { rendererBytes: 90, rhiHotPathBytes: 0 },
                { rendererBytes: 30, rhiHotPathBytes: 4 },
                { rendererBytes: 50, rhiHotPathBytes: 2 }
            ])
        ).toEqual({
            rendererMedianBytes: 50,
            rhiHotPathMaximumBytes: 4,
            rendererMedianIndex: 2,
            hottestFrameIndex: 1
        });
        expect(() => summarizeRHIProductionSmokeAllocations([])).toThrow(/non-empty/u);
    });

    it('is explicitly non-evidence and cannot call artifact-producing pipeline stages', async () => {
        const repositoryRoot = resolve(new URL('../..', import.meta.url).pathname);
        const [source, packageSource] = await Promise.all([
            readFile(
                resolve(repositoryRoot, 'scripts/performance/smoke-rhi-production-fixture.ts'),
                'utf8'
            ),
            readFile(resolve(repositoryRoot, 'package.json'), 'utf8')
        ]);
        expect(source).toContain('NON-EVIDENCE');
        expect(source).toContain('No evidence artifact was written');
        expect(source).not.toContain('collectRHIProductionCapture');
        expect(source).not.toContain('freezeRHIBaseline');
        expect(source).not.toContain('writeFile');
        expect(packageSource).toContain(
            '"test:rhi-benchmark-smoke": "jiti scripts/performance/smoke-rhi-production-fixture.ts"'
        );
    });
});
