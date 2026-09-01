import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
    RHIBenchmarkEnvironment,
    RHIBenchmarkManifest
} from '../../benchmarks/rhi/result-schema';
import { collectRHIRawBenchmark } from '../../scripts/performance/collect-rhi-benchmark';
import { freezeRHIBaseline } from '../../scripts/performance/freeze-rhi-baseline';
import {
    RHI_PRODUCTION_FIXTURE_MARKER,
    RHI_PRODUCTION_FIXTURE_MODULE_PATH,
    RHI_PRODUCTION_FIXTURE_PATH,
    assertRHIMacOSFixedPowerState,
    assertRHIPhase0Preflight,
    rhiPhysicalGpuBrowserArguments
} from '../../scripts/performance/rhi-phase0-preflight';
import {
    parseRHIBenchmarkManifest,
    rhiBenchmarkEnvironmentFingerprint,
    sha256
} from '../../scripts/performance/verify-rhi-baseline';

const repositoryRoot = resolve(new URL('../..', import.meta.url).pathname);
const repositoryManifestValue = JSON.parse(
    await readFile(resolve(repositoryRoot, 'benchmarks/rhi/manifest.json'), 'utf8')
) as unknown;
const BROWSER_BYTES = new TextEncoder().encode('audited chromium binary fixture');
const BROWSER_SHA256 = sha256(BROWSER_BYTES);

const detectedTestRuntime = {
    detectedNodeVersion: '22.23.1',
    detectedOsRelease: '25.2.0-audited',
    detectedCpuModel: 'Audited CPU',
    detectedPowerProfile: 'fixed-performance',
    detectedPlaywrightVersion: '1.61.1'
} as const;

function enrolledManifest(): RHIBenchmarkManifest {
    const manifest = parseRHIBenchmarkManifest(repositoryManifestValue);
    return {
        ...manifest,
        rig: {
            ...manifest.rig,
            acceptedFingerprintSha256: [environment(manifest).fingerprintSha256]
        }
    };
}

function environment(manifest: RHIBenchmarkManifest): RHIBenchmarkEnvironment {
    const identity: RHIBenchmarkEnvironment = {
        rigProfile: manifest.rig.profile,
        runnerTags: manifest.rig.requiredRunnerTags,
        fingerprintSha256: '',
        osPlatform: 'darwin',
        osRelease: detectedTestRuntime.detectedOsRelease,
        cpuModel: 'Audited CPU',
        gpuFingerprint: 'Audited GPU',
        gpuDriver: 'audited-driver',
        browserName: 'chromium',
        browserVersion: '142.0.0.0',
        browserExecutableSha256: BROWSER_SHA256,
        playwrightVersion: manifest.rig.playwrightVersion,
        nodeVersion: manifest.rig.nodeVersion,
        powerProfile: manifest.rig.powerProfile,
        fallbackAdapter: false,
        gpuTimerAvailable: true,
        allocationProfilerAvailable: true,
        preciseMemoryAvailable: true
    };
    return {
        ...identity,
        fingerprintSha256: rhiBenchmarkEnvironmentFingerprint(identity)
    };
}

async function doesNotExist(path: string): Promise<boolean> {
    try {
        await access(path);
        return false;
    } catch {
        return true;
    }
}

describe('RHI Phase 0 mutation preflight', () => {
    const temporaryRoots: string[] = [];

    async function temporaryRoot(): Promise<string> {
        const root = await mkdtemp(resolve(tmpdir(), 'hilo-rhi-phase0-'));
        temporaryRoots.push(root);
        return root;
    }

    afterEach(async () => {
        await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true })));
    });

    it('requires AC, macOS High Power Mode, and a warning-free thermal state', () => {
        const fixedState = {
            powerSource: "Now drawing from 'AC Power'",
            customSettings: 'Battery Power:\n powermode 0\nAC Power:\n powermode 2\n',
            thermalState:
                'No thermal warning level has been recorded\nNo performance warning level has been recorded\n'
        };
        expect(() => {
            assertRHIMacOSFixedPowerState(fixedState);
        }).not.toThrow();
        expect(() => {
            assertRHIMacOSFixedPowerState({
                ...fixedState,
                powerSource: "Now drawing from 'Battery Power'"
            });
        }).toThrow(/connected to AC power/u);
        expect(() => {
            assertRHIMacOSFixedPowerState({
                ...fixedState,
                customSettings: 'AC Power:\n powermode 0\n'
            });
        }).toThrow(/High Power Mode/u);
        expect(() => {
            assertRHIMacOSFixedPowerState({
                ...fixedState,
                thermalState: 'CPU_Scheduler_Limit = 80\n'
            });
        }).toThrow(/thermal or performance warning/u);
    });

    it('pins native Metal and rejects a non-macOS physical browser profile', () => {
        expect(rhiPhysicalGpuBrowserArguments('darwin')).toEqual(
            expect.arrayContaining([
                '--disable-software-rasterizer',
                '--ignore-gpu-blocklist',
                '--use-angle=metal'
            ])
        );
        expect(() => rhiPhysicalGpuBrowserArguments('linux')).toThrow(/requires macOS/u);
    });

    it('ships one explicitly enrolled macOS rig and the real production fixture', async () => {
        const manifest = parseRHIBenchmarkManifest(repositoryManifestValue);
        expect(manifest.rig.acceptedFingerprintSha256).toEqual([
            '6bfa8f5bf40566a46cf3f766daf587fbf1da6a4cbe7ae234bfac67ee1d797fd3'
        ]);
        expect(await doesNotExist(resolve(repositoryRoot, RHI_PRODUCTION_FIXTURE_PATH))).toBe(
            false
        );
        expect(
            await doesNotExist(resolve(repositoryRoot, RHI_PRODUCTION_FIXTURE_MODULE_PATH))
        ).toBe(false);
        await expect(
            assertRHIPhase0Preflight({
                repositoryRoot,
                manifestValue: manifest,
                environmentValue: environment(manifest),
                platform: 'darwin',
                ...detectedTestRuntime
            })
        ).rejects.toThrow(/fingerprint is not enrolled/u);
    });

    it('hard-fails without the production fixture before collector output or baseline writes', async () => {
        const root = await temporaryRoot();
        const manifest = enrolledManifest();
        const outputPath = resolve(root, 'reports/raw.json');
        const baselinePath = resolve(root, 'benchmarks/rhi/baselines', manifest.rig.profile);
        let collectorCalled = false;

        await expect(
            collectRHIRawBenchmark({
                repositoryRoot: root,
                manifestValue: manifest,
                environmentValue: environment(manifest),
                platform: 'darwin',
                ...detectedTestRuntime,
                outputPath: resolve(baselinePath, 'forbidden.raw.json.gz'),
                collect: () => {
                    collectorCalled = true;
                    return Promise.reject(new Error('must not collect'));
                }
            })
        ).rejects.toThrow(/never a baseline/u);
        expect(collectorCalled).toBe(false);

        await expect(
            collectRHIRawBenchmark({
                repositoryRoot: root,
                manifestValue: manifest,
                environmentValue: environment(manifest),
                platform: 'darwin',
                ...detectedTestRuntime,
                outputPath,
                collect: () => {
                    collectorCalled = true;
                    return Promise.reject(new Error('must not collect'));
                }
            })
        ).rejects.toThrow(/production RHI fixture is missing/u);
        expect(collectorCalled).toBe(false);
        expect(await doesNotExist(outputPath)).toBe(true);

        await expect(
            freezeRHIBaseline({
                repositoryRoot: root,
                manifestValue: manifest,
                environmentValue: environment(manifest),
                platform: 'darwin',
                ...detectedTestRuntime,
                summaryValue: {},
                rawBytes: new Uint8Array(),
                destinationDirectory: baselinePath
            })
        ).rejects.toThrow(/production RHI fixture is missing/u);
        expect(await doesNotExist(baselinePath)).toBe(true);
    });

    it('hard-fails on a non-macOS runner or missing Chromium executable fingerprint', async () => {
        const root = await temporaryRoot();
        const manifest = enrolledManifest();

        await expect(
            assertRHIPhase0Preflight({
                repositoryRoot: root,
                manifestValue: manifest,
                environmentValue: environment(manifest),
                platform: 'linux'
            })
        ).rejects.toThrow(/dedicated macOS performance rig/u);

        await expect(
            assertRHIPhase0Preflight({
                repositoryRoot: root,
                manifestValue: manifest,
                environmentValue: environment(manifest),
                platform: 'darwin',
                ...detectedTestRuntime,
                detectedOsRelease: '25.2.0-changed'
            })
        ).rejects.toThrow(/OS\/kernel release differs/u);

        await expect(
            assertRHIPhase0Preflight({
                repositoryRoot: root,
                manifestValue: manifest,
                environmentValue: environment(manifest),
                platform: 'darwin',
                ...detectedTestRuntime,
                detectedPowerProfile: 'balanced'
            })
        ).rejects.toThrow(/power profile differs/u);

        const missingChromeFingerprint = {
            ...environment(manifest),
            browserExecutableSha256: undefined
        };
        await expect(
            assertRHIPhase0Preflight({
                repositoryRoot: root,
                manifestValue: manifest,
                environmentValue: missingChromeFingerprint,
                platform: 'darwin'
            })
        ).rejects.toThrow(/browserExecutableSha256/u);

        const changedChromeBinary = {
            ...environment(manifest),
            browserExecutableSha256: '3'.repeat(64)
        };
        await expect(
            assertRHIPhase0Preflight({
                repositoryRoot: root,
                manifestValue: manifest,
                environmentValue: changedChromeBinary,
                platform: 'darwin'
            })
        ).rejects.toThrow(/fingerprint does not match/u);
    });

    it('requires the explicit production fixture marker and returns its checksum read-only', async () => {
        const root = await temporaryRoot();
        const manifest = enrolledManifest();
        const fixturePath = resolve(root, RHI_PRODUCTION_FIXTURE_PATH);
        const fixtureModulePath = resolve(root, RHI_PRODUCTION_FIXTURE_MODULE_PATH);
        const browserPath = resolve(root, 'audited-chromium');
        await mkdir(resolve(fixturePath, '..'), { recursive: true });
        await Promise.all([
            writeFile(fixtureModulePath, 'export {};'),
            writeFile(browserPath, BROWSER_BYTES)
        ]);
        await writeFile(fixturePath, '<!doctype html><title>not production</title>');
        await expect(
            assertRHIPhase0Preflight({
                repositoryRoot: root,
                manifestValue: manifest,
                environmentValue: environment(manifest),
                platform: 'darwin',
                browserExecutablePath: browserPath,
                ...detectedTestRuntime
            })
        ).rejects.toThrow(/fixture marker is missing/u);

        await writeFile(
            fixturePath,
            `<!doctype html><html ${RHI_PRODUCTION_FIXTURE_MARKER}><script type="module" src="./rhi-production.ts"></script></html>`
        );
        const preflight = await assertRHIPhase0Preflight({
            repositoryRoot: root,
            manifestValue: manifest,
            environmentValue: environment(manifest),
            platform: 'darwin',
            browserExecutablePath: browserPath,
            ...detectedTestRuntime
        });
        expect(preflight.productionFixturePath).toBe(fixturePath);
        expect(preflight.productionFixtureSha256).toMatch(/^[a-f0-9]{64}$/u);
        expect(await doesNotExist(resolve(root, 'benchmarks/rhi/baselines'))).toBe(true);

        await writeFile(fixtureModulePath, 'export const revision = 2;');
        const changedFixture = await assertRHIPhase0Preflight({
            repositoryRoot: root,
            manifestValue: manifest,
            environmentValue: environment(manifest),
            platform: 'darwin',
            browserExecutablePath: browserPath,
            ...detectedTestRuntime
        });
        expect(changedFixture.productionFixtureSha256).not.toBe(preflight.productionFixtureSha256);

        await writeFile(browserPath, 'tampered chromium');
        await expect(
            assertRHIPhase0Preflight({
                repositoryRoot: root,
                manifestValue: manifest,
                environmentValue: environment(manifest),
                platform: 'darwin',
                browserExecutablePath: browserPath,
                ...detectedTestRuntime
            })
        ).rejects.toThrow(/executable bytes differ/u);
    });

    it('ships the independent production fixture and installed browser adapter', async () => {
        const [html, fixture, collector] = await Promise.all([
            readFile(resolve(repositoryRoot, RHI_PRODUCTION_FIXTURE_PATH), 'utf8'),
            readFile(resolve(repositoryRoot, RHI_PRODUCTION_FIXTURE_MODULE_PATH), 'utf8'),
            readFile(
                resolve(repositoryRoot, 'scripts/performance/collect-rhi-benchmark.ts'),
                'utf8'
            )
        ]);
        expect(html).toContain(RHI_PRODUCTION_FIXTURE_MARKER);
        expect(html).toContain('src="./rhi-production.ts"');
        expect(fixture).toContain('new SharedRendererDriver');
        expect(fixture).toContain('EXT_disjoint_timer_query_webgl2');
        expect(fixture).toContain("requiredFeatures: ['timestamp-query']");
        expect(fixture).not.toContain("from 'node:");
        expect(fixture).not.toContain('scripts/performance/verify-rhi-baseline');
        expect(collector).toContain('collectRHIProductionCapture');
        expect(collector).not.toContain('collector adapter is not installed');

        const manifest = parseRHIBenchmarkManifest(repositoryManifestValue);
        expect(manifest.scenarios).toHaveLength(10);
        expect(manifest.sampling.rounds).toBe(7);
        expect(
            manifest.scenarios.find(value => value.id === 'large-instancing')?.quality
        ).toMatchObject({
            drawCount: 80,
            instanceCount: 10_000,
            surfaceOutputPassCount: 1
        });
    });

    it('exposes explicit package scripts for each guarded pipeline stage', async () => {
        const packageJson = JSON.parse(
            await readFile(resolve(repositoryRoot, 'package.json'), 'utf8')
        ) as { scripts?: Record<string, string> };
        for (const [scriptName, fileName] of Object.entries({
            'benchmark:rhi:audit-environment': 'audit-rhi-benchmark-environment.ts',
            'benchmark:rhi:preflight': 'rhi-phase0-preflight.ts',
            'benchmark:rhi:collect': 'collect-rhi-benchmark.ts',
            'benchmark:rhi:summarize': 'summarize-rhi-benchmark.ts',
            'benchmark:rhi:verify': 'verify-rhi-baseline.ts',
            'benchmark:rhi:freeze': 'freeze-rhi-baseline.ts',
            'benchmark:rhi:report': 'render-rhi-benchmark-report.ts'
        })) {
            expect(packageJson.scripts?.[scriptName]).toContain(`scripts/performance/${fileName}`);
        }
    });
});
