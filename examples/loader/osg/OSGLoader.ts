import BasicLoader from '../../../src/loader/BasicLoader';
import Geometry from '../../../src/geometry/Geometry';
import GeometryData, { type GeometryComponentSize } from '../../../src/geometry/GeometryData';
import BasicMaterial from '../../../src/material/BasicMaterial';
import type Material from '../../../src/material/Material';
import PBRMaterial from '../../../src/material/PBRMaterial';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import LazyTexture from '../../../src/texture/LazyTexture';
import { TRIANGLES, TRIANGLE_STRIP } from '../../../src/constants/webgl';
import { getRelativePath } from '../../../src/utils/util';
import type { TypedArray } from '../../../src/render/types';

type JsonObject = Record<string, unknown>;
type OSGArray = Float32Array | Int32Array | Uint16Array | Uint32Array;
type OSGIntegerArray = Int32Array | Uint16Array | Uint32Array;
type ArrayKind = 'Float32Array' | 'Int32Array' | 'Uint16Array' | 'Uint32Array';

interface ArrayDescriptor {
    readonly kind: ArrayKind;
    readonly file: string;
    readonly size: number;
    readonly offset: number;
    readonly encoding: string | null;
}

interface TextureChannel {
    readonly internalFormat?: string;
    readonly magFilter?: string;
    readonly minFilter?: string;
    readonly wrapS?: string;
    readonly wrapT?: string;
    readonly factor?: number;
    readonly texture: {
        readonly image: string;
        readonly uid?: string;
        readonly name?: string;
    };
}

export interface OSGMaterialInfo {
    readonly name?: string;
    readonly isPBR?: boolean;
    readonly reflection?: number;
    readonly transparency?: TextureChannel;
    readonly baseColor?: unknown;
    readonly emission?: unknown;
    readonly ao?: unknown;
    readonly diffuse?: TextureChannel;
    readonly normalMap?: TextureChannel;
    readonly metallic?: unknown;
    readonly specular?: TextureChannel;
}

export interface OSGLoadRequest {
    readonly src: string;
    readonly materials?: Readonly<Record<string, OSGMaterialInfo>>;
}

export interface OSGModel {
    readonly node: Node;
}

interface DecodedAttribute {
    readonly data: TypedArray;
    readonly size: GeometryComponentSize;
}

const VERTEX_QUANTIZATION = 1;
const VERTEX_PREDICTION = 2;
const TRIANGLE_DELTA = 1;
const TRIANGLE_HIGH_WATERMARK = 2;
const TRIANGLE_IMPLICIT = 4;
const IMPLICIT_PRIMITIVE_LENGTH = 0;
const IMPLICIT_MASK_LENGTH = 1;
const IMPLICIT_EXPECTED_INDEX = 2;
const IMPLICIT_HEADER_LENGTH = 3;
const NORMAL_CACHE_SIZE = 1_801_779;

function jsonObject(value: unknown, label: string): JsonObject {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError(`${label} must be an object.`);
    }
    const result: JsonObject = {};
    for (const key of Object.keys(value)) result[key] = Reflect.get(value, key);
    return result;
}

function jsonArray(value: unknown, label: string): unknown[] {
    if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
    return value;
}

function jsonString(value: unknown, label: string): string {
    if (typeof value !== 'string') throw new TypeError(`${label} must be a string.`);
    return value;
}

function jsonNumber(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`${label} must be a finite number.`);
    }
    return value;
}

function jsonInteger(value: unknown, label: string): number {
    const result = jsonNumber(value, label);
    if (!Number.isInteger(result) || result < 0) {
        throw new TypeError(`${label} must be a non-negative integer.`);
    }
    return result;
}

function numberArray(value: unknown, label: string): number[] {
    return jsonArray(value, label).map((item, index) =>
        jsonNumber(item, `${label}[${String(index)}]`)
    );
}

function componentSize(value: unknown, label: string): GeometryComponentSize {
    const size = jsonInteger(value, label);
    if (size !== 1 && size !== 2 && size !== 3 && size !== 4 && size !== 16) {
        throw new RangeError(`${label} has unsupported component size ${String(size)}.`);
    }
    return size;
}

function arrayValue(data: ArrayLike<number>, index: number, label: string): number {
    const value = data[index];
    if (value === undefined)
        throw new RangeError(`${label} is truncated at index ${String(index)}.`);
    return value;
}

function isIntegerArray(value: TypedArray): value is OSGIntegerArray {
    return (
        value instanceof Int32Array || value instanceof Uint16Array || value instanceof Uint32Array
    );
}

function parseArrayDescriptor(info: JsonObject, label: string): ArrayDescriptor {
    const array = jsonObject(info['Array'], `${label}.Array`);
    const kinds = ['Float32Array', 'Int32Array', 'Uint16Array', 'Uint32Array'] as const;
    for (const kind of kinds) {
        const candidate = array[kind];
        if (candidate === undefined) continue;
        const descriptor = jsonObject(candidate, `${label}.Array.${kind}`);
        const encoding = descriptor['Encoding'];
        return {
            kind,
            file: jsonString(descriptor['File'], `${label}.Array.${kind}.File`),
            size: jsonInteger(descriptor['Size'], `${label}.Array.${kind}.Size`),
            offset: jsonInteger(descriptor['Offset'], `${label}.Array.${kind}.Offset`),
            encoding:
                encoding === undefined
                    ? null
                    : jsonString(encoding, `${label}.Array.${kind}.Encoding`)
        };
    }
    throw new TypeError(`${label}.Array does not contain a supported typed array.`);
}

function createArray(
    kind: ArrayKind,
    bufferOrLength: ArrayBuffer | number,
    offset = 0,
    length?: number
): OSGArray {
    if (typeof bufferOrLength === 'number') {
        switch (kind) {
            case 'Float32Array':
                return new Float32Array(bufferOrLength);
            case 'Int32Array':
                return new Int32Array(bufferOrLength);
            case 'Uint16Array':
                return new Uint16Array(bufferOrLength);
            case 'Uint32Array':
                return new Uint32Array(bufferOrLength);
        }
    }
    switch (kind) {
        case 'Float32Array':
            return new Float32Array(bufferOrLength, offset, length);
        case 'Int32Array':
            return new Int32Array(bufferOrLength, offset, length);
        case 'Uint16Array':
            return new Uint16Array(bufferOrLength, offset, length);
        case 'Uint32Array':
            return new Uint32Array(bufferOrLength, offset, length);
    }
}

function decodeVarint(source: Uint8Array, kind: ArrayKind, count: number): OSGArray {
    const result = createArray(kind, count);
    const signed = kind === 'Int32Array' || kind === 'Float32Array';
    let sourceIndex = 0;
    for (let index = 0; index < count; index += 1) {
        let encoded = 0;
        let shift = 0;
        let byte: number;
        do {
            byte = arrayValue(source, sourceIndex, 'OSG varint stream');
            sourceIndex += 1;
            encoded |= (byte & 0x7f) << shift;
            shift += 7;
            if (shift > 35) throw new RangeError('OSG varint exceeds 32 bits.');
        } while ((byte & 0x80) !== 0);
        result[index] = signed ? (encoded >> 1) ^ -(encoded & 1) : encoded;
    }
    return result;
}

function decodeDelta(data: OSGArray, start: number): void {
    if (start >= data.length) return;
    let previous = arrayValue(data, start, 'delta stream');
    for (let index = start + 1; index < data.length; index += 1) {
        const encoded = arrayValue(data, index, 'delta stream');
        const value = previous + ((encoded >> 1) ^ -(encoded & 1));
        data[index] = value;
        previous = value;
    }
}

function decodeImplicit(
    data: OSGIntegerArray,
    result: OSGIntegerArray,
    start: number,
    useHighWatermark: boolean
): void {
    let expected = arrayValue(data, IMPLICIT_EXPECTED_INDEX, 'implicit header');
    const maskLength = arrayValue(data, IMPLICIT_MASK_LENGTH, 'implicit header');
    const masks = new Uint32Array(maskLength);
    for (let index = 0; index < maskLength; index += 1) {
        masks[index] = arrayValue(data, index + IMPLICIT_HEADER_LENGTH, 'implicit mask');
    }
    const unusedBits = 32 * maskLength - result.length;
    for (let maskIndex = 0; maskIndex < maskLength; maskIndex += 1) {
        const mask = arrayValue(masks, maskIndex, 'implicit mask');
        let targetIndex = 32 * maskIndex;
        const firstBit = maskIndex === maskLength - 1 ? unusedBits : 0;
        for (let bit = firstBit; bit < 32; bit += 1, targetIndex += 1) {
            const isExplicit = (mask & ((1 << 31) >>> bit)) !== 0;
            result[targetIndex] = isExplicit
                ? arrayValue(data, start++, 'implicit index data')
                : expected;
            if (!isExplicit && !useHighWatermark) expected += 1;
        }
    }
}

function decodeHighWatermark(data: OSGIntegerArray, highWatermark: [number]): void {
    let next = highWatermark[0];
    for (let index = 0; index < data.length; index += 1) {
        const value = next - arrayValue(data, index, 'high-watermark stream');
        data[index] = value;
        if (next <= value) next = value + 1;
    }
    highWatermark[0] = next;
}

function decodePredictedAttribute(
    data: OSGArray,
    itemSize: number,
    indices: OSGIntegerArray
): void {
    const vertexCount = data.length / itemSize;
    const visited = new Uint8Array(vertexCount);
    for (let index = 0; index < Math.min(3, indices.length); index += 1) {
        visited[arrayValue(indices, index, 'prediction indices')] = 1;
    }
    for (let index = 2; index < indices.length - 1; index += 1) {
        let previous = arrayValue(indices, index - 2, 'prediction indices');
        let first = arrayValue(indices, index - 1, 'prediction indices');
        let second = arrayValue(indices, index, 'prediction indices');
        let target = arrayValue(indices, index + 1, 'prediction indices');
        if (visited[target] === 1) continue;
        visited[target] = 1;
        previous *= itemSize;
        first *= itemSize;
        second *= itemSize;
        target *= itemSize;
        for (let component = 0; component < itemSize; component += 1) {
            data[target + component] =
                arrayValue(data, target + component, 'predicted attribute') +
                arrayValue(data, first + component, 'predicted attribute') +
                arrayValue(data, second + component, 'predicted attribute') -
                arrayValue(data, previous + component, 'predicted attribute');
        }
    }
}

function dequantizeAttribute(
    data: OSGArray,
    itemSize: number,
    name: 'POSITION' | 'UV',
    controls: Readonly<Record<string, number>>
): Float32Array {
    const prefix = name === 'POSITION' ? 'vtx_' : 'uv_0_';
    const requiredControl = (suffix: string): number => {
        const value = controls[`${prefix}${suffix}`];
        if (value === undefined) {
            throw new TypeError(`OSG ${name} quantization metadata is missing ${prefix}${suffix}.`);
        }
        return value;
    };
    const lowerBounds: number[] = [requiredControl('bbl_x'), requiredControl('bbl_y')];
    const steps: number[] = [requiredControl('h_x'), requiredControl('h_y')];
    if (itemSize === 3) {
        lowerBounds.push(requiredControl('bbl_z'));
        steps.push(requiredControl('h_z'));
    }
    const result = new Float32Array(data.length);
    for (let index = 0; index < data.length; index += 1) {
        const component = index % itemSize;
        result[index] =
            arrayValue(lowerBounds, component, `${name} lower bounds`) +
            arrayValue(data, index, `${name} quantized data`) *
                arrayValue(steps, component, `${name} quantization steps`);
    }
    return result;
}

function createNormalTable(): Float32Array {
    const table = new Float32Array(NORMAL_CACHE_SIZE);
    table.fill(Number.POSITIVE_INFINITY);
    return table;
}

function decodeNormals(
    data: OSGArray,
    epsilon: number,
    nphi: number,
    table: Float32Array
): Float32Array {
    const result = new Float32Array((data.length / 2) * 3);
    const cosineEpsilon = Math.cos((Math.PI / 180) * epsilon);
    const thetaStep = Math.PI / (nphi - 1);
    const thetaOffset = Math.PI / 2 / (nphi - 1);
    for (let index = 0; index < data.length / 2; index += 1) {
        const sourceIndex = index * 2;
        const targetIndex = index * 3;
        const theta = arrayValue(data, sourceIndex, 'normal stream');
        const phi = arrayValue(data, sourceIndex + 1, 'normal stream');
        const cacheIndex = 3 * (theta + nphi * phi);
        const cached = cacheIndex >= 0 && cacheIndex + 2 < table.length;
        if (cached && table[cacheIndex] !== Number.POSITIVE_INFINITY) {
            result[targetIndex] = arrayValue(table, cacheIndex, 'normal cache');
            result[targetIndex + 1] = arrayValue(table, cacheIndex + 1, 'normal cache');
            result[targetIndex + 2] = arrayValue(table, cacheIndex + 2, 'normal cache');
            continue;
        }
        const thetaRadians = theta * thetaStep;
        const cosineTheta = Math.cos(thetaRadians);
        const sineTheta = Math.sin(thetaRadians);
        const denominator = Math.max(1e-5, sineTheta * Math.sin(thetaRadians + thetaOffset));
        const rawArc =
            (cosineEpsilon - cosineTheta * Math.cos(thetaRadians + thetaOffset)) / denominator;
        const arc = Math.min(1, Math.max(-1, rawArc));
        const longitude = (Math.PI * 2 * phi) / Math.ceil(Math.PI / Math.max(1e-5, Math.acos(arc)));
        const x = sineTheta * Math.cos(longitude);
        const y = sineTheta * Math.sin(longitude);
        const z = cosineTheta;
        result.set([x, y, z], targetIndex);
        if (cached) table.set([x, y, z], cacheIndex);
    }
    return result;
}

/** Strict ESM decoder for the optimized osgjs geometry used by the local sample asset. */
export default class OSGLoader {
    private readonly resourceLoader = new BasicLoader();
    private readonly geometryData = new Map<number, GeometryData>();
    private readonly materialCache = new WeakMap<OSGMaterialInfo, Material>();
    private readonly normalTable = createNormalTable();

    private getMaterial(materialInfo: OSGMaterialInfo | undefined): Material {
        if (!materialInfo?.isPBR) return new BasicMaterial();
        const cached = this.materialCache.get(materialInfo);
        if (cached) return cached;
        if (!materialInfo.diffuse || !materialInfo.specular) {
            throw new TypeError('The OSG PBR material requires diffuse and specular textures.');
        }
        const material = new PBRMaterial({
            baseColorMap: new LazyTexture({
                flipY: true,
                src: materialInfo.diffuse.texture.image
            }),
            normalMap: materialInfo.normalMap
                ? new LazyTexture({ flipY: true, src: materialInfo.normalMap.texture.image })
                : null,
            isSpecularGlossiness: true,
            specularGlossinessMap: new LazyTexture({
                flipY: true,
                src: materialInfo.specular.texture.image
            })
        });
        this.materialCache.set(materialInfo, material);
        return material;
    }

    private parseControls(data: JsonObject): {
        values: Record<string, number>;
        highWatermark: [number];
        primitiveMode: number;
    } {
        const values: Record<string, number> = {};
        const container = data['UserDataContainer'];
        if (container !== undefined) {
            const entries = jsonArray(
                jsonObject(container, 'UserDataContainer')['Values'],
                'UserDataContainer.Values'
            );
            for (const entry of entries) {
                const item = jsonObject(entry, 'UserDataContainer value');
                const name = jsonString(item['Name'], 'UserDataContainer value name');
                const rawValue = item['Value'];
                const value = typeof rawValue === 'number' ? rawValue : Number(rawValue);
                if (Number.isFinite(value)) values[name] = value;
            }
        }
        return { values, highWatermark: [0], primitiveMode: TRIANGLES };
    }

    private decodeGeometryData(
        name: 'INDICES' | 'NORMAL' | 'POSITION' | 'UV',
        info: JsonObject,
        buffers: ReadonlyMap<string, ArrayBuffer>,
        controls: ReturnType<OSGLoader['parseControls']>,
        indices?: OSGIntegerArray
    ): GeometryData {
        const uniqueId = jsonInteger(info['UniqueID'], `${name}.UniqueID`);
        const cached = this.geometryData.get(uniqueId);
        if (cached) return cached;
        const size = componentSize(info['ItemSize'], `${name}.ItemSize`);
        const descriptor = parseArrayDescriptor(info, name);
        const buffer = buffers.get(descriptor.file);
        if (!buffer) throw new Error(`OSG buffer ${descriptor.file} was not loaded.`);

        let decoded: DecodedAttribute;
        if (!descriptor.encoding) {
            decoded = {
                data: createArray(
                    descriptor.kind,
                    buffer,
                    descriptor.offset,
                    descriptor.size * size
                ),
                size
            };
        } else {
            const data = decodeVarint(
                new Uint8Array(buffer, descriptor.offset),
                descriptor.kind,
                descriptor.size * size
            );
            if (name === 'INDICES') {
                if (!isIntegerArray(data))
                    throw new TypeError('OSG indices must use integer data.');
                const triangleMode = controls.values['triangle_mode'] ?? 0;
                const isTriangleStrip = controls.primitiveMode === TRIANGLE_STRIP;
                let start = 0;
                let indexData = data;
                if ((triangleMode & TRIANGLE_IMPLICIT) !== 0 && isTriangleStrip) {
                    start =
                        IMPLICIT_HEADER_LENGTH +
                        arrayValue(data, IMPLICIT_MASK_LENGTH, 'implicit header');
                    const length = arrayValue(data, IMPLICIT_PRIMITIVE_LENGTH, 'implicit header');
                    const implicit = createArray(descriptor.kind, length);
                    if (!isIntegerArray(implicit)) {
                        throw new TypeError('Implicit OSG indices must use integer data.');
                    }
                    indexData = implicit;
                }
                if ((triangleMode & TRIANGLE_DELTA) !== 0) decodeDelta(data, start);
                if ((triangleMode & TRIANGLE_IMPLICIT) !== 0 && isTriangleStrip) {
                    decodeImplicit(
                        data,
                        indexData,
                        start,
                        (triangleMode & TRIANGLE_HIGH_WATERMARK) !== 0
                    );
                }
                if ((triangleMode & TRIANGLE_HIGH_WATERMARK) !== 0) {
                    decodeHighWatermark(indexData, controls.highWatermark);
                }
                decoded = { data: indexData, size };
            } else if (name === 'NORMAL') {
                decoded = {
                    data: decodeNormals(
                        data,
                        controls.values['epsilon'] ?? 0.25,
                        controls.values['nphi'] ?? 720,
                        this.normalTable
                    ),
                    size: 3
                };
            } else {
                if (!indices) throw new TypeError(`${name} decoding requires triangle indices.`);
                const mode =
                    name === 'POSITION'
                        ? (controls.values['vertex_mode'] ?? 0)
                        : (controls.values['uv_0_mode'] ?? 0);
                if ((mode & VERTEX_PREDICTION) !== 0) {
                    decodePredictedAttribute(data, size, indices);
                }
                decoded = {
                    data:
                        (mode & VERTEX_QUANTIZATION) !== 0
                            ? dequantizeAttribute(data, size, name, controls.values)
                            : data,
                    size
                };
            }
        }
        const result = new GeometryData(decoded.data, decoded.size);
        this.geometryData.set(uniqueId, result);
        return result;
    }

    private parseGeometry(
        parent: Node,
        data: JsonObject,
        buffers: ReadonlyMap<string, ArrayBuffer>,
        materialInfo: OSGMaterialInfo | undefined
    ): void {
        const material = this.getMaterial(materialInfo);
        const controls = this.parseControls(data);
        const attributes = jsonObject(data['VertexAttributeList'], 'VertexAttributeList');
        const primitiveSets = jsonArray(data['PrimitiveSetList'], 'PrimitiveSetList');
        for (const primitiveSet of primitiveSets) {
            const set = jsonObject(primitiveSet, 'PrimitiveSet');
            const rawDrawInfo = set['DrawElementsUShort'] ?? set['DrawElementsUInt'];
            if (rawDrawInfo === undefined) {
                throw new TypeError('OSG geometry contains an unsupported primitive set.');
            }
            const drawInfo = jsonObject(rawDrawInfo, 'DrawElements');
            const mode = jsonString(drawInfo['Mode'], 'DrawElements.Mode');
            controls.primitiveMode =
                mode === 'TRIANGLE_STRIP' ? TRIANGLE_STRIP : mode === 'TRIANGLES' ? TRIANGLES : 0;
            if (controls.primitiveMode === 0) continue;
            const geometry = new Geometry({ mode: controls.primitiveMode });
            geometry.indices = this.decodeGeometryData(
                'INDICES',
                jsonObject(drawInfo['Indices'], 'DrawElements.Indices'),
                buffers,
                controls
            );
            if (!isIntegerArray(geometry.indices.data)) {
                throw new TypeError('Decoded OSG geometry indices are not integers.');
            }
            const indices = geometry.indices.data;
            if (attributes['Normal'] !== undefined) {
                geometry.normals = this.decodeGeometryData(
                    'NORMAL',
                    jsonObject(attributes['Normal'], 'Normal attribute'),
                    buffers,
                    controls,
                    indices
                );
            }
            if (attributes['Vertex'] !== undefined) {
                geometry.vertices = this.decodeGeometryData(
                    'POSITION',
                    jsonObject(attributes['Vertex'], 'Vertex attribute'),
                    buffers,
                    controls,
                    indices
                );
            }
            if (attributes['TexCoord0'] !== undefined) {
                geometry.uvs = this.decodeGeometryData(
                    'UV',
                    jsonObject(attributes['TexCoord0'], 'Texture coordinate attribute'),
                    buffers,
                    controls,
                    indices
                );
            }
            parent.addChild(new Mesh({ geometry, material }));
        }
    }

    private parseNode(
        parent: Node,
        data: JsonObject,
        buffers: ReadonlyMap<string, ArrayBuffer>,
        materials: Readonly<Record<string, OSGMaterialInfo>>
    ): void {
        const nameValue = data['Name'];
        const node = new Node(typeof nameValue === 'string' ? { name: nameValue } : {});
        if (data['Matrix'] !== undefined) {
            node.matrix.fromArray(numberArray(data['Matrix'], 'Node.Matrix'));
            node.updateTransform();
        }
        const children = data['Children'];
        if (children !== undefined) {
            for (const rawChild of jsonArray(children, 'Node.Children')) {
                const child = jsonObject(rawChild, 'Node child');
                const type = Object.keys(child)[0];
                if (!type) throw new TypeError('OSG node child has no type.');
                const value = jsonObject(child[type], `Node child ${type}`);
                if (type === 'osg.Node' || type === 'osg.MatrixTransform') {
                    this.parseNode(node, value, buffers, materials);
                } else if (type === 'osg.Geometry') {
                    this.parseGeometry(node, value, buffers, materials['RootNode']);
                }
            }
        }
        parent.addChild(node);
    }

    private collectBufferFiles(data: JsonObject, files: Set<string>): void {
        const children = data['Children'];
        if (children === undefined) return;
        for (const rawChild of jsonArray(children, 'Node.Children')) {
            const child = jsonObject(rawChild, 'Node child');
            const type = Object.keys(child)[0];
            if (!type) throw new TypeError('OSG node child has no type.');
            const value = jsonObject(child[type], `Node child ${type}`);
            if (type === 'osg.Node' || type === 'osg.MatrixTransform') {
                this.collectBufferFiles(value, files);
                continue;
            }
            if (type !== 'osg.Geometry') continue;
            for (const primitive of jsonArray(value['PrimitiveSetList'], 'PrimitiveSetList')) {
                const set = jsonObject(primitive, 'PrimitiveSet');
                const draw = set['DrawElementsUShort'] ?? set['DrawElementsUInt'];
                if (draw === undefined) continue;
                const indices = jsonObject(jsonObject(draw, 'DrawElements')['Indices'], 'Indices');
                if (indices['Array'] !== undefined) {
                    files.add(parseArrayDescriptor(indices, 'Indices').file);
                }
            }
            const attributes = jsonObject(value['VertexAttributeList'], 'VertexAttributeList');
            for (const [name, attribute] of Object.entries(attributes)) {
                const info = jsonObject(attribute, name);
                if (info['Array'] !== undefined) {
                    files.add(parseArrayDescriptor(info, name).file);
                }
            }
        }
    }

    async load(request: OSGLoadRequest): Promise<OSGModel> {
        this.geometryData.clear();
        const rawDocument = await this.resourceLoader.loadRes(request.src, BasicLoader.TYPE_JSON);
        if (rawDocument instanceof ArrayBuffer) throw new TypeError('OSG document must be JSON.');
        const document = jsonObject(rawDocument, 'OSG document');
        const root = jsonObject(document['osg.Node'], 'OSG root node');
        const files = new Set<string>();
        this.collectBufferFiles(root, files);
        const buffers = new Map<string, ArrayBuffer>();
        await Promise.all(
            [...files].map(async file => {
                const resource = await this.resourceLoader.loadRes(
                    getRelativePath(request.src, file),
                    BasicLoader.TYPE_BUFFER
                );
                if (!(resource instanceof ArrayBuffer)) {
                    throw new TypeError(`OSG resource ${file} must be binary.`);
                }
                buffers.set(file, resource);
            })
        );
        const node = new Node();
        this.parseNode(node, root, buffers, request.materials ?? {});
        return { node };
    }
}
