import Animation from '../animation/Animation';
import Node from '../core/Node';
import GeometryData, { type GeometryAttributeValue } from '../geometry/GeometryData';
import DirectionalLight from '../light/DirectionalLight';
import PointLight from '../light/PointLight';
import SpotLight from '../light/SpotLight';
import PBRMaterial from '../material/PBRMaterial';
import Color from '../math/Color';
import math from '../math/math';
import type { GLTFExtensionHandler, GLTFExtensionOptions } from './GLTFParser';
import type GLTFParser from './GLTFParser';
import type { GLTFIndex, GLTFModel, GLTFTextureInfo } from './GLTFTypes';

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

function requireRange(
    value: unknown,
    label: string,
    minimum: number,
    maximum = Number.POSITIVE_INFINITY
): number {
    const number = requireNumber(value, label);
    if (number < minimum || number > maximum) {
        throw new RangeError(`${label} must be in [${String(minimum)}, ${String(maximum)}].`);
    }
    return number;
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
            material.clearcoatFactor = requireRange(
                extensionData['clearcoatFactor'],
                'KHR_materials_clearcoat.clearcoatFactor',
                0,
                1
            );
        }
        if (extensionData['clearcoatRoughnessFactor'] !== undefined) {
            material.clearcoatRoughnessFactor = requireRange(
                extensionData['clearcoatRoughnessFactor'],
                'KHR_materials_clearcoat.clearcoatRoughnessFactor',
                0,
                1
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
        if (normalMap) {
            material.clearcoatNormalMap = parser.getTexture(normalMap);
            material.clearcoatNormalScale = normalMap.scale ?? 1;
        }
        return material;
    }
} satisfies GLTFExtensionHandler;

export const KHR_materials_anisotropy = {
    getUsedTextureNameMap(extensionData: unknown, map: Record<string, true>): void {
        addUsedTexture(extensionData, 'anisotropyTexture', map, 'KHR_materials_anisotropy');
    },
    parse(extensionData: unknown, parser: GLTFParser, result: unknown): PBRMaterial {
        if (!isRecord(extensionData)) {
            throw new TypeError('KHR_materials_anisotropy must be an object.');
        }
        const material = requirePBRMaterial(result, 'KHR_materials_anisotropy');
        if (extensionData['anisotropyStrength'] !== undefined) {
            material.anisotropyStrength = requireRange(
                extensionData['anisotropyStrength'],
                'KHR_materials_anisotropy.anisotropyStrength',
                0,
                1
            );
        }
        if (extensionData['anisotropyRotation'] !== undefined) {
            material.anisotropyRotation = requireNumber(
                extensionData['anisotropyRotation'],
                'KHR_materials_anisotropy.anisotropyRotation'
            );
        }
        const texture = optionalTextureInfo(
            extensionData,
            'anisotropyTexture',
            'KHR_materials_anisotropy'
        );
        if (texture) material.anisotropyMap = parser.getTexture(texture);
        return material;
    }
} satisfies GLTFExtensionHandler;

export const KHR_materials_transmission = {
    getUsedTextureNameMap(extensionData: unknown, map: Record<string, true>): void {
        addUsedTexture(extensionData, 'transmissionTexture', map, 'KHR_materials_transmission');
    },
    parse(extensionData: unknown, parser: GLTFParser, result: unknown): PBRMaterial {
        if (!isRecord(extensionData)) {
            throw new TypeError('KHR_materials_transmission must be an object.');
        }
        const material = requirePBRMaterial(result, 'KHR_materials_transmission');
        if (extensionData['transmissionFactor'] !== undefined) {
            material.transmissionFactor = requireRange(
                extensionData['transmissionFactor'],
                'KHR_materials_transmission.transmissionFactor',
                0,
                1
            );
        }
        const texture = optionalTextureInfo(
            extensionData,
            'transmissionTexture',
            'KHR_materials_transmission'
        );
        if (texture) material.transmissionMap = parser.getTexture(texture);
        return material;
    }
} satisfies GLTFExtensionHandler;

export const KHR_materials_volume = {
    getUsedTextureNameMap(extensionData: unknown, map: Record<string, true>): void {
        addUsedTexture(extensionData, 'thicknessTexture', map, 'KHR_materials_volume');
    },
    parse(extensionData: unknown, parser: GLTFParser, result: unknown): PBRMaterial {
        if (!isRecord(extensionData)) {
            throw new TypeError('KHR_materials_volume must be an object.');
        }
        const material = requirePBRMaterial(result, 'KHR_materials_volume');
        if (extensionData['thicknessFactor'] !== undefined) {
            material.thicknessFactor = requireRange(
                extensionData['thicknessFactor'],
                'KHR_materials_volume.thicknessFactor',
                0
            );
        }
        if (extensionData['attenuationDistance'] !== undefined) {
            material.attenuationDistance = requireRange(
                extensionData['attenuationDistance'],
                'KHR_materials_volume.attenuationDistance',
                Number.MIN_VALUE
            );
        }
        if (extensionData['attenuationColor'] !== undefined) {
            const color = requireNumberArray(
                extensionData['attenuationColor'],
                'KHR_materials_volume.attenuationColor',
                3
            );
            material.attenuationColor.set(
                requireRange(color[0], 'KHR_materials_volume.attenuationColor[0]', 0, 1),
                requireRange(color[1], 'KHR_materials_volume.attenuationColor[1]', 0, 1),
                requireRange(color[2], 'KHR_materials_volume.attenuationColor[2]', 0, 1),
                1
            );
        }
        const texture = optionalTextureInfo(
            extensionData,
            'thicknessTexture',
            'KHR_materials_volume'
        );
        if (texture) material.thicknessMap = parser.getTexture(texture);
        return material;
    }
} satisfies GLTFExtensionHandler;

export const KHR_materials_ior = {
    parse(extensionData: unknown, _parser: GLTFParser, result: unknown): PBRMaterial {
        if (!isRecord(extensionData)) {
            throw new TypeError('KHR_materials_ior must be an object.');
        }
        const material = requirePBRMaterial(result, 'KHR_materials_ior');
        if (extensionData['ior'] !== undefined) {
            material.ior = requireRange(extensionData['ior'], 'KHR_materials_ior.ior', 1);
        }
        return material;
    }
} satisfies GLTFExtensionHandler;

export const KHR_materials_iridescence = {
    getUsedTextureNameMap(extensionData: unknown, map: Record<string, true>): void {
        addUsedTexture(extensionData, 'iridescenceTexture', map, 'KHR_materials_iridescence');
        addUsedTexture(
            extensionData,
            'iridescenceThicknessTexture',
            map,
            'KHR_materials_iridescence'
        );
    },
    parse(extensionData: unknown, parser: GLTFParser, result: unknown): PBRMaterial {
        if (!isRecord(extensionData)) {
            throw new TypeError('KHR_materials_iridescence must be an object.');
        }
        const material = requirePBRMaterial(result, 'KHR_materials_iridescence');
        if (extensionData['iridescenceFactor'] !== undefined) {
            material.iridescenceFactor = requireRange(
                extensionData['iridescenceFactor'],
                'KHR_materials_iridescence.iridescenceFactor',
                0,
                1
            );
        }
        if (extensionData['iridescenceIor'] !== undefined) {
            material.iridescenceIor = requireRange(
                extensionData['iridescenceIor'],
                'KHR_materials_iridescence.iridescenceIor',
                1
            );
        }
        if (extensionData['iridescenceThicknessMinimum'] !== undefined) {
            material.iridescenceThicknessMinimum = requireRange(
                extensionData['iridescenceThicknessMinimum'],
                'KHR_materials_iridescence.iridescenceThicknessMinimum',
                0
            );
        }
        if (extensionData['iridescenceThicknessMaximum'] !== undefined) {
            material.iridescenceThicknessMaximum = requireRange(
                extensionData['iridescenceThicknessMaximum'],
                'KHR_materials_iridescence.iridescenceThicknessMaximum',
                0
            );
        }
        const factorMap = optionalTextureInfo(
            extensionData,
            'iridescenceTexture',
            'KHR_materials_iridescence'
        );
        const thicknessMap = optionalTextureInfo(
            extensionData,
            'iridescenceThicknessTexture',
            'KHR_materials_iridescence'
        );
        if (factorMap) material.iridescenceMap = parser.getTexture(factorMap);
        if (thicknessMap) material.iridescenceThicknessMap = parser.getTexture(thicknessMap);
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
