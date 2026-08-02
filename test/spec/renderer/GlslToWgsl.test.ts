import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    NagaShaderTranslator,
    prepareGLSLForNaga,
    specializeWebGPUDepthSamplers,
    type GlslSamplerType
} from '../../../src/render/shader/GlslToWgsl';
import { PORTABLE_FULLSCREEN_VERTEX_SOURCE } from '../../../src/render/pipeline/passes/internal/PortableFullscreenShader';
import { getWebGPUUniformBlockBinding } from '../../../src/render/shader/WebGPUBindingLayout';
import { registerUniformBlockBinding } from '../../../src/render/ubo/UniformBlockBindings';
import { MaterialTextureSlot } from '../../../src/material/MaterialTextureSlots';
import Shader from '../../../src/shader/Shader';
import { testEnv } from '../../renderer-setup';

function builtInShaderSource(name: string): string {
    const source = Shader.shaders[name];
    if (source === undefined) throw new Error(`Missing built-in shader source ${name}`);
    return source;
}

const basicVertexSource = builtInShaderSource('basic.vert');
const basicFragmentSource = builtInShaderSource('basic.frag');
const pbrFragmentSource = builtInShaderSource('pbr.frag');
const geometryFragmentSource = builtInShaderSource('geometry.frag');
const screenVertexSource = builtInShaderSource('screen.vert');
const screenFragmentSource = builtInShaderSource('screen.frag');
const presentVertexSource = builtInShaderSource('present.vert');
const presentFragmentSource = builtInShaderSource('present.frag');
const portableCoordinateSource = builtInShaderSource('method/portableCoordinates.glsl');
const mipmapVertexSource = builtInShaderSource('webgpu/mipmap.vert');
const mipmapFragmentSource = builtInShaderSource('webgpu/mipmap.frag');
const snowExampleModules = import.meta.glob<string>('../../../examples/snow.ts', {
    eager: true,
    query: '?raw',
    import: 'default'
});
const bloomSourceModules = import.meta.glob<string>('../../../src/render/postprocessing/Bloom.ts', {
    eager: true,
    query: '?raw',
    import: 'default'
});
const colorUberSourceModules = import.meta.glob<string>(
    '../../../src/render/postprocessing/ColorUber.ts',
    {
        eager: true,
        query: '?raw',
        import: 'default'
    }
);
const shaderToyExampleModules = import.meta.glob<string>('../../../examples/shaderToy.ts', {
    eager: true,
    query: '?raw',
    import: 'default'
});

let wgslValidationDevice: GPUDevice | null = null;

async function validateWgslOnDevice(label: string, source: string): Promise<void> {
    if (!wgslValidationDevice) {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error('A WebGPU adapter is required for WGSL validation tests');
        wgslValidationDevice = await adapter.requestDevice();
    }
    const module = wgslValidationDevice.createShaderModule({ label, code: source });
    const diagnostics = await module.getCompilationInfo();
    const lines = source.split('\n');
    const errors = diagnostics.messages
        .filter(message => message.type === 'error')
        .map(
            message =>
                `${String(message.lineNum)}:${String(message.linePos)} ${message.message}: ${lines[message.lineNum - 1]?.trim() ?? ''}`
        );
    expect(errors, `${label} WGSL diagnostics`).toEqual([]);
}

afterAll(() => {
    wgslValidationDevice?.destroy();
    wgslValidationDevice = null;
});

function embeddedShader(source: string, name: string): string {
    const marker = `const ${name} = \``;
    const start = source.indexOf(marker);
    if (start < 0) throw new Error(`Missing embedded shader ${name}`);
    const bodyStart = start + marker.length;
    const end = source.indexOf('`;', bodyStart);
    if (end < 0) throw new Error(`Embedded shader ${name} is not terminated`);
    return source.slice(bodyStart, end);
}

function shaderToyFragment(source: string): string {
    const shaderToyCode = embeddedShader(source, 'shaderToyCode');
    const marker = '    fs: `';
    const start = source.indexOf(marker);
    if (start < 0) throw new Error('Missing ShaderToy fragment shader');
    const bodyStart = start + marker.length;
    const end = source.indexOf('\n    `,', bodyStart);
    if (end < 0) throw new Error('ShaderToy fragment shader is not terminated');
    return source
        .slice(bodyStart, end)
        .replace('${portableCoordinateShader}', portableCoordinateSource)
        .replace('${shaderToyCode}', shaderToyCode);
}

const vertex = `#version 300 es
#define USE_TBN 1
layout(std140) uniform CameraBlock {
    mat4 viewProjection;
};
in vec3 position;
in mat4 model;
out vec2 uv;
#if USE_TBN
out mat3 tbn;
#endif
void main() {
    uv = position.xy;
    tbn = mat3(1.0);
    gl_Position = viewProjection * model * vec4(position, 1.0);
}`;

const fragment = `#version 300 es
precision highp float;
in vec2 uv;
#if defined(USE_TEXTURE)
uniform samplerCube unusedMap;
#endif
uniform sampler2D diffuseMap;
layout(std140) uniform EffectBlock {
    vec4 tint;
};
layout(location = 0) out vec4 color;
void main() {
    color = texture(diffuseMap, uv) * tint;
}`;

describe('GLSL to Naga preparation', () => {
    it.each([
        ['present', presentVertexSource, presentFragmentSource],
        ['mipmap', mipmapVertexSource, mipmapFragmentSource]
    ] as const)('translates the internal WebGPU %s pass from GLSL', async (_name, vs, fs) => {
        const translator = new NagaShaderTranslator();
        await translator.initialize();
        const translated = translator.translate(vs, fs);

        expect(translated.vertex.glsl).toContain('#define HILO_WEBGPU 1');
        expect(translated.vertex.glsl).toContain('gl_VertexIndex');
        expect(translated.vertex.glsl).not.toContain('gl_VertexID');
        expect(translated.vertex.wgsl).toContain('@vertex');
        expect(translated.fragment.wgsl).toContain('@fragment');
        expect(translated.vertexInputs).toEqual([]);
        expect(translated.fragmentOutputs).toEqual([
            {
                name: _name === 'present' ? 'fragmentColor' : 'outputColor',
                type: 'vec4',
                location: 0
            }
        ]);
        expect(translated.samplers).toHaveLength(1);
        expect(translated.samplers[0]).toMatchObject({
            name: 'u_sourceTexture',
            arrayIndex: 0,
            type: 'sampler2D',
            group: 1,
            textureBinding: 2,
            samplerBinding: 3,
            stages: ['fragment']
        });
        await Promise.all([
            validateWgslOnDevice(`${_name} internal vertex`, translated.vertex.wgsl),
            validateWgslOnDevice(`${_name} internal fragment`, translated.fragment.wgsl)
        ]);
    });

    it('compiles a depth-only fragment variant without color targets', async () => {
        const depthVertex = `#version 300 es
in vec2 position;
out vec2 uv;
void main() { uv = position; gl_Position = vec4(position, 0.0, 1.0); }`;
        const depthFragment = `#version 300 es
precision highp float;
in vec2 uv;
layout(location = 0) out vec4 color;
void main() {
    if (uv.x < -1.0) discard;
    gl_FragDepth = 0.5;
    color = vec4(uv, 0.0, 1.0);
}`;
        const translator = new NagaShaderTranslator();
        await translator.initialize();
        const translated = translator.translate(depthVertex, depthFragment, undefined, {
            fragmentOutputs: 'depth-only'
        });

        expect(translated.fragmentOutputs).toEqual([]);
        expect(translated.fragment.glsl).toContain('vec4 color;');
        expect(translated.fragment.glsl).not.toContain('out vec4 color');
        await Promise.all([
            validateWgslOnDevice('depth-only vertex', translated.vertex.wgsl),
            validateWgslOnDevice('depth-only fragment', translated.fragment.wgsl)
        ]);
    });

    it('assigns compact locations, splits matrix IO and maps the four bind groups', () => {
        registerUniformBlockBinding('EffectBlock');
        const prepared = prepareGLSLForNaga(vertex, fragment);

        expect(prepared.vertexInputs).toEqual([
            { name: 'position', type: 'vec3', location: 0, locationCount: 1 },
            { name: 'model', type: 'mat4', location: 1, locationCount: 4 }
        ]);
        expect(prepared.vertex.glsl).toContain('layout(location = 1) in vec4 model__column0;');
        expect(prepared.vertex.glsl).toContain(
            'model = mat4(model__column0, model__column1, model__column2, model__column3);'
        );
        expect(prepared.vertex.glsl).toContain(
            'gl_Position.z = (gl_Position.z + gl_Position.w) * 0.5;'
        );
        expect(prepared.vertex.glsl).toContain(
            'layout(std140, set = 0, binding = 1) uniform CameraBlock'
        );
        const effectBinding = getWebGPUUniformBlockBinding('EffectBlock');
        expect(prepared.fragment.glsl).toContain(
            `layout(std140, set = 3, binding = ${String(effectBinding.binding)}) uniform EffectBlock`
        );
        expect(prepared.fragment.glsl).toContain(
            'layout(set = 1, binding = 2) uniform texture2D diffuseMap__texture;'
        );
        expect(prepared.fragment.glsl).toContain(
            'texture(sampler2D(diffuseMap__texture, diffuseMap__sampler), uv)'
        );
        expect(prepared.fragment.glsl).not.toContain('unusedMap__texture');
    });

    it('preserves managed material sampling when only one UV set is active', async () => {
        const managedVertex = `#version 300 es
#define HILO_HAS_TEXCOORD0 1
in vec2 position;
out vec2 v_texcoord0;
void main() {
    v_texcoord0 = position;
    gl_Position = vec4(position, 0.0, 1.0);
}`;
        const managedFragment = `#version 300 es
precision highp float;
#define HILO_HAS_TEXCOORD0 1
#define HILO_BASE_COLOR_MAP ${String(MaterialTextureSlot.BASE_COLOR)}
in vec2 v_texcoord0;
uniform sampler2D baseColorMap;
layout(location = 0) out vec4 color;
vec4 hiloTexture2D(sampler2D sourceTexture, int slot) {
    vec4 sampled = texture(sourceTexture, v_texcoord0);
    return slot == ${String(MaterialTextureSlot.BASE_COLOR)}
        ? vec4(sampled.rgb * 0.5, sampled.a)
        : sampled;
}
#define HILO_TEXTURE_2D(SAMPLER, SLOT) hiloTexture2D(SAMPLER, SLOT)
void main() { color = HILO_TEXTURE_2D(baseColorMap, HILO_BASE_COLOR_MAP); }`;
        const translator = new NagaShaderTranslator();
        await translator.initialize();
        const translated = translator.translate(managedVertex, managedFragment);

        expect(translated.fragment.glsl).toContain(
            'hiloTexture2D(baseColorMap__texture, baseColorMap__sampler, HILO_BASE_COLOR_MAP)'
        );
        expect(translated.fragment.glsl).not.toContain(
            'texture(sampler2D(baseColorMap__texture, baseColorMap__sampler), v_texcoord0)'
        );
        expect(translated.fragment.wgsl).toContain(
            `hiloTexture2D(baseColorMap_texture, baseColorMap_sampler, ${String(MaterialTextureSlot.BASE_COLOR)}i)`
        );
        await validateWgslOnDevice('single-UV managed material sampling', translated.fragment.wgsl);
    });

    it('normalizes reordered uniform-block layouts and rejects implicit host ABIs', () => {
        const explicitVertex = `#version 300 es
layout(binding = 7) layout(std140, column_major) uniform CustomBlock {
    mat4 transform;
};
in vec2 position;
void main() { gl_Position = transform * vec4(position, 0.0, 1.0); }`;
        const outputFragment = `#version 300 es
precision highp float;
layout(location = 0) out vec4 color;
void main() { color = vec4(1.0); }`;
        const prepared = prepareGLSLForNaga(explicitVertex, outputFragment, () => ({
            group: 2,
            binding: 3
        }));

        expect(prepared.vertex.glsl).toContain(
            'layout(std140, column_major, set = 2, binding = 3) uniform CustomBlock'
        );
        expect(prepared.vertex.glsl).not.toContain('binding = 7');
        expect(() =>
            prepareGLSLForNaga(
                explicitVertex.replace(
                    'layout(binding = 7) layout(std140, column_major)',
                    'layout(binding = 7)'
                ),
                outputFragment,
                () => ({ group: 2, binding: 3 })
            )
        ).toThrow(/must explicitly declare the std140 layout/u);
    });

    it('evaluates the complete integer bitwise precedence used by GLSL conditionals', async () => {
        const conditionalVertex = `#version 300 es
#define FLAGS 3
#if (((FLAGS << 2) & 12) == 12) && ((~0 & 1) ^ 0)
in vec2 selectedPosition;
#else
in vec3 rejectedPosition;
#endif
void main() { gl_Position = vec4(selectedPosition, 0.0, 1.0); }`;
        const conditionalFragment = `#version 300 es
precision highp float;
layout(location = 0) out vec4 color;
void main() { color = vec4(1.0); }`;
        const translator = new NagaShaderTranslator();
        await translator.initialize();
        const translated = translator.translate(conditionalVertex, conditionalFragment);

        expect(translated.vertexInputs).toEqual([
            { name: 'selectedPosition', type: 'vec2', location: 0, locationCount: 1 }
        ]);
        expect(translated.vertex.glsl).not.toContain(
            'layout(location = 0) in vec3 rejectedPosition'
        );
        await Promise.all([
            validateWgslOnDevice('bitwise conditional vertex', translated.vertex.wgsl),
            validateWgslOnDevice('bitwise conditional fragment', translated.fragment.wgsl)
        ]);
    });

    it('evaluates function macros, integer suffixes, octal literals, and ternaries', async () => {
        const conditionalVertex = `#version 300 es
#define ADD(left, right) ((left) + (right))
#define COUNT(value) ADD(value, 1u)
#if defined(COUNT) && COUNT(2) == (0 ? 7 : 3) && 010 == 8
in vec2 selectedPosition;
in vec2 selectedOffsets[COUNT(1)];
#else
in vec3 rejectedPosition;
#endif
void main() { gl_Position = vec4(selectedPosition + selectedOffsets[0], 0.0, 1.0); }`;
        const conditionalFragment = `#version 300 es
precision highp float;
layout(location = 0) out vec4 color;
void main() { color = vec4(1.0); }`;
        const translator = new NagaShaderTranslator();
        await translator.initialize();
        const translated = translator.translate(conditionalVertex, conditionalFragment);

        expect(translated.vertexInputs).toEqual([
            { name: 'selectedPosition', type: 'vec2', location: 0, locationCount: 1 },
            { name: 'selectedOffsets[0]', type: 'vec2', location: 1, locationCount: 1 },
            { name: 'selectedOffsets[1]', type: 'vec2', location: 2, locationCount: 1 }
        ]);
        await Promise.all([
            validateWgslOnDevice('function macro vertex', translated.vertex.wgsl),
            validateWgslOnDevice('function macro fragment', translated.fragment.wgsl)
        ]);
    });

    it('rejects malformed macro expressions instead of silently enabling them', () => {
        const malformedVertex = `#version 300 es
#define BROKEN (1 + )
#if BROKEN
in vec2 position;
#endif
void main() { gl_Position = vec4(0.0); }`;

        expect(() => prepareGLSLForNaga(malformedVertex, basicFragmentSource)).toThrow(
            /preprocessor expression/u
        );
    });

    it('reflects multiple declarations per line and flattens fixed shader I/O arrays', async () => {
        const arrayIoVertex = `#version 300 es
in vec2 position; in vec2 offsets[2]; out vec2 samples[2];
void main() {
    samples[0] = position + offsets[0];
    samples[1] = position + offsets[1];
    gl_Position = vec4(position, 0.0, 1.0);
}`;
        const arrayIoFragment = `#version 300 es
precision highp float;
in vec2 samples[2]; layout(location = 1) out vec4 colors[2];
void main() {
    colors[0] = vec4(samples[0], 0.0, 1.0);
    colors[1] = vec4(samples[1], 1.0, 1.0);
}`;
        const translator = new NagaShaderTranslator();
        await translator.initialize();
        const translated = translator.translate(arrayIoVertex, arrayIoFragment);

        expect(translated.vertexInputs).toEqual([
            { name: 'position', type: 'vec2', location: 0, locationCount: 1 },
            { name: 'offsets[0]', type: 'vec2', location: 1, locationCount: 1 },
            { name: 'offsets[1]', type: 'vec2', location: 2, locationCount: 1 }
        ]);
        expect(translated.fragmentOutputs).toEqual([
            { name: 'colors[0]', type: 'vec4', location: 1 },
            { name: 'colors[1]', type: 'vec4', location: 2 }
        ]);
        expect(translated.vertex.glsl).toContain('in vec2 offsets__element0;');
        expect(translated.fragment.glsl).toContain('out vec4 colors__element1;');
        await Promise.all([
            validateWgslOnDevice('array I/O vertex', translated.vertex.wgsl),
            validateWgslOnDevice('array I/O fragment', translated.fragment.wgsl)
        ]);
    });

    it('flattens named stage interface blocks with arrays and interpolation qualifiers', async () => {
        const interfaceVertex = `#version 300 es
in vec2 position;
layout(location = 2) out Surface {
    vec2 coordinates[2];
    flat int materialId;
} vertexSurface;
void main() {
    vertexSurface.coordinates[0] = position;
    vertexSurface.coordinates[1] = position * 0.5;
    vertexSurface.materialId = 1;
    gl_Position = vec4(position, 0.0, 1.0);
}`;
        const interfaceFragment = `#version 300 es
precision highp float;
layout(location = 2) in Surface {
    vec2 coordinates[2];
    flat int materialId;
} fragmentSurface;
layout(location = 0) out vec4 color;
void main() {
    color = vec4(fragmentSurface.coordinates[fragmentSurface.materialId], 0.0, 1.0);
}`;
        const translator = new NagaShaderTranslator();
        await translator.initialize();
        const translated = translator.translate(interfaceVertex, interfaceFragment);

        expect(translated.vertex.glsl).not.toContain('out Surface');
        expect(translated.fragment.glsl).not.toContain('in Surface');
        expect(translated.vertex.glsl).toContain('hilo_webgpu_interface_Surface_coordinates');
        await Promise.all([
            validateWgslOnDevice('interface block vertex', translated.vertex.wgsl),
            validateWgslOnDevice('interface block fragment', translated.fragment.wgsl)
        ]);
    });

    it('flattens literal sampler arrays and lowers dynamically uniform indices', async () => {
        const arrayFragment = `#version 300 es
            in vec2 uv;
            uniform sampler2D maps[2];
            layout(location = 0) out vec4 color;
            void main() { color = texture(maps[0], uv) + texture(maps[1], uv); }
        `;
        const prepared = prepareGLSLForNaga(
            '#version 300 es\nin vec2 position;\nout vec2 uv;\nvoid main(){uv=position;gl_Position=vec4(position,0.0,1.0);}',
            arrayFragment
        );
        expect(prepared.samplers).toHaveLength(2);
        expect(prepared.fragment.glsl).toContain('maps__texture_0');
        expect(prepared.fragment.glsl).toContain('maps__texture_1');

        const dynamicFragment = `#version 300 es
            precision highp float;
            precision highp int;
            #define SECOND_MAP (1 + 0)
            in vec2 uv;
            layout(std140) uniform MaterialBlock { int mapIndex; };
            uniform sampler2D maps[2];
            uniform usampler2D integerMaps[2];
            layout(location = 0) out vec4 color;
            void main() {
                color = texture(maps[mapIndex], uv)
                    + textureLod(maps[SECOND_MAP], uv, 0.0)
                    + vec4(texelFetch(integerMaps[mapIndex], ivec2(0), 0));
            }
        `;
        const translator = new NagaShaderTranslator();
        await translator.initialize();
        const dynamic = translator.translate(
            '#version 300 es\nin vec2 position;\nout vec2 uv;\nvoid main(){uv=position;gl_Position=vec4(position,0.0,1.0);}',
            dynamicFragment
        );
        expect(dynamic.fragment.glsl).toContain('maps__hiloDynamic_texture_vec4_vec2');
        expect(dynamic.fragment.glsl).toContain('maps__hiloDynamic_textureLod_vec4_vec2_float');
        expect(dynamic.fragment.glsl).toContain(
            'integerMaps__hiloDynamic_texelFetch_uvec4_ivec2_int'
        );
        expect(dynamic.fragment.glsl).toContain('int(mapIndex)');
        expect(dynamic.fragment.wgsl).toContain('textureSample');
        expect(dynamic.fragment.wgsl).toContain('textureSampleLevel');
        expect(dynamic.fragment.wgsl).toContain('textureLoad');
        await validateWgslOnDevice('dynamic sampler array fragment', dynamic.fragment.wgsl);
    });

    it('lowers projective and constant-offset dynamic sampler operations', async () => {
        const dynamicFragment = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
layout(std140) uniform MaterialBlock { int mapIndex; };
uniform sampler2D maps[2];
layout(location = 0) out vec4 color;
void main() {
    vec2 dx = dFdx(uv);
    vec2 dy = dFdy(uv);
    color = textureProj(maps[mapIndex], vec3(uv, 1.0))
        + textureProjOffset(maps[mapIndex], vec3(uv, 1.0), ivec2(0))
        + textureProjLod(maps[mapIndex], vec3(uv, 1.0), 0.0)
        + textureProjLodOffset(maps[mapIndex], vec3(uv, 1.0), 0.0, ivec2(0))
        + textureProjGrad(maps[mapIndex], vec3(uv, 1.0), dx, dy)
        + textureProjGradOffset(maps[mapIndex], vec3(uv, 1.0), dx, dy, ivec2(0));
}`;
        const translator = new NagaShaderTranslator();
        await translator.initialize();
        const translated = translator.translate(
            '#version 300 es\nin vec2 position;\nout vec2 uv;\nvoid main(){uv=position;gl_Position=vec4(position,0.0,1.0);}',
            dynamicFragment
        );

        expect(translated.fragment.glsl).not.toContain('maps[mapIndex]');
        expect(translated.fragment.glsl).toContain('maps__hiloDynamic_textureProj');
        expect(translated.fragment.glsl).toContain('? textureProjOffset(');
        await validateWgslOnDevice('dynamic projective sampler fragment', translated.fragment.wgsl);
    });

    it('rejects texture builtins outside the shared GLSL ES 3.00 contract', () => {
        const gatherFragment = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D source;
layout(location = 0) out vec4 color;
void main() { color = textureGather(source, uv); }`;
        expect(() => prepareGLSLForNaga(basicVertexSource, gatherFragment)).toThrow(
            /not part of the GLSL ES 3.00\/WebGL2 shader contract/u
        );
    });

    interface ExtendedSamplerCase {
        readonly type: GlslSamplerType;
        readonly returnType: string;
        readonly expression: string;
        readonly output: string;
        readonly vulkanTexture: string;
        readonly vulkanSampler?: string;
        readonly wgslTexture: string;
    }

    const extendedSamplerCases: readonly ExtendedSamplerCase[] = [
        {
            type: 'sampler3D',
            returnType: 'vec4',
            expression: 'texture(value, vec3(0.5))',
            output: 'readValue(uTexture)',
            vulkanTexture: 'texture3D',
            wgslTexture: 'texture_3d<f32>'
        },
        {
            type: 'sampler2DArray',
            returnType: 'vec4',
            expression: 'texture(value, vec3(0.5, 0.5, 0.0))',
            output: 'readValue(uTexture)',
            vulkanTexture: 'texture2DArray',
            wgslTexture: 'texture_2d_array<f32>'
        },
        {
            type: 'sampler2DArrayShadow',
            returnType: 'float',
            expression: 'texture(value, vec4(0.5, 0.5, 0.0, 0.5))',
            output: 'vec4(readValue(uTexture))',
            vulkanTexture: 'texture2DArray',
            vulkanSampler: 'samplerShadow',
            wgslTexture: 'texture_depth_2d_array'
        },
        ...(['isampler', 'usampler'] as const).flatMap((prefix): ExtendedSamplerCase[] => {
            const scalar = prefix === 'isampler' ? 'i' : 'u';
            const component = prefix === 'isampler' ? 'i32' : 'u32';
            return [
                {
                    type: `${prefix}2D`,
                    returnType: `${scalar}vec4`,
                    expression: 'texelFetch(value, ivec2(0), 0)',
                    output: 'vec4(readValue(uTexture))',
                    vulkanTexture: `${scalar}texture2D`,
                    wgslTexture: `texture_2d<${component}>`
                },
                {
                    type: `${prefix}3D`,
                    returnType: `${scalar}vec4`,
                    expression: 'texelFetch(value, ivec3(0), 0)',
                    output: 'vec4(readValue(uTexture))',
                    vulkanTexture: `${scalar}texture3D`,
                    wgslTexture: `texture_3d<${component}>`
                },
                {
                    type: `${prefix}Cube`,
                    returnType: 'ivec2',
                    expression: 'textureSize(value, 0)',
                    output: 'vec4(vec2(readValue(uTexture)), 0.0, 1.0)',
                    vulkanTexture: `${scalar}textureCube`,
                    wgslTexture: `texture_cube<${component}>`
                },
                {
                    type: `${prefix}2DArray`,
                    returnType: `${scalar}vec4`,
                    expression: 'texelFetch(value, ivec3(0), 0)',
                    output: 'vec4(readValue(uTexture))',
                    vulkanTexture: `${scalar}texture2DArray`,
                    wgslTexture: `texture_2d_array<${component}>`
                }
            ];
        })
    ];

    it.each(extendedSamplerCases)(
        'translates $type declarations and function parameters through Naga',
        async samplerCase => {
            const vertexSource = `#version 300 es
void main() { gl_Position = vec4(0.0, 0.0, 0.0, 1.0); }`;
            const fragmentSource = `#version 300 es
precision highp float;
precision highp int;
uniform ${samplerCase.type} uTexture;
layout(location = 0) out vec4 color;
${samplerCase.returnType} readValue(${samplerCase.type} value) {
    return ${samplerCase.expression};
}
void main() { color = ${samplerCase.output}; }`;
            const translator = new NagaShaderTranslator();
            await translator.initialize();
            const translated = translator.translate(vertexSource, fragmentSource);

            expect(translated.samplers).toHaveLength(1);
            expect(translated.samplers[0]).toMatchObject({
                type: samplerCase.type,
                group: 1,
                textureBinding: 2,
                samplerBinding: 3
            });
            expect(translated.fragment.glsl).toContain(
                `uniform ${samplerCase.vulkanTexture} uTexture__texture;`
            );
            expect(translated.fragment.glsl).toContain(
                `uniform ${samplerCase.vulkanSampler ?? 'sampler'} uTexture__sampler;`
            );
            expect(translated.fragment.glsl).toContain(
                `${samplerCase.vulkanTexture} value__texture`
            );
            expect(translated.fragment.wgsl).toContain(samplerCase.wgslTexture);
            await validateWgslOnDevice(`${samplerCase.type} fragment`, translated.fragment.wgsl);
        }
    );

    it('flattens extended sampler arrays with stable bindings', async () => {
        const vertexSource = `#version 300 es
void main() { gl_Position = vec4(0.0, 0.0, 0.0, 1.0); }`;
        const fragmentSource = `#version 300 es
precision highp float;
precision highp int;
uniform usampler2DArray maps[2];
layout(location = 0) out vec4 color;
uvec4 readMap(usampler2DArray value, ivec3 coordinate) {
    return texelFetch(value, coordinate, 0);
}
void main() { color = vec4(readMap(maps[0], ivec3(0)) + readMap(maps[1], ivec3(0))); }`;
        const translator = new NagaShaderTranslator();
        await translator.initialize();
        const translated = translator.translate(vertexSource, fragmentSource);

        expect(
            translated.samplers.map(binding => [
                binding.type,
                binding.arrayIndex,
                binding.textureBinding,
                binding.samplerBinding
            ])
        ).toEqual([
            ['usampler2DArray', 0, 2, 3],
            ['usampler2DArray', 1, 4, 5]
        ]);
        expect(translated.fragment.wgsl).toContain('texture_2d_array<u32>');
        await validateWgslOnDevice('usampler2DArray array fragment', translated.fragment.wgsl);
    });

    it('dispatches multiple dynamic sampler arrays through user sampler functions', async () => {
        const translator = new NagaShaderTranslator();
        await translator.initialize();
        const translated = translator.translate(
            `#version 300 es
                in vec2 position;
                out vec2 uv;
                void main() { uv = position; gl_Position = vec4(position, 0.0, 1.0); }
            `,
            `#version 300 es
                precision highp float;
                precision highp int;
                in vec2 uv;
                layout(std140) uniform MaterialBlock {
                    int firstIndex;
                    int secondIndex;
                };
                uniform sampler2D firstMaps[2];
                uniform sampler2D secondMaps[2];
                layout(location = 0) out vec4 color;
                vec4 blendMaps(sampler2D firstMap, sampler2D secondMap, vec2 coordinate) {
                    return texture(firstMap, coordinate) + texture(secondMap, coordinate);
                }
                void main() {
                    color = blendMaps(
                        firstMaps[firstIndex],
                        secondMaps[secondIndex],
                        uv
                    );
                }
            `
        );

        expect(translated.fragment.glsl).toContain('firstMaps__hiloDynamicCall_blendMaps_0');
        expect(translated.fragment.glsl).toContain('secondMaps__hiloDynamicCall_');
        expect(translated.fragment.glsl).not.toMatch(/\b(?:firstMaps|secondMaps)\s*\[/u);
        await validateWgslOnDevice('dynamic sampler function fragment', translated.fragment.wgsl);
    });

    it('translates the prepared Vulkan GLSL to valid WGSL through Naga', async () => {
        registerUniformBlockBinding('EffectBlock');
        const translator = new NagaShaderTranslator();
        await translator.initialize();
        const translated = translator.translate(vertex, fragment);
        expect(translated.vertex.wgsl).not.toMatch(/^requires\s+/mu);
        expect(translated.vertex.wgsl).toContain('@vertex');
        expect(translated.fragment.wgsl).toContain('@fragment');
        expect(translated.fragment.wgsl).toContain('textureSample');
    });

    it('specializes ordinary GLSL samplers for numeric WGSL depth sampling', async () => {
        const translator = new NagaShaderTranslator();
        await translator.initialize();
        const translated = translator.translate(
            `#version 300 es
                in vec2 position;
                out vec2 uv;
                void main() {
                    uv = position * 0.5 + 0.5;
                    gl_Position = vec4(position, 0.0, 1.0);
                }
            `,
            `#version 300 es
                precision highp float;
                in vec2 uv;
                uniform sampler2D depthMap;
                layout(location = 0) out vec4 color;
                void main() {
                    float depth = texture(depthMap, uv).r;
                    float explicitDepth = textureLod(depthMap, uv, 0.0).r;
                    color = vec4(depth, explicitDepth, 0.0, 1.0);
                }
            `
        );
        const binding = translated.samplers[0];
        if (!binding) throw new Error('Depth sampler binding was not translated');
        const specialized = specializeWebGPUDepthSamplers(translated, [binding]);

        expect(specialized.fragment.wgsl).toContain('texture_depth_2d');
        expect(specialized.fragment.wgsl).toMatch(
            /vec4<f32>\(textureSample\([^)]*\), 0\.0, 0\.0, 1\.0\)/u
        );
        expect(specialized.fragment.wgsl).toMatch(/textureSampleLevel\([^;]*i32\(/u);
        expect(specialized.fragment.wgsl).not.toContain('texture_2d<f32>');
        await validateWgslOnDevice('numeric depth fragment', specialized.fragment.wgsl);
    });

    it('runs WebGPU entry-point post-processing after an early return', async () => {
        const earlyReturnVertex = `#version 300 es
in vec2 position;
out mat2 basis;
void main() {
    basis = mat2(1.0);
    gl_Position = vec4(position, 0.0, 1.0);
    if (position.x < 0.0) return;
    gl_Position.x += 0.25;
}`;
        const matrixFragment = `#version 300 es
precision highp float;
in mat2 basis;
layout(location = 0) out vec4 color;
void main() { color = vec4(basis[0], basis[1]); }`;
        const prepared = prepareGLSLForNaga(earlyReturnVertex, matrixFragment);
        const wrapper = prepared.vertex.glsl.slice(prepared.vertex.glsl.lastIndexOf('void main()'));

        expect(prepared.vertex.glsl).toContain('void hilo_webgpu_user_main()');
        expect(wrapper.indexOf('hilo_webgpu_user_main();')).toBeLessThan(
            wrapper.indexOf('gl_Position.z =')
        );
        expect(wrapper.indexOf('gl_Position.z =')).toBeLessThan(
            wrapper.indexOf('basis__column0 =')
        );

        const translator = new NagaShaderTranslator();
        await translator.initialize();
        const translated = translator.translate(earlyReturnVertex, matrixFragment);
        expect(translated.vertex.wgsl).toContain('@vertex');
    });

    it('preserves std140 bytes for direct and arrayed two-row matrices', async () => {
        registerUniformBlockBinding('Row2Block');
        const row2Vertex = `#version 300 es
layout(std140) uniform Row2Block {
    mat2 transform;
    mat3x2 bases[2];
    // mat4x2 ignoredMatrixInComment;
};
in vec2 position;
void main() {
    vec2 transformed = transform * position;
    gl_Position = vec4(transformed + bases[1] * vec3(position, 1.0), 0.0, 1.0);
}`;
        const row2Fragment = `#version 300 es
precision highp float;
layout(std140) uniform Row2Block {
    mat2 transform;
    mat3x2 bases[2];
};
layout(location = 0) out vec4 color;
void main() { color = vec4(transform[0] + bases[0][2], 0.0, 1.0); }`;
        const translator = new NagaShaderTranslator();
        await translator.initialize();
        const translated = translator.translate(row2Vertex, row2Fragment);

        expect(translated.vertex.glsl).toContain('vec4 transform__hiloStd140Columns[2];');
        expect(translated.vertex.glsl).toContain('vec4 bases__hiloStd140Columns[6];');
        expect(translated.vertex.glsl).toContain('// mat4x2 ignoredMatrixInComment;');
        expect(translated.vertex.glsl).not.toContain('ignoredMatrixInComment__hiloStd140Columns');
        expect(translated.vertex.glsl).toContain(
            'mat3x2(bases__hiloStd140Columns[((1) * 3 + 0)].xy'
        );
        expect(translated.vertex.wgsl).not.toMatch(/^requires\s+/mu);
        expect(translated.vertex.wgsl).toContain(
            '@align(16) transform_hiloStd140Columns: array<vec4<f32>, 2>'
        );
        expect(translated.vertex.wgsl).toContain(
            '@align(16) bases_hiloStd140Columns: array<vec4<f32>, 6>'
        );
        expect(translated.fragment.wgsl).toContain('@fragment');
    });

    it('stores custom boolean blocks as host-shareable std140 integers', async () => {
        registerUniformBlockBinding('BooleanBlock');
        const booleanVertex = `#version 300 es
layout(std140) uniform BooleanBlock {
    bool enabled;
    bvec2 masks[2];
    // bool ignoredBooleanInComment;
} booleanBlock;
in vec2 position;
void main() {
    vec2 offset = booleanBlock.enabled && booleanBlock.masks[1].x ? vec2(0.25) : vec2(0.0);
    gl_Position = vec4(position + offset, 0.0, 1.0);
}`;
        const booleanFragment = `#version 300 es
precision highp float;
layout(std140) uniform BooleanBlock {
    bool enabled;
    bvec2 masks[2];
    // bool ignoredBooleanInComment;
} booleanBlock;
layout(location = 0) out vec4 color;
void main() { color = booleanBlock.enabled && booleanBlock.masks[0].y ? vec4(1.0) : vec4(0.0); }`;
        const translator = new NagaShaderTranslator();
        await translator.initialize();
        const translated = translator.translate(booleanVertex, booleanFragment);

        expect(translated.vertex.glsl).toContain('int enabled__hiloStd140Value;');
        expect(translated.vertex.glsl).toContain('ivec2 masks__hiloStd140Value[2];');
        expect(translated.vertex.glsl).toContain('// bool ignoredBooleanInComment;');
        expect(translated.vertex.glsl).not.toContain('ignoredBooleanInComment__hiloStd140Value');
        expect(translated.vertex.wgsl).toContain('enabled_hiloStd140Value: i32');
        expect(translated.vertex.wgsl).toContain(
            '@align(16) masks_hiloStd140Value: array<HiloStd140Element_BooleanBlock_masks_hiloStd140Value, 2>'
        );
        await Promise.all([
            validateWgslOnDevice('boolean block vertex', translated.vertex.wgsl),
            validateWgslOnDevice('boolean block fragment', translated.fragment.wgsl)
        ]);
    });

    it('rejects incompatible same-name uniform block layouts across stages', () => {
        const blockVertex = `#version 300 es
layout(std140) uniform CameraBlock { mat4 projection; };
in vec2 position;
void main() { gl_Position = projection * vec4(position, 0.0, 1.0); }`;
        const blockFragment = `#version 300 es
precision highp float;
layout(std140) uniform CameraBlock { vec4 projection; };
layout(location = 0) out vec4 color;
void main() { color = projection; }`;

        expect(() => prepareGLSLForNaga(blockVertex, blockFragment)).toThrow(
            /CameraBlock has incompatible vertex and fragment layouts/u
        );

        expect(() =>
            prepareGLSLForNaga(
                blockVertex.replace(
                    'layout(std140) uniform CameraBlock { mat4 projection; };',
                    '#define BLOCK_COUNT 2\nlayout(std140) uniform CameraBlock { vec4 projection[BLOCK_COUNT]; };'
                ),
                blockFragment.replace(
                    'layout(std140) uniform CameraBlock { vec4 projection; };',
                    '#define BLOCK_COUNT 3\nlayout(std140) uniform CameraBlock { vec4 projection[BLOCK_COUNT]; };'
                )
            )
        ).toThrow(/CameraBlock has incompatible vertex and fragment layouts/u);
    });
});

interface BuiltInShaderCase {
    readonly name: string;
    readonly vertex?: string;
    readonly fragment: string;
    readonly defines: Readonly<Record<string, number>>;
    readonly expectedVertexInputs?: readonly string[];
    readonly expectedSamplers?: readonly string[];
    readonly expectedUniformBlocks?: readonly string[];
}

const builtInShaderCases: readonly BuiltInShaderCase[] = [
    {
        name: 'basic unlit',
        fragment: basicFragmentSource,
        defines: {
            HILO_LIGHT_TYPE_NONE: 1,
            HILO_SIDE: 1028,
            HILO_PREMULTIPLY_ALPHA: 1
        }
    },
    {
        name: 'basic textured phong lighting and fog',
        fragment: basicFragmentSource,
        defines: {
            HILO_LIGHT_TYPE_PHONG: 1,
            HILO_SIDE: 1028,
            HILO_HAS_LIGHT: 1,
            HILO_HAS_SPECULAR: 1,
            HILO_HAS_NORMAL: 1,
            HILO_HAS_TANGENT: 1,
            HILO_HAS_TEXCOORD0: 1,
            HILO_HAS_TEXCOORD1: 1,
            HILO_DIFFUSE_MAP: MaterialTextureSlot.DIFFUSE,
            HILO_SPECULAR_MAP: MaterialTextureSlot.SPECULAR,
            HILO_AMBIENT_MAP: MaterialTextureSlot.AMBIENT,
            HILO_NORMAL_MAP: MaterialTextureSlot.NORMAL,
            HILO_EMISSION_MAP: MaterialTextureSlot.EMISSION,
            HILO_TRANSPARENCY_MAP: MaterialTextureSlot.OPACITY,
            HILO_DIRECTIONAL_LIGHTS: 2,
            HILO_SPOT_LIGHTS: 1,
            HILO_POINT_LIGHTS: 2,
            HILO_AMBIENT_LIGHTS: 1,
            HILO_HAS_FOG: 1,
            HILO_FOG_EXP2: 1,
            HILO_GAMMA_CORRECTION: 1,
            HILO_ALPHA_CUTOFF: 1,
            HILO_PREMULTIPLY_ALPHA: 1
        }
    },
    {
        name: 'PBR material feature surface',
        fragment: pbrFragmentSource,
        defines: {
            HILO_LIGHT_TYPE_PBR: 1,
            HILO_SIDE: 1028,
            HILO_HAS_LIGHT: 1,
            HILO_HAS_NORMAL: 1,
            HILO_HAS_TANGENT: 1,
            HILO_HAS_TEXCOORD0: 1,
            HILO_HAS_TEXCOORD1: 1,
            HILO_NEED_WORLD_NORMAL: 1,
            HILO_BASE_COLOR_MAP: MaterialTextureSlot.BASE_COLOR,
            HILO_METALLIC_MAP: MaterialTextureSlot.METALLIC,
            HILO_ROUGHNESS_MAP: MaterialTextureSlot.ROUGHNESS,
            HILO_METALLIC_ROUGHNESS_MAP: MaterialTextureSlot.METALLIC_ROUGHNESS,
            HILO_OCCLUSION_MAP: MaterialTextureSlot.OCCLUSION,
            HILO_OCCLUSION_STRENGTH: 1,
            HILO_DIFFUSE_ENV_MAP: MaterialTextureSlot.DIFFUSE_ENVIRONMENT,
            HILO_DIFFUSE_ENV_MAP_CUBE: 1,
            HILO_SPECULAR_ENV_MAP: MaterialTextureSlot.SPECULAR_ENVIRONMENT,
            HILO_SPECULAR_ENV_MAP_CUBE: 1,
            HILO_USE_SHADER_TEXTURE_LOD: 1,
            HILO_EMISSION_MAP: MaterialTextureSlot.EMISSION,
            HILO_LIGHT_MAP: MaterialTextureSlot.LIGHT,
            HILO_HAS_CLEARCOAT: 1,
            HILO_CLEARCOAT_MAP: MaterialTextureSlot.CLEARCOAT,
            HILO_CLEARCOAT_ROUGHNESS_MAP: MaterialTextureSlot.CLEARCOAT_ROUGHNESS,
            HILO_CLEARCOAT_NORMAL_MAP: MaterialTextureSlot.CLEARCOAT_NORMAL,
            HILO_HAS_ANISOTROPY: 1,
            HILO_ANISOTROPY_MAP: MaterialTextureSlot.ANISOTROPY,
            HILO_HAS_TRANSMISSION: 1,
            HILO_TRANSMISSION_MAP: MaterialTextureSlot.TRANSMISSION,
            HILO_HAS_VOLUME: 1,
            HILO_THICKNESS_MAP: MaterialTextureSlot.THICKNESS,
            HILO_HAS_IRIDESCENCE: 1,
            HILO_IRIDESCENCE_MAP: MaterialTextureSlot.IRIDESCENCE,
            HILO_IRIDESCENCE_THICKNESS_MAP: MaterialTextureSlot.IRIDESCENCE_THICKNESS,
            HILO_NORMAL_MAP: MaterialTextureSlot.NORMAL,
            HILO_DIRECTIONAL_LIGHTS: 2,
            HILO_SPOT_LIGHTS: 1,
            HILO_POINT_LIGHTS: 2,
            HILO_AREA_LIGHTS: 1,
            HILO_AMBIENT_LIGHTS: 1,
            HILO_GAMMA_CORRECTION: 1,
            HILO_PREMULTIPLY_ALPHA: 1,
            HILO_USE_HDR: 1
        },
        expectedSamplers: [
            'u_baseColorMap[0]',
            'u_normalMap[0]',
            'u_diffuseEnvMap[0]',
            'u_specularEnvMap[0]',
            'u_areaLightsLtcTexture1[0]',
            'u_areaLightsLtcTexture2[0]',
            'u_clearcoatNormalMap[0]',
            'u_anisotropyMap[0]',
            'u_transmissionMap[0]',
            'u_thicknessMap[0]',
            'u_iridescenceMap[0]',
            'u_iridescenceThicknessMap[0]',
            'u_opaqueTexture[0]'
        ]
    },
    {
        name: 'all shadow sampler kinds',
        fragment: pbrFragmentSource,
        defines: {
            HILO_LIGHT_TYPE_PBR: 1,
            HILO_SIDE: 1028,
            HILO_HAS_LIGHT: 1,
            HILO_HAS_NORMAL: 1,
            HILO_SHADOW_ATLAS: 1,
            HILO_DIRECTIONAL_LIGHTS: 3,
            HILO_DIRECTIONAL_LIGHTS_SMC: 2,
            HILO_SPOT_LIGHTS: 2,
            HILO_SPOT_LIGHTS_SMC: 2,
            HILO_POINT_LIGHTS: 2,
            HILO_POINT_LIGHTS_SMC: 2
        },
        expectedSamplers: ['u_shadowAtlas[0]']
    },
    {
        name: 'PBR specular-glossiness, spherical harmonics, log depth and double side',
        fragment: pbrFragmentSource,
        defines: {
            HILO_LIGHT_TYPE_PBR: 1,
            HILO_SIDE: 1032,
            HILO_HAS_LIGHT: 1,
            HILO_HAS_NORMAL: 1,
            HILO_HAS_TANGENT: 1,
            HILO_HAS_TEXCOORD1: 1,
            HILO_NORMAL_MAP: MaterialTextureSlot.NORMAL,
            HILO_BASE_COLOR_MAP: MaterialTextureSlot.BASE_COLOR,
            HILO_PBR_SPECULAR_GLOSSINESS: 1,
            HILO_SPECULAR_GLOSSINESS_MAP: MaterialTextureSlot.SPECULAR_GLOSSINESS,
            HILO_DIFFUSE_ENV_SPHERE_HARMONICS3: 1,
            HILO_NEED_WORLD_NORMAL: 1,
            HILO_SPECULAR_ENV_MAP: MaterialTextureSlot.SPECULAR_ENVIRONMENT,
            HILO_IS_SPECULAR_ENV_MAP_INCLUDE_MIPMAPS: 1,
            HILO_DIRECTIONAL_LIGHTS: 1,
            HILO_USE_LOG_DEPTH: 1,
            HILO_USE_FRAG_DEPTH: 1,
            HILO_GAMMA_CORRECTION: 1
        }
    },
    {
        name: 'per-object GPU picking pass',
        fragment: basicFragmentSource,
        defines: {
            HILO_LIGHT_TYPE_NONE: 1,
            HILO_SIDE: 1028,
            HILO_PICKING_PASS: 1
        },
        expectedUniformBlocks: ['CameraBlock', 'ModelBlock', 'GeometryBlock']
    },
    {
        name: 'skinning and complete morph target set',
        fragment: basicFragmentSource,
        defines: {
            HILO_LIGHT_TYPE_PHONG: 1,
            HILO_SIDE: 1028,
            HILO_HAS_LIGHT: 1,
            HILO_HAS_SPECULAR: 1,
            HILO_HAS_NORMAL: 1,
            HILO_HAS_TANGENT: 1,
            HILO_HAS_TEXCOORD0: 1,
            HILO_NORMAL_MAP: MaterialTextureSlot.NORMAL,
            HILO_JOINT_COUNT: 32,
            HILO_MORPH_TARGET_COUNT: 8,
            HILO_MORPH_HAS_POSITION: 1,
            HILO_MORPH_HAS_NORMAL: 1,
            HILO_MORPH_HAS_TANGENT: 1,
            HILO_DIRECTIONAL_LIGHTS: 1
        },
        expectedVertexInputs: [
            'a_skinIndices',
            'a_skinWeights',
            'a_morphPosition7',
            'a_morphNormal7',
            'a_morphTangent7'
        ],
        expectedUniformBlocks: ['SkinningBlock', 'MorphBlock']
    },
    {
        name: 'instanced model and normal matrices',
        fragment: basicFragmentSource,
        defines: {
            HILO_LIGHT_TYPE_PHONG: 1,
            HILO_SIDE: 1028,
            HILO_INSTANCED: 1,
            HILO_HAS_LIGHT: 1,
            HILO_HAS_SPECULAR: 1,
            HILO_HAS_NORMAL: 1,
            HILO_DIRECTIONAL_LIGHTS: 1
        },
        expectedUniformBlocks: ['InstanceBlock']
    },
    {
        name: 'quantized position, normal and both UV sets',
        fragment: basicFragmentSource,
        defines: {
            HILO_LIGHT_TYPE_PHONG: 1,
            HILO_SIDE: 1028,
            HILO_HAS_LIGHT: 1,
            HILO_HAS_SPECULAR: 1,
            HILO_HAS_NORMAL: 1,
            HILO_HAS_TEXCOORD0: 1,
            HILO_HAS_TEXCOORD1: 1,
            HILO_QUANTIZED: 1,
            HILO_POSITION_QUANTIZED: 1,
            HILO_NORMAL_QUANTIZED: 1,
            HILO_UV_QUANTIZED: 1,
            HILO_UV1_QUANTIZED: 1,
            HILO_DIFFUSE_MAP: MaterialTextureSlot.DIFFUSE,
            HILO_DIRECTIONAL_LIGHTS: 1
        }
    },
    {
        name: 'cube-map basic material',
        fragment: basicFragmentSource,
        defines: {
            HILO_LIGHT_TYPE_NONE: 1,
            HILO_SIDE: 1028,
            HILO_DIFFUSE_CUBE_MAP: MaterialTextureSlot.DIFFUSE
        }
    },
    {
        name: 'geometry position output',
        fragment: geometryFragmentSource,
        defines: {
            HILO_LIGHT_TYPE_NONE: 1,
            HILO_SIDE: 1028,
            HILO_VERTEX_TYPE_POSITION: 1,
            HILO_HAS_FRAG_POS: 1
        }
    },
    {
        name: 'geometry normal output',
        fragment: geometryFragmentSource,
        defines: {
            HILO_LIGHT_TYPE_NONE: 1,
            HILO_SIDE: 1028,
            HILO_VERTEX_TYPE_NORMAL: 1,
            HILO_HAS_NORMAL: 1,
            HILO_WRITE_ORIGIN_DATA: 1
        }
    },
    {
        name: 'geometry packed depth output',
        fragment: geometryFragmentSource,
        defines: {
            HILO_LIGHT_TYPE_NONE: 1,
            HILO_SIDE: 1028,
            HILO_VERTEX_TYPE_DEPTH: 1
        }
    },
    {
        name: 'geometry packed distance output',
        fragment: geometryFragmentSource,
        defines: {
            HILO_LIGHT_TYPE_NONE: 1,
            HILO_SIDE: 1028,
            HILO_VERTEX_TYPE_DISTANCE: 1,
            HILO_HAS_FRAG_POS: 1
        }
    },
    {
        name: 'screen pass',
        vertex: screenVertexSource,
        fragment: screenFragmentSource,
        defines: {}
    }
];

describe('built-in shader WebGPU corpus', () => {
    const translator = new NagaShaderTranslator();

    beforeAll(async () => {
        Shader.init(testEnv.shaderRenderer);
        await translator.initialize();
    });

    it.each(builtInShaderCases)('translates $name through Naga', async shaderCase => {
        const header = `${Object.entries(shaderCase.defines)
            .map(([name, value]) => `#define ${name} ${String(value)}`)
            .join('\n')}\n`;
        const shader = Shader.getCustomShader(
            shaderCase.vertex ?? basicVertexSource,
            shaderCase.fragment,
            header
        );
        const translated = translator.translate(shader.vs, shader.fs);

        expect(translated.vertex.wgsl).toContain('@vertex');
        expect(translated.fragment.wgsl).toContain('@fragment');
        expect(translated.vertexInputs.some(input => input.name === 'a_position')).toBe(true);
        const vertexInputNames = new Set(translated.vertexInputs.map(input => input.name));
        for (const name of shaderCase.expectedVertexInputs ?? []) {
            expect(vertexInputNames.has(name), `missing vertex input ${name}`).toBe(true);
        }
        const samplerNames = new Set(
            translated.samplers.map(sampler => `${sampler.name}[${String(sampler.arrayIndex)}]`)
        );
        for (const name of shaderCase.expectedSamplers ?? []) {
            expect(samplerNames.has(name), `missing sampler ${name}`).toBe(true);
        }
        const uniformBlockNames = new Set(translated.uniformBlocks.map(block => block.name));
        for (const name of shaderCase.expectedUniformBlocks ?? []) {
            expect(uniformBlockNames.has(name), `missing uniform block ${name}`).toBe(true);
        }
        expect(translated.vertex.wgsl).not.toMatch(/^requires\s+/mu);
        expect(translated.fragment.wgsl).not.toMatch(/^requires\s+/mu);
        await Promise.all([
            validateWgslOnDevice(`${shaderCase.name} vertex`, translated.vertex.wgsl),
            validateWgslOnDevice(`${shaderCase.name} fragment`, translated.fragment.wgsl)
        ]);
    });
});

describe('modern example WebGPU shader corpus', () => {
    it('translates and validates the ShaderToy fragment through Naga', async () => {
        registerUniformBlockBinding('ShaderToyBlock');
        const source = Object.values(shaderToyExampleModules)[0];
        if (!source) throw new Error('ShaderToy example source was not loaded');
        expect(source).not.toContain('col = pow( col, vec3(0.4545) )');
        const translator = new NagaShaderTranslator();
        await translator.initialize();
        const translated = translator.translate(screenVertexSource, shaderToyFragment(source));

        expect(translated.fragment.wgsl).toContain('@fragment');
        expect(translated.uniformBlocks.map(block => block.name)).toEqual(['ShaderToyBlock']);
        expect(translated.samplers.map(sampler => sampler.name)).toEqual([
            'iChannel0',
            'iChannel1',
            'iChannel2',
            'iChannel3'
        ]);
        await validateWgslOnDevice('ShaderToy fragment', translated.fragment.wgsl);
    });

    it('translates the instanced snow billboard through Naga', async () => {
        const snowSource = Object.values(snowExampleModules)[0];
        if (!snowSource) throw new Error('Snow example source was not loaded');
        const translator = new NagaShaderTranslator();
        await translator.initialize();
        const translated = translator.translate(
            embeddedShader(snowSource, 'vertexShader'),
            embeddedShader(snowSource, 'fragmentShader')
        );

        expect(translated.vertexInputs.map(input => input.name)).toEqual([
            'a_corner',
            'a_uv',
            'u_particleData',
            'u_particleMotion'
        ]);
        expect(translated.uniformBlocks.map(block => block.name)).toEqual([
            'FrameBlock',
            'CameraBlock'
        ]);
        expect(translated.samplers.map(sampler => sampler.name)).toEqual(['u_diffuse']);
    });

    const postProcessShaderCases = [
        {
            source: () => Object.values(bloomSourceModules)[0],
            fragmentName: 'PREFILTER_FRAGMENT',
            blocks: ['BloomBlock'],
            samplers: ['u_source']
        },
        {
            source: () => Object.values(bloomSourceModules)[0],
            fragmentName: 'DOWNSAMPLE_FRAGMENT',
            blocks: ['BloomBlock'],
            samplers: ['u_source']
        },
        {
            source: () => Object.values(bloomSourceModules)[0],
            fragmentName: 'UPSAMPLE_FRAGMENT',
            blocks: ['BloomBlock'],
            samplers: ['u_high', 'u_low']
        },
        {
            source: () => Object.values(bloomSourceModules)[0],
            fragmentName: 'COMPOSITE_FRAGMENT',
            blocks: ['BloomBlock'],
            samplers: ['u_scene', 'u_bloom']
        },
        {
            source: () => Object.values(colorUberSourceModules)[0],
            fragmentName: 'FRAGMENT_SOURCE',
            blocks: ['ColorUberBlock'],
            samplers: ['u_source']
        }
    ] as const;

    it.each(postProcessShaderCases)(
        'translates $fragmentName post-processing shader through Naga',
        async shaderCase => {
            for (const block of shaderCase.blocks) registerUniformBlockBinding(block);
            const source = shaderCase.source();
            if (!source) {
                throw new Error(`${shaderCase.fragmentName} engine source was not loaded`);
            }
            const bloomBlock = source.includes('const BLOOM_BLOCK = `')
                ? embeddedShader(source, 'BLOOM_BLOCK')
                : '';
            const postProcessFragment = embeddedShader(source, shaderCase.fragmentName).replace(
                '${BLOOM_BLOCK}',
                bloomBlock
            );
            const translator = new NagaShaderTranslator();
            await translator.initialize();
            const translated = translator.translate(
                PORTABLE_FULLSCREEN_VERTEX_SOURCE,
                postProcessFragment
            );

            expect(translated.fragment.wgsl).toContain('@fragment');
            expect(translated.uniformBlocks.map(block => block.name)).toEqual(shaderCase.blocks);
            expect(translated.samplers.map(sampler => sampler.name)).toEqual(shaderCase.samplers);
            await Promise.all([
                validateWgslOnDevice(
                    `${shaderCase.fragmentName} post-process vertex`,
                    translated.vertex.wgsl
                ),
                validateWgslOnDevice(
                    `${shaderCase.fragmentName} post-process fragment`,
                    translated.fragment.wgsl
                )
            ]);
        }
    );
});
