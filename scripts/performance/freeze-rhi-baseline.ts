import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RHIBenchmarkBaselineResult } from '../../benchmarks/rhi/result-schema';
import {
    assertRHIPhase0Preflight,
    readRHIPhase0EnvironmentFile,
    type RHIPhase0PreflightOptions
} from './rhi-phase0-preflight';
import { renderRHIBenchmarkReport } from './render-rhi-benchmark-report';
import {
    decodeRHIRawBenchmarkArtifact,
    summarizeRHIRawBenchmarkCapture,
    verifyRHIRawBenchmarkCapture
} from './summarize-rhi-benchmark';
import { canonicalRHIJson, verifyRHIBaseline } from './verify-rhi-baseline';

export interface RHIBaselineFreezeOptions extends RHIPhase0PreflightOptions {
    readonly summaryValue: unknown;
    readonly rawBytes: Uint8Array;
    readonly destinationDirectory: string;
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

/** Atomic baseline freezer. All evidence and environment checks finish before any directory write. */
export async function freezeRHIBaseline(
    options: RHIBaselineFreezeOptions
): Promise<RHIBenchmarkBaselineResult> {
    const preflight = await assertRHIPhase0Preflight(options);
    if (options.rawBytes[0] !== 0x1f || options.rawBytes[1] !== 0x8b) {
        throw new Error('frozen baseline raw artifact must be gzip-compressed evidence');
    }
    const raw = verifyRHIRawBenchmarkCapture(
        preflight.manifest,
        decodeRHIRawBenchmarkArtifact(options.rawBytes)
    );
    const summary = verifyRHIBaseline(preflight.manifest, options.summaryValue, options.rawBytes);
    if (
        canonicalRHIJson(raw.environment) !== canonicalRHIJson(preflight.environment) ||
        canonicalRHIJson(summary.environment) !== canonicalRHIJson(preflight.environment)
    ) {
        throw new Error('baseline evidence environment differs from audited preflight');
    }
    if (raw.productionFixture.sha256 !== preflight.productionFixtureSha256) {
        throw new Error('baseline raw capture used a different production fixture');
    }
    if (raw.commitSha !== summary.commitSha || raw.manifestSha256 !== summary.manifestSha256) {
        throw new Error('raw capture and summary identity differ');
    }
    const recomputedSummary = summarizeRHIRawBenchmarkCapture(preflight.manifest, raw, {
        rawArtifact: summary.rawArtifact
    });
    if (canonicalRHIJson(recomputedSummary) !== canonicalRHIJson(summary)) {
        throw new Error('baseline summary statistics do not match the checked raw capture');
    }
    if (summary.rawArtifact.path !== 'current.raw.json.gz') {
        throw new Error('frozen baseline raw artifact path must be current.raw.json.gz');
    }
    const requiredDestination = resolve(
        options.repositoryRoot,
        'benchmarks/rhi/baselines',
        preflight.manifest.rig.profile
    );
    const destinationDirectory = resolve(options.destinationDirectory);
    if (destinationDirectory !== requiredDestination) {
        throw new Error('baseline destination must be the enrolled rig profile directory');
    }
    if (await pathExists(destinationDirectory)) {
        throw new Error('baseline destination already exists and is immutable');
    }

    const parent = dirname(destinationDirectory);
    const temporaryDirectory = `${destinationDirectory}.tmp-${String(process.pid)}`;
    await mkdir(parent, { recursive: true });
    await mkdir(temporaryDirectory, { recursive: false });
    try {
        await Promise.all([
            writeFile(resolve(temporaryDirectory, 'current.raw.json.gz'), options.rawBytes, {
                flag: 'wx'
            }),
            writeFile(
                resolve(temporaryDirectory, 'current.summary.json'),
                `${JSON.stringify(summary, null, 2)}\n`,
                { flag: 'wx' }
            ),
            writeFile(resolve(temporaryDirectory, 'report.md'), renderRHIBenchmarkReport(summary), {
                flag: 'wx'
            })
        ]);
        await rename(temporaryDirectory, destinationDirectory);
    } catch (error) {
        await rm(temporaryDirectory, { recursive: true, force: true });
        throw error;
    }
    return summary;
}

async function main(): Promise<void> {
    const summaryArgument = process.argv[2];
    const rawArgument = process.argv[3];
    if (!summaryArgument || !rawArgument) {
        throw new Error(
            'Usage: npm run benchmark:rhi:freeze -- <current.summary.json> <current.raw.json.gz>'
        );
    }
    const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
    const manifestValue = JSON.parse(
        await readFile(resolve(repositoryRoot, 'benchmarks/rhi/manifest.json'), 'utf8')
    ) as unknown;
    const [summarySource, rawBytes, environmentValue] = await Promise.all([
        readFile(resolve(summaryArgument), 'utf8'),
        readFile(resolve(rawArgument)),
        readRHIPhase0EnvironmentFile()
    ]);
    const parsedManifest = manifestValue as { rig?: { profile?: unknown } };
    if (typeof parsedManifest.rig?.profile !== 'string') {
        throw new Error('manifest rig profile is missing');
    }
    await freezeRHIBaseline({
        repositoryRoot,
        manifestValue,
        environmentValue,
        summaryValue: JSON.parse(summarySource) as unknown,
        rawBytes,
        destinationDirectory: resolve(
            repositoryRoot,
            'benchmarks/rhi/baselines',
            parsedManifest.rig.profile
        )
    });
}

const invokedDirectly = process.argv.some(argument => {
    try {
        return resolve(argument) === fileURLToPath(import.meta.url);
    } catch {
        return false;
    }
});

if (invokedDirectly) await main();
