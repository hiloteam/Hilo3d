import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { uiGroups, uiGroupForTest } from './playwright-ui-groups';

interface ListedSuite {
    suites?: ListedSuite[];
    specs?: { id: string; title: string; file: string }[];
}

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts: Record<string, string>;
};
const command = packageJson.scripts['test:ui:webgl2:ci'];
if (!command) throw new Error('Missing hosted UI command');
const files = [...command.matchAll(/test\/ui\/[\w./-]+\.spec\.ts/gu)].map(match => match[0]);
if (files.length === 0) throw new Error('Hosted UI command has no test files');

function list(group?: string): Map<string, { title: string; file: string }> {
    const env = { ...process.env };
    delete env['HILO3D_UI_GROUP'];
    if (group) env['HILO3D_UI_GROUP'] = group;
    const result = spawnSync(
        process.execPath,
        [
            'node_modules/playwright/cli.js',
            'test',
            ...files,
            '--project=chromium',
            '--grep',
            '@webgl2|through webgl2',
            '--list',
            '--reporter=json'
        ],
        { env, encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }
    );
    if (result.status !== 0)
        throw new Error(`UI discovery failed: ${result.stderr}`, { cause: result.error });
    const report = JSON.parse(result.stdout) as { suites: ListedSuite[] };
    const tests = new Map<string, { title: string; file: string }>();
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

const all = list();
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
    const tests = list(group);
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
