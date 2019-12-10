import Class from '../core/Class';
import Material from './Material';
import Color from '../math/Color';

/**
 * 基础材质，支持 NONE, PHONG, BLINN-PHONG, LAMBERT光照模型
 * @class
 * @extends Material
 * @example
 * const material = new Hilo3d.BasicMaterial({
 *     diffuse: new Hilo3d.Color(1, 0, 0, 1)
 * });
 */
const BasicMaterial = Class.create(/** @lends BasicMaterial.prototype */ {
    Extends: Material,
    /**
     * @default true
     * @type {boolean}
     */
    isBasicMaterial: true,
    /**
     * @default BasicMaterial
     * @type {string}
     */
    className: 'BasicMaterial',
    /**
     * 光照类型，支持: NONE, PHONG, BLINN-PHONG, LAMBERT
     * @default BLINN-PHONG
     * @type {string}
     */
    lightType: 'BLINN-PHONG',
    /**
     * 漫反射贴图，或颜色
     * @default Color(.5, .5, .5)
     * @type {Texture|Color}
     */
    diffuse: null,
    /**
     * 环境光贴图，或颜色
     * @default null
     * @type {Texture|Color}
     */
    ambient: null,
    /**
     * 镜面贴图，或颜色
     * @default Color(1, 1, 1)
     * @type {Texture|Color}
     */
    specular: null,
    /**
     * 放射光贴图，或颜色
     * @default Color(0, 0, 0)
     * @type {Texture|Color}
     */
    emission: null,
    /**
     * 环境贴图
     * @default null
     * @type {CubeTexture|Texture}
     */
    specularEnvMap: null,
    /**
     * 环境贴图变化矩阵，如旋转等
     * @default null
     * @type {Matrix4}
     */
    specularEnvMatrix: null,
    /**
     * 反射率
     * @default 0
     * @type {number}
     */
    reflectivity: 0,
    /**
     * 折射比率
     * @default 0
     * @type {number}
     */
    refractRatio: 0,
    /**
     * 折射率
     * @default 0
     * @type {number}
     */
    refractivity: 0,
    /**
     * 高光发光值
     * @default 32
     * @type {number}
     */
    shininess: 32,
    usedUniformVectors: 11,
    /**
     * @constructs
     * @param {object} params 初始化参数，所有params都会复制到实例上
     */
    constructor(params) {
        this.diffuse = new Color(.5, .5, .5);
        this.specular = new Color(1, 1, 1);
        this.emission = new Color(0, 0, 0);
        BasicMaterial.superclass.constructor.call(this, params);

        Object.assign(this.uniforms, {
            u_diffuse: 'DIFFUSE',
            u_specular: 'SPECULAR',
            u_ambient: 'AMBIENT',
            u_shininess: 'SHININESS',
            u_reflectivity: 'REFLECTIVITY',
            u_refractRatio: 'REFRACTRATIO',
            u_refractivity: 'REFRACTIVITY',
            u_specularEnvMap: 'SPECULARENVMAP',
            u_specularEnvMatrix: 'SPECULARENVMATRIX'
        });

        this.addTextureUniforms({
            u_diffuse: 'DIFFUSE',
            u_specular: 'SPECULAR',
            u_ambient: 'AMBIENT'
        });
    },
    getRenderOption(option = {}) {
        BasicMaterial.superclass.getRenderOption.call(this, option);

        const textureOption = this._textureOption.reset(option);

        const lightType = this.lightType;
        if (lightType === 'PHONG' || lightType === 'BLINN-PHONG') {
            option.HAS_SPECULAR = 1;
        }


        const diffuse = this.diffuse;
        if (diffuse && diffuse.isTexture) {
            if (diffuse.isCubeTexture) {
                option.DIFFUSE_CUBE_MAP = 1;
            } else {
                textureOption.add(this.diffuse, 'DIFFUSE_MAP');
            }
        }

        if (option.HAS_LIGHT) {
            textureOption.add(this.specular, 'SPECULAR_MAP');
            textureOption.add(this.ambient, 'AMBIENT_MAP');
            textureOption.add(this.specularEnvMap, 'SPECULAR_ENV_MAP');
        }

        textureOption.update();

        return option;
    }
});

export default BasicMaterial;
