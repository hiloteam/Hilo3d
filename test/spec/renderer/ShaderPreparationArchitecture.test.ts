import { describe, expect, it } from 'vitest';

const sharedShaderSources = import.meta.glob<string>(
    '../../../src/render/shader/**/*.{ts,tsx,mts,cts}',
    {
        eager: true,
        query: '?raw',
        import: 'default'
    }
);
const internalBackendSources = import.meta.glob(
    '../../../src/render/internal/{webgl2,webgpu}/**/*.{ts,tsx,mts,cts}'
);

interface SourceViolation {
    readonly path: string;
    readonly match: string;
}

function collectMatches(pattern: RegExp): SourceViolation[] {
    const violations: SourceViolation[] = [];
    for (const [path, source] of Object.entries(sharedShaderSources)) {
        pattern.lastIndex = 0;
        for (const match of source.matchAll(pattern)) {
            violations.push({ path, match: match[0] });
        }
    }
    return violations;
}

describe('shared shader preparation architecture', () => {
    it('owns translation, binding layout and portable uniform packing', () => {
        const paths = Object.keys(sharedShaderSources);
        for (const file of ['GlslToWgsl.ts', 'WebGPUBindingLayout.ts', 'WgslUniformLayout.ts']) {
            expect(
                paths.some(path => path.endsWith(`/render/shader/${file}`)),
                file
            ).toBe(true);
        }

        expect(
            Object.keys(internalBackendSources).filter(path =>
                /\/(?:WebGPUBindingLayout|WgslUniformLayout)\.ts$/u.test(path)
            )
        ).toEqual([]);
    });

    it('does not import backend drivers or native RHI implementations', () => {
        expect(
            collectMatches(
                /(?:from\s+|import\s*\(\s*)['"][^'"]*(?:\/internal\/|\/rhi\/(?:backends\/)?(?:webgl2|webgpu))(?:\/[^'"]*)?['"]/gu
            )
        ).toEqual([]);
    });

    it('contains no native graphics API types or context access', () => {
        expect(
            collectMatches(
                /\bGPU[A-Z][A-Za-z0-9_]*\b|\bWebGL(?:2RenderingContext|RenderingContext)\b|\bnavigator\s*(?:\?\.|\.)\s*gpu\b|\.getContext\s*\(\s*['"](?:webgl2?|webgpu)['"]/gu
            )
        ).toEqual([]);
    });
});
