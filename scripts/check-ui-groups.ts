import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
    assertHostedUIInventory,
    assertSeparateUIInventory,
    hostedUIArguments,
    hostedUISpecFiles,
    separateUISpecs
} from './playwright-ci';
import { uiGroups, uiGroupForTest } from './playwright-ui-groups';

interface ListedSuite {
    suites?: ListedSuite[];
    specs?: { id: string; title: string; file: string }[];
}

function discoverSpecs(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name);
        return entry.isDirectory()
            ? discoverSpecs(path)
            : entry.name.endsWith('.spec.ts')
              ? [path]
              : [];
    });
}

function list(
    files: readonly string[],
    group?: string
): Map<string, { id: string; title: string; file: string }> {
    return listArguments(
        ['test', ...files, ...hostedUIArguments().slice(1 + hostedUISpecFiles.length)],
        group
    );
}

function listArguments(
    args: readonly string[],
    group?: string
): Map<string, { id: string; title: string; file: string }> {
    const env: NodeJS.ProcessEnv = { ...process.env, CI: 'true' };
    delete env['HILO3D_UI_GROUP'];
    if (group) env['HILO3D_UI_GROUP'] = group;
    const result = spawnSync(
        process.execPath,
        ['node_modules/playwright/cli.js', ...args, '--list', '--reporter=json'],
        { env, encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }
    );
    if (result.status !== 0)
        throw new Error(`UI discovery failed: ${result.stderr}`, { cause: result.error });
    const report = JSON.parse(result.stdout) as { suites: ListedSuite[] };
    const tests = new Map<string, { id: string; title: string; file: string }>();
    function visit(suites: ListedSuite[]): void {
        for (const suite of suites) {
            for (const spec of suite.specs ?? []) {
                if (tests.has(spec.id)) throw new Error(`Duplicate test: ${spec.title}`);
                tests.set(spec.id, spec);
            }
            visit(suite.suites ?? []);
        }
    }
    visit(report.suites);
    if (!tests.size) throw new Error(`Empty UI group: ${group ?? 'all'}`);
    return tests;
}

const all = list(hostedUISpecFiles);
const discovered = [...list(discoverSpecs('test/ui')).values()];
assertHostedUIInventory(discovered, [...all.values()]);
const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts: Record<string, string>;
};
const owners = new Map<string, { id: string; title: string; file: string }[]>();
for (const { script } of Object.values(separateUISpecs)) {
    const command = packageJson.scripts[script];
    if (!command?.startsWith('playwright test ') || /["';&|]/u.test(command))
        throw new Error(
            `Separate UI lane must have an auditable direct Playwright command: ${script}`
        );
    owners.set(script, [...listArguments(command.split(/\s+/u).slice(1)).values()]);
}
assertSeparateUIInventory(discovered, owners);
const workflow = readFileSync('.github/workflows/npm_test.yml', 'utf8');
const matrix = /^\s+group: \[([^\]]+)\]/mu
    .exec(workflow)?.[1]
    ?.split(',')
    .map(value => value.trim());
if (!matrix || [...matrix].sort().join(',') !== [...uiGroups].sort().join(',')) {
    throw new Error('The workflow matrix must schedule every UI group exactly once');
}
const scheduled = new Set<string>();
for (const group of uiGroups) {
    const tests = list(hostedUISpecFiles, group);
    for (const [id, test] of tests) {
        if (!all.has(id) || scheduled.has(id) || uiGroupForTest(test.file, test.title) !== group) {
            throw new Error(`Unexpected or overlapping UI assignment: ${group}: ${test.title}`);
        }
        scheduled.add(id);
    }
    console.info(`${group}: ${String(tests.size)} tests`);
}
if (scheduled.size !== all.size)
    throw new Error(
        `Missing UI tests: ${[...all]
            .filter(([id]) => !scheduled.has(id))
            .map(([, test]) => test.title)
            .join(', ')}`
    );
console.info(`Verified ${String(all.size)} WebGL2 tests, each scheduled exactly once.`);
