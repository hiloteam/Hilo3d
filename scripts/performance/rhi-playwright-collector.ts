import type { Browser, BrowserContext, CDPSession, Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import {
    RHI_BENCHMARK_ALLOCATION_DISCARDED_PROFILES,
    RHI_BENCHMARK_ALLOCATION_POST_SUSPEND_WARMUP_FRAMES,
    RHI_BENCHMARK_ALLOCATION_PROFILE_MEASURED_CHUNK_FRAMES,
    RHI_BENCHMARK_ALLOCATION_PROFILER_QUIESCENCE_PROBE_FRAMES,
    RHI_BENCHMARK_ALLOCATION_PROFILER_QUIESCENCE_STABLE_FRAMES,
    RHI_BENCHMARK_ALLOCATION_PROFILER_RESTART_NOOP_TASKS,
    RHI_BENCHMARK_ALLOCATION_PROFILER_RESTART_RENDER_FRAMES,
    rhiBenchmarkAllocationProfilerWarmupFrames,
    type RHIBenchmarkFixtureFrameSample,
    type RHIBenchmarkFixtureMetadata,
    type RHIBenchmarkFixtureRoundResult
} from '../../benchmarks/rhi/fixture-contract';
import {
    RHI_BENCHMARK_ALLOCATION_SAMPLE_FRAMES,
    RHI_BENCHMARK_RHI_HOT_PATH_ALLOCATION_TODO_BUDGET_BYTES,
    type RHIBenchmarkEnvironment
} from '../../benchmarks/rhi/result-schema';
import type { RHIPhase0PreflightResult } from './rhi-phase0-preflight';
import type {
    RHIBenchmarkAllocationSample,
    RHIProductionCollectorSession,
    RHIProductionCollectorSessionFactory,
    RHIProductionCollectorSessionRequest
} from './rhi-production-collector';
import {
    launchRHIOwnedChromium,
    type RHIOwnedChromium,
    type RHIOwnedHeapProfilerSession
} from './rhi-owned-chromium';
import { canonicalRHIJson, sha256 } from './verify-rhi-baseline';

interface CDPCallFrame {
    readonly functionName?: unknown;
    readonly url?: unknown;
    readonly lineNumber?: unknown;
    readonly columnNumber?: unknown;
}

interface CDPSamplingHeapProfileNode {
    readonly callFrame?: unknown;
    readonly selfSize?: unknown;
    readonly id?: unknown;
    readonly children?: unknown;
}

interface CDPSamplingHeapProfileSample {
    readonly size?: unknown;
    readonly nodeId?: unknown;
    readonly ordinal?: unknown;
}

interface CDPSystemGpuDevice {
    readonly vendorId?: unknown;
    readonly deviceId?: unknown;
    readonly vendorString?: unknown;
    readonly deviceString?: unknown;
    readonly driverVendor?: unknown;
    readonly driverVersion?: unknown;
}

interface CDPSystemInfo {
    readonly gpu?: {
        readonly devices?: unknown;
        readonly auxAttributes?: unknown;
        readonly featureStatus?: unknown;
        readonly driverBugWorkarounds?: unknown;
    };
}

const RHI_COMMAND_IMPLEMENTATION_URL_PATTERNS = [
    '/src/render/rhi/backends/',
    '/src/render/rhi/webgpu/'
] as const;

const RHI_HOT_COMMAND_METHODS = new Set([
    'writeBuffer',
    'writeTexture',
    'copyExternalImageToTexture',
    'generateMipmaps',
    'copyBufferToBuffer',
    'copyBufferToTexture',
    'copyTextureToBuffer',
    'copyTextureToTexture',
    'setPipeline',
    'setBindGroup',
    'setVertexBuffer',
    'setVertexBufferRecord',
    'setIndexBuffer',
    'setIndexBufferRecord',
    'setViewport',
    'setViewportRecord',
    'setScissorRect',
    'setScissorRectRecord',
    'setBlendConstant',
    'setStencilReference',
    'draw',
    'drawRecord',
    'drawIndexed',
    'drawIndexedRecord'
]);

const RHI_LIFECYCLE_METHODS = new Set([
    'beginFrame',
    'endFrame',
    'abortFrame',
    'onSubmittedWorkDone',
    'beginRenderPass',
    'finishForSubmission',
    'end',
    'abort'
]);

function playwrightFailure(message: string): never {
    throw new Error(`RHI Playwright collector failed: ${message}`);
}

function record(value: unknown, context: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        playwrightFailure(`${context} must be an object`);
    }
    return value as Record<string, unknown>;
}

function finiteNonNegative(value: unknown, context: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        playwrightFailure(`${context} must be finite and non-negative`);
    }
    return value;
}

function stableGpuDevice(value: unknown): Readonly<Record<string, string | number>> {
    const device = record(value, 'SystemInfo.gpu.devices[]') as CDPSystemGpuDevice;
    const result: Record<string, string | number> = {};
    for (const key of [
        'vendorId',
        'deviceId',
        'vendorString',
        'deviceString',
        'driverVendor',
        'driverVersion'
    ] as const) {
        const entry = device[key];
        if (typeof entry === 'string' || typeof entry === 'number') result[key] = entry;
    }
    return result;
}

export interface RHIDetectedBrowserGpuIdentity {
    readonly fingerprint: string;
    readonly driver: string;
    readonly fallback: boolean;
}

/** Stable audited identity derived from Chromium's browser-process GPU diagnostics. */
export function detectedRHIBrowserGpuIdentity(value: unknown): RHIDetectedBrowserGpuIdentity {
    const systemInfo = record(value, 'SystemInfo.getInfo') as CDPSystemInfo;
    const gpu = record(systemInfo.gpu, 'SystemInfo.gpu');
    if (!Array.isArray(gpu['devices']) || gpu['devices'].length === 0) {
        playwrightFailure('SystemInfo.gpu.devices is empty');
    }
    const devices = gpu['devices'].map(stableGpuDevice);
    const stableIdentity = {
        devices,
        auxAttributes: gpu['auxAttributes'] ?? {},
        featureStatus: gpu['featureStatus'] ?? {},
        driverBugWorkarounds: gpu['driverBugWorkarounds'] ?? []
    };
    const text = canonicalRHIJson(stableIdentity);
    const fallback =
        /swiftshader|software only|software rasterizer|llvmpipe|lavapipe|microsoft basic render|\bwarp\b/u.test(
            text.toLowerCase()
        );
    const driver = devices
        .map(
            device =>
                `${String(device['driverVendor'] ?? '')}:${String(device['driverVersion'] ?? '')}`
        )
        .join('|');
    if (!driver || driver === ':') playwrightFailure('Chromium did not report a GPU driver');
    return { fingerprint: sha256(text), driver, fallback };
}

function verifyDetectedBrowserEnvironment(
    expected: RHIBenchmarkEnvironment,
    browserVersion: string,
    gpu: RHIDetectedBrowserGpuIdentity
): void {
    if (browserVersion !== expected.browserVersion) {
        playwrightFailure(
            `Chromium version ${browserVersion} differs from audited ${expected.browserVersion}`
        );
    }
    if (gpu.fingerprint !== expected.gpuFingerprint) {
        playwrightFailure('Chromium GPU identity differs from the audited environment');
    }
    if (gpu.driver !== expected.gpuDriver) {
        playwrightFailure('Chromium GPU driver differs from the audited environment');
    }
    if (gpu.fallback !== expected.fallbackAdapter) {
        playwrightFailure('Chromium fallback-adapter state differs from the audited environment');
    }
    if (gpu.fallback) playwrightFailure('software/fallback GPU adapters are forbidden');
}

function callFrame(value: unknown): CDPCallFrame {
    return record(value, 'sampling profile callFrame');
}

function profileNode(value: unknown): CDPSamplingHeapProfileNode {
    return record(value, 'sampling profile node');
}

function simpleFunctionName(value: unknown): string {
    if (typeof value !== 'string') return '';
    const separator = Math.max(value.lastIndexOf('.'), value.lastIndexOf(' '));
    return value.slice(separator + 1);
}

function isRHICommandImplementation(url: string): boolean {
    return RHI_COMMAND_IMPLEMENTATION_URL_PATTERNS.some(pattern => url.includes(pattern));
}

function isRendererDrawBoundary(url: string, functionName: string): boolean {
    return (
        functionName === 'execute' &&
        (url.includes('/src/render/renderer/PreparedDraw.ts') ||
            url.includes('/src/render/renderer/passes/SharedDrawPass.ts'))
    );
}

function isSynchronousAllocationFrameBoundary(url: string, functionName: string): boolean {
    return (
        functionName === 'renderAllocationRendererBoundary' &&
        url.includes('/test/performance/fixtures/rhi-production.ts')
    );
}

/**
 * Classify a Chromium sampling profile using the frozen RHI allocation contract.
 *
 * `rendererBytes` covers descendants of the fixture's synchronous render boundary, excluding
 * completion callbacks even if they race with the CDP stop round-trip. `rhiHotPathBytes` covers
 * only
 * SharedDrawPass/PreparedDraw execution and concrete RHI command methods. Public frame/pass/
 * submission shells and native encoder creation/finalization are lifecycle costs: they remain in
 * renderer A/B bytes but are not the zero-allocation draw/context counter. Asynchronous completion
 * is outside the synchronous fixture root and therefore enters neither metric. A hot flag
 * propagates through helper/native descendants, so allocations below a real draw are not hidden
 * merely because their leaf function has a different name.
 */
function classifyRHIAllocationProfileInternal(
    value: unknown,
    hotBytesByFrame: Map<string, number> | null,
    rendererBytesByFrame: Map<string, number> | null = null
): RHIBenchmarkAllocationSample {
    const profile = record(value, 'HeapProfiler.stopSampling');
    const root = profileNode(record(profile['profile'], 'sampling profile')['head']);
    let rendererBytes = 0;
    let rhiHotPathBytes = 0;
    const visit = (
        node: CDPSamplingHeapProfileNode,
        synchronousFrameStack: boolean,
        rendererStack: boolean,
        rhiStack: boolean,
        lifecycleStack: boolean,
        diagnosticPath: string
    ): void => {
        const frame = callFrame(node.callFrame);
        const url = typeof frame.url === 'string' ? frame.url : '';
        const functionName = simpleFunctionName(frame.functionName);
        const nextSynchronousFrameStack =
            synchronousFrameStack || isSynchronousAllocationFrameBoundary(url, functionName);
        const nextRendererStack =
            rendererStack || (nextSynchronousFrameStack && url.includes('/src/'));
        const commandImplementation = isRHICommandImplementation(url);
        const nextLifecycleStack =
            lifecycleStack || (commandImplementation && RHI_LIFECYCLE_METHODS.has(functionName));
        const nextRhiStack =
            nextSynchronousFrameStack &&
            !nextLifecycleStack &&
            (rhiStack ||
                isRendererDrawBoundary(url, functionName) ||
                (commandImplementation && RHI_HOT_COMMAND_METHODS.has(functionName)));
        const selfSize = finiteNonNegative(node.selfSize, 'sampling profile node.selfSize');
        if (!Number.isSafeInteger(selfSize)) {
            playwrightFailure('sampling profile selfSize must be an exact byte count');
        }
        const source = url.length === 0 ? '<anonymous>' : url;
        const lineNumber = frame.lineNumber;
        const columnNumber = frame.columnNumber;
        const location =
            typeof lineNumber === 'number' && Number.isSafeInteger(lineNumber)
                ? `:${String(lineNumber + 1)}${
                      typeof columnNumber === 'number' && Number.isSafeInteger(columnNumber)
                          ? `:${String(columnNumber + 1)}`
                          : ''
                  }`
                : '';
        const diagnosticKey = `${source}${location} :: ${functionName || '<anonymous>'}`;
        const nextDiagnosticPath = nextSynchronousFrameStack
            ? diagnosticPath.length === 0
                ? diagnosticKey
                : `${diagnosticPath} -> ${diagnosticKey}`
            : '';
        if (nextRendererStack) {
            rendererBytes += selfSize;
            if (rendererBytesByFrame !== null && selfSize > 0) {
                rendererBytesByFrame.set(
                    nextDiagnosticPath,
                    (rendererBytesByFrame.get(nextDiagnosticPath) ?? 0) + selfSize
                );
            }
        }
        if (nextRhiStack) {
            rhiHotPathBytes += selfSize;
            if (hotBytesByFrame !== null && selfSize > 0) {
                hotBytesByFrame.set(
                    nextDiagnosticPath,
                    (hotBytesByFrame.get(nextDiagnosticPath) ?? 0) + selfSize
                );
            }
        }
        if (node.children === undefined) return;
        if (!Array.isArray(node.children)) {
            playwrightFailure('sampling profile node.children must be an array');
        }
        for (const child of node.children) {
            visit(
                profileNode(child),
                nextSynchronousFrameStack,
                nextRendererStack,
                nextRhiStack,
                nextLifecycleStack,
                nextDiagnosticPath
            );
        }
    };
    visit(root, false, false, false, false, '');
    return { rendererBytes, rhiHotPathBytes };
}

export function classifyRHIAllocationProfile(value: unknown): RHIBenchmarkAllocationSample {
    return classifyRHIAllocationProfileInternal(value, null);
}

export interface RHIAllocationHotFrame {
    readonly frame: string;
    readonly bytes: number;
}

function rankedRHIAllocationFrames(
    bytesByFrame: ReadonlyMap<string, number>,
    limit: number
): readonly Readonly<RHIAllocationHotFrame>[] {
    return Object.freeze(
        [...bytesByFrame]
            .map(([frame, bytes]) => Object.freeze({ frame, bytes }))
            .sort(
                (first, second) =>
                    second.bytes - first.bytes || first.frame.localeCompare(second.frame)
            )
            .slice(0, limit)
    );
}

/** Deterministic diagnostics for a failed hot-path allocation gate; not a benchmark metric. */
export function diagnoseRHIAllocationProfile(
    value: unknown,
    limit = 12
): readonly Readonly<RHIAllocationHotFrame>[] {
    if (!Number.isSafeInteger(limit) || limit < 1) {
        throw new RangeError('RHI allocation diagnostic limit must be a positive safe integer');
    }
    const hotBytesByFrame = new Map<string, number>();
    classifyRHIAllocationProfileInternal(value, hotBytesByFrame);
    return rankedRHIAllocationFrames(hotBytesByFrame, limit);
}

/** Deterministic renderer-wide diagnostics for paired allocation-regression failures. */
export function diagnoseRHIRendererAllocationProfile(
    value: unknown,
    limit = 12
): readonly Readonly<RHIAllocationHotFrame>[] {
    if (!Number.isSafeInteger(limit) || limit < 1) {
        throw new RangeError('RHI allocation diagnostic limit must be a positive safe integer');
    }
    const rendererBytesByFrame = new Map<string, number>();
    classifyRHIAllocationProfileInternal(value, null, rendererBytesByFrame);
    return rankedRHIAllocationFrames(rendererBytesByFrame, limit);
}

export const RHI_ALLOCATION_PROFILE_MARKER_SLOTS = 512;

const RHI_ALLOCATION_START_MARKER = 'markRHIAllocationFrameStart';
const RHI_ALLOCATION_END_MARKER = 'markRHIAllocationFrameEnd';

export interface RHIProfiledAllocationFrame {
    readonly sample: Readonly<RHIBenchmarkAllocationSample>;
    readonly hotFrames: readonly Readonly<RHIAllocationHotFrame>[];
    readonly rendererFrames: readonly Readonly<RHIAllocationHotFrame>[];
}

function freezeRHIAllocationFrame(
    profile: unknown,
    includeDiagnostics: boolean
): Readonly<RHIProfiledAllocationFrame> {
    return Object.freeze({
        sample: Object.freeze(classifyRHIAllocationProfile(profile)),
        hotFrames: includeDiagnostics ? diagnoseRHIAllocationProfile(profile) : Object.freeze([]),
        rendererFrames: includeDiagnostics
            ? diagnoseRHIRendererAllocationProfile(profile)
            : Object.freeze([])
    });
}

/**
 * Reconstruct exact per-frame samples from one CDP start/stop session. Marker samples only delimit
 * windows; application samples retain the frozen renderer/hot-path classification unchanged.
 */
export function splitRHISynchronousAllocationProfile(
    value: unknown,
    expectedFrameCount: number,
    includeDiagnostics = false
): readonly Readonly<RHIProfiledAllocationFrame>[] {
    if (!Number.isSafeInteger(expectedFrameCount) || expectedFrameCount < 1) {
        throw new RangeError('RHI allocation frame count must be a positive safe integer');
    }
    const response = record(value, 'HeapProfiler.stopSampling');
    const profile = record(response['profile'], 'sampling profile');
    const head = profileNode(profile['head']);
    const samples = profile['samples'];
    if (!Array.isArray(samples)) {
        playwrightFailure('sampling profile samples must be an array');
    }

    const nodes = new Map<number, CDPSamplingHeapProfileNode>();
    const parentNodeIds = new Map<number, number | null>();
    const startMarkerNodeIds = new Set<number>();
    const endMarkerNodeIds = new Set<number>();
    const visit = (
        node: CDPSamplingHeapProfileNode,
        parentNodeId: number | null,
        startMarkerStack: boolean,
        endMarkerStack: boolean,
        synchronousBoundaryStack: boolean
    ): void => {
        const id = node.id;
        if (!Number.isSafeInteger(id) || (id as number) < 0 || nodes.has(id as number)) {
            playwrightFailure('sampling profile contains an invalid or duplicate node id');
        }
        const frame = callFrame(node.callFrame);
        const url = typeof frame.url === 'string' ? frame.url : '';
        const functionName = simpleFunctionName(frame.functionName);
        const nextStartMarkerStack =
            startMarkerStack || functionName === RHI_ALLOCATION_START_MARKER;
        const nextEndMarkerStack = endMarkerStack || functionName === RHI_ALLOCATION_END_MARKER;
        const nextSynchronousBoundaryStack =
            synchronousBoundaryStack || isSynchronousAllocationFrameBoundary(url, functionName);
        if (nextStartMarkerStack && nextEndMarkerStack) {
            playwrightFailure('sampling profile frame marker stacks overlap');
        }
        if ((nextStartMarkerStack || nextEndMarkerStack) && nextSynchronousBoundaryStack) {
            playwrightFailure('sampling profile marker overlaps the synchronous renderer boundary');
        }
        const selfSize = finiteNonNegative(node.selfSize, 'sampling profile node.selfSize');
        if (!Number.isSafeInteger(selfSize)) {
            playwrightFailure('sampling profile selfSize must be an exact byte count');
        }
        const nodeId = id as number;
        nodes.set(nodeId, node);
        parentNodeIds.set(nodeId, parentNodeId);
        if (nextStartMarkerStack) startMarkerNodeIds.add(nodeId);
        if (nextEndMarkerStack) endMarkerNodeIds.add(nodeId);
        if (!Array.isArray(node.children)) {
            playwrightFailure('sampling profile node.children must be an array');
        }
        for (const child of node.children) {
            visit(
                profileNode(child),
                nodeId,
                nextStartMarkerStack,
                nextEndMarkerStack,
                nextSynchronousBoundaryStack
            );
        }
    };
    visit(head, null, false, false, false);
    if (startMarkerNodeIds.size === 0 || endMarkerNodeIds.size === 0) {
        playwrightFailure('sampling profile frame markers are missing');
    }

    const rootNodeId = head.id as number;
    const profileForFrame = (selfSizes: ReadonlyMap<number, number>): unknown => {
        const includedNodeIds = new Set<number>([rootNodeId]);
        for (const sampledNodeId of selfSizes.keys()) {
            let nodeId: number | null = sampledNodeId;
            while (nodeId !== null && !includedNodeIds.has(nodeId)) {
                includedNodeIds.add(nodeId);
                const parentNodeId = parentNodeIds.get(nodeId);
                if (parentNodeId === undefined) {
                    playwrightFailure('sampling profile node parent is unavailable');
                }
                nodeId = parentNodeId;
            }
        }
        const cloneIncludedNode = (nodeId: number): CDPSamplingHeapProfileNode => {
            const source = nodes.get(nodeId);
            if (source === undefined || !Array.isArray(source.children)) {
                playwrightFailure('sampling profile node is unavailable');
            }
            const children: CDPSamplingHeapProfileNode[] = [];
            for (const childValue of source.children) {
                const child = profileNode(childValue);
                const childId = child.id as number;
                if (includedNodeIds.has(childId)) children.push(cloneIncludedNode(childId));
            }
            return {
                id: nodeId,
                callFrame: source.callFrame,
                selfSize: selfSizes.get(nodeId) ?? 0,
                children
            };
        };
        return { profile: { head: cloneIncludedNode(rootNodeId) } };
    };

    const frames: Readonly<RHIProfiledAllocationFrame>[] = [];
    let activeFrame: Map<number, number> | null = null;
    let phase: 'outside' | 'start-marker' | 'frame' | 'end-marker' = 'outside';
    const orderedSamples = samples.map(sampleValue => {
        const sample = record(
            sampleValue,
            'sampling profile sample'
        ) as CDPSamplingHeapProfileSample;
        const { nodeId, ordinal, size } = sample;
        if (
            !Number.isSafeInteger(nodeId) ||
            !nodes.has(nodeId as number) ||
            !Number.isSafeInteger(size) ||
            (size as number) <= 0 ||
            !Number.isSafeInteger(ordinal) ||
            (ordinal as number) < 0
        ) {
            playwrightFailure('sampling profile contains an invalid sample');
        }
        return {
            nodeId: nodeId as number,
            ordinal: ordinal as number,
            size: size as number
        };
    });
    orderedSamples.sort((first, second) => first.ordinal - second.ordinal);
    let previousOrdinal = -1;
    for (const { nodeId, ordinal, size } of orderedSamples) {
        if (ordinal <= previousOrdinal) {
            playwrightFailure('sampling profile ordinals must be strictly increasing');
        }
        previousOrdinal = ordinal;
        const startMarker = startMarkerNodeIds.has(nodeId);
        const endMarker = endMarkerNodeIds.has(nodeId);

        if (startMarker) {
            if (phase === 'frame') {
                playwrightFailure('sampling profile observed a nested frame start');
            }
            if (phase === 'outside' || phase === 'end-marker') {
                activeFrame = new Map<number, number>();
                phase = 'start-marker';
            }
            continue;
        }
        if (endMarker) {
            if (phase === 'outside') {
                playwrightFailure('sampling profile observed a frame end without a start');
            }
            if (phase === 'start-marker' || phase === 'frame') {
                if (activeFrame === null) {
                    playwrightFailure('sampling profile frame state is inconsistent');
                }
                frames.push(
                    freezeRHIAllocationFrame(profileForFrame(activeFrame), includeDiagnostics)
                );
                activeFrame = null;
                phase = 'end-marker';
            }
            continue;
        }

        if (phase === 'start-marker') phase = 'frame';
        if (phase === 'frame') {
            if (activeFrame === null) {
                playwrightFailure('sampling profile frame state is inconsistent');
            }
            const nextSize = (activeFrame.get(nodeId) ?? 0) + size;
            if (!Number.isSafeInteger(nextSize)) {
                playwrightFailure('sampling profile frame byte total is not a safe integer');
            }
            activeFrame.set(nodeId, nextSize);
        } else if (phase === 'end-marker') {
            phase = 'outside';
        }
    }
    if (phase === 'start-marker' || phase === 'frame' || activeFrame !== null) {
        playwrightFailure('sampling profile ended inside a frame');
    }
    if (frames.length !== expectedFrameCount) {
        playwrightFailure(
            `sampling profile observed ${String(frames.length)} frames; expected ${String(expectedFrameCount)}`
        );
    }
    return Object.freeze(frames);
}

/** Run exact profiler instrumentation without retaining collected warm-up samples. */
async function warmRHIAllocationProfiler(
    page: Page,
    cdp: Pick<CDPSession, 'send'>,
    warmupFrames: number,
    progress?: (phase: string) => void
): Promise<void> {
    let samplingStarted = false;
    try {
        progress?.('stage-a:start-sampling');
        await cdp.send('HeapProfiler.startSampling', {
            samplingInterval: 1,
            includeObjectsCollectedByMajorGC: false,
            includeObjectsCollectedByMinorGC: false
        });
        samplingStarted = true;
        progress?.('stage-a:render-warmup');
        await page.evaluate(async frameCount => {
            const fixture = window.__HILO3D_RHI_BENCHMARK__;
            if (!fixture) throw new Error('production fixture API is missing');
            for (let index = 0; index < frameCount; index += 1) {
                fixture.renderAllocationFrame();
                await fixture.settleAllocationFrame();
            }
        }, warmupFrames);
        progress?.('stage-a:collect-garbage');
        await cdp.send('HeapProfiler.collectGarbage');
    } finally {
        if (samplingStarted) {
            progress?.('stage-a:stop-sampling');
            await cdp.send('HeapProfiler.stopSampling');
            progress?.('stage-a:complete');
        }
    }
}

async function renderMarkedRHIAllocationFrames(page: Page, frameCount: number): Promise<void> {
    for (let index = 0; index < frameCount; index += 1) {
        await page.evaluate(async markerSlots => {
            const fixture = window.__HILO3D_RHI_BENCHMARK__;
            if (!fixture) throw new Error('production fixture API is missing');
            const scope = window as typeof window & {
                __HILO3D_RHI_ALLOCATION_MARKER__?: unknown[];
            };
            function markRHIAllocationFrameStart(): void {
                const marker = new Array<unknown>(markerSlots).fill(null);
                marker[0] = scope;
                scope.__HILO3D_RHI_ALLOCATION_MARKER__ = marker;
            }
            function markRHIAllocationFrameEnd(): void {
                const marker = new Array<unknown>(markerSlots + 1).fill(null);
                marker[0] = scope;
                scope.__HILO3D_RHI_ALLOCATION_MARKER__ = marker;
            }
            markRHIAllocationFrameStart();
            fixture.renderAllocationFrame();
            markRHIAllocationFrameEnd();
            await fixture.settleAllocationFrame();
        }, RHI_ALLOCATION_PROFILE_MARKER_SLOTS);
    }
}

/**
 * Preserve the one-Runtime-task-per-frame cadence used by the marked proof. A bulk in-page loop
 * can finish all draws before Chromium installs pending V8 tiers at later task boundaries, which
 * would otherwise move profiler-induced code metadata into the measured window.
 */
async function warmRetainedRHIAllocationWindow(page: Page): Promise<void> {
    for (
        let index = 0;
        index < RHI_BENCHMARK_ALLOCATION_PROFILER_RESTART_RENDER_FRAMES;
        index += 1
    ) {
        await page.evaluate(async () => {
            const fixture = window.__HILO3D_RHI_BENCHMARK__;
            if (!fixture) throw new Error('production fixture API is missing');
            fixture.renderAllocationFrame();
            await fixture.settleAllocationFrame();
        });
    }
    for (let index = 0; index < RHI_BENCHMARK_ALLOCATION_PROFILER_RESTART_NOOP_TASKS; index += 1) {
        await page.evaluate(() => {
            const fixture = window.__HILO3D_RHI_BENCHMARK__;
            if (!fixture) throw new Error('production fixture API is missing');
            // Re-enter the isolate on a distinct Runtime task without retaining another full frame.
            void fixture.metadata;
        });
    }
}

export interface RHIProfiledAllocationWindow {
    readonly quiescenceWindows: readonly (readonly Readonly<RHIProfiledAllocationFrame>[])[];
    readonly frames: readonly Readonly<RHIProfiledAllocationFrame>[];
}

/** Require the fixed probe to end in the audited consecutive temporary-budget window. */
export function assertRHIAllocationQuiescence(hotBytes: readonly number[]): void {
    if (hotBytes.length !== RHI_BENCHMARK_ALLOCATION_PROFILER_QUIESCENCE_PROBE_FRAMES) {
        throw new RangeError(
            `RHI allocation quiescence probe must contain exactly ${String(RHI_BENCHMARK_ALLOCATION_PROFILER_QUIESCENCE_PROBE_FRAMES)} frames`
        );
    }
    for (const bytes of hotBytes) {
        if (!Number.isSafeInteger(bytes) || bytes < 0) {
            throw new RangeError('RHI allocation quiescence vector contains invalid hot bytes');
        }
    }
    const stableStart =
        hotBytes.length - RHI_BENCHMARK_ALLOCATION_PROFILER_QUIESCENCE_STABLE_FRAMES;
    for (let index = stableStart; index < hotBytes.length; index += 1) {
        if (
            (hotBytes[index] ?? Number.POSITIVE_INFINITY) <=
            RHI_BENCHMARK_RHI_HOT_PATH_ALLOCATION_TODO_BUDGET_BYTES
        )
            continue;
        playwrightFailure(
            `allocation profiler fixed quiescence probe did not end in ${String(RHI_BENCHMARK_ALLOCATION_PROFILER_QUIESCENCE_STABLE_FRAMES)} frames within the temporary ${String(RHI_BENCHMARK_RHI_HOT_PATH_ALLOCATION_TODO_BUDGET_BYTES)}-byte hot-path TODO budget; observed [${hotBytes.join(',')}]`
        );
    }
}

function assertRHIAllocationQuiescenceFrames(
    frames: readonly Readonly<RHIProfiledAllocationFrame>[],
    includeDiagnostics: boolean
): void {
    try {
        assertRHIAllocationQuiescence(frames.map(frame => frame.sample.rhiHotPathBytes));
    } catch (error) {
        if (!includeDiagnostics) throw error;
        const detail = frames
            .flatMap((frame, index) =>
                frame.hotFrames.map(
                    hotFrame => `q${String(index + 1)}: ${String(hotFrame.bytes)} ${hotFrame.frame}`
                )
            )
            .join('\n');
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
            `${message}${detail.length === 0 ? '' : `\nquiescence hot stacks:\n${detail}`}`,
            { cause: error }
        );
    }
}

/**
 * Profiles synchronous render frames in fixed retained-object windows after one exact,
 * garbage-collected tier-up session. Every retained window has its own fixed Runtime-task warm-up,
 * complete marked quiescence proof, and bounded measured chunk. This keeps V8's one-byte retained
 * sample vector bounded while every measured chunk remains immediately preceded by a fail-closed
 * terminal-zero proof in the same profile. Submission settle/fence work is awaited after each end
 * marker and excluded from reconstruction.
 */
export async function profileRHISynchronousAllocationFrames(
    page: Page,
    cdp: Pick<CDPSession, 'send'>,
    frameCount: number,
    includeDiagnostics = false,
    progress?: (phase: string) => void
): Promise<Readonly<RHIProfiledAllocationWindow>> {
    if (!Number.isSafeInteger(frameCount) || frameCount < 1) {
        throw new RangeError('RHI allocation frame count must be a positive safe integer');
    }
    const drawCount = await page.evaluate(() => {
        const fixture = window.__HILO3D_RHI_BENCHMARK__;
        if (!fixture) throw new Error('production fixture API is missing');
        return fixture.metadata.quality.drawCount;
    });
    const checkedProfilerWarmupFrames = rhiBenchmarkAllocationProfilerWarmupFrames(drawCount);
    await warmRHIAllocationProfiler(page, cdp, checkedProfilerWarmupFrames, progress);
    const quiescenceFrameCount = RHI_BENCHMARK_ALLOCATION_PROFILER_QUIESCENCE_PROBE_FRAMES;
    const quiescenceWindows: (readonly Readonly<RHIProfiledAllocationFrame>[])[] = [];
    const measuredFrames: Readonly<RHIProfiledAllocationFrame>[] = [];
    const windowCount = Math.ceil(
        frameCount / RHI_BENCHMARK_ALLOCATION_PROFILE_MEASURED_CHUNK_FRAMES
    );
    for (let windowIndex = 0; windowIndex < windowCount; windowIndex += 1) {
        const measuredOffset = windowIndex * RHI_BENCHMARK_ALLOCATION_PROFILE_MEASURED_CHUNK_FRAMES;
        const measuredFrameCount = Math.min(
            RHI_BENCHMARK_ALLOCATION_PROFILE_MEASURED_CHUNK_FRAMES,
            frameCount - measuredOffset
        );
        const phasePrefix = `stage-b:window-${String(windowIndex + 1)}-of-${String(windowCount)}`;
        let samplingStarted = false;
        let profile: unknown;
        try {
            progress?.(`${phasePrefix}:start-sampling`);
            await cdp.send('HeapProfiler.startSampling', {
                samplingInterval: 1,
                includeObjectsCollectedByMajorGC: true,
                includeObjectsCollectedByMinorGC: true
            });
            samplingStarted = true;
            progress?.(`${phasePrefix}:warm-restart-window`);
            await warmRetainedRHIAllocationWindow(page);
            progress?.(`${phasePrefix}:render-quiescence`);
            await renderMarkedRHIAllocationFrames(page, quiescenceFrameCount);
            progress?.(`${phasePrefix}:render-measured`);
            await renderMarkedRHIAllocationFrames(page, measuredFrameCount);
        } finally {
            try {
                if (samplingStarted) {
                    progress?.(`${phasePrefix}:stop-sampling`);
                    profile = await cdp.send('HeapProfiler.stopSampling');
                    progress?.(`${phasePrefix}:profile-compacted`);
                }
            } finally {
                await page.evaluate(() => {
                    const scope = window as typeof window & {
                        __HILO3D_RHI_ALLOCATION_MARKER__?: unknown[];
                    };
                    delete scope.__HILO3D_RHI_ALLOCATION_MARKER__;
                });
            }
        }
        if (profile === undefined) playwrightFailure('sampling profile is unavailable');
        const windowFrames = splitRHISynchronousAllocationProfile(
            profile,
            quiescenceFrameCount + measuredFrameCount,
            includeDiagnostics
        );
        progress?.(`${phasePrefix}:profile-reconstructed`);
        const quiescenceFrames = Object.freeze(windowFrames.slice(0, quiescenceFrameCount));
        assertRHIAllocationQuiescenceFrames(quiescenceFrames, includeDiagnostics);
        quiescenceWindows.push(quiescenceFrames);
        measuredFrames.push(...windowFrames.slice(quiescenceFrameCount));
    }
    if (measuredFrames.length !== frameCount) {
        playwrightFailure('sampling profile measured window matrix is incomplete');
    }
    return Object.freeze({
        quiescenceWindows: Object.freeze(quiescenceWindows),
        frames: Object.freeze(measuredFrames)
    });
}

async function fixtureOn(page: Page): Promise<RHIBenchmarkFixtureMetadata> {
    await page.waitForFunction(
        () =>
            window.__HILO3D_RHI_BENCHMARK__ !== undefined ||
            window.__HILO3D_RHI_BENCHMARK_ERROR__ !== undefined,
        undefined,
        { timeout: 120_000 }
    );
    const error = await page.evaluate(() => window.__HILO3D_RHI_BENCHMARK_ERROR__);
    if (error) playwrightFailure(`fixture initialization failed: ${error}`);
    return page.evaluate(() => {
        const fixture = window.__HILO3D_RHI_BENCHMARK__;
        if (!fixture) throw new Error('production fixture API is missing');
        return fixture.metadata;
    });
}

export function assertRHIProductionAllocationSampleFrames(frameCount: number): void {
    if (frameCount !== RHI_BENCHMARK_ALLOCATION_SAMPLE_FRAMES) {
        throw new RangeError(
            `RHI production allocation frame count must remain frozen at ${String(RHI_BENCHMARK_ALLOCATION_SAMPLE_FRAMES)}`
        );
    }
}

class PlaywrightCollectorSession implements RHIProductionCollectorSession {
    #closed = false;

    constructor(
        readonly metadata: RHIBenchmarkFixtureMetadata,
        readonly context: BrowserContext,
        readonly page: Page,
        readonly cdp: CDPSession,
        readonly allocationCdp: Pick<CDPSession, 'send'>,
        readonly allocationTransport: RHIOwnedHeapProfilerSession | null
    ) {}

    warmup(frameCount: number): Promise<void> {
        return this.page.evaluate(async count => {
            const fixture = window.__HILO3D_RHI_BENCHMARK__;
            if (!fixture) throw new Error('production fixture API is missing');
            await fixture.warmup(count);
        }, frameCount);
    }

    sampleTimingFrames(frameCount: number): Promise<readonly RHIBenchmarkFixtureFrameSample[]> {
        return this.page.evaluate(async count => {
            const fixture = window.__HILO3D_RHI_BENCHMARK__;
            if (!fixture) throw new Error('production fixture API is missing');
            return fixture.sampleTimingFrames(count);
        }, frameCount);
    }

    sampleGpuFrames(frameCount: number): Promise<readonly number[]> {
        return this.page.evaluate(async count => {
            const fixture = window.__HILO3D_RHI_BENCHMARK__;
            if (!fixture) throw new Error('production fixture API is missing');
            return fixture.sampleGpuFrames(count);
        }, frameCount);
    }

    async sampleAllocationFrames(
        frameCount: number
    ): Promise<readonly RHIBenchmarkAllocationSample[]> {
        assertRHIProductionAllocationSampleFrames(frameCount);
        let phaseStarted = false;
        await this.allocationCdp.send('HeapProfiler.enable');
        try {
            await this.page.evaluate(() => {
                const fixture = window.__HILO3D_RHI_BENCHMARK__;
                if (!fixture) throw new Error('production fixture API is missing');
                fixture.beginAllocationSampling();
            });
            phaseStarted = true;
            await this.page.evaluate(async warmupFrames => {
                const fixture = window.__HILO3D_RHI_BENCHMARK__;
                if (!fixture) throw new Error('production fixture API is missing');
                await fixture.warmup(warmupFrames);
            }, RHI_BENCHMARK_ALLOCATION_POST_SUSPEND_WARMUP_FRAMES);
            const profileWindow = await profileRHISynchronousAllocationFrames(
                this.page,
                this.allocationCdp,
                RHI_BENCHMARK_ALLOCATION_DISCARDED_PROFILES + frameCount
            );
            return profileWindow.frames
                .slice(RHI_BENCHMARK_ALLOCATION_DISCARDED_PROFILES)
                .map(frame => frame.sample);
        } finally {
            try {
                await this.allocationCdp.send('HeapProfiler.disable');
            } finally {
                if (phaseStarted) {
                    await this.page.evaluate(() => {
                        const fixture = window.__HILO3D_RHI_BENCHMARK__;
                        if (!fixture) throw new Error('production fixture API is missing');
                        fixture.endAllocationSampling();
                    });
                }
            }
        }
    }

    async finishRound(): Promise<RHIBenchmarkFixtureRoundResult> {
        await this.page.evaluate(async () => {
            const fixture = window.__HILO3D_RHI_BENCHMARK__;
            if (!fixture) throw new Error('production fixture API is missing');
            await fixture.completeRound();
        });
        await this.cdp.send('HeapProfiler.enable');
        try {
            await this.cdp.send('HeapProfiler.collectGarbage');
            const usage = record(
                await this.cdp.send('Runtime.getHeapUsage'),
                'Runtime.getHeapUsage'
            );
            const retainedHeapBytes = finiteNonNegative(
                usage['usedSize'],
                'Runtime.getHeapUsage.usedSize'
            );
            if (!Number.isSafeInteger(retainedHeapBytes)) {
                playwrightFailure('retained heap must be an exact byte count');
            }
            return await this.page.evaluate(async retained => {
                const fixture = window.__HILO3D_RHI_BENCHMARK__;
                if (!fixture) throw new Error('production fixture API is missing');
                return fixture.finishRound(retained);
            }, retainedHeapBytes);
        } finally {
            await this.cdp.send('HeapProfiler.disable');
        }
    }

    async close(): Promise<void> {
        if (this.#closed) return;
        this.#closed = true;
        try {
            await this.page
                .evaluate(async () => window.__HILO3D_RHI_BENCHMARK__?.destroy())
                .catch(() => undefined);
        } finally {
            try {
                await this.allocationTransport?.close();
            } finally {
                await this.context.close();
            }
        }
    }
}

export interface PlaywrightCollectorFactoryOptions {
    readonly preflight: RHIPhase0PreflightResult;
    readonly repositoryRoot: string;
}

export class PlaywrightCollectorSessionFactory implements RHIProductionCollectorSessionFactory {
    readonly #preflight: RHIPhase0PreflightResult;
    readonly #repositoryRoot: string;
    #server: ViteDevServer | null = null;
    #browser: Browser | null = null;
    #ownedBrowser: RHIOwnedChromium | null = null;
    #origin = '';
    #closed = false;

    constructor(options: PlaywrightCollectorFactoryOptions) {
        this.#preflight = options.preflight;
        this.#repositoryRoot = options.repositoryRoot;
    }

    async initialize(): Promise<void> {
        if (this.#server || this.#browser) playwrightFailure('collector factory is already open');
        this.#server = await createServer({
            root: this.#repositoryRoot,
            logLevel: 'error',
            server: {
                host: '127.0.0.1',
                port: 0,
                strictPort: false,
                headers: {
                    'Cross-Origin-Opener-Policy': 'same-origin',
                    'Cross-Origin-Embedder-Policy': 'require-corp'
                }
            }
        });
        await this.#server.listen();
        const origin = this.#server.resolvedUrls?.local[0];
        if (!origin) playwrightFailure('Vite did not publish a loopback benchmark origin');
        this.#origin = origin.replace(/\/$/u, '');
        this.#ownedBrowser = await launchRHIOwnedChromium({
            executablePath: this.#preflight.browserExecutablePath,
            args: [
                '--enable-precise-memory-info',
                '--disable-background-timer-throttling',
                '--disable-renderer-backgrounding',
                '--disable-features=CalculateNativeWinOcclusion',
                '--enable-unsafe-webgpu'
            ]
        });
        this.#browser = this.#ownedBrowser.browser;
        const browserCdp = await this.#browser.newBrowserCDPSession();
        const gpu = detectedRHIBrowserGpuIdentity(await browserCdp.send('SystemInfo.getInfo'));
        verifyDetectedBrowserEnvironment(this.#preflight.environment, this.#browser.version(), gpu);
    }

    async open(
        request: RHIProductionCollectorSessionRequest
    ): Promise<RHIProductionCollectorSession> {
        if (this.#closed) playwrightFailure('collector factory is closed');
        if (!this.#browser || !this.#server) await this.initialize();
        const browser = this.#browser;
        if (!browser) playwrightFailure('Chromium did not initialize');
        const ownedBrowser = this.#ownedBrowser;
        if (!ownedBrowser) playwrightFailure('owned Chromium transport did not initialize');
        const context = await browser.newContext({
            viewport: {
                width: request.scenario.quality.width,
                height: request.scenario.quality.height
            },
            deviceScaleFactor: request.scenario.quality.devicePixelRatio
        });
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        let allocationTransport: RHIOwnedHeapProfilerSession | null = null;
        const search = new URLSearchParams({
            architecture: request.architecture,
            backend: request.backend,
            scenario: request.scenario.id,
            round: String(request.round),
            orderPosition: String(request.orderPosition),
            adapterPolicy: 'physical'
        });
        try {
            await page.goto(
                `${this.#origin}/${this.#preflight.productionFixtureRelativePath}?${search.toString()}`,
                { waitUntil: 'load', timeout: 120_000 }
            );
            const browserCapabilities = await page.evaluate(() => {
                const memory = (
                    performance as Performance & {
                        readonly memory?: unknown;
                    }
                ).memory;
                return {
                    preciseMemory:
                        typeof memory === 'object' &&
                        memory !== null &&
                        typeof (memory as Record<string, unknown>)['usedJSHeapSize'] === 'number',
                    highResolutionClock: globalThis.crossOriginIsolated
                };
            });
            if (!browserCapabilities.preciseMemory) {
                playwrightFailure('Chromium precise memory API is unavailable');
            }
            if (!browserCapabilities.highResolutionClock) {
                playwrightFailure('benchmark page is not cross-origin isolated');
            }
            const metadata = await fixtureOn(page);
            const targetInfo = record(
                record(await cdp.send('Target.getTargetInfo'), 'Target.getTargetInfo')[
                    'targetInfo'
                ],
                'Target.getTargetInfo.targetInfo'
            );
            const targetId = targetInfo['targetId'];
            if (typeof targetId !== 'string' || targetId.length === 0) {
                playwrightFailure('benchmark page target id is unavailable');
            }
            allocationTransport = await ownedBrowser.createHeapProfilerSession(targetId);
            return new PlaywrightCollectorSession(
                metadata,
                context,
                page,
                cdp,
                allocationTransport,
                allocationTransport
            );
        } catch (error) {
            try {
                await allocationTransport?.close();
            } finally {
                await context.close();
            }
            throw error;
        }
    }

    async close(): Promise<void> {
        if (this.#closed) return;
        this.#closed = true;
        try {
            await this.#ownedBrowser?.close();
        } finally {
            this.#ownedBrowser = null;
            this.#browser = null;
            await this.#server?.close();
            this.#server = null;
        }
    }
}
