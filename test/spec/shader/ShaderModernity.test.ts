import { describe, expect, it } from 'vitest';
import {
    cameraBlockLayout,
    instanceBlockLayout,
    modelBlockLayout,
    morphBlockLayout,
    skinningBlockLayout
} from '../../../src/render/ubo/BuiltInUniformBlocks';

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

const engineShaderContainerSources = import.meta.glob<string>(
    '../../../src/**/*.{ts,vert,frag,glsl}',
    {
        eager: true,
        query: '?raw',
        import: 'default'
    }
);

const uiFixtureShaderSources = import.meta.glob<string>('../../../test/ui/fixtures/**/*.ts', {
    eager: true,
    query: '?raw',
    import: 'default'
});

const shaderSources = { ...engineShaderSources, ...exampleShaderSources };
const builtInBlockSources = {
    ...engineShaderContainerSources,
    ...exampleShaderSources,
    ...uiFixtureShaderSources
};
const builtInBlockLayouts = {
    CameraBlock: cameraBlockLayout,
    ModelBlock: modelBlockLayout,
    SkinningBlock: skinningBlockLayout,
    MorphBlock: morphBlockLayout,
    InstanceBlock: instanceBlockLayout
} as const;
const glslDeclarationType = '(?:float|int|uint|bool|[biu]?vec[2-4]|mat[2-4](?:x[2-4])?)';
const builtInBlockPattern = new RegExp(
    `layout\\s*\\(\\s*std140\\s*\\)\\s*uniform\\s+(${Object.keys(builtInBlockLayouts).join('|')})\\s*\\{([\\s\\S]*?)\\}\\s*;`,
    'gu'
);
const std140FieldPattern = new RegExp(
    `\\b(${glslDeclarationType})\\s+([A-Za-z_]\\w*)\\s*(?:\\[[^\\]]+\\])?\\s*;`,
    'gu'
);

interface ShaderViolation {
    path: string;
    line: number;
    rule: string;
    source: string;
}

interface BuiltInBlockViolation {
    path: string;
    block: keyof typeof builtInBlockLayouts;
    declared: string[];
    expectedPrefix: string[];
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

function isBuiltInBlockName(value: string): value is keyof typeof builtInBlockLayouts {
    return Object.hasOwn(builtInBlockLayouts, value);
}

function collectBuiltInBlockViolations(): BuiltInBlockViolation[] {
    const violations: BuiltInBlockViolation[] = [];
    for (const [path, source] of Object.entries(builtInBlockSources)) {
        builtInBlockPattern.lastIndex = 0;
        for (const blockMatch of source.matchAll(builtInBlockPattern)) {
            const block = blockMatch[1] ?? '';
            if (!isBuiltInBlockName(block)) continue;
            const body = blockMatch[2] ?? '';
            const declared = [...body.matchAll(std140FieldPattern)].map(
                match => `${match[1] ?? ''} ${match[2] ?? ''}`
            );
            const canonical = Object.values(builtInBlockLayouts[block].fields).map(
                field => `${field.type} ${field.name}`
            );
            const expectedPrefix = canonical.slice(0, declared.length);
            if (declared.some((field, index) => field !== expectedPrefix[index])) {
                violations.push({ path, block, declared, expectedPrefix });
            }
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

    it('keeps hand-authored history uniform blocks on canonical ABI prefixes', () => {
        expect(collectBuiltInBlockViolations()).toEqual([]);
    });

    it('uses the canonical CameraBlock source for viewport ABI diagnostics', () => {
        const visualFixture = Object.entries(uiFixtureShaderSources).find(([path]) =>
            path.endsWith('/ui/fixtures/visual.ts')
        )?.[1];
        expect(visualFixture).toBeTypeOf('string');
        expect(visualFixture ?? '').toContain("cameraBlock.glsl?raw';");
        expect(visualFixture ?? '').toContain('${cameraBlockSource}');
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
