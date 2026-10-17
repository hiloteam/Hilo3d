/** Disjoint presentation workloads; each machine still runs exactly one GPU worker. */
export const uiGroups = [
    'catalog',
    'catalog-scenes',
    'csm',
    'physics',
    'post-processing',
    'chromatic'
] as const;
export type UIGroup = (typeof uiGroups)[number];

export function uiGroupForTest(file: string, title: string): UIGroup {
    if (file.endsWith('physics.spec.ts')) return 'physics';
    if (
        file.endsWith('post-processing.spec.ts') ||
        file.endsWith('rain-tea-garden.spec.ts') ||
        file.endsWith('mat1-materials.spec.ts') ||
        file.endsWith('mat1-soft-matter.spec.ts')
    )
        return 'post-processing';
    if (file.endsWith('scriptable-pipeline.spec.ts')) return 'chromatic';
    if (file.endsWith('examples.spec.ts') && title.includes('cascaded shadow toy')) return 'csm';
    if (file.endsWith('examples.spec.ts') && title.includes('.html renders through '))
        return 'catalog-scenes';
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
            testIgnore:
                /(?:physics|post-processing|scriptable-pipeline|rain-tea-garden|mat1-materials|mat1-soft-matter)\.spec\.ts$/u,
            grepInvert: /cascaded shadow toy|\.html renders through /u
        };
    }
    if (group === 'catalog-scenes') {
        return {
            testIgnore: /^(?!.*[/\\]examples\.spec\.ts$)/u,
            grepInvert: /^(?!.*\.html renders through )/u
        };
    }
    const file =
        group === 'csm'
            ? 'examples'
            : group === 'chromatic'
              ? 'scriptable-pipeline'
              : group === 'post-processing'
                ? '(?:post-processing|rain-tea-garden|mat1-materials|mat1-soft-matter)'
                : group;
    return {
        testIgnore: new RegExp(`^(?!.*[/\\\\]${file}\\.spec\\.ts$)`, 'u'),
        ...(group === 'csm' ? { grepInvert: /^(?!.*cascaded shadow toy)/u } : {})
    };
}
