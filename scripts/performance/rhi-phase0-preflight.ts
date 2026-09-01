import { execFile } from 'node:child_process';
import { cpus, release } from 'node:os';
import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
    RHIBenchmarkEnvironment,
    RHIBenchmarkManifest
} from '../../benchmarks/rhi/result-schema';
import {
    parseRHIBenchmarkEnvironment,
    parseRHIBenchmarkManifest,
    sha256,
    verifyRHIBenchmarkEnvironment
} from './verify-rhi-baseline';

export const RHI_PRODUCTION_FIXTURE_PATH = 'test/performance/fixtures/rhi-production.html';
export const RHI_PRODUCTION_FIXTURE_MODULE_PATH = 'test/performance/fixtures/rhi-production.ts';
export const RHI_PRODUCTION_FIXTURE_MARKER = 'data-hilo-rhi-benchmark="production-rhi"';
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

export interface RHIMacOSPowerState {
    readonly powerSource: string;
    readonly customSettings: string;
    readonly thermalState: string;
}

/** Validate the macOS state that makes laptop captures comparable across commits. */
export function assertRHIMacOSFixedPowerState(state: RHIMacOSPowerState): void {
    if (!state.powerSource.includes("Now drawing from 'AC Power'")) {
        throw new Error('the macOS performance rig must be connected to AC power');
    }
    const acSettings = /(?:^|\n)AC Power:\s*\n([\s\S]*)$/u.exec(state.customSettings)?.[1];
    if (!acSettings || !/(?:^|\n)\s*powermode\s+2(?:\s|$)/u.test(acSettings)) {
        throw new Error('macOS High Power Mode must be enabled for AC power');
    }
    if (
        !state.thermalState.includes('No thermal warning level has been recorded') ||
        !state.thermalState.includes('No performance warning level has been recorded')
    ) {
        throw new Error('macOS reports a thermal or performance warning since boot');
    }
}

function runPowerAuditCommand(arguments_: readonly string[]): Promise<string> {
    return new Promise((resolvePromise, reject) => {
        execFile('pmset', arguments_, { encoding: 'utf8' }, (error, stdout) => {
            if (error) {
                reject(new Error(`pmset ${arguments_.join(' ')} failed`, { cause: error }));
                return;
            }
            resolvePromise(stdout);
        });
    });
}

/** Recheck live macOS power and thermal policy before every capture/freeze mutation. */
export async function detectRHIFixedPowerProfile(): Promise<string> {
    if (process.platform !== 'darwin') {
        throw new Error('the enrolled performance rig requires macOS');
    }
    const [powerSource, customSettings, thermalState] = await Promise.all([
        runPowerAuditCommand(['-g', 'ps']),
        runPowerAuditCommand(['-g', 'custom']),
        runPowerAuditCommand(['-g', 'therm'])
    ]);
    assertRHIMacOSFixedPowerState({ powerSource, customSettings, thermalState });
    if (process.env[RHI_PHASE0_POWER_PROFILE_VARIABLE] !== 'fixed-performance') {
        throw new Error(
            `${RHI_PHASE0_POWER_PROFILE_VARIABLE}=fixed-performance is required after GPU/power-policy audit`
        );
    }
    return 'fixed-performance';
}

/** Browser flags shared by physical-rig audit and evidence collection. */
export function rhiPhysicalGpuBrowserArguments(platform: string): readonly string[] {
    if (platform !== 'darwin') {
        throw new Error('the enrolled physical GPU browser profile requires macOS');
    }
    return Object.freeze([
        '--enable-precise-memory-info',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-features=CalculateNativeWinOcclusion',
        '--disable-software-rasterizer',
        '--enable-unsafe-webgpu',
        '--ignore-gpu-blocklist',
        '--use-angle=metal'
    ]);
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
 * Gate every capture/freezing mutation behind the enrolled physical macOS rig, exact Chromium
 * executable fingerprint, and the production RHI fixture. This function performs no writes.
 */
export async function assertRHIPhase0Preflight(
    options: RHIPhase0PreflightOptions
): Promise<RHIPhase0PreflightResult> {
    const manifest = parseRHIBenchmarkManifest(options.manifestValue);
    const environment = parseRHIBenchmarkEnvironment(options.environmentValue);
    const platform = options.platform ?? process.platform;
    if (platform !== 'darwin' || platform !== manifest.rig.osPlatform) {
        phase0Failure('capture requires the dedicated macOS performance rig');
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
        phase0Failure(`production RHI fixture is missing at ${productionFixturePath}`);
    }
    try {
        fixtureModuleBytes = await readFile(productionFixtureModulePath);
    } catch {
        phase0Failure(`production RHI fixture module is missing at ${productionFixtureModulePath}`);
    }
    const fixtureSource = new TextDecoder().decode(fixtureBytes);
    if (!fixtureSource.includes(RHI_PRODUCTION_FIXTURE_MARKER)) {
        phase0Failure('production RHI fixture marker is missing');
    }
    if (!fixtureSource.includes('src="./rhi-production.ts"')) {
        phase0Failure('production RHI fixture does not load its audited module');
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
        readFile(resolve(repositoryRoot, 'benchmarks/rhi/manifest.json'), 'utf8'),
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
