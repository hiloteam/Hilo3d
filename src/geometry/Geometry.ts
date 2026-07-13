import math from '../math/math';
import Vector2 from '../math/Vector2';
import Vector3 from '../math/Vector3';
import Vector4 from '../math/Vector4';
import Matrix3 from '../math/Matrix3';
import Matrix4 from '../math/Matrix4';
import Quaternion from '../math/Quaternion';
import Euler from '../math/Euler';
import Sphere from '../math/Sphere';
import type Ray from '../math/Ray';
import GeometryData, {
    type GeometryAttributeValue,
    type GeometryComponentSize
} from './GeometryData';
import { copyArrayData } from '../utils/util';
import {
    BACK,
    FRONT,
    FRONT_AND_BACK,
    LINES,
    LINE_LOOP,
    TRIANGLES,
    TRIANGLE_FAN,
    TRIANGLE_STRIP
} from '../constants/webgl';
import type { ShaderOptions, TypedArrayConstructor } from '../renderer/common/types';
const tempVector31 = new Vector3();
const tempVector32 = new Vector3();
const tempVector33 = new Vector3();
const tempVector41 = new Vector4();
const tempVector21 = new Vector2();
const tempVector22 = new Vector2();
const tempVector23 = new Vector2();
const tempMatrix3 = new Matrix3();
const tempMatrix4 = new Matrix4();
const tempQuaternion = new Quaternion();
const tempEuler = new Euler();

export interface Bounds {
    x: number;
    y: number;
    z: number;
    width: number;
    height: number;
    depth: number;
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    zMin: number;
    zMax: number;
}

export interface GeometryParameters {
    vertices?: GeometryData | null;
    uvs?: GeometryData | null;
    uvs1?: GeometryData | null;
    colors?: GeometryData | null;
    indices?: GeometryData | null;
    skinIndices?: GeometryData | null;
    skinWeights?: GeometryData | null;
    normals?: GeometryData | null;
    tangents?: GeometryData | null;
    tangents1?: GeometryData | null;
    mode?: GLenum;
    isStatic?: boolean;
    isDirty?: boolean;
    useAABBRaycast?: boolean;
    userData?: unknown;
    positionDecodeMat?: Float32Array | number[] | null;
    normalDecodeMat?: Float32Array | number[] | null;
    uvDecodeMat?: Float32Array | number[] | null;
    uv1DecodeMat?: Float32Array | number[] | null;
}

type GeometryDataKey =
    'vertices' | 'uvs' | 'uvs1' | 'colors' | 'indices' | 'skinIndices' | 'skinWeights';

type TangentKey = '_tangents' | '_tangents1';
type UnsignedIndexArray = Uint8Array | Uint8ClampedArray | Uint16Array | Uint32Array;
export type Point3 = readonly number[];
export type Point2 = readonly number[];
type GeometryConstructor = new (params?: GeometryParameters) => Geometry;

function vector2Attribute(value: GeometryAttributeValue): Vector2 {
    if (!(value instanceof Vector2)) throw new TypeError('Expected a Vector2 geometry attribute');
    return value;
}

function vector3Attribute(value: GeometryAttributeValue): Vector3 {
    if (!(value instanceof Vector3)) throw new TypeError('Expected a Vector3 geometry attribute');
    return value;
}

function vector4Attribute(value: GeometryAttributeValue): Vector4 {
    if (!(value instanceof Vector4)) throw new TypeError('Expected a Vector4 geometry attribute');
    return value;
}

function readIndex(indices: ArrayLike<number>, index: number): number {
    const value = indices[index];
    if (value === undefined)
        throw new RangeError(`Geometry index ${String(index)} is out of bounds`);
    return value;
}

function requireUnsignedIndexArray(indices: GeometryData): UnsignedIndexArray {
    if (indices.size !== 1 || indices.stride !== 0 || indices.offset !== 0 || indices.normalized) {
        throw new TypeError(
            'Primitive topology conversion requires contiguous, non-normalized scalar index data'
        );
    }
    const data = indices.data;
    if (
        data instanceof Uint8Array ||
        data instanceof Uint8ClampedArray ||
        data instanceof Uint16Array ||
        data instanceof Uint32Array
    ) {
        return data;
    }
    throw new TypeError(
        'Primitive topology conversion requires unsigned 8-, 16-, or 32-bit indices'
    );
}

function createUnsignedIndexArray(
    source: UnsignedIndexArray | null,
    vertexCount: number,
    length: number
): UnsignedIndexArray {
    if (!Number.isSafeInteger(vertexCount) || vertexCount < 0) {
        throw new RangeError('Primitive topology vertex count must be a non-negative safe integer');
    }
    if (!Number.isSafeInteger(length) || length < 0) {
        throw new RangeError('Primitive topology index count exceeds JavaScript safe integers');
    }
    if (source instanceof Uint32Array || (!source && vertexCount > 0x10000)) {
        return new Uint32Array(length);
    }
    if (source instanceof Uint16Array || (!source && vertexCount > 0x100)) {
        return new Uint16Array(length);
    }
    if (source instanceof Uint8ClampedArray) return new Uint8ClampedArray(length);
    return new Uint8Array(length);
}

function normalizedTopologyIndexCount(mode: GLenum, sourceCount: number): number {
    if (!Number.isSafeInteger(sourceCount) || sourceCount < 0) {
        throw new RangeError('Primitive topology source count must be a non-negative safe integer');
    }
    if (mode === LINE_LOOP) return sourceCount < 2 ? 0 : sourceCount * 2;
    if (mode === TRIANGLE_FAN) return sourceCount < 3 ? 0 : (sourceCount - 2) * 3;
    throw new Error(`Draw mode ${String(mode)} does not require primitive topology conversion`);
}

function forEachTriangle(
    indices: ArrayLike<number>,
    mode: GLenum,
    callback: (a: number, b: number, c: number) => void
): void {
    if (mode === TRIANGLES) {
        if (indices.length % 3 !== 0) {
            throw new RangeError(
                `Triangle index data must contain complete triples; received ${String(indices.length)} indices`
            );
        }
        for (let index = 0; index < indices.length; index += 3) {
            callback(
                readIndex(indices, index),
                readIndex(indices, index + 1),
                readIndex(indices, index + 2)
            );
        }
        return;
    }
    if (mode === TRIANGLE_STRIP) {
        for (let index = 0; index + 2 < indices.length; index += 1) {
            const first = readIndex(indices, index);
            const second = readIndex(indices, index + 1);
            const third = readIndex(indices, index + 2);
            const a = index % 2 === 0 ? first : second;
            const b = index % 2 === 0 ? second : first;
            if (a !== b && b !== third && third !== a) callback(a, b, third);
        }
        return;
    }
    throw new Error(`Geometry triangle operations do not support draw mode ${String(mode)}`);
}

function coordinate(point: readonly number[], index: number): number {
    const value = point[index];
    if (value === undefined) throw new TypeError(`Point is missing coordinate ${String(index)}`);
    return value;
}

function isGeometryData(value: unknown): value is GeometryData {
    return value instanceof GeometryData;
}
/**
 * 几何体
 * @example
 * ```ts
 * const geometry = new Hilo3d.Geometry();
 * geometry.addFace([-0.5, -0.289, 0], [0.5, -0.289, 0], [0, 0.577, 0]);
 * ```
 */
class Geometry {
    readonly isGeometry = true;
    readonly className: string = 'Geometry';
    readonly isMorphGeometry: boolean = false;
    /**
     * 顶点数据
     */
    vertices: GeometryData | null = null;
    /**
     * uv 数据
     */
    uvs: GeometryData | null = null;
    /**
     * uv1 数据
     */
    uvs1: GeometryData | null = null;
    /**
     * color 数据
     */
    colors: GeometryData | null = null;
    /**
     * 顶点索引数据
     */
    indices: GeometryData | null = null;
    /**
     * 骨骼索引
     */
    skinIndices: GeometryData | null = null;
    /**
     * 骨骼权重数据
     */
    skinWeights: GeometryData | null = null;
    /**
     * 绘制模式
     */
    mode = TRIANGLES;
    /**
     * 是否是静态
     */
    isStatic = true;
    /**
     * 是否需要更新
     */
    private _isDirty = true;
    private _revision = 0;
    /** Monotonic geometry-state revision observed independently by every backend. */
    get revision(): number {
        return this._revision;
    }
    get isDirty(): boolean {
        return this._isDirty;
    }
    set isDirty(value: boolean) {
        if (value) this._revision++;
        this._isDirty = value;
    }
    /**
     * 使用 aabb 碰撞检测
     */
    useAABBRaycast = false;
    /**
     * 用户数据
     */
    userData: unknown = null;
    readonly id: string;
    currentVerticesCount = 0;
    currentIndicesCount = 0;
    positionDecodeMat: Float32Array | number[] | null = null;
    normalDecodeMat: Float32Array | number[] | null = null;
    uvDecodeMat: Float32Array | number[] | null = null;
    uv1DecodeMat: Float32Array | number[] | null = null;
    private _normals: GeometryData | null = null;
    private _tangents: GeometryData | null = null;
    private _tangents1: GeometryData | null = null;
    private _localBounds: Bounds | null = null;
    private _sphereBounds: Sphere | null = null;
    private _localSphereBounds: Sphere | null = null;
    /**
     * @param params - 初始化参数，所有params都会复制到实例上
     */
    constructor(params: GeometryParameters = {}) {
        /**
         * id
         */
        this.id = math.generateUUID(this.className);
        Object.assign(this, params);
        this.currentVerticesCount = 0;
        this.currentIndicesCount = 0;
    }
    private _needUpdateNormals = false;
    /**
     * 法向量数据，如果没有的话会自动生成
     */
    get normals(): GeometryData | null {
        if (this._needUpdateNormals || !this._normals) {
            this.calculateNormals();
        }
        return this._normals;
    }
    /**
     * 法向量数据，如果没有的话会自动生成
     */
    set normals(data: GeometryData | null) {
        this._normals = data;
        this._needUpdateNormals = false;
    }
    calculateNormals(): void {
        const vertices = this.vertices;
        if (!vertices) {
            throw new Error('Geometry.calculateNormals requires vertex data');
        }
        this._normals ??= new GeometryData(new Float32Array(vertices.realLength), 3);
        const normals = this._normals;
        let indices: ArrayLike<number>;
        if (this.indices) {
            indices = this.indices.data;
        } else {
            const len = vertices.length / 3;
            indices = Array.from({ length: len }, (_value, index) => index);
        }
        const verticesInFaceCountList = new Uint8Array(vertices.count);
        forEachTriangle(indices, this.mode, (a, b, c) => {
            tempVector31.copy(vector3Attribute(vertices.get(a)));
            tempVector32.copy(vector3Attribute(vertices.get(b)));
            tempVector33.copy(vector3Attribute(vertices.get(c)));
            tempVector32.sub(tempVector31);
            tempVector33.sub(tempVector31);
            tempVector32.cross(tempVector33);
            for (const idx of [a, b, c]) {
                const faceCount = verticesInFaceCountList[idx] ?? 0;
                if (faceCount > 0) {
                    const oldNormal = vector3Attribute(normals.get(idx));
                    oldNormal.scale(faceCount);
                    oldNormal.add(tempVector32);
                    oldNormal.scale(1 / (faceCount + 1));
                    normals.set(idx, oldNormal);
                } else {
                    normals.set(idx, tempVector32);
                }
                verticesInFaceCountList[idx] = faceCount + 1;
            }
        });
        this.isDirty = true;
        this._needUpdateNormals = false;
    }
    /**
     * 切线向量数据，如果没有的话会自动生成
     */
    get tangents(): GeometryData | null {
        if (!this._tangents) {
            this.calculateTangents(this.uvs, '_tangents');
        }
        return this._tangents;
    }
    /**
     * 切线向量数据，如果没有的话会自动生成
     */
    set tangents(data: GeometryData | null) {
        this._tangents = data;
    }
    /**
     * 切线向量数据，如果没有的话会自动生成
     */
    get tangents1(): GeometryData | null {
        if (!this._tangents1) {
            this.calculateTangents(this.uvs1, '_tangents1');
        }
        return this._tangents1;
    }
    /**
     * 切线向量数据，如果没有的话会自动生成
     */
    set tangents1(data: GeometryData | null) {
        this._tangents1 = data;
    }
    private calculateTangents(uvs: GeometryData | null, tangentsName: TangentKey): void {
        const vertices = this.vertices;
        if (!vertices) {
            throw new Error('Geometry.calculateTangents requires vertex data');
        }
        if (!uvs) {
            throw new Error('Geometry.calculateTangents requires UV data');
        }
        this[tangentsName] ??= new GeometryData(new Float32Array(vertices.count * 4), 4);
        const tangents = this[tangentsName];
        let indices: ArrayLike<number>;
        if (this.indices) {
            indices = this.indices.data;
        } else {
            const len = vertices.length / 3;
            indices = Array.from({ length: len }, (_value, index) => index);
        }
        forEachTriangle(indices, this.mode, (a, b, c) => {
            tempVector31.copy(vector3Attribute(vertices.get(a)));
            tempVector21.copy(vector2Attribute(uvs.get(a)));
            tempVector32.copy(vector3Attribute(vertices.get(b)));
            tempVector22.copy(vector2Attribute(uvs.get(b)));
            tempVector33.copy(vector3Attribute(vertices.get(c)));
            tempVector23.copy(vector2Attribute(uvs.get(c)));
            // eage1
            tempVector32.sub(tempVector31);
            // eage2
            tempVector33.sub(tempVector31);
            // deltauv1
            tempVector22.sub(tempVector21);
            // deltauv2
            tempVector23.sub(tempVector21);
            const f = 1 / (tempVector22.x * tempVector23.y - tempVector23.x * tempVector22.y);
            if (!Number.isFinite(f)) {
                tempVector31.x = 0;
                tempVector31.y = 0;
                tempVector31.z = 1;
            } else {
                tempVector31.x =
                    f * (tempVector23.y * tempVector32.x - tempVector22.y * tempVector33.x);
                tempVector31.y =
                    f * (tempVector23.y * tempVector32.y - tempVector22.y * tempVector33.y);
                tempVector31.z =
                    f * (tempVector23.y * tempVector32.z - tempVector22.y * tempVector33.z);
            }
            tempVector41.set(tempVector31.x, tempVector31.y, tempVector31.z, 1);
            tangents.set(a, tempVector41);
            tangents.set(b, tempVector41);
            tangents.set(c, tempVector41);
        });
        this.isDirty = true;
    }
    /**
     * Converts primitive modes that WebGPU cannot represent into explicit indexed lists.
     *
     * Both rendering backends call this method before creating backend resources, so LINE_LOOP
     * and TRIANGLE_FAN have one canonical CPU representation and identical draw semantics.
     * Existing unsigned index width is preserved; non-indexed geometry receives the smallest
     * unsigned index type that can address all of its vertices.
     *
     * @returns Whether the geometry topology was converted.
     */
    normalizePrimitiveTopology(): boolean {
        const sourceMode = this.mode;
        if (sourceMode !== LINE_LOOP && sourceMode !== TRIANGLE_FAN) return false;

        const sourceIndices = this.indices ? requireUnsignedIndexArray(this.indices) : null;
        const sourceCount = sourceIndices?.length ?? this.vertices?.count ?? 0;
        const outputLength = normalizedTopologyIndexCount(sourceMode, sourceCount);
        const output = createUnsignedIndexArray(sourceIndices, sourceCount, outputLength);
        const sourceIndex = (index: number): number =>
            sourceIndices ? readIndex(sourceIndices, index) : index;

        if (sourceMode === LINE_LOOP && sourceCount >= 2) {
            let outputIndex = 0;
            for (let index = 0; index + 1 < sourceCount; index++) {
                output[outputIndex++] = sourceIndex(index);
                output[outputIndex++] = sourceIndex(index + 1);
            }
            output[outputIndex++] = sourceIndex(sourceCount - 1);
            output[outputIndex] = sourceIndex(0);
            this.mode = LINES;
        } else if (sourceMode === TRIANGLE_FAN && sourceCount >= 3) {
            const center = sourceIndex(0);
            let outputIndex = 0;
            for (let index = 1; index + 1 < sourceCount; index++) {
                output[outputIndex++] = center;
                output[outputIndex++] = sourceIndex(index);
                output[outputIndex++] = sourceIndex(index + 1);
            }
            this.mode = TRIANGLES;
        } else {
            this.mode = sourceMode === LINE_LOOP ? LINES : TRIANGLES;
        }

        this.indices = new GeometryData(output, 1);
        this.currentIndicesCount = output.length;
        this.isDirty = true;
        return true;
    }
    /**
     * 将三角形模式转换为线框模式，即 Material 中的 wireframe
     */
    convertToLinesMode(): void {
        if (this.mode !== TRIANGLES) {
            throw new Error('Geometry.convertToLinesMode requires TRIANGLES mode');
        }
        if (!this.indices) {
            throw new Error('Geometry.convertToLinesMode requires index data');
        }
        const data = requireUnsignedIndexArray(this.indices);
        if (data.length % 3 !== 0) {
            throw new RangeError(
                `Geometry.convertToLinesMode requires complete index triples; received ${String(data.length)} indices`
            );
        }
        const newIndices = createUnsignedIndexArray(
            data,
            this.vertices?.count ?? 0,
            data.length * 2
        );
        let outputIndex = 0;
        for (let i = 0; i < data.length; i += 3) {
            const a = readIndex(data, i);
            const b = readIndex(data, i + 1);
            const c = readIndex(data, i + 2);
            newIndices[outputIndex++] = a;
            newIndices[outputIndex++] = b;
            newIndices[outputIndex++] = b;
            newIndices[outputIndex++] = c;
            newIndices[outputIndex++] = c;
            newIndices[outputIndex++] = a;
        }
        this.indices.data = newIndices;
        this.currentIndicesCount = newIndices.length;
        this.mode = LINES;
        this.isDirty = true;
    }
    /**
     * 平移
     * @param x -
     * @param y -
     * @param z -
     * @returns this
     */
    translate(x = 0, y = 0, z = 0): this {
        this.transformMat4(tempMatrix4.fromTranslation(tempVector31.set(x, y, z)));
        return this;
    }
    /**
     * 缩放
     * @param x -
     * @param y -
     * @param z -
     * @returns this
     */
    scale(x = 1, y = 1, z = 1): this {
        this.transformMat4(tempMatrix4.fromScaling(tempVector31.set(x, y, z)));
        return this;
    }
    /**
     * 旋转
     * @param x - 旋转角度x
     * @param y - 旋转角度y
     * @param z - 旋转角度z
     * @returns this
     */
    rotate(x = 0, y = 0, z = 0): this {
        tempEuler.set(x * math.DEG2RAD, y * math.DEG2RAD, z * math.DEG2RAD);
        this.transformMat4(tempMatrix4.fromQuat(tempQuaternion.fromEuler(tempEuler)));
        return this;
    }
    /**
     * Transforms the geometry with a mat4.
     * @param mat4 -
     * @returns this
     */
    transformMat4(mat4: Matrix4): this {
        const vertices = this.vertices;
        if (vertices) {
            vertices.traverse((vertex, index, offset) => {
                vertices.setByOffset(offset, vector3Attribute(vertex).transformMat4(mat4));
            });
        }
        tempMatrix3.normalFromMat4(mat4);
        if (this._normals) {
            const normals = this._normals;
            normals.traverse((vertex, index, offset) => {
                normals.setByOffset(
                    offset,
                    vector3Attribute(vertex).transformMat3(tempMatrix3).normalize()
                );
            });
        }
        if (this._tangents) {
            const tangents = this._tangents;
            tangents.traverse((vertex, index, offset) => {
                const tangent = vector4Attribute(vertex);
                tempVector31
                    .set(tangent.x, tangent.y, tangent.z)
                    .transformMat3(tempMatrix3)
                    .normalize();
                tangent.set(tempVector31.x, tempVector31.y, tempVector31.z, tangent.w);
                tangents.setByOffset(offset, tangent);
            });
        }
        this.isDirty = true;
        return this;
    }
    /**
     * 合并两个 geometry
     * @param geometry -
     * @param matrix - 合并的矩阵
     * @returns this
     */
    merge(geometry: Geometry, matrix?: Matrix4): this {
        let vertices = geometry.vertices;
        if (vertices && this.vertices) {
            const count = this.vertices.count;
            if (matrix) {
                vertices = vertices.clone();
                const transformedVertices = vertices;
                transformedVertices.traverse((vertex, index, offset) => {
                    transformedVertices.setByOffset(
                        offset,
                        vector3Attribute(vertex).transformMat4(matrix)
                    );
                });
            }
            this.vertices.merge(vertices);
            if (this.indices && geometry.indices) {
                this.indices.merge(geometry.indices, data => data + count);
            } else {
                this.indices = null;
            }
        }
        if (this.uvs && geometry.uvs) {
            this.uvs.merge(geometry.uvs);
        } else {
            this.uvs = null;
        }
        if (this.uvs1 && geometry.uvs1) {
            this.uvs1.merge(geometry.uvs1);
        } else {
            this.uvs1 = null;
        }
        if (this.colors && geometry.colors) {
            this.colors.merge(geometry.colors);
        } else {
            this.colors = null;
        }
        if (this._normals) {
            this._normals = null;
        }
        if (this._tangents) {
            this._tangents = null;
        }
        if (this._tangents1) {
            this._tangents1 = null;
        }
        this.isDirty = true;
        return this;
    }
    private ensureData(
        name: GeometryDataKey,
        size: GeometryComponentSize,
        total: number,
        DataClass: TypedArrayConstructor
    ): GeometryData {
        const geometryData = this[name];
        if (!geometryData || total > geometryData.length) {
            const newData = new DataClass(total);
            if (geometryData) {
                newData.set(geometryData.data);
                geometryData.data = newData;
            } else {
                this[name] = new GeometryData(newData, size);
            }
        }
        const result = this[name];
        if (!result) throw new Error(`Failed to initialize geometry data: ${name}`);
        return result;
    }
    /**
     * 添加顶点
     * @param points - 顶点坐标，如 addPoints([x, y, z], [x, y, z])
     */
    addPoints(...points: Point3[]): number {
        const total = (this.currentVerticesCount + points.length) * 3;
        const data = this.ensureData('vertices', 3, total, Float32Array).data;
        points.forEach(point => {
            const start = this.currentVerticesCount++ * 3;
            data[start] = coordinate(point, 0);
            data[start + 1] = coordinate(point, 1);
            data[start + 2] = coordinate(point, 2);
        });
        return this.currentVerticesCount - points.length;
    }
    /**
     * 添加顶点索引
     * @param indices - 顶点索引，如 addIndices(0, 1, 2)
     */
    addIndices(...indices: number[]): void {
        const total = this.currentIndicesCount + indices.length;
        const data = this.ensureData('indices', 1, total, Uint16Array).data;
        indices.forEach(idx => {
            data[this.currentIndicesCount++] = idx;
        });
        this._needUpdateNormals = true;
    }
    /**
     * 添加一条线
     * @param p1 - 起点坐标，如 [x, y, z]
     * @param p2 - 终点坐标
     */
    addLine(p1: Point3, p2: Point3): void {
        const start = this.addPoints(p1, p2);
        this.addIndices(start, start + 1);
    }
    /**
     * 添加一个三角形 ABC
     * @param p1 - 点A，如 [x, y, z]
     * @param p2 - 点B
     * @param p3 - 点C
     */
    addFace(p1: Point3, p2: Point3, p3: Point3): void {
        const start = this.addPoints(p1, p2, p3);
        this.addIndices(start, start + 1, start + 2);
    }
    /**
     * 添加一个矩形 ABCD
     * @param p1 - 点A，如 [x, y, z]
     * @param p2 - 点B
     * @param p3 - 点C
     * @param p4 - 点D
     */
    addRect(p1: Point3, p2: Point3, p3: Point3, p4: Point3): void {
        const start = this.addPoints(p1, p2, p3, p4);
        // 0 1 2 & 0 2 3 make a rect
        this.addIndices(start, start + 1, start + 2, start, start + 2, start + 3);
    }
    /**
     * 设置顶点对应的uv坐标
     * @param start - 开始的顶点索引
     * @param uvs - uv坐标数据，如 [[0, 0], [1, 0]]
     */
    setVertexUV(start: number, uvs: readonly Point2[]): void {
        if (!this.vertices) throw new Error('Cannot set UVs before vertices are initialized');
        const data = this.ensureData('uvs', 2, (this.vertices.length / 3) * 2, Float32Array).data;
        for (let i = 0; i < uvs.length; i++) {
            const uv = uvs[i];
            if (!uv) throw new RangeError(`UV index ${String(i)} is out of bounds`);
            data[start + i * 2] = coordinate(uv, 0);
            data[start + i * 2 + 1] = coordinate(uv, 1);
        }
    }
    /**
     * 设置三角形ABC的uv
     * @param start - 开始的顶点索引
     * @param p1 - 点A的uv，如 [0, 0]
     * @param p2 - 点B的uv
     * @param p3 - 点C的uv
     */
    setFaceUV(start: number, p1: Point2, p2: Point2, p3: Point2): void {
        this.setVertexUV(start, [p1, p2, p3]);
    }
    /**
     * 设置矩形ABCD的uv
     * @param start - 开始的顶点索引
     * @param p1 - 点A的uv，如 [0, 0]
     * @param p2 - 点B的uv
     * @param p3 - 点C的uv
     * @param p4 - 点D的uv
     */
    setRectUV(start: number, p1: Point2, p2: Point2, p3: Point2, p4: Point2): void {
        this.setVertexUV(start, [p1, p2, p3, p4]);
    }
    /**
     * 获取指定matrix变化后的包围盒数据
     *
     * @param matrix - matrix 需要变换的矩阵
     * @param bounds - 包围盒数据，传入的话会改变他
     * @returns 包围盒数据
     */
    getBounds(matrix?: Matrix4, bounds?: Bounds): Bounds {
        bounds ??= {
            xMin: Infinity,
            xMax: -Infinity,
            yMin: Infinity,
            yMax: -Infinity,
            zMin: Infinity,
            zMax: -Infinity,
            x: 0,
            y: 0,
            z: 0,
            width: 0,
            height: 0,
            depth: 0
        };
        const vertices = this.vertices;
        if (!vertices) {
            throw new Error('Geometry.getBounds requires vertex data');
        }
        vertices.traverse(vertexData => {
            const vertex = vector3Attribute(vertexData);
            if (matrix) {
                vertex.transformMat4(matrix);
            }
            bounds.xMax = Math.max(bounds.xMax, vertex.x);
            bounds.yMax = Math.max(bounds.yMax, vertex.y);
            bounds.zMax = Math.max(bounds.zMax, vertex.z);
            bounds.xMin = Math.min(bounds.xMin, vertex.x);
            bounds.yMin = Math.min(bounds.yMin, vertex.y);
            bounds.zMin = Math.min(bounds.zMin, vertex.z);
        });
        bounds.width = bounds.xMax - bounds.xMin;
        bounds.height = bounds.yMax - bounds.yMin;
        bounds.depth = bounds.zMax - bounds.zMin;
        bounds.x = (bounds.xMin + bounds.xMax) / 2;
        bounds.y = (bounds.yMin + bounds.yMax) / 2;
        bounds.z = (bounds.zMin + bounds.zMax) / 2;
        return bounds;
    }
    /**
     * 获取本地包围盒
     * @param force - 是否强制刷新
     */
    getLocalBounds(force = false): Bounds {
        if (!this._localBounds || force) {
            this._localBounds = this.getBounds();
        }
        return this._localBounds;
    }
    /**
     * 获取球面包围盒
     * @param matrix -
     */
    getSphereBounds(matrix?: Matrix4): Sphere {
        this._sphereBounds ??= new Sphere();
        const sphereBounds = this._sphereBounds;
        sphereBounds.copy(this.getLocalSphereBounds());
        if (matrix) {
            sphereBounds.transformMat4(matrix);
        }
        return sphereBounds;
    }
    /**
     * 获取本地球面包围盒
     * @param force - 是否强制刷新
     */
    getLocalSphereBounds(force = false): Sphere {
        if (!this._localSphereBounds || force) {
            const localBounds = this.getLocalBounds(force);
            const sphere = new Sphere({
                center: new Vector3(localBounds.x, localBounds.y, localBounds.z)
            });
            const vertices = this.vertices;
            if (vertices) {
                sphere.fromGeometryData(vertices);
            } else {
                throw new Error('Geometry.getLocalSphereBounds requires vertex data');
            }
            this._localSphereBounds = sphere;
        }
        return this._localSphereBounds;
    }
    /**
     * 将 Geometry 转换成无 indices
     * @param verticesItemLen - 转换结果的顶点数据的位数(3 or 4)，如果为4会补1
     */
    convertToNoIndices(verticesItemLen: 3 | 4 = 3): void {
        if (this.mode !== TRIANGLES) {
            throw new Error('Geometry.convertToNoIndices requires TRIANGLES mode');
        }
        if (!this.indices) {
            throw new Error('Geometry.convertToNoIndices requires index data');
        }
        const indices = this.indices.data;
        const sourceVertices = this.vertices;
        if (!sourceVertices) {
            throw new Error('Geometry.convertToNoIndices requires vertex data');
        }
        const sourceUvs = this.uvs;
        const sourceNormals = this.normals;
        const sourceColors = this.colors;
        const sourceSkinIndices = this.skinIndices;
        const sourceSkinWeights = this.skinWeights;
        const indicesLen = indices.length;
        const vertices = new Float32Array(indicesLen * verticesItemLen);
        const uvs = this.uvs ? new Float32Array(indicesLen * 2) : null;
        const normals = new Float32Array(indicesLen * 3);
        const colors = this.colors ? new Float32Array(this.colors.size * indicesLen) : null;
        const skinIndices = this.skinIndices ? new Float32Array(indicesLen * 4) : null;
        const skinWeights = this.skinWeights ? new Float32Array(indicesLen * 4) : null;
        for (let i = 0; i < indicesLen; i++) {
            const idx = readIndex(indices, i);
            copyArrayData(vertices, sourceVertices, i * verticesItemLen, idx * 3, 3);
            if (verticesItemLen === 4) {
                vertices[i * 4 + 3] = 1;
            }
            if (uvs && sourceUvs) copyArrayData(uvs, sourceUvs, i * 2, idx * 2, 2);
            if (sourceNormals) copyArrayData(normals, sourceNormals, i * 3, idx * 3, 3);
            if (skinIndices && sourceSkinIndices)
                copyArrayData(skinIndices, sourceSkinIndices, i * 4, idx * 4, 4);
            if (skinWeights && sourceSkinWeights)
                copyArrayData(skinWeights, sourceSkinWeights, i * 4, idx * 4, 4);
            if (colors && sourceColors) {
                copyArrayData(
                    colors,
                    sourceColors,
                    i * sourceColors.size,
                    idx * sourceColors.size,
                    sourceColors.size
                );
            }
        }
        this.indices = null;
        sourceVertices.data = vertices;
        if (this.uvs && uvs) {
            this.uvs.data = uvs;
        }
        if (this._normals) {
            this._normals.data = normals;
        }
        if (this.colors && colors) {
            this.colors.data = colors;
        }
        if (this.skinIndices && skinIndices) {
            this.skinIndices.data = skinIndices;
        }
        if (this.skinWeights && skinWeights) {
            this.skinWeights.data = skinWeights;
        }
    }
    /**
     * clone当前Geometry
     * @returns 返回clone的Geometry
     */
    clone(): Geometry {
        const Constructor = this.constructor as GeometryConstructor;
        const geometry = new Constructor({
            mode: this.mode
        });
        if (this.vertices) {
            geometry.vertices = this.vertices.clone();
        }
        if (this.uvs) {
            geometry.uvs = this.uvs.clone();
        }
        if (this.uvs1) {
            geometry.uvs1 = this.uvs1.clone();
        }
        if (this.colors) {
            geometry.colors = this.colors.clone();
        }
        if (this.indices) {
            geometry.indices = this.indices.clone();
        }
        if (this.skinWeights) {
            geometry.skinWeights = this.skinWeights.clone();
        }
        if (this.skinIndices) {
            geometry.skinIndices = this.skinIndices.clone();
        }
        if (this._normals) {
            geometry._normals = this._normals.clone();
        }
        if (this._tangents) {
            geometry._tangents = this._tangents.clone();
        }
        if (this._tangents1) {
            geometry._tangents1 = this._tangents1.clone();
        }
        if (this.positionDecodeMat) {
            geometry.positionDecodeMat = this.positionDecodeMat;
        }
        if (this.uvDecodeMat) {
            geometry.uvDecodeMat = this.uvDecodeMat;
        }
        if (this.uv1DecodeMat) {
            geometry.uv1DecodeMat = this.uv1DecodeMat;
        }
        if (this.normalDecodeMat) {
            geometry.normalDecodeMat = this.normalDecodeMat;
        }
        return geometry;
    }
    /**
     * 检测 aabb 碰撞
     * @param ray -
     */
    _aabbRaycast(ray: Ray): Vector3[] | null {
        const bounds = this.getLocalBounds();
        const res = ray.intersectsBox([
            [bounds.xMin, bounds.yMin, bounds.zMin],
            [bounds.xMax, bounds.yMax, bounds.zMax]
        ]);
        if (res) {
            return [res];
        }
        return null;
    }
    /**
     * _raycast，子类可覆盖实现
     * @param ray -
     * @param side -
     */
    _raycast(ray: Ray, side: GLenum): Vector3[] | null {
        const vertices = this.vertices;
        if (!vertices) {
            return null;
        }
        const indices = this.indices;
        const triangle: [ArrayLike<number>, ArrayLike<number>, ArrayLike<number>] = [
            tempVector31.elements,
            tempVector32.elements,
            tempVector33.elements
        ];
        const resArray: Vector3[] = [];
        let len;
        if (indices) {
            len = indices.realLength;
        } else {
            len = vertices.realLength / 3;
        }
        const triangleIndices: ArrayLike<number> = indices
            ? indices.data
            : Array.from({ length: len }, (_value, index) => index);
        forEachTriangle(triangleIndices, this.mode, (a, b, c) => {
            tempVector31.copy(vector3Attribute(vertices.get(a)));
            tempVector32.copy(vector3Attribute(vertices.get(b)));
            tempVector33.copy(vector3Attribute(vertices.get(c)));
            let res;
            if (side === FRONT) {
                triangle[0] = tempVector31.elements;
                triangle[1] = tempVector32.elements;
                triangle[2] = tempVector33.elements;
                res = ray.intersectsTriangle(triangle);
            } else if (side === BACK) {
                triangle[1] = tempVector31.elements;
                triangle[0] = tempVector32.elements;
                triangle[2] = tempVector33.elements;
                res = ray.intersectsTriangle(triangle);
            } else if (side === FRONT_AND_BACK) {
                triangle[0] = tempVector31.elements;
                triangle[1] = tempVector32.elements;
                triangle[2] = tempVector33.elements;
                res = ray.intersectsTriangle(triangle);
                if (!res) {
                    triangle[1] = tempVector31.elements;
                    triangle[0] = tempVector32.elements;
                    triangle[2] = tempVector33.elements;
                    res = ray.intersectsTriangle(triangle);
                }
            }
            if (res) {
                resArray.push(res);
            }
        });
        return resArray.length ? resArray : null;
    }
    /**
     * raycast
     * @param ray -
     * @param side -
     * @param sort - 是否按距离排序
     */
    raycast(ray: Ray, side: GLenum, sort = true): Vector3[] | null {
        let res;
        if (this.useAABBRaycast) {
            res = this._aabbRaycast(ray);
        } else {
            res = this._raycast(ray, side);
        }
        if (res && sort) {
            ray.sortPoints(res);
        }
        return res;
    }
    getRenderOption(opt: ShaderOptions = {}): ShaderOptions {
        if (this.positionDecodeMat) {
            opt['QUANTIZED'] = 1;
            opt['POSITION_QUANTIZED'] = 1;
        }
        if (this.normalDecodeMat) {
            opt['QUANTIZED'] = 1;
            opt['NORMAL_QUANTIZED'] = 1;
        }
        if (this.uvDecodeMat) {
            opt['QUANTIZED'] = 1;
            opt['UV_QUANTIZED'] = 1;
        }
        if (this.uv1DecodeMat) {
            opt['QUANTIZED'] = 1;
            opt['UV1_QUANTIZED'] = 1;
        }
        if (this.colors) {
            opt['HAS_COLOR'] = 1;
            opt['COLOR_SIZE'] = this.colors.size;
        }
        return opt;
    }
    getShaderKey(): string {
        const structuralOptions = Object.entries(this.getRenderOption({})).sort(([left], [right]) =>
            left.localeCompare(right)
        );
        return `geometry:${JSON.stringify(structuralOptions)}`;
    }
    /**
     * 获取数据的内存大小，只处理顶点数据，单位为字节
     * @returns 内存占用大小
     */
    getSize(): number {
        let sum = 0;
        for (const value of Object.values(this)) {
            if (isGeometryData(value)) sum += value.getByteLength();
        }
        return sum;
    }
}
export default Geometry;
