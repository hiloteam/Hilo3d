import DataTexture from '../texture/DataTexture';
import Vector3 from '../math/Vector3';
import Matrix3 from '../math/Matrix3';
import Matrix4 from '../math/Matrix4';
import { UNSIGNED_BYTE } from '../constants/webgl';
import Texture, { type TextureBinding, type TextureWebGLState } from '../texture/Texture';
import Color from '../math/Color';
import type Camera from '../camera/Camera';
import type Fog from '../core/Fog';
import type Mesh from '../core/Mesh';
import type Geometry from '../geometry/Geometry';
import MorphGeometry from '../geometry/MorphGeometry';
import type LightManager from '../light/LightManager';
import type SphericalHarmonics3 from '../math/SphericalHarmonics3';
import type Material from './Material';
import type { MaterialTexture, MaterialTextureValue, ProgramBindingInfo } from './Material';
import type { GLContext } from '../renderer/types';

const tempVector3 = new Vector3();
const tempMatrix3 = new Matrix3();
const tempMatrix4 = new Matrix4();
const tempFloat32Array4 = new Float32Array([0.5, 0.5, 0.5, 1]);
const tempFloat32Array2 = new Float32Array([0, 0]);
const blankInfo = {
    get(
        _mesh: SemanticMesh,
        _material: SemanticMaterial,
        _programInfo: ProgramBindingInfo
    ): undefined {
        return undefined;
    }
};

export interface SemanticRenderer {
    width: number;
    height: number;
}

export interface SemanticMesh extends Mesh {
    geometry: Geometry;
    isSkinedMesh: boolean;
    jointMatTexture: DataTexture | null;
    getJointMat(): Float32Array;
    initJointMatTexture(): DataTexture;
    updateJointMatTexture(): void;
}

export interface SemanticMaterial extends Material {
    baseColor: Color;
    baseColorMap: Texture | null;
    brdfLUT: Texture | null;
    clearcoatFactor: number;
    clearcoatMap: Texture | null;
    clearcoatNormalMap: Texture | null;
    clearcoatRoughnessFactor: number;
    clearcoatRoughnessMap: Texture | null;
    diffuse: MaterialTextureValue;
    ambient: MaterialTextureValue;
    specular: MaterialTextureValue;
    diffuseEnvIntensity: number;
    diffuseEnvMap: MaterialTexture | null;
    diffuseEnvSphereHarmonics3: SphericalHarmonics3 | null;
    emissionFactor: Color;
    glossiness: number;
    lightMap: Texture | null;
    metallic: number;
    metallicMap: Texture | null;
    metallicRoughnessMap: Texture | null;
    occlusionMap: Texture | null;
    occlusionStrength: number;
    reflectivity: number;
    refractRatio: number;
    refractivity: number;
    roughness: number;
    roughnessMap: Texture | null;
    shininess: number;
    specularEnvIntensity: number;
    specularEnvMap: MaterialTexture | null;
    specularEnvMatrix: Matrix4 | null;
    specularGlossinessMap: Texture | null;
    [property: string]: unknown;
}

function nullable<Value>(value: Value | null): Value | null {
    return value;
}

function textureIndex(programInfo: ProgramBindingInfo): number {
    return programInfo.textureIndex ?? 0;
}

function cameraPlane(camera: Camera, plane: 'near' | 'far'): number {
    const value: unknown = Reflect.get(camera, plane);
    if (typeof value !== 'number')
        throw new TypeError(`Camera does not expose a numeric ${plane} plane`);
    return value;
}

interface SemanticEntry {
    readonly isDependMesh?: boolean;
    readonly notSupportInstanced?: boolean;
    get(mesh: SemanticMesh, material: SemanticMaterial, programInfo: ProgramBindingInfo): unknown;
}

function materialColorOrTexture(material: SemanticMaterial, name: string): MaterialTextureValue {
    const value: unknown = Reflect.get(material, name);
    return value instanceof Texture || value instanceof Color ? value : null;
}

function materialTexture(material: SemanticMaterial, name: string): Texture | null {
    const value: unknown = Reflect.get(material, name);
    return value instanceof Texture ? value : null;
}

let camera: Camera;
let gl: GLContext;
let lightManager: LightManager;
let state: TextureWebGLState;
let fog: Fog | null;
let renderer: SemanticRenderer;

/**
 * 语义
 */
const semantic = {
    state: nullable<TextureWebGLState>(null),

    camera: nullable<Camera>(null),

    lightManager: nullable<LightManager>(null),

    fog: nullable<Fog>(null),

    gl: nullable<GLContext>(null),
    /**
     * WebGLRenderer
     */
    renderer: nullable<SemanticRenderer>(null),

    blankInfo,

    /**
     * 初始化
     * @param _state -
     * @param _camera -
     * @param _lightManager -
     * @param _fog -
     */
    init(
        _renderer: SemanticRenderer,
        _state: TextureWebGLState,
        _camera: Camera,
        _lightManager: LightManager,
        _fog: Fog | null
    ): void {
        renderer = this.renderer = _renderer;
        state = this.state = _state;
        camera = this.camera = _camera;
        lightManager = this.lightManager = _lightManager;
        fog = this.fog = _fog;
        gl = this.gl = state.gl;
    },

    /**
     * 设置相机
     * @param _camera -
     */
    setCamera(_camera: Camera): void {
        camera = this.camera = _camera;
    },

    /**
     * @param value -
     * @param unitIndex - textureIndex(programInfo)
     */
    handlerColorOrTexture(
        value: MaterialTextureValue,
        unitIndex: number
    ): Float32Array | number | undefined {
        if (value instanceof Texture) {
            return this.handlerTexture(value, unitIndex);
        }

        if (value instanceof Color) {
            value.toArray(tempFloat32Array4);
        } else {
            tempFloat32Array4[0] = tempFloat32Array4[1] = tempFloat32Array4[2] = 0.5;
        }

        return tempFloat32Array4;
    },

    /**
     * @param value -
     * @param unitIndex - textureIndex(programInfo)
     */
    handlerTexture(value: TextureBinding | null, unitIndex: number): number | undefined {
        if (value) {
            return this.handlerGLTexture(value.target, value.getGLTexture(state), unitIndex);
        }

        const blankTexture = this.getBlankTexture();
        return this.handlerGLTexture(
            blankTexture.target,
            blankTexture.getGLTexture(state),
            unitIndex
        );
    },

    /**
     * @param target -
     * @param texture -
     * @param unitIndex - textureIndex(programInfo)
     */
    handlerGLTexture(target: GLenum, texture: WebGLTexture, unitIndex: number): number | undefined {
        state.activeTexture(gl.TEXTURE0 + unitIndex);
        state.bindTexture(target, texture);
        return unitIndex;
    },

    /**
     * @param texture -
     * @returns uv
     */
    handlerUV(texture: unknown): number {
        if (texture instanceof Texture) {
            return texture.uv;
        }

        return 0;
    },

    _blankTexture: nullable<DataTexture>(null),
    getBlankTexture(): DataTexture {
        this._blankTexture ??= new DataTexture({
            width: 2,
            height: 2,
            type: UNSIGNED_BYTE,
            image: new Uint8Array([
                128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128
            ])
        });

        return this._blankTexture;
    },

    // attributes

    POSITION: {
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return mesh.geometry.vertices;
        }
    },

    NORMAL: {
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return mesh.geometry.normals;
        }
    },

    TANGENT: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            const normalMap = material.normalMap ?? material.clearcoatNormalMap;
            if (normalMap?.uv === 1) {
                return mesh.geometry.tangents1;
            }
            return mesh.geometry.tangents;
        }
    },

    TEXCOORD_0: {
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            if (!mesh.geometry.uvs) {
                return undefined;
            }
            return mesh.geometry.uvs;
        }
    },

    TEXCOORD_1: {
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            if (!mesh.geometry.uvs1) {
                return undefined;
            }
            return mesh.geometry.uvs1;
        }
    },

    UVMATRIX_0: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            if (!material.uvMatrix) {
                return undefined;
            }
            return material.uvMatrix.elements;
        }
    },

    UVMATRIX_1: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            if (!material.uvMatrix1) {
                return undefined;
            }
            return material.uvMatrix1.elements;
        }
    },

    CAMERAFAR: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            if (camera.isPerspectiveCamera) {
                return cameraPlane(camera, 'far');
            }
            return undefined;
        }
    },

    CAMERANEAR: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            if (camera.isPerspectiveCamera) {
                return cameraPlane(camera, 'near');
            }
            return undefined;
        }
    },

    CAMERATYPE: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            if (camera.isPerspectiveCamera) {
                return 1;
            }
            return 0;
        }
    },

    CAMERAPOSITION: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return camera.worldMatrix.getTranslation(tempVector3).elements;
        }
    },

    COLOR_0: {
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            if (!mesh.geometry.colors) {
                return undefined;
            }
            return mesh.geometry.colors;
        }
    },

    SKININDICES: {
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return mesh.geometry.skinIndices;
        }
    },

    JOINT: {
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return mesh.geometry.skinIndices;
        }
    },

    WEIGHT: {
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return mesh.geometry.skinWeights;
        }
    },

    SKINWEIGHTS: {
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return mesh.geometry.skinWeights;
        }
    },

    // uniforms

    RENDERERSIZE: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            tempFloat32Array2[0] = renderer.width;
            tempFloat32Array2[1] = renderer.height;
            return tempFloat32Array2;
        }
    },

    LOCAL: {
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return mesh.matrix.elements;
        },
        isDependMesh: true
    },

    MODEL: {
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return mesh.worldMatrix.elements;
        },
        isDependMesh: true
    },

    VIEW: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return camera.viewMatrix.elements;
        }
    },

    PROJECTION: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return camera.projectionMatrix.elements;
        }
    },

    VIEWPROJECTION: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return camera.viewProjectionMatrix.elements;
        }
    },

    MODELVIEW: {
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return camera.getModelViewMatrix(mesh, tempMatrix4).elements;
        },
        isDependMesh: true
    },

    MODELVIEWPROJECTION: {
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return camera.getModelProjectionMatrix(mesh, tempMatrix4).elements;
        },
        isDependMesh: true
    },

    MODELINVERSE: {
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return tempMatrix4.invert(mesh.worldMatrix).elements;
        },
        isDependMesh: true
    },

    VIEWINVERSE: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return camera.worldMatrix.elements;
        }
    },

    VIEWINVERSEINVERSETRANSPOSE: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return tempMatrix3.normalFromMat4(camera.worldMatrix).elements;
        }
    },

    PROJECTIONINVERSE: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return tempMatrix4.invert(camera.projectionMatrix).elements;
        }
    },

    MODELVIEWINVERSE: {
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return tempMatrix4.invert(camera.getModelViewMatrix(mesh, tempMatrix4)).elements;
        },
        isDependMesh: true
    },

    MODELVIEWPROJECTIONINVERSE: {
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return tempMatrix4.invert(camera.getModelProjectionMatrix(mesh, tempMatrix4)).elements;
        },
        isDependMesh: true
    },

    MODELINVERSETRANSPOSE: {
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return tempMatrix3.normalFromMat4(mesh.worldMatrix).elements;
        },
        isDependMesh: true
    },

    MODELVIEWINVERSETRANSPOSE: {
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return tempMatrix3.normalFromMat4(camera.getModelViewMatrix(mesh, tempMatrix4))
                .elements;
        },
        isDependMesh: true
    },

    /**
     * 还未实现，不要使用
     */
    VIEWPORT: undefined,

    JOINTMATRIX: {
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            if (mesh.isSkinedMesh) {
                return mesh.getJointMat();
            }
            throw new TypeError(
                `Semantic JOINTMATRIX requires a skinned mesh; received ${mesh.id}`
            );
        },
        isDependMesh: true,
        notSupportInstanced: true
    },

    JOINTMATRIXTEXTURE: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            programInfo: ProgramBindingInfo
        ): unknown {
            if (mesh.isSkinedMesh) {
                mesh.updateJointMatTexture();
                return semantic.handlerTexture(mesh.jointMatTexture, textureIndex(programInfo));
            }
            throw new TypeError(
                `Semantic JOINTMATRIXTEXTURE requires a skinned mesh; received ${mesh.id}`
            );
        },
        isDependMesh: true,
        notSupportInstanced: true
    },

    JOINTMATRIXTEXTURESIZE: {
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            if (mesh.isSkinedMesh) {
                const jointTexture = mesh.initJointMatTexture();
                return [jointTexture.width, jointTexture.height];
            }
            throw new TypeError(
                `Semantic JOINTMATRIXTEXTURESIZE requires a skinned mesh; received ${mesh.id}`
            );
        },
        isDependMesh: true,
        notSupportInstanced: true
    },

    NORMALMAPSCALE: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return material.normalMapScale;
        }
    },

    OCCLUSIONSTRENGTH: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return material.occlusionStrength;
        }
    },

    SHININESS: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return material.shininess;
        }
    },

    SPECULARENVMATRIX: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            if (material.specularEnvMatrix && material.specularEnvMap) {
                return material.specularEnvMatrix.elements;
            }
            tempMatrix4.identity();
            return tempMatrix4.elements;
        }
    },

    REFLECTIVITY: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return material.reflectivity;
        }
    },

    REFRACTRATIO: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return material.refractRatio;
        }
    },

    REFRACTIVITY: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return material.refractivity;
        }
    },

    LOGDEPTH: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return 2.0 / (Math.log(cameraPlane(camera, 'far') + 1.0) / Math.LN2);
        }
    },

    // light

    AMBIENTLIGHTSCOLOR: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return lightManager.ambientInfo;
        }
    },

    DIRECTIONALLIGHTSCOLOR: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return lightManager.directionalInfo?.colors;
        }
    },

    DIRECTIONALLIGHTSINFO: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return lightManager.directionalInfo?.infos;
        }
    },

    DIRECTIONALLIGHTSSHADOWMAP: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            programInfo: ProgramBindingInfo
        ): unknown {
            const result = lightManager.directionalInfo?.shadowMap?.map((texture, i) => {
                return semantic.handlerTexture(texture, textureIndex(programInfo) + i);
            });
            return result;
        }
    },

    DIRECTIONALLIGHTSSHADOWMAPSIZE: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return lightManager.directionalInfo?.shadowMapSize;
        }
    },

    DIRECTIONALLIGHTSSHADOWBIAS: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return lightManager.directionalInfo?.shadowBias;
        }
    },

    DIRECTIONALLIGHTSPACEMATRIX: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return lightManager.directionalInfo?.lightSpaceMatrix;
        }
    },

    POINTLIGHTSPOS: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return lightManager.pointInfo?.poses;
        }
    },

    POINTLIGHTSCOLOR: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return lightManager.pointInfo?.colors;
        }
    },

    POINTLIGHTSINFO: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return lightManager.pointInfo?.infos;
        }
    },

    POINTLIGHTSRANGE: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return lightManager.pointInfo?.ranges;
        }
    },

    POINTLIGHTSSHADOWMAP: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            programInfo: ProgramBindingInfo
        ): unknown {
            const result = lightManager.pointInfo?.shadowMap?.map((texture, i) => {
                return semantic.handlerTexture(texture, textureIndex(programInfo) + i);
            });
            return result;
        }
    },

    POINTLIGHTSSHADOWBIAS: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return lightManager.pointInfo?.shadowBias;
        }
    },

    POINTLIGHTSPACEMATRIX: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return lightManager.pointInfo?.lightSpaceMatrix;
        }
    },

    POINTLIGHTCAMERA: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return lightManager.pointInfo?.cameras;
        }
    },

    SPOTLIGHTSPOS: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return lightManager.spotInfo?.poses;
        }
    },

    SPOTLIGHTSDIR: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return lightManager.spotInfo?.dirs;
        }
    },

    SPOTLIGHTSCOLOR: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return lightManager.spotInfo?.colors;
        }
    },

    SPOTLIGHTSCUTOFFS: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return lightManager.spotInfo?.cutoffs;
        }
    },

    SPOTLIGHTSINFO: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return lightManager.spotInfo?.infos;
        }
    },

    SPOTLIGHTSRANGE: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return lightManager.spotInfo?.ranges;
        }
    },

    SPOTLIGHTSSHADOWMAP: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            programInfo: ProgramBindingInfo
        ): unknown {
            const result = lightManager.spotInfo?.shadowMap?.map((texture, i) => {
                return semantic.handlerTexture(texture, textureIndex(programInfo) + i);
            });
            return result;
        }
    },

    SPOTLIGHTSSHADOWMAPSIZE: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return lightManager.spotInfo?.shadowMapSize;
        }
    },

    SPOTLIGHTSSHADOWBIAS: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return lightManager.spotInfo?.shadowBias;
        }
    },

    SPOTLIGHTSPACEMATRIX: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return lightManager.spotInfo?.lightSpaceMatrix;
        }
    },

    AREALIGHTSCOLOR: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return lightManager.areaInfo?.colors;
        }
    },

    AREALIGHTSPOS: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return lightManager.areaInfo?.poses;
        }
    },

    AREALIGHTSWIDTH: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return lightManager.areaInfo?.width;
        }
    },

    AREALIGHTSHEIGHT: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return lightManager.areaInfo?.height;
        }
    },

    AREALIGHTSLTCTEXTURE1: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            programInfo: ProgramBindingInfo
        ): unknown {
            return semantic.handlerTexture(
                lightManager.areaInfo?.ltcTexture1 ?? null,
                textureIndex(programInfo)
            );
        }
    },

    AREALIGHTSLTCTEXTURE2: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            programInfo: ProgramBindingInfo
        ): unknown {
            return semantic.handlerTexture(
                lightManager.areaInfo?.ltcTexture2 ?? null,
                textureIndex(programInfo)
            );
        }
    },

    // fog

    FOGCOLOR: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            if (fog) {
                return fog.color.elements;
            }
            return undefined;
        }
    },

    FOGINFO: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            if (fog) {
                return fog.getInfo();
            }
            return undefined;
        }
    },

    // unQuantize

    POSITIONDECODEMAT: {
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return mesh.geometry.positionDecodeMat;
        },
        isDependMesh: true
    },

    NORMALDECODEMAT: {
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return mesh.geometry.normalDecodeMat;
        },
        isDependMesh: true
    },

    UVDECODEMAT: {
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return mesh.geometry.uvDecodeMat;
        },
        isDependMesh: true
    },
    UV1DECODEMAT: {
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return mesh.geometry.uv1DecodeMat;
        },
        isDependMesh: true
    },

    // pbr

    BASECOLOR: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return material.baseColor.elements;
        }
    },

    /**
     * EMISSION FACTOR
     */
    EMISSIONFACTOR: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return material.emissionFactor.elements;
        }
    },

    METALLIC: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return material.metallic;
        }
    },

    ROUGHNESS: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return material.roughness;
        }
    },

    DIFFUSEENVMAP: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            programInfo: ProgramBindingInfo
        ): unknown {
            return semantic.handlerTexture(material.diffuseEnvMap, textureIndex(programInfo));
        }
    },
    DIFFUSEENVINTENSITY: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return material.diffuseEnvIntensity;
        }
    },

    DIFFUSEENVSPHEREHARMONICS3: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            const sphereHarmonics3 = material.diffuseEnvSphereHarmonics3;
            if (sphereHarmonics3) {
                return sphereHarmonics3.toArray();
            }
            return undefined;
        }
    },

    BRDFLUT: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            programInfo: ProgramBindingInfo
        ): unknown {
            return semantic.handlerTexture(material.brdfLUT, textureIndex(programInfo));
        }
    },

    SPECULARENVMAP: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            programInfo: ProgramBindingInfo
        ): unknown {
            return semantic.handlerTexture(material.specularEnvMap, textureIndex(programInfo));
        }
    },
    SPECULARENVINTENSITY: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return material.specularEnvIntensity;
        }
    },
    SPECULARENVMAPMIPCOUNT: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            const specularEnvMap = material.specularEnvMap;
            if (specularEnvMap) {
                return specularEnvMap.mipmapCount;
            }
            return 1;
        }
    },
    GLOSSINESS: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return material.glossiness;
        }
    },
    ALPHACUTOFF: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return material.alphaCutoff;
        }
    },
    EXPOSURE: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return material.exposure;
        }
    },
    GAMMAFACTOR: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return material.gammaFactor;
        }
    },

    // Morph Animation Uniforms
    MORPHWEIGHTS: {
        isDependMesh: true,
        notSupportInstanced: true,
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            const geometry = mesh.geometry;
            if (!(geometry instanceof MorphGeometry)) {
                return undefined;
            }
            return geometry.weights;
        }
    },

    CLEARCOATFACTOR: {
        isDependMesh: false,
        notSupportInstanced: false,
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return material.clearcoatFactor;
        }
    },

    CLEARCOATROUGHNESSFACTOR: {
        isDependMesh: false,
        notSupportInstanced: false,
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return material.clearcoatRoughnessFactor;
        }
    }
};

function registerSemantic(name: string, entry: SemanticEntry): void {
    Reflect.set(semantic, name, entry);
}

registerSemantic(
    '_TIME',
    (function (): SemanticEntry {
        const startTime = new Date().getTime();
        return {
            isDependMesh: false,
            notSupportInstanced: false,
            get(
                _mesh: SemanticMesh,
                _material: SemanticMaterial,
                _programInfo: ProgramBindingInfo
            ): unknown {
                return (new Date().getTime() - startTime) * 0.001;
            }
        };
    })()
);

// Morph Animation Attributes
const morphAttributes: readonly (readonly [string, string])[] = [
    ['POSITION', 'vertices'],
    ['NORMAL', 'normals'],
    ['TANGENT', 'tangents']
];
for (const [attributeName, targetName] of morphAttributes) {
    for (let i = 0; i < 8; i++) {
        registerSemantic(`MORPH${attributeName}${String(i)}`, {
            get(
                mesh: SemanticMesh,
                _material: SemanticMaterial,
                _programInfo: ProgramBindingInfo
            ): unknown {
                const geometry = mesh.geometry;
                return geometry instanceof MorphGeometry
                    ? geometry.getMorphTarget(targetName, i)
                    : undefined;
            }
        });
    }
}

// Texture or Vector4
const colorOrTextureSemantics: readonly (readonly [string, string])[] = [
    ['DIFFUSE', 'diffuse'],
    ['SPECULAR', 'specular'],
    ['EMISSION', 'emission'],
    ['AMBIENT', 'ambient']
];
for (const [semanticName, textureName] of colorOrTextureSemantics) {
    registerSemantic(semanticName, {
        get(
            _mesh: SemanticMesh,
            material: SemanticMaterial,
            programInfo: ProgramBindingInfo
        ): unknown {
            return semantic.handlerColorOrTexture(
                materialColorOrTexture(material, textureName),
                textureIndex(programInfo)
            );
        }
    });

    registerSemantic(`${semanticName}UV`, {
        get(
            _mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semantic.handlerUV(materialTexture(material, textureName));
        }
    });
}

// Texture
const textureSemantics: readonly (readonly [string, string])[] = [
    ['NORMALMAP', 'normalMap'],
    ['PARALLAXMAP', 'parallaxMap'],
    ['BASECOLORMAP', 'baseColorMap'],
    ['METALLICMAP', 'metallicMap'],
    ['ROUGHNESSMAP', 'roughnessMap'],
    ['METALLICROUGHNESSMAP', 'metallicRoughnessMap'],
    ['OCCLUSIONMAP', 'occlusionMap'],
    ['SPECULARGLOSSINESSMAP', 'specularGlossinessMap'],
    ['LIGHTMAP', 'lightMap'],
    ['CLEARCOATMAP', 'clearcoatMap'],
    ['CLEARCOATROUGHNESSMAP', 'clearcoatRoughnessMap'],
    ['CLEARCOATNORMALMAP', 'clearcoatNormalMap']
];
for (const [semanticName, textureName] of textureSemantics) {
    registerSemantic(semanticName, {
        get(
            _mesh: SemanticMesh,
            material: SemanticMaterial,
            programInfo: ProgramBindingInfo
        ): unknown {
            return semantic.handlerTexture(
                materialTexture(material, textureName),
                textureIndex(programInfo)
            );
        }
    });

    registerSemantic(`${semanticName}UV`, {
        get(
            _mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semantic.handlerUV(materialTexture(material, textureName));
        }
    });
}

// TRANSPARENCY
registerSemantic('TRANSPARENCY', {
    get(_mesh: SemanticMesh, material: SemanticMaterial, programInfo: ProgramBindingInfo): unknown {
        const value: unknown = Reflect.get(material, 'transparency');
        if (value instanceof Texture) {
            return semantic.handlerTexture(value, textureIndex(programInfo));
        }

        if (typeof value === 'number') return value;
        return 1;
    }
});

registerSemantic('TRANSPARENCYUV', {
    get(
        _mesh: SemanticMesh,
        material: SemanticMaterial,
        _programInfo: ProgramBindingInfo
    ): unknown {
        return semantic.handlerUV(materialTexture(material, 'transparency'));
    }
});

/**
 * semantic 对象
 */

export default semantic;
