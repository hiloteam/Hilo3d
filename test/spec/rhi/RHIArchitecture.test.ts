import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>('../../../src/rhi/**/*.ts', {
    eager: true,
    query: '?raw',
    import: 'default'
});

function entriesBelow(directory: '/webgl/' | '/webgpu/'): [string, string][] {
    return Object.entries(sources).filter(([path]) => path.includes(directory));
}

interface SourceViolation {
    readonly path: string;
    readonly match: string;
}

function collectMatches(
    entries: readonly (readonly [string, string])[],
    pattern: RegExp
): SourceViolation[] {
    const violations: SourceViolation[] = [];
    for (const [path, source] of entries) {
        pattern.lastIndex = 0;
        for (const match of source.matchAll(pattern)) {
            violations.push({ path, match: match[0] });
        }
    }
    return violations;
}

function methodBody(source: string, methodName: string): string {
    const signature = new RegExp(`\\n\\s{4}(?:private\\s+)?${methodName}\\s*\\(`, 'u').exec(source);
    if (!signature) throw new Error(`Could not find ${methodName} method`);
    const openingBrace = source.indexOf('{', signature.index);
    if (openingBrace < 0) throw new Error(`Could not find ${methodName} method body`);
    let depth = 0;
    for (let index = openingBrace; index < source.length; index++) {
        const character = source[index];
        if (character === '{') depth++;
        else if (character === '}' && --depth === 0) {
            return source.slice(openingBrace, index + 1);
        }
    }
    throw new Error(`Could not find the end of ${methodName} method`);
}

describe('RHI architecture boundaries', () => {
    it('keeps scene and renderer semantics above the RHI package', () => {
        const entries = Object.entries(sources);
        expect(entries.length).toBeGreaterThan(2);
        expect(
            collectMatches(
                entries,
                /from\s+['"][^'"]*(?:core\/(?:Mesh|Stage)|material\/|light\/)/gu
            )
        ).toEqual([]);
        expect(
            collectMatches(entries, /(?:variantKey|materialCache|meshCache|sceneCache)/giu)
        ).toEqual([]);
    });

    it('keeps the native WebGPU adapter free of WebGL state abstractions', () => {
        const webgpu = entriesBelow('/webgpu/');
        expect(webgpu.length).toBeGreaterThan(0);
        expect(
            collectMatches(
                webgpu,
                /(?:WebGL(?:2)?RenderingContext|WebGLState|\bGLenum\b|\.useProgram\s*\(|\.bindBuffer\s*\()/gu
            )
        ).toEqual([]);
    });

    it('implements both backends without importing high-level renderer managers', () => {
        const backendSources = [...entriesBelow('/webgl/'), ...entriesBelow('/webgpu/')];
        expect(backendSources.length).toBeGreaterThan(1);
        expect(
            collectMatches(backendSources, /from\s+['"][^'"]*renderer\/(?:common|webgl|webgpu)\//gu)
        ).toEqual([]);
    });

    it('keeps cache keys and command recording off allocation-heavy replay paths', () => {
        const backendSources = [...entriesBelow('/webgl/'), ...entriesBelow('/webgpu/')];
        expect(collectMatches(backendSources, /JSON\.stringify\s*\(/gu)).toEqual([]);
        expect(
            collectMatches(
                backendSources,
                /(?:commands?|commandList|replayQueue)\s*\.\s*push\s*\(/giu
            )
        ).toEqual([]);
    });

    it('keeps WebGL hot draw methods free of collection-copy allocations', () => {
        const webgl = entriesBelow('/webgl/');
        const hotMethods = [
            'setBindGroup',
            'applyPipelineState',
            'applyBindings',
            'vertexArrayFor',
            'prepareDraw',
            'draw',
            'drawIndexed'
        ];
        const hotSources = hotMethods.map(name => {
            const entry = webgl.find(([, source]) =>
                new RegExp(`\\n\\s{4}(?:private\\s+)?${name}\\s*\\(`, 'u').test(source)
            );
            if (!entry) throw new Error(`Could not find ${name} method`);
            return [entry[0], methodBody(entry[1], name)] as const;
        });

        expect(
            collectMatches(
                hotSources,
                /(?:\.(?:slice|map|every|find)\s*\(|Array\.from\s*\(|\.\.\.|new\s+(?:Array|[A-Z][A-Za-z0-9]*Array)\s*\(|=>)/gu
            )
        ).toEqual([]);
    });
});
