import Material, { type MaterialParameters } from './Material';
import type { ShaderOptions } from '../renderer/types';

export type CustomRenderOptionProvider = (option: ShaderOptions) => ShaderOptions;

export interface ShaderMaterialParameters extends MaterialParameters {
    vs?: string;
    fs?: string;
    useHeaderCache?: boolean;
    getCustomRenderOption?: CustomRenderOptionProvider | null;
}
/**
 * Shader材质
 * @example
 * ```ts
 * const material = new Hilo3d.ShaderMaterial({
 *     attributes:{
 *         a_pos: 'POSITION'
 *     },
 *     uniforms:{
 *         u_mat:'MODELVIEWPROJECTION',
 *         u_color_b:{
 *             get:function(mesh, material, programInfo){
 *                 return Math.random();
 *             }
 *         }
 *     },
 *     vs:`
 *         precision HILO_MAX_VERTEX_PRECISION float;
 *         attribute vec3 a_pos;
 *         uniform mat4 u_mat;
 *
 *         void main(void) {
 *             gl_Position = u_mat * vec4(a_pos, 1.0);
 *         }
 *     `,
 *     fs:`
 *         precision HILO_MAX_FRAGMENT_PRECISION float;
 *         uniform float u_color_b;
 *
 *         void main(void) {
 *             gl_FragColor = vec4(0.6, 0.8, u_color_b, 1);
 *         }
 *     `
 * });
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
            const custumOption = this.getCustomRenderOption({});
            for (const [name, value] of Object.entries(custumOption)) {
                option[`HILO_CUSTUM_OPTION_${name}`] = value;
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
