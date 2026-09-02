import { ScenePrefab, ScenePrefabRecord, type ScenePrefabAnimation } from '../scene/ScenePrefab';
import Skeleton from '../core/Skeleton';
import Mesh from '../core/Mesh';
import BasicMaterial, {
    type BasicLightType,
    type BasicMaterialParameters
} from '../material/BasicMaterial';
import Material from '../material/MaterialInstance';
import { PBRMaterialBuilder, type PBRMaterialParameters } from '../material/PBRMaterial';
import type {
    MaterialCompositing,
    MaterialCoverage,
    MaterialTextureSlotInput
} from '../material/MaterialDefinition';
import Geometry from '../geometry/Geometry';
import MorphGeometry, { type MorphTargets } from '../geometry/MorphGeometry';
import GeometryData, { type GeometryComponentSize } from '../geometry/GeometryData';
import LazyTexture from '../texture/LazyTexture';
import Texture, { isTextureImageSource } from '../texture/Texture';
import math from '../math/math';
import Matrix4 from '../math/Matrix4';
import Matrix3 from '../math/Matrix3';
import Color from '../math/Color';
import type { AnimationInterpolation } from '../scene/components/Animation';
import Camera from '../camera/Camera';
import PerspectiveCamera from '../camera/PerspectiveCamera';
import OrthographicCamera from '../camera/OrthographicCamera';
import type Light from '../light/Light';
import BasicLoader from './BasicLoader';
import * as util from '../utils/util';
import * as builtInExtensionHandlers from './GLTFExtensions';
import type { TypedArray } from '../render/types';
import type { BasicLoaderResource, GLTFResourceLoader } from './GLTFLoader';
import {
    collectionEntries,
    createEmptyGLTFRoot,
    getCollectionItem,
    isGLTFRoot,
    type GLTFAccessorType,
    type GLTFAnimation,
    type GLTFBuffer,
    type GLTFBufferViewRuntime,
    type GLTFCollection,
    type GLTFComponentType,
    type GLTFExtensionMap,
    type GLTFImage,
    type GLTFIndex,
    type GLTFMaterial,
    type GLTFMaterialValue,
    type GLTFModel,
    type GLTFNode,
    type GLTFPrimitive,
    type GLTFProgressivePrimitiveState,
    type GLTFProperty,
    type GLTFRoot,
    type GLTFSparseAccessor,
    type GLTFTextureInfo
} from './GLTFTypes';

interface GLTFTypedArrayConstructor {
    readonly BYTES_PER_ELEMENT: number;
    new (length: number): TypedArray;
    new (buffer: ArrayBuffer, byteOffset?: number, length?: number): TypedArray;
}

interface ComponentInfo {
    readonly bytes: number;
    readonly TypedArray: GLTFTypedArrayConstructor;
}

const COMPONENT_INFO: Record<GLTFComponentType, ComponentInfo> = {
    5120: { bytes: 1, TypedArray: Int8Array },
    5121: { bytes: 1, TypedArray: Uint8Array },
    5122: { bytes: 2, TypedArray: Int16Array },
    5123: { bytes: 2, TypedArray: Uint16Array },
    5125: { bytes: 4, TypedArray: Uint32Array },
    5126: { bytes: 4, TypedArray: Float32Array }
};

const COMPONENT_COUNTS: Record<GLTFAccessorType, number> = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
    MAT2: 4,
    MAT3: 9,
    MAT4: 16
};

const INLINE_EXTENSIONS = new Set([
    'KHR_binary_glTF',
    'KHR_materials_common',
    'KHR_materials_unlit',
    'KHR_texture_transform'
]);

type GeometryAttributeSemantic =
    | 'POSITION'
    | 'TEXCOORD_0'
    | 'TEXCOORD_1'
    | 'NORMAL'
    | 'JOINT'
    | 'JOINTS_0'
    | 'WEIGHT'
    | 'WEIGHTS_0'
    | 'TANGENT'
    | 'COLOR_0';

interface GeometryAttributeInfo {
    readonly decodeMatrix?:
        'positionDecodeMat' | 'uvDecodeMat' | 'uv1DecodeMat' | 'normalDecodeMat';
}

const GEOMETRY_ATTRIBUTES: Readonly<Record<GeometryAttributeSemantic, GeometryAttributeInfo>> = {
    POSITION: { decodeMatrix: 'positionDecodeMat' },
    TEXCOORD_0: { decodeMatrix: 'uvDecodeMat' },
    TEXCOORD_1: { decodeMatrix: 'uv1DecodeMat' },
    NORMAL: { decodeMatrix: 'normalDecodeMat' },
    JOINT: {},
    JOINTS_0: {},
    WEIGHT: {},
    WEIGHTS_0: {},
    TANGENT: {},
    COLOR_0: {}
};

export type GLTFExtensionMethodName = 'parse' | 'parseOnLoad' | 'parseOnEnd';

export interface GLTFExtensionOptions {
    methodName?: GLTFExtensionMethodName;
    ignoreExtensions?: Readonly<Record<string, boolean | number>>;
    primitive?: GLTFPrimitive;
    isGlobal?: boolean;
    isMaterial?: boolean;
    isAccessor?: boolean;
    isPrimitive?: boolean;
    isCamera?: boolean;
    isNode?: boolean;
    isScene?: boolean;
    isDecode?: boolean;
}

export interface GLTFExtensionHandler {
    init?(loader: GLTFResourceLoader, parser: GLTFParser): unknown;
    parse?(
        extensionData: unknown,
        parser: GLTFParser,
        result: unknown,
        options: GLTFExtensionOptions
    ): unknown;
    parseOnLoad?(
        extensionData: unknown,
        parser: GLTFParser,
        result: unknown,
        options: GLTFExtensionOptions
    ): unknown;
    parseOnEnd?(
        extensionData: unknown,
        parser: GLTFParser,
        result: unknown,
        options: GLTFExtensionOptions
    ): unknown;
    getUsedTextureNameMap?(
        extensionData: unknown,
        map: Record<string, true>,
        parser: GLTFParser
    ): void;
}

export type GLTFExtensionHandlerRegistry = Record<string, GLTFExtensionHandler>;

export interface GLTFParserParameters {
    src?: string;
    defaultScene?: GLTFIndex;
    isMultiAnim?: boolean;
    isProgressive?: boolean;
    isUnQuantizeInShader?: boolean;
    isLoadAllTextures?: boolean;
    ignoreTextureError?: boolean;
    forceCreateNewBuffer?: boolean;
    useInstanced?: boolean;
    /** Defaults copied into every glTF 2 PBR material before asset data and extensions apply. */
    pbrMaterialDefaults?: Readonly<PBRMaterialParameters>;
    preHandlerImageURI?: ((uri: string, image: GLTFImage) => string) | null;
    preHandlerBufferURI?: ((uri: string, buffer: GLTFBuffer) => string) | null;
    preHandlerShaderURI?: ((uri: string, index: GLTFIndex, shader: unknown) => string) | null;
    customMaterialCreator?:
        | ((
              name: string,
              material: GLTFMaterial,
              json: GLTFRoot,
              parser: GLTFParser
          ) => Material | null | undefined)
        | null;
    extensionHandlers?: Readonly<GLTFExtensionHandlerRegistry> | null;
}

interface KHRBinaryImageInfo {
    bufferView: GLTFIndex;
    mimeType: string;
}

interface KHRMaterialsCommonInfo {
    technique?: BasicLightType;
    values: Readonly<Record<string, GLTFMaterialValue>>;
}

interface TextureTransformInfo {
    texCoord?: number;
    offset?: readonly number[];
    rotation?: number;
    scale?: readonly number[];
}

export type AccessorArray = (number | number[])[];
type GLTFAnimationPath = 'translation' | 'rotation' | 'scale' | 'weights';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isExtensionHandler(value: unknown): value is GLTFExtensionHandler {
    if (!isRecord(value)) return false;
    return ['init', 'parse', 'parseOnLoad', 'parseOnEnd', 'getUsedTextureNameMap'].some(
        name => typeof value[name] === 'function'
    );
}

function createBuiltInExtensionRegistry(): GLTFExtensionHandlerRegistry {
    const registry: GLTFExtensionHandlerRegistry = {};
    for (const [name, value] of Object.entries(builtInExtensionHandlers)) {
        if (isExtensionHandler(value)) registry[name] = value;
    }
    return registry;
}

function parseJson(text: string): GLTFRoot {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error: unknown) {
        throw new SyntaxError('Invalid glTF JSON.', { cause: error });
    }
    if (!isGLTFRoot(value)) throw new TypeError('glTF JSON requires asset.version.');
    return value;
}

function requireItem<Value>(
    collection: GLTFCollection<Value> | undefined,
    key: GLTFIndex,
    label: string
): Value {
    const value = getCollectionItem(collection, key);
    if (!value) throw new RangeError(`${label} ${String(key)} does not exist.`);
    return value;
}

function requiredNumber(value: readonly number[], index: number, label: string): number {
    const result = value[index];
    if (result === undefined)
        throw new RangeError(`${label} is missing component ${String(index)}.`);
    return result;
}

function geometrySize(count: number): GeometryComponentSize {
    if (count === 1 || count === 2 || count === 3 || count === 4 || count === 16) return count;
    throw new RangeError(`Geometry accessor component count ${String(count)} is unsupported.`);
}

function isGeometrySemantic(value: string): value is GeometryAttributeSemantic {
    return value in GEOMETRY_ATTRIBUTES;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    if (!isRecord(value)) return false;
    return typeof value['then'] === 'function';
}

function requireGeometry(value: unknown, context: string): Geometry {
    if (value instanceof Geometry) return value;
    throw new TypeError(`${context} must produce a Geometry.`);
}

function requireMaterial(value: unknown, context: string): Material {
    if (value instanceof Material) return value;
    throw new TypeError(`${context} must produce a Material.`);
}

function requirePrefabRecord(value: unknown, context: string): ScenePrefabRecord {
    if (value instanceof ScenePrefabRecord) return value;
    throw new TypeError(`${context} must produce a prefab record.`);
}

function optionalCamera(value: unknown, context: string): Camera | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Camera) return value;
    throw new TypeError(`${context} must produce a Camera or null.`);
}

function isEngineTexture(value: unknown): value is Texture {
    if (!(value instanceof Texture)) return false;
    const image: unknown = Reflect.get(value, 'image');
    return image === null || isTextureImageSource(image);
}

function requireTexture(value: unknown, context: string): Texture {
    if (isEngineTexture(value)) return value;
    throw new TypeError(`${context} must produce a Texture.`);
}

function isGLTFModel(value: unknown): value is GLTFModel {
    return (
        isRecord(value) &&
        value['prefab'] instanceof ScenePrefab &&
        typeof value['instantiate'] === 'function' &&
        value['ready'] instanceof Promise
    );
}

function readIndex(value: unknown): GLTFIndex | undefined {
    return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

function requireAnimationInterpolation(value: unknown): AnimationInterpolation {
    if (value === undefined || value === 'LINEAR') return 'linear';
    if (value === 'STEP') return 'step';
    if (value === 'CUBICSPLINE') return 'cubic-spline';
    throw new RangeError(`Unsupported animation interpolation value of type ${typeof value}.`);
}

function requireAnimationPath(value: string): GLTFAnimationPath {
    if (
        value === 'translation' ||
        value === 'rotation' ||
        value === 'scale' ||
        value === 'weights'
    ) {
        return value;
    }
    throw new RangeError(`Unsupported glTF animation path ${value}.`);
}

function readNumberArray(value: unknown): readonly number[] | undefined {
    if (!Array.isArray(value) || !value.every(item => typeof item === 'number')) return undefined;
    return value;
}

function readMaterialValue(value: unknown): GLTFMaterialValue | undefined {
    if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    )
        return value;
    const numbers = readNumberArray(value);
    if (numbers) return Array.from(numbers);
    if (!isRecord(value)) return undefined;
    const index = readIndex(value['index']);
    if (index === undefined) return undefined;
    const texCoord = value['texCoord'];
    return typeof texCoord === 'number' ? { index, texCoord } : { index };
}

function getKHRBinaryImageInfo(
    extensions: GLTFExtensionMap | undefined
): KHRBinaryImageInfo | null {
    const value = extensions?.['KHR_binary_glTF'];
    if (value === undefined) return null;
    if (!isRecord(value)) throw new TypeError('KHR_binary_glTF image data must be an object.');
    const bufferView = readIndex(value['bufferView']);
    const mimeType = value['mimeType'];
    if (bufferView === undefined || typeof mimeType !== 'string') {
        throw new TypeError('KHR_binary_glTF image data requires bufferView and mimeType.');
    }
    return { bufferView, mimeType };
}

function getKHRMaterialsCommonInfo(
    extensions: GLTFExtensionMap | undefined
): KHRMaterialsCommonInfo | null {
    const value = extensions?.['KHR_materials_common'];
    if (value === undefined) return null;
    if (!isRecord(value) || !isRecord(value['values'])) {
        throw new TypeError('KHR_materials_common requires an object of values.');
    }
    const techniqueValue = value['technique'];
    let technique: BasicLightType | undefined;
    if (techniqueValue === 'NONE' || techniqueValue === 'CONSTANT') technique = 'NONE';
    else if (techniqueValue === 'PHONG') technique = 'PHONG';
    else if (techniqueValue === 'BLINN' || techniqueValue === 'BLINN-PHONG') {
        technique = 'BLINN-PHONG';
    } else if (techniqueValue === 'LAMBERT') technique = 'LAMBERT';
    else if (techniqueValue !== undefined) {
        throw new RangeError(
            `Unsupported KHR_materials_common technique value of type ${typeof techniqueValue}.`
        );
    }
    const values: Record<string, GLTFMaterialValue> = {};
    for (const [name, item] of Object.entries(value['values'])) {
        const materialValue = readMaterialValue(item);
        if (materialValue === undefined) {
            throw new TypeError(`KHR_materials_common value ${name} is invalid.`);
        }
        values[name] = materialValue;
    }
    return technique === undefined ? { values } : { technique, values };
}

function getTextureTransformInfo(
    textureInfo: GLTFTextureInfo | undefined
): TextureTransformInfo | null {
    if (textureInfo === undefined) return null;
    const value = textureInfo.extensions?.['KHR_texture_transform'];
    if (value === undefined) return null;
    if (!isRecord(value)) throw new TypeError('KHR_texture_transform must be an object.');
    const texCoord = typeof value['texCoord'] === 'number' ? value['texCoord'] : undefined;
    const offset = readNumberArray(value['offset']);
    const rotation = typeof value['rotation'] === 'number' ? value['rotation'] : undefined;
    const scale = readNumberArray(value['scale']);
    return {
        ...(texCoord === undefined ? {} : { texCoord }),
        ...(offset === undefined ? {} : { offset }),
        ...(rotation === undefined ? {} : { rotation }),
        ...(scale === undefined ? {} : { scale })
    };
}

function assignGeometryAttribute(
    geometry: Geometry,
    semantic: GeometryAttributeSemantic,
    data: GeometryData
): void {
    switch (semantic) {
        case 'POSITION':
            geometry.vertices = data;
            break;
        case 'TEXCOORD_0':
            geometry.uvs = data;
            break;
        case 'TEXCOORD_1':
            geometry.uvs1 = data;
            break;
        case 'NORMAL':
            geometry.normals = data;
            break;
        case 'JOINT':
        case 'JOINTS_0':
            geometry.skinIndices = data;
            break;
        case 'WEIGHT':
        case 'WEIGHTS_0':
            geometry.skinWeights = data;
            break;
        case 'TANGENT':
            geometry.tangents = data;
            break;
        case 'COLOR_0':
            geometry.colors = data;
            break;
    }
}

function assignDecodeMatrix(
    geometry: Geometry,
    field: GeometryAttributeInfo['decodeMatrix'],
    matrix: number[]
): void {
    switch (field) {
        case 'positionDecodeMat':
            geometry.positionDecodeMat = matrix;
            break;
        case 'uvDecodeMat':
            geometry.uvDecodeMat = matrix;
            break;
        case 'uv1DecodeMat':
            geometry.uv1DecodeMat = matrix;
            break;
        case 'normalDecodeMat':
            geometry.normalDecodeMat = matrix;
            break;
        case undefined:
            break;
    }
}

/** Strict glTF 1.0/2.0 parser and engine object builder. */
class GLTFParser {
    static readonly MAGIC = 'glTF';
    static readonly extensionHandlers: GLTFExtensionHandlerRegistry =
        createBuiltInExtensionRegistry();

    static registerExtensionHandler(name: string, handler: GLTFExtensionHandler): void {
        if (!name.trim()) throw new TypeError('glTF extension name must not be empty.');
        this.extensionHandlers[name] = handler;
    }

    static unregisterExtensionHandler(name: string): void {
        Reflect.deleteProperty(this.extensionHandlers, name);
    }

    readonly isGLTFParser = true;
    readonly className = 'GLTFParser';
    readonly content: ArrayBuffer | string;
    json: GLTFRoot = createEmptyGLTFRoot();
    src = '';
    defaultScene: GLTFIndex | undefined;
    isMultiAnim = true;
    isProgressive = false;
    isUnQuantizeInShader = true;
    isLoadAllTextures = false;
    ignoreTextureError = false;
    forceCreateNewBuffer = false;
    useInstanced = false;
    pbrMaterialDefaults: Readonly<PBRMaterialParameters> = Object.freeze({});
    preHandlerImageURI: GLTFParserParameters['preHandlerImageURI'] = null;
    preHandlerBufferURI: GLTFParserParameters['preHandlerBufferURI'] = null;
    preHandlerShaderURI: GLTFParserParameters['preHandlerShaderURI'] = null;
    customMaterialCreator: GLTFParserParameters['customMaterialCreator'] = null;
    extensionHandlers: Readonly<GLTFExtensionHandlerRegistry> | null = null;
    glTFVersion = 0;
    isGLTF2 = false;
    isBinary = false;
    binaryBody: ArrayBuffer | null = null;
    extensionsUsed: Record<string, true> = {};
    buffers: Record<string, ArrayBuffer> = {};
    bufferViews: Record<string, GLTFBufferViewRuntime> = {};
    textures: Record<string, Texture> = {};
    materials: Record<string, Material> = {};
    cameras: Record<string, Camera> = {};
    meshes: Mesh[] = [];
    lights: Light[] = [];
    skins: Record<string, Skeleton> = {};
    node: ScenePrefabRecord = new ScenePrefabRecord();
    jointMap: Record<string, ScenePrefabRecord> = {};
    shaders: Record<string, string> = {};
    programs: Record<string, unknown> = {};
    techniques: Record<string, unknown> = {};
    readonly resourceErrors: Error[] = [];

    private readonly fatalProgressiveErrors: Error[] = [];
    private readonly progressiveTasks: Promise<void>[] = [];
    private readonly accessorData = new Map<GLTFIndex, GeometryData>();
    private readonly decodedAccessorData = new Map<GLTFIndex, GeometryData>();
    private readonly accessorArrays = new Map<GLTFIndex, AccessorArray>();
    private readonly decodedAccessorArrays = new Map<GLTFIndex, AccessorArray>();
    private readonly accessorDecodeMatrices = new WeakMap<GeometryData, number[]>();
    private readonly primitiveStates = new WeakMap<GLTFPrimitive, GLTFProgressivePrimitiveState>();
    private readonly primitiveTemplates = new WeakMap<GLTFPrimitive, Mesh>();
    private readonly meshMorphWeights = new WeakMap<Mesh, readonly number[]>();
    private readonly textureInfos = new WeakMap<Texture, GLTFTextureInfo>();
    private readonly visitingNodes = new Set<string>();
    private readonly attachedNodes = new Set<string>();

    constructor(content: ArrayBuffer | string = '', params: GLTFParserParameters = {}) {
        this.content = content;
        this.src = params.src ?? '';
        this.defaultScene = params.defaultScene;
        this.isMultiAnim = params.isMultiAnim ?? true;
        this.isProgressive = params.isProgressive ?? false;
        this.isUnQuantizeInShader = params.isUnQuantizeInShader ?? true;
        this.isLoadAllTextures = params.isLoadAllTextures ?? false;
        this.ignoreTextureError = params.ignoreTextureError ?? false;
        this.forceCreateNewBuffer = params.forceCreateNewBuffer ?? false;
        this.useInstanced = params.useInstanced ?? false;
        this.pbrMaterialDefaults = Object.freeze({ ...(params.pbrMaterialDefaults ?? {}) });
        this.preHandlerImageURI = params.preHandlerImageURI ?? null;
        this.preHandlerBufferURI = params.preHandlerBufferURI ?? null;
        this.preHandlerShaderURI = params.preHandlerShaderURI ?? null;
        this.customMaterialCreator = params.customMaterialCreator ?? null;
        this.extensionHandlers = params.extensionHandlers ?? null;
    }

    async parse(loader: GLTFResourceLoader): Promise<GLTFModel> {
        if (this.content instanceof ArrayBuffer) {
            if (this.content.byteLength < 4) throw new RangeError('glTF buffer is too short.');
            const magic = util.convertUint8ArrayToString(new Uint8Array(this.content, 0, 4));
            if (magic === GLTFParser.MAGIC) this.parseBinary(this.content);
            else
                this.json = parseJson(util.convertUint8ArrayToString(new Uint8Array(this.content)));
        } else {
            if (!this.content.trim())
                throw new TypeError('GLTFParser.parse requires JSON or binary content.');
            this.json = parseJson(this.content);
        }

        this.glTFVersion = Number.parseFloat(this.json.asset.version);
        if (!Number.isFinite(this.glTFVersion) || this.glTFVersion < 1) {
            throw new RangeError(`Unsupported glTF version ${this.json.asset.version}.`);
        }
        this.isGLTF2 = this.glTFVersion >= 2;
        this.parseExtensionUsed();
        await this.loadResources(loader);
        this.parseExtensions(this.json.extensions, null, {
            isGlobal: true,
            methodName: 'parseOnLoad'
        });
        await this.parseGeometries();
        return this.parseScene();
    }

    parseExtensionUsed(): void {
        this.extensionsUsed = {};
        for (const name of this.json.extensionsUsed ?? []) this.extensionsUsed[name] = true;
        for (const name of this.json.extensionsRequired ?? []) {
            this.extensionsUsed[name] = true;
            if (!INLINE_EXTENSIONS.has(name) && !this.getExtensionHandler(name)) {
                throw new RangeError(`Required glTF extension ${name} is unsupported.`);
            }
        }
        if (!this.extensionsUsed['WEB3D_quantized_attributes']) this.isUnQuantizeInShader = false;
    }

    getExtensionHandler(name: string): GLTFExtensionHandler | undefined {
        return this.extensionHandlers?.[name] ?? GLTFParser.extensionHandlers[name];
    }

    parseExtension(
        extensions: GLTFExtensionMap | undefined,
        name: string,
        result?: unknown,
        options: GLTFExtensionOptions = {}
    ): unknown {
        if (!extensions || !(name in extensions)) return result;
        const handler = this.getExtensionHandler(name);
        return handler?.parse ? handler.parse(extensions[name], this, result, options) : result;
    }

    parseExtensions(
        extensions: GLTFExtensionMap | undefined,
        result?: unknown,
        options: GLTFExtensionOptions = {}
    ): unknown {
        if (!extensions) return result;
        let current = result;
        const methodName = options.methodName ?? 'parse';
        for (const [name, info] of Object.entries(extensions)) {
            if (options.ignoreExtensions?.[name]) continue;
            const handler = this.getExtensionHandler(name);
            if (!handler) continue;
            if (methodName === 'parse' && handler.parse) {
                current = handler.parse(info, this, current, options);
            } else if (methodName === 'parseOnLoad' && handler.parseOnLoad) {
                current = handler.parseOnLoad(info, this, current, options);
            } else if (methodName === 'parseOnEnd' && handler.parseOnEnd) {
                current = handler.parseOnEnd(info, this, current, options);
            }
        }
        return current;
    }

    isUseExtension(data: GLTFProperty | GLTFRoot | undefined, extensionName: string): boolean {
        return data?.extensions?.[extensionName] !== undefined;
    }

    parseBinary(buffer: ArrayBuffer): void {
        if (buffer.byteLength < 12) throw new RangeError('Binary glTF header is incomplete.');
        this.isBinary = true;
        const view = new DataView(buffer);
        const version = view.getUint32(4, true);
        const totalLength = view.getUint32(8, true);
        if (totalLength !== buffer.byteLength) {
            throw new RangeError('Binary glTF header length does not match its buffer.');
        }

        if (version === 1) {
            if (buffer.byteLength < 20) throw new RangeError('glTF 1 binary header is incomplete.');
            const contentLength = view.getUint32(12, true);
            const contentFormat = view.getUint32(16, true);
            if (contentFormat !== 0) throw new RangeError('glTF 1 binary content must be JSON.');
            if (20 + contentLength > totalLength)
                throw new RangeError('glTF 1 JSON chunk is truncated.');
            this.json = parseJson(
                util.convertUint8ArrayToString(new Uint8Array(buffer, 20, contentLength))
            );
            this.binaryBody = buffer.slice(20 + contentLength, totalLength);
            return;
        }
        if (version !== 2)
            throw new RangeError(`Unsupported binary glTF version ${String(version)}.`);

        let start = 12;
        let foundJson = false;
        let foundBinary = false;
        while (start < totalLength) {
            if (start + 8 > totalLength)
                throw new RangeError('Binary glTF chunk header is truncated.');
            const chunkLength = view.getUint32(start, true);
            const chunkType = view.getUint32(start + 4, true);
            const chunkStart = start + 8;
            const chunkEnd = chunkStart + chunkLength;
            if (chunkEnd > totalLength) throw new RangeError('Binary glTF chunk is truncated.');
            if (chunkType === 0x4e4f534a) {
                if (foundJson) throw new RangeError('Binary glTF contains multiple JSON chunks.');
                foundJson = true;
                this.json = parseJson(
                    util.convertUint8ArrayToString(new Uint8Array(buffer, chunkStart, chunkLength))
                );
            } else if (chunkType === 0x004e4942) {
                if (foundBinary) throw new RangeError('Binary glTF contains multiple BIN chunks.');
                foundBinary = true;
                this.binaryBody = buffer.slice(chunkStart, chunkEnd);
            }
            start = chunkEnd;
        }
        if (!foundJson) throw new RangeError('Binary glTF contains no JSON chunk.');
    }

    async loadResources(loader: GLTFResourceLoader): Promise<void> {
        const extensionTasks: Promise<unknown>[] = [];
        for (const extensionName of Object.keys(this.extensionsUsed)) {
            const handler = this.getExtensionHandler(extensionName);
            if (handler?.init) extensionTasks.push(Promise.resolve(handler.init(loader, this)));
        }
        await Promise.all(extensionTasks);
        await this.loadBuffers(loader);
        await this.loadTextures();
    }

    getBufferUri(bufferName: GLTFIndex): string {
        const buffer = requireItem(this.json.buffers, bufferName, 'glTF buffer');
        if (!buffer.uri) throw new TypeError(`glTF buffer ${String(bufferName)} has no URI.`);
        let uri = util.getRelativePath(this.src, buffer.uri);
        if (this.preHandlerBufferURI) uri = this.preHandlerBufferURI(uri, buffer);
        return uri;
    }

    async loadBuffers(loader: GLTFResourceLoader): Promise<void> {
        this.buffers = {};
        let binaryBodyAvailable = this.binaryBody !== null;
        await Promise.all(
            collectionEntries(this.json.buffers).map(async ([name, buffer]) => {
                let resource: BasicLoaderResource;
                if (buffer.uri) {
                    resource = await loader.loadRes(
                        this.getBufferUri(name),
                        BasicLoader.TYPE_BUFFER
                    );
                } else if (this.isBinary && binaryBodyAvailable && this.binaryBody) {
                    binaryBodyAvailable = false;
                    resource = this.binaryBody;
                } else {
                    throw new TypeError(`glTF buffer ${name} has no URI or binary chunk.`);
                }
                if (!(resource instanceof ArrayBuffer)) {
                    throw new TypeError(`glTF buffer ${name} did not resolve to an ArrayBuffer.`);
                }
                if (resource.byteLength < buffer.byteLength) {
                    throw new RangeError(
                        `glTF buffer ${name} is shorter than its declared byteLength.`
                    );
                }
                this.buffers[name] = resource;
            })
        );
        this.parseBufferViews();
    }

    getImageUri(imageName: GLTFIndex): string {
        const image = requireItem(this.json.images, imageName, 'glTF image');
        let uri: string;
        const binaryInfo = getKHRBinaryImageInfo(image.extensions);
        if (binaryInfo) {
            const view = this.requireBufferView(binaryInfo.bufferView);
            uri = util.getBlobUrl(
                binaryInfo.mimeType,
                new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
            );
        } else if (image.uri) {
            uri = util.getRelativePath(this.src, image.uri);
        } else if (image.bufferView !== undefined) {
            if (!image.mimeType)
                throw new TypeError(`Embedded image ${String(imageName)} has no MIME type.`);
            const view = this.requireBufferView(image.bufferView);
            uri = util.getBlobUrl(
                image.mimeType,
                new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
            );
        } else {
            throw new TypeError(`glTF image ${String(imageName)} has no URI or bufferView.`);
        }
        return this.preHandlerImageURI ? this.preHandlerImageURI(uri, image) : uri;
    }

    getImageType(imageName: GLTFIndex): string {
        const image = getCollectionItem(this.json.images, imageName);
        const match = image?.mimeType ? /^image\/(.+)$/u.exec(image.mimeType) : null;
        return match?.[1] === 'ktx' ? 'ktx' : '';
    }

    getUsedTextureNameMap(): Record<string, true> {
        const map: Record<string, true> = {};
        for (const [, material] of collectionEntries(this.json.materials)) {
            const common = getKHRMaterialsCommonInfo(material.extensions);
            if (this.isGLTF2 && !common) {
                for (const info of [
                    material.normalTexture,
                    material.occlusionTexture,
                    material.emissiveTexture,
                    material.transparencyTexture
                ]) {
                    if (info) map[String(info.index)] = true;
                }
                for (const [extensionName, extensionData] of Object.entries(
                    material.extensions ?? {}
                )) {
                    this.getExtensionHandler(extensionName)?.getUsedTextureNameMap?.(
                        extensionData,
                        map,
                        this
                    );
                }
                if (!this.isUseExtension(material, 'KHR_materials_pbrSpecularGlossiness')) {
                    const pbr = material.pbrMetallicRoughness;
                    if (pbr?.baseColorTexture) map[String(pbr.baseColorTexture.index)] = true;
                    if (pbr?.metallicRoughnessTexture) {
                        map[String(pbr.metallicRoughnessTexture.index)] = true;
                    }
                }
                continue;
            }

            const values = common?.values ?? material.values ?? {};
            for (const name of [
                'diffuse',
                'specular',
                'emission',
                'ambient',
                'transparency',
                'normalMap'
            ]) {
                const value = values[name];
                const index = isRecord(value) ? readIndex(value.index) : readIndex(value);
                if (index !== undefined && getCollectionItem(this.json.textures, index)) {
                    map[String(index)] = true;
                }
            }
        }
        return map;
    }

    async loadTextures(): Promise<void> {
        this.textures = {};
        const textureEntries = collectionEntries(this.json.textures);
        const used = this.isLoadAllTextures ? null : this.getUsedTextureNameMap();
        const tasks: Promise<void>[] = [];
        for (const [name, textureData] of textureEntries) {
            if (used && !used[name]) continue;
            if (textureData.source === undefined) {
                throw new TypeError(`glTF texture ${name} has no supported image source.`);
            }
            const uri = this.getImageUri(textureData.source);
            let texture: Texture = new LazyTexture({
                autoLoad: false,
                crossOrigin: true,
                resType: this.getImageType(textureData.source),
                src: uri,
                name: textureData.name ?? name
            });
            if (util.isBlobUrl(uri)) {
                const release = (): void => {
                    util.revokeBlobUrl(uri);
                    texture.off('load', release);
                    texture.off('error', release);
                };
                texture.on('load', release, true);
                texture.on('error', release, true);
            }
            const sampler =
                textureData.sampler === undefined
                    ? undefined
                    : getCollectionItem(this.json.samplers, textureData.sampler);
            if (sampler) Object.assign(texture, sampler);
            const extended = this.parseExtensions(textureData.extensions, texture);
            if (extended !== undefined)
                texture = requireTexture(extended, `Texture ${name} extension`);
            this.textures[name] = texture;

            if (texture instanceof LazyTexture) {
                const task = texture.load();
                if (this.isProgressive) this.trackProgressive(task, this.ignoreTextureError);
                else tasks.push(this.handleImmediateResourceTask(task, this.ignoreTextureError));
            }
        }
        await Promise.all(tasks);
    }

    private async handleImmediateResourceTask(
        task: Promise<void>,
        allowFailure: boolean
    ): Promise<void> {
        try {
            await task;
        } catch (error: unknown) {
            const failure = error instanceof Error ? error : new Error(String(error));
            this.resourceErrors.push(failure);
            if (!allowFailure) throw failure;
        }
    }

    private trackProgressive(task: Promise<void>, allowFailure: boolean): void {
        this.progressiveTasks.push(
            task.then(
                () => undefined,
                (error: unknown) => {
                    const failure = error instanceof Error ? error : new Error(String(error));
                    this.resourceErrors.push(failure);
                    if (!allowFailure) this.fatalProgressiveErrors.push(failure);
                }
            )
        );
    }

    private getProgressiveReady(): Promise<void> {
        return Promise.all(this.progressiveTasks).then(() => {
            if (this.fatalProgressiveErrors.length > 0) {
                throw new AggregateError(
                    this.fatalProgressiveErrors,
                    'Progressive glTF resources failed.'
                );
            }
        });
    }

    parseBufferViews(): void {
        this.bufferViews = {};
        for (const [name, data] of collectionEntries(this.json.bufferViews)) {
            const buffer = this.buffers[String(data.buffer)];
            if (!buffer)
                throw new RangeError(
                    `BufferView ${name} references missing buffer ${String(data.buffer)}.`
                );
            const byteOffset = data.byteOffset ?? 0;
            if (
                !Number.isSafeInteger(byteOffset) ||
                byteOffset < 0 ||
                !Number.isSafeInteger(data.byteLength) ||
                data.byteLength < 0
            ) {
                throw new RangeError(`BufferView ${name} has invalid byte bounds.`);
            }
            if (byteOffset + data.byteLength > buffer.byteLength) {
                throw new RangeError(`BufferView ${name} exceeds its source buffer.`);
            }
            if (
                data.byteStride !== undefined &&
                (!Number.isSafeInteger(data.byteStride) || data.byteStride <= 0)
            ) {
                throw new RangeError(`BufferView ${name} has an invalid byteStride.`);
            }
            this.bufferViews[name] = {
                id: math.generateUUID('bufferView'),
                byteOffset,
                byteLength: data.byteLength,
                buffer,
                ...(data.byteStride === undefined ? {} : { byteStride: data.byteStride })
            };
        }
        if (!this.isBinary) this.buffers = {};
    }

    private requireBufferView(name: GLTFIndex): GLTFBufferViewRuntime {
        const view = this.bufferViews[String(name)];
        if (!view) throw new RangeError(`BufferView ${String(name)} does not exist.`);
        return view;
    }

    getBufferView(name: GLTFIndex): GLTFBufferViewRuntime {
        return this.requireBufferView(name);
    }

    getTexture(textureInfo: GLTFTextureInfo): Texture | null {
        let texture = this.textures[String(textureInfo.index)];
        if (!texture) return null;
        const texCoord = textureInfo.texCoord ?? 0;
        if (texCoord !== 0 && texCoord !== 1) {
            throw new RangeError(`Texture coordinate set ${String(texCoord)} is unsupported.`);
        }
        const key = `${String(textureInfo.index)}_${String(texCoord)}`;
        const cached = this.textures[key];
        if (cached) texture = cached;
        else if (texture.uv !== texCoord) {
            texture = texture.clone();
            this.textures[key] = texture;
        }
        texture.uv = texCoord;
        this.textureInfos.set(texture, textureInfo);
        return texture;
    }

    getColorOrTexture(value: GLTFMaterialValue | undefined): Color | Texture | null {
        const color = readNumberArray(value);
        if (color) {
            return new Color(
                requiredNumber(color, 0, 'Material color'),
                requiredNumber(color, 1, 'Material color'),
                requiredNumber(color, 2, 'Material color'),
                color[3] ?? 1
            );
        }
        const index = isRecord(value) ? readIndex(value.index) : readIndex(value);
        return index === undefined ? null : (this.textures[String(index)] ?? null);
    }

    private parseMaterialCommonProps(materialData: GLTFMaterial): Readonly<{
        coverage: MaterialCoverage;
        compositing: MaterialCompositing;
        cullMode: 'none' | 'back';
        opacityMap: MaterialTextureSlotInput | null;
    }> {
        let coverage: MaterialCoverage = { mode: 'opaque' };
        let compositing: MaterialCompositing = { mode: 'opaque' };
        switch (materialData.alphaMode ?? 'OPAQUE') {
            case 'BLEND':
                compositing = { mode: 'alpha-blend', premultiplied: false };
                break;
            case 'MASK':
                coverage = { mode: 'mask', cutoff: materialData.alphaCutoff ?? 0.5 };
                break;
            case 'OPAQUE':
                break;
            default:
                throw new RangeError(
                    `Unsupported material alpha mode ${String(materialData.alphaMode)}.`
                );
        }
        return {
            coverage,
            compositing,
            cullMode: materialData.doubleSided ? 'none' : 'back',
            opacityMap: materialData.transparencyTexture
                ? this.getTextureSlot(materialData.transparencyTexture)
                : null
        };
    }

    createPBRMaterial(materialData: GLTFMaterial): PBRMaterialBuilder {
        const needLight = !this.isUseExtension(materialData, 'KHR_materials_unlit');
        let material = new PBRMaterialBuilder({
            ...this.pbrMaterialDefaults,
            unlit: !needLight
        });
        const parameters = material.parameters;
        if (needLight) {
            const normal = materialData.normalTexture;
            if (normal) {
                parameters.normalMap = this.getTextureSlot(normal);
                parameters.normalScale = normal.scale ?? 1;
            }
            const occlusion = materialData.occlusionTexture;
            if (occlusion) {
                parameters.occlusionMap = this.getTextureSlot(occlusion);
                parameters.occlusionStrength = occlusion.strength ?? 1;
            }
            if (materialData.emissiveTexture)
                parameters.emission = this.getTextureSlot(materialData.emissiveTexture);
            if (materialData.emissiveFactor) {
                parameters.emissionFactor?.set(
                    requiredNumber(materialData.emissiveFactor, 0, 'emissiveFactor'),
                    requiredNumber(materialData.emissiveFactor, 1, 'emissiveFactor'),
                    requiredNumber(materialData.emissiveFactor, 2, 'emissiveFactor'),
                    1
                );
            }
        }

        if (this.isUseExtension(materialData, 'KHR_materials_pbrSpecularGlossiness')) {
            material = this.requirePBRMaterialBuilder(
                this.parseExtension(
                    materialData.extensions,
                    'KHR_materials_pbrSpecularGlossiness',
                    material
                )
            );
        } else if (materialData.pbrMetallicRoughness) {
            const pbr = materialData.pbrMetallicRoughness;
            if (pbr.baseColorFactor) parameters.baseColor?.fromArray(pbr.baseColorFactor);
            if (pbr.baseColorTexture) {
                parameters.baseColorMap = this.getTextureSlot(pbr.baseColorTexture);
            }
            if (needLight) {
                if (pbr.metallicRoughnessTexture) {
                    parameters.metallicRoughnessMap = this.getTextureSlot(
                        pbr.metallicRoughnessTexture
                    );
                    const occlusionTexture =
                        parameters.occlusionMap instanceof Texture
                            ? parameters.occlusionMap
                            : parameters.occlusionMap?.texture;
                    const metallicRoughnessTexture =
                        parameters.metallicRoughnessMap instanceof Texture
                            ? parameters.metallicRoughnessMap
                            : parameters.metallicRoughnessMap?.texture;
                    if (
                        occlusionTexture !== undefined &&
                        occlusionTexture === metallicRoughnessTexture
                    ) {
                        parameters.occlusionMap = null;
                        parameters.isOcclusionInMetallicRoughnessMap = true;
                    }
                }
                parameters.roughness = pbr.roughnessFactor ?? 1;
                parameters.metallic = pbr.metallicFactor ?? 1;
            }
        }
        return material;
    }

    private requirePBRMaterialBuilder(value: unknown): PBRMaterialBuilder {
        if (value instanceof PBRMaterialBuilder) return value;
        throw new TypeError('PBR material extension must return a PBRMaterialBuilder.');
    }

    getTextureSlot(textureInfo: GLTFTextureInfo): MaterialTextureSlotInput | null {
        const texture = this.getTexture(textureInfo);
        if (texture === null) return null;
        return this.createTextureSlot(texture, this.textureInfos.get(texture) ?? textureInfo);
    }

    private slotForTexture(texture: Texture): MaterialTextureSlotInput {
        return this.createTextureSlot(texture, this.textureInfos.get(texture));
    }

    private createTextureSlot(
        texture: Texture,
        textureInfo: GLTFTextureInfo | undefined
    ): MaterialTextureSlotInput {
        const transform = getTextureTransformInfo(textureInfo);
        const uvSet = transform?.texCoord ?? texture.uv;
        if (uvSet !== 0 && uvSet !== 1) {
            throw new RangeError(`Texture coordinate set ${String(uvSet)} is unsupported.`);
        }
        if (!transform?.offset && transform?.rotation === undefined && !transform?.scale) {
            return { texture, uvSet };
        }
        const offset = transform.offset ?? [0, 0];
        const scale = transform.scale ?? [1, 1];
        const uvMatrix = new Matrix3().fromRotationTranslationScale(
            transform.rotation ?? 0,
            requiredNumber(offset, 0, 'Texture transform offset'),
            requiredNumber(offset, 1, 'Texture transform offset'),
            requiredNumber(scale, 0, 'Texture transform scale'),
            requiredNumber(scale, 1, 'Texture transform scale')
        );
        return { texture, uvSet, transform: uvMatrix };
    }

    private createKMCMaterial(
        materialData: GLTFMaterial,
        common: KHRMaterialsCommonInfo | null
    ): BasicMaterial {
        const values = common?.values ?? materialData.values ?? {};
        const commonProps = this.parseMaterialCommonProps(materialData);
        const normalValue =
            values['normalMap'] === undefined ? null : this.getColorOrTexture(values['normalMap']);
        const parameters: BasicMaterialParameters = {
            lightType: common?.technique ?? 'BLINN-PHONG',
            diffuse: this.getColorOrTexture(values['diffuse']),
            specular: this.getColorOrTexture(values['specular']),
            emission: this.getColorOrTexture(values['emission']),
            ambient: this.getColorOrTexture(values['ambient']),
            coverage: commonProps.coverage,
            compositing: commonProps.compositing,
            cullMode: commonProps.cullMode,
            opacityMap: commonProps.opacityMap,
            ...(isEngineTexture(normalValue)
                ? { normalMap: this.slotForTexture(normalValue) }
                : {}),
            ...(typeof values['shininess'] === 'number' ? { shininess: values['shininess'] } : {})
        };
        return new BasicMaterial(parameters);
    }

    parseMaterials(): void {
        this.materials = {};
        for (const [name, materialData] of collectionEntries(this.json.materials)) {
            const custom = this.customMaterialCreator?.(name, materialData, this.json, this);
            let material: Material;
            if (custom) {
                material = requireMaterial(
                    this.parseExtensions(materialData.extensions, custom, {
                        ignoreExtensions: { KHR_materials_common: true },
                        isMaterial: true
                    }),
                    `Material ${name} extensions`
                );
            } else {
                const common = getKHRMaterialsCommonInfo(materialData.extensions);
                if (this.isGLTF2 && !common) {
                    let builder = this.createPBRMaterial(materialData);
                    const commonProps = this.parseMaterialCommonProps(materialData);
                    Object.assign(builder.parameters, commonProps);
                    builder = this.requirePBRMaterialBuilder(
                        this.parseExtensions(materialData.extensions, builder, {
                            ignoreExtensions: {
                                KHR_materials_common: true,
                                KHR_materials_pbrSpecularGlossiness: true
                            },
                            isMaterial: true
                        })
                    );
                    material = builder.build();
                } else {
                    material = this.createKMCMaterial(materialData, common);
                    material = requireMaterial(
                        this.parseExtensions(materialData.extensions, material, {
                            ignoreExtensions: { KHR_materials_common: true },
                            isMaterial: true
                        }),
                        `Material ${name} extensions`
                    );
                }
            }
            material.name = materialData.name ?? name;
            this.materials[name] = material;
        }
    }

    sparseAccessorHandler(data: GeometryData, sparse: GLTFSparseAccessor): GeometryData {
        const count = sparse.count;
        if (!Number.isSafeInteger(count) || count <= 0 || count > data.count) {
            throw new RangeError('Sparse accessor count is invalid.');
        }
        const sourceData = data.data;
        const DataArray = this.typedArrayConstructor(sourceData);
        const output = new DataArray(data.count * data.size);
        data.traverseByComponent((component, componentIndex) => {
            output[componentIndex] = component;
            return false;
        });
        data.data = output;

        const valueView = this.requireBufferView(sparse.values.bufferView);
        const valueOffset = sparse.values.byteOffset ?? 0;
        const valueByteLength = count * data.size * DataArray.BYTES_PER_ELEMENT;
        if (
            !Number.isSafeInteger(valueOffset) ||
            valueOffset < 0 ||
            valueOffset + valueByteLength > valueView.byteLength ||
            (valueView.byteOffset + valueOffset) % DataArray.BYTES_PER_ELEMENT !== 0
        ) {
            throw new RangeError('Sparse accessor values exceed or misalign their bufferView.');
        }
        const values = new DataArray(
            valueView.buffer,
            valueView.byteOffset + valueOffset,
            count * data.size
        );
        const indexInfo = COMPONENT_INFO[sparse.indices.componentType];
        const indexView = this.requireBufferView(sparse.indices.bufferView);
        const indexOffset = sparse.indices.byteOffset ?? 0;
        const indexByteLength = count * indexInfo.bytes;
        if (
            !Number.isSafeInteger(indexOffset) ||
            indexOffset < 0 ||
            indexOffset + indexByteLength > indexView.byteLength ||
            (indexView.byteOffset + indexOffset) % indexInfo.bytes !== 0
        ) {
            throw new RangeError('Sparse accessor indices exceed or misalign their bufferView.');
        }
        const indices = new indexInfo.TypedArray(
            indexView.buffer,
            indexView.byteOffset + indexOffset,
            count
        );
        for (let index = 0; index < count; index++) {
            const destinationIndex = indices[index];
            if (destinationIndex === undefined)
                throw new RangeError('Sparse accessor index is missing.');
            if (!Number.isSafeInteger(destinationIndex) || destinationIndex >= data.count) {
                throw new RangeError(
                    `Sparse accessor index ${String(destinationIndex)} is out of range.`
                );
            }
            util.copyArrayData(
                output,
                values,
                destinationIndex * data.size,
                index * data.size,
                data.size
            );
        }
        return data;
    }

    private typedArrayConstructor(data: TypedArray): GLTFTypedArrayConstructor {
        if (data instanceof Int8Array) return Int8Array;
        if (data instanceof Uint8Array) return Uint8Array;
        if (data instanceof Uint8ClampedArray) return Uint8ClampedArray;
        if (data instanceof Int16Array) return Int16Array;
        if (data instanceof Uint16Array) return Uint16Array;
        if (data instanceof Int32Array) return Int32Array;
        if (data instanceof Uint32Array) return Uint32Array;
        if (data instanceof Float32Array) return Float32Array;
        return Float64Array;
    }

    getAccessorData(name: GLTFIndex, isDecode = false): GeometryData {
        const cache = isDecode ? this.decodedAccessorData : this.accessorData;
        const cached = cache.get(name);
        if (cached) return cached;
        const accessor = requireItem(this.json.accessors, name, 'glTF accessor');
        if (!(accessor.componentType in COMPONENT_INFO)) {
            throw new RangeError(`Accessor ${String(name)} has an unsupported component type.`);
        }
        if (!(accessor.type in COMPONENT_COUNTS)) {
            throw new RangeError(`Accessor ${String(name)} has an unsupported shape.`);
        }
        if (!Number.isSafeInteger(accessor.count) || accessor.count <= 0) {
            throw new RangeError(`Accessor ${String(name)} has an invalid count.`);
        }
        const component = COMPONENT_INFO[accessor.componentType];
        const countPerItem = COMPONENT_COUNTS[accessor.type];
        const size = geometrySize(countPerItem);
        const componentCount = accessor.count * countPerItem;
        let result: GeometryData | null = null;

        if (accessor.bufferView !== undefined) {
            const view = this.requireBufferView(accessor.bufferView);
            const stride = view.byteStride ?? accessor.byteStride ?? 0;
            const elementByteLength = countPerItem * component.bytes;
            const accessorOffset = accessor.byteOffset ?? 0;
            if (
                !Number.isSafeInteger(accessorOffset) ||
                accessorOffset < 0 ||
                (view.byteOffset + accessorOffset) % component.bytes !== 0
            ) {
                throw new RangeError(
                    `Accessor ${String(name)} has an invalid or misaligned byteOffset.`
                );
            }
            if (stride !== 0 && (stride < elementByteLength || stride % component.bytes !== 0)) {
                throw new RangeError(`Accessor ${String(name)} has an invalid byteStride.`);
            }
            const itemStride = stride || elementByteLength;
            const requiredByteLength = (accessor.count - 1) * itemStride + elementByteLength;
            if (accessorOffset + requiredByteLength > view.byteLength) {
                throw new RangeError(`Accessor ${String(name)} exceeds its bufferView.`);
            }
            if (stride > elementByteLength) {
                const array = new component.TypedArray(componentCount);
                for (let itemIndex = 0; itemIndex < accessor.count; itemIndex++) {
                    const source = new component.TypedArray(
                        view.buffer,
                        view.byteOffset + accessorOffset + itemIndex * stride,
                        countPerItem
                    );
                    array.set(source, itemIndex * countPerItem);
                }
                result = new GeometryData(array, size);
            } else {
                const byteOffset = view.byteOffset + accessorOffset;
                const byteLength = componentCount * component.bytes;
                const array =
                    byteOffset % component.bytes !== 0 || this.forceCreateNewBuffer
                        ? new component.TypedArray(
                              view.buffer.slice(byteOffset, byteOffset + byteLength)
                          )
                        : new component.TypedArray(view.buffer, byteOffset, componentCount);
                result = new GeometryData(array, size);
            }
        }
        if (accessor.sparse) {
            result ??= new GeometryData(new component.TypedArray(componentCount), size);
            result = this.sparseAccessorHandler(result, accessor.sparse);
        }
        if (!result)
            throw new TypeError(`Accessor ${String(name)} has no bufferView or sparse values.`);
        const extended = this.parseExtensions(accessor.extensions, result, {
            isDecode,
            isAccessor: true
        });
        result = extended === undefined ? result : this.requireGeometryData(extended);
        result.normalized = accessor.normalized ?? false;
        cache.set(name, result);
        return result;
    }

    private requireGeometryData(value: unknown): GeometryData {
        if (value instanceof GeometryData) return value;
        throw new TypeError('Accessor extension must return GeometryData.');
    }

    setAccessorDecodeMatrix(data: GeometryData, matrix: readonly number[]): void {
        this.accessorDecodeMatrices.set(data, Array.from(matrix));
    }

    getAccessorDecodeMatrix(data: GeometryData): number[] | undefined {
        return this.accessorDecodeMatrices.get(data);
    }

    getArrayByAccessor(name: GLTFIndex, isDecode = false): AccessorArray {
        const cache = isDecode ? this.decodedAccessorArrays : this.accessorArrays;
        const cached = cache.get(name);
        if (cached) return cached;
        const data = this.getAccessorData(name, isDecode);
        const result: AccessorArray = [];
        data.traverse(value => {
            if (typeof value === 'number') result.push(value);
            else result.push(Array.from(value.elements));
            return false;
        });
        cache.set(name, result);
        return result;
    }

    createMorphGeometry(primitive: GLTFPrimitive, weights?: readonly number[]): MorphGeometry {
        const geometry = new MorphGeometry();
        const targets: MorphTargets = {};
        geometry.targets = targets;
        for (const target of primitive.targets ?? []) {
            for (const [semantic, accessorName] of Object.entries(target)) {
                if (!isGeometrySemantic(semantic)) {
                    throw new RangeError(`Unsupported morph attribute ${semantic}.`);
                }
                const targetName = this.geometryTargetName(semantic);
                (targets[targetName] ??= []).push(this.getAccessorData(accessorName, true));
            }
        }
        const targetCount = primitive.targets?.length ?? 0;
        if (
            weights &&
            (weights.length !== targetCount ||
                !weights.every(weight => typeof weight === 'number' && Number.isFinite(weight)))
        ) {
            throw new TypeError('glTF mesh morph weights must match its target count.');
        }
        geometry.weights = weights ? Array.from(weights) : new Float32Array(targetCount);
        return geometry;
    }

    private geometryTargetName(semantic: GeometryAttributeSemantic): string {
        switch (semantic) {
            case 'POSITION':
                return 'vertices';
            case 'NORMAL':
                return 'normals';
            case 'TANGENT':
                return 'tangents';
            default:
                throw new RangeError(`Morph attribute ${semantic} is unsupported.`);
        }
    }

    handlerGeometry(
        initial: Geometry | undefined,
        primitive: GLTFPrimitive
    ): Geometry | Promise<Geometry> {
        const mode = primitive.mode ?? 4;
        if (primitive.extensions) {
            const extensionResult = this.parseExtensions(primitive.extensions, initial ?? null, {
                primitive,
                isPrimitive: true
            });
            if (isPromiseLike(extensionResult)) {
                return Promise.resolve(extensionResult).then(value => {
                    const geometry = requireGeometry(value, 'Primitive extension');
                    geometry.mode = mode;
                    geometry.normalizePrimitiveTopology();
                    return geometry;
                });
            }
            if (extensionResult !== null && extensionResult !== undefined) {
                const geometry = requireGeometry(extensionResult, 'Primitive extension');
                geometry.mode = mode;
                geometry.normalizePrimitiveTopology();
                return geometry;
            }
        }
        const geometry = initial ?? new Geometry({ mode });
        if (primitive.indices !== undefined)
            geometry.indices = this.getAccessorData(primitive.indices);
        for (const [semantic, accessorName] of Object.entries(primitive.attributes)) {
            if (!isGeometrySemantic(semantic)) {
                throw new RangeError(`Unsupported glTF geometry attribute ${semantic}.`);
            }
            const info = GEOMETRY_ATTRIBUTES[semantic];
            const decode = !(this.isUnQuantizeInShader && info.decodeMatrix);
            const data = this.getAccessorData(accessorName, decode);
            assignGeometryAttribute(geometry, semantic, data);
            if (!decode) {
                const matrix = this.getAccessorDecodeMatrix(data);
                if (!matrix)
                    throw new TypeError(
                        `${semantic} quantization extension omitted its decode matrix.`
                    );
                assignDecodeMatrix(geometry, info.decodeMatrix, matrix);
            }
        }
        geometry.normalizePrimitiveTopology();
        return geometry;
    }

    fixProgressiveGeometry(primitive: GLTFPrimitive, geometry: Geometry): void {
        const state = this.primitiveStates.get(primitive) ?? { meshes: [] };
        state.geometry = geometry;
        this.primitiveStates.set(primitive, state);
        if (this.isProgressive) {
            for (const mesh of state.meshes) {
                mesh.visible = true;
                mesh.geometry = this.geometryForMesh(geometry, mesh);
            }
        }
    }

    private geometryForMesh(geometry: Geometry, mesh: Mesh): Geometry {
        if (!(geometry instanceof MorphGeometry)) return geometry;
        const instanceGeometry = geometry.clone();
        const weights = this.meshMorphWeights.get(mesh);
        if (weights) {
            if (
                weights.length !== instanceGeometry.weights.length ||
                !weights.every(weight => typeof weight === 'number' && Number.isFinite(weight))
            ) {
                throw new TypeError('glTF node morph weights must match the mesh target count.');
            }
            instanceGeometry.weights = Array.from(weights);
        }
        return instanceGeometry;
    }

    async parseGeometries(): Promise<void> {
        for (const [, meshData] of collectionEntries(this.json.meshes)) {
            for (const primitive of meshData.primitives) {
                const initial = primitive.targets?.length
                    ? this.createMorphGeometry(primitive, meshData.weights)
                    : undefined;
                const result = this.handlerGeometry(initial, primitive);
                if (result instanceof Promise) {
                    const task = result.then(geometry => {
                        this.fixProgressiveGeometry(primitive, geometry);
                    });
                    if (this.isProgressive) this.trackProgressive(task, false);
                    else await task;
                } else this.fixProgressiveGeometry(primitive, result);
            }
        }
    }

    parseMesh(meshName: GLTFIndex, node: ScenePrefabRecord, nodeData: GLTFNode): void {
        const meshData = requireItem(this.json.meshes, meshName, 'glTF mesh');
        for (const primitive of meshData.primitives) {
            const skeleton =
                nodeData.skin === undefined ? undefined : this.skins[String(nodeData.skin)];
            let mesh = this.primitiveTemplates.get(primitive)?.clone();
            if (!mesh) {
                const material =
                    primitive.material === undefined
                        ? new BasicMaterial()
                        : (this.materials[String(primitive.material)] ?? new BasicMaterial());
                const geometry = this.primitiveStates.get(primitive)?.geometry ?? null;
                mesh = new Mesh({
                    geometry,
                    material,
                    name: `mesh-${meshData.name ?? String(meshName)}`,
                    useInstanced: this.useInstanced
                });
                this.primitiveTemplates.set(primitive, mesh);
            }
            if (nodeData.weights) {
                this.meshMorphWeights.set(mesh, nodeData.weights);
                mesh.morphWeights = Float32Array.from(nodeData.weights);
            }
            if (mesh.geometry) mesh.geometry = this.geometryForMesh(mesh.geometry, mesh);
            if (skeleton) {
                node.attachSkin(mesh, {
                    jointIds: skeleton.jointNames,
                    inverseBindMatrices: skeleton.inverseBindMatrices
                });
            }
            if (this.isProgressive && !mesh.geometry) {
                mesh.visible = false;
                const state = this.primitiveStates.get(primitive) ?? { meshes: [] };
                state.meshes.push(mesh);
                this.primitiveStates.set(primitive, state);
            }
            node.append(mesh);
            this.meshes.push(mesh);
        }
    }

    parseCameras(): void {
        this.cameras = {};
        const defaultAspect =
            typeof window === 'undefined' || window.innerHeight <= 0
                ? 1
                : window.innerWidth / window.innerHeight;
        for (const [name, data] of collectionEntries(this.json.cameras)) {
            let camera: Camera | null = null;
            if (data.type === 'perspective' && data.perspective) {
                camera = new PerspectiveCamera({
                    fov: math.radToDeg(data.perspective.yfov),
                    near: data.perspective.znear,
                    far: data.perspective.zfar ?? null,
                    aspect: data.perspective.aspectRatio ?? data.aspectRatio ?? defaultAspect
                });
            } else if (data.type === 'orthographic' && data.orthographic) {
                camera = new OrthographicCamera({
                    near: data.orthographic.znear,
                    far: data.orthographic.zfar,
                    right: data.orthographic.xmag,
                    left: -data.orthographic.xmag,
                    top: data.orthographic.ymag,
                    bottom: -data.orthographic.ymag
                });
            } else if (!data.extensions) {
                throw new TypeError(`Camera ${name} has an invalid ${data.type} definition.`);
            }
            const extended = this.parseExtensions(data.extensions, camera, { isCamera: true });
            camera = optionalCamera(extended, `Camera ${name} extension`);
            if (!camera) throw new TypeError(`Camera ${name} could not be constructed.`);
            camera.name = data.name ?? name;
            this.cameras[name] = camera;
        }
    }

    handlerNodeTransform(node: ScenePrefabRecord, data: GLTFNode): void {
        if (data.matrix) {
            if (data.rotation || data.scale || data.translation) {
                throw new TypeError('glTF nodes cannot define both matrix and TRS transforms.');
            }
            node.setMatrix(data.matrix);
            return;
        }
        if (data.rotation) node.quaternion.fromArray(data.rotation);
        if (data.scale)
            node.setScale(
                requiredNumber(data.scale, 0, 'glTF node scale'),
                requiredNumber(data.scale, 1, 'glTF node scale'),
                requiredNumber(data.scale, 2, 'glTF node scale')
            );
        if (data.translation)
            node.setPosition(
                requiredNumber(data.translation, 0, 'glTF node translation'),
                requiredNumber(data.translation, 1, 'glTF node translation'),
                requiredNumber(data.translation, 2, 'glTF node translation')
            );
    }

    parseNode(nodeName: GLTFIndex, parentNode: ScenePrefabRecord): ScenePrefabRecord {
        const key = String(nodeName);
        if (this.visitingNodes.has(key))
            throw new RangeError(`glTF node graph contains a cycle at ${key}.`);
        if (this.attachedNodes.has(key)) {
            throw new RangeError(`glTF node ${key} is attached to more than one parent.`);
        }
        this.visitingNodes.add(key);
        try {
            const data = requireItem(this.json.nodes, nodeName, 'glTF node');
            let node = new ScenePrefabRecord({ name: data.name ?? '', animationId: key });
            node = requirePrefabRecord(
                this.parseExtensions(data.extensions, node, { isNode: true }),
                `glTF node ${key} extension`
            );
            if (data.camera !== undefined) {
                const camera = this.cameras[String(data.camera)];
                if (!camera) throw new RangeError(`glTF node ${key} references missing camera.`);
                node.append(camera);
            }
            this.handlerNodeTransform(node, data);
            node.jointName = data.jointName ?? key;
            this.jointMap[node.jointName] = node;
            for (const meshName of data.meshes ?? []) this.parseMesh(meshName, node, data);
            if (data.mesh !== undefined) this.parseMesh(data.mesh, node, data);
            for (const childName of data.children ?? []) this.parseNode(childName, node);
            parentNode.append(node);
            this.attachedNodes.add(key);
            return node;
        } finally {
            this.visitingNodes.delete(key);
        }
    }

    parseAnimations(): ScenePrefabAnimation[] {
        const clips: ScenePrefabAnimation[] = [];
        for (const [animationName, animation] of collectionEntries(this.json.animations)) {
            const channels: ScenePrefabAnimation['channels'][number][] = [];
            for (const channel of animation.channels) {
                const sampler = requireItem(
                    animation.samplers,
                    channel.sampler,
                    'Animation sampler'
                );
                const nodeId = channel.target.node ?? channel.target.id;
                if (nodeId === undefined)
                    throw new TypeError('Animation channel has no target node.');
                requireItem(this.json.nodes, nodeId, 'Animation target node');
                const input = this.animationAccessor(animation, sampler.input);
                const output = this.animationAccessor(animation, sampler.output);
                const keyTime = this.requireScalarAccessor(
                    this.getArrayByAccessor(input, true),
                    'Animation input'
                );
                this.validateKeyTimes(keyTime);
                const outputValues = this.getArrayByAccessor(output, true);
                const targetPath = requireAnimationPath(channel.target.path);
                const interpolation = requireAnimationInterpolation(sampler.interpolation);
                this.validateAnimationOutput(
                    targetPath,
                    interpolation,
                    keyTime.length,
                    outputValues
                );
                const frameMultiplier = interpolation === 'cubic-spline' ? 3 : 1;
                const width =
                    targetPath === 'weights'
                        ? outputValues.length / (keyTime.length * frameMultiplier)
                        : targetPath === 'rotation'
                          ? 4
                          : 3;
                const values: number[] = [];
                for (const outputValue of outputValues) {
                    if (typeof outputValue === 'number') values.push(outputValue);
                    else values.push(...outputValue);
                }
                channels.push({
                    targetId: String(nodeId),
                    property: targetPath,
                    times: Float32Array.from(keyTime),
                    values: Float32Array.from(values),
                    width,
                    interpolation
                });
            }
            if (channels.length > 0)
                clips.push({ name: animation.name ?? animationName, channels });
        }
        return clips;
    }

    private animationAccessor(animation: GLTFAnimation, reference: GLTFIndex): GLTFIndex {
        if (this.isGLTF2) return reference;
        const accessor = animation.parameters?.[String(reference)];
        if (accessor === undefined) {
            throw new RangeError(`Animation parameter ${String(reference)} is missing.`);
        }
        return accessor;
    }

    private requireScalarAccessor(array: AccessorArray, label: string): number[] {
        if (array.every(value => typeof value === 'number')) return array;
        throw new TypeError(`${label} must be a scalar accessor.`);
    }

    private validateKeyTimes(keyTimes: readonly number[]): void {
        if (keyTimes.length === 0)
            throw new TypeError('Animation input accessor must not be empty.');
        for (let index = 0; index < keyTimes.length; index++) {
            const value = keyTimes[index];
            if (value === undefined || !Number.isFinite(value)) {
                throw new TypeError('Animation input accessor contains a non-finite time.');
            }
            if (index > 0 && value <= requiredNumber(keyTimes, index - 1, 'Animation input')) {
                throw new RangeError('Animation input times must be strictly increasing.');
            }
        }
    }

    private validateAnimationOutput(
        path: GLTFAnimationPath,
        interpolation: AnimationInterpolation,
        keyCount: number,
        output: AccessorArray
    ): void {
        const frameCount = keyCount * (interpolation === 'cubic-spline' ? 3 : 1);
        if (path === 'weights') {
            if (
                output.length === 0 ||
                output.length % frameCount !== 0 ||
                !output.every(value => typeof value === 'number')
            ) {
                throw new TypeError(
                    'Animation weight output must be scalar data grouped by keyframe.'
                );
            }
            return;
        }
        const componentCount = path === 'rotation' ? 4 : 3;
        if (
            output.length !== frameCount ||
            !output.every(
                value =>
                    Array.isArray(value) &&
                    value.length === componentCount &&
                    value.every(component => Number.isFinite(component))
            )
        ) {
            throw new TypeError(
                `Animation ${path} output must contain ${String(frameCount)} VEC${String(componentCount)} values.`
            );
        }
    }

    parseScene(): GLTFModel {
        this.parseMaterials();
        this.jointMap = {};
        this.meshes = [];
        this.lights = [];
        this.node = new ScenePrefabRecord();
        this.visitingNodes.clear();
        this.attachedNodes.clear();
        this.parseCameras();
        const sceneName = this.getDefaultSceneName();
        const scene = requireItem(this.json.scenes, sceneName, 'glTF scene');
        this.parseSkins();
        for (const nodeName of scene.nodes ?? []) this.parseNode(nodeName, this.node);
        const prefab = new ScenePrefab(this.node.children, this.parseAnimations());

        const model: GLTFModel = {
            prefab,
            instantiate: world => prefab.instantiate(world),
            meshCount: this.meshes.length,
            cameraCount: Object.keys(this.cameras).length,
            lightCount: this.lights.length,
            json: this.json,
            textures: Object.values(this.textures),
            materials: Object.values(this.materials),
            ready: this.getProgressiveReady(),
            resourceErrors: this.resourceErrors
        };
        this.parseExtensions(scene.extensions, null, { isScene: true });
        const extended = this.parseExtensions(this.json.extensions, model, {
            isGlobal: true,
            methodName: 'parseOnEnd'
        });
        if (!isGLTFModel(extended))
            throw new TypeError('Global glTF extension returned an invalid model.');
        return extended;
    }

    getDefaultSceneName(): GLTFIndex {
        if (this.defaultScene !== undefined) return this.defaultScene;
        if (this.json.scene !== undefined) return this.json.scene;
        const first = collectionEntries(this.json.scenes)[0]?.[0];
        if (first === undefined) throw new RangeError('glTF contains no scenes.');
        return first;
    }

    parseSkins(): void {
        this.skins = {};
        for (const [name, skin] of collectionEntries(this.json.skins)) {
            const skeleton = new Skeleton();
            const joints = skin.joints ?? skin.jointNames;
            if (!joints || joints.length === 0) {
                throw new TypeError(`Skin ${name} contains no joints.`);
            }
            const matrices =
                skin.inverseBindMatrices === undefined
                    ? []
                    : this.getArrayByAccessor(skin.inverseBindMatrices, true);
            if (matrices.length !== 0 && matrices.length !== joints.length) {
                throw new RangeError(
                    `Skin ${name} inverse bind matrix count does not match its joints.`
                );
            }
            for (let index = 0; index < joints.length; index++) {
                const values = matrices[index];
                skeleton.inverseBindMatrices.push(
                    Array.isArray(values) ? new Matrix4().fromArray(values) : new Matrix4()
                );
            }
            skeleton.jointNames = joints.map(String);
            this.skins[name] = skeleton;
        }
    }
}

export default GLTFParser;
