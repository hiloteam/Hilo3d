import { gzipSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RHIBenchmarkRawCaptureResult } from '../../benchmarks/rhi-v2/result-schema';
import {
    assertRHIPhase0Preflight,
    readRHIPhase0EnvironmentFile,
    type RHIPhase0PreflightOptions,
    type RHIPhase0PreflightResult
} from './rhi-phase0-preflight';
import { verifyRHIRawBenchmarkCapture } from './summarize-rhi-benchmark';
import { canonicalRHIJson } from './verify-rhi-baseline';
import { PlaywrightCollectorSessionFactory } from './rhi-playwright-collector';
import { collectRHIProductionCapture } from './rhi-production-collector';

export interface RHICollectorOptions extends RHIPhase0PreflightOptions {
    readonly outputPath: string;
    readonly collect: (
        preflight: RHIPhase0PreflightResult
    ) => Promise<RHIBenchmarkRawCaptureResult>;
}

function isInsideBaselineDirectory(repositoryRoot: string, outputPath: string): boolean {
    const baselineRoot = resolve(repositoryRoot, 'benchmarks/rhi-v2/baselines');
    const child = relative(baselineRoot, resolve(outputPath));
    return (
        child === '' ||
        (child !== '..' && !child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`))
    );
}

/** Collector orchestration seam. Production browser instrumentation is injected after preflight. */
export async function collectRHIRawBenchmark(
    options: RHICollectorOptions
): Promise<RHIBenchmarkRawCaptureResult> {
    if (isInsideBaselineDirectory(options.repositoryRoot, options.outputPath)) {
        throw new Error('RHI collector may only write temporary reports, never a baseline');
    }
    const preflight = await assertRHIPhase0Preflight(options);
    const raw = verifyRHIRawBenchmarkCapture(preflight.manifest, await options.collect(preflight));
    if (canonicalRHIJson(raw.environment) !== canonicalRHIJson(preflight.environment)) {
        throw new Error('collector environment differs from the audited preflight environment');
    }
    if (raw.productionFixture.sha256 !== preflight.productionFixtureSha256) {
        throw new Error('collector fixture checksum differs from the preflight fixture');
    }
    const serialized = new TextEncoder().encode(`${JSON.stringify(raw)}\n`);
    const outputBytes = options.outputPath.endsWith('.gz')
        ? gzipSync(serialized, { level: 9 })
        : serialized;
    await mkdir(dirname(resolve(options.outputPath)), { recursive: true });
    await writeFile(resolve(options.outputPath), outputBytes, { flag: 'wx' });
    return raw;
}

function runGit(repositoryRoot: string, args: readonly string[]): Promise<string> {
    return new Promise((resolvePromise, reject) => {
        execFile('git', args, { cwd: repositoryRoot, encoding: 'utf8' }, (error, stdout) => {
            if (error) {
                reject(new Error(`git ${args.join(' ')} failed`, { cause: error }));
                return;
            }
            resolvePromise(stdout);
        });
    });
}

/** Baseline evidence must identify one committed, reproducible source tree exactly. */
export async function auditedRHIBenchmarkCommit(repositoryRoot: string): Promise<string> {
    const [commitSha, status] = await Promise.all([
        runGit(repositoryRoot, ['rev-parse', 'HEAD']),
        runGit(repositoryRoot, ['status', '--porcelain=v1', '--untracked-files=all'])
    ]);
    if (status.trim().length !== 0) {
        throw new Error('RHI benchmark capture requires a clean Git worktree');
    }
    const normalized = commitSha.trim();
    if (!/^[a-f0-9]{40}$/u.test(normalized)) {
        throw new Error('RHI benchmark capture requires a full lowercase Git commit SHA');
    }
    return normalized;
}

async function main(): Promise<void> {
    const outputPath = process.argv[2];
    if (!outputPath) {
        throw new Error('Usage: npm run benchmark:rhi:collect -- <temporary-raw-output.json>');
    }
    const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
    const manifestValue = JSON.parse(
        await readFile(resolve(repositoryRoot, 'benchmarks/rhi-v2/manifest.json'), 'utf8')
    ) as unknown;
    const environmentValue = await readRHIPhase0EnvironmentFile();
    await collectRHIRawBenchmark({
        repositoryRoot,
        manifestValue,
        environmentValue,
        outputPath,
        collect: async preflight => {
            const commitSha = await auditedRHIBenchmarkCommit(repositoryRoot);
            const sessions = new PlaywrightCollectorSessionFactory({
                preflight,
                repositoryRoot
            });
            const capture = await collectRHIProductionCapture({
                preflight,
                commitSha,
                sessions
            });
            if ((await auditedRHIBenchmarkCommit(repositoryRoot)) !== commitSha) {
                throw new Error('RHI benchmark source commit changed during capture');
            }
            return capture;
        }
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
