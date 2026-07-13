import { describe, expect, it } from 'vitest';

const engineShaderSources = import.meta.glob<string>('../../../src/shader/**/*.{vert,frag,glsl}', {
    eager: true,
    query: '?raw',
    import: 'default'
});

const exampleShaderSources = import.meta.glob<string>(
    '../../../examples/**/*.{ts,vert,frag,glsl}',
    {
        eager: true,
        query: '?raw',
        import: 'default'
    }
);

const shaderSources = { ...engineShaderSources, ...exampleShaderSources };
const glslDeclarationType = '(?:float|int|uint|bool|[biu]?vec[2-4]|mat[2-4](?:x[2-4])?)';

interface ShaderViolation {
    path: string;
    line: number;
    rule: string;
    source: string;
}

const legacySyntaxRules: readonly (readonly [string, RegExp])[] = [
    ['GLSL 1.00 #version', /#version\s+100\b/g],
    [
        'attribute qualifier',
        new RegExp(
            `\\battribute\\s+(?:(?:lowp|mediump|highp)\\s+)?${glslDeclarationType}\\s+[A-Za-z_]\\w*`,
            'g'
        )
    ],
    [
        'varying qualifier',
        new RegExp(
            `\\bvarying\\s+(?:(?:lowp|mediump|highp)\\s+)?${glslDeclarationType}\\s+[A-Za-z_]\\w*`,
            'g'
        )
    ],
    ['texture2D function', /\btexture2D(?:Proj|LodEXT)?\s*\(/g],
    ['textureCube function', /\btextureCube(?:LodEXT)?\s*\(/g],
    ['gl_FragColor output', /\bgl_FragColor\b/g],
    ['gl_FragData output', /\bgl_FragData\b/g],
    ['gl_FragDepthEXT output', /\bgl_FragDepthEXT\b/g],
    ['non-portable point-sprite built-in', /\bgl_Point(?:Size|Coord)\b/g],
    ['WebGL 1 shader extension', /#extension\s+GL_(?:OES|EXT|WEBGL)_[A-Za-z0-9_]+\b/g]
];

const classicUniformDeclaration =
    /\buniform\s+(?:(?:lowp|mediump|highp)\s+)?([A-Za-z_]\w*)\s+([A-Za-z_]\w*)(?:\s*\[[^\]]+\])?\s*;/g;

function sourceLine(source: string, offset: number): { line: number; source: string } {
    const line = source.slice(0, offset).split('\n').length;
    return {
        line,
        source: source.split('\n')[line - 1]?.trim() ?? ''
    };
}

function collectViolations(): ShaderViolation[] {
    const violations: ShaderViolation[] = [];
    for (const [path, source] of Object.entries(shaderSources)) {
        for (const [rule, pattern] of legacySyntaxRules) {
            pattern.lastIndex = 0;
            for (const match of source.matchAll(pattern)) {
                const location = sourceLine(source, match.index);
                violations.push({ path, rule, ...location });
            }
        }

        classicUniformDeclaration.lastIndex = 0;
        for (const match of source.matchAll(classicUniformDeclaration)) {
            const type = match[1] ?? '';
            if (/^(?:[iu]?sampler)/.test(type)) continue;
            const location = sourceLine(source, match.index);
            violations.push({
                path,
                rule: `classic non-sampler uniform (${type})`,
                ...location
            });
        }
    }
    return violations;
}

describe('WebGL 2 shader contract', () => {
    it('keeps engine and example shaders on native GLSL ES 3.00 with UBO numeric data', () => {
        expect(Object.keys(engineShaderSources).length).toBeGreaterThan(0);
        expect(Object.keys(exampleShaderSources).length).toBeGreaterThan(0);
        expect(collectViolations()).toEqual([]);
    });

    it('does not retain the runtime GLSL 1.00 compatibility prelude', () => {
        expect(Object.keys(engineShaderSources).some(path => path.includes('GLSL300Define'))).toBe(
            false
        );
    });

    it('renders snow as instanced billboard triangles with built-in frame and camera blocks', () => {
        const snow = Object.entries(exampleShaderSources).find(([path]) =>
            path.endsWith('/examples/snow.ts')
        )?.[1];
        expect(snow).toBeTypeOf('string');
        expect(snow).not.toMatch(/constants\.POINTS\b/u);
        expect(snow).toContain('useInstanced: true');
        expect(snow).not.toContain('renderer.useInstanced = true');
        expect(snow).toContain('mode: Hilo3d.constants.TRIANGLES');
        expect(snow).toContain('layout(std140) uniform FrameBlock');
        expect(snow).toContain('layout(std140) uniform CameraBlock');
    });
});
