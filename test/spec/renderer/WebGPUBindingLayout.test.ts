import { describe, expect, it } from 'vitest';
import {
    BUILTIN_UNIFORM_BLOCK_BINDING_COUNT,
    registerUniformBlockBinding
} from '../../../src/render/ubo/UniformBlockBindings';
import {
    getWebGPUMaterialTextureBinding,
    getWebGPUSceneTextureBinding,
    getWebGPUUniformBlockBinding,
    registerWebGPUCustomUniformBlockBinding,
    WEBGPU_BIND_GROUP_COUNT,
    WEBGPU_BIND_GROUPS,
    WEBGPU_SCENE_TEXTURE_BINDING,
    WEBGPU_UNIFORM_BLOCK_BINDINGS
} from '../../../src/render/shader/WebGPUBindingLayout';

describe('WebGPUBindingLayout', () => {
    it('uses the fixed four-group ABI partitioned by update frequency', () => {
        expect(WEBGPU_BIND_GROUP_COUNT).toBe(4);
        expect(WEBGPU_BIND_GROUPS).toEqual({ GLOBAL: 0, MATERIAL: 1, OBJECT: 2, CUSTOM: 3 });
        expect(WEBGPU_UNIFORM_BLOCK_BINDINGS).toEqual({
            FrameBlock: { group: 0, binding: 0 },
            CameraBlock: { group: 0, binding: 1 },
            SceneBlock: { group: 0, binding: 2 },
            LightBlock: { group: 0, binding: 3 },
            MaterialBlock: { group: 1, binding: 0 },
            MaterialTextureBlock: { group: 1, binding: 1 },
            ModelBlock: { group: 2, binding: 0 },
            GeometryBlock: { group: 2, binding: 1 },
            SkinningBlock: { group: 2, binding: 2 },
            MorphBlock: { group: 2, binding: 3 },
            InstanceBlock: { group: 2, binding: 4 }
        });
    });

    it('assigns every built-in block a unique group and binding pair', () => {
        const bindings = Object.values(WEBGPU_UNIFORM_BLOCK_BINDINGS);
        const keys = new Set(
            bindings.map(({ group, binding }) => `${String(group)}:${String(binding)}`)
        );

        expect(keys.size).toBe(bindings.length);
        for (const blockName of Object.keys(WEBGPU_UNIFORM_BLOCK_BINDINGS)) {
            expect(getWebGPUUniformBlockBinding(blockName)).toBe(
                WEBGPU_UNIFORM_BLOCK_BINDINGS[
                    blockName as keyof typeof WEBGPU_UNIFORM_BLOCK_BINDINGS
                ]
            );
        }
    });

    it('maps the shared custom registration order into group 3', () => {
        const name = 'WebGPUAutoCustomBlock';
        const flatBinding = registerUniformBlockBinding(name);

        expect(getWebGPUUniformBlockBinding(name)).toEqual({
            group: WEBGPU_BIND_GROUPS.CUSTOM,
            binding: flatBinding - BUILTIN_UNIFORM_BLOCK_BINDING_COUNT + 2
        });
        expect(registerWebGPUCustomUniformBlockBinding(name)).toEqual(
            getWebGPUUniformBlockBinding(name)
        );
    });

    it('preserves explicit custom binding gaps without collisions', () => {
        const first = registerWebGPUCustomUniformBlockBinding(
            'WebGPUExplicitCustomBlockA',
            BUILTIN_UNIFORM_BLOCK_BINDING_COUNT + 40
        );
        const second = registerWebGPUCustomUniformBlockBinding(
            'WebGPUExplicitCustomBlockB',
            BUILTIN_UNIFORM_BLOCK_BINDING_COUNT + 41
        );

        expect(first).toEqual({ group: 3, binding: 42 });
        expect(second).toEqual({ group: 3, binding: 43 });
        expect(first).not.toEqual(second);
    });

    it('reserves one pass-global opaque scene texture pair', () => {
        expect(WEBGPU_SCENE_TEXTURE_BINDING).toEqual({
            group: WEBGPU_BIND_GROUPS.CUSTOM,
            textureBinding: 0,
            samplerBinding: 1
        });
        expect(getWebGPUSceneTextureBinding('u_opaqueTexture', 0)).toBe(
            WEBGPU_SCENE_TEXTURE_BINDING
        );
        expect(getWebGPUSceneTextureBinding('u_diffuse', 0)).toBeUndefined();
        expect(() => getWebGPUSceneTextureBinding('u_opaqueTexture', 1)).toThrow(/scalar sampler/);
    });

    it('allocates texture and sampler bindings after both material-owned blocks', () => {
        expect(getWebGPUMaterialTextureBinding(0)).toEqual({
            group: WEBGPU_BIND_GROUPS.MATERIAL,
            textureBinding: 2,
            samplerBinding: 3
        });
        expect(getWebGPUMaterialTextureBinding(3)).toEqual({
            group: WEBGPU_BIND_GROUPS.MATERIAL,
            textureBinding: 8,
            samplerBinding: 9
        });
        expect(() => getWebGPUMaterialTextureBinding(-1)).toThrow(/non-negative integer/);
        expect(() => getWebGPUMaterialTextureBinding(0.5)).toThrow(/non-negative integer/);
    });

    it('rejects unknown and built-in custom registrations', () => {
        expect(() => getWebGPUUniformBlockBinding('UnregisteredWebGPUBlock')).toThrow(
            /no fixed binding point/
        );
        expect(() => registerWebGPUCustomUniformBlockBinding('FrameBlock')).toThrow(/built in/);
    });
});
