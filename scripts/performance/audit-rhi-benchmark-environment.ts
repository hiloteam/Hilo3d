import { cpus, release } from 'node:os';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type { RHIBenchmarkEnvironment } from '../../benchmarks/rhi-v2/result-schema';
import { detectedRHIBrowserGpuIdentity } from './rhi-playwright-collector';
import {
    parseRHIBenchmarkManifest,
    rhiBenchmarkEnvironmentFingerprint,
    sha256
} from './verify-rhi-baseline';
import {
    RHI_PHASE0_BROWSER_EXECUTABLE_VARIABLE,
    detectRHIFixedPowerProfile
} from './rhi-phase0-preflight';

function auditFailure(message: string): never {
    throw new Error(`RHI performance-rig audit failed: ${message}`);
}

async function installedPlaywrightVersion(repositoryRoot: string): Promise<string> {
    const value = JSON.parse(
        await readFile(resolve(repositoryRoot, 'node_modules/playwright/package.json'), 'utf8')
    ) as unknown;
    const version =
        typeof value === 'object' && value !== null
            ? (value as Record<string, unknown>)['version']
            : undefined;
    if (typeof version !== 'string' || version.length === 0) {
        auditFailure('installed Playwright package metadata is invalid');
    }
    return version;
}

async function main(): Promise<void> {
    if (process.platform !== 'linux') {
        auditFailure('environment candidates may only be generated on the dedicated Linux rig');
    }
    try {
        await detectRHIFixedPowerProfile();
    } catch (error) {
        auditFailure(error instanceof Error ? error.message : String(error));
    }
    const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
    const manifest = parseRHIBenchmarkManifest(
        JSON.parse(
            await readFile(resolve(repositoryRoot, 'benchmarks/rhi-v2/manifest.json'), 'utf8')
        ) as unknown
    );
    const playwrightVersion = await installedPlaywrightVersion(repositoryRoot);
    if (playwrightVersion !== manifest.rig.playwrightVersion) {
        auditFailure('installed Playwright version differs from the frozen manifest');
    }
    if (process.versions.node !== manifest.rig.nodeVersion) {
        auditFailure('running Node version differs from the frozen manifest');
    }
    const browserExecutablePath = process.env[RHI_PHASE0_BROWSER_EXECUTABLE_VARIABLE];
    if (!browserExecutablePath) {
        auditFailure(`${RHI_PHASE0_BROWSER_EXECUTABLE_VARIABLE} must name Chromium`);
    }
    const browserExecutableSha256 = sha256(await readFile(resolve(browserExecutablePath)));
    const browser = await chromium.launch({
        executablePath: resolve(browserExecutablePath),
        headless: true,
        args: ['--enable-precise-memory-info', '--enable-unsafe-webgpu']
    });
    try {
        const browserCdp = await browser.newBrowserCDPSession();
        const gpu = detectedRHIBrowserGpuIdentity(await browserCdp.send('SystemInfo.getInfo'));
        if (gpu.fallback) auditFailure('Chromium selected a software/fallback GPU adapter');
        const page = await browser.newPage();
        const capabilities = await page.evaluate(async () => {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl2');
            const webGLTimer =
                gl !== null && gl.getExtension('EXT_disjoint_timer_query_webgl2') !== null;
            const adapter = await navigator.gpu.requestAdapter({
                powerPreference: 'high-performance',
                forceFallbackAdapter: false
            });
            const webGPUTimer = adapter?.features.has('timestamp-query') === true;
            if (adapter && webGPUTimer) {
                const device = await adapter.requestDevice({
                    requiredFeatures: ['timestamp-query']
                });
                device.destroy();
            }
            const memory = (
                performance as Performance & {
                    readonly memory?: unknown;
                }
            ).memory;
            const preciseMemory =
                typeof memory === 'object' &&
                memory !== null &&
                typeof (memory as Record<string, unknown>)['usedJSHeapSize'] === 'number';
            return { gpuTimer: webGLTimer && webGPUTimer, preciseMemory };
        });
        const pageCdp = await page.context().newCDPSession(page);
        let allocationProfiler = false;
        await pageCdp.send('HeapProfiler.enable');
        try {
            await pageCdp.send('HeapProfiler.startSampling', {
                samplingInterval: 1,
                includeObjectsCollectedByMajorGC: true,
                includeObjectsCollectedByMinorGC: true
            });
            await page.evaluate(() => Array.from({ length: 128 }, (_, index) => ({ index })));
            const result = await pageCdp.send('HeapProfiler.stopSampling');
            const profile: unknown = (result as { readonly profile?: unknown }).profile;
            allocationProfiler = typeof profile === 'object' && profile !== null;
        } finally {
            await pageCdp.send('HeapProfiler.disable');
        }
        if (!capabilities.gpuTimer) auditFailure('both backend GPU timers are required');
        if (!capabilities.preciseMemory) auditFailure('Chromium precise memory is required');
        if (!allocationProfiler) auditFailure('Chromium allocation profiler is required');
        const cpuModel = cpus()[0]?.model.trim();
        if (!cpuModel) auditFailure('CPU model is unavailable');
        const identity: RHIBenchmarkEnvironment = {
            rigProfile: manifest.rig.profile,
            runnerTags: manifest.rig.requiredRunnerTags,
            fingerprintSha256: '',
            osPlatform: process.platform,
            osRelease: release(),
            cpuModel,
            gpuFingerprint: gpu.fingerprint,
            gpuDriver: gpu.driver,
            browserName: manifest.rig.browserName,
            browserVersion: browser.version(),
            browserExecutableSha256,
            playwrightVersion,
            nodeVersion: process.versions.node,
            powerProfile: manifest.rig.powerProfile,
            fallbackAdapter: gpu.fallback,
            gpuTimerAvailable: capabilities.gpuTimer,
            allocationProfilerAvailable: allocationProfiler,
            preciseMemoryAvailable: capabilities.preciseMemory
        };
        const environment = {
            ...identity,
            fingerprintSha256: rhiBenchmarkEnvironmentFingerprint(identity)
        };
        process.stdout.write(`${JSON.stringify(environment, null, 2)}\n`);
    } finally {
        await browser.close();
    }
}

await main();
