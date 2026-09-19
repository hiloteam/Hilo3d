import { execFile } from 'node:child_process';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PNG } from 'pngjs';
import type { Page } from 'playwright';
import {
    DDGI_EVIDENCE_PROTOCOL,
    type DDGIEvidenceFixture,
    type DDGIEvidenceFrame,
    type DDGIEvidenceMode
} from '../../benchmarks/ddgi/fixture-contract';
import type { RHIBenchmarkEnvironment } from '../../benchmarks/rhi/result-schema';
import { auditedRHIBenchmarkCommit } from './collect-rhi-benchmark';
import { detectedRHIBrowserGpuIdentity } from './rhi-playwright-collector';
import { launchRHIOwnedChromium } from './rhi-owned-chromium';
import {
    assertRHIPhase0Preflight,
    readRHIPhase0EnvironmentFile,
    rhiPhysicalGpuBrowserArguments,
    type RHIPhase0PreflightResult
} from './rhi-phase0-preflight';
import { canonicalRHIJson, sha256 } from './verify-rhi-baseline';

const runFile = promisify(execFile);
const WIDTH = 960;
const HEIGHT = 600;
const WARMUP_FRAMES = 64;
const SAMPLE_FRAMES = 120;
const ROUND_COUNT = 3;
const FIXTURE_PATH = '/examples/dynamic_global_illumination_atelier.html';
const PIXEL_REGION = { x: 269, y: 144, width: 528, height: 276 } as const;

interface Arguments {
    readonly output: string;
    readonly url: string;
}
interface Summary {
    readonly count: number;
    readonly minimum: number;
    readonly median: number;
    readonly p95: number;
    readonly maximum: number;
    readonly mean: number;
}
interface Round {
    readonly round: number;
    readonly order: number;
    readonly mode: DDGIEvidenceMode;
    readonly samples: readonly DDGIEvidenceFrame[];
    readonly pixelSha256: string;
    readonly pixelRange: number;
    readonly cpuRecordMs: Summary;
    readonly fenceWaitMs: Summary;
    readonly gpuPassTimeSumMs: Summary;
    readonly ddgiGpuPassTimeSumMs: Summary;
}
type FixtureWindow = Window & { __HILO3D_ATELIER_BENCHMARK__?: DDGIEvidenceFixture };

/** Restrict collection to the known local application entry, with no credentials or arbitrary path. */
export function validatedDDGIEvidenceURL(value: string): URL {
    const url = new URL(value);
    if (
        url.protocol !== 'http:' ||
        !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
        url.username !== '' ||
        url.password !== '' ||
        url.pathname !== FIXTURE_PATH ||
        url.hash !== '' ||
        url.search !== ''
    ) {
        throw new Error(`DDGI collection requires an unparameterized loopback ${FIXTURE_PATH} URL`);
    }
    return url;
}

/** Reject invalid values rather than publishing fabricated zero timings. */
export function summarizeDDGISamples(values: readonly number[]): Summary {
    if (values.length === 0 || values.some(value => !Number.isFinite(value) || value < 0)) {
        throw new Error('DDGI summaries require nonempty finite nonnegative observations');
    }
    const sorted = [...values].sort((a, b) => a - b);
    const at = (index: number): number => {
        const value = sorted[index];
        if (value === undefined) throw new Error('DDGI quantile is missing');
        return value;
    };
    return {
        count: sorted.length,
        minimum: at(0),
        median:
            sorted.length % 2 === 0
                ? (at(sorted.length / 2 - 1) + at(sorted.length / 2)) / 2
                : at(Math.floor(sorted.length / 2)),
        p95: at(Math.ceil(sorted.length * 0.95) - 1),
        maximum: at(sorted.length - 1),
        mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length
    };
}

/** Prove real submitted draws, exact GI mode, and resolved native timestamps per measured frame. */
export function validateDDGIEvidenceFrame(frame: DDGIEvidenceFrame, mode: DDGIEvidenceMode): void {
    if (!Number.isSafeInteger(frame.measurementIndex) || frame.measurementIndex < 0) {
        throw new Error('DDGI measurement index is invalid');
    }
    if (!Number.isSafeInteger(frame.frameIndex) || frame.frameIndex < 0) {
        throw new Error('DDGI frame index is invalid');
    }
    summarizeDDGISamples([
        frame.cpuRecordMs,
        frame.fenceWaitMs,
        frame.timestampReadbackWaitMs,
        frame.diagnosticReadbackMs,
        frame.graphRecordMs,
        frame.graphCompileMs,
        frame.graphPrepareMs,
        frame.graphExecuteMs,
        frame.gpuPassTimeSumMs
    ]);
    if (frame.commands.submissions < 1 || frame.commands.draws + frame.commands.indirectDraws < 1) {
        throw new Error('DDGI evidence requires actual draws and submission');
    }
    const timedPasses = frame.gpuPasses.filter(pass => pass.kind !== null);
    if (
        timedPasses.length === 0 ||
        timedPasses.some(
            pass =>
                pass.gpuDurationMs === null ||
                !Number.isFinite(pass.gpuDurationMs) ||
                pass.gpuDurationMs < 0
        )
    ) {
        throw new Error('DDGI evidence requires genuine timestamps for every timed pass');
    }
    const sum = timedPasses.reduce((total, pass) => total + (pass.gpuDurationMs ?? 0), 0);
    if (sum <= 0 || Math.abs(sum - frame.gpuPassTimeSumMs) > 1e-6) {
        throw new Error('DDGI GPU pass sum does not match resolved native timestamps');
    }
    const gi = frame.dynamicGlobalIllumination;
    if (mode === 'disabled') {
        if (gi !== null || frame.gpuPasses.some(pass => pass.name.startsWith('DDGI'))) {
            throw new Error(
                'Disabled DDGI must remove its runtime and compute passes, not only intensity'
            );
        }
    } else if (
        gi?.probeCount !== 315 ||
        gi.updatedProbeCount !== 48 ||
        gi.tracedRayCount !== 6144 ||
        gi.sceneTriangleCount !== 27312 ||
        gi.excludedMeshCount !== 0 ||
        gi.excludedLightCount !== 0 ||
        gi.texturedMeshCount !== 0 ||
        gi.uploadedBytes <= 0 ||
        !frame.gpuPasses.some(pass => pass.name.startsWith('DDGI'))
    ) {
        throw new Error('DDGI fixture geometry, probe budget, upload or coverage contract differs');
    }
}

function inside(root: string, path: string): boolean {
    const child = relative(root, path);
    return child === '' || (child !== '..' && !child.startsWith(`..${sep}`));
}

/** Noise gate only: a stable competing workload can still evade this check and needs operator review. */
export function validateDDGIEvidenceStability(
    captures: readonly Readonly<{
        mode: DDGIEvidenceMode;
        cpuRecordMs: Summary;
        gpuPassTimeSumMs: Summary;
    }>[]
): void {
    for (const mode of ['enabled', 'disabled'] as const) {
        const rounds = captures.filter(capture => capture.mode === mode);
        if (rounds.length !== ROUND_COUNT)
            throw new Error('DDGI stability requires three isolated rounds per mode');
        for (const metric of ['cpuRecordMs', 'gpuPassTimeSumMs'] as const) {
            const medians = summarizeDDGISamples(rounds.map(round => round[metric].median));
            if (
                medians.minimum <= 0 ||
                medians.maximum / medians.minimum > 1.3 ||
                rounds.some(round => round[metric].p95 > round[metric].median * 3)
            ) {
                throw new Error(
                    `DDGI ${mode} ${metric} is unstable; quiesce competing workloads and capture a fresh report`
                );
            }
        }
    }
}

function argumentsFrom(values: readonly string[]): Arguments {
    let output: string | undefined;
    let url = `http://127.0.0.1:4173${FIXTURE_PATH}`;
    for (let index = 0; index < values.length; index++) {
        const flag = values[index];
        const value = values[++index];
        if (value === undefined) throw new Error(`Missing value for ${String(flag)}`);
        if (flag === '--output' && output === undefined) output = value;
        else if (flag === '--url') url = value;
        else throw new Error(`Unknown or duplicate DDGI argument ${String(flag)}`);
    }
    if (output === undefined) {
        throw new Error(
            'Usage: npm run benchmark:ddgi:collect -- --output /fresh/report.json [--url http://127.0.0.1:4173/examples/dynamic_global_illumination_atelier.html]'
        );
    }
    validatedDDGIEvidenceURL(url);
    return { output: resolve(output), url };
}

async function fixtureFiles(repositoryRoot: string): Promise<Readonly<Record<string, string>>> {
    const paths = [
        'examples/dynamic_global_illumination_atelier.html',
        'examples/dynamic_global_illumination_atelier.ts',
        'examples/dynamic_global_illumination_atelier.css',
        'examples/models/Atelier/afternoon-atelier.glb',
        'src/render/pipeline/ClusteredForwardPlus.ts',
        'src/render/renderer/MeshDrawProcessor.ts',
        'src/render/postprocessing/ScreenSpaceGlobalIllumination.ts',
        'src/shader/chunk/dynamicGlobalIllumination.frag',
        'benchmarks/ddgi/fixture-contract.ts',
        'scripts/performance/collect-ddgi-evidence.ts',
        'package-lock.json'
    ];
    const visit = async (directory: string): Promise<void> => {
        for (const entry of await readdir(resolve(repositoryRoot, directory), {
            withFileTypes: true
        })) {
            const path = `${directory}/${entry.name}`;
            if (entry.isDirectory()) await visit(path);
            else if (entry.isFile()) paths.push(path);
        }
    };
    await visit('src/render/gi');
    const result: Record<string, string> = {};
    for (const path of paths.sort())
        result[path] = sha256(await readFile(resolve(repositoryRoot, path)));
    return result;
}

function scenePixels(png: PNG): Uint8Array {
    if (png.width !== WIDTH || png.height !== HEIGHT) throw new Error('DDGI pixel extent differs');
    const result = new Uint8Array(PIXEL_REGION.width * PIXEL_REGION.height * 3);
    let output = 0;
    for (let y = PIXEL_REGION.y; y < PIXEL_REGION.y + PIXEL_REGION.height; y++) {
        for (let x = PIXEL_REGION.x; x < PIXEL_REGION.x + PIXEL_REGION.width; x++) {
            const pixel = (y * png.width + x) * 4;
            for (let channel = 0; channel < 3; channel++)
                result[output++] = png.data[pixel + channel] ?? 0;
        }
    }
    return result;
}

async function measure(page: Page): Promise<DDGIEvidenceFrame> {
    return page.evaluate(async () => {
        const fixture = (window as FixtureWindow).__HILO3D_ATELIER_BENCHMARK__;
        if (fixture === undefined) throw new Error('DDGI benchmark hook is unavailable');
        return fixture.measureFrame();
    });
}

async function collectRound(
    repositoryRoot: string,
    preflight: RHIPhase0PreflightResult,
    urlValue: string,
    mode: DDGIEvidenceMode,
    round: number,
    order: number,
    served: Map<string, string>
): Promise<{ readonly result: Round; readonly pixels: Uint8Array }> {
    const owned = await launchRHIOwnedChromium({
        executablePath: preflight.browserExecutablePath,
        args: rhiPhysicalGpuBrowserArguments(process.platform)
    });
    const errors: string[] = [];
    try {
        const browser = owned.browser;
        const browserCdp = await browser.newBrowserCDPSession();
        const gpu = detectedRHIBrowserGpuIdentity(await browserCdp.send('SystemInfo.getInfo'));
        const expected = preflight.environment;
        if (
            gpu.fallback ||
            gpu.fingerprint !== expected.gpuFingerprint ||
            gpu.driver !== expected.gpuDriver ||
            browser.version() !== expected.browserVersion
        ) {
            throw new Error(
                'DDGI Chromium GPU/browser identity differs from the enrolled physical rig'
            );
        }
        const url = validatedDDGIEvidenceURL(urlValue);
        url.searchParams.set('backend', 'webgpu');
        url.searchParams.set('benchmark', '1');
        url.searchParams.set('time', 'night');
        url.searchParams.set('ddgi', mode === 'enabled' ? '1' : '0');
        const context = await browser.newContext({
            viewport: { width: WIDTH, height: HEIGHT },
            deviceScaleFactor: 1,
            serviceWorkers: 'block'
        });
        const buildRoot = resolve(repositoryRoot, 'dist-examples');
        await context.route('**/*', async route => {
            try {
                const requestURL = new URL(route.request().url());
                const localPath = resolve(buildRoot, `.${decodeURIComponent(requestURL.pathname)}`);
                if (requestURL.origin !== url.origin || !inside(buildRoot, localPath)) {
                    throw new Error('DDGI preview requested a non-fixture network resource');
                }
                const response = await route.fetch({ maxRedirects: 0, timeout: 30_000 });
                const bytes = await response.body();
                const digest = sha256(bytes);
                if (response.status() !== 200 || digest !== sha256(await readFile(localPath))) {
                    throw new Error(
                        `DDGI preview differs from fresh build: ${requestURL.pathname}`
                    );
                }
                const previous = served.get(requestURL.pathname);
                if (previous !== undefined && previous !== digest)
                    throw new Error('DDGI served artifact changed during collection');
                served.set(requestURL.pathname, digest);
                await route.fulfill({
                    response,
                    body: bytes,
                    headers: {
                        ...response.headers(),
                        'cross-origin-opener-policy': 'same-origin',
                        'cross-origin-embedder-policy': 'require-corp'
                    }
                });
            } catch (error) {
                errors.push(error instanceof Error ? error.message : String(error));
                await route.abort();
            }
        });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => {
            if (message.type() === 'error') errors.push(message.text());
        });
        page.setDefaultTimeout(120_000);
        await page.goto(url.href, { waitUntil: 'load' });
        await page.waitForFunction(
            () => document.body.dataset['atelierReady'] !== undefined,
            undefined,
            { timeout: 120_000 }
        );
        const metadata = await page.evaluate(
            (): {
                protocol: string;
                mode: string;
                timeOfDay: string;
                width: number;
                height: number;
                isolated: boolean;
            } => {
                const fixture = (window as FixtureWindow).__HILO3D_ATELIER_BENCHMARK__;
                if (document.body.dataset['atelierReady'] !== 'true' || fixture === undefined) {
                    throw new Error(
                        document.getElementById('loadingDetail')?.textContent ??
                            'DDGI benchmark failed to initialize'
                    );
                }
                return {
                    protocol: fixture.protocol,
                    mode: fixture.mode,
                    timeOfDay: fixture.timeOfDay,
                    width: fixture.width,
                    height: fixture.height,
                    isolated: fixture.crossOriginIsolated
                };
            }
        );
        if (
            metadata.protocol !== DDGI_EVIDENCE_PROTOCOL ||
            metadata.mode !== mode ||
            metadata.timeOfDay !== 'night' ||
            metadata.width !== WIDTH ||
            metadata.height !== HEIGHT ||
            !metadata.isolated
        ) {
            throw new Error(
                'DDGI benchmark fixture protocol, mode, extent or clock isolation differs'
            );
        }
        for (let frame = 0; frame < WARMUP_FRAMES; frame++)
            validateDDGIEvidenceFrame(await measure(page), mode);
        const samples: DDGIEvidenceFrame[] = [];
        for (let frame = 0; frame < SAMPLE_FRAMES; frame++) {
            const sample = await measure(page);
            validateDDGIEvidenceFrame(sample, mode);
            const previous = samples.at(-1);
            if (
                previous !== undefined &&
                (sample.measurementIndex !== previous.measurementIndex + 1 ||
                    sample.frameIndex <= previous.frameIndex)
            ) {
                throw new Error('Uncontrolled rendering advanced the DDGI frame sequence');
            }
            samples.push(sample);
        }
        const pixels = scenePixels(PNG.sync.read(await page.locator('canvas').screenshot()));
        let minimum = 255;
        let maximum = 0;
        for (const value of pixels) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
        }
        if (maximum - minimum < 64) throw new Error('DDGI scene pixels are empty or uniform');
        await page.evaluate(async () => {
            await (window as FixtureWindow).__HILO3D_ATELIER_BENCHMARK__?.dispose();
        });
        await page.waitForTimeout(100);
        if (errors.length > 0)
            throw new Error(`DDGI browser errors, including teardown: ${errors.join('; ')}`);
        return {
            pixels,
            result: {
                round,
                order,
                mode,
                samples,
                pixelSha256: sha256(pixels),
                pixelRange: maximum - minimum,
                cpuRecordMs: summarizeDDGISamples(samples.map(frame => frame.cpuRecordMs)),
                fenceWaitMs: summarizeDDGISamples(samples.map(frame => frame.fenceWaitMs)),
                gpuPassTimeSumMs: summarizeDDGISamples(
                    samples.map(frame => frame.gpuPassTimeSumMs)
                ),
                ddgiGpuPassTimeSumMs: summarizeDDGISamples(
                    samples.map(frame =>
                        frame.gpuPasses
                            .filter(pass => pass.name.startsWith('DDGI'))
                            .reduce((sum, pass) => sum + (pass.gpuDurationMs ?? 0), 0)
                    )
                )
            }
        };
    } finally {
        await owned.close();
    }
}

async function main(): Promise<void> {
    const options = argumentsFrom(process.argv.slice(2));
    const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
    if (inside(resolve(repositoryRoot, 'benchmarks'), options.output)) {
        throw new Error(
            'DDGI collector writes fresh reports only; it cannot alter reviewed or frozen benchmarks'
        );
    }
    try {
        await access(options.output);
        throw new Error('DDGI output already exists');
    } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
    const commitSha = await auditedRHIBenchmarkCommit(repositoryRoot);
    const manifestValue: unknown = JSON.parse(
        await readFile(resolve(repositoryRoot, 'benchmarks/rhi/manifest.json'), 'utf8')
    );
    const environmentValue = await readRHIPhase0EnvironmentFile();
    const preflight = await assertRHIPhase0Preflight({
        repositoryRoot,
        manifestValue,
        environmentValue
    });
    const sources = await fixtureFiles(repositoryRoot);
    const sourceSha256 = sha256(canonicalRHIJson(sources));
    const workloadFiles = Object.fromEntries(
        Object.entries(sources).filter(
            ([path]) =>
                path.startsWith('examples/') ||
                path.startsWith('benchmarks/ddgi/') ||
                path === 'scripts/performance/collect-ddgi-evidence.ts'
        )
    );
    const implementationFiles = Object.fromEntries(
        Object.entries(sources).filter(([path]) => !(path in workloadFiles))
    );
    process.stderr.write('Building the audited committed source before native DDGI capture…\n');
    await runFile(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'examples:build'], {
        cwd: repositoryRoot,
        timeout: 300_000,
        maxBuffer: 8 * 1024 * 1024
    });
    const results: Round[] = [];
    const served = new Map<string, string>();
    const pixelContrasts: number[] = [];
    for (let round = 0; round < ROUND_COUNT; round++) {
        const modes: readonly DDGIEvidenceMode[] =
            round % 2 === 0 ? ['enabled', 'disabled'] : ['disabled', 'enabled'];
        const pixels: Uint8Array[] = [];
        for (const [order, mode] of modes.entries()) {
            process.stderr.write(
                `DDGI round ${String(round + 1)}/${String(ROUND_COUNT)}: ${mode}\n`
            );
            const capture = await collectRound(
                repositoryRoot,
                preflight,
                options.url,
                mode,
                round + 1,
                order + 1,
                served
            );
            results.push(capture.result);
            pixels.push(capture.pixels);
        }
        const first = pixels[0];
        const second = pixels[1];
        if (first === undefined || second === undefined)
            throw new Error('DDGI pixel pair is missing');
        let changed = 0;
        for (let index = 0; index < first.length; index += 3) {
            if (
                [0, 1, 2].some(
                    channel =>
                        Math.abs((first[index + channel] ?? 0) - (second[index + channel] ?? 0)) > 6
                )
            )
                changed++;
        }
        const fraction = changed / (first.length / 3);
        if (fraction < 0.005)
            throw new Error(
                'DDGI enabled/disabled scene pixels do not show a meaningful difference'
            );
        pixelContrasts.push(fraction);
    }
    validateDDGIEvidenceStability(results);
    if (
        (await auditedRHIBenchmarkCommit(repositoryRoot)) !== commitSha ||
        sha256(canonicalRHIJson(await fixtureFiles(repositoryRoot))) !== sourceSha256
    ) {
        throw new Error('DDGI committed source changed during collection');
    }
    await assertRHIPhase0Preflight({ repositoryRoot, manifestValue, environmentValue });
    const environment: RHIBenchmarkEnvironment = preflight.environment;
    const servedArtifacts = Object.fromEntries(
        [...served.entries()].sort(([a], [b]) => a.localeCompare(b))
    );
    const report = {
        protocol: DDGI_EVIDENCE_PROTOCOL,
        status: 'baseline-candidate-requires-independent-review',
        capturedAt: new Date().toISOString(),
        commitSha,
        environment,
        fixture: {
            workloadSha256: sha256(canonicalRHIJson(workloadFiles)),
            workloadFiles,
            implementationSha256: sha256(canonicalRHIJson(implementationFiles)),
            implementationFiles,
            sourceSha256,
            sourceFiles: sources,
            servedArtifactSha256: sha256(canonicalRHIJson(servedArtifacts)),
            servedArtifacts
        },
        methodology: {
            width: WIDTH,
            height: HEIGHT,
            warmupFrames: WARMUP_FRAMES,
            measuredFrames: SAMPLE_FRAMES,
            roundsPerMode: ROUND_COUNT,
            timeOfDay: 'night',
            browserIsolation: 'new owned Chromium process for every round and mode',
            externalWorkloads:
                'operator must quiesce other GPU applications; this collector cannot prove absence of external load',
            stabilityGate:
                'CPU/GPU pass-time round median max/min ≤1.30; each round p95/median ≤3.0',
            modeDifference:
                'DDGI runtime and ray/probe passes enabled versus absent; intensity-only toggles are forbidden',
            gpuMetric:
                'sum of genuine pass timestamps; excludes inter-pass gaps and is not end-to-end GPU frame time',
            timingBoundary:
                'CPU stage.tick then queue-fence wait; timestamp and diagnostic readbacks excluded',
            workloads:
                'static atelier; startup, motion, material churn, upload stress and tail latency are not release-qualified by this report',
            pixelRegion: PIXEL_REGION
        },
        pixelContrasts,
        captures: results
    };
    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`DDGI candidate evidence written to ${options.output}\n`);
}

if (process.argv.some(argument => resolve(argument) === fileURLToPath(import.meta.url)))
    await main();
