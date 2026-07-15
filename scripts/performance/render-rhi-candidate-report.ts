import type {
    RHIBenchmarkCandidateGateResult,
    RHIBenchmarkCandidateMetricGate
} from '../../benchmarks/rhi/result-schema';

function markdownCell(value: string): string {
    return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function numberCell(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toPrecision(8);
}

function regressionCell(gate: RHIBenchmarkCandidateMetricGate): string {
    return gate.regressionFractionUnbounded
        ? 'unbounded'
        : numberCell(gate.regressionFraction ?? 0);
}

function optionalCapCell(gate: RHIBenchmarkCandidateMetricGate): string {
    if (gate.kind === 'paired-significance') return '-';
    const values: string[] = [];
    if (gate.maximumRegressionFraction !== undefined) {
        values.push(`fraction <= ${numberCell(gate.maximumRegressionFraction)}`);
    }
    if (gate.absoluteMaximum !== undefined) {
        values.push(`absolute <= ${numberCell(gate.absoluteMaximum)}`);
    }
    return values.length === 0 ? '-' : values.join('; ');
}

function pairedConfidenceCell(gate: RHIBenchmarkCandidateMetricGate): string {
    if (gate.kind !== 'paired-significance') return '-';
    const interval = gate.pairedDifferenceConfidenceInterval;
    return `${numberCell(interval.low)} - ${numberCell(interval.high)} (${numberCell(interval.confidenceLevel * 100)}%)`;
}

/** Render only values from a checked candidate-gate result. */
export function renderRHICandidateGateReport(result: RHIBenchmarkCandidateGateResult): string {
    const lines = [
        '# RHI paired candidate gate report',
        '',
        `- Result: **${result.passed ? 'PASS' : 'FAIL'}**`,
        `- Scope: \`${result.scope}\``,
        '- Recovery gate: **not covered**; run the separate context/device-loss runtime suite.',
        `- Manifest: \`${result.manifestSha256}\``,
        `- Rig: ${markdownCell(result.environment.rigProfile)}`,
        `- Environment fingerprint: \`${result.environment.fingerprintSha256}\``,
        `- Frozen legacy commit: \`${result.frozenBaseline.commitSha}\``,
        `- Frozen legacy fixture: \`${result.frozenBaseline.productionFixtureSha256}\``,
        `- Frozen summary: \`${result.frozenBaseline.summarySha256}\``,
        `- Frozen raw artifact: \`${result.frozenBaseline.sha256}\``,
        `- Paired candidate commit: \`${result.pairedCandidate.commitSha}\``,
        `- Paired candidate fixture: \`${result.pairedCandidate.productionFixtureSha256}\``,
        `- Paired raw artifact: \`${result.pairedCandidate.sha256}\``,
        '- Paired significance reference: current-run `paired-legacy` versus same-round `rhi`.',
        '- Hard-cap reference: immutable `frozen-legacy`; cross-time rows make no paired CI/significance claim.',
        '',
        '## Summary',
        '',
        '| Cases | Pixel/draw rounds | Failed parity rounds | Metric gates | Passed gates | Failed gates |',
        '| ---: | ---: | ---: | ---: | ---: | ---: |',
        `| ${String(result.summary.caseCount)} | ${String(result.summary.parityRoundCount)} | ${String(result.summary.failedParityRoundCount)} | ${String(result.summary.gateCount)} | ${String(result.summary.passedGateCount)} | ${String(result.summary.failedGateCount)} |`,
        ''
    ];

    for (const benchmarkCase of result.cases) {
        lines.push(
            `## ${benchmarkCase.scenarioId} / ${benchmarkCase.backend}`,
            '',
            `Case result: **${benchmarkCase.passed ? 'PASS' : 'FAIL'}**`,
            `Expected draw count: ${String(benchmarkCase.expectedDrawCount)}`,
            `Frozen pixel hash: \`${benchmarkCase.frozenPixelHashSha256}\``,
            '',
            '| Round | Order | Legacy draws | Candidate draws | Draw parity | Legacy pixel hash | Candidate pixel hash | Pixel parity vs frozen |',
            '| ---: | --- | ---: | ---: | --- | --- | --- | --- |'
        );
        for (const round of benchmarkCase.parityRounds) {
            lines.push(
                `| ${String(round.round)} | ${round.order.join(' -> ')} | ${String(round.legacyObservedDrawCount)} | ${String(round.candidateObservedDrawCount)} | ${round.drawCountPassed ? 'PASS' : 'FAIL'} | \`${round.legacyPixelHashSha256}\` | \`${round.candidatePixelHashSha256}\` | ${round.pixelHashPassed ? 'PASS' : 'FAIL'} |`
            );
        }
        lines.push(
            '',
            '| Gate | Kind | Metric | Statistic | Reference | Reference value | Comparison | Comparison value | Regression | Paired CI | Cap | Significant | Cap exceeded | Result |',
            '| --- | --- | --- | --- | --- | ---: | --- | ---: | ---: | --- | --- | --- | --- | --- |'
        );
        for (const gate of benchmarkCase.gates) {
            lines.push(
                `| ${markdownCell(gate.id)} | ${gate.kind} | ${gate.metric} | ${gate.statistic} | ${gate.reference} | ${numberCell(gate.referenceValue)} | ${gate.comparison} | ${numberCell(gate.comparisonValue)} | ${regressionCell(gate)} | ${pairedConfidenceCell(gate)} | ${optionalCapCell(gate)} | ${gate.kind === 'paired-significance' ? (gate.significantRegression ? 'yes' : 'no') : '-'} | ${gate.kind === 'paired-significance' ? '-' : gate.hardCapExceeded ? 'yes' : 'no'} | ${gate.passed ? 'PASS' : 'FAIL'} |`
            );
        }
        lines.push('');
    }

    return `${lines.join('\n')}\n`;
}
