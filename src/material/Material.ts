import math from '../math/math';
import semantic from './semantic';
import {
    ALWAYS,
    BACK,
    CCW,
    FRONT,
    FRONT_AND_BACK,
    FUNC_ADD,
    KEEP,
    LEQUAL,
    ONE,
    ONE_MINUS_SRC_ALPHA,
    SRC_ALPHA,
    ZERO
} from '../constants/webgl';
import Texture, { type TextureBinding } from '../texture/Texture';
import type Color from '../math/Color';
import type Matrix3 from '../math/Matrix3';
import type Mesh from '../core/Mesh';
import type UniformBuffer from '../renderer/UniformBuffer';
import type { GLTypeInfo, ShaderOptions } from '../renderer/types';
export interface ProgramBindingInfo {
    textureIndex?: number;
    name?: string;
    location?: GLint | WebGLUniformLocation | null;
    type?: GLenum;
    size?: GLint;
    glTypeInfo?: GLTypeInfo;
}

export interface MaterialBindingInfo {
    readonly isBlankInfo?: boolean;
    readonly isDependMesh?: boolean;
    readonly notSupportInstanced?: boolean;
    get(mesh: Mesh, material: Material, programInfo: ProgramBindingInfo): unknown;
}

export type MaterialBinding = string | MaterialBindingInfo;
export type MaterialBindingMap = Record<string, MaterialBinding>;
export interface MaterialShaderSource {
    vs: string;
    fs: string;
}
export type MaterialBeforeCompile = (vs: string, fs: string) => MaterialShaderSource;
export interface MaterialTexture extends TextureBinding {
    readonly mipmapCount: number;
    destroy(): void;
}
export type MaterialTextureValue = MaterialTexture | Color | null;

export interface MaterialParameters {
    name?: string | null;
    shaderCacheId?: string | null;
    shaderName?: string | null;
    lightType?: string;
    wireframe?: boolean;
    frontFace?: GLenum;
    depthTest?: boolean;
    sampleAlphaToCoverage?: boolean;
    depthMask?: boolean;
    depthRange?: [number, number];
    depthFunc?: GLenum;
    cullFace?: boolean;
    cullFaceType?: GLenum;
    side?: GLenum;
    normalMap?: Texture | null;
    parallaxMap?: Texture | null;
    emission?: MaterialTextureValue;
    normalMapScale?: number;
    ignoreTransparent?: boolean;
    gammaCorrection?: boolean;
    usePhysicsLight?: boolean;
    isDiffuseEnvAndAmbientLightWorkTogether?: boolean;
    userData?: unknown;
    renderOrder?: number;
    premultiplyAlpha?: boolean;
    gammaFactor?: number;
    castShadows?: boolean;
    receiveShadows?: boolean;
    uvMatrix?: Matrix3 | null;
    uvMatrix1?: Matrix3 | null;
    blend?: boolean;
    blendEquation?: GLenum;
    blendEquationAlpha?: GLenum;
    blendSrc?: GLenum;
    blendDst?: GLenum;
    blendSrcAlpha?: GLenum;
    blendDstAlpha?: GLenum;
    stencilTest?: boolean;
    stencilMask?: number;
    stencilFunc?: GLenum;
    stencilFuncRef?: number;
    stencilFuncMask?: number;
    stencilOpFail?: GLenum;
    stencilOpZFail?: GLenum;
    stencilOpZPass?: GLenum;
    isDirty?: boolean;
    transparency?: number | Texture;
    transparent?: boolean;
    alphaCutoff?: number;
    useHDR?: boolean;
    exposure?: number;
    enableTextureLod?: boolean;
    enableDrawBuffers?: boolean;
    needBasicUniforms?: boolean;
    needBasicAttributes?: boolean;
    /**
     * Semantic resolvers used by canonical UBO packing and standalone sampler bindings.
     * Application-defined classic uniforms must be sampler types; put every numeric value in
     * `uniformBlocks`.
     */
    uniforms?: MaterialBindingMap;
    attributes?: MaterialBindingMap;
    /** Registered std140 blocks keyed by their globally stable GLSL block name. */
    uniformBlocks?: Record<string, UniformBuffer>;
    onBeforeCompile?: MaterialBeforeCompile | null;
}

export interface InstancedUniform {
    name: string;
    info: MaterialBindingInfo;
}

type MaterialConstructor = new (params?: MaterialParameters) => Material;

function isBindingInfo(value: unknown): value is MaterialBindingInfo {
    return (
        typeof value === 'object' &&
        value !== null &&
        'get' in value &&
        typeof value.get === 'function'
    );
}

function isMaterialTexture(value: unknown): value is MaterialTexture {
    return value instanceof Texture;
}

class TextureOptionBuilder {
    private readonly uvTypes = new Set<0 | 1>();
    private option: ShaderOptions = {};

    reset(option: ShaderOptions): this {
        this.option = option;
        this.uvTypes.clear();
        return this;
    }

    add(texture: unknown, optionName: string, callback?: () => void): this {
        if (!(texture instanceof Texture)) return this;
        const uv = texture.uv || 0;
        this.uvTypes.add(uv);
        this.option[optionName] = uv;
        if ('isCubeTexture' in texture && texture.isCubeTexture === true) {
            this.option[`${optionName}_CUBE`] = 1;
        }
        callback?.();
        return this;
    }

    update(): this {
        for (const uv of this.uvTypes) {
            this.option[`HAS_TEXCOORD${String(uv)}`] = 1;
        }
        return this;
    }
}
/**
 * 材质基类，一般不直接使用
 */
class Material {
    readonly isMaterial = true;
    readonly className: string = 'Material';
    onBeforeCompile: MaterialBeforeCompile | null = null;
    /**
     * name
     */
    name: string | null = null;
    /**
     * shader cache id
     */
    shaderCacheId: string | null = null;
    /**
     * shader name，会在 shader 中加个 SHADER_NAME 宏，不填用 className 代替。
     */
    shaderName: string | null = null;
    /**
     * 光照类型
     */
    lightType = 'NONE';
    /**
     * 是否开启网格模式
     */
    wireframe = false;
    /**
     * front face winding orientation
     */
    frontFace = CCW;
    /**
     * 是否开启深度测试
     */
    depthTest = true;
    /**
     * SAMPLE_ALPHA_TO_COVERAGE
     */
    sampleAlphaToCoverage = false;
    /**
     * 是否开启depthMask
     */
    depthMask = true;
    /**
     * 深度测试Range
     */
    depthRange: [number, number] = [0, 1];
    /**
     * 深度测试方法
     */
    depthFunc = LEQUAL;
    private _cullFace = true;
    /**
     * 法线贴图
     */
    normalMap: Texture | null = null;
    /**
     * 视差贴图
     */
    parallaxMap: Texture | null = null;
    emission: MaterialTextureValue = null;
    /**
     * 法线贴图scale
     */
    normalMapScale = 1;
    /**
     * 是否忽略透明度
     */
    ignoreTransparent = false;
    /**
     * 是否开启 gamma 矫正
     */
    gammaCorrection = false;
    /**
     * 是否使用物理灯光
     */
    usePhysicsLight = false;
    /**
     * 是否环境贴图和环境光同时生效
     */
    isDiffuseEnvAndAmbientLightWorkTogether = false;
    /**
     * 用户数据
     */
    userData: unknown = null;
    /**
     * 渲染顺序数字小的先渲染（透明物体和不透明在不同的队列）
     */
    renderOrder = 0;
    private _premultiplyAlpha = true;
    /**
     * 是否预乘 alpha
     */
    get premultiplyAlpha(): boolean {
        return this._premultiplyAlpha;
    }
    /**
     * 是否预乘 alpha
     */
    set premultiplyAlpha(value: boolean) {
        this._premultiplyAlpha = value;
        if (this.transparent) {
            this.setDefaultTransparentBlend();
        }
    }
    /**
     * gamma值
     */
    gammaFactor = 2.2;
    /**
     * 是否投射阴影
     */
    castShadows = true;
    /**
     * 是否接受阴影
     */
    receiveShadows = true;
    /**
     * uv transform eg:new Matrix3().fromRotationTranslationScale(Math.PI/2, 0, 0, 2, 2)
     */
    uvMatrix: Matrix3 | null = null;
    /**
     * uv1 transform eg:new Matrix3().fromRotationTranslationScale(Math.PI/2, 0, 0, 2, 2)
     */
    uvMatrix1: Matrix3 | null = null;
    /**
     * 是否开启 CullFace
     */
    get cullFace(): boolean {
        return this._cullFace;
    }
    /**
     * 是否开启 CullFace
     */
    set cullFace(value: boolean) {
        this._cullFace = value;
        if (value) {
            this.cullFaceType = this._cullFaceType;
        } else {
            this._side = FRONT_AND_BACK;
        }
    }
    private _cullFaceType = BACK;
    /**
     * CullFace 类型
     */
    get cullFaceType(): GLenum {
        return this._cullFaceType;
    }
    /**
     * CullFace 类型
     */
    set cullFaceType(value: GLenum) {
        this._cullFaceType = value;
        if (this._cullFace) {
            if (value === BACK) {
                this._side = FRONT;
            } else if (value === FRONT) {
                this._side = BACK;
            }
        }
    }
    private _side = FRONT;
    /**
     * 显示面，可选值 FRONT, BACK, FRONT_AND_BACK
     */
    get side(): GLenum {
        return this._side;
    }
    /**
     * 显示面，可选值 FRONT, BACK, FRONT_AND_BACK
     */
    set side(value: GLenum) {
        if (this._side !== value) {
            this._side = value;
            if (value === FRONT_AND_BACK) {
                this._cullFace = false;
            } else {
                this._cullFace = true;
                if (value === FRONT) {
                    this._cullFaceType = BACK;
                } else if (value === BACK) {
                    this._cullFaceType = FRONT;
                }
            }
        }
    }
    /**
     * 是否开启颜色混合
     */
    blend = false;
    /**
     * 颜色混合方式
     */
    blendEquation = FUNC_ADD;
    /**
     * 透明度混合方式
     */
    blendEquationAlpha = FUNC_ADD;
    /**
     * 颜色混合来源比例
     */
    blendSrc = ONE;
    /**
     * 颜色混合目标比例
     */
    blendDst = ZERO;
    /**
     * 透明度混合来源比例
     */
    blendSrcAlpha = ONE;
    /**
     * 透明度混合目标比例
     */
    blendDstAlpha = ZERO;
    /**
     * stencilTest
     */
    stencilTest = false;
    /**
     * stencilMask
     */
    stencilMask = 0xff;
    /**
     * stencilFunc func
     */
    stencilFunc = ALWAYS;
    /**
     * stencilFunc ref
     */
    stencilFuncRef = 1;
    /**
     * stencilFunc mask
     */
    stencilFuncMask = 0xff;
    /**
     * stencilOp fail
     */
    stencilOpFail = KEEP;
    /**
     * stencilOp zfail
     */
    stencilOpZFail = KEEP;
    /**
     * stencilOp zpass
     */
    stencilOpZPass = KEEP;
    /**
     * 当前是否需要强制更新
     */
    isDirty = false;
    /**
     * 透明度 0~1
     */
    transparency: number | Texture = 1;
    private _transparent = false;
    /**
     * 是否需要透明
     */
    get transparent(): boolean {
        return this._transparent;
    }
    /**
     * 是否需要透明
     */
    set transparent(value: boolean) {
        if (this._transparent !== value) {
            this._transparent = value;
            if (!value) {
                this.blend = false;
                this.depthMask = true;
            } else {
                this.setDefaultTransparentBlend();
            }
        }
    }
    setDefaultTransparentBlend(): void {
        this.blend = true;
        this.depthMask = false;
        if (this.premultiplyAlpha) {
            this.blendSrc = ONE;
            this.blendDst = ONE_MINUS_SRC_ALPHA;
            this.blendSrcAlpha = ONE;
            this.blendDstAlpha = ONE_MINUS_SRC_ALPHA;
        } else {
            this.blendSrc = SRC_ALPHA;
            this.blendDst = ONE_MINUS_SRC_ALPHA;
            this.blendSrcAlpha = SRC_ALPHA;
            this.blendDstAlpha = ONE_MINUS_SRC_ALPHA;
        }
    }
    /**
     * 透明度剪裁，如果渲染的颜色透明度大于等于这个值的话渲染为完全不透明，否则渲染为完全透明
     */
    alphaCutoff = 0;
    /**
     * 是否使用HDR
     */
    useHDR = false;
    /**
     * 曝光度，仅在 useHDR 为 true 时生效
     */
    exposure = 1;
    /**
     * 是否开启 texture lod
     */
    enableTextureLod = false;
    /**
     * 是否开启 drawBuffers
     */
    enableDrawBuffers = false;
    /**
     * 是否需要加基础 uniforms
     */
    needBasicUniforms = true;
    /**
     * 是否需要加基础 attributes
     */
    needBasicAttributes = true;
    readonly id: string;
    /**
     * Semantic resolvers for canonical block fields and sampler bindings. Program linking rejects
     * every active classic uniform that is not an opaque sampler.
     */
    uniforms: MaterialBindingMap = {};
    attributes: MaterialBindingMap = {};
    /** Registered std140 blocks keyed by GLSL block name. */
    uniformBlocks: Record<string, UniformBuffer> = {};
    protected readonly textureOption = new TextureOptionBuilder();
    private _instancedUniforms: InstancedUniform[] | null = null;
    private bindingsInitialized = false;
    /**
     * @param params - 初始化参数，所有params都会复制到实例上
     */
    constructor(params: MaterialParameters = {}, initializeBindings = true) {
        this.id = math.generateUUID(this.className);
        Object.assign(this, params);
        if (initializeBindings) this.initializeBindings();
    }

    protected initializeBindings(): void {
        if (this.bindingsInitialized) return;
        this.bindingsInitialized = true;
        if (this.needBasicAttributes) {
            this.addBasicAttributes();
        }
        if (this.needBasicUniforms) {
            this.addBasicUniforms();
        }
    }
    /**
     * 增加基础 attributes
     */
    addBasicAttributes(): void {
        const attributes = this.attributes;
        this.copyBindings(attributes, {
            a_position: 'POSITION',
            a_normal: 'NORMAL',
            a_tangent: 'TANGENT',
            a_texcoord0: 'TEXCOORD_0',
            a_texcoord1: 'TEXCOORD_1',
            a_color: 'COLOR_0',
            a_skinIndices: 'SKININDICES',
            a_skinWeights: 'SKINWEIGHTS'
        });
        ['POSITION', 'NORMAL', 'TANGENT'].forEach(name => {
            const camelName = name.slice(0, 1) + name.slice(1).toLowerCase();
            for (let i = 0; i < 8; i++) {
                const morphAttributeName = `a_morph${camelName}${String(i)}`;
                attributes[morphAttributeName] ??= `MORPH${name}${String(i)}`;
            }
        });
    }
    /**
     * 增加基础 uniforms
     */
    addBasicUniforms(): void {
        this.copyBindings(this.uniforms, {
            u_modelMatrix: 'MODEL',
            u_viewMatrix: 'VIEW',
            u_projectionMatrix: 'PROJECTION',
            u_modelViewMatrix: 'MODELVIEW',
            u_modelViewProjectionMatrix: 'MODELVIEWPROJECTION',
            u_viewInverseNormalMatrix: 'VIEWINVERSEINVERSETRANSPOSE',
            u_normalMatrix: 'MODELVIEWINVERSETRANSPOSE',
            u_normalWorldMatrix: 'MODELINVERSETRANSPOSE',
            u_cameraPosition: 'CAMERAPOSITION',
            u_rendererSize: 'RENDERERSIZE',
            u_logDepth: 'LOGDEPTH',
            // light
            u_ambientLightsColor: 'AMBIENTLIGHTSCOLOR',
            u_directionalLightsColor: 'DIRECTIONALLIGHTSCOLOR',
            u_directionalLightsInfo: 'DIRECTIONALLIGHTSINFO',
            u_directionalLightsShadowMap: 'DIRECTIONALLIGHTSSHADOWMAP',
            u_directionalLightsShadowMapSize: 'DIRECTIONALLIGHTSSHADOWMAPSIZE',
            u_directionalLightsShadowBias: 'DIRECTIONALLIGHTSSHADOWBIAS',
            u_directionalLightSpaceMatrix: 'DIRECTIONALLIGHTSPACEMATRIX',
            u_pointLightsPos: 'POINTLIGHTSPOS',
            u_pointLightsColor: 'POINTLIGHTSCOLOR',
            u_pointLightsInfo: 'POINTLIGHTSINFO',
            u_pointLightsRange: 'POINTLIGHTSRANGE',
            u_pointLightsShadowBias: 'POINTLIGHTSSHADOWBIAS',
            u_pointLightsShadowMap: 'POINTLIGHTSSHADOWMAP',
            u_pointLightSpaceMatrix: 'POINTLIGHTSPACEMATRIX',
            u_pointLightCamera: 'POINTLIGHTCAMERA',
            u_spotLightsPos: 'SPOTLIGHTSPOS',
            u_spotLightsDir: 'SPOTLIGHTSDIR',
            u_spotLightsColor: 'SPOTLIGHTSCOLOR',
            u_spotLightsCutoffs: 'SPOTLIGHTSCUTOFFS',
            u_spotLightsInfo: 'SPOTLIGHTSINFO',
            u_spotLightsRange: 'SPOTLIGHTSRANGE',
            u_spotLightsShadowMap: 'SPOTLIGHTSSHADOWMAP',
            u_spotLightsShadowMapSize: 'SPOTLIGHTSSHADOWMAPSIZE',
            u_spotLightsShadowBias: 'SPOTLIGHTSSHADOWBIAS',
            u_spotLightSpaceMatrix: 'SPOTLIGHTSPACEMATRIX',
            u_areaLightsPos: 'AREALIGHTSPOS',
            u_areaLightsColor: 'AREALIGHTSCOLOR',
            u_areaLightsWidth: 'AREALIGHTSWIDTH',
            u_areaLightsHeight: 'AREALIGHTSHEIGHT',
            u_areaLightsLtcTexture1: 'AREALIGHTSLTCTEXTURE1',
            u_areaLightsLtcTexture2: 'AREALIGHTSLTCTEXTURE2',
            // joint
            u_jointMat: 'JOINTMATRIX',
            // quantization
            u_positionDecodeMat: 'POSITIONDECODEMAT',
            u_normalDecodeMat: 'NORMALDECODEMAT',
            u_uvDecodeMat: 'UVDECODEMAT',
            u_uv1DecodeMat: 'UV1DECODEMAT',
            // morph
            u_morphWeights: 'MORPHWEIGHTS',
            u_normalMapScale: 'NORMALMAPSCALE',
            u_emissionColor: 'EMISSION',
            u_transparencyFactor: 'TRANSPARENCY',
            // uv matrix
            u_uvMatrix: 'UVMATRIX_0',
            u_uvMatrix1: 'UVMATRIX_1',
            // other info
            u_fogColor: 'FOGCOLOR',
            u_fogInfo: 'FOGINFO',
            u_alphaCutoff: 'ALPHACUTOFF',
            u_exposure: 'EXPOSURE',
            u_gammaFactor: 'GAMMAFACTOR'
        });
        this.addTextureUniforms({
            u_normalMap: 'NORMALMAP',
            u_parallaxMap: 'PARALLAXMAP',
            u_emission: 'EMISSION',
            u_transparency: 'TRANSPARENCY'
        });
    }
    /**
     * 增加贴图 uniforms
     * @param textureUniforms - textureName:semanticName 键值对
     */
    addTextureUniforms(textureUniforms: Readonly<Record<string, string>>): void {
        const uniforms: MaterialBindingMap = {};
        for (const [uniformName, semanticName] of Object.entries(textureUniforms)) {
            uniforms[uniformName] = semanticName;
            uniforms[`${uniformName}.texture`] = semanticName;
            uniforms[`${uniformName}.uv`] = `${semanticName}UV`;
        }
        this.copyBindings(this.uniforms, uniforms);
    }
    /**
     * 获取渲染选项值
     * @param option - 渲染选项值
     * @returns 渲染选项值
     */
    getRenderOption(option: ShaderOptions = {}): ShaderOptions {
        const lightType = this.lightType;
        option[`LIGHT_TYPE_${lightType}`] = 1;
        option['SIDE'] = this.side;
        if (lightType !== 'NONE') {
            option['HAS_LIGHT'] = 1;
        }
        if (this.premultiplyAlpha) {
            option['PREMULTIPLY_ALPHA'] = 1;
        }
        if (this.enableTextureLod) {
            option['USE_SHADER_TEXTURE_LOD'] = 1;
        }
        if (this.enableDrawBuffers) {
            option['USE_DRAW_BUFFERS'] = 1;
        }
        const textureOption = this.textureOption.reset(option);
        if (option['HAS_LIGHT']) {
            option['HAS_NORMAL'] = 1;
            textureOption.add(this.normalMap, 'NORMAL_MAP', () => {
                if (this.normalMapScale !== 1) {
                    option['NORMAL_MAP_SCALE'] = 1;
                }
            });
        }
        textureOption.add(this.parallaxMap, 'PARALLAX_MAP');
        textureOption.add(this.emission, 'EMISSION_MAP');
        textureOption.add(this.transparency, 'TRANSPARENCY_MAP');
        if (this.ignoreTransparent) {
            option['IGNORE_TRANSPARENT'] = 1;
        }
        if (this.alphaCutoff > 0) {
            option['ALPHA_CUTOFF'] = 1;
        }
        if (this.useHDR) {
            option['USE_HDR'] = 1;
        }
        if (this.gammaCorrection) {
            option['GAMMA_CORRECTION'] = 1;
        }
        if (this.receiveShadows) {
            option['RECEIVE_SHADOWS'] = 1;
        }
        if (this.castShadows) {
            option['CAST_SHADOWS'] = 1;
        }
        if (this.uvMatrix) {
            option['UV_MATRIX'] = 1;
        }
        if (this.uvMatrix1) {
            option['UV_MATRIX1'] = 1;
        }
        if (this.usePhysicsLight) {
            option['USE_PHYSICS_LIGHT'] = 1;
        }
        if (this.isDiffuseEnvAndAmbientLightWorkTogether) {
            option['IS_DIFFUSE_ENV_AND_AMBIENT_LIGHT_WORK_TOGETHER'] = 1;
        }
        textureOption.update();
        return option;
    }
    /**
     * 获取 instanced uniforms
     */
    getInstancedUniforms(): InstancedUniform[] {
        let instancedUniforms = this._instancedUniforms;
        if (!this._instancedUniforms) {
            const uniforms = this.uniforms;
            instancedUniforms = this._instancedUniforms = [];
            for (const name in uniforms) {
                const info = this.getUniformInfo(name);
                if (info.isDependMesh && !info.notSupportInstanced) {
                    instancedUniforms.push({
                        name,
                        info
                    });
                }
            }
        }
        return instancedUniforms ?? [];
    }
    getUniformData(name: string, mesh: Mesh, programInfo: ProgramBindingInfo): unknown {
        return this.getUniformInfo(name).get(mesh, this, programInfo);
    }
    getAttributeData(name: string, mesh: Mesh, programInfo: ProgramBindingInfo): unknown {
        return this.getAttributeInfo(name).get(mesh, this, programInfo);
    }
    getUniformInfo(name: string): MaterialBindingInfo {
        return this.getInfo('uniforms', name);
    }
    getAttributeInfo(name: string): MaterialBindingInfo {
        return this.getInfo('attributes', name);
    }
    private getInfo(dataType: 'uniforms' | 'attributes', name: string): MaterialBindingInfo {
        const dataDict = this[dataType];
        let info = dataDict[name];
        if (typeof info === 'string') {
            const semanticInfo: unknown = Reflect.get(semantic, info);
            if (!isBindingInfo(semanticInfo)) {
                throw new Error(
                    `Material ${dataType} binding ${name} references unknown semantic ${info}`
                );
            }
            info = semanticInfo;
        }
        if (!isBindingInfo(info)) {
            throw new Error(`Material has no ${dataType} binding named ${name}`);
        }
        return info;
    }
    /**
     * clone 当前Material
     * @returns 返回clone的Material
     */
    clone(): Material {
        const Constructor = this.constructor as MaterialConstructor;
        const newMaterial = new Constructor();
        const internalKeys = new Set([
            'id',
            'textureOption',
            '_instancedUniforms',
            'bindingsInitialized'
        ]);
        for (const [key, value] of Object.entries(this)) {
            if (!internalKeys.has(key)) Reflect.set(newMaterial, key, value);
        }
        newMaterial.uniforms = { ...this.uniforms };
        newMaterial.attributes = { ...this.attributes };
        newMaterial.uniformBlocks = { ...this.uniformBlocks };
        return newMaterial;
    }
    /**
     * 销毁贴图
     * @returns this
     */
    destroyTextures(): void {
        this.getTextures().forEach(texture => {
            texture.destroy();
        });
    }
    /**
     * 获取材质全部贴图
     */
    getTextures(): MaterialTexture[] {
        return Object.values(this).filter(isMaterialTexture);
    }
    /**
     * 复制属性，只有没属性时才会覆盖
     * @param origin -
     * @param data -
     */
    protected copyBindings(origin: MaterialBindingMap, data: Readonly<MaterialBindingMap>): void {
        for (const [key, value] of Object.entries(data)) {
            origin[key] ??= value;
        }
        this._instancedUniforms = null;
    }
    /**
     * 获取阴影材质，子类可重写
     * @param shadowMaterial - 通用阴影材质
     */
    getShadowMaterial(shadowMaterial: Material): Material {
        if (shadowMaterial.side !== this.side) {
            shadowMaterial.side = this.side;
            shadowMaterial.isDirty = true;
        }
        if (shadowMaterial.frontFace !== this.frontFace) {
            shadowMaterial.frontFace = this.frontFace;
            shadowMaterial.isDirty = true;
        }
        return shadowMaterial;
    }
}
export default Material;
