import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { cpus, release } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import {
    SRP_PROTOCOL,
    type SRPBackend,
    type SRPWorkload,
    type SRPFrameSample
} from '../../benchmarks/srp/contract';
import { srpAllocationBytes, summarizeSRPSamples } from '../../benchmarks/srp/statistics';
import { auditedRHIBenchmarkCommit } from './collect-rhi-benchmark';
import {
    assertRHIPhase0Preflight,
    readRHIPhase0EnvironmentFile,
    rhiPhysicalGpuBrowserArguments
} from './rhi-phase0-preflight';
import { detectedRHIBrowserGpuIdentity } from './rhi-playwright-collector';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha256 = (value: string | Uint8Array): string =>
    createHash('sha256').update(value).digest('hex');

async function phase<T>(work: Promise<T>, name: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            work,
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => {
                    reject(new Error(`SRP ${name} exceeded its 180 second deadline`));
                }, 180000);
            })
        ]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}

async function sourceDigest(): Promise<string> {
    const files = execFileSync(
        'git',
        [
            'ls-files',
            '--cached',
            '--others',
            '--exclude-standard',
            'src',
            'benchmarks/srp',
            'test/performance/fixtures/srp-production.ts',
            'test/performance/fixtures/srp-entry.ts',
            'test/performance/srp.html',
            'scripts/performance',
            'vite.config.ts',
            'package-lock.json'
        ],
        { cwd: root, encoding: 'utf8' }
    )
        .trim()
        .split('\n')
        .sort();
    const hashes = await Promise.all(
        files.map(async path => [path, sha256(await readFile(resolve(root, path)))])
    );
    return sha256(JSON.stringify(hashes));
}

async function protocolDigest(): Promise<string> {
    const files = [
        'benchmarks/srp/contract.ts',
        'benchmarks/srp/statistics.ts',
        'test/performance/srp.html',
        'test/performance/fixtures/srp-entry.ts',
        'test/performance/fixtures/srp-production.ts',
        'scripts/performance/collect-srp-benchmark.ts'
    ];
    const hashes = await Promise.all(
        files.map(async path => [path, sha256(await readFile(resolve(root, path)))])
    );
    return sha256(JSON.stringify(hashes));
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const option = (name: string, fallback: string): string =>
        args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
    const output = resolve(root, option('output', 'reports/srp/candidate.json'));
    if (output.startsWith(`${resolve(root, 'benchmarks')}/`))
        throw new Error('SRP reports cannot overwrite baselines');
    const backend = option('backend', 'webgpu');
    const workload = option('workload', 'custom');
    if (backend !== 'webgpu' && backend !== 'webgl2') throw new Error('Invalid backend');
    if (workload !== 'default' && workload !== 'postprocess' && workload !== 'custom')
        throw new Error('Invalid workload');
    const candidate = args.includes('--candidate');
    const native = args.includes('--native') || candidate;
    const audit = async (): Promise<Awaited<ReturnType<typeof assertRHIPhase0Preflight>>> =>
        assertRHIPhase0Preflight({
            repositoryRoot: root,
            manifestValue: JSON.parse(
                await readFile(resolve(root, 'benchmarks/rhi/manifest.json'), 'utf8')
            ) as unknown,
            environmentValue: await readRHIPhase0EnvironmentFile()
        });
    const preflight = candidate ? await audit() : null;
    const commit = candidate
        ? await auditedRHIBenchmarkCommit(root)
        : execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const dirty =
        execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
            .length > 0;
    const source = await sourceDigest();
    const executable = preflight?.browserExecutablePath ?? chromium.executablePath();
    const browserArgs = native
        ? [...rhiPhysicalGpuBrowserArguments(process.platform)]
        : [
              '--enable-unsafe-swiftshader',
              '--enable-unsafe-webgpu',
              '--use-angle=swiftshader',
              '--use-webgpu-adapter=swiftshader'
          ];
    const server = await createServer({
        root,
        configFile: resolve(root, 'vite.config.ts'),
        server: {
            host: '127.0.0.1',
            port: 0,
            headers: {
                'Cross-Origin-Opener-Policy': 'same-origin',
                'Cross-Origin-Embedder-Policy': 'require-corp'
            }
        },
        logLevel: 'error'
    });
    const rounds: {
        round: number;
        browser: string;
        gpu: unknown;
        gpuIdentity: ReturnType<typeof detectedRHIBrowserGpuIdentity>;
        samples: SRPFrameSample[];
        allocations: { bytes: number; profile: unknown }[];
        pixels: { sha256: string; range: number };
        summary: Record<string, ReturnType<typeof summarizeSRPSamples>>;
    }[] = [];
    try {
        await server.listen();
        const address = server.httpServer?.address();
        if (address === null || address === undefined || typeof address === 'string')
            throw new Error('SRP server unavailable');
        for (let round = 0; round < SRP_PROTOCOL.rounds; round++) {
            process.stderr.write(
                `SRP ${backend}/${workload} round ${String(round + 1)}/${String(SRP_PROTOCOL.rounds)}\n`
            );
            const browser = await chromium.launch({
                executablePath: executable,
                args: browserArgs,
                headless: true
            });
            try {
                const browserSession = await browser.newBrowserCDPSession();
                const gpu: unknown = await browserSession.send('SystemInfo.getInfo');
                const gpuIdentity = detectedRHIBrowserGpuIdentity(gpu);
                if (native && gpuIdentity.fallback)
                    throw new Error('Native SRP capture cannot use a software adapter');
                if (
                    preflight &&
                    (gpuIdentity.fingerprint !== preflight.environment.gpuFingerprint ||
                        gpuIdentity.driver !== preflight.environment.gpuDriver ||
                        browser.version() !== preflight.environment.browserVersion)
                )
                    throw new Error('Live browser/GPU differs from enrolled environment');
                const page = await browser.newPage({
                    viewport: { width: SRP_PROTOCOL.width, height: SRP_PROTOCOL.height },
                    deviceScaleFactor: 1
                });
                const errors: string[] = [];
                page.on('pageerror', error => errors.push(error.message));
                page.on('console', message => {
                    if (message.type() === 'error') errors.push(message.text());
                });
                page.on('requestfailed', request =>
                    errors.push(`Request failed: ${request.url()}`)
                );
                page.on('response', response => {
                    if (response.status() >= 400)
                        errors.push(`HTTP ${String(response.status())}: ${response.url()}`);
                });
                await page.goto(
                    `http://127.0.0.1:${String(address.port)}/test/performance/srp.html?backend=${backend}&workload=${workload}${native ? '&native' : ''}`
                );
                await page.waitForFunction(
                    () => window.__HILO3D_SRP_BENCHMARK__ !== undefined,
                    undefined,
                    { timeout: 120000 }
                );
                const samples = await phase(
                    page.evaluate(async protocol => {
                        const fixture = window.__HILO3D_SRP_BENCHMARK__;
                        if (!fixture) throw new Error('Missing SRP fixture');
                        for (let i = 0; i < protocol.warmupFrames; i++) await fixture.frame();
                        const observations: SRPFrameSample[] = [];
                        for (let i = 0; i < protocol.sampleFrames; i++)
                            observations.push(await fixture.frame());
                        return observations;
                    }, SRP_PROTOCOL),
                    'frame sampling'
                );
                const cdp = await page.context().newCDPSession(page);
                await cdp.send('HeapProfiler.enable');
                const allocations = [];
                for (let i = 0; i < 7 + SRP_PROTOCOL.allocationFrames; i++) {
                    await cdp.send('HeapProfiler.startSampling', {
                        samplingInterval: 1,
                        includeObjectsCollectedByMajorGC: true,
                        includeObjectsCollectedByMinorGC: true
                    });
                    await page.evaluate(() => window.__HILO3D_SRP_BENCHMARK__?.render());
                    const profile: unknown = await phase(
                        cdp.send('HeapProfiler.stopSampling'),
                        'allocation profile'
                    );
                    await page.evaluate(async () => {
                        await window.__HILO3D_SRP_BENCHMARK__?.settle();
                    });
                    if (i >= 7) allocations.push({ bytes: srpAllocationBytes(profile), profile });
                }
                const pixels = await page.evaluate(async () =>
                    window.__HILO3D_SRP_BENCHMARK__?.pixels()
                );
                if (
                    !pixels ||
                    pixels.range < 16 ||
                    samples.some(sample => sample.draws < 1 || sample.submissions !== 1)
                )
                    throw new Error('SRP workload did not render the required output');
                await page.evaluate(async () => window.__HILO3D_SRP_BENCHMARK__?.destroy());
                if (errors.length > 0) throw new Error(errors.join('\n'));
                rounds.push({
                    round,
                    browser: browser.version(),
                    gpu,
                    gpuIdentity,
                    samples,
                    allocations,
                    pixels,
                    summary: {
                        cpuMs: summarizeSRPSamples(samples.map(s => s.cpuMs)),
                        compileMs: summarizeSRPSamples(samples.map(s => s.compileMs)),
                        physicalBytes: summarizeSRPSamples(samples.map(s => s.physicalBytes)),
                        allocationBytes: summarizeSRPSamples(allocations.map(s => s.bytes))
                    }
                });
            } finally {
                await browser.close();
            }
        }
        if (rounds.some(round => round.pixels.sha256 !== rounds[0]?.pixels.sha256))
            throw new Error('SRP pixels changed between independent rounds');
        if ((await sourceDigest()) !== source) throw new Error('Source changed during SRP capture');
        if (candidate) {
            await audit();
            if ((await auditedRHIBenchmarkCommit(root)) !== commit)
                throw new Error('Source commit changed during capture');
        }
        const report = {
            schemaVersion: 1,
            evidence: candidate ? 'unreviewed-candidate' : 'local-diagnostic',
            protocol: SRP_PROTOCOL,
            protocolSha256: await protocolDigest(),
            commit,
            dirty,
            sourceSha256: source,
            backend: backend satisfies SRPBackend,
            workload: workload satisfies SRPWorkload,
            environment: {
                node: process.version,
                platform: process.platform,
                os: release(),
                cpu: cpus()[0]?.model,
                executableSha256: sha256(await readFile(executable)),
                browserArgs,
                enrolled: preflight?.environment ?? null
            },
            rounds
        };
        await mkdir(dirname(output), { recursive: true });
        await writeFile(output, JSON.stringify(report), { flag: 'wx' });
        process.stdout.write(
            `${JSON.stringify(
                {
                    output,
                    evidence: report.evidence,
                    summaries: rounds.map(round => round.summary)
                },
                null,
                2
            )}\n`
        );
    } finally {
        await server.close();
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await main();
}
