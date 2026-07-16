import Animation from '../animation/Animation';
import Node from '../core/Node';
import type Mesh from '../core/Mesh';
import GeometryData, { type GeometryAttributeValue } from '../geometry/GeometryData';
import DirectionalLight from '../light/DirectionalLight';
import PointLight from '../light/PointLight';
import SpotLight from '../light/SpotLight';
import PBRMaterial from '../material/PBRMaterial';
import type Material from '../material/Material';
import type {
    MaterialBindingInfo,
    MaterialBindingMap,
    ProgramBindingInfo
} from '../material/Material';
import ShaderMaterial from '../material/ShaderMaterial';
import semantic from '../material/semantic';
import Color from '../math/Color';
import math from '../math/math';
import type { ShaderOptions } from '../renderer/types';
import BasicLoader from './BasicLoader';
import type { GLTFExtensionHandler, GLTFExtensionOptions } from './GLTFParser';
import type GLTFParser from './GLTFParser';
import type {
    GLTFCollection,
    GLTFExtensionMap,
    GLTFIndex,
    GLTFModel,
    GLTFTextureInfo
} from './GLTFTypes';
import type { GLTFResourceLoader } from './GLTFLoader';
import { SAMPLER_2D } from '../constants/webgl';
import * as util from '../utils/util';

interface TechniqueShader {
    readonly uri: string;
}

interface TechniqueProgram {
    readonly fragmentShader: GLTFIndex;
    readonly vertexShader: GLTFIndex;
    readonly name?: string;
}

interface TechniqueBindingDefinition {
    readonly type?: number;
    readonly semantic?: string;
    readonly node?: GLTFIndex;
    readonly value?: unknown;
}

interface RuntimeTechnique {
    readonly program: GLTFIndex;
    readonly attributes: Readonly<Record<string, TechniqueBindingDefinition>>;
    readonly uniforms: Readonly<Record<string, TechniqueBindingDefinition>>;
    readonly textureInfos: Readonly<Record<string, GLTFIndex>>;
}

interface TechniqueMaterialInfo {
    readonly technique: GLTFIndex;
    readonly values: Readonly<Record<string, unknown>>;
    readonly premultiplyAlpha?: boolean;
    readonly defines?: ShaderOptions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readIndex(value: unknown): GLTFIndex | undefined {
    return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

function requireIndex(value: unknown, label: string): GLTFIndex {
    const index = readIndex(value);
    if (index === undefined) throw new TypeError(`${label} must be a string or number.`);
    return index;
}

function requireNumber(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`${label} must be a finite number.`);
    }
    return value;
}

function readNumberArray(value: unknown): readonly number[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const result: number[] = [];
    for (const rawItem of value) {
        const item: unknown = rawItem;
        if (typeof item !== 'number' || !Number.isFinite(item)) return undefined;
        result.push(item);
    }
    return result;
}

function requireNumberArray(value: unknown, label: string, minimumLength = 0): readonly number[] {
    const result = readNumberArray(value);
    if (!result || result.length < minimumLength) {
        throw new TypeError(
            `${label} must contain at least ${String(minimumLength)} finite numbers.`
        );
    }
    return result;
}

function collectionEntries(
    value: unknown,
    label: string
): (readonly [string, Record<string, unknown>])[] {
    if (value === undefined) return [];
    const entries = Array.isArray(value)
        ? value.map((item, index) => [String(index), item] as const)
        : isRecord(value)
          ? Object.entries(value)
          : null;
    if (!entries) throw new TypeError(`${label} must be an array or object.`);
    return entries.map(([name, item]) => {
        if (!isRecord(item)) throw new TypeError(`${label} ${name} must be an object.`);
        return [name, item] as const;
    });
}

function getCollectionValue(collection: unknown, index: GLTFIndex): unknown {
    if (Array.isArray(collection)) {
        const numericIndex = typeof index === 'number' ? index : Number(index);
        return Number.isInteger(numericIndex) ? collection[numericIndex] : undefined;
    }
    return isRecord(collection) ? collection[String(index)] : undefined;
}

function requireTextureInfo(value: unknown, label: string): GLTFTextureInfo {
    if (!isRecord(value)) throw new TypeError(`${label} must be a texture info object.`);
    const index = requireIndex(value['index'], `${label}.index`);
    const texCoord = value['texCoord'];
    const scale = value['scale'];
    const strength = value['strength'];
    const extensions = value['extensions'];
    if (texCoord !== undefined && typeof texCoord !== 'number') {
        throw new TypeError(`${label}.texCoord must be a number.`);
    }
    if (scale !== undefined && typeof scale !== 'number') {
        throw new TypeError(`${label}.scale must be a number.`);
    }
    if (strength !== undefined && typeof strength !== 'number') {
        throw new TypeError(`${label}.strength must be a number.`);
    }
    if (extensions !== undefined && !isRecord(extensions)) {
        throw new TypeError(`${label}.extensions must be an object.`);
    }
    return {
        index,
        ...(typeof texCoord === 'number' ? { texCoord } : {}),
        ...(typeof scale === 'number' ? { scale } : {}),
        ...(typeof strength === 'number' ? { strength } : {}),
        ...(extensions ? { extensions } : {})
    };
}

function optionalTextureInfo(
    record: Readonly<Record<string, unknown>>,
    name: string,
    label: string
): GLTFTextureInfo | undefined {
    const value = record[name];
    return value === undefined ? undefined : requireTextureInfo(value, `${label}.${name}`);
}

function isGLTFModel(value: unknown): value is GLTFModel {
    return (
        isRecord(value) &&
        value['node'] instanceof Node &&
        value['scene'] instanceof Node &&
        Array.isArray(value['meshes']) &&
        value['ready'] instanceof Promise
    );
}

function requirePBRMaterial(value: unknown, label: string): PBRMaterial {
    if (!(value instanceof PBRMaterial)) throw new TypeError(`${label} requires a PBRMaterial.`);
    return value;
}

function attributeComponents(value: GeometryAttributeValue): readonly number[] {
    return typeof value === 'number' ? [value] : Array.from(value.elements);
}

function unQuantizeData(data: GeometryData, decodeMatrix: readonly number[]): GeometryData {
    const matrixSize = Math.sqrt(decodeMatrix.length);
    if (!Number.isInteger(matrixSize) || matrixSize !== data.size + 1) {
        throw new RangeError(
            `Quantization decode matrix must be ${String((data.size + 1) ** 2)} elements for size ${String(data.size)}.`
        );
    }
    const result = new Float32Array(data.count * data.size);
    data.traverse((attribute, index) => {
        const input = attributeComponents(attribute);
        const outputOffset = index * data.size;
        for (let column = 0; column < data.size; column++) {
            let decoded = decodeMatrix[data.size * matrixSize + column] ?? 0;
            for (let row = 0; row < data.size; row++) {
                decoded += (decodeMatrix[row * matrixSize + column] ?? 0) * (input[row] ?? 0);
            }
            result[outputOffset + column] = decoded;
        }
        return false;
    });
    data.data = result;
    data.stride = 0;
    data.offset = 0;
    return data;
}

export const WEB3D_quantized_attributes = {
    parse(
        extensionData: unknown,
        parser: GLTFParser,
        result: unknown,
        options: GLTFExtensionOptions
    ): GeometryData {
        if (!isRecord(extensionData)) {
            throw new TypeError('WEB3D_quantized_attributes data must be an object.');
        }
        if (!(result instanceof GeometryData)) {
            throw new TypeError('WEB3D_quantized_attributes requires GeometryData.');
        }
        const decodeMatrix = requireNumberArray(
            extensionData['decodeMatrix'],
            'WEB3D_quantized_attributes.decodeMatrix'
        );
        if (options.isDecode) return unQuantizeData(result, decodeMatrix);
        parser.setAccessorDecodeMatrix(result, decodeMatrix);
        return result;
    }
} satisfies GLTFExtensionHandler;

export const HILO_animation_clips = {
    parseOnEnd(extensionData: unknown, parser: GLTFParser, result: unknown): GLTFModel {
        if (!isGLTFModel(result))
            throw new TypeError('Animation clips require a parsed glTF model.');
        if (parser.isMultiAnim || !(result.anim instanceof Animation)) return result;
        if (!isRecord(extensionData)) throw new TypeError('Animation clips must be an object.');
        for (const [name, value] of Object.entries(extensionData)) {
            const range = requireNumberArray(value, `Animation clip ${name}`, 2);
            result.anim.addClip(name, range[0] ?? 0, range[1] ?? 0, result.anim.animStatesList);
        }
        return result;
    }
} satisfies GLTFExtensionHandler;

export const ALI_animation_clips = HILO_animation_clips;

export const ALI_bounding_box = {
    parseOnEnd(extensionData: unknown, _parser: GLTFParser, result: unknown): GLTFModel {
        if (!isGLTFModel(result)) throw new TypeError('Bounding box requires a parsed glTF model.');
        if (!isRecord(extensionData)) throw new TypeError('ALI_bounding_box must be an object.');
        const min = Array.from(requireNumberArray(extensionData['min'], 'Bounding box min', 3));
        const max = Array.from(requireNumberArray(extensionData['max'], 'Bounding box max', 3));
        const width = (max[0] ?? 0) - (min[0] ?? 0);
        const height = (max[1] ?? 0) - (min[1] ?? 0);
        const depth = (max[2] ?? 0) - (min[2] ?? 0);
        result.bounds = {
            min,
            max,
            center: [
                ((max[0] ?? 0) + (min[0] ?? 0)) / 2,
                ((max[1] ?? 0) + (min[1] ?? 0)) / 2,
                ((max[2] ?? 0) + (min[2] ?? 0)) / 2
            ],
            width,
            height,
            depth,
            size: Math.hypot(width, height, depth)
        };
        return result;
    }
} satisfies GLTFExtensionHandler;

function addUsedTexture(
    extensionData: unknown,
    property: string,
    map: Record<string, true>,
    label: string
): void {
    if (!isRecord(extensionData)) throw new TypeError(`${label} must be an object.`);
    const texture = optionalTextureInfo(extensionData, property, label);
    if (texture) map[String(texture.index)] = true;
}

export const KHR_materials_pbrSpecularGlossiness = {
    getUsedTextureNameMap(extensionData: unknown, map: Record<string, true>): void {
        addUsedTexture(extensionData, 'diffuseTexture', map, 'KHR_materials_pbrSpecularGlossiness');
        addUsedTexture(
            extensionData,
            'specularGlossinessTexture',
            map,
            'KHR_materials_pbrSpecularGlossiness'
        );
    },
    parse(extensionData: unknown, parser: GLTFParser, result: unknown): PBRMaterial {
        if (!isRecord(extensionData)) {
            throw new TypeError('KHR_materials_pbrSpecularGlossiness must be an object.');
        }
        const material = requirePBRMaterial(result, 'KHR_materials_pbrSpecularGlossiness');
        if (extensionData['diffuseFactor'] !== undefined) {
            material.baseColor.fromArray(
                requireNumberArray(
                    extensionData['diffuseFactor'],
                    'KHR_materials_pbrSpecularGlossiness.diffuseFactor',
                    4
                )
            );
        }
        const diffuseTexture = optionalTextureInfo(
            extensionData,
            'diffuseTexture',
            'KHR_materials_pbrSpecularGlossiness'
        );
        if (diffuseTexture) material.baseColorMap = parser.getTexture(diffuseTexture);
        if (extensionData['specularFactor'] !== undefined) {
            const specularFactor = requireNumberArray(
                extensionData['specularFactor'],
                'KHR_materials_pbrSpecularGlossiness.specularFactor',
                3
            );
            material.specular.set(
                requireNumber(specularFactor[0], 'specularFactor[0]'),
                requireNumber(specularFactor[1], 'specularFactor[1]'),
                requireNumber(specularFactor[2], 'specularFactor[2]'),
                1
            );
        }
        if (extensionData['glossinessFactor'] !== undefined) {
            material.glossiness = requireNumber(
                extensionData['glossinessFactor'],
                'KHR_materials_pbrSpecularGlossiness.glossinessFactor'
            );
        }
        const map = optionalTextureInfo(
            extensionData,
            'specularGlossinessTexture',
            'KHR_materials_pbrSpecularGlossiness'
        );
        if (map) material.specularGlossinessMap = parser.getTexture(map);
        material.isSpecularGlossiness = true;
        return material;
    }
} satisfies GLTFExtensionHandler;

export const KHR_materials_clearcoat = {
    getUsedTextureNameMap(extensionData: unknown, map: Record<string, true>): void {
        for (const name of [
            'clearcoatTexture',
            'clearcoatRoughnessTexture',
            'clearcoatNormalTexture'
        ]) {
            addUsedTexture(extensionData, name, map, 'KHR_materials_clearcoat');
        }
    },
    parse(extensionData: unknown, parser: GLTFParser, result: unknown): PBRMaterial {
        if (!isRecord(extensionData))
            throw new TypeError('KHR_materials_clearcoat must be an object.');
        const material = requirePBRMaterial(result, 'KHR_materials_clearcoat');
        if (extensionData['clearcoatFactor'] !== undefined) {
            material.clearcoatFactor = requireNumber(
                extensionData['clearcoatFactor'],
                'KHR_materials_clearcoat.clearcoatFactor'
            );
        }
        if (extensionData['clearcoatRoughnessFactor'] !== undefined) {
            material.clearcoatRoughnessFactor = requireNumber(
                extensionData['clearcoatRoughnessFactor'],
                'KHR_materials_clearcoat.clearcoatRoughnessFactor'
            );
        }
        const clearcoatMap = optionalTextureInfo(
            extensionData,
            'clearcoatTexture',
            'KHR_materials_clearcoat'
        );
        const roughnessMap = optionalTextureInfo(
            extensionData,
            'clearcoatRoughnessTexture',
            'KHR_materials_clearcoat'
        );
        const normalMap = optionalTextureInfo(
            extensionData,
            'clearcoatNormalTexture',
            'KHR_materials_clearcoat'
        );
        if (clearcoatMap) material.clearcoatMap = parser.getTexture(clearcoatMap);
        if (roughnessMap) material.clearcoatRoughnessMap = parser.getTexture(roughnessMap);
        if (normalMap) material.clearcoatNormalMap = parser.getTexture(normalMap);
        return material;
    }
} satisfies GLTFExtensionHandler;

function requireNode(value: unknown, label: string): Node {
    if (!(value instanceof Node)) throw new TypeError(`${label} requires a Node.`);
    return value;
}

function requirePunctualLightInfo(
    parser: GLTFParser,
    extensionData: unknown
): Record<string, unknown> {
    if (!isRecord(extensionData))
        throw new TypeError('KHR_lights_punctual node data must be an object.');
    const lightIndex = requireIndex(extensionData['light'], 'KHR_lights_punctual.light');
    const root = parser.json.extensions?.['KHR_lights_punctual'];
    if (!isRecord(root)) throw new TypeError('glTF root omits KHR_lights_punctual data.');
    const light = getCollectionValue(root['lights'], lightIndex);
    if (!isRecord(light)) {
        throw new RangeError(`KHR_lights_punctual light ${String(lightIndex)} does not exist.`);
    }
    return light;
}

export const KHR_lights_punctual = {
    parse(extensionData: unknown, parser: GLTFParser, result: unknown): Node {
        const node = requireNode(result, 'KHR_lights_punctual');
        const info = requirePunctualLightInfo(parser, extensionData);
        const type = info['type'];
        if (type !== 'directional' && type !== 'point' && type !== 'spot') {
            throw new RangeError(`KHR_lights_punctual type ${String(type)} is unsupported.`);
        }
        const colorValues =
            info['color'] === undefined
                ? [1, 1, 1]
                : requireNumberArray(info['color'], 'KHR_lights_punctual.color', 3);
        const color = new Color(colorValues[0] ?? 1, colorValues[1] ?? 1, colorValues[2] ?? 1, 1);
        const amount =
            info['intensity'] === undefined
                ? 1
                : requireNumber(info['intensity'], 'KHR_lights_punctual.intensity');
        if (amount < 0) throw new RangeError('KHR_lights_punctual.intensity must not be negative.');
        const range =
            info['range'] === undefined
                ? 0
                : requireNumber(info['range'], 'KHR_lights_punctual.range');
        if (range < 0) throw new RangeError('KHR_lights_punctual.range must not be negative.');
        const name = typeof info['name'] === 'string' ? info['name'] : '';

        if (type === 'directional') {
            const light = new DirectionalLight({ color, amount, name });
            light.direction.set(0, 0, -1);
            node.addChild(light);
            parser.lights.push(light);
        } else if (type === 'point') {
            const light = new PointLight({ color, amount, name, range });
            node.addChild(light);
            parser.lights.push(light);
        } else {
            const spot = info['spot'];
            if (spot !== undefined && !isRecord(spot)) {
                throw new TypeError('KHR_lights_punctual.spot must be an object.');
            }
            const inner =
                spot?.['innerConeAngle'] === undefined
                    ? 0
                    : requireNumber(spot['innerConeAngle'], 'KHR_lights_punctual.innerConeAngle');
            const outer =
                spot?.['outerConeAngle'] === undefined
                    ? Math.PI / 4
                    : requireNumber(spot['outerConeAngle'], 'KHR_lights_punctual.outerConeAngle');
            if (inner < 0 || outer <= inner || outer > Math.PI / 2) {
                throw new RangeError('KHR_lights_punctual spot cone angles are invalid.');
            }
            const light = new SpotLight({
                color,
                amount,
                name,
                range,
                cutoff: math.radToDeg(inner),
                outerCutoff: math.radToDeg(outer)
            });
            light.direction.set(0, 0, -1);
            node.addChild(light);
            parser.lights.push(light);
        }
        return node;
    }
} satisfies GLTFExtensionHandler;

function requireShader(value: Record<string, unknown>, label: string): TechniqueShader {
    const uri = value['uri'];
    if (typeof uri !== 'string' || !uri) throw new TypeError(`${label}.uri must be a string.`);
    return { uri };
}

function requireProgram(value: unknown, label: string): TechniqueProgram {
    if (!isRecord(value)) throw new TypeError(`${label} must be an object.`);
    const name = value['name'];
    if (name !== undefined && typeof name !== 'string')
        throw new TypeError(`${label}.name must be a string.`);
    return {
        fragmentShader: requireIndex(value['fragmentShader'], `${label}.fragmentShader`),
        vertexShader: requireIndex(value['vertexShader'], `${label}.vertexShader`),
        ...(typeof name === 'string' ? { name } : {})
    };
}

function readBindingMap(value: unknown, label: string): Record<string, TechniqueBindingDefinition> {
    if (value === undefined) return {};
    if (!isRecord(value)) throw new TypeError(`${label} must be an object.`);
    const result: Record<string, TechniqueBindingDefinition> = {};
    for (const [name, rawDefinition] of Object.entries(value)) {
        if (!isRecord(rawDefinition)) throw new TypeError(`${label}.${name} must be an object.`);
        const type = rawDefinition['type'];
        const semanticName = rawDefinition['semantic'];
        const node = rawDefinition['node'];
        if (type !== undefined && typeof type !== 'number') {
            throw new TypeError(`${label}.${name}.type must be a number.`);
        }
        if (semanticName !== undefined && typeof semanticName !== 'string') {
            throw new TypeError(`${label}.${name}.semantic must be a string.`);
        }
        if (node !== undefined && readIndex(node) === undefined) {
            throw new TypeError(`${label}.${name}.node must be a string or number.`);
        }
        result[name] = {
            ...(typeof type === 'number' ? { type } : {}),
            ...(typeof semanticName === 'string' ? { semantic: semanticName } : {}),
            ...(node === undefined ? {} : { node: requireIndex(node, `${label}.${name}.node`) }),
            ...('value' in rawDefinition ? { value: rawDefinition['value'] } : {})
        };
    }
    return result;
}

function requireTechnique(value: unknown, label: string): RuntimeTechnique {
    if (!isRecord(value)) throw new TypeError(`${label} must be an object.`);
    const uniforms = readBindingMap(value['uniforms'], `${label}.uniforms`);
    const textureInfos: Record<string, GLTFIndex> = {};
    for (const [name, definition] of Object.entries(uniforms)) {
        if (definition.type !== SAMPLER_2D || definition.value === undefined) continue;
        const index = readTextureIndex(definition.value);
        if (index === undefined) {
            throw new TypeError(`${label}.uniforms.${name}.value must reference a texture.`);
        }
        textureInfos[name] = index;
    }
    return {
        program: requireIndex(value['program'], `${label}.program`),
        attributes: readBindingMap(value['attributes'], `${label}.attributes`),
        uniforms,
        textureInfos
    };
}

function requireRuntimeTechnique(value: unknown, label: string): RuntimeTechnique {
    if (!isRecord(value)) throw new TypeError(`${label} is missing.`);
    return requireTechnique(value, label);
}

function readTextureIndex(value: unknown): GLTFIndex | undefined {
    if (isRecord(value)) return readIndex(value['index']);
    return readIndex(value);
}

function readTechniqueMaterialInfo(value: unknown): TechniqueMaterialInfo {
    if (!isRecord(value))
        throw new TypeError('KHR_techniques_webgl material data must be an object.');
    const values = value['values'];
    if (values !== undefined && !isRecord(values)) {
        throw new TypeError('KHR_techniques_webgl.values must be an object.');
    }
    const premultiplyAlpha = value['premultiplyAlpha'];
    if (premultiplyAlpha !== undefined && typeof premultiplyAlpha !== 'boolean') {
        throw new TypeError('KHR_techniques_webgl.premultiplyAlpha must be boolean.');
    }
    const definesValue = value['defines'];
    let defines: ShaderOptions | undefined;
    if (definesValue !== undefined) {
        if (!isRecord(definesValue))
            throw new TypeError('KHR_techniques_webgl.defines must be an object.');
        defines = {};
        for (const [name, define] of Object.entries(definesValue)) {
            if (
                typeof define !== 'string' &&
                typeof define !== 'number' &&
                typeof define !== 'boolean'
            ) {
                throw new TypeError(`KHR_techniques_webgl define ${name} has an invalid value.`);
            }
            defines[name] = define;
        }
    }
    return {
        technique: requireIndex(value['technique'], 'KHR_techniques_webgl.technique'),
        values: values ?? {},
        ...(typeof premultiplyAlpha === 'boolean' ? { premultiplyAlpha } : {}),
        ...(defines ? { defines } : {})
    };
}

function requireSemanticGetter(name: string): Record<string, unknown> {
    const value: unknown = Reflect.get(semantic, name);
    if (!isRecord(value) || typeof value['get'] !== 'function') {
        throw new RangeError(`KHR_techniques_webgl semantic ${name} is unsupported.`);
    }
    return value;
}

function semanticBinding(
    semanticName: string,
    nodeId: GLTFIndex,
    parser: GLTFParser
): MaterialBindingInfo {
    const entry = requireSemanticGetter(semanticName);
    let target: Node | null = null;
    return {
        get(mesh: Mesh, material: Material, programInfo: ProgramBindingInfo): unknown {
            target ??= parser.node.getChildByFn(node => node.animationId === String(nodeId));
            const getter = entry['get'];
            if (typeof getter !== 'function') {
                throw new TypeError(`Semantic ${semanticName} no longer exposes a getter.`);
            }
            return Reflect.apply(getter, entry, [target ?? mesh, material, programInfo]);
        }
    };
}

function textureBinding(textureIndex: GLTFIndex, parser: GLTFParser): MaterialBindingInfo {
    const texture = parser.textures[String(textureIndex)];
    if (!texture)
        throw new RangeError(`KHR_techniques_webgl texture ${String(textureIndex)} is missing.`);
    return {
        get(_mesh: Mesh, _material: Material, programInfo: ProgramBindingInfo): unknown {
            return semantic.handlerTexture(texture, programInfo.textureIndex ?? 0);
        }
    };
}

export const KHR_techniques_webgl = {
    async init(loader: GLTFResourceLoader, parser: GLTFParser): Promise<void> {
        const rootValue = parser.json.extensions?.['KHR_techniques_webgl'];
        if (!isRecord(rootValue)) throw new TypeError('glTF root omits KHR_techniques_webgl data.');
        parser.shaders = {};
        await Promise.all(
            collectionEntries(rootValue['shaders'], 'KHR_techniques_webgl.shaders').map(
                async ([name, rawShader]) => {
                    const shader = requireShader(rawShader, `KHR_techniques_webgl shader ${name}`);
                    let uri = util.getRelativePath(parser.src, shader.uri);
                    if (parser.preHandlerShaderURI)
                        uri = parser.preHandlerShaderURI(uri, name, rawShader);
                    const source = await loader.loadRes(uri, BasicLoader.TYPE_TEXT);
                    if (typeof source !== 'string') {
                        throw new TypeError(
                            `KHR_techniques_webgl shader ${name} did not load as text.`
                        );
                    }
                    parser.shaders[name] = source;
                }
            )
        );

        parser.programs = {};
        for (const [name, program] of collectionEntries(
            rootValue['programs'],
            'KHR_techniques_webgl.programs'
        )) {
            parser.programs[name] = requireProgram(program, `KHR_techniques_webgl program ${name}`);
        }
        parser.techniques = {};
        for (const [name, technique] of collectionEntries(
            rootValue['techniques'],
            'KHR_techniques_webgl.techniques'
        )) {
            parser.techniques[name] = requireTechnique(
                technique,
                `KHR_techniques_webgl technique ${name}`
            );
        }
    },
    getUsedTextureNameMap(
        extensionData: unknown,
        map: Record<string, true>,
        parser: GLTFParser
    ): void {
        const info = readTechniqueMaterialInfo(extensionData);
        const technique = requireRuntimeTechnique(
            parser.techniques[String(info.technique)],
            `KHR_techniques_webgl technique ${String(info.technique)}`
        );
        for (const [name, defaultTexture] of Object.entries(technique.textureInfos)) {
            const texture =
                info.values[name] === undefined
                    ? defaultTexture
                    : readTextureIndex(info.values[name]);
            if (texture === undefined) {
                throw new TypeError(
                    `KHR_techniques_webgl uniform ${name} must reference a texture.`
                );
            }
            map[String(texture)] = true;
        }
    },
    parse(extensionData: unknown, parser: GLTFParser): ShaderMaterial {
        const info = readTechniqueMaterialInfo(extensionData);
        const technique = requireRuntimeTechnique(
            parser.techniques[String(info.technique)],
            `KHR_techniques_webgl technique ${String(info.technique)}`
        );
        const program = requireProgram(
            parser.programs[String(technique.program)],
            `KHR_techniques_webgl program ${String(technique.program)}`
        );
        const fragmentText = parser.shaders[String(program.fragmentShader)];
        const vertexText = parser.shaders[String(program.vertexShader)];
        if (fragmentText === undefined || vertexText === undefined) {
            throw new RangeError('KHR_techniques_webgl program references a missing shader.');
        }

        const uniforms: MaterialBindingMap = {};
        for (const [name, definition] of Object.entries(technique.uniforms)) {
            const value = info.values[name] === undefined ? definition.value : info.values[name];
            if (value !== undefined) {
                if (definition.type === SAMPLER_2D) {
                    const texture = readTextureIndex(value);
                    if (texture === undefined) {
                        throw new TypeError(
                            `KHR_techniques_webgl uniform ${name} requires a texture.`
                        );
                    }
                    uniforms[name] = textureBinding(texture, parser);
                } else uniforms[name] = { get: () => value };
            } else if (definition.semantic) {
                requireSemanticGetter(definition.semantic);
                uniforms[name] =
                    definition.node === undefined
                        ? definition.semantic
                        : semanticBinding(definition.semantic, definition.node, parser);
            } else {
                throw new TypeError(
                    `KHR_techniques_webgl uniform ${name} has no value or semantic.`
                );
            }
        }

        const attributes: MaterialBindingMap = {};
        for (const [name, definition] of Object.entries(technique.attributes)) {
            if (!definition.semantic) {
                throw new TypeError(`KHR_techniques_webgl attribute ${name} has no semantic.`);
            }
            requireSemanticGetter(definition.semantic);
            attributes[name] = definition.semantic;
        }

        const material = new ShaderMaterial({
            needBasicUnifroms: false,
            needBasicAttributes: false,
            useHeaderCache: true,
            premultiplyAlpha: info.premultiplyAlpha ?? false,
            vs: vertexText,
            fs: fragmentText,
            attributes,
            uniforms
        });
        if (info.defines) material.getCustomRenderOption = () => ({ ...info.defines });
        if (program.name !== undefined) {
            material.shaderName = program.name;
            material.shaderCacheId = `KHR_techniques_webgl_${program.name}`;
        }
        return material;
    }
} satisfies GLTFExtensionHandler;

// Kept as exported type aliases for consumers that model extension JSON themselves.
export type GLTFTechniqueCollection<Value> = GLTFCollection<Value>;
export type GLTFTechniqueExtensions = GLTFExtensionMap;
