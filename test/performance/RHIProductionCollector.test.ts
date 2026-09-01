import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    rhiBenchmarkAllocationProfilerWarmupFrames,
    RHI_BENCHMARK_ALLOCATION_PROFILER_PROTOCOL,
    RHI_BENCHMARK_ALLOCATION_PROFILE_MEASURED_CHUNK_FRAMES,
    RHI_BENCHMARK_ALLOCATION_PROFILER_QUIESCENCE_PROBE_FRAMES,
    RHI_BENCHMARK_ALLOCATION_PROFILER_RESTART_NOOP_TASKS,
    RHI_BENCHMARK_ALLOCATION_PROFILER_RESTART_RENDER_FRAMES,
    RHI_BENCHMARK_ALLOCATION_PROFILER_WARMUP_FRAMES,
    RHI_BENCHMARK_FIXTURE_PROTOCOL_VERSION,
    type RHIBenchmarkFixtureFrameSample,
    type RHIBenchmarkFixtureMetadata,
    type RHIBenchmarkFixtureRoundResult
} from '../../benchmarks/rhi/fixture-contract';
import {
    RHI_BENCHMARK_ALLOCATION_SAMPLE_FRAMES,
    RHI_BENCHMARK_RHI_HOT_PATH_ALLOCATION_TODO_BUDGET_BYTES,
    type RHIBenchmarkEnvironment,
    type RHIBenchmarkManifest
} from '../../benchmarks/rhi/result-schema';
import type { RHIPhase0PreflightResult } from '../../scripts/performance/rhi-phase0-preflight';
import {
    assembleRHIArchitectureMetrics,
    collectRHIProductionCapture,
    type RHIBenchmarkAllocationSample,
    type RHIProductionCollectorSession,
    type RHIProductionCollectorSessionFactory,
    type RHIProductionCollectorSessionRequest
} from '../../scripts/performance/rhi-production-collector';
import {
    assertRHIAllocationQuiescence,
    assertRHIProductionAllocationSampleFrames,
    classifyRHIAllocationProfile,
    detectedRHIBrowserGpuIdentity,
    diagnoseRHIAllocationProfile,
    diagnoseRHIRendererAllocationProfile,
    profileRHISynchronousAllocationFrames,
    RHI_ALLOCATION_PROFILE_MARKER_SLOTS,
    splitRHISynchronousAllocationProfile
} from '../../scripts/performance/rhi-playwright-collector';
import {
    compactRHIHeapProfilerStopResponse,
    isRHIHeapProfilerProfileHeadByteLengthWithinLimit,
    RHI_STREAMING_HEAP_PROFILER_MAX_PROFILE_HEAD_BYTES
} from '../../scripts/performance/rhi-streaming-heap-profiler';
import {
    parseRHIBenchmarkManifest,
    rhiBenchmarkEnvironmentFingerprint
} from '../../scripts/performance/verify-rhi-baseline';

const repositoryManifest = parseRHIBenchmarkManifest(
    JSON.parse(
        readFileSync(new URL('../../benchmarks/rhi/manifest.json', import.meta.url), 'utf8')
    ) as unknown
);

function frame(drawCount = 1): RHIBenchmarkFixtureFrameSample {
    return {
        timing: {
            frameBuildCpuMs: 1,
            graphCompileCpuMs: 1,
            rhiCommandCpuMs: 1,
            rhiExecuteCpuMs: 1,
            rhiTotalCpuMs: 2,
            rendererCpuMs: 4
        },
        diagnostics: {
            rhiCommandCount: 1,
            actualDrawCount: drawCount,
            nativeStateCallCount: 1,
            pipelineCacheHitRate: 0.9,
            bindGroupCacheHitRate: 0.9,
            vaoCacheHitRate: 0.9,
            framebufferCacheHitRate: 0.9
        },
        heapUsedBytes: 1024
    };
}

function roundResult(): RHIBenchmarkFixtureRoundResult {
    return {
        heapHighWaterBytes: 2048,
        retainedHeapBytes: 1024,
        nativeCreateCounts: {
            nativeBufferCreateCount: 1,
            nativeTextureCreateCount: 1,
            nativePipelineCreateCount: 1,
            nativeBindGroupCreateCount: 1,
            nativeVaoCreateCount: 1,
            nativeProgramCreateCount: 1
        },
        firstComplexFrameCpuMs: 4,
        shaderFirstPrepareMs: 1,
        pipelineFirstPrepareMs: 1,
        pixelHashSha256: 'a'.repeat(64)
    };
}

function zeroAllocationSamples(
    count = RHI_BENCHMARK_ALLOCATION_SAMPLE_FRAMES
): readonly RHIBenchmarkAllocationSample[] {
    return Array.from({ length: count }, () => ({ rendererBytes: 0, rhiHotPathBytes: 0 }));
}

function environment(manifest: RHIBenchmarkManifest): RHIBenchmarkEnvironment {
    const identity: RHIBenchmarkEnvironment = {
        rigProfile: manifest.rig.profile,
        runnerTags: manifest.rig.requiredRunnerTags,
        fingerprintSha256: '',
        osPlatform: 'darwin',
        osRelease: '25.2.0-collector',
        cpuModel: 'collector CPU',
        gpuFingerprint: 'collector GPU',
        gpuDriver: 'collector driver',
        browserName: 'chromium',
        browserVersion: '142.0.0.0',
        browserExecutableSha256: '1'.repeat(64),
        playwrightVersion: manifest.rig.playwrightVersion,
        nodeVersion: manifest.rig.nodeVersion,
        powerProfile: manifest.rig.powerProfile,
        fallbackAdapter: false,
        gpuTimerAvailable: true,
        allocationProfilerAvailable: true,
        preciseMemoryAvailable: true
    };
    return { ...identity, fingerprintSha256: rhiBenchmarkEnvironmentFingerprint(identity) };
}

interface SyntheticProfileNode {
    readonly callFrame: { readonly functionName: string; readonly url: string };
    readonly selfSize: number;
    readonly children?: readonly SyntheticProfileNode[];
}

function profileNode(
    url: string,
    functionName: string,
    selfSize: number,
    children?: readonly SyntheticProfileNode[]
): SyntheticProfileNode {
    return {
        callFrame: { functionName, url },
        selfSize,
        ...(children === undefined ? {} : { children })
    };
}

function allocationProfile(head: SyntheticProfileNode): unknown {
    return { profile: { head } };
}

interface SyntheticSamplingNode extends SyntheticProfileNode {
    readonly id: number;
    readonly children: readonly SyntheticSamplingNode[];
}

interface SyntheticSamplingSample {
    readonly size: number;
    readonly nodeId: number;
    readonly ordinal: number;
}

function samplingNode(
    id: number,
    url: string,
    functionName: string,
    children: readonly SyntheticSamplingNode[] = [],
    selfSize = 0
): SyntheticSamplingNode {
    return { id, callFrame: { functionName, url }, selfSize, children };
}

function samplingProfile(
    head: SyntheticSamplingNode,
    samples: readonly SyntheticSamplingSample[]
): unknown {
    return { profile: { head, samples } };
}

function markedSamplingTree(
    applicationChildren: readonly SyntheticSamplingNode[] = []
): SyntheticSamplingNode {
    return samplingNode(1, '', '(root)', [
        samplingNode(2, '', 'markRHIAllocationFrameStart'),
        samplingNode(
            3,
            '/test/performance/fixtures/rhi-production.ts',
            'BrowserBenchmarkFixture.renderAllocationRendererBoundary',
            applicationChildren
        ),
        samplingNode(4, '', 'markRHIAllocationFrameEnd')
    ]);
}

function rawSamplingResponse(
    id: number,
    head: SyntheticSamplingNode,
    samplesJson: string,
    sessionId?: string
): Buffer {
    return Buffer.from(
        `{"id":${String(id)},"result":{"profile":{"head":${JSON.stringify(head)},"samples":${samplesJson}}}${sessionId === undefined ? '' : `,"sessionId":${JSON.stringify(sessionId)}`}}`,
        'utf8'
    );
}

function synchronousAllocationFrame(
    children: readonly SyntheticProfileNode[]
): SyntheticProfileNode {
    return profileNode(
        '/test/performance/fixtures/rhi-production.ts',
        'BrowserBenchmarkFixture.renderAllocationRendererBoundary',
        0,
        children
    );
}

class FakeSession implements RHIProductionCollectorSession {
    closed = false;

    constructor(
        readonly metadata: RHIBenchmarkFixtureMetadata,
        readonly sampleCount: number,
        readonly drawCount: number
    ) {}

    warmup(): Promise<void> {
        return Promise.resolve();
    }

    sampleTimingFrames(): Promise<readonly RHIBenchmarkFixtureFrameSample[]> {
        return Promise.resolve(
            Array.from({ length: this.sampleCount }, () => frame(this.drawCount))
        );
    }

    sampleGpuFrames(): Promise<readonly number[]> {
        return Promise.resolve(Array<number>(this.sampleCount).fill(1));
    }

    sampleAllocationFrames(frameCount: number): Promise<readonly RHIBenchmarkAllocationSample[]> {
        return Promise.resolve(
            Array.from({ length: frameCount }, () => ({
                rendererBytes: 0,
                rhiHotPathBytes: 0
            }))
        );
    }

    finishRound(): Promise<RHIBenchmarkFixtureRoundResult> {
        return Promise.resolve(roundResult());
    }

    close(): Promise<void> {
        this.closed = true;
        return Promise.resolve();
    }
}

class FakeFactory implements RHIProductionCollectorSessionFactory {
    readonly requests: RHIProductionCollectorSessionRequest[] = [];
    readonly sessions: FakeSession[] = [];
    closed = false;

    constructor(readonly manifest: RHIBenchmarkManifest) {}

    open(request: RHIProductionCollectorSessionRequest): Promise<RHIProductionCollectorSession> {
        this.requests.push(request);
        const session = new FakeSession(
            {
                protocolVersion: RHI_BENCHMARK_FIXTURE_PROTOCOL_VERSION,
                isolationId: `isolation-${String(this.requests.length)}`,
                architecture: request.architecture,
                backend: request.backend,
                scenarioId: request.scenario.id,
                quality: request.scenario.quality,
                capabilities: {
                    cpuSegments: 'instrumented-production-method-boundaries-v1',
                    highResolutionClock: 'cross-origin-isolated-performance-now-v1',
                    gpuTimer: 'ext-disjoint-timer-query-webgl2',
                    allocationProfiler: RHI_BENCHMARK_ALLOCATION_PROFILER_PROTOCOL,
                    preciseMemory: 'chromium-precise-memory-v1',
                    nativeCounters: 'renderer-diagnostics-v1'
                }
            },
            this.manifest.sampling.sampleFrames,
            request.scenario.quality.drawCount
        );
        this.sessions.push(session);
        return Promise.resolve(session);
    }

    close(): Promise<void> {
        this.closed = true;
        return Promise.resolve();
    }
}

describe('RHI production collector', () => {
    it('proves marked allocation quiescence with one fixed probe and a terminal TODO budget', () => {
        expect(() => {
            assertRHIAllocationQuiescence([
                ...Array<number>(16).fill(7),
                RHI_BENCHMARK_RHI_HOT_PATH_ALLOCATION_TODO_BUDGET_BYTES,
                0,
                0,
                0,
                0
            ]);
        }).not.toThrow();
        expect(() => {
            assertRHIAllocationQuiescence(Array<number>(20).fill(0));
        }).toThrow(/exactly 21 frames/u);
        expect(() => {
            assertRHIAllocationQuiescence([...Array<number>(20).fill(0), -1]);
        }).toThrow(/invalid hot bytes/u);
        expect(() => {
            assertRHIAllocationQuiescence([
                ...Array<number>(16).fill(0),
                RHI_BENCHMARK_RHI_HOT_PATH_ALLOCATION_TODO_BUDGET_BYTES + 1,
                0,
                0,
                0,
                0
            ]);
        }).toThrow(/temporary 16384-byte hot-path TODO budget/u);
    });

    it('rejects a non-21 formal allocation request before profiler collection', () => {
        expect(() => {
            assertRHIProductionAllocationSampleFrames(2000);
        }).toThrow(RangeError);
        expect(() => {
            assertRHIProductionAllocationSampleFrames(2000);
        }).toThrow(/allocation frame count must remain frozen at 21/u);
        expect(() => {
            assertRHIProductionAllocationSampleFrames(RHI_BENCHMARK_ALLOCATION_SAMPLE_FRAMES);
        }).not.toThrow();
    });

    it('classifies Chromium software adapters as forbidden fallback devices', () => {
        const gpu = detectedRHIBrowserGpuIdentity({
            gpu: {
                devices: [
                    {
                        vendorString: 'Microsoft',
                        deviceString: 'Microsoft Basic Render Driver',
                        driverVendor: 'Microsoft',
                        driverVersion: '1.0'
                    }
                ]
            }
        });
        expect(gpu.fallback).toBe(true);
        expect(gpu.driver).toBe('Microsoft:1.0');
    });

    it('counts complete synchronous renderer bytes but only command/draw execution as hot', () => {
        const backend = '/src/render/rhi/backends/webgpu/WebGPUCommands.ts';
        const pass = '/src/render/rhi/backends/webgpu/WebGPURenderPass.ts';
        const core = '/src/render/rhi/core/RHIValidation.ts';
        const profile = allocationProfile(
            profileNode('', '(root)', 0, [
                synchronousAllocationFrame([
                    profileNode('/src/render/RendererCore.ts', 'render', 10, [
                        profileNode('/src/render/graph/RenderGraphExecutor.ts', 'execute', 11, [
                            profileNode(backend, 'WebGPUQueue.beginFrame', 13, [
                                profileNode('', 'createCommandEncoder', 17)
                            ]),
                            profileNode(
                                '/src/render/renderer/passes/SharedDrawPass.ts',
                                'SharedDrawPassParameters.execute',
                                19,
                                [
                                    profileNode(
                                        backend,
                                        'WebGPUCommandContext.beginRenderPass',
                                        23,
                                        [profileNode('', 'nativeBeginRenderPass', 29)]
                                    ),
                                    profileNode(core, 'allocationInsideSharedDrawExecution', 31),
                                    profileNode(
                                        '/src/render/renderer/PreparedDraw.ts',
                                        'PreparedDraw.execute',
                                        37,
                                        [
                                            profileNode(pass, 'WebGPURenderPass.draw', 41, [
                                                profileNode('', 'nativeDrawHelper', 43)
                                            ])
                                        ]
                                    ),
                                    profileNode(pass, 'WebGPURenderPass.end', 47, [
                                        profileNode('', 'nativePassFinalization', 53)
                                    ])
                                ]
                            ),
                            profileNode(backend, 'WebGPUQueue.endFrame', 59, [
                                profileNode('', 'nativeEncoderFinish', 61)
                            ])
                        ]),
                        profileNode(backend, 'WebGPUCommandContext.copyBufferToBuffer', 73, [
                            profileNode(core, 'validateRHICopyBufferToBuffer', 79)
                        ]),
                        profileNode(backend, 'WebGPUDevice.createBuffer', 83)
                    ])
                ]),
                profileNode(backend, 'releaseSubmissionReferences', 67, [
                    profileNode(core, 'completionHelper', 71)
                ])
            ])
        );

        expect(classifyRHIAllocationProfile(profile)).toEqual({
            rendererBytes: 729,
            rhiHotPathBytes: 323
        });
    });

    it('does not turn broad executor, resource, or lifecycle stacks into hot allocations', () => {
        const backend = '/src/render/rhi/backends/webgpu/WebGPUQueue.ts';
        const profile = allocationProfile(
            profileNode('', '(root)', 0, [
                synchronousAllocationFrame([
                    profileNode('/src/render/graph/RenderGraphExecutor.ts', 'execute', 3, [
                        profileNode(backend, 'WebGPUQueue.beginFrame', 5, [
                            profileNode('', 'createCommandEncoder', 7)
                        ]),
                        profileNode(backend, 'WebGPUQueue.endFrame', 11, [
                            profileNode('', 'finish', 13)
                        ]),
                        profileNode(
                            '/src/render/rhi/backends/webgpu/WebGPUResources.ts',
                            'WebGPUDevice.createBuffer',
                            17
                        )
                    ])
                ])
            ])
        );

        expect(classifyRHIAllocationProfile(profile)).toEqual({
            rendererBytes: 56,
            rhiHotPathBytes: 0
        });
    });

    it('propagates a real execute boundary through differently named helper/native leaves', () => {
        const profile = allocationProfile(
            profileNode('', '(root)', 0, [
                synchronousAllocationFrame([
                    profileNode(
                        '/src/render/renderer/passes/SharedDrawPass.ts',
                        'SharedDrawPassParameters.execute',
                        2,
                        [
                            profileNode(
                                '/src/render/rhi/core/RHIValidation.ts',
                                'validateDraw',
                                3,
                                [profileNode('', 'anonymousNativeHelper', 5)]
                            )
                        ]
                    )
                ])
            ])
        );

        expect(classifyRHIAllocationProfile(profile)).toEqual({
            rendererBytes: 10,
            rhiHotPathBytes: 10
        });
    });

    it('classifies stable-record viewport commands with the same hot-path scope', () => {
        const pass = '/src/render/rhi/backends/webgl2/WebGL2Commands.ts';
        const profile = allocationProfile(
            profileNode('', '(root)', 0, [
                synchronousAllocationFrame([
                    profileNode(pass, 'WebGL2RenderPass.setViewportRecord', 11),
                    profileNode(pass, 'WebGL2RenderPass.setScissorRectRecord', 13)
                ])
            ])
        );

        expect(classifyRHIAllocationProfile(profile)).toEqual({
            rendererBytes: 24,
            rhiHotPathBytes: 24
        });
    });

    it('classifies stable-record buffer and draw commands with the same hot-path scope', () => {
        const pass = '/src/render/rhi/backends/webgl2/WebGL2Commands.ts';
        const profile = allocationProfile(
            profileNode('', '(root)', 0, [
                synchronousAllocationFrame([
                    profileNode(pass, 'WebGL2RenderPass.setVertexBufferRecord', 3),
                    profileNode(pass, 'WebGL2RenderPass.setIndexBufferRecord', 5),
                    profileNode(pass, 'WebGL2RenderPass.drawRecord', 7),
                    profileNode(pass, 'WebGL2RenderPass.drawIndexedRecord', 11)
                ])
            ])
        );

        expect(classifyRHIAllocationProfile(profile)).toEqual({
            rendererBytes: 26,
            rhiHotPathBytes: 26
        });
    });

    it('ignores hot-looking asynchronous siblings outside the synchronous fixture root', () => {
        const preparedDraw = '/src/render/renderer/PreparedDraw.ts';
        const backend = '/src/render/rhi/backends/webgpu/WebGPURenderPass.ts';
        const profile = allocationProfile(
            profileNode('', '(root)', 0, [
                synchronousAllocationFrame([
                    profileNode(preparedDraw, 'PreparedDraw.execute', 2, [
                        profileNode('', 'nativeDrawInsideFrame', 3)
                    ])
                ]),
                profileNode(preparedDraw, 'PreparedDraw.execute', 5, [
                    profileNode('', 'asynchronousPreparedDrawHelper', 7)
                ]),
                profileNode(backend, 'WebGPURenderPass.draw', 11, [
                    profileNode('', 'asynchronousNativeDraw', 13)
                ])
            ])
        );

        expect(classifyRHIAllocationProfile(profile)).toEqual({
            rendererBytes: 5,
            rhiHotPathBytes: 5
        });
    });

    it('reconstructs sorted per-frame samples with exact classifier and diagnostic parity', () => {
        const prepared = samplingNode(
            5,
            '/src/render/renderer/PreparedDraw.ts',
            'PreparedDraw.execute'
        );
        const renderer = samplingNode(6, '/src/render/RendererCore.ts', 'RendererCore.render');
        const head = markedSamplingTree([prepared, renderer]);
        const frames = splitRHISynchronousAllocationProfile(
            samplingProfile(head, [
                { nodeId: 4, size: 4096, ordinal: 15 },
                { nodeId: 6, size: 11, ordinal: 14 },
                { nodeId: 2, size: 4096, ordinal: 13 },
                { nodeId: 4, size: 4096, ordinal: 12 },
                { nodeId: 5, size: 7, ordinal: 11 },
                { nodeId: 2, size: 4096, ordinal: 10 }
            ]),
            2,
            true
        );
        expect(frames.map(profiledFrame => profiledFrame.sample)).toEqual([
            { rendererBytes: 7, rhiHotPathBytes: 7 },
            { rendererBytes: 11, rhiHotPathBytes: 0 }
        ]);

        const individual = allocationProfile(
            profileNode('', '(root)', 0, [
                synchronousAllocationFrame([
                    profileNode('/src/render/renderer/PreparedDraw.ts', 'PreparedDraw.execute', 7),
                    profileNode('/src/render/RendererCore.ts', 'RendererCore.render', 0)
                ])
            ])
        );
        expect(frames[0]?.sample).toEqual(classifyRHIAllocationProfile(individual));
        expect(frames[0]?.hotFrames).toEqual(diagnoseRHIAllocationProfile(individual));
        expect(frames[0]?.rendererFrames).toEqual(diagnoseRHIRendererAllocationProfile(individual));
    });

    it('reports the complete synchronous ancestry for allocation diagnostics', () => {
        const profile = allocationProfile(
            profileNode('', '(root)', 0, [
                synchronousAllocationFrame([
                    profileNode('/src/render/renderer/PreparedDraw.ts', 'PreparedDraw.execute', 0, [
                        profileNode('', 'set', 2000)
                    ])
                ])
            ])
        );

        const diagnostics = diagnoseRHIAllocationProfile(profile);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]?.bytes).toBe(2000);
        expect(diagnostics[0]?.frame).toMatch(
            /renderAllocationRendererBoundary.*PreparedDraw\.ts.*:: execute.*<anonymous>.*:: set/u
        );
    });

    it('keeps zero frames and attributes a canary allocation only to its marked frame', () => {
        const prepared = samplingNode(
            5,
            '/src/render/renderer/PreparedDraw.ts',
            'PreparedDraw.execute'
        );
        const frames = splitRHISynchronousAllocationProfile(
            samplingProfile(markedSamplingTree([prepared]), [
                { nodeId: 2, size: 4096, ordinal: 1 },
                { nodeId: 4, size: 4096, ordinal: 2 },
                { nodeId: 2, size: 4096, ordinal: 3 },
                { nodeId: 5, size: 123, ordinal: 4 },
                { nodeId: 4, size: 4096, ordinal: 5 },
                { nodeId: 2, size: 4096, ordinal: 6 },
                { nodeId: 4, size: 4096, ordinal: 7 }
            ]),
            3
        );
        expect(frames.map(profiledFrame => profiledFrame.sample.rhiHotPathBytes)).toEqual([
            0, 123, 0
        ]);
    });

    it('compacts unordered raw CDP samples without changing marked-frame classification', () => {
        const prepared = samplingNode(
            5,
            '/src/render/renderer/PreparedDraw.ts',
            'PreparedDraw.execute'
        );
        const renderer = samplingNode(6, '/src/render/RendererCore.ts', 'RendererCore.render');
        const unmarked = samplingNode(7, '/src/render/UnmarkedWarmup.ts', 'warmup');
        const head = samplingNode(1, '', '(root)', [
            ...markedSamplingTree([prepared, renderer]).children.slice(0, 3),
            unmarked
        ]);
        const samples = [
            { nodeId: 4, size: 4096, ordinal: 9 },
            { nodeId: 7, size: 999, ordinal: 1 },
            { nodeId: 2, size: 4096, ordinal: 6 },
            { nodeId: 6, size: 11, ordinal: 8 },
            { nodeId: 4, size: 4096, ordinal: 5 },
            { nodeId: 5, size: 3, ordinal: 3 },
            { nodeId: 2, size: 4096, ordinal: 2 },
            { nodeId: 5, size: 4, ordinal: 4 },
            { nodeId: 7, size: 777, ordinal: 10 },
            { nodeId: 6, size: 13, ordinal: 7 }
        ];
        const raw = Buffer.from(
            JSON.stringify({ id: 41, result: { profile: { head, samples } } }),
            'utf8'
        );
        const compact = compactRHIHeapProfilerStopResponse(raw, {
            expectedId: 41,
            mode: 'marked'
        });
        const frames = splitRHISynchronousAllocationProfile(compact, 2, true);

        expect(frames.map(profiledFrame => profiledFrame.sample)).toEqual([
            { rendererBytes: 7, rhiHotPathBytes: 7 },
            { rendererBytes: 24, rhiHotPathBytes: 0 }
        ]);
        expect(frames[0]?.hotFrames[0]?.bytes).toBe(7);
        expect(frames[1]?.rendererFrames[0]?.bytes).toBe(24);
    });

    it('preserves global marked ordinals across the fixed 21/21 frame boundary', () => {
        const prepared = samplingNode(
            5,
            '/src/render/renderer/PreparedDraw.ts',
            'PreparedDraw.execute'
        );
        const head = markedSamplingTree([prepared]);
        const quiescenceFrameCount = RHI_BENCHMARK_ALLOCATION_PROFILER_QUIESCENCE_PROBE_FRAMES;
        const measuredFrameCount = RHI_BENCHMARK_ALLOCATION_SAMPLE_FRAMES;
        const totalFrameCount = quiescenceFrameCount + measuredFrameCount;
        const canaries = new Map<number, number>([
            [21, 21_021],
            [22, 22_022],
            [33, 33_033]
        ]);
        const chronological: SyntheticSamplingSample[] = [];
        let ordinal = 0;
        const sample = (nodeId: number, size: number): void => {
            chronological.push({ size, nodeId, ordinal: ++ordinal });
        };

        sample(5, 900_001);
        for (let globalFrame = 1; globalFrame <= totalFrameCount; globalFrame += 1) {
            sample(2, 4096);
            if (globalFrame === 22) sample(2, 8);
            const canary = canaries.get(globalFrame);
            if (canary !== undefined) sample(5, canary);
            sample(4, 4096);
            if (globalFrame === 22) sample(4, 8);
            if (globalFrame === 21) sample(5, 900_021);
        }
        sample(5, 900_042);

        const compact = compactRHIHeapProfilerStopResponse(
            rawSamplingResponse(
                49,
                head,
                JSON.stringify([...chronological].reverse()),
                'session-49'
            ),
            {
                expectedId: 49,
                mode: 'marked',
                expectedSessionId: 'session-49'
            }
        );
        const frames = splitRHISynchronousAllocationProfile(compact, totalFrameCount, true);
        const quiescence = frames.slice(0, quiescenceFrameCount);
        const measured = frames.slice(quiescenceFrameCount);
        const expectedHotBytes = Array<number>(totalFrameCount).fill(0);
        expectedHotBytes[20] = 21_021;
        expectedHotBytes[21] = 22_022;
        expectedHotBytes[32] = 33_033;

        expect(quiescence).toHaveLength(21);
        expect(measured).toHaveLength(21);
        expect(frames.map(profiledFrame => profiledFrame.sample.rhiHotPathBytes)).toEqual(
            expectedHotBytes
        );
        expect(frames.map(profiledFrame => profiledFrame.sample.rendererBytes)).toEqual(
            expectedHotBytes
        );
        expect(quiescence[20]?.sample.rhiHotPathBytes).toBe(21_021);
        expect(measured[0]?.sample.rhiHotPathBytes).toBe(22_022);
        expect(measured[11]?.sample.rhiHotPathBytes).toBe(33_033);
    });

    it('fails closed when a raw CDP sampling ordinal is missing', () => {
        const raw = Buffer.from(
            JSON.stringify({
                id: 42,
                result: {
                    profile: {
                        head: markedSamplingTree(),
                        samples: [
                            { nodeId: 2, size: 1, ordinal: 1 },
                            { nodeId: 4, size: 1, ordinal: 3 }
                        ]
                    }
                }
            }),
            'utf8'
        );

        expect(() =>
            compactRHIHeapProfilerStopResponse(raw, { expectedId: 42, mode: 'marked' })
        ).toThrow(/ordinals are not dense/u);
    });

    it('uses the explicit sampling mode and cross-rejects marked and discard profiles', () => {
        const marked = rawSamplingResponse(
            43,
            markedSamplingTree(),
            '[{"size":1,"nodeId":2,"ordinal":1},{"size":1,"nodeId":4,"ordinal":2}]'
        );
        const unmarkedHead = samplingNode(1, '', '(root)', [
            samplingNode(5, '/src/render/Warmup.ts', 'warmup')
        ]);
        const unmarked = rawSamplingResponse(
            44,
            unmarkedHead,
            '[{"size":1,"nodeId":5,"ordinal":7}]'
        );

        expect(() =>
            compactRHIHeapProfilerStopResponse(marked, { expectedId: 43, mode: 'discard' })
        ).toThrow(/discard sampling profile must not contain marker nodes/u);
        expect(() =>
            compactRHIHeapProfilerStopResponse(unmarked, { expectedId: 44, mode: 'marked' })
        ).toThrow(/marked sampling profile marker nodes are missing/u);
        expect(
            compactRHIHeapProfilerStopResponse(unmarked, {
                expectedId: 44,
                mode: 'discard'
            })
        ).toEqual({});
    });

    it('strictly validates direct and flattened target response envelopes', () => {
        const samples = '[{"size":1,"nodeId":2,"ordinal":1},{"size":1,"nodeId":4,"ordinal":2}]';
        const direct = rawSamplingResponse(47, markedSamplingTree(), samples);
        const flattened = rawSamplingResponse(47, markedSamplingTree(), samples, 'session-47');

        expect(
            compactRHIHeapProfilerStopResponse(direct, { expectedId: 47, mode: 'marked' })
        ).toHaveProperty('profile');
        expect(
            compactRHIHeapProfilerStopResponse(flattened, {
                expectedId: 47,
                mode: 'marked',
                expectedSessionId: 'session-47'
            })
        ).toHaveProperty('profile');
        expect(() =>
            compactRHIHeapProfilerStopResponse(flattened, {
                expectedId: 47,
                mode: 'marked',
                expectedSessionId: 'different-session'
            })
        ).toThrow(/session id differs from its request/u);
        expect(() =>
            compactRHIHeapProfilerStopResponse(flattened, { expectedId: 47, mode: 'marked' })
        ).toThrow(/response has unexpected fields/u);
        expect(() =>
            compactRHIHeapProfilerStopResponse(direct, {
                expectedId: 47,
                mode: 'marked',
                expectedSessionId: 'session-47'
            })
        ).toThrow(/requires its flattened session id/u);
    });

    it('parses only bounded, exact stopSampling error envelopes as whole strings', () => {
        const directError = Buffer.from(
            JSON.stringify({ id: 48, error: { code: -1, message: 'direct failure' } }),
            'utf8'
        );
        expect(() =>
            compactRHIHeapProfilerStopResponse(directError, {
                expectedId: 48,
                mode: 'discard'
            })
        ).toThrow(/direct failure/u);

        const flattenedError = Buffer.from(
            JSON.stringify({
                id: 48,
                error: { code: -1, message: 'flattened failure' },
                sessionId: 'session-48'
            }),
            'utf8'
        );
        expect(() =>
            compactRHIHeapProfilerStopResponse(flattenedError, {
                expectedId: 48,
                mode: 'marked',
                expectedSessionId: 'session-48'
            })
        ).toThrow(/flattened failure/u);
        expect(() =>
            compactRHIHeapProfilerStopResponse(flattenedError, {
                expectedId: 48,
                mode: 'marked'
            })
        ).toThrow(/error envelope is malformed/u);

        const oversizedError = Buffer.from(
            JSON.stringify({
                id: 48,
                error: { code: -1, message: 'x'.repeat(64 * 1024) }
            }),
            'utf8'
        );
        expect(() =>
            compactRHIHeapProfilerStopResponse(oversizedError, {
                expectedId: 48,
                mode: 'discard'
            })
        ).toThrow(/exceeds its small parsing bound/u);
    });

    it('enforces the profile-head byte bound without a boundary-sized fixture', () => {
        expect(
            isRHIHeapProfilerProfileHeadByteLengthWithinLimit(
                RHI_STREAMING_HEAP_PROFILER_MAX_PROFILE_HEAD_BYTES
            )
        ).toBe(true);
        expect(
            isRHIHeapProfilerProfileHeadByteLengthWithinLimit(
                RHI_STREAMING_HEAP_PROFILER_MAX_PROFILE_HEAD_BYTES + 1
            )
        ).toBe(false);
    });

    it('validates discard samples through EOF while allowing unique ordinal gaps', () => {
        const head = samplingNode(1, '', '(root)', [
            samplingNode(5, '/src/render/Warmup.ts', 'warmup')
        ]);
        const valid = rawSamplingResponse(
            45,
            head,
            '[{"ordinal":2,"size":1,"nodeId":5},{"nodeId":1,"ordinal":999,"size":2}]'
        );
        expect(
            compactRHIHeapProfilerStopResponse(valid, {
                expectedId: 45,
                mode: 'discard'
            })
        ).toEqual({});

        const duplicate = rawSamplingResponse(
            45,
            head,
            '[{"size":1,"nodeId":5,"ordinal":2},{"size":2,"nodeId":1,"ordinal":2}]'
        );
        expect(() =>
            compactRHIHeapProfilerStopResponse(duplicate, { expectedId: 45, mode: 'discard' })
        ).toThrow(/ordinal is duplicated/u);

        const unknownNode = rawSamplingResponse(45, head, '[{"size":1,"nodeId":99,"ordinal":8}]');
        expect(() =>
            compactRHIHeapProfilerStopResponse(unknownNode, {
                expectedId: 45,
                mode: 'discard'
            })
        ).toThrow(/unknown node id/u);

        const tail = Buffer.concat([valid, Buffer.from('x', 'ascii')]);
        expect(() =>
            compactRHIHeapProfilerStopResponse(tail, { expectedId: 45, mode: 'discard' })
        ).toThrow(/trailing data/u);
    });

    it('strictly rejects malformed sampling records and envelopes', () => {
        const head = markedSamplingTree();
        const malformedSamples = [
            {
                label: 'exponent integer',
                samples: '[{"size":1e2,"nodeId":2,"ordinal":1}]',
                message: /sample fields require a comma/u
            },
            {
                label: 'duplicate key',
                samples: '[{"size":1,"size":2,"nodeId":2,"ordinal":1}]',
                message: /sample size is duplicated/u
            },
            {
                label: 'missing key',
                samples: '[{"size":1,"nodeId":2}]',
                message: /sample keys are incomplete/u
            },
            {
                label: 'missing field comma',
                samples: '[{"size":1 "nodeId":2,"ordinal":1}]',
                message: /sample fields require a comma/u
            },
            {
                label: 'trailing field comma',
                samples: '[{"size":1,"nodeId":2,"ordinal":1,}]',
                message: /sample has a trailing comma/u
            },
            {
                label: 'missing sample comma',
                samples: '[{"size":1,"nodeId":2,"ordinal":1}{"size":1,"nodeId":4,"ordinal":2}]',
                message: /samples require a comma/u
            },
            {
                label: 'trailing sample comma',
                samples: '[{"size":1,"nodeId":2,"ordinal":1},]',
                message: /samples have a trailing comma/u
            },
            {
                label: 'unknown node',
                samples: '[{"size":1,"nodeId":99,"ordinal":1}]',
                message: /unknown node id/u
            },
            {
                label: 'duplicate ordinal',
                samples: '[{"size":1,"nodeId":2,"ordinal":1},{"size":1,"nodeId":4,"ordinal":1}]',
                message: /ordinal is duplicated/u
            },
            {
                label: 'ordinal gap',
                samples: '[{"size":1,"nodeId":2,"ordinal":1},{"size":1,"nodeId":4,"ordinal":3}]',
                message: /ordinals are not dense from one/u
            }
        ] as const;
        for (const malformed of malformedSamples) {
            expect(
                () =>
                    compactRHIHeapProfilerStopResponse(
                        rawSamplingResponse(46, head, malformed.samples),
                        { expectedId: 46, mode: 'marked' }
                    ),
                malformed.label
            ).toThrow(malformed.message);
        }

        const complete = rawSamplingResponse(
            46,
            head,
            '[{"size":1,"nodeId":2,"ordinal":1},{"size":1,"nodeId":4,"ordinal":2}]'
        );
        const truncated = complete.subarray(0, complete.length - 1);
        expect(() =>
            compactRHIHeapProfilerStopResponse(truncated, { expectedId: 46, mode: 'marked' })
        ).toThrow(/response has unexpected fields/u);
        const prefixedId = Buffer.from(
            `{"noise":"\\"id\\":46","id":46,"result":{"profile":{"head":${JSON.stringify(head)},"samples":[]}}}`,
            'utf8'
        );
        expect(() =>
            compactRHIHeapProfilerStopResponse(prefixedId, { expectedId: 46, mode: 'marked' })
        ).toThrow(/response key is unknown/u);
    });

    it('fails closed on malformed single-session markers, nodes, ordinals, and frame counts', () => {
        const validTree = markedSamplingTree();
        const validSamples = [
            { nodeId: 2, size: 4096, ordinal: 1 },
            { nodeId: 4, size: 4096, ordinal: 2 }
        ];
        expect(() =>
            splitRHISynchronousAllocationProfile(
                samplingProfile(samplingNode(1, '', '(root)'), validSamples),
                1
            )
        ).toThrow(/markers are missing/u);
        expect(() =>
            splitRHISynchronousAllocationProfile(
                samplingProfile(
                    samplingNode(1, '', '(root)', [
                        samplingNode(2, '', 'markRHIAllocationFrameStart'),
                        samplingNode(2, '', 'markRHIAllocationFrameEnd')
                    ]),
                    validSamples
                ),
                1
            )
        ).toThrow(/duplicate node id/u);
        expect(() =>
            splitRHISynchronousAllocationProfile(
                samplingProfile(validTree, [
                    { nodeId: 2, size: 4096, ordinal: 1 },
                    { nodeId: 4, size: 4096, ordinal: 1 }
                ]),
                1
            )
        ).toThrow(/ordinals must be strictly increasing/u);
        expect(() =>
            splitRHISynchronousAllocationProfile(
                samplingProfile(validTree, [{ nodeId: 99, size: 1, ordinal: 1 }, ...validSamples]),
                1
            )
        ).toThrow(/invalid sample/u);
        expect(() =>
            splitRHISynchronousAllocationProfile(
                samplingProfile(validTree, [
                    { nodeId: 4, size: 4096, ordinal: 1 },
                    { nodeId: 2, size: 4096, ordinal: 2 }
                ]),
                1
            )
        ).toThrow(/end without a start/u);
        expect(() =>
            splitRHISynchronousAllocationProfile(
                samplingProfile(validTree, [
                    { nodeId: 2, size: 4096, ordinal: 1 },
                    { nodeId: 3, size: 1, ordinal: 2 },
                    { nodeId: 2, size: 4096, ordinal: 3 },
                    { nodeId: 4, size: 4096, ordinal: 4 }
                ]),
                1
            )
        ).toThrow(/nested frame start/u);
        expect(() =>
            splitRHISynchronousAllocationProfile(samplingProfile(validTree, validSamples), 2)
        ).toThrow(/observed 1 frames; expected 2/u);
        expect(() =>
            splitRHISynchronousAllocationProfile(
                samplingProfile(
                    samplingNode(1, '', '(root)', [
                        samplingNode(2, '', 'markRHIAllocationFrameStart', [
                            samplingNode(3, '', 'markRHIAllocationFrameEnd')
                        ])
                    ]),
                    validSamples
                ),
                1
            )
        ).toThrow(/marker stacks overlap/u);
        expect(() =>
            splitRHISynchronousAllocationProfile(
                samplingProfile(
                    samplingNode(1, '', '(root)', [
                        samplingNode(2, '', 'markRHIAllocationFrameStart', [
                            samplingNode(
                                3,
                                '/test/performance/fixtures/rhi-production.ts',
                                'BrowserBenchmarkFixture.renderAllocationRendererBoundary'
                            )
                        ]),
                        samplingNode(4, '', 'markRHIAllocationFrameEnd')
                    ]),
                    validSamples
                ),
                1
            )
        ).toThrow(/marker overlaps the synchronous renderer boundary/u);
    });

    it('discards one GC tier-up session before three bounded retained-object windows', async () => {
        const events: string[] = [];
        const samplingRequests: unknown[] = [];
        const profiledFrameCount = RHI_BENCHMARK_ALLOCATION_SAMPLE_FRAMES;
        const quiescenceFrameCount = RHI_BENCHMARK_ALLOCATION_PROFILER_QUIESCENCE_PROBE_FRAMES;
        const measuredChunkFrames = RHI_BENCHMARK_ALLOCATION_PROFILE_MEASURED_CHUNK_FRAMES;
        const retainedWindowCount = profiledFrameCount / measuredChunkFrames;
        const discardedTierUpProfile = {
            profile: 'intentionally malformed: the tier-up profile must never be parsed'
        };
        const rendererNode = samplingNode(5, '/src/render/RendererCore.ts', 'RendererCore.render');
        const retainedProfiles = Array.from(
            { length: retainedWindowCount },
            (_windowValue, windowIndex) => {
                let ordinal = 0;
                return samplingProfile(
                    markedSamplingTree([rendererNode]),
                    Array.from(
                        { length: quiescenceFrameCount + measuredChunkFrames },
                        (_frameValue, frameIndex) => {
                            const samples: SyntheticSamplingSample[] = [
                                { nodeId: 2, size: 4096, ordinal: ++ordinal }
                            ];
                            if (frameIndex >= quiescenceFrameCount) {
                                samples.push({
                                    nodeId: 5,
                                    size:
                                        (windowIndex + 1) * 100 +
                                        frameIndex -
                                        quiescenceFrameCount +
                                        1,
                                    ordinal: ++ordinal
                                });
                            }
                            samples.push({ nodeId: 4, size: 4096, ordinal: ++ordinal });
                            return samples;
                        }
                    ).flat()
                );
            }
        );
        expect(() =>
            splitRHISynchronousAllocationProfile(discardedTierUpProfile, profiledFrameCount)
        ).toThrow(/sampling profile must be an object/u);
        let stopSamplingCalls = 0;
        const mockWindow = new Proxy(
            {
                __HILO3D_RHI_BENCHMARK__: {
                    get metadata(): { readonly quality: { readonly drawCount: number } } {
                        events.push('metadata');
                        return { quality: { drawCount: 1_000 } };
                    },
                    renderAllocationFrame(): void {
                        events.push('render');
                    },
                    settleAllocationFrame(): Promise<void> {
                        events.push('settle');
                        return Promise.resolve();
                    }
                }
            },
            {
                set(target, property, value): boolean {
                    if (property === '__HILO3D_RHI_ALLOCATION_MARKER__' && Array.isArray(value)) {
                        events.push(
                            value.length === RHI_ALLOCATION_PROFILE_MARKER_SLOTS
                                ? 'start-marker'
                                : 'end-marker'
                        );
                    }
                    return Reflect.set(target, property, value);
                },
                deleteProperty(target, property): boolean {
                    events.push('cleanup');
                    return Reflect.deleteProperty(target, property);
                }
            }
        );
        const hadWindow = Reflect.has(globalThis, 'window');
        const previousWindow = Reflect.get(globalThis, 'window');
        Reflect.set(globalThis, 'window', mockWindow);
        let pageEvaluateCalls = 0;
        const page = {
            evaluate<T, Argument>(callback: (argument: Argument) => T, argument?: Argument): T {
                pageEvaluateCalls += 1;
                return callback(argument as Argument);
            }
        } as unknown as Parameters<typeof profileRHISynchronousAllocationFrames>[0];
        const cdp = {
            send(method: string, parameters?: unknown): Promise<unknown> {
                events.push(method);
                if (method === 'HeapProfiler.startSampling') {
                    samplingRequests.push(parameters);
                }
                if (method === 'HeapProfiler.stopSampling') {
                    stopSamplingCalls += 1;
                    return Promise.resolve(
                        stopSamplingCalls === 1
                            ? discardedTierUpProfile
                            : retainedProfiles[stopSamplingCalls - 2]
                    );
                }
                return Promise.resolve({});
            }
        } as unknown as Parameters<typeof profileRHISynchronousAllocationFrames>[1];
        try {
            const profileWindow = await profileRHISynchronousAllocationFrames(
                page,
                cdp,
                profiledFrameCount
            );
            expect(profileWindow.quiescenceWindows).toHaveLength(retainedWindowCount);
            expect(
                profileWindow.quiescenceWindows.map(windowFrames => windowFrames.length)
            ).toEqual([21, 21, 21]);
            expect(
                profileWindow.quiescenceWindows.map(windowFrames =>
                    windowFrames.map(profiledFrame => profiledFrame.sample.rhiHotPathBytes)
                )
            ).toEqual(
                Array.from({ length: retainedWindowCount }, () =>
                    Array.from({ length: quiescenceFrameCount }, () => 0)
                )
            );
            expect(profileWindow.frames).toHaveLength(profiledFrameCount);
            expect(
                profileWindow.frames.map(allocationFrame => allocationFrame.sample.rendererBytes)
            ).toEqual([
                101, 102, 103, 104, 105, 106, 107, 201, 202, 203, 204, 205, 206, 207, 301, 302, 303,
                304, 305, 306, 307
            ]);
            expect(
                profileWindow.frames.map(allocationFrame => allocationFrame.sample.rhiHotPathBytes)
            ).toEqual(Array.from({ length: profiledFrameCount }, () => 0));
        } finally {
            if (!hadWindow) Reflect.deleteProperty(globalThis, 'window');
            else Reflect.set(globalThis, 'window', previousWindow);
        }
        const profilerWarmupFrames = rhiBenchmarkAllocationProfilerWarmupFrames(1_000);
        expect(RHI_BENCHMARK_ALLOCATION_PROFILER_WARMUP_FRAMES).toBe(288);
        expect(RHI_BENCHMARK_ALLOCATION_PROFILER_RESTART_RENDER_FRAMES).toBe(1);
        expect(RHI_BENCHMARK_ALLOCATION_PROFILER_RESTART_NOOP_TASKS).toBe(32);
        expect(RHI_BENCHMARK_ALLOCATION_PROFILE_MEASURED_CHUNK_FRAMES).toBe(7);
        expect(profilerWarmupFrames).toBe(288);
        expect(pageEvaluateCalls).toBe(
            2 +
                retainedWindowCount *
                    (RHI_BENCHMARK_ALLOCATION_PROFILER_RESTART_RENDER_FRAMES +
                        RHI_BENCHMARK_ALLOCATION_PROFILER_RESTART_NOOP_TASKS +
                        quiescenceFrameCount +
                        measuredChunkFrames +
                        1)
        );
        expect(events.filter(event => event === 'render')).toHaveLength(
            profilerWarmupFrames +
                retainedWindowCount *
                    (RHI_BENCHMARK_ALLOCATION_PROFILER_RESTART_RENDER_FRAMES +
                        quiescenceFrameCount +
                        measuredChunkFrames)
        );
        expect(events.filter(event => event === 'settle')).toHaveLength(
            profilerWarmupFrames +
                retainedWindowCount *
                    (RHI_BENCHMARK_ALLOCATION_PROFILER_RESTART_RENDER_FRAMES +
                        quiescenceFrameCount +
                        measuredChunkFrames)
        );
        expect(events.filter(event => event === 'start-marker')).toHaveLength(
            retainedWindowCount * (quiescenceFrameCount + measuredChunkFrames)
        );
        expect(events.filter(event => event === 'end-marker')).toHaveLength(
            retainedWindowCount * (quiescenceFrameCount + measuredChunkFrames)
        );
        expect(events.filter(event => event === 'metadata')).toHaveLength(
            1 + retainedWindowCount * RHI_BENCHMARK_ALLOCATION_PROFILER_RESTART_NOOP_TASKS
        );
        expect(events.filter(event => event === 'cleanup')).toHaveLength(retainedWindowCount);
        expect(events.filter(event => event === 'HeapProfiler.startSampling')).toHaveLength(4);
        expect(events.filter(event => event === 'HeapProfiler.stopSampling')).toHaveLength(4);
        expect(events.filter(event => event === 'HeapProfiler.collectGarbage')).toHaveLength(1);
        expect(events.filter(event => event === 'HeapProfiler.getSamplingProfile')).toHaveLength(0);
        expect(stopSamplingCalls).toBe(4);

        const firstStart = events.indexOf('HeapProfiler.startSampling');
        const collection = events.indexOf('HeapProfiler.collectGarbage');
        const firstStop = events.indexOf('HeapProfiler.stopSampling');
        const retainedStarts = events
            .map((event, index) => (event === 'HeapProfiler.startSampling' ? index : -1))
            .filter(index => index >= 0)
            .slice(1);
        expect(events.slice(firstStart + 1, collection)).toEqual(
            Array.from({ length: profilerWarmupFrames }, () => ['render', 'settle']).flat()
        );
        expect(events.slice(collection, (retainedStarts[0] ?? -1) + 1)).toEqual([
            'HeapProfiler.collectGarbage',
            'HeapProfiler.stopSampling',
            'HeapProfiler.startSampling'
        ]);
        expect(firstStop).toBe(collection + 1);
        for (const retainedStart of retainedStarts) {
            const firstMarker = events.indexOf('start-marker', retainedStart + 1);
            const retainedStop = events.indexOf('HeapProfiler.stopSampling', retainedStart + 1);
            expect(events.slice(retainedStart + 1, firstMarker)).toEqual([
                ...Array.from(
                    { length: RHI_BENCHMARK_ALLOCATION_PROFILER_RESTART_RENDER_FRAMES },
                    () => ['render', 'settle']
                ).flat(),
                ...Array.from(
                    { length: RHI_BENCHMARK_ALLOCATION_PROFILER_RESTART_NOOP_TASKS },
                    () => 'metadata'
                )
            ]);
            expect(events.slice(firstMarker, retainedStop)).toEqual(
                Array.from({ length: quiescenceFrameCount + measuredChunkFrames }, () => [
                    'start-marker',
                    'render',
                    'end-marker',
                    'settle'
                ]).flat()
            );
            expect(events[retainedStop + 1]).toBe('cleanup');
        }
        expect(samplingRequests).toEqual([
            {
                samplingInterval: 1,
                includeObjectsCollectedByMajorGC: false,
                includeObjectsCollectedByMinorGC: false
            },
            {
                samplingInterval: 1,
                includeObjectsCollectedByMajorGC: true,
                includeObjectsCollectedByMinorGC: true
            },
            {
                samplingInterval: 1,
                includeObjectsCollectedByMajorGC: true,
                includeObjectsCollectedByMinorGC: true
            },
            {
                samplingInterval: 1,
                includeObjectsCollectedByMajorGC: true,
                includeObjectsCollectedByMinorGC: true
            }
        ]);
        expect(events.slice(-2)).toEqual(['HeapProfiler.stopSampling', 'cleanup']);
    });

    it('assembles only complete, internally consistent measured metrics', () => {
        const metrics = assembleRHIArchitectureMetrics(
            [frame(), frame()],
            [1, 1],
            zeroAllocationSamples(),
            roundResult(),
            2,
            RHI_BENCHMARK_ALLOCATION_SAMPLE_FRAMES,
            1
        );
        expect(Object.keys(metrics)).toHaveLength(27);
        expect(metrics.rhiTotalCpuMs).toEqual([2, 2]);
        expect(metrics.nativePipelineCreateCount).toEqual([1]);
    });

    it('rejects unavailable cache counters, incomplete GPU samples, and invented RHI totals', () => {
        const unavailableFrame = frame();
        const unavailable = {
            ...unavailableFrame,
            diagnostics: {
                ...unavailableFrame.diagnostics,
                pipelineCacheHitRate: null
            }
        };
        expect(() =>
            assembleRHIArchitectureMetrics(
                [unavailable],
                [1],
                zeroAllocationSamples(),
                roundResult(),
                1,
                RHI_BENCHMARK_ALLOCATION_SAMPLE_FRAMES,
                1
            )
        ).toThrow(/pipelineCacheHitRate is not measurable/u);

        expect(() =>
            assembleRHIArchitectureMetrics(
                [frame()],
                [],
                zeroAllocationSamples(),
                roundResult(),
                1,
                RHI_BENCHMARK_ALLOCATION_SAMPLE_FRAMES,
                1
            )
        ).toThrow(/gpuSamples must contain exactly 1/u);

        const consistentFrame = frame();
        const inconsistent = {
            ...consistentFrame,
            timing: {
                ...consistentFrame.timing,
                rhiTotalCpuMs: 99
            }
        };
        expect(() =>
            assembleRHIArchitectureMetrics(
                [inconsistent],
                [1],
                zeroAllocationSamples(),
                roundResult(),
                1,
                RHI_BENCHMARK_ALLOCATION_SAMPLE_FRAMES,
                1
            )
        ).toThrow(/not command plus execute/u);
    });

    it('rejects any formal allocation vector that differs from its fixed sample count', () => {
        expect(() =>
            assembleRHIArchitectureMetrics(
                [frame()],
                [1],
                zeroAllocationSamples(20),
                roundResult(),
                1,
                RHI_BENCHMARK_ALLOCATION_SAMPLE_FRAMES,
                1
            )
        ).toThrow(/allocationSamples must contain exactly 21 samples/u);

        expect(() =>
            assembleRHIArchitectureMetrics(
                [frame()],
                [1],
                zeroAllocationSamples(20),
                roundResult(),
                1,
                20,
                1
            )
        ).toThrow(/allocation sample count must remain frozen at 21/u);
    });

    it('runs isolated current-RHI pages and closes every session', async () => {
        const scenario = repositoryManifest.scenarios[0];
        if (!scenario) throw new Error('manifest has no scenarios');
        const manifest = {
            ...repositoryManifest,
            backends: ['webgl2'],
            sampling: {
                ...repositoryManifest.sampling,
                warmupFrames: 1,
                sampleFrames: 2,
                rounds: 2
            },
            scenarios: [scenario]
        } as unknown as RHIBenchmarkManifest;
        const factory = new FakeFactory(manifest);
        const preflight: RHIPhase0PreflightResult = {
            manifest,
            environment: environment(manifest),
            productionFixturePath: '/repo/test/performance/fixtures/rhi-production.html',
            productionFixtureRelativePath: 'test/performance/fixtures/rhi-production.html',
            productionFixtureModulePath: '/repo/test/performance/fixtures/rhi-production.ts',
            productionFixtureSha256: '2'.repeat(64),
            browserExecutablePath: '/audited/chromium'
        };
        const raw = await collectRHIProductionCapture({
            preflight,
            commitSha: 'a'.repeat(40),
            capturedAt: '2026-07-15T00:00:00.000Z',
            sessions: factory,
            verify: (_manifest, value) => value
        });
        expect(raw.cases).toHaveLength(1);
        expect(factory.requests).toHaveLength(2);
        expect(factory.requests.map(request => request.architecture)).toEqual(['rhi', 'rhi']);
        expect(new Set(factory.sessions.map(session => session.metadata.isolationId)).size).toBe(2);
        const firstMetrics = raw.cases[0]?.rounds[0]?.results.rhi.metrics;
        expect(firstMetrics?.rhiCommandCpuMs).toHaveLength(2);
        expect(firstMetrics?.gpuFrameMs).toHaveLength(2);
        expect(firstMetrics?.rhiCommandCount).toHaveLength(2);
        expect(firstMetrics?.allocationBytesPerFrame).toHaveLength(21);
        expect(firstMetrics?.rhiHotPathAllocationBytesPerFrame).toHaveLength(21);
        expect(factory.sessions.every(session => session.closed)).toBe(true);
        expect(factory.closed).toBe(true);
    });
});
