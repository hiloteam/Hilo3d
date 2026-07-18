import { describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import type { ShaderRenderer } from '../../../src/shader/Shader';
import { testEnv } from '../../renderer-setup';

const Shader = Hilo3d.Shader;
const ShaderMaterial = Hilo3d.ShaderMaterial;

describe('Shader', () => {
    Shader.init(testEnv.shaderRenderer);

    it('create', () => {
        const shader = new Shader();
        expect(shader.isShader).toBe(true);
        expect(shader.className).toBe('Shader');
    });

    it('getHeaderKey', () => {
        const { mesh, material, renderer, fog } = testEnv;
        const lightManager = renderer.lightManager;
        const key = Shader.getHeaderKey(mesh, material, lightManager, fog, false);
        expect(key).toMatch(/^h:[\da-f]{16}$/);
        expect(Shader.getHeaderKey(mesh, material, lightManager, fog, false)).toBe(key);
        expect(key).not.toContain(material.id);
        expect(key.length).toBeLessThan(24);
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

    it('maps public light model names to legal GLSL identifiers', () => {
        const { mesh, renderer } = testEnv;
        const material = new Hilo3d.BasicMaterial({ lightType: 'BLINN-PHONG' });
        const header = Shader.getHeader(mesh, material, renderer.lightManager, null, false);

        expect(header).toContain('#define HILO_LIGHT_TYPE_BLINN_PHONG 1');
        expect(header).not.toContain('BLINN-PHONG');
    });

    it('separates structural geometry macros for meshes sharing one material', () => {
        const material = new Hilo3d.BasicMaterial({ lightType: 'NONE' });
        const firstGeometry = new Hilo3d.Geometry({
            colors: new Hilo3d.GeometryData(new Float32Array([1, 0, 0]), 3),
            normalDecodeMat: new Float32Array(16)
        });
        const secondGeometry = new Hilo3d.Geometry({
            colors: new Hilo3d.GeometryData(new Float32Array([1, 0, 0, 1]), 4),
            uvDecodeMat: new Float32Array(16)
        });
        const firstMesh = new Hilo3d.Mesh({ geometry: firstGeometry, material });
        const secondMesh = new Hilo3d.Mesh({ geometry: secondGeometry, material });
        const lightManager = testEnv.renderer.lightManager;

        const firstKey = Shader.getHeaderKey(firstMesh, material, lightManager, null, false);
        const secondKey = Shader.getHeaderKey(secondMesh, material, lightManager, null, false);
        const firstHeader = Shader.getHeader(firstMesh, material, lightManager, null, false);
        const secondHeader = Shader.getHeader(secondMesh, material, lightManager, null, false);

        expect(secondKey).not.toBe(firstKey);
        expect(firstHeader).toContain('#define HILO_NORMAL_QUANTIZED 1');
        expect(firstHeader).toContain('#define HILO_COLOR_SIZE 3');
        expect(firstHeader).not.toContain('HILO_UV_QUANTIZED');
        expect(secondHeader).toContain('#define HILO_UV_QUANTIZED 1');
        expect(secondHeader).toContain('#define HILO_COLOR_SIZE 4');
        expect(secondHeader).not.toContain('HILO_NORMAL_QUANTIZED');
    });

    it('changes the shader signature after runtime geometry and morph structure edits', () => {
        const geometry = new Hilo3d.Geometry();
        const initialKey = geometry.getShaderKey();
        geometry.colors = new Hilo3d.GeometryData(new Float32Array([1, 0, 0, 1]), 4);
        geometry.uv1DecodeMat = new Float32Array(16);
        geometry.isDirty = true;
        const changedKey = geometry.getShaderKey();
        expect(changedKey).not.toBe(initialKey);
        expect(changedKey).toContain('COLOR_SIZE');
        expect(changedKey).toContain('UV1_QUANTIZED');

        const morphTarget = new Hilo3d.GeometryData(new Float32Array([0, 0, 0]), 3);
        const morph = new Hilo3d.MorphGeometry({ targets: { vertices: [morphTarget] } });
        const firstMorphKey = morph.getShaderKey();
        morph.targets = {
            vertices: [morphTarget, morphTarget],
            normals: [morphTarget, morphTarget]
        };
        morph.isDirty = true;
        const secondMorphKey = morph.getShaderKey();
        expect(secondMorphKey).not.toBe(firstMorphKey);
        expect(secondMorphKey).toContain('MORPH_HAS_NORMAL');
        expect(secondMorphKey).toContain('MORPH_TARGET_COUNT');
    });

    it('invalidates the header snapshot when skin indices switch to unsigned storage', () => {
        const skinIndices = new Hilo3d.GeometryData(new Float32Array(4), 4);
        const geometry = new Hilo3d.Geometry({ skinIndices });
        const material = new Hilo3d.BasicMaterial({ lightType: 'NONE' });
        const mesh = new Hilo3d.Mesh({ geometry, material });
        const lightManager = testEnv.renderer.lightManager;

        const floatKey = Shader.getHeaderKey(mesh, material, lightManager, null, false);
        expect(Shader.getHeader(mesh, material, lightManager, null, false)).not.toContain(
            'HILO_SKIN_INDICES_UINT'
        );

        skinIndices.data = new Uint8Array(4);
        const unsignedKey = Shader.getHeaderKey(mesh, material, lightManager, null, false);
        expect(unsignedKey).not.toBe(floatKey);
        expect(Shader.getHeader(mesh, material, lightManager, null, false)).toContain(
            '#define HILO_SKIN_INDICES_UINT 1'
        );
        expect(geometry.getShaderKey()).toContain('SKIN_INDICES_UINT');
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

    it('isolates common precision headers and caches between renderer instances', () => {
        const lowPrecisionRenderer: ShaderRenderer = {
            vertexPrecision: 'lowp',
            fragmentPrecision: 'lowp',
            resourceManager: testEnv.renderer.resourceManager
        };
        const highPrecisionRenderer: ShaderRenderer = {
            vertexPrecision: 'highp',
            fragmentPrecision: 'highp',
            resourceManager: testEnv.renderer.resourceManager
        };
        Shader.init(lowPrecisionRenderer);
        Shader.init(highPrecisionRenderer);

        const low = Shader.getCustomShader(
            'void main(){}',
            'void main(){}',
            '',
            'precision-isolation',
            false,
            lowPrecisionRenderer
        );
        const high = Shader.getCustomShader(
            'void main(){}',
            'void main(){}',
            '',
            'precision-isolation',
            false,
            highPrecisionRenderer
        );

        expect(low).not.toBe(high);
        expect(low.vs).toContain('#define HILO_MAX_VERTEX_PRECISION lowp');
        expect(high.vs).toContain('#define HILO_MAX_VERTEX_PRECISION highp');
        expect(
            Shader.getCustomShader(
                'void main(){}',
                'void main(){}',
                '',
                'precision-isolation',
                false,
                lowPrecisionRenderer
            )
        ).toBe(low);

        const mutablePrecisionRenderer: ShaderRenderer = {
            vertexPrecision: 'lowp',
            fragmentPrecision: 'lowp',
            resourceManager: testEnv.renderer.resourceManager
        };
        const beforePrecisionEdit = Shader.getCustomShader(
            'void main(){}',
            'void main(){}',
            '',
            'mutable-precision',
            false,
            mutablePrecisionRenderer
        );
        mutablePrecisionRenderer.vertexPrecision = 'mediump';
        mutablePrecisionRenderer.fragmentPrecision = 'mediump';
        const afterPrecisionEdit = Shader.getCustomShader(
            'void main(){}',
            'void main(){}',
            '',
            'mutable-precision',
            false,
            mutablePrecisionRenderer
        );
        expect(afterPrecisionEdit).not.toBe(beforePrecisionEdit);
        expect(afterPrecisionEdit.vs).toContain('#define HILO_MAX_VERTEX_PRECISION mediump');
        Shader.init(testEnv.shaderRenderer);
    });

    it('keeps the implicit precision header deterministic across renderer initialization', () => {
        const lowPrecisionRenderer: ShaderRenderer = {
            vertexPrecision: 'lowp',
            fragmentPrecision: 'lowp',
            resourceManager: testEnv.renderer.resourceManager
        };
        const before = Shader.getCustomShader(
            'void main(){}',
            'void main(){}',
            '',
            'implicit-precision-isolation'
        );

        Shader.init(lowPrecisionRenderer);
        const after = Shader.getCustomShader(
            'void main(){}',
            'void main(){}',
            '',
            'implicit-precision-isolation'
        );

        expect(after).toBe(before);
        expect(after.vs).toContain('#define HILO_MAX_VERTEX_PRECISION highp');
        expect(after.vs).not.toContain('#define HILO_MAX_VERTEX_PRECISION lowp');
    });

    it('creates fresh header and shader variants after direct common option edits', () => {
        const feature = 'CACHE_SIGNATURE_TEST';
        const hadPreviousValue = Object.hasOwn(Shader.commonOptions, feature);
        const previousValue = Shader.commonOptions[feature];
        const material = new Hilo3d.BasicMaterial({ lightType: 'NONE' });
        const mesh = new Hilo3d.Mesh({
            geometry: new Hilo3d.Geometry(),
            material
        });
        const lightManager = testEnv.renderer.lightManager;

        try {
            Shader.commonOptions[feature] = 1;
            const firstHeader = Shader.getHeader(mesh, material, lightManager, null, false);
            const firstShader = Shader.getCustomShader(
                'void main(){}',
                'void main(){}',
                firstHeader,
                'common-option-variant',
                false,
                testEnv.shaderRenderer
            );
            material.isDirty = false;

            Shader.commonOptions[feature] = 2;
            const secondHeader = Shader.getHeader(mesh, material, lightManager, null, false);
            const secondShader = Shader.getCustomShader(
                'void main(){}',
                'void main(){}',
                secondHeader,
                'common-option-variant',
                false,
                testEnv.shaderRenderer
            );

            expect(firstHeader).toContain('#define HILO_CACHE_SIGNATURE_TEST 1');
            expect(secondHeader).toContain('#define HILO_CACHE_SIGNATURE_TEST 2');
            expect(secondHeader).not.toBe(firstHeader);
            expect(secondShader).not.toBe(firstShader);
            expect(firstShader.vs).toContain('#define HILO_CACHE_SIGNATURE_TEST 1');
            expect(secondShader.vs).toContain('#define HILO_CACHE_SIGNATURE_TEST 2');
        } finally {
            if (hadPreviousValue && previousValue !== undefined) {
                Shader.commonOptions[feature] = previousValue;
            } else {
                Reflect.deleteProperty(Shader.commonOptions, feature);
            }
        }
    });

    it('keys material and light structural revisions without reusing stale macros', () => {
        const material = new Hilo3d.BasicMaterial({ lightType: 'PHONG' });
        const mesh = new Hilo3d.Mesh({
            geometry: new Hilo3d.Geometry(),
            material
        });
        const lightManager = new Hilo3d.LightManager();
        lightManager.lightInfo.POINT_LIGHTS = 1;

        const firstKey = Shader.getHeaderKey(mesh, material, lightManager, null, false);
        const firstHeader = Shader.getHeader(mesh, material, lightManager, null, false);
        material.receiveShadows = false;
        lightManager.lightInfo.POINT_LIGHTS = 2;
        material.isDirty = true;
        lightManager.lightInfo.uid = 'point-lights-2';
        const secondKey = Shader.getHeaderKey(mesh, material, lightManager, null, false);
        const secondHeader = Shader.getHeader(mesh, material, lightManager, null, false);

        expect(secondKey).not.toBe(firstKey);
        expect(firstHeader).toContain('#define HILO_POINT_LIGHTS 1');
        expect(firstHeader).toContain('#define HILO_RECEIVE_SHADOWS 1');
        expect(secondHeader).toContain('#define HILO_POINT_LIGHTS 2');
        expect(secondHeader).not.toContain('HILO_RECEIVE_SHADOWS');
    });

    it('skips render-option collection on the stable draw hot path', () => {
        const getCustomRenderOption = vi.fn(() => ({ STABLE_VARIANT: 1 }));
        const material = new ShaderMaterial({ getCustomRenderOption });
        const geometry = new Hilo3d.Geometry();
        const mesh = new Hilo3d.Mesh({ geometry, material });
        const lightManager = new Hilo3d.LightManager();
        const fog = new Hilo3d.Fog();

        const first = Shader.getHeader(mesh, material, lightManager, fog, false);
        const second = Shader.getHeader(mesh, material, lightManager, fog, false);
        expect(second).toBe(first);
        expect(getCustomRenderOption).toHaveBeenCalledTimes(1);

        material.isDirty = true;
        expect(Shader.getHeader(mesh, material, lightManager, fog, false)).toBe(first);
        expect(getCustomRenderOption).toHaveBeenCalledTimes(2);

        geometry.isDirty = true;
        expect(Shader.getHeader(mesh, material, lightManager, fog, false)).toBe(first);
        expect(getCustomRenderOption).toHaveBeenCalledTimes(3);

        lightManager.lightInfo.uid = 'structural-light-edit';
        expect(Shader.getHeader(mesh, material, lightManager, fog, false)).toBe(first);
        expect(getCustomRenderOption).toHaveBeenCalledTimes(4);
    });

    it('recompiles callbacks by revision but caches their final GLSL variant', () => {
        let injectedValue = 1;
        const onBeforeCompile = vi.fn((vs: string, fs: string) => ({
            vs: `${vs}\n#define CALLBACK_VALUE ${String(injectedValue)}`,
            fs
        }));
        const material = new Hilo3d.BasicMaterial({ lightType: 'NONE', onBeforeCompile });
        const header = '#define HILO_LIGHT_TYPE_NONE 1\n';

        const first = Shader.getBasicShader(material, false, header, testEnv.shaderRenderer);
        material.isDirty = true;
        const sameSource = Shader.getBasicShader(material, false, header, testEnv.shaderRenderer);
        injectedValue = 2;
        material.isDirty = true;
        const changedSource = Shader.getBasicShader(
            material,
            false,
            header,
            testEnv.shaderRenderer
        );

        expect(onBeforeCompile).toHaveBeenCalledTimes(3);
        expect(sameSource).toBe(first);
        expect(changedSource).not.toBe(first);
        expect(changedSource.vs).toContain('#define CALLBACK_VALUE 2');
    });

    it('rejects non-finite shader options', () => {
        const optionName = 'NON_FINITE_TEST';
        const material = new Hilo3d.BasicMaterial({ lightType: 'NONE' });
        const mesh = new Hilo3d.Mesh({ geometry: new Hilo3d.Geometry(), material });

        try {
            Shader.commonOptions[optionName] = Number.POSITIVE_INFINITY;
            expect(() =>
                Shader.getHeader(mesh, material, testEnv.renderer.lightManager, null, false)
            ).toThrow(`Shader option ${optionName} must be finite`);
            Shader.commonOptions[optionName] = Number.NaN;
            expect(() =>
                Shader.getHeader(mesh, material, testEnv.renderer.lightManager, null, false)
            ).toThrow(`Shader option ${optionName} must be finite`);
        } finally {
            Reflect.deleteProperty(Shader.commonOptions, optionName);
        }
    });

    it('bounds header and shader variant caches', () => {
        const optionName = 'BOUNDED_HEADER_TEST';
        const material = new Hilo3d.BasicMaterial({ lightType: 'NONE' });
        const mesh = new Hilo3d.Mesh({ geometry: new Hilo3d.Geometry(), material });
        Shader.reset();

        try {
            Shader.commonOptions[optionName] = 0;
            const firstHeaderKey = Shader.getHeaderKey(
                mesh,
                material,
                testEnv.renderer.lightManager,
                null,
                false
            );
            Shader.getHeader(mesh, material, testEnv.renderer.lightManager, null, false);
            Shader.commonOptions[optionName] = 1;
            const secondHeaderKey = Shader.getHeaderKey(
                mesh,
                material,
                testEnv.renderer.lightManager,
                null,
                false
            );
            Shader.getHeader(mesh, material, testEnv.renderer.lightManager, null, false);
            for (let index = 2; index < 1024; index++) {
                Shader.commonOptions[optionName] = index;
                Shader.getHeader(mesh, material, testEnv.renderer.lightManager, null, false);
            }
            Shader.commonOptions[optionName] = 0;
            Shader.getHeader(mesh, material, testEnv.renderer.lightManager, null, false);
            Shader.commonOptions[optionName] = 1024;
            Shader.getHeader(mesh, material, testEnv.renderer.lightManager, null, false);

            let headerCount = 0;
            Shader.headerCache.each(() => headerCount++);
            expect(headerCount).toBeLessThanOrEqual(1024);
            expect(Shader.headerCache.get(firstHeaderKey)).toBeTypeOf('string');
            expect(Shader.headerCache.get(secondHeaderKey)).toBeUndefined();

            const firstShader = Shader.getCustomShader('', '', '', 'bounded-shader-0');
            const secondShader = Shader.getCustomShader('', '', '', 'bounded-shader-1');
            for (let index = 2; index < 2048; index++) {
                Shader.getCustomShader('', '', '', `bounded-shader-${String(index)}`);
            }
            expect(Shader.getCustomShader('', '', '', 'bounded-shader-0')).toBe(firstShader);
            Shader.getCustomShader('', '', '', 'bounded-shader-2048');

            let shaderCount = 0;
            Shader.cache.each(() => shaderCount++);
            expect(shaderCount).toBeLessThanOrEqual(2048);
            expect(Shader.cache.getObject(firstShader)).toBe(firstShader);
            expect(Shader.cache.getObject(secondShader)).toBeUndefined();
        } finally {
            Reflect.deleteProperty(Shader.commonOptions, optionName);
            Shader.reset();
        }
    });

    it('does not let a pre-reset shader release a new cache generation', () => {
        const stale = Shader.getCustomShader('', '', '', 'reset-generation');
        Shader.reset();
        const current = Shader.getCustomShader('', '', '', 'reset-generation');

        stale.destroy();

        expect(Shader.cache.getObject(current)).toBe(current);
        expect(Shader.getCustomShader('', '', '', 'reset-generation')).toBe(current);
    });

    it('does not reuse an explicit custom cache ID for different GLSL sources', () => {
        const first = Shader.getCustomShader(
            'void main(){ gl_Position = vec4(0.0); }',
            'out vec4 color; void main(){ color = vec4(1.0); }',
            '',
            'same-explicit-id'
        );
        const repeated = Shader.getCustomShader(
            'void main(){ gl_Position = vec4(0.0); }',
            'out vec4 color; void main(){ color = vec4(1.0); }',
            '',
            'same-explicit-id'
        );
        const changed = Shader.getCustomShader(
            'void main(){ gl_Position = vec4(1.0); }',
            'out vec4 color; void main(){ color = vec4(0.0); }',
            '',
            'same-explicit-id'
        );

        expect(repeated).toBe(first);
        expect(changed).not.toBe(first);
        expect(changed.vs).toContain('gl_Position = vec4(1.0)');
        expect(changed.fs).toContain('color = vec4(0.0)');
    });

    it('cache', () => {
        const shader = Shader.getCustomShader('', '', '', 'testCustomId');
        expect(Shader.cache.getObject(shader)).toBe(shader);
        shader.destroy();
        expect(Shader.cache.getObject(shader)).toBeUndefined();
        const recreated = Shader.getCustomShader('', '', '', 'testCustomId');
        expect(recreated).not.toBe(shader);
        expect(Shader.cache.getObject(recreated)).toBe(recreated);
        Shader.reset();
        expect(Shader.cache.getObject(recreated)).toBeUndefined();
    });
});
