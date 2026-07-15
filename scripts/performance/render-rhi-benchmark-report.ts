import { readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    RHI_BENCHMARK_METRICS,
    type RHIBenchmarkBaselineResult
} from '../../benchmarks/rhi/result-schema';
import { rhiBenchmarkMedian } from './rhi-benchmark-statistics';
import { assertRHIPhase0Preflight, readRHIPhase0EnvironmentFile } from './rhi-phase0-preflight';
import { canonicalRHIJson, verifyRHIBaseline } from './verify-rhi-baseline';

function markdownCell(value: string): string {
    return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function numberCell(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toPrecision(8);
}

function outputIsBaselinePath(repositoryRoot: string, outputPath: string): boolean {
    const baselineRoot = resolve(repositoryRoot, 'benchmarks/rhi/baselines');
    const child = relative(baselineRoot, resolve(outputPath));
    return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

/** Render only verified summary values; this function never invents or estimates missing metrics. */
export function renderRHIBenchmarkReport(summary: RHIBenchmarkBaselineResult): string {
    const lines = [
        '# RHI benchmark baseline report',
        '',
        `- Commit: \`${summary.commitSha}\``,
        `- Captured: ${summary.capturedAt}`,
        `- Rig: ${markdownCell(summary.environment.rigProfile)}`,
        `- Environment fingerprint: \`${summary.environment.fingerprintSha256}\``,
        `- Chromium executable: \`${summary.environment.browserExecutableSha256}\``,
        `- Raw artifact: \`${markdownCell(summary.rawArtifact.path)}\` (\`${summary.rawArtifact.sha256}\`)`,
        ''
    ];
    for (const benchmarkCase of summary.cases) {
        lines.push(
            `## ${benchmarkCase.scenarioId} / ${benchmarkCase.backend}`,
            '',
            `Pixel hash: \`${benchmarkCase.pixelHashSha256}\`; observed draws: ${String(benchmarkCase.observedDrawCount)}.`,
            '',
            '| Metric | Round-median median | Worst p95 | Worst p99 | Median MAD | Median CV | Bootstrap CI envelope |',
            '| --- | ---: | ---: | ---: | ---: | ---: | ---: |'
        );
        for (const metric of RHI_BENCHMARK_METRICS) {
            const distributions = benchmarkCase.rounds.map(round => round.metrics[metric]);
            lines.push(
                `| ${metric} | ${numberCell(rhiBenchmarkMedian(distributions.map(item => item.median)))} | ${numberCell(Math.max(...distributions.map(item => item.p95)))} | ${numberCell(Math.max(...distributions.map(item => item.p99)))} | ${numberCell(rhiBenchmarkMedian(distributions.map(item => item.mad)))} | ${numberCell(rhiBenchmarkMedian(distributions.map(item => item.coefficientOfVariation)))} | ${numberCell(Math.min(...distributions.map(item => item.confidenceInterval.low)))}–${numberCell(Math.max(...distributions.map(item => item.confidenceInterval.high)))} |`
            );
        }
        lines.push('');
    }
    return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
    const summaryArgument = process.argv[2];
    const outputArgument = process.argv[3];
    if (!summaryArgument || !outputArgument) {
        throw new Error('Usage: npm run benchmark:rhi:report -- <summary.json> <report.md>');
    }
    const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
    if (outputIsBaselinePath(repositoryRoot, outputArgument)) {
        throw new Error('report renderer may only write temporary reports, never baseline files');
    }
    const manifestPath = resolve(repositoryRoot, 'benchmarks/rhi/manifest.json');
    const [manifestSource, summarySource, environmentValue] = await Promise.all([
        readFile(manifestPath, 'utf8'),
        readFile(resolve(summaryArgument), 'utf8'),
        readRHIPhase0EnvironmentFile()
    ]);
    const manifestValue = JSON.parse(manifestSource) as unknown;
    const summaryValue = JSON.parse(summarySource) as unknown;
    const preflight = await assertRHIPhase0Preflight({
        repositoryRoot,
        manifestValue,
        environmentValue
    });
    const summaryRecord = summaryValue as { rawArtifact?: { path?: unknown } };
    if (typeof summaryRecord.rawArtifact?.path !== 'string') {
        throw new Error('summary raw artifact path is missing');
    }
    const rawBytes = await readFile(
        resolve(dirname(resolve(summaryArgument)), summaryRecord.rawArtifact.path)
    );
    const verified = verifyRHIBaseline(preflight.manifest, summaryValue, rawBytes);
    if (canonicalRHIJson(verified.environment) !== canonicalRHIJson(preflight.environment)) {
        throw new Error('report environment differs from the audited preflight environment');
    }
    await writeFile(resolve(outputArgument), renderRHIBenchmarkReport(verified), { flag: 'wx' });
}

const invokedDirectly = process.argv.some(argument => {
    try {
        return resolve(argument) === fileURLToPath(import.meta.url);
    } catch {
        return false;
    }
});

if (invokedDirectly) await main();
