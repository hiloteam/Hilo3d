import { cpus, release } from 'node:os';
import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
    RHIBenchmarkEnvironment,
    RHIBenchmarkManifest
} from '../../benchmarks/rhi-v2/result-schema';
import {
    parseRHIBenchmarkEnvironment,
    parseRHIBenchmarkManifest,
    sha256,
    verifyRHIBenchmarkEnvironment
} from './verify-rhi-baseline';

export const RHI_PRODUCTION_FIXTURE_PATH = 'test/performance/fixtures/rhi-v2-production.html';
export const RHI_PRODUCTION_FIXTURE_MODULE_PATH = 'test/performance/fixtures/rhi-v2-production.ts';
export const RHI_PRODUCTION_FIXTURE_MARKER = 'data-hilo-rhi-benchmark="production-rhi-v2"';
export const RHI_PHASE0_ENVIRONMENT_VARIABLE = 'HILO3D_RHI_BENCHMARK_ENVIRONMENT';
export const RHI_PHASE0_BROWSER_EXECUTABLE_VARIABLE = 'HILO3D_RHI_BENCHMARK_BROWSER_EXECUTABLE';
export const RHI_PHASE0_POWER_PROFILE_VARIABLE = 'HILO3D_RHI_BENCHMARK_POWER_PROFILE';

export interface RHIPhase0PreflightOptions {
    readonly repositoryRoot: string;
    readonly manifestValue: unknown;
    readonly environmentValue: unknown;
    readonly platform?: NodeJS.Platform;
    readonly productionFixturePath?: string;
    readonly productionFixtureModulePath?: string;
    readonly browserExecutablePath?: string;
    readonly detectedNodeVersion?: string;
    readonly detectedOsRelease?: string;
    readonly detectedCpuModel?: string;
    readonly detectedPowerProfile?: string;
    readonly detectedPlaywrightVersion?: string;
}

export interface RHIPhase0PreflightResult {
    readonly manifest: RHIBenchmarkManifest;
    readonly environment: RHIBenchmarkEnvironment;
    readonly productionFixturePath: string;
    readonly productionFixtureRelativePath: typeof RHI_PRODUCTION_FIXTURE_PATH;
    readonly productionFixtureModulePath: string;
    readonly productionFixtureSha256: string;
    readonly browserExecutablePath: string;
}

function phase0Failure(message: string): never {
    throw new Error(`RHI Phase 0 preflight failed: ${message}`);
}

/** Recheck the live Linux power policy immediately before every capture/freeze mutation. */
export async function detectRHIFixedPowerProfile(): Promise<string> {
    let entries: Dirent[];
    try {
        entries = await readdir('/sys/devices/system/cpu', { withFileTypes: true });
    } catch (error) {
        throw new Error(
            `cannot inspect Linux CPU governors: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error }
        );
    }
    const governors: string[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || !/^cpu\d+$/u.test(entry.name)) continue;
        try {
            governors.push(
                (
                    await readFile(
                        `/sys/devices/system/cpu/${entry.name}/cpufreq/scaling_governor`,
                        'utf8'
                    )
                ).trim()
            );
        } catch {
            // Offline cores and kernels without cpufreq are not evidence of a fixed profile.
        }
    }
    if (governors.length === 0 || governors.some(governor => governor !== 'performance')) {
        throw new Error('every observable CPU core must use the performance governor');
    }
    if (process.env[RHI_PHASE0_POWER_PROFILE_VARIABLE] !== 'fixed-performance') {
        throw new Error(
            `${RHI_PHASE0_POWER_PROFILE_VARIABLE}=fixed-performance is required after GPU/power-policy audit`
        );
    }
    return 'fixed-performance';
}

function pathStaysInside(root: string, path: string): boolean {
    const child = relative(root, path);
    return child !== '..' && !child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`);
}

function fixtureClosureDigest(htmlBytes: Uint8Array, moduleBytes: Uint8Array): string {
    return sha256(
        `${RHI_PRODUCTION_FIXTURE_PATH}\0${String(htmlBytes.byteLength)}\0${new TextDecoder().decode(htmlBytes)}\0${RHI_PRODUCTION_FIXTURE_MODULE_PATH}\0${String(moduleBytes.byteLength)}\0${new TextDecoder().decode(moduleBytes)}`
    );
}

async function readInstalledPlaywrightVersion(repositoryRoot: string): Promise<string> {
    let value: unknown;
    try {
        value = JSON.parse(
            await readFile(resolve(repositoryRoot, 'node_modules/playwright/package.json'), 'utf8')
        ) as unknown;
    } catch (error) {
        phase0Failure(
            `cannot read installed Playwright package: ${error instanceof Error ? error.message : String(error)}`
        );
    }
    if (typeof value !== 'object' || value === null) {
        phase0Failure('installed Playwright package metadata is invalid');
    }
    const version = (value as Record<string, unknown>)['version'];
    if (typeof version !== 'string' || version.length === 0) {
        phase0Failure('installed Playwright package version is invalid');
    }
    return version;
}

/**
 * Gate every capture/freezing mutation behind an enrolled physical Linux rig, exact Chromium
 * executable fingerprint, and the production RHI-v2 fixture. This function performs no writes.
 */
export async function assertRHIPhase0Preflight(
    options: RHIPhase0PreflightOptions
): Promise<RHIPhase0PreflightResult> {
    const manifest = parseRHIBenchmarkManifest(options.manifestValue);
    const environment = parseRHIBenchmarkEnvironment(options.environmentValue);
    const platform = options.platform ?? process.platform;
    if (platform !== 'linux' || platform !== manifest.rig.osPlatform) {
        phase0Failure('capture requires the dedicated Linux performance rig');
    }
    verifyRHIBenchmarkEnvironment(manifest.rig, environment);
    const detectedNodeVersion = options.detectedNodeVersion ?? process.versions.node;
    if (environment.nodeVersion !== detectedNodeVersion) {
        phase0Failure(
            `running Node ${detectedNodeVersion} differs from audited ${environment.nodeVersion}`
        );
    }
    const detectedOsRelease = options.detectedOsRelease ?? release();
    if (environment.osRelease !== detectedOsRelease) {
        phase0Failure('running OS/kernel release differs from the audited environment');
    }
    const detectedCpuModel = options.detectedCpuModel ?? cpus()[0]?.model.trim();
    if (!detectedCpuModel || environment.cpuModel !== detectedCpuModel) {
        phase0Failure('running CPU model differs from the audited environment');
    }
    let detectedPowerProfile = options.detectedPowerProfile;
    if (detectedPowerProfile === undefined) {
        try {
            detectedPowerProfile = await detectRHIFixedPowerProfile();
        } catch (error) {
            phase0Failure(error instanceof Error ? error.message : String(error));
        }
    }
    if (environment.powerProfile !== detectedPowerProfile) {
        phase0Failure('running power profile differs from the audited environment');
    }
    const repositoryRoot = resolve(options.repositoryRoot);
    const detectedPlaywrightVersion =
        options.detectedPlaywrightVersion ?? (await readInstalledPlaywrightVersion(repositoryRoot));
    if (environment.playwrightVersion !== detectedPlaywrightVersion) {
        phase0Failure(
            `installed Playwright ${detectedPlaywrightVersion} differs from audited ${environment.playwrightVersion}`
        );
    }
    if (environment.browserName !== 'chromium') {
        phase0Failure('capture requires the pinned Chromium browser');
    }
    if (/^0{64}$/u.test(environment.browserExecutableSha256)) {
        phase0Failure('Chromium executable fingerprint is a placeholder');
    }

    const productionFixturePath = resolve(
        repositoryRoot,
        options.productionFixturePath ?? RHI_PRODUCTION_FIXTURE_PATH
    );
    const productionFixtureModulePath = resolve(
        repositoryRoot,
        options.productionFixtureModulePath ?? RHI_PRODUCTION_FIXTURE_MODULE_PATH
    );
    if (!pathStaysInside(repositoryRoot, productionFixturePath)) {
        phase0Failure('production fixture must stay inside the repository');
    }
    if (!pathStaysInside(repositoryRoot, productionFixtureModulePath)) {
        phase0Failure('production fixture module must stay inside the repository');
    }
    let fixtureBytes: Uint8Array;
    let fixtureModuleBytes: Uint8Array;
    try {
        fixtureBytes = await readFile(productionFixturePath);
    } catch {
        phase0Failure(`production RHI-v2 fixture is missing at ${productionFixturePath}`);
    }
    try {
        fixtureModuleBytes = await readFile(productionFixtureModulePath);
    } catch {
        phase0Failure(
            `production RHI-v2 fixture module is missing at ${productionFixtureModulePath}`
        );
    }
    const fixtureSource = new TextDecoder().decode(fixtureBytes);
    if (!fixtureSource.includes(RHI_PRODUCTION_FIXTURE_MARKER)) {
        phase0Failure('production RHI-v2 fixture marker is missing');
    }
    if (!fixtureSource.includes('src="./rhi-v2-production.ts"')) {
        phase0Failure('production RHI-v2 fixture does not load its audited module');
    }

    const browserExecutablePath = resolve(
        options.browserExecutablePath ?? process.env[RHI_PHASE0_BROWSER_EXECUTABLE_VARIABLE] ?? ''
    );
    if (!options.browserExecutablePath && !process.env[RHI_PHASE0_BROWSER_EXECUTABLE_VARIABLE]) {
        phase0Failure(
            `${RHI_PHASE0_BROWSER_EXECUTABLE_VARIABLE} must name the audited Chromium executable`
        );
    }
    let browserExecutableBytes: Uint8Array;
    try {
        browserExecutableBytes = await readFile(browserExecutablePath);
    } catch {
        phase0Failure(`cannot read audited Chromium executable at ${browserExecutablePath}`);
    }
    if (sha256(browserExecutableBytes) !== environment.browserExecutableSha256) {
        phase0Failure('Chromium executable bytes differ from the audited SHA-256');
    }
    return {
        manifest,
        environment,
        productionFixturePath,
        productionFixtureRelativePath: RHI_PRODUCTION_FIXTURE_PATH,
        productionFixtureModulePath,
        productionFixtureSha256: fixtureClosureDigest(fixtureBytes, fixtureModuleBytes),
        browserExecutablePath
    };
}

export async function readRHIPhase0EnvironmentFile(
    environmentPath = process.env[RHI_PHASE0_ENVIRONMENT_VARIABLE]
): Promise<unknown> {
    if (!environmentPath) {
        phase0Failure(
            `${RHI_PHASE0_ENVIRONMENT_VARIABLE} must point to an audited environment JSON`
        );
    }
    try {
        return JSON.parse(await readFile(resolve(environmentPath), 'utf8')) as unknown;
    } catch (error) {
        phase0Failure(
            `cannot read audited environment JSON: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

async function main(): Promise<void> {
    const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
    const [manifestSource, environmentValue] = await Promise.all([
        readFile(resolve(repositoryRoot, 'benchmarks/rhi-v2/manifest.json'), 'utf8'),
        readRHIPhase0EnvironmentFile()
    ]);
    const result = await assertRHIPhase0Preflight({
        repositoryRoot,
        manifestValue: JSON.parse(manifestSource) as unknown,
        environmentValue
    });
    process.stdout.write(
        `RHI Phase 0 preflight passed for ${result.environment.fingerprintSha256}\n`
    );
}

const invokedDirectly = process.argv.some(argument => {
    try {
        return resolve(argument) === fileURLToPath(import.meta.url);
    } catch {
        return false;
    }
});

if (invokedDirectly) await main();
