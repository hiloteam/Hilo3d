import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import { testEnv } from '../../setup';

const Shader = Hilo3d.Shader;
const ShaderMaterial = Hilo3d.ShaderMaterial;

describe('Shader', () => {
    Shader.init(testEnv.renderer);

    it('create', () => {
        const shader = new Shader();
        expect(shader.isShader).toBe(true);
        expect(shader.className).toBe('Shader');
    });

    it('getHeaderKey', () => {
        const { mesh, material, renderer, geometry, fog } = testEnv;
        const lightManager = renderer.lightManager;
        const key = Shader.getHeaderKey(mesh, material, lightManager, fog, false);
        expect(key).toBe(
            `header_${material.id}_${lightManager.lightInfo.uid}_fog_${fog.mode}_${geometry.getShaderKey()}`
        );
    });

    it('getHeader', () => {
        const { mesh, material, renderer, fog } = testEnv;
        const lightManager = renderer.lightManager;
        const header = Shader.getHeader(mesh, material, lightManager, fog, false);
        expect(header).toBe(`#define SHADER_NAME Material
#define HILO_LIGHT_TYPE_NONE 1
#define HILO_SIDE 1028
#define HILO_PREMULTIPLY_ALPHA 1
#define HILO_RECEIVE_SHADOWS 1
#define HILO_CAST_SHADOWS 1
#define HILO_HAS_FOG 1
#define HILO_FOG_LINEAR 1
`);
        const shaderMaterialHeader = Shader.getHeader(
            mesh,
            new ShaderMaterial({
                getCustomRenderOption(options) {
                    options['CUSTOM_1'] = 1;
                    options['CUSTOM_2'] = 0;
                    return options;
                }
            }),
            lightManager,
            fog,
            false
        );
        expect(shaderMaterialHeader).toBe(`#define SHADER_NAME ShaderMaterial
#define HILO_LIGHT_TYPE_NONE 1
#define HILO_SIDE 1028
#define HILO_PREMULTIPLY_ALPHA 1
#define HILO_RECEIVE_SHADOWS 1
#define HILO_CAST_SHADOWS 1
#define CUSTOM_1 1
#define CUSTOM_2 0
#define HILO_HAS_FOG 1
#define HILO_FOG_LINEAR 1
`);
    });

    it('getCustomShader', () => {
        const shader = Shader.getCustomShader(
            'void main(){}',
            'void main(){}',
            '#define HILO_LIGHT_TYPE_NONE 1\n'
        );
        expect(shader.vs).toBe(`#version 300 es

#define HILO_MAX_PRECISION highp
#define HILO_MAX_VERTEX_PRECISION highp
#define HILO_MAX_FRAGMENT_PRECISION highp
#define HILO_LIGHT_TYPE_NONE 1
void main(){}`);

        expect(shader.fs).toBe(`#version 300 es

#define HILO_MAX_PRECISION highp
#define HILO_MAX_VERTEX_PRECISION highp
#define HILO_MAX_FRAGMENT_PRECISION highp
#define HILO_LIGHT_TYPE_NONE 1
void main(){}`);
    });

    it('getBasicShader', () => {
        const shader = Shader.getBasicShader(
            testEnv.material,
            false,
            '#define HILO_LIGHT_TYPE_NONE 1'
        );
        expect(shader.fs).toBeTypeOf('string');
        expect(shader.vs).toBeTypeOf('string');
    });

    it('cache', () => {
        const shader = Shader.getCustomShader('', '', '', 'testCustomId');
        expect(Shader.cache.get('testCustomId')).toBe(shader);
        Shader.reset();
        expect(Shader.cache.get('testCustomId')).toBeUndefined();
    });
});
