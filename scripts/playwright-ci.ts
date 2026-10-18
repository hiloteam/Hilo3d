import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { uiGroupForTest, uiGroups, type UIGroup } from './playwright-ui-groups';

/** One inventory shared by hosted CI, local reproduction and the independent discovery audit. */
export const hostedUISpecFiles = [
    'examples',
    'animation',
    'live2d',
    'post-processing',
    'scriptable-pipeline',
    'runtime-parity',
    'mat1-materials',
    'mat1-soft-matter',
    'physics',
    'visual',
    'editor',
    'editor-authoring',
    'editor-components'
].map(name => `test/ui/${name}.spec.ts`);

/** These independently discovered cases have a different, explicit execution contract. */
export const separateUISpecs: Readonly<Record<string, { script: string; reason: string }>> = {
    'editor-pages.spec.ts': {
        script: 'test:editor:pages',
        reason: 'Production Pages artifacts use a separate config in the required macOS editor job.'
    },
    'webgpu.spec.ts': {
        script: 'test:webgpu',
        reason: 'Deep cross-backend runtime fixtures run together in the full release WebGPU command.'
    }
};

export interface UITestInventoryEntry {
    readonly id: string;
    readonly title: string;
    readonly file: string;
}

export function assertSeparateUIInventory(
    discovered: readonly UITestInventoryEntry[],
    owners: ReadonlyMap<string, readonly UITestInventoryEntry[]>
): void {
    for (const test of discovered) {
        const lane = separateUISpecs[test.file];
        if (!lane) continue;
        if (
            !owners
                .get(lane.script)
                ?.some(owned => owned.file === test.file && owned.title === test.title)
        )
            throw new Error(`Separate UI case has no owner: ${lane.script}: ${test.title}`);
    }
}

export function hostedUIArguments(): string[] {
    return ['test', ...hostedUISpecFiles, '--project=chromium', '--grep', '@webgl2|through webgl2'];
}

/** Compare against all independently discovered specs, never against the manifest itself. */
export function assertHostedUIInventory(
    discovered: readonly UITestInventoryEntry[],
    scheduled: readonly UITestInventoryEntry[]
): void {
    const expected = new Map(
        discovered.filter(test => !separateUISpecs[test.file]).map(test => [test.id, test])
    );
    const actual = new Set(scheduled.map(test => test.id));
    if (actual.size !== scheduled.length) throw new Error('Duplicate hosted UI tests');
    for (const test of scheduled) {
        if (!expected.has(test.id)) throw new Error(`Unexpected hosted UI test: ${test.title}`);
    }
    const missing = [...expected.values()].filter(test => !actual.has(test.id));
    if (missing.length) {
        throw new Error(
            `Unscheduled WebGL2 tests: ${missing.map(test => `${test.file}: ${test.title}`).join(', ')}`
        );
    }
    for (const file of Object.keys(separateUISpecs)) {
        if (!discovered.some(test => test.file === file))
            throw new Error(`Stale separate UI lane: ${file}`);
    }
}

export function ciUIEnvironment(environment: NodeJS.ProcessEnv, group: UIGroup): NodeJS.ProcessEnv {
    return {
        ...environment,
        CI: 'true',
        HILO3D_UI_GROUP: group,
        PLAYWRIGHT_BLOB_OUTPUT_FILE: `blob-report/report-${group}.zip`
    };
}

/** A reporter may be disabled, so stale files must not be mistaken for this group's evidence. */
export function resetUIBlob(group: UIGroup, root = process.cwd()): void {
    rmSync(join(root, 'blob-report', `report-${group}.zip`), { force: true });
    rmSync(join(root, 'reports/ci-ui-blobs', `report-${group}.zip`), { force: true });
}

/** Playwright clears blob-report at each invocation; retain completed groups outside that folder. */
export function preserveUIBlob(group: UIGroup, root = process.cwd()): string | null {
    const source = join(root, 'blob-report', `report-${group}.zip`);
    if (!existsSync(source)) return null;
    const directory = join(root, 'reports/ci-ui-blobs');
    mkdirSync(directory, { recursive: true });
    const destination = join(directory, `report-${group}.zip`);
    copyFileSync(source, destination);
    return destination;
}

/** Conservative local selection: unclassified/shared changes require the complete UI gate. */
export function affectedUIGroups(paths: readonly string[]): UIGroup[] {
    const selected = new Set<UIGroup>();
    for (const path of paths) {
        if (
            path.startsWith('documentation/') ||
            path.startsWith('skills/') ||
            /^(?:README(?:_ZH)?|CHANGELOG|AGENTS)\.md$/u.test(path)
        )
            continue;
        if (
            /^examples\/(?:index|list)\.(?:ts|html|css)$/u.test(path) ||
            path === 'examples/shared/catalog.ts' ||
            /^test\/ui\/example-paths(?:\.contract)?\.ts$/u.test(path)
        ) {
            selected.add('catalog');
            selected.add('catalog-scenes');
            continue;
        }
        if (path === 'test/ui/examples.spec.ts') {
            selected.add('catalog');
            selected.add('catalog-scenes');
            selected.add('csm');
            continue;
        }
        if (hostedUISpecFiles.includes(path)) {
            selected.add(uiGroupForTest(path, ''));
            continue;
        }
        if (path.startsWith('examples/')) {
            // Every page addition/removal changes discovery and can change gallery membership.
            if (path.endsWith('.html')) {
                selected.add('catalog');
                selected.add('catalog-scenes');
            }
            if (path.startsWith('examples/physics/')) selected.add('physics');
            else if (path.startsWith('examples/cascaded_shadows.')) selected.add('csm');
            else if (
                /^examples\/(?:mat1_soft_matter|mat1_materials)\./u.test(path) ||
                path === 'examples/shared/softMatterTextures.ts' ||
                path.startsWith('examples/assets/mat1-soft-matter/')
            )
                selected.add('post-processing');
            else return [...uiGroups];
            selected.add('catalog-scenes');
            continue;
        }
        return [...uiGroups];
    }
    return uiGroups.filter(group => selected.has(group));
}

export interface UIInvocation {
    readonly groups: readonly UIGroup[];
    readonly plan: boolean;
    readonly arguments: readonly string[];
    readonly base?: string;
    readonly changedPaths?: readonly string[];
}

/** Every real acceptance invocation audits coverage before it can launch any GPU group. */
export function runUIAcceptance(
    invocation: UIInvocation,
    runPreflight: (arguments_: readonly string[]) => number,
    runGroup: (group: UIGroup) => number
): number {
    if (invocation.plan) return 0;
    for (const arguments_ of [
        ['node_modules/vitest/vitest.mjs', 'run', '--config', 'test/ui/vitest-contract.config.ts'],
        ['node_modules/jiti/lib/jiti-cli.mjs', 'scripts/check-ui-groups.ts']
    ]) {
        const exitCode = runPreflight(arguments_);
        if (exitCode !== 0) return exitCode;
    }
    for (const group of invocation.groups) {
        const exitCode = runGroup(group);
        if (exitCode !== 0) return exitCode;
    }
    return 0;
}

export function parseUIInvocation(
    args: readonly string[],
    environment: NodeJS.ProcessEnv,
    changedPaths: (base: string) => readonly string[]
): UIInvocation {
    const group = environment['HILO3D_UI_GROUP'];
    if (group !== undefined && !uiGroups.some(candidate => candidate === group))
        throw new Error(`Unknown UI group: ${group}`);
    const affected = args.filter(argument => argument.startsWith('--affected='));
    if (affected.length > 1) throw new Error('Specify --affected only once');
    if (affected.length && group !== undefined)
        throw new Error('--affected cannot narrow an explicit HILO3D_UI_GROUP');
    const base = affected[0]?.slice('--affected='.length);
    if (base !== undefined && (!base || base.startsWith('-')))
        throw new Error('--affected requires a valid base commit or ref');
    const paths = base === undefined ? undefined : changedPaths(base);
    const diagnosticArguments = args.filter(
        argument => argument !== '--plan' && !argument.startsWith('--affected=')
    );
    for (let index = 0; index < diagnosticArguments.length; index += 1) {
        const argument = diagnosticArguments[index];
        if (!argument) throw new Error('Empty UI argument');
        if (/^--(?:reporter|output)=.+/u.test(argument)) continue;
        if (argument === '--reporter' || argument === '--output') {
            const value = diagnosticArguments[++index];
            if (value && !value.startsWith('-')) continue;
            throw new Error(`Missing diagnostic option value: ${argument}`);
        }
        throw new Error(
            `Unsupported UI acceptance argument: ${argument}. Only --reporter and --output diagnostics may override the complete gate; use --plan to inspect selection.`
        );
    }
    return {
        groups:
            paths !== undefined
                ? affectedUIGroups(paths)
                : group !== undefined
                  ? [group as UIGroup]
                  : uiGroups,
        plan: args.includes('--plan'),
        arguments: diagnosticArguments,
        ...(base !== undefined && paths !== undefined ? { base, changedPaths: paths } : {})
    };
}
