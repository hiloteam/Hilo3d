import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Manifest {
    readonly baselineCommit: string;
    readonly nodeVersion: string;
    readonly staticEntityCount: number;
    readonly dynamicEntityCount: number;
    readonly rounds: number;
    readonly minimumP95ImprovementFraction: number;
    readonly maximumCoreAllocationBytesPerFrame: number;
}

interface BaselineRound {
    readonly p95: number;
    readonly collected: number;
}

interface CandidateRound {
    readonly p95: number;
    readonly renderObjectCount: number;
    readonly transformUpdateCount: number;
    readonly boundsUpdateCount: number;
    readonly maximumStaticCoreAllocationBytes: number;
    readonly maximumDynamicCoreAllocationBytes: number;
}

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const manifest = JSON.parse(
    await readFile(resolve(repositoryRoot, 'benchmarks/ecs/manifest.json'), 'utf8')
) as Manifest;

async function run(command: string, arguments_: readonly string[], cwd: string): Promise<string> {
    return new Promise((resolveRun, rejectRun) => {
        const child = spawn(command, arguments_, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', chunk => {
            stdout += String(chunk);
        });
        child.stderr.on('data', chunk => {
            stderr += String(chunk);
        });
        child.once('error', rejectRun);
        child.once('close', code => {
            if (code === 0) resolveRun(stdout.trim());
            else rejectRun(new Error(`${command} exited ${String(code)}: ${stderr.trim()}`));
        });
    });
}

async function git(root: string, ...arguments_: readonly string[]): Promise<string> {
    return run('git', ['-C', root, ...arguments_], repositoryRoot);
}

function median(values: readonly number[]): number {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function main(): Promise<void> {
    const baselineRootArgument = process.argv[2];
    if (!baselineRootArgument) {
        throw new Error('Usage: npm run benchmark:ecs:compare -- <clean-baseline-worktree>');
    }
    if (process.versions.node !== manifest.nodeVersion) {
        throw new Error(
            `ECS migration benchmark requires Node ${manifest.nodeVersion}; received ${process.versions.node}.`
        );
    }
    const baselineRoot = resolve(baselineRootArgument);
    const baselineCommit = await git(baselineRoot, 'rev-parse', 'HEAD');
    if (baselineCommit !== manifest.baselineCommit) {
        throw new Error(
            `Baseline worktree must be ${manifest.baselineCommit}; received ${baselineCommit}.`
        );
    }
    const [baselineStatus, candidateStatus, candidateCommit] = await Promise.all([
        git(baselineRoot, 'status', '--porcelain'),
        git(repositoryRoot, 'status', '--porcelain'),
        git(repositoryRoot, 'rev-parse', 'HEAD')
    ]);
    if (baselineStatus.length > 0) throw new Error('Baseline worktree must be clean.');
    if (candidateStatus.length > 0)
        throw new Error('Candidate worktree must be clean and committed.');

    const jiti = resolve(repositoryRoot, 'node_modules/jiti/lib/jiti-cli.mjs');
    const baselineWorker = resolve(
        repositoryRoot,
        'scripts/performance/ecs-migration-node-stage-worker.ts'
    );
    const candidateWorker = resolve(
        repositoryRoot,
        'test/performance/helpers/ecs-migration-world-worker.ts'
    );
    const baselines: BaselineRound[] = [];
    const candidates: CandidateRound[] = [];
    for (let round = 0; round < manifest.rounds; round++) {
        const order = round % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
        for (const architecture of order) {
            if (architecture === 'baseline') {
                baselines.push(
                    JSON.parse(
                        await run(
                            process.execPath,
                            [jiti, baselineWorker, baselineRoot],
                            baselineRoot
                        )
                    ) as BaselineRound
                );
            } else {
                candidates.push(
                    JSON.parse(
                        await run(process.execPath, [jiti, candidateWorker], repositoryRoot)
                    ) as CandidateRound
                );
            }
        }
    }
    const expectedCount = manifest.staticEntityCount + manifest.dynamicEntityCount;
    if (baselines.some(round => round.collected !== expectedCount)) {
        throw new Error('Node/Stage baseline collected an incorrect renderable count.');
    }
    if (
        candidates.some(
            round =>
                round.renderObjectCount !== expectedCount ||
                round.transformUpdateCount !== manifest.dynamicEntityCount ||
                round.boundsUpdateCount !== manifest.dynamicEntityCount
        )
    ) {
        throw new Error('ECS candidate dirty extraction counters differ from the manifest.');
    }
    const baselineP95 = median(baselines.map(round => round.p95));
    const candidateP95 = median(candidates.map(round => round.p95));
    const improvementFraction = (baselineP95 - candidateP95) / baselineP95;
    const maximumCoreAllocationBytes = Math.max(
        ...candidates.flatMap(round => [
            round.maximumStaticCoreAllocationBytes,
            round.maximumDynamicCoreAllocationBytes
        ])
    );
    const passed =
        improvementFraction >= manifest.minimumP95ImprovementFraction &&
        maximumCoreAllocationBytes <= manifest.maximumCoreAllocationBytesPerFrame;
    const result = {
        schemaVersion: 1,
        suite: 'ecs-migration',
        baselineCommit,
        candidateCommit,
        nodeVersion: process.versions.node,
        staticEntityCount: manifest.staticEntityCount,
        dynamicEntityCount: manifest.dynamicEntityCount,
        baselineRounds: baselines,
        candidateRounds: candidates,
        baselineP95,
        candidateP95,
        improvementFraction,
        maximumCoreAllocationBytes,
        passed
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!passed) process.exitCode = 1;
}

const invokedDirectly = process.argv.some(argument => {
    try {
        return resolve(argument) === fileURLToPath(import.meta.url);
    } catch {
        return false;
    }
});

if (invokedDirectly) await main();
