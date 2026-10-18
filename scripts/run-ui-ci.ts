import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    ciUIEnvironment,
    hostedUIArguments,
    parseUIInvocation,
    preserveUIBlob,
    resetUIBlob
} from './playwright-ci';

function git(args: string[]): string {
    const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0)
        throw new Error(`Cannot determine affected UI groups: ${result.stderr}`, {
            cause: result.error
        });
    return result.stdout;
}

function sourceState(): { commit: string; dirty: boolean; fingerprint: string } {
    const commit = git(['rev-parse', 'HEAD']).trim();
    const diff = git(['diff', '--binary', 'HEAD', '--']);
    const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'])
        .split('\0')
        .filter(Boolean)
        .sort();
    const hash = createHash('sha256').update(commit).update('\0').update(diff);
    for (const path of untracked)
        hash.update('\0').update(path).update('\0').update(readFileSync(path));
    return { commit, dirty: Boolean(diff || untracked.length), fingerprint: hash.digest('hex') };
}

const invocation = parseUIInvocation(process.argv.slice(2), process.env, base => {
    const commit = git(['rev-parse', '--verify', `${base}^{commit}`]).trim();
    return [
        ...git(['diff', '--no-renames', '--name-only', '-z', `${commit}...HEAD`, '--']).split('\0'),
        ...git(['diff', '--no-renames', '--name-only', '-z', 'HEAD', '--']).split('\0'),
        ...git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0')
    ].filter(Boolean);
});

console.info(`Hosted UI groups: ${invocation.groups.join(', ') || '(no UI changes)'}`);
if (!invocation.plan) {
    const directory = process.env['HILO3D_UI_TIMING_DIR'] ?? 'reports/ui-timings';
    mkdirSync(directory, { recursive: true });
    const playwrightPackage = JSON.parse(
        readFileSync('node_modules/@playwright/test/package.json', 'utf8')
    ) as { version: string };
    const reporter = invocation.arguments.some(argument => argument.startsWith('--reporter'))
        ? []
        : ['--reporter=line,blob,./scripts/playwright-timing-reporter.ts'];
    const baseline = sourceState();
    for (const group of invocation.groups) {
        console.info(`\nRunning complete ${group} group with CI=true and a fresh server.`);
        const args = [...hostedUIArguments(), ...reporter, ...invocation.arguments];
        const before = sourceState();
        const receipt = {
            startedAt: new Date().toISOString(),
            source: baseline,
            sourceBefore: before,
            base: invocation.base ?? null,
            changedPaths: invocation.changedPaths ?? null,
            groups: invocation.groups,
            group,
            node: process.version,
            platform: process.platform,
            architecture: process.arch,
            playwright: playwrightPackage.version,
            project: 'chromium',
            configuration: 'playwright.config.ts',
            ci: true,
            arguments: args
        };
        const path = join(directory, `ci-run-${group}.json`);
        if (before.fingerprint !== baseline.fingerprint) {
            writeFileSync(
                path,
                JSON.stringify(
                    { ...receipt, status: 'failed', reason: 'Source changed between groups.' },
                    null,
                    2
                )
            );
            console.error('Source changed between groups; rerun the complete selection.');
            process.exitCode = 1;
            break;
        }
        resetUIBlob(group);
        writeFileSync(path, JSON.stringify({ ...receipt, status: 'running' }, null, 2));
        const result = spawnSync(process.execPath, ['node_modules/playwright/cli.js', ...args], {
            env: ciUIEnvironment(process.env, group),
            stdio: 'inherit'
        });
        const blob = preserveUIBlob(group);
        const after = sourceState();
        const sourceUnchanged = baseline.fingerprint === after.fingerprint;
        const exitCode = result.status ?? 1;
        writeFileSync(
            path,
            JSON.stringify(
                {
                    ...receipt,
                    completedAt: new Date().toISOString(),
                    sourceAfter: after,
                    blob,
                    sourceUnchanged,
                    status: exitCode === 0 && sourceUnchanged ? 'passed' : 'failed',
                    exitCode
                },
                null,
                2
            )
        );
        if (exitCode !== 0 || !sourceUnchanged) {
            console.error(`Hosted UI group failed: ${group}`);
            if (!sourceUnchanged)
                console.error(
                    'Source changed during the run; this result cannot validate the current checkout.'
                );
            if (result.error) console.error(result.error.message);
            process.exitCode = exitCode || 1;
            break;
        }
    }
}
