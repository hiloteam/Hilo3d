import Material from './Material';
import Color from '../math/Color';
import type { MaterialParams } from '../types/common';

/**
 * 基础材质，支持 NONE, PHONG, BLINN-PHONG, LAMBERT光照模型
 * @class
 * @extends Material
 * @example
 * const material = new Hilo3d.BasicMaterial({
 *     diffuse: new Hilo3d.Color(1, 0, 0, 1)
 * });
 */
class BasicMaterial extends Material {
    /**
     * @default true
     * @type {boolean}
     */
    isBasicMaterial: boolean = true;

    /**
     * @default BasicMaterial
     * @type {string}
     */
    className: string = 'BasicMaterial';

    /**
     * 光照类型，支持: NONE, PHONG, BLINN-PHONG, LAMBERT
     * @default BLINN-PHONG
     * @type {'NONE'|'PHONG'|'BLINN-PHONG'|'LAMBERT'}
     */
    lightType: 'NONE'|'PHONG'|'BLINN-PHONG'|'LAMBERT' = 'BLINN-PHONG';

    /**
     * 漫反射贴图，或颜色
     * @default Color(.5, .5, .5)
     * @type {Texture|Color}
     */
    diffuse: any = new Color(.5, .5, .5);

    /**
     * 环境光贴图，或颜色
     * @default null
     * @type {Texture|Color}
     */
    ambient: any = null;

    /**
     * 镜面贴图，或颜色
     * @default Color(1, 1, 1)
     * @type {Texture|Color}
     */
    specular: any = new Color(1, 1, 1);

    /**
     * 放射光贴图，或颜色
     * @default Color(0, 0, 0)
     * @type {Texture|Color}
     */
    emission: any = new Color(0, 0, 0);

    /**
     * 环境贴图
     * @default null
     * @type {CubeTexture|Texture}
     */
    specularEnvMap: any = null;

    /**
     * 环境贴图变化矩阵，如旋转等
     * @default null
     * @type {Matrix4}
     */
    specularEnvMatrix: any = null;

    /**
     * 反射率
     * @default 0
     * @type {number}
     */
    reflectivity: number = 0;

    /**
     * 折射比率
     * @default 0
     * @type {number}
     */
    refractRatio: number = 0;

    /**
     * 折射率
     * @default 0
     * @type {number}
     */
    refractivity: number = 0;

    /**
     * 高光发光值
     * @default 32
     * @type {number}
     */
    shininess: number = 32;

    usedUniformVectors: number = 11;

    /**
     * @constructs
     * @param {Object} [params] 初始化参数，所有params都会复制到实例上
     * @param {string} [params.lightType=BLINN-PHONG] 光照类型，支持: NONE, PHONG, BLINN-PHONG, LAMBERT
     * @param {Texture|Color} [params.diffuse=new Color(.5, .5, .5)] 漫反射贴图，或颜色
     * @param {Texture|Color} [params.ambient] 环境光贴图，或颜色
     * @param {Texture|Color} [params.specular=new Color(1, 1, 1)] 镜面贴图，或颜色
     * @param {Texture|Color} [params.emission=new Color(0, 0, 0)] 放射光贴图，或颜色
     * @param {Texture} [params.specularEnvMap] 环境贴图
     * @param {Matrix4} [params.specularEnvMatrix] 环境贴图变化矩阵，如旋转等
     * @param {number} [params.reflectivity=0] 反射率
     * @param {number} [params.refractRatio=0] 折射比率
     * @param {number} [params.refractivity=0] 折射率
     * @param {number} [params.shininess=32] 高光发光值
     * @param {any} [params.[value:string]] 其它属性
     */
    constructor(params?: MaterialParams) {
        super(params);

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
    }

    getRenderOption(option: any = {}): any {
        super.getRenderOption(option);

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
}

export default BasicMaterial;
