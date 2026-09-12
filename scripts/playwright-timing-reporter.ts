import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

/** Diagnostic timing data, never a hardware performance baseline. */
export default class TimingReporter implements Reporter {
    private readonly rows: {
        title: string;
        durationMs: number;
        timeoutMs: number;
        status: string;
    }[] = [];

    onTestEnd(test: TestCase, result: TestResult): void {
        this.rows.push({
            title: test.titlePath().join(' › '),
            durationMs: result.duration,
            timeoutMs: test.timeout,
            status: result.status
        });
        if (result.duration > test.timeout * 0.7) {
            console.warn(
                `UI timeout budget above 70%: ${test.title} (${String(Math.round(result.duration / 1000))}s / ${String(test.timeout / 1000)}s)`
            );
        }
    }

    onEnd(): void {
        const directory = process.env['HILO3D_UI_TIMING_DIR'] ?? 'reports/ui-timings';
        mkdirSync(directory, { recursive: true });
        const name = process.env['HILO3D_UI_GROUP'] ?? 'all';
        const rows = this.rows.sort((a, b) => b.durationMs - a.durationMs);
        writeFileSync(join(directory, `${name}.json`), JSON.stringify(rows, null, 2));
        const summary = process.env['GITHUB_STEP_SUMMARY'];
        if (summary) {
            const table = rows
                .slice(0, 20)
                .map(
                    row =>
                        `| ${row.title.replaceAll('|', '/').replaceAll('\n', ' ')} | ${(row.durationMs / 1000).toFixed(1)} | ${String(Math.round((row.durationMs / row.timeoutMs) * 100))}% | ${row.status} |`
                )
                .join('\n');
            appendFileSync(
                summary,
                `\n### UI durations: ${name}\n\n| Test | Seconds | Budget used | Status |\n| --- | ---: | ---: | --- |\n${table}\n`
            );
        }
    }
}
