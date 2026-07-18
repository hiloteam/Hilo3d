import Material, { type MaterialParameters } from './Material';
import type { ShaderOptions } from '../render/types';

export type CustomRenderOptionProvider = (option: ShaderOptions) => ShaderOptions;

export interface ShaderMaterialParameters extends MaterialParameters {
    vs?: string;
    fs?: string;
    useHeaderCache?: boolean;
    getCustomRenderOption?: CustomRenderOptionProvider | null;
}
/**
 * Native GLSL ES 3.00 shader material.
 *
 * Numeric, vector and matrix data must be supplied through registered std140 uniform blocks.
 * Opaque sampler types are the only uniforms permitted outside a block.
 *
 * @example
 * ```ts
 * Hilo3d.registerUniformBlockBinding('EffectBlock');
 * const effectLayout = Hilo3d.createStd140Layout({
 *     effectColor: 'vec4',
 *     strength: 'float'
 * });
 * const effectBlock = Hilo3d.UniformBuffer.fromSchema(effectLayout, {
 *     effectColor: [0.6, 0.8, 1, 1],
 *     strength: 0.75
 * });
 *
 * const material = new Hilo3d.ShaderMaterial({
 *     attributes: { a_position: 'POSITION' },
 *     uniformBlocks: { EffectBlock: effectBlock },
 *     vs: `#version 300 es
 *         layout(std140) uniform EffectBlock {
 *             vec4 effectColor;
 *             float strength;
 *         };
 *         in vec3 a_position;
 *         out vec4 v_color;
 *         void main() {
 *             v_color = vec4(effectColor.rgb * strength, effectColor.a);
 *             gl_Position = vec4(a_position, 1.0);
 *         }`,
 *     fs: `#version 300 es
 *         precision highp float;
 *         layout(std140) uniform EffectBlock {
 *             vec4 effectColor;
 *             float strength;
 *         };
 *         in vec4 v_color;
 *         layout(location = 0) out vec4 outColor;
 *         void main() {
 *             outColor = v_color;
 *         }`
 * });
 *
 * effectBlock.set('strength', 1);
 * ```
 */
class ShaderMaterial extends Material {
    isShaderMaterial = true;
    override readonly className: string = 'ShaderMaterial';
    /**
     * vertex shader 代码
     */
    vs = '';
    /**
     * fragment shader 代码
     */
    fs = '';
    /**
     * 是否使用 header cache shader
     */
    useHeaderCache = false;
    /**
     * @param params - 初始化参数，所有params都会复制到实例上
     */
    constructor(params: ShaderMaterialParameters = {}) {
        super({}, false);
        Object.assign(this, params);
        this.initializeBindings();
    }
    override getRenderOption(option: ShaderOptions = {}): ShaderOptions {
        super.getRenderOption(option);
        if (this.getCustomRenderOption) {
            const customOption = this.getCustomRenderOption({});
            for (const [name, value] of Object.entries(customOption)) {
                option[`HILO_CUSTOM_OPTION_${name}`] = value;
            }
        }
        return option;
    }
    /**
     * 获取定制的渲染参数
     */
    getCustomRenderOption: CustomRenderOptionProvider | null = null;
}
export default ShaderMaterial;
