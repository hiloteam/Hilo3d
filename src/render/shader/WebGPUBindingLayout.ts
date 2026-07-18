import {
    BUILTIN_UNIFORM_BLOCK_BINDING_COUNT,
    getUniformBlockBinding,
    registerUniformBlockBinding
} from '../ubo/UniformBlockBindings';

export const WEBGPU_BIND_GROUPS = Object.freeze({
    GLOBAL: 0,
    MATERIAL: 1,
    OBJECT: 2,
    CUSTOM: 3
} as const);

export const WEBGPU_BIND_GROUP_COUNT = 4;

export interface WebGPUResourceBinding {
    readonly group: number;
    readonly binding: number;
}

function binding(group: number, bindingIndex: number): WebGPUResourceBinding {
    return Object.freeze({ group, binding: bindingIndex });
}

/** Stable block ABI partitioned by resource update frequency. */
export const WEBGPU_UNIFORM_BLOCK_BINDINGS = Object.freeze({
    FrameBlock: binding(WEBGPU_BIND_GROUPS.GLOBAL, 0),
    CameraBlock: binding(WEBGPU_BIND_GROUPS.GLOBAL, 1),
    SceneBlock: binding(WEBGPU_BIND_GROUPS.GLOBAL, 2),
    LightBlock: binding(WEBGPU_BIND_GROUPS.GLOBAL, 3),
    MaterialBlock: binding(WEBGPU_BIND_GROUPS.MATERIAL, 0),
    ModelBlock: binding(WEBGPU_BIND_GROUPS.OBJECT, 0),
    GeometryBlock: binding(WEBGPU_BIND_GROUPS.OBJECT, 1),
    SkinningBlock: binding(WEBGPU_BIND_GROUPS.OBJECT, 2),
    MorphBlock: binding(WEBGPU_BIND_GROUPS.OBJECT, 3),
    InstanceBlock: binding(WEBGPU_BIND_GROUPS.OBJECT, 4)
} as const);

export type BuiltInWebGPUUniformBlockName = keyof typeof WEBGPU_UNIFORM_BLOCK_BINDINGS;

const builtInBindings: Readonly<Record<string, WebGPUResourceBinding>> =
    WEBGPU_UNIFORM_BLOCK_BINDINGS;

/**
 * Resolve a logical uniform block to the WebGPU ABI.
 *
 * Custom block order remains identical to the WebGL2 registry: flat binding 9
 * maps to group 3 binding 0, binding 10 maps to group 3 binding 1, and so on.
 */
export function getWebGPUUniformBlockBinding(name: string): WebGPUResourceBinding {
    const builtInBinding = builtInBindings[name];
    if (builtInBinding) return builtInBinding;

    const registeredBinding = getUniformBlockBinding(name);
    const customBinding = registeredBinding - BUILTIN_UNIFORM_BLOCK_BINDING_COUNT;
    if (customBinding < 0) {
        throw new Error(
            `Uniform block ${name} occupies a reserved built-in binding point but has no WebGPU ABI entry`
        );
    }
    return binding(WEBGPU_BIND_GROUPS.CUSTOM, customBinding);
}

/** Register a custom block in the shared stable registry and return its WebGPU location. */
export function registerWebGPUCustomUniformBlockBinding(
    name: string,
    bindingPoint?: number
): WebGPUResourceBinding {
    if (builtInBindings[name]) {
        throw new Error(`Uniform block ${name} is built in and cannot be registered as custom`);
    }
    registerUniformBlockBinding(name, bindingPoint);
    return getWebGPUUniformBlockBinding(name);
}

export const FIRST_MATERIAL_TEXTURE_BINDING = 1;

export interface WebGPUTextureSamplerBinding {
    readonly group: typeof WEBGPU_BIND_GROUPS.MATERIAL;
    readonly textureBinding: number;
    readonly samplerBinding: number;
}

/** Deterministic separate texture/sampler pair for a material texture slot. */
export function getWebGPUMaterialTextureBinding(textureIndex: number): WebGPUTextureSamplerBinding {
    if (!Number.isSafeInteger(textureIndex) || textureIndex < 0) {
        throw new RangeError('Material texture index must be a non-negative integer');
    }
    const textureBinding = FIRST_MATERIAL_TEXTURE_BINDING + textureIndex * 2;
    return Object.freeze({
        group: WEBGPU_BIND_GROUPS.MATERIAL,
        textureBinding,
        samplerBinding: textureBinding + 1
    });
}
