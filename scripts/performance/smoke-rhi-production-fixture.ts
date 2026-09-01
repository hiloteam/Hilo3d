import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    chromium,
    type Browser,
    type BrowserContext,
    type CDPSession,
    type Page
} from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import {
    RHI_BENCHMARK_ALLOCATION_SAMPLE_FRAMES,
    RHI_BENCHMARK_RHI_HOT_PATH_ALLOCATION_TODO_BUDGET_BYTES,
    type RendererArchitecture,
    type RHIBenchmarkBackend,
    type RHIBenchmarkManifest,
    type RHIBenchmarkScenarioId,
    type RHIBenchmarkScenarioManifest
} from '../../benchmarks/rhi/result-schema';
import {
    RHI_BENCHMARK_ALLOCATION_DISCARDED_PROFILES,
    RHI_BENCHMARK_ALLOCATION_POST_SUSPEND_WARMUP_FRAMES,
    RHI_BENCHMARK_ALLOCATION_PROFILE_MEASURED_CHUNK_FRAMES,
    RHI_BENCHMARK_ALLOCATION_PROFILER_WARMUP_FRAMES,
    RHI_BENCHMARK_ALLOCATION_PROFILER_QUIESCENCE_PROBE_FRAMES,
    RHI_BENCHMARK_ALLOCATION_PROFILER_RESTART_NOOP_TASKS,
    RHI_BENCHMARK_ALLOCATION_PROFILER_RESTART_RENDER_FRAMES
} from '../../benchmarks/rhi/fixture-contract';
import { RHI_PRODUCTION_FIXTURE_PATH } from './rhi-phase0-preflight';
import {
    profileRHISynchronousAllocationFrames,
    type RHIAllocationHotFrame,
    type RHIProfiledAllocationFrame
} from './rhi-playwright-collector';
import {
    launchRHIOwnedChromium,
    type RHIOwnedChromium,
    type RHIOwnedHeapProfilerSession
} from './rhi-owned-chromium';
import type { RHIBenchmarkAllocationSample } from './rhi-production-collector';
import { canonicalRHIJson, parseRHIBenchmarkManifest } from './verify-rhi-baseline';

export const RHI_PRODUCTION_SMOKE_NON_EVIDENCE_NOTICE =
    'NON-EVIDENCE: fixture smoke never collects, freezes, or verifies wall-clock/GPU baseline data.';

export const RHI_PRODUCTION_SMOKE_SCENARIOS = Object.freeze([
    'static-unlit-single-draw'
] as const satisfies readonly RHIBenchmarkScenarioId[]);

export const RHI_PRODUCTION_SMOKE_BACKENDS = Object.freeze([
    'webgpu',
    'webgl2'
] as const satisfies readonly RHIBenchmarkBackend[]);

const ARCHITECTURES = ['rhi'] as const satisfies readonly RendererArchitecture[];

const SWIFTSHADER_BROWSER_ARGUMENTS = Object.freeze([
    '--enable-precise-memory-info',
    '--enable-unsafe-swiftshader',
    '--enable-unsafe-webgpu',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--use-webgpu-adapter=swiftshader',
    '--enable-dawn-features=allow_unsafe_apis',
    '--disable-dawn-features=use_dxc',
    '--enable-webgpu-developer-features',
    '--use-gpu-in-tests',
    '--enable-accelerated-2d-canvas'
] as const);

export const RHI_PRODUCTION_SMOKE_WARMUP_FRAMES = 30;
export const RHI_PRODUCTION_SMOKE_DISCARDED_ALLOCATION_PROFILES =
    RHI_BENCHMARK_ALLOCATION_DISCARDED_PROFILES;
export const RHI_PRODUCTION_SMOKE_POST_SUSPEND_WARMUP_FRAMES =
    RHI_BENCHMARK_ALLOCATION_POST_SUSPEND_WARMUP_FRAMES;
export const RHI_PRODUCTION_SMOKE_PROFILER_WARMUP_FRAMES =
    RHI_BENCHMARK_ALLOCATION_PROFILER_WARMUP_FRAMES;
export const RHI_PRODUCTION_SMOKE_PROFILER_RESTART_RENDER_FRAMES =
    RHI_BENCHMARK_ALLOCATION_PROFILER_RESTART_RENDER_FRAMES;
export const RHI_PRODUCTION_SMOKE_PROFILER_RESTART_NOOP_TASKS =
    RHI_BENCHMARK_ALLOCATION_PROFILER_RESTART_NOOP_TASKS;
export const RHI_PRODUCTION_SMOKE_PROFILE_MEASURED_CHUNK_FRAMES =
    RHI_BENCHMARK_ALLOCATION_PROFILE_MEASURED_CHUNK_FRAMES;
export const RHI_PRODUCTION_SMOKE_HOT_PATH_TODO_BUDGET_BYTES =
    RHI_BENCHMARK_RHI_HOT_PATH_ALLOCATION_TODO_BUDGET_BYTES;
export const RHI_PRODUCTION_SMOKE_PROFILER_QUIESCENCE_PROBE_FRAMES =
    RHI_BENCHMARK_ALLOCATION_PROFILER_QUIESCENCE_PROBE_FRAMES;
export const RHI_PRODUCTION_SMOKE_MEASURED_ALLOCATION_PROFILES =
    RHI_BENCHMARK_ALLOCATION_SAMPLE_FRAMES;

export interface RHIProductionSmokeAllocationSummary {
    readonly rendererMedianBytes: number;
    readonly rhiHotPathMaximumBytes: number;
    readonly rendererMedianIndex: number;
    readonly hottestFrameIndex: number;
}

/** Fixed odd-sample aggregation used by the in-memory PR allocation gate. */
export function summarizeRHIProductionSmokeAllocations(
    samples: readonly Readonly<RHIBenchmarkAllocationSample>[]
): Readonly<RHIProductionSmokeAllocationSummary> {
    if (samples.length === 0) {
        throw new RangeError('RHI production smoke allocation samples must be non-empty');
    }
    let hottestFrameIndex = 0;
    const rendererRankedIndices = new Array<number>(samples.length);
    for (let index = 0; index < samples.length; index += 1) {
        const sample = samples[index];
        if (
            sample === undefined ||
            !Number.isSafeInteger(sample.rendererBytes) ||
            sample.rendererBytes < 0 ||
            !Number.isSafeInteger(sample.rhiHotPathBytes) ||
            sample.rhiHotPathBytes < 0
        ) {
            throw new RangeError('RHI production smoke allocation sample is invalid');
        }
        rendererRankedIndices[index] = index;
        if (
            sample.rhiHotPathBytes >
            (samples[hottestFrameIndex]?.rhiHotPathBytes ?? Number.NEGATIVE_INFINITY)
        ) {
            hottestFrameIndex = index;
        }
    }
    rendererRankedIndices.sort(
        (first, second) =>
            (samples[first]?.rendererBytes ?? Number.POSITIVE_INFINITY) -
                (samples[second]?.rendererBytes ?? Number.POSITIVE_INFINITY) || first - second
    );
    const rendererMedianIndex = rendererRankedIndices[Math.floor(rendererRankedIndices.length / 2)];
    const median = rendererMedianIndex === undefined ? undefined : samples[rendererMedianIndex];
    const hottest = samples[hottestFrameIndex];
    if (rendererMedianIndex === undefined || median === undefined || hottest === undefined) {
        throw new Error('RHI production smoke allocation aggregation failed');
    }
    return Object.freeze({
        rendererMedianBytes: median.rendererBytes,
        rhiHotPathMaximumBytes: hottest.rhiHotPathBytes,
        rendererMedianIndex,
        hottestFrameIndex
    });
}

interface SmokeObservation {
    readonly architecture: RendererArchitecture;
    readonly actualDrawCount: number;
    readonly pixelHashSha256: string;
    readonly allocation: Readonly<RHIBenchmarkAllocationSample>;
    readonly allocationSamples: readonly Readonly<RHIBenchmarkAllocationSample>[];
    readonly allocationHotFrames: readonly Readonly<RHIAllocationHotFrame>[];
    readonly allocationRendererFrames: readonly Readonly<RHIAllocationHotFrame>[];
    readonly allocationQuiescenceWindows: readonly (readonly Readonly<RHIBenchmarkAllocationSample>[])[];
}

export interface RHIProductionFixtureSmokeOptions {
    readonly repositoryRoot: string;
    readonly scenarioIds?: readonly RHIBenchmarkScenarioId[];
    readonly backends?: readonly RHIBenchmarkBackend[];
    /** NON-EVIDENCE diagnostic selector; only the current RHI architecture is supported. */
    readonly architectures?: readonly RendererArchitecture[];
    readonly launchBrowser?: () => Promise<Browser>;
}

function smokeFailure(message: string): never {
    throw new Error(`RHI production fixture smoke failed: ${message}`);
}

function pageTargetId(value: unknown): string {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        smokeFailure('Target.getTargetInfo response is malformed');
    }
    const targetInfo = (value as Record<string, unknown>)['targetInfo'];
    if (typeof targetInfo !== 'object' || targetInfo === null || Array.isArray(targetInfo)) {
        smokeFailure('Target.getTargetInfo target is malformed');
    }
    const targetId = (targetInfo as Record<string, unknown>)['targetId'];
    if (typeof targetId !== 'string' || targetId.length === 0) {
        smokeFailure('benchmark page target id is unavailable');
    }
    return targetId;
}

interface SmokeBrowserSession {
    readonly browser: Browser;
    readonly ownedBrowser: RHIOwnedChromium | null;
}

async function launchSmokeBrowser(
    options: RHIProductionFixtureSmokeOptions,
    scenario: RHIBenchmarkScenarioManifest,
    backend: RHIBenchmarkBackend
): Promise<SmokeBrowserSession> {
    if (options.launchBrowser) {
        return {
            browser: await options.launchBrowser(),
            ownedBrowser: null
        };
    }
    if (backend === 'webgpu' && scenario.id === 'static-unlit-single-draw') {
        return {
            // Match the stable portable WebGPU test lanes. The bounded single-draw heap profile
            // remains small enough for Playwright CDP; expanded diagnostics retain the raw pipe.
            browser: await chromium.launch({
                headless: true,
                args: [...SWIFTSHADER_BROWSER_ARGUMENTS]
            }),
            ownedBrowser: null
        };
    }
    const ownedBrowser = await launchRHIOwnedChromium({
        // Keep the non-evidence runner aligned with the portable Playwright GPU project.
        args: SWIFTSHADER_BROWSER_ARGUMENTS
    });
    return {
        browser: ownedBrowser.browser,
        ownedBrowser
    };
}

async function closeSmokeBrowser(session: SmokeBrowserSession): Promise<void> {
    if (session.ownedBrowser) {
        await session.ownedBrowser.close();
        return;
    }
    await session.browser.close();
}

async function fixtureReady(page: Page): Promise<void> {
    await page.waitForFunction(
        () =>
            window.__HILO3D_RHI_BENCHMARK__ !== undefined ||
            window.__HILO3D_RHI_BENCHMARK_ERROR__ !== undefined,
        undefined,
        { timeout: 120_000 }
    );
    const error = await page.evaluate(() => window.__HILO3D_RHI_BENCHMARK_ERROR__);
    if (error) smokeFailure(error);
}

async function observeFixture(
    browser: Browser,
    origin: string,
    scenario: RHIBenchmarkScenarioManifest,
    backend: RHIBenchmarkBackend,
    architecture: RendererArchitecture,
    ownedBrowser: RHIOwnedChromium | null
): Promise<SmokeObservation> {
    const context: BrowserContext = await browser.newContext({
        viewport: { width: scenario.quality.width, height: scenario.quality.height },
        deviceScaleFactor: scenario.quality.devicePixelRatio
    });
    const page = await context.newPage();
    const cdp: CDPSession = await context.newCDPSession(page);
    let allocationTransport: RHIOwnedHeapProfilerSession | null = null;
    const query = new URLSearchParams({
        architecture,
        backend,
        scenario: scenario.id,
        round: '1',
        orderPosition: '0',
        adapterPolicy: 'swiftshader'
    });
    try {
        await page.goto(`${origin}/${RHI_PRODUCTION_FIXTURE_PATH}?${query.toString()}`, {
            waitUntil: 'load',
            timeout: 120_000
        });
        await fixtureReady(page);
        allocationTransport = ownedBrowser
            ? await ownedBrowser.createHeapProfilerSession(
                  pageTargetId(await cdp.send('Target.getTargetInfo'))
              )
            : null;
        const allocationCdp: Pick<CDPSession, 'send'> = allocationTransport ?? cdp;
        await page.evaluate(async frameCount => {
            const fixture = window.__HILO3D_RHI_BENCHMARK__;
            if (!fixture) throw new Error('production fixture API is missing');
            await fixture.warmup(frameCount);
        }, RHI_PRODUCTION_SMOKE_WARMUP_FRAMES);
        await allocationCdp.send('HeapProfiler.enable');
        let profiledAllocations: readonly Readonly<RHIProfiledAllocationFrame>[] = [];
        let allocationQuiescenceWindows: readonly (readonly Readonly<RHIBenchmarkAllocationSample>[])[] =
            [];
        let allocationPhaseStarted = false;
        try {
            await page.evaluate(() => {
                const fixture = window.__HILO3D_RHI_BENCHMARK__;
                if (!fixture) throw new Error('production fixture API is missing');
                fixture.beginAllocationSampling();
            });
            allocationPhaseStarted = true;
            await page.evaluate(async frameCount => {
                const fixture = window.__HILO3D_RHI_BENCHMARK__;
                if (!fixture) throw new Error('production fixture API is missing');
                await fixture.warmup(frameCount);
            }, RHI_PRODUCTION_SMOKE_POST_SUSPEND_WARMUP_FRAMES);
            const profileWindow = await profileRHISynchronousAllocationFrames(
                page,
                allocationCdp,
                RHI_PRODUCTION_SMOKE_DISCARDED_ALLOCATION_PROFILES +
                    RHI_PRODUCTION_SMOKE_MEASURED_ALLOCATION_PROFILES,
                true,
                phase => {
                    process.stdout.write(
                        `NON-EVIDENCE smoke progress ${scenario.id}/${backend}/${architecture}: ${phase}\n`
                    );
                }
            );
            profiledAllocations = profileWindow.frames.slice(
                RHI_PRODUCTION_SMOKE_DISCARDED_ALLOCATION_PROFILES
            );
            allocationQuiescenceWindows = profileWindow.quiescenceWindows.map(windowFrames =>
                Object.freeze(windowFrames.map(frame => Object.freeze({ ...frame.sample })))
            );
        } finally {
            try {
                await allocationCdp.send('HeapProfiler.disable');
            } finally {
                if (allocationPhaseStarted) {
                    await page.evaluate(() => {
                        const fixture = window.__HILO3D_RHI_BENCHMARK__;
                        if (!fixture) throw new Error('production fixture API is missing');
                        fixture.endAllocationSampling();
                    });
                }
            }
        }
        const allocationSummary = summarizeRHIProductionSmokeAllocations(
            profiledAllocations.map(frame => frame.sample)
        );
        const hottestFrame = profiledAllocations[allocationSummary.hottestFrameIndex];
        const medianFrame = profiledAllocations[allocationSummary.rendererMedianIndex];
        if (!hottestFrame || !medianFrame) {
            smokeFailure('measured allocation profile matrix is incomplete');
        }
        const allocation = Object.freeze({
            rendererBytes: allocationSummary.rendererMedianBytes,
            rhiHotPathBytes: allocationSummary.rhiHotPathMaximumBytes
        });
        const result = await page.evaluate(async () => {
            const fixture = window.__HILO3D_RHI_BENCHMARK__;
            if (!fixture) throw new Error('production fixture API is missing');
            const samples = await fixture.sampleTimingFrames(1);
            const sample = samples[0];
            if (!sample) throw new Error('fixture smoke frame is missing');
            await fixture.completeRound();
            return {
                metadata: fixture.metadata,
                actualDrawCount: sample.diagnostics.actualDrawCount,
                pixelHashSha256: await fixture.capturePixelHash()
            };
        });
        if (result.metadata.scenarioId !== scenario.id || result.metadata.backend !== backend) {
            smokeFailure(`${scenario.id}/${backend}/${architecture} metadata identity differs`);
        }
        if (canonicalRHIJson(result.metadata.quality) !== canonicalRHIJson(scenario.quality)) {
            smokeFailure(`${scenario.id}/${backend}/${architecture} quality differs from manifest`);
        }
        if (result.actualDrawCount !== scenario.quality.drawCount) {
            smokeFailure(
                `${scenario.id}/${backend}/${architecture} observed ${String(result.actualDrawCount)} draws; expected ${String(scenario.quality.drawCount)}`
            );
        }
        if (!/^[a-f0-9]{64}$/u.test(result.pixelHashSha256)) {
            smokeFailure(`${scenario.id}/${backend}/${architecture} pixel hash is malformed`);
        }
        return {
            architecture,
            actualDrawCount: result.actualDrawCount,
            pixelHashSha256: result.pixelHashSha256,
            allocation,
            allocationSamples: Object.freeze(
                profiledAllocations.map(frame => Object.freeze({ ...frame.sample }))
            ),
            allocationHotFrames: hottestFrame.hotFrames,
            allocationRendererFrames: medianFrame.rendererFrames,
            allocationQuiescenceWindows: Object.freeze(allocationQuiescenceWindows)
        };
    } finally {
        await page
            .evaluate(async () => window.__HILO3D_RHI_BENCHMARK__?.destroy())
            .catch(() => undefined);
        try {
            await allocationTransport?.close();
        } finally {
            await context.close();
        }
    }
}

function selectedScenarios(
    manifest: RHIBenchmarkManifest,
    scenarioIds: readonly RHIBenchmarkScenarioId[]
): readonly RHIBenchmarkScenarioManifest[] {
    return scenarioIds.map(id => {
        const scenario = manifest.scenarios.find(candidate => candidate.id === id);
        if (!scenario) smokeFailure(`manifest scenario ${id} is missing`);
        return scenario;
    });
}

/**
 * Exercise production fixture initialization and minimal rendering without the enrolled-rig
 * preflight. Results remain in memory and are deliberately unsuitable as performance evidence.
 */
export async function runRHIProductionFixtureSmoke(
    options: RHIProductionFixtureSmokeOptions
): Promise<void> {
    const repositoryRoot = resolve(options.repositoryRoot);
    const manifest = parseRHIBenchmarkManifest(
        JSON.parse(
            await readFile(resolve(repositoryRoot, 'benchmarks/rhi/manifest.json'), 'utf8')
        ) as unknown
    );
    const scenarios = selectedScenarios(
        manifest,
        options.scenarioIds ?? RHI_PRODUCTION_SMOKE_SCENARIOS
    );
    const backends = options.backends ?? RHI_PRODUCTION_SMOKE_BACKENDS;
    const architectures = options.architectures ?? ARCHITECTURES;
    if (architectures.length !== 1 || architectures[0] !== 'rhi') {
        smokeFailure('architecture selector must contain only rhi');
    }
    const server: ViteDevServer = await createServer({
        root: repositoryRoot,
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
    try {
        await server.listen();
        const localOrigin = server.resolvedUrls?.local[0];
        if (!localOrigin) smokeFailure('Vite did not publish a loopback origin');
        const origin = localOrigin.replace(/\/$/u, '');
        for (const scenario of scenarios) {
            for (const backend of backends) {
                const browserSession = await launchSmokeBrowser(options, scenario, backend);
                let observation: SmokeObservation;
                try {
                    observation = await observeFixture(
                        browserSession.browser,
                        origin,
                        scenario,
                        backend,
                        architectures[0],
                        browserSession.ownedBrowser
                    );
                } finally {
                    await closeSmokeBrowser(browserSession);
                }
                const quiescenceMatrix = observation.allocationQuiescenceWindows
                    .map(
                        windowSamples =>
                            `[${windowSamples
                                .map(sample => String(sample.rhiHotPathBytes))
                                .join(',')}]`
                    )
                    .join(',');
                const hotVector = observation.allocationSamples
                    .map(sample => String(sample.rhiHotPathBytes))
                    .join(',');
                const rendererVector = observation.allocationSamples
                    .map(sample => String(sample.rendererBytes))
                    .join(',');
                process.stdout.write(
                    `NON-EVIDENCE smoke ${scenario.id}/${backend}/rhi: quiescence=[${quiescenceMatrix}], hot=[${hotVector}], renderer=[${rendererVector}], rendererMedian=${String(observation.allocation.rendererBytes)}, pixels=${observation.pixelHashSha256}\n`
                );
                if (
                    scenario.id === 'static-unlit-single-draw' &&
                    observation.allocation.rhiHotPathBytes >
                        RHI_BENCHMARK_RHI_HOT_PATH_ALLOCATION_TODO_BUDGET_BYTES
                ) {
                    const samples = observation.allocationSamples
                        .map(sample => String(sample.rhiHotPathBytes))
                        .join(', ');
                    const detail = observation.allocationHotFrames
                        .map(frame => `${String(frame.bytes)} ${frame.frame}`)
                        .join('\n');
                    smokeFailure(
                        `${scenario.id}/${backend} RHI hot draw/context allocation ${String(observation.allocation.rhiHotPathBytes)} exceeds the temporary ${String(RHI_BENCHMARK_RHI_HOT_PATH_ALLOCATION_TODO_BUDGET_BYTES)}-byte TODO budget; measured hot bytes [${samples}]${detail.length === 0 ? '' : `:\n${detail}`}`
                    );
                }
            }
        }
    } finally {
        await server.close();
    }
}

async function main(): Promise<void> {
    const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
    const allScenarios = process.argv.includes('--all');
    const requestedScenario = process.argv
        .find(argument => argument.startsWith('--scenario='))
        ?.slice('--scenario='.length);
    const requestedBackend = process.argv
        .find(argument => argument.startsWith('--backend='))
        ?.slice('--backend='.length);
    const requestedArchitecture = process.argv
        .find(argument => argument.startsWith('--architecture='))
        ?.slice('--architecture='.length);
    if (
        requestedBackend !== undefined &&
        requestedBackend !== 'webgl2' &&
        requestedBackend !== 'webgpu'
    ) {
        smokeFailure(`unknown backend ${requestedBackend}`);
    }
    if (requestedArchitecture !== undefined && requestedArchitecture !== 'rhi') {
        smokeFailure(`unknown architecture ${requestedArchitecture}`);
    }
    const manifest =
        allScenarios || requestedScenario !== undefined
            ? parseRHIBenchmarkManifest(
                  JSON.parse(
                      await readFile(
                          resolve(repositoryRoot, 'benchmarks/rhi/manifest.json'),
                          'utf8'
                      )
                  ) as unknown
              )
            : null;
    const scenarioIds =
        manifest === null
            ? undefined
            : allScenarios
              ? manifest.scenarios.map(scenario => scenario.id)
              : manifest.scenarios.some(scenario => scenario.id === requestedScenario)
                ? [requestedScenario as RHIBenchmarkScenarioId]
                : smokeFailure(`unknown scenario ${String(requestedScenario)}`);
    process.stdout.write(`${RHI_PRODUCTION_SMOKE_NON_EVIDENCE_NOTICE}\n`);
    await runRHIProductionFixtureSmoke({
        repositoryRoot,
        ...(scenarioIds === undefined ? {} : { scenarioIds }),
        ...(requestedBackend === undefined
            ? {}
            : { backends: [requestedBackend] as readonly RHIBenchmarkBackend[] }),
        ...(requestedArchitecture === undefined
            ? {}
            : {
                  architectures: [requestedArchitecture] as readonly RendererArchitecture[]
              })
    });
    process.stdout.write(
        'RHI production fixture smoke passed. No evidence artifact was written.\n'
    );
}

const invokedDirectly = process.argv.some(argument => {
    try {
        return resolve(argument) === fileURLToPath(import.meta.url);
    } catch {
        return false;
    }
});

if (invokedDirectly) {
    void main().catch((error: unknown) => {
        const message =
            error instanceof Error
                ? (error.stack ?? `${error.name}: ${error.message}`)
                : String(error);
        process.stderr.write(`${message}\n`);
        process.exitCode = 1;
    });
}
