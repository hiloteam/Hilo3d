/** Disjoint presentation workloads; each machine still runs exactly one GPU worker. */
export const uiGroups = ['catalog', 'csm', 'physics', 'post-processing', 'chromatic'] as const;
export type UIGroup = (typeof uiGroups)[number];

export function uiGroupForTest(file: string, title: string): UIGroup {
    if (file.endsWith('physics.spec.ts')) return 'physics';
    if (file.endsWith('post-processing.spec.ts')) return 'post-processing';
    if (file.endsWith('scriptable-pipeline.spec.ts')) return 'chromatic';
    if (file.endsWith('examples.spec.ts') && title.includes('cascaded shadow toy')) return 'csm';
    return 'catalog';
}

export function uiGroupFilter(group: string | undefined): {
    testIgnore?: RegExp;
    grepInvert?: RegExp;
} {
    if (group === undefined) return {};
    if (!uiGroups.some(candidate => candidate === group))
        throw new Error(`Unknown UI group: ${group}`);
    if (group === 'catalog') {
        return {
            testIgnore: /(?:physics|post-processing|scriptable-pipeline)\.spec\.ts$/u,
            grepInvert: /cascaded shadow toy/u
        };
    }
    const file =
        group === 'csm' ? 'examples' : group === 'chromatic' ? 'scriptable-pipeline' : group;
    return {
        testIgnore: new RegExp(`^(?!.*[/\\\\]${file}\\.spec\\.ts$)`, 'u'),
        ...(group === 'csm' ? { grepInvert: /^(?!.*cascaded shadow toy)/u } : {})
    };
}
