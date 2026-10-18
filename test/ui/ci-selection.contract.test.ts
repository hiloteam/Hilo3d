import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    affectedUIGroups,
    assertHostedUIInventory,
    assertSeparateUIInventory,
    ciUIEnvironment,
    parseUIInvocation,
    preserveUIBlob,
    resetUIBlob,
    runUIAcceptance,
    separateUISpecs,
    type UITestInventoryEntry
} from '../../scripts/playwright-ci';
import { uiGroups } from '../../scripts/playwright-ui-groups';

const scheduled: UITestInventoryEntry[] = [
    { id: 'gallery', file: 'examples.spec.ts', title: 'gallery @webgl2' },
    { id: 'editor', file: 'editor-components.spec.ts', title: 'components @webgl2' }
];
const separate: UITestInventoryEntry[] = Object.keys(separateUISpecs).map(file => ({
    id: file,
    file,
    title: `${file} through webgl2`
}));
const discovered = [...scheduled, ...separate];

describe('UI acceptance preflight ordering', () => {
    it('blocks all GPU work when independent discovery finds an unscheduled new case', () => {
        const phases: string[] = [];
        const exitCode = runUIAcceptance(
            parseUIInvocation([], {}, () => []),
            arguments_ => {
                phases.push(arguments_[0] ?? 'missing entrypoint');
                if (arguments_.includes('scripts/check-ui-groups.ts')) {
                    try {
                        assertHostedUIInventory(
                            [
                                ...discovered,
                                { id: 'new', file: 'new.spec.ts', title: 'new @webgl2' }
                            ],
                            scheduled
                        );
                    } catch {
                        return 1;
                    }
                }
                return 0;
            },
            group => {
                phases.push(`GPU ${group}`);
                return 0;
            }
        );
        expect(exitCode).toBe(1);
        expect(phases).toEqual([
            'node_modules/vitest/vitest.mjs',
            'node_modules/jiti/lib/jiti-cli.mjs'
        ]);
    });

    it('fails immediately on Node contract errors and does not execute discovery or GPU groups', () => {
        const phases: string[] = [];
        expect(
            runUIAcceptance(
                parseUIInvocation([], {}, () => []),
                arguments_ => {
                    phases.push(arguments_[0] ?? 'missing entrypoint');
                    return 9;
                },
                group => {
                    phases.push(group);
                    return 0;
                }
            )
        ).toBe(9);
        expect(phases).toEqual(['node_modules/vitest/vitest.mjs']);
    });

    it('runs both audits before the selected groups and stops after the first failing group', () => {
        const phases: string[] = [];
        expect(
            runUIAcceptance(
                parseUIInvocation([], {}, () => []),
                arguments_ => {
                    phases.push(arguments_[0] ?? 'missing entrypoint');
                    return 0;
                },
                group => {
                    phases.push(group);
                    return group === 'catalog-scenes' ? 3 : 0;
                }
            )
        ).toBe(3);
        expect(phases).toEqual([
            'node_modules/vitest/vitest.mjs',
            'node_modules/jiti/lib/jiti-cli.mjs',
            'catalog',
            'catalog-scenes'
        ]);
    });

    it('keeps plan-only inspection cheap while still auditing a real invocation with no affected GPU groups', () => {
        const phases: string[] = [];
        const preflight = (arguments_: readonly string[]): number => {
            phases.push(arguments_[0] ?? 'missing entrypoint');
            return 0;
        };
        const group = (): number => {
            phases.push('GPU');
            return 0;
        };
        expect(
            runUIAcceptance(
                parseUIInvocation(['--plan'], {}, () => []),
                preflight,
                group
            )
        ).toBe(0);
        expect(phases).toEqual([]);
        expect(
            runUIAcceptance(
                parseUIInvocation(['--affected=HEAD'], {}, () => ['documentation/ENGINEERING.md']),
                preflight,
                group
            )
        ).toBe(0);
        expect(phases).toEqual([
            'node_modules/vitest/vitest.mjs',
            'node_modules/jiti/lib/jiti-cli.mjs'
        ]);
    });
});

describe('hosted UI discovery and reproduction', () => {
    it('preserves earlier group blobs when the next Playwright run clears its output directory', () => {
        const root = mkdtempSync(join(tmpdir(), 'hilo-ci-blobs-'));
        try {
            for (const group of ['catalog', 'physics'] as const) {
                // This is Playwright BlobReporter's actual output-directory cleanup boundary.
                rmSync(join(root, 'blob-report'), { recursive: true, force: true });
                mkdirSync(join(root, 'blob-report'));
                resetUIBlob(group, root);
                writeFileSync(join(root, 'blob-report', `report-${group}.zip`), group);
                expect(preserveUIBlob(group, root)).toBe(
                    join(root, 'reports/ci-ui-blobs', `report-${group}.zip`)
                );
            }
            for (const group of ['catalog', 'physics'])
                expect(
                    readFileSync(join(root, 'reports/ci-ui-blobs', `report-${group}.zip`), 'utf8')
                ).toBe(group);

            resetUIBlob('physics', root);
            expect(preserveUIBlob('physics', root)).toBeNull();
            expect(existsSync(join(root, 'reports/ci-ui-blobs/report-physics.zip'))).toBe(false);
            expect(existsSync(join(root, 'reports/ci-ui-blobs/report-catalog.zip'))).toBe(true);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
    it('accepts complete membership regardless of a maintained inventory count', () => {
        expect(() => {
            assertHostedUIInventory(discovered, scheduled);
        }).not.toThrow();
    });

    it('rejects a new WebGL2 spec that was omitted from the hosted command', () => {
        expect(() => {
            assertHostedUIInventory(
                [
                    ...discovered,
                    { id: 'new', file: 'new-showcase.spec.ts', title: 'new feature @webgl2' }
                ],
                scheduled
            );
        }).toThrow('Unscheduled WebGL2 tests: new-showcase.spec.ts');
    });

    it('rejects removing an existing component suite or duplicating its cases', () => {
        expect(() => {
            assertHostedUIInventory(discovered, scheduled.slice(0, 1));
        }).toThrow('editor-components.spec.ts');
        expect(() => {
            assertHostedUIInventory(discovered, [...scheduled, ...scheduled]);
        }).toThrow('Duplicate hosted UI tests');
    });

    it('requires separate-lane exceptions to stay explicit and live', () => {
        expect(() => {
            assertHostedUIInventory(scheduled, scheduled);
        }).toThrow('Stale separate UI lane');
        expect(() => {
            assertHostedUIInventory(discovered, discovered);
        }).toThrow('Unexpected hosted UI test');
    });

    it('rejects exclusions whose alternate command no longer schedules the actual test', () => {
        const owners = new Map(
            Object.entries(separateUISpecs).map(([file, lane]) => [
                lane.script,
                separate.filter(test => test.file === file)
            ])
        );
        expect(() => {
            assertSeparateUIInventory(discovered, owners);
        }).not.toThrow();
        owners.delete('test:webgpu');
        expect(() => {
            assertSeparateUIInventory(discovered, owners);
        }).toThrow('Separate UI case has no owner: test:webgpu');
    });

    it('runs exactly the hosted groups by default and honors the CI matrix selection', () => {
        expect(parseUIInvocation([], {}, () => [])).toEqual({
            groups: uiGroups,
            plan: false,
            arguments: []
        });
        expect(
            parseUIInvocation(
                ['--reporter=github,blob', '--plan'],
                { HILO3D_UI_GROUP: 'physics' },
                () => []
            )
        ).toEqual({
            groups: ['physics'],
            plan: true,
            arguments: ['--reporter=github,blob']
        });
        expect(() => parseUIInvocation([], { HILO3D_UI_GROUP: 'typo' }, () => [])).toThrow(
            'Unknown UI group'
        );
    });

    it('does not let affected selection narrow a hosted matrix job', () => {
        expect(() =>
            parseUIInvocation(['--affected=origin/dev'], { HILO3D_UI_GROUP: 'catalog' }, () => [])
        ).toThrow('cannot narrow');
        expect(() => parseUIInvocation(['--affected='], {}, () => [])).toThrow('valid base');
        expect(() => parseUIInvocation(['--affected=--help'], {}, () => [])).toThrow('valid base');
    });

    it('rejects arguments that narrow coverage, weaken assertions or change the GPU environment', () => {
        for (const argument of [
            '--grep=gallery',
            '--grep-invert=slow',
            '--project=chromium-native-webgpu',
            '--retries=3',
            '--workers=4',
            '--shard=1/2',
            '--config=alternate.ts',
            '--update-snapshots',
            '--pass-with-no-tests',
            'test/ui/examples.spec.ts'
        ])
            expect(() => parseUIInvocation([argument], {}, () => []), argument).toThrow(
                'Unsupported UI acceptance argument'
            );
        expect(
            parseUIInvocation(['--reporter', 'line,blob', '--output=reports/capture'], {}, () => [])
                .arguments
        ).toEqual(['--reporter', 'line,blob', '--output=reports/capture']);
        expect(() => parseUIInvocation(['--reporter'], {}, () => [])).toThrow('Missing diagnostic');
    });

    it('uses CI isolation settings and distinct report names for every local group', () => {
        const environments = uiGroups.map(group =>
            ciUIEnvironment(
                {
                    CI: 'false',
                    HILO3D_UI_GROUP: 'stale',
                    HILO3D_PLAYWRIGHT_PORT: '4399',
                    PLAYWRIGHT_BLOB_OUTPUT_FILE: 'blob-report/overwritten.zip'
                },
                group
            )
        );
        for (const [index, environment] of environments.entries()) {
            expect(environment['CI']).toBe('true');
            expect(environment['HILO3D_UI_GROUP']).toBe(uiGroups[index]);
            expect(environment['HILO3D_PLAYWRIGHT_PORT']).toBe('4399');
        }
        expect(new Set(environments.map(env => env['PLAYWRIGHT_BLOB_OUTPUT_FILE'])).size).toBe(
            uiGroups.length
        );
    });
});

describe('affected UI groups', () => {
    it('includes gallery behavior and the discovered page matrix for catalog metadata', () => {
        expect(affectedUIGroups(['examples/shared/catalog.ts'])).toEqual([
            'catalog',
            'catalog-scenes'
        ]);
    });

    it('includes catalog dependencies when adding a heavy material or physics page', () => {
        expect(
            affectedUIGroups(['examples/mat1_soft_matter.html', 'examples/mat1_soft_matter.ts'])
        ).toEqual(['catalog', 'catalog-scenes', 'post-processing']);
        expect(affectedUIGroups(['examples/physics/new-exhibit.html'])).toEqual([
            'catalog',
            'catalog-scenes',
            'physics'
        ]);
    });

    it('covers every group in a shared spec instead of classifying by filename alone', () => {
        expect(affectedUIGroups(['test/ui/examples.spec.ts'])).toEqual([
            'catalog',
            'catalog-scenes',
            'csm'
        ]);
        expect(affectedUIGroups(['test/ui/mat1-soft-matter.spec.ts'])).toEqual(['post-processing']);
    });

    it('fails closed to all groups for rendering, shared capture, config and unknown changes', () => {
        for (const path of [
            'src/render/renderer/MeshDrawProcessor.ts',
            'examples/shared/test-frame-control.ts',
            'test/ui/stable-capture.ts',
            'package.json',
            'playwright.config.ts',
            '.github/workflows/npm_test.yml',
            'examples/new-feature.html',
            'new-unknown-file.ts'
        ])
            expect(affectedUIGroups([path]), path).toEqual(uiGroups);
    });

    it('uses all changed paths supplied by the git boundary, not only committed source', () => {
        const bases: string[] = [];
        const invocation = parseUIInvocation(['--affected=origin/dev', '--plan'], {}, base => {
            bases.push(base);
            return ['examples/shared/catalog.ts', 'test/ui/mat1-soft-matter.spec.ts'];
        });
        expect(bases).toEqual(['origin/dev']);
        expect(invocation.groups).toEqual(['catalog', 'catalog-scenes', 'post-processing']);
        expect(invocation.arguments).toEqual([]);
        expect(affectedUIGroups(['documentation/ENGINEERING.md', 'CHANGELOG.md'])).toEqual([]);
    });
});
