import Material, {
    type MaterialParameters,
    type MaterialTexture,
    type MaterialTextureValue
} from './Material';
import Color from '../math/Color';
import type Matrix4 from '../math/Matrix4';
import Texture from '../texture/Texture';
import CubeTexture from '../texture/CubeTexture';
import type { ShaderOptions } from '../renderer/types';

export type BasicLightType = 'NONE' | 'PHONG' | 'BLINN-PHONG' | 'LAMBERT';

export interface BasicMaterialParameters extends MaterialParameters {
    lightType?: BasicLightType;
    diffuse?: MaterialTextureValue;
    ambient?: MaterialTextureValue;
    specular?: MaterialTextureValue;
    emission?: MaterialTextureValue;
    specularEnvMap?: MaterialTexture | null;
    specularEnvMatrix?: Matrix4 | null;
    reflectivity?: number;
    refractRatio?: number;
    refractivity?: number;
    shininess?: number;
}
/**
 * 基础材质，支持 NONE, PHONG, BLINN-PHONG, LAMBERT光照模型
 * @example
 * ```ts
 * const material = new Hilo3d.BasicMaterial({
 *     diffuse: new Hilo3d.Color(1, 0, 0, 1)
 * });
 * ```
 */
class BasicMaterial extends Material {
    isBasicMaterial = true;
    override readonly className: string = 'BasicMaterial';
    /**
     * 光照类型，支持: NONE, PHONG, BLINN-PHONG, LAMBERT
     */
    override lightType: BasicLightType = 'BLINN-PHONG';
    /**
     * 漫反射贴图，或颜色
     */
    diffuse: MaterialTextureValue = null;
    /**
     * 环境光贴图，或颜色
     */
    ambient: MaterialTextureValue = null;
    /**
     * 镜面贴图，或颜色
     */
    specular: MaterialTextureValue = null;
    /**
     * 放射光贴图，或颜色
     */
    override emission: MaterialTextureValue = null;
    /**
     * 环境贴图
     */
    specularEnvMap: MaterialTexture | null = null;
    /**
     * 环境贴图变化矩阵，如旋转等
     */
    specularEnvMatrix: Matrix4 | null = null;
    /**
     * 反射率
     */
    reflectivity = 0;
    /**
     * 折射比率
     */
    refractRatio = 0;
    /**
     * 折射率
     */
    refractivity = 0;
    /**
     * 高光发光值
     */
    shininess = 32;
    usedUniformVectors = 11;
    /**
     * @param params - 初始化参数，所有params都会复制到实例上
     * - `params.lightType`: 光照类型，支持: NONE, PHONG, BLINN-PHONG, LAMBERT
     * - `params.diffuse`: 漫反射贴图，或颜色
     * - `params.ambient`: 环境光贴图，或颜色
     * - `params.specular`: 镜面贴图，或颜色
     * - `params.emission`: 放射光贴图，或颜色
     * - `params.specularEnvMap`: 环境贴图
     * - `params.specularEnvMatrix`: 环境贴图变化矩阵，如旋转等
     * - `params.reflectivity`: 反射率
     * - `params.refractRatio`: 折射比率
     * - `params.refractivity`: 折射率
     * - `params.shininess`: 高光发光值
     */
    constructor(params: BasicMaterialParameters = {}) {
        super({}, false);
        this.diffuse = new Color(0.5, 0.5, 0.5);
        this.specular = new Color(1, 1, 1);
        this.emission = new Color(0, 0, 0);
        if (new.target === BasicMaterial) {
            Object.assign(this, params);
            this.initializeBasicMaterialBindings();
        }
    }

    protected initializeBasicMaterialBindings(): void {
        this.initializeBindings();
        Object.assign(this.uniforms, {
            u_diffuseColor: 'DIFFUSE',
            u_specularColor: 'SPECULAR',
            u_ambientColor: 'AMBIENT',
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
    override getRenderOption(option: ShaderOptions = {}): ShaderOptions {
        super.getRenderOption(option);
        const textureOption = this.textureOption.reset(option);
        const lightType = this.lightType;
        if (lightType === 'PHONG' || lightType === 'BLINN-PHONG') {
            option['HAS_SPECULAR'] = 1;
        }
        const diffuse = this.diffuse;
        if (diffuse instanceof Texture) {
            if (diffuse instanceof CubeTexture) {
                option['DIFFUSE_CUBE_MAP'] = 1;
            } else {
                textureOption.add(this.diffuse, 'DIFFUSE_MAP');
            }
        }
        if (option['HAS_LIGHT']) {
            textureOption.add(this.specular, 'SPECULAR_MAP');
            textureOption.add(this.ambient, 'AMBIENT_MAP');
            textureOption.add(this.specularEnvMap, 'SPECULAR_ENV_MAP');
        }
        textureOption.update();
        return option;
    }
}
export default BasicMaterial;
