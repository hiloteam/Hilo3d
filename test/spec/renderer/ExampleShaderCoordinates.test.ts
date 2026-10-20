import { beforeAll, describe, expect, it } from 'vitest';
import Shader from '../../../src/shader/Shader';
import { NagaShaderTranslator } from '../../../src/render/shader/GlslToWgsl';

const sources = import.meta.glob<string>(
    [
        '../../../examples/shader_material.ts',
        '../../../examples/textureLod.ts',
        '../../../examples/drawBuffers.ts',
        '../../../examples/loader/shader/test.{vert,frag}',
        '../../../examples/shared/ScreenMesh.ts'
    ],
    { eager: true, query: '?raw', import: 'default' }
);

function exampleSource(path: string): string {
    const source = sources[`../../../examples/${path}`];
    if (source === undefined) throw new Error(`Missing example source ${path}`);
    return source;
}

function builtInSource(path: string): string {
    const source = Shader.shaders[path];
    if (source === undefined) throw new Error(`Missing built-in shader ${path}`);
    return source;
}

const portableCoordinates = builtInSource('method/portableCoordinates.glsl');

function template(source: string, marker: string): string {
    const start = source.indexOf(marker);
    if (start < 0) throw new Error(`Missing shader template ${marker}`);
    const bodyStart = start + marker.length;
    const end = source.indexOf('`', bodyStart);
    if (end < 0) throw new Error(`Unterminated shader template ${marker}`);
    return source.slice(bodyStart, end).replace('${portableCoordinateShader}', portableCoordinates);
}

function materialPair(path: string): {
    name: string;
    vertex: string;
    fragment: string;
    outputs: number;
} {
    const source = exampleSource(path);
    return {
        name: path,
        vertex: template(source, 'vs: `'),
        fragment: template(source, 'fs: `'),
        outputs: 1
    };
}

const drawBuffers = exampleSource('drawBuffers.ts');
const imageShaders = [
    materialPair('shader_material.ts'),
    materialPair('textureLod.ts'),
    {
        name: 'drawBuffers.ts',
        vertex: template(drawBuffers, 'const vertexShader = `'),
        fragment: template(drawBuffers, 'const fragmentShader = `'),
        outputs: 4
    },
    {
        name: 'loader/shader/test.frag',
        vertex: exampleSource('loader/shader/test.vert'),
        fragment: exampleSource('loader/shader/test.frag'),
        outputs: 1
    }
];
const screen = {
    name: 'shared/ScreenMesh.ts',
    vertex: builtInSource('screen.vert'),
    fragment: template(exampleSource('shared/ScreenMesh.ts'), 'fragmentShader: `'),
    outputs: 1
};

describe('Example shader coordinate boundaries', () => {
    const translator = new NagaShaderTranslator();
    beforeAll(async () => {
        await translator.initialize();
    });

    it.each(imageShaders)(
        '$name normalizes every image sample once in the fragment stage',
        shader => {
            const samples = [
                ...shader.fragment.matchAll(/\btexture(?:Lod)?\s*\(\s*u_\w+\s*,\s*([^\n]+)/gu)
            ];
            expect(samples.length).toBeGreaterThan(0);
            for (const sample of samples) {
                expect(sample[1]).toMatch(/^hiloTextureUV\(/u);
                expect(sample[1]?.match(/hiloTextureUV\(/gu)).toHaveLength(1);
            }
            expect(shader.vertex).not.toMatch(/hilo(?:Texture|RenderTarget)UV\(/u);
        }
    );

    it('keeps fetched GLSL self-contained and aligned with the shared image conversion', () => {
        const body = /vec2 hiloTextureUV\(vec2 uv\)\s*\{([^}]+)\}/u;
        const canonical = body.exec(portableCoordinates)?.[1]?.replace(/\s+/gu, '');
        const fetched = body
            .exec(exampleSource('loader/shader/test.frag'))?.[1]
            ?.replace(/\s+/gu, '');
        expect(canonical).toBeDefined();
        expect(fetched).toBe(canonical);
        expect(exampleSource('loader/shader/test.frag')).not.toContain('#include');
    });

    it('normalizes screen previews in screen.vert without a second fragment conversion', () => {
        expect(screen.vertex).toContain('v_texcoord0 = hiloRenderTargetUV(a_texcoord0);');
        expect(screen.fragment).toContain('texture(u_texture, v_texcoord0)');
        expect(screen.fragment).not.toMatch(/hilo(?:Texture|RenderTarget)UV\(/u);
    });

    it.each([...imageShaders, screen])('translates the actual $name pair through Naga', shader => {
        let customBinding = 2;
        const bindings = new Map<string, number>();
        const translated = translator.translate(shader.vertex, shader.fragment, name => {
            let binding = bindings.get(name);
            if (binding === undefined) {
                binding = customBinding++;
                bindings.set(name, binding);
            }
            return { group: 3, binding };
        });
        expect(translated.vertex.wgsl).toContain('@vertex');
        expect(translated.fragment.wgsl).toContain('@fragment');
        expect(translated.fragmentOutputs).toHaveLength(shader.outputs);
        expect(translated.samplers.length).toBeGreaterThan(0);
    });
});
