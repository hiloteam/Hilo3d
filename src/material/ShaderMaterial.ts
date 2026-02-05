import Class from '../core/Class';
import Material from './Material';

/**
 * Shader材质
 * @class
 * @extends Material
 * @example
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
 */
const ShaderMaterial = Class.create(/** @lends ShaderMaterial.prototype */{
    Extends: Material,
    /**
     * @default true
     * @type {boolean}
     */
    isShaderMaterial: true,
    /**
     * @default ShaderMaterial
     * @type {string}
     */
    className: 'ShaderMaterial',
    /**
     * vertex shader 代码
     * @type {string}
     */
    vs: '',
    /**
     * fragment shader 代码
     * @type {string}
     */
    fs: '',
    /**
     * 是否使用 header cache shader
     * @default true
     * @type {Boolean}
     */
    useHeaderCache: false,
    /**
     * @constructs
     * @param {object} [params] 初始化参数，所有params都会复制到实例上
     */
    constructor(params) {
        ShaderMaterial.superclass.constructor.call(this, params);
    },
    getRenderOption(option = {}) {
        ShaderMaterial.superclass.getRenderOption.call(this, option);
        if (this.getCustomRenderOption) {
            const custumOption = this.getCustomRenderOption({});
            for (let name in custumOption) {
                option[`HILO_CUSTUM_OPTION_${name}`] = custumOption[name];
            }
        }
        return option;
    },
    /**
     * 获取定制的渲染参数
     * @default null
     * @type {Function}
     */
    getCustomRenderOption: null
});

export default ShaderMaterial;
