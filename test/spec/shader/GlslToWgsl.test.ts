import { beforeAll, describe, expect, it } from 'vitest';
import { NagaShaderTranslator, prepareGLSLForNaga } from '../../../src/shader/GlslToWgsl';
import { registerUniformBlockBinding } from '../../../src/renderer/ubo/UniformBlockBindings';
import Shader from '../../../src/shader/Shader';
import { testEnv } from '../../setup';

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
const snowExampleModules = import.meta.glob<string>('../../../examples/snow.ts', {
    eager: true,
    query: '?raw',
    import: 'default'
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
        expect(prepared.fragment.glsl).toContain(
            'layout(std140, set = 3, binding = 0) uniform EffectBlock'
        );
        expect(prepared.fragment.glsl).toContain(
            'layout(set = 1, binding = 1) uniform texture2D diffuseMap__texture;'
        );
        expect(prepared.fragment.glsl).toContain(
            'texture(sampler2D(diffuseMap__texture, diffuseMap__sampler), uv)'
        );
        expect(prepared.fragment.glsl).not.toContain('unusedMap__texture');
    });

    it('flattens literal sampler arrays and rejects dynamic sampler indexing', () => {
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

        expect(() =>
            prepareGLSLForNaga(
                '#version 300 es\nin vec2 position;\nout vec2 uv;\nvoid main(){uv=position;gl_Position=vec4(position,0.0,1.0);}',
                arrayFragment.replace('maps[0]', 'maps[int(uv.x)]')
            )
        ).toThrow(/compile-time literal/u);
    });

    it('rejects texture dimensions and component types outside the engine texture API', () => {
        expect(() =>
            prepareGLSLForNaga(
                '#version 300 es\nin vec2 position;\nvoid main(){gl_Position=vec4(position,0.0,1.0);}',
                '#version 300 es\nprecision highp float;\nuniform sampler3D volume;\nout vec4 color;\nvoid main(){color=texture(volume,vec3(0.0));}'
            )
        ).toThrow(/volume uses unsupported sampler3D/u);
        expect(() =>
            prepareGLSLForNaga(
                '#version 300 es\nin vec2 position;\nvoid main(){gl_Position=vec4(position,0.0,1.0);}',
                '#version 300 es\nprecision highp float;\nuniform usampler2D ids;\nout vec4 color;\nvoid main(){color=vec4(texture(ids,vec2(0.0)));}'
            )
        ).toThrow(/ids uses unsupported usampler2D/u);
    });

    it('translates the prepared Vulkan GLSL to valid WGSL through Naga', async () => {
        registerUniformBlockBinding('EffectBlock');
        const translator = new NagaShaderTranslator();
        await translator.initialize();
        const translated = translator.translate(vertex, fragment);
        expect(translated.vertex.wgsl).toContain('requires uniform_buffer_standard_layout;');
        expect(translated.vertex.wgsl).toContain('@vertex');
        expect(translated.fragment.wgsl).toContain('@fragment');
        expect(translated.fragment.wgsl).toContain('textureSample');
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
            HILO_DIFFUSE_MAP: 0,
            HILO_SPECULAR_MAP: 0,
            HILO_AMBIENT_MAP: 1,
            HILO_NORMAL_MAP: 0,
            HILO_EMISSION_MAP: 1,
            HILO_TRANSPARENCY_MAP: 0,
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
            HILO_BASE_COLOR_MAP: 0,
            HILO_METALLIC_MAP: 0,
            HILO_ROUGHNESS_MAP: 1,
            HILO_METALLIC_ROUGHNESS_MAP: 0,
            HILO_OCCLUSION_MAP: 1,
            HILO_OCCLUSION_STRENGTH: 1,
            HILO_DIFFUSE_ENV_MAP: 0,
            HILO_DIFFUSE_ENV_MAP_CUBE: 1,
            HILO_SPECULAR_ENV_MAP: 0,
            HILO_SPECULAR_ENV_MAP_CUBE: 1,
            HILO_USE_SHADER_TEXTURE_LOD: 1,
            HILO_EMISSION_MAP: 0,
            HILO_LIGHT_MAP: 1,
            HILO_HAS_CLEARCOAT: 1,
            HILO_CLEARCOAT_MAP: 0,
            HILO_CLEARCOAT_ROUGHNESS_MAP: 1,
            HILO_CLEARCOAT_NORMAL_MAP: 0,
            HILO_NORMAL_MAP: 0,
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
            'u_clearcoatNormalMap[0]'
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
            HILO_NORMAL_MAP: 1,
            HILO_BASE_COLOR_MAP: 1,
            HILO_PBR_SPECULAR_GLOSSINESS: 1,
            HILO_SPECULAR_GLOSSINESS_MAP: 1,
            HILO_DIFFUSE_ENV_SPHERE_HARMONICS3: 1,
            HILO_NEED_WORLD_NORMAL: 1,
            HILO_SPECULAR_ENV_MAP: 1,
            HILO_IS_SPECULAR_ENV_MAP_INCLUDE_MIPMAPS: 1,
            HILO_DIRECTIONAL_LIGHTS: 1,
            HILO_USE_LOG_DEPTH: 1,
            HILO_USE_FRAG_DEPTH: 1,
            HILO_GAMMA_CORRECTION: 1
        }
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
            HILO_NORMAL_MAP: 0,
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
            HILO_DIFFUSE_MAP: 0,
            HILO_DIRECTIONAL_LIGHTS: 1
        }
    },
    {
        name: 'cube-map basic material',
        fragment: basicFragmentSource,
        defines: {
            HILO_LIGHT_TYPE_NONE: 1,
            HILO_SIDE: 1028,
            HILO_DIFFUSE_CUBE_MAP: 1
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
        Shader.init(testEnv.renderer);
        await translator.initialize();
    });

    it.each(builtInShaderCases)('translates $name through Naga', shaderCase => {
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
    });
});

describe('modern example WebGPU shader corpus', () => {
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
});
