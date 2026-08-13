import DataTexture from '../texture/DataTexture';
import Vector3 from '../math/Vector3';
import Matrix3 from '../math/Matrix3';
import Matrix4 from '../math/Matrix4';
import { RGBA, UNSIGNED_BYTE } from '../constants/webgl';
import { RGBA8 } from '../constants/webgl2';
import Texture, { type TextureBinding } from '../texture/Texture';
import Color from '../math/Color';
import type Camera from '../camera/Camera';
import type Fog from '../core/Fog';
import type Mesh from '../core/Mesh';
import type Geometry from '../geometry/Geometry';
import MorphGeometry from '../geometry/MorphGeometry';
import type LightManager from '../light/LightManager';
import { getDirectionalCascadeState } from '../light/DirectionalCascadeState';
import type SphericalHarmonics3 from '../math/SphericalHarmonics3';
import type Material from './MaterialInstance';
import type {
    MaterialBindingInfo,
    MaterialTexture,
    MaterialTextureValue,
    ProgramBindingInfo,
    SemanticProgramBindingInfo
} from './MaterialInstance';
import { getMeshPickingIdentity } from '../render/PickingIdentity';
import type { RendererViewport } from '../render/Renderer';
import type { SemanticFrameState } from '../render/frame/SemanticFrameState';
import { MATERIAL_TEXTURE_SLOT_COUNT } from './MaterialTextureSlots';
import type { MaterialTextureChannel, MaterialTextureEncoding } from './MaterialDefinition';
import { MaterialAttributeSemantic } from './MaterialSemantics';

const tempVector3 = new Vector3();
const tempMatrix3 = new Matrix3();
const tempMatrix4 = new Matrix4();
const tempFloat32Array4 = new Float32Array([0.5, 0.5, 0.5, 1]);
const tempFloat32Array2 = new Float32Array([0, 0]);
const activeViewport = new Float32Array(4);
const legacyViewport: [number, number, number, number] = [0, 0, 0, 0];
const materialTextureTransforms = new Float32Array(MATERIAL_TEXTURE_SLOT_COUNT * 9);
const materialTextureInfo = new Float32Array(MATERIAL_TEXTURE_SLOT_COUNT * 4);
const materialTextureChannels = new Int32Array(MATERIAL_TEXTURE_SLOT_COUNT * 4);
const identityTextureTransform = new Matrix3().elements;

function textureEncodingCode(encoding: MaterialTextureEncoding): number {
    return encoding === 'linear' ? 0 : encoding === 'srgb' ? 1 : 2;
}

function textureChannelCode(channel: MaterialTextureChannel): number {
    switch (channel) {
        case 'r':
            return 0;
        case 'g':
            return 1;
        case 'b':
            return 2;
        case 'a':
            return 3;
        case 'zero':
            return 4;
        case 'one':
            return 5;
    }
}

function fillMaterialTextureMetadata(material: Material): void {
    for (let index = 0; index < MATERIAL_TEXTURE_SLOT_COUNT; index += 1) {
        const transformOffset = index * 9;
        for (let component = 0; component < 9; component += 1) {
            materialTextureTransforms[transformOffset + component] =
                identityTextureTransform[component] ?? 0;
        }
        const infoOffset = index * 4;
        materialTextureInfo[infoOffset] = 0;
        materialTextureInfo[infoOffset + 1] = 2;
        materialTextureInfo[infoOffset + 2] = 0;
        materialTextureInfo[infoOffset + 3] = 0;
        materialTextureChannels[infoOffset] = 0;
        materialTextureChannels[infoOffset + 1] = 1;
        materialTextureChannels[infoOffset + 2] = 2;
        materialTextureChannels[infoOffset + 3] = 3;
    }
    for (const slot of material.definition.textureSlots) {
        const binding = material.getTextureSlotByIndex(slot.index);
        const transform = binding?.transform?.elements ?? identityTextureTransform;
        const transformOffset = slot.index * 9;
        for (let component = 0; component < 9; component += 1) {
            materialTextureTransforms[transformOffset + component] = transform[component] ?? 0;
        }
        const infoOffset = slot.index * 4;
        materialTextureInfo[infoOffset] = binding?.uvSet ?? slot.uvSets[0] ?? 0;
        materialTextureInfo[infoOffset + 1] = textureEncodingCode(
            binding?.encoding ?? slot.encoding
        );
        materialTextureInfo[infoOffset + 2] = binding === null ? 0 : 1;
        materialTextureInfo[infoOffset + 3] =
            slot.viewDimension === '2d'
                ? 0
                : slot.viewDimension === 'cube'
                  ? 1
                  : slot.viewDimension === '3d'
                    ? 2
                    : 3;
        const channels = binding?.channels ?? slot.channels;
        for (let component = 0; component < 4; component += 1) {
            const channel = channels[component];
            materialTextureChannels[infoOffset + component] =
                channel === undefined ? component : textureChannelCode(channel);
        }
    }
}
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
    getViewport(): RendererViewport;
}

export interface SemanticMesh extends Mesh {
    geometry: Geometry;
    isSkinnedMesh: boolean;
    getJointMat(): Float32Array;
}

export interface SemanticMaterial extends Material {
    baseColor: Color;
    baseColorMap: Texture | null;
    brdfLUT: Texture | null;
    clearcoatFactor: number;
    clearcoatMap: Texture | null;
    clearcoatNormalMap: Texture | null;
    clearcoatNormalScale: number;
    clearcoatRoughnessFactor: number;
    clearcoatRoughnessMap: Texture | null;
    anisotropyStrength: number;
    anisotropyRotation: number;
    anisotropyMap: Texture | null;
    transmissionFactor: number;
    transmissionMap: Texture | null;
    thicknessFactor: number;
    thicknessMap: Texture | null;
    attenuationDistance: number;
    attenuationColor: Color;
    ior: number;
    iridescenceFactor: number;
    iridescenceMap: Texture | null;
    iridescenceIor: number;
    iridescenceThicknessMinimum: number;
    iridescenceThicknessMaximum: number;
    iridescenceThicknessMap: Texture | null;
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

function writeActiveViewport(viewport: RendererViewport): void {
    const [x, y, width, height] = viewport;
    if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0
    ) {
        throw new RangeError('Renderer viewport must contain finite x/y and positive width/height');
    }
    activeViewport.set(viewport);
    legacyViewport[0] = x;
    legacyViewport[1] = y;
    legacyViewport[2] = width;
    legacyViewport[3] = height;
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

const legacySemanticFrame: {
    renderer: SemanticRenderer | null;
    camera: Camera | null;
    lightManager: LightManager | null;
    fog: Fog | null;
    readonly viewport: RendererViewport;
    readonly viewportData: Float32Array;
} = {
    renderer: null,
    camera: null,
    lightManager: null,
    fog: null,
    viewport: legacyViewport,
    viewportData: activeViewport
};

function semanticFrameFor(programInfo: ProgramBindingInfo | undefined): SemanticFrameState {
    const internalInfo = programInfo as SemanticProgramBindingInfo | undefined;
    if (internalInfo?.semanticFrame) return internalInfo.semanticFrame;
    if (
        legacySemanticFrame.renderer === null ||
        legacySemanticFrame.camera === null ||
        legacySemanticFrame.lightManager === null
    ) {
        throw new Error('Material semantic resolution requires an explicit SemanticFrameState');
    }
    return legacySemanticFrame as SemanticFrameState;
}

function semanticCamera(programInfo: ProgramBindingInfo | undefined): Camera {
    return semanticFrameFor(programInfo).camera;
}

function semanticLights(programInfo: ProgramBindingInfo | undefined): LightManager {
    return semanticFrameFor(programInfo).lightManager;
}

function semanticRenderer(programInfo: ProgramBindingInfo | undefined): SemanticRenderer {
    return semanticFrameFor(programInfo).renderer;
}

/**
 * 语义
 */
const semantic = {
    camera: nullable<Camera>(null),

    lightManager: nullable<LightManager>(null),

    fog: nullable<Fog>(null),

    /** Active backend-neutral renderer dimensions. */
    renderer: nullable<SemanticRenderer>(null),

    blankInfo,

    /**
     * 初始化
     * @param _camera -
     * @param _lightManager -
     * @param _fog -
     */
    init(
        _renderer: SemanticRenderer,
        _camera: Camera,
        _lightManager: LightManager,
        _fog: Fog | null
    ): void {
        legacySemanticFrame.renderer = this.renderer = _renderer;
        legacySemanticFrame.camera = this.camera = _camera;
        legacySemanticFrame.lightManager = this.lightManager = _lightManager;
        legacySemanticFrame.fog = this.fog = _fog;
        writeActiveViewport(_renderer.getViewport());
    },

    /**
     * 设置相机
     * @param _camera -
     */
    setCamera(_camera: Camera): void {
        legacySemanticFrame.camera = this.camera = _camera;
    },

    /** Set the physical-pixel viewport used by the active camera/render pass. */
    setViewport(viewport: RendererViewport): void {
        writeActiveViewport(viewport);
    },

    /**
     * @param value -
     */
    handlerColorOrTexture(value: MaterialTextureValue): Float32Array | TextureBinding {
        if (value instanceof Texture) {
            return this.handlerTexture(value);
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
     */
    handlerTexture(value: TextureBinding | null): TextureBinding {
        return value ?? this.getBlankTexture();
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
            internalFormat: RGBA8,
            format: RGBA,
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
            const normal =
                material.getTextureSlot('normal') ?? material.getTextureSlot('clearcoatNormal');
            if (normal?.uvSet === 1) {
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

    MATERIALTEXTURETRANSFORMS: {
        get(
            _mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            fillMaterialTextureMetadata(material);
            return materialTextureTransforms;
        }
    },

    MATERIALTEXTUREINFO: {
        get(
            mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            fillMaterialTextureMetadata(material);
            return materialTextureInfo;
        }
    },

    MATERIALTEXTURECHANNELS: {
        get(
            _mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            fillMaterialTextureMetadata(material);
            return materialTextureChannels;
        }
    },

    CAMERAFAR: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            const camera = semanticCamera(_programInfo);
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
            const camera = semanticCamera(_programInfo);
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
            if (semanticCamera(_programInfo).isPerspectiveCamera) {
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
            return semanticCamera(_programInfo).worldMatrix.getTranslation(tempVector3).elements;
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
            const renderer = semanticRenderer(_programInfo);
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

    /** Stable per-mesh rgba8unorm identity used by backend-neutral GPU picking passes. */
    OBJECTIDCOLOR: {
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): Float32Array {
            return getMeshPickingIdentity(mesh).color;
        },
        isDependMesh: true,
        notSupportInstanced: true
    },

    VIEW: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semanticCamera(_programInfo).viewMatrix.elements;
        }
    },

    PROJECTION: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semanticCamera(_programInfo).projectionMatrix.elements;
        }
    },

    VIEWPROJECTION: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semanticCamera(_programInfo).viewProjectionMatrix.elements;
        }
    },

    MODELVIEW: {
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semanticCamera(_programInfo).getModelViewMatrix(mesh, tempMatrix4).elements;
        },
        isDependMesh: true
    },

    MODELVIEWPROJECTION: {
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semanticCamera(_programInfo).getModelProjectionMatrix(mesh, tempMatrix4)
                .elements;
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
            return semanticCamera(_programInfo).worldMatrix.elements;
        }
    },

    VIEWINVERSEINVERSETRANSPOSE: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return tempMatrix3.normalFromMat4(semanticCamera(_programInfo).worldMatrix).elements;
        }
    },

    PROJECTIONINVERSE: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return tempMatrix4.invert(semanticCamera(_programInfo).projectionMatrix).elements;
        }
    },

    MODELVIEWINVERSE: {
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return tempMatrix4.invert(
                semanticCamera(_programInfo).getModelViewMatrix(mesh, tempMatrix4)
            ).elements;
        },
        isDependMesh: true
    },

    MODELVIEWPROJECTIONINVERSE: {
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return tempMatrix4.invert(
                semanticCamera(_programInfo).getModelProjectionMatrix(mesh, tempMatrix4)
            ).elements;
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
            return tempMatrix3.normalFromMat4(
                semanticCamera(_programInfo).getModelViewMatrix(mesh, tempMatrix4)
            ).elements;
        },
        isDependMesh: true
    },

    /** Current render-pass viewport as physical-pixel `(x, y, width, height)`. */
    VIEWPORT: {
        get(
            _mesh?: SemanticMesh,
            _material?: SemanticMaterial,
            _programInfo?: ProgramBindingInfo
        ): Float32Array {
            return semanticFrameFor(_programInfo).viewportData;
        }
    },

    JOINTMATRIX: {
        get(
            mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            if (mesh.isSkinnedMesh) {
                return mesh.getJointMat();
            }
            throw new TypeError(
                `Semantic JOINTMATRIX requires a skinned mesh; received ${mesh.id}`
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
            return material.normalScale;
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
            const camera = semanticCamera(_programInfo);
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
            return semanticLights(_programInfo).ambientInfo;
        }
    },

    DIRECTIONALLIGHTSCOLOR: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semanticLights(_programInfo).directionalInfo?.colors;
        }
    },

    SHADOWATLAS: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semantic.handlerTexture(semanticLights(_programInfo).shadowAtlas);
        }
    },

    SHADOWATLASSIZE: {
        get(): unknown {
            return semanticLights(undefined).shadowAtlasSize;
        }
    },

    SHADOWATLASRECTS: {
        get(): unknown {
            return semanticLights(undefined).shadowAtlasRects;
        }
    },

    POINTSHADOWMATRICES: {
        get(): unknown {
            return semanticLights(undefined).pointShadowMatrices;
        }
    },

    DIRECTIONALLIGHTSINFO: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semanticLights(_programInfo).directionalInfo?.infos;
        }
    },

    DIRECTIONALLIGHTSSHADOWMAP: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            const result = semanticLights(_programInfo).directionalInfo?.shadowMap?.map(texture => {
                return semantic.handlerTexture(texture);
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
            return semanticLights(_programInfo).directionalInfo?.shadowMapSize;
        }
    },

    DIRECTIONALLIGHTSSHADOWBIAS: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semanticLights(_programInfo).directionalInfo?.shadowBias;
        }
    },

    DIRECTIONALLIGHTSPACEMATRIX: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semanticLights(_programInfo).directionalInfo?.lightSpaceMatrix;
        }
    },

    POINTLIGHTSPOS: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semanticLights(_programInfo).pointInfo?.poses;
        }
    },

    POINTLIGHTSCOLOR: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semanticLights(_programInfo).pointInfo?.colors;
        }
    },

    POINTLIGHTSINFO: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semanticLights(_programInfo).pointInfo?.infos;
        }
    },

    POINTLIGHTSRANGE: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semanticLights(_programInfo).pointInfo?.ranges;
        }
    },

    POINTLIGHTSSHADOWMAP: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            const result = semanticLights(_programInfo).pointInfo?.shadowMap?.map(texture => {
                return semantic.handlerTexture(texture);
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
            return semanticLights(_programInfo).pointInfo?.shadowBias;
        }
    },

    POINTLIGHTSPACEMATRIX: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semanticLights(_programInfo).pointInfo?.lightSpaceMatrix;
        }
    },

    POINTLIGHTCAMERA: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semanticLights(_programInfo).pointInfo?.cameras;
        }
    },

    SPOTLIGHTSPOS: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semanticLights(_programInfo).spotInfo?.poses;
        }
    },

    SPOTLIGHTSDIR: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semanticLights(_programInfo).spotInfo?.dirs;
        }
    },

    SPOTLIGHTSCOLOR: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semanticLights(_programInfo).spotInfo?.colors;
        }
    },

    SPOTLIGHTSCUTOFFS: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semanticLights(_programInfo).spotInfo?.cutoffs;
        }
    },

    SPOTLIGHTSINFO: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semanticLights(_programInfo).spotInfo?.infos;
        }
    },

    SPOTLIGHTSRANGE: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semanticLights(_programInfo).spotInfo?.ranges;
        }
    },

    SPOTLIGHTSSHADOWMAP: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            const result = semanticLights(_programInfo).spotInfo?.shadowMap?.map(texture => {
                return semantic.handlerTexture(texture);
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
            return semanticLights(_programInfo).spotInfo?.shadowMapSize;
        }
    },

    SPOTLIGHTSSHADOWBIAS: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semanticLights(_programInfo).spotInfo?.shadowBias;
        }
    },

    SPOTLIGHTSPACEMATRIX: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semanticLights(_programInfo).spotInfo?.lightSpaceMatrix;
        }
    },

    AREALIGHTSCOLOR: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semanticLights(_programInfo).areaInfo?.colors;
        }
    },

    AREALIGHTSPOS: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semanticLights(_programInfo).areaInfo?.poses;
        }
    },

    AREALIGHTSWIDTH: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semanticLights(_programInfo).areaInfo?.width;
        }
    },

    AREALIGHTSHEIGHT: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semanticLights(_programInfo).areaInfo?.height;
        }
    },

    AREALIGHTSLTCTEXTURE1: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semantic.handlerTexture(
                semanticLights(_programInfo).areaInfo?.ltcTexture1 ?? null
            );
        }
    },

    AREALIGHTSLTCTEXTURE2: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semantic.handlerTexture(
                semanticLights(_programInfo).areaInfo?.ltcTexture2 ?? null
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
            const fog = semanticFrameFor(_programInfo).fog;
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
            const fog = semanticFrameFor(_programInfo).fog;
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
            _mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semantic.handlerTexture(material.diffuseEnvMap);
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
            _mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semantic.handlerTexture(material.brdfLUT);
        }
    },

    SPECULARENVMAP: {
        get(
            _mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semantic.handlerTexture(material.specularEnvMap);
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
            return material.coverage.mode === 'opaque' ? 0 : material.coverage.cutoff;
        }
    },
    TEMPORALREACTIVEFACTOR: {
        get(
            _mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return material.temporalReactiveFactor;
        }
    },
    EXPOSURE: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return 1;
        }
    },
    GAMMAFACTOR: {
        get(
            _mesh: SemanticMesh,
            _material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return 1;
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
    },

    CLEARCOATNORMALSCALE: {
        get(_mesh: SemanticMesh, material: SemanticMaterial): unknown {
            return material.clearcoatNormalScale;
        }
    },

    ANISOTROPYSTRENGTH: {
        get(_mesh: SemanticMesh, material: SemanticMaterial): unknown {
            return material.anisotropyStrength;
        }
    },

    ANISOTROPYROTATION: {
        get(_mesh: SemanticMesh, material: SemanticMaterial): unknown {
            return material.anisotropyRotation;
        }
    },

    TRANSMISSIONFACTOR: {
        get(_mesh: SemanticMesh, material: SemanticMaterial): unknown {
            return material.transmissionFactor;
        }
    },

    THICKNESSFACTOR: {
        get(_mesh: SemanticMesh, material: SemanticMaterial): unknown {
            return material.thicknessFactor;
        }
    },

    ATTENUATIONDISTANCE: {
        get(_mesh: SemanticMesh, material: SemanticMaterial): unknown {
            return Number.isFinite(material.attenuationDistance) ? material.attenuationDistance : 0;
        }
    },

    ATTENUATIONCOLOR: {
        get(_mesh: SemanticMesh, material: SemanticMaterial): unknown {
            return material.attenuationColor.elements;
        }
    },

    IOR: {
        get(_mesh: SemanticMesh, material: SemanticMaterial): unknown {
            return material.ior;
        }
    },

    IRIDESCENCEFACTOR: {
        get(_mesh: SemanticMesh, material: SemanticMaterial): unknown {
            return material.iridescenceFactor;
        }
    },

    IRIDESCENCEIOR: {
        get(_mesh: SemanticMesh, material: SemanticMaterial): unknown {
            return material.iridescenceIor;
        }
    },

    IRIDESCENCETHICKNESSMINIMUM: {
        get(_mesh: SemanticMesh, material: SemanticMaterial): unknown {
            return material.iridescenceThicknessMinimum;
        }
    },

    IRIDESCENCETHICKNESSMAXIMUM: {
        get(_mesh: SemanticMesh, material: SemanticMaterial): unknown {
            return material.iridescenceThicknessMaximum;
        }
    },

    OPAQUETEXTURE: {
        get(): unknown {
            return semantic.getBlankTexture();
        }
    },

    GTAOTEXTURE: {
        get(): unknown {
            return semantic.getBlankTexture();
        }
    }
};

const invocationScopedBindings = new Map<string, MaterialBindingInfo>([
    [
        'SHADOWATLASSIZE',
        {
            get(_mesh, _material, programInfo): unknown {
                return semanticLights(programInfo).shadowAtlasSize;
            }
        }
    ],
    [
        'SHADOWATLASRECTS',
        {
            get(_mesh, _material, programInfo): unknown {
                return semanticLights(programInfo).shadowAtlasRects;
            }
        }
    ],
    [
        'POINTSHADOWMATRICES',
        {
            get(_mesh, _material, programInfo): unknown {
                return semanticLights(programInfo).pointShadowMatrices;
            }
        }
    ]
]);

/** @internal Resolve legacy zero-argument semantic entries for an invocation-scoped frame. */
export function resolveSemanticBinding(
    name: string,
    publicBinding: MaterialBindingInfo
): MaterialBindingInfo {
    return invocationScopedBindings.get(name) ?? publicBinding;
}

function registerSemantic(name: string, entry: SemanticEntry): void {
    Reflect.set(semantic, name, entry);
}

registerSemantic('DIRECTIONALCASCADESPLITS', {
    get(
        _mesh: SemanticMesh,
        _material: SemanticMaterial,
        programInfo: ProgramBindingInfo
    ): unknown {
        return getDirectionalCascadeState(semanticLights(programInfo))?.directionalCascadeSplits;
    }
});
registerSemantic('DIRECTIONALCASCADEPARAMS', {
    get(
        _mesh: SemanticMesh,
        _material: SemanticMaterial,
        programInfo: ProgramBindingInfo
    ): unknown {
        return getDirectionalCascadeState(semanticLights(programInfo))?.directionalCascadeParams;
    }
});
registerSemantic('DIRECTIONALCASCADEMATRICES', {
    get(
        _mesh: SemanticMesh,
        _material: SemanticMaterial,
        programInfo: ProgramBindingInfo
    ): unknown {
        return getDirectionalCascadeState(semanticLights(programInfo))?.directionalCascadeMatrices;
    }
});

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
    [MaterialAttributeSemantic.POSITION, 'vertices'],
    [MaterialAttributeSemantic.NORMAL, 'normals'],
    [MaterialAttributeSemantic.TANGENT, 'tangents']
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
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semantic.handlerColorOrTexture(materialColorOrTexture(material, textureName));
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
const textureSemantics: readonly (readonly [string, string, string])[] = [
    ['NORMALMAP', 'normalMap', 'normal'],
    ['PARALLAXMAP', 'parallaxMap', 'parallax'],
    ['BASECOLORMAP', 'baseColorMap', 'baseColor'],
    ['METALLICMAP', 'metallicMap', 'metallic'],
    ['ROUGHNESSMAP', 'roughnessMap', 'roughness'],
    ['METALLICROUGHNESSMAP', 'metallicRoughnessMap', 'metallicRoughness'],
    ['OCCLUSIONMAP', 'occlusionMap', 'occlusion'],
    ['SPECULARGLOSSINESSMAP', 'specularGlossinessMap', 'specularGlossiness'],
    ['LIGHTMAP', 'lightMap', 'light'],
    ['CLEARCOATMAP', 'clearcoatMap', 'clearcoat'],
    ['CLEARCOATROUGHNESSMAP', 'clearcoatRoughnessMap', 'clearcoatRoughness'],
    ['CLEARCOATNORMALMAP', 'clearcoatNormalMap', 'clearcoatNormal'],
    ['ANISOTROPYMAP', 'anisotropyMap', 'anisotropy'],
    ['TRANSMISSIONMAP', 'transmissionMap', 'transmission'],
    ['THICKNESSMAP', 'thicknessMap', 'thickness'],
    ['IRIDESCENCEMAP', 'iridescenceMap', 'iridescence'],
    ['IRIDESCENCETHICKNESSMAP', 'iridescenceThicknessMap', 'iridescenceThickness']
];
for (const [semanticName, textureName, slotName] of textureSemantics) {
    registerSemantic(semanticName, {
        get(
            _mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            return semantic.handlerTexture(
                material.getTextureSlot(slotName)?.texture ?? materialTexture(material, textureName)
            );
        }
    });

    registerSemantic(`${semanticName}UV`, {
        get(
            _mesh: SemanticMesh,
            material: SemanticMaterial,
            _programInfo: ProgramBindingInfo
        ): unknown {
            const slot = material.getTextureSlot(slotName);
            return slot?.uvSet ?? semantic.handlerUV(materialTexture(material, textureName));
        }
    });
}

// TRANSPARENCY
registerSemantic('TRANSPARENCY', {
    get(_mesh: SemanticMesh, material: SemanticMaterial, programInfo: ProgramBindingInfo): unknown {
        const opacityTexture = material.getTextureSlot('opacity')?.texture;
        if (programInfo.textureIndex !== undefined) {
            return semantic.handlerTexture(opacityTexture ?? null);
        }
        return material.opacity;
    }
});

registerSemantic('TRANSPARENCYUV', {
    get(
        _mesh: SemanticMesh,
        material: SemanticMaterial,
        _programInfo: ProgramBindingInfo
    ): unknown {
        return material.getTextureSlot('opacity')?.uvSet ?? 0;
    }
});

/**
 * semantic 对象
 */

export default semantic;
