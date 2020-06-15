import Class from '../core/Class';
import math from '../math/math';
import Vector2 from '../math/Vector2';
import Vector3 from '../math/Vector3';
import Vector4 from '../math/Vector4';
import Matrix3 from '../math/Matrix3';
import Matrix4 from '../math/Matrix4';
import Quaternion from '../math/Quaternion';
import Sphere from '../math/Sphere';
import GeometryData from './GeometryData';
import log from '../utils/log';
import {
    copyArrayData,
    hasOwnProperty
} from '../utils/util';

import constants from '../constants';

const {
    TRIANGLES,
    LINES,
    FRONT,
    BACK,
    FRONT_AND_BACK
} = constants;

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


/**
 * 几何体
 * @class
 * @example
 * const geometry = new Hilo3d.Geometry();
 * geometry.addFace([-0.5, -0.289, 0], [0.5, -0.289, 0], [0, 0.577, 0]);
 */
const Geometry = Class.create(/** @lends Geometry.prototype */ {
    /**
     * @default true
     * @type {boolean}
     */
    isGeometry: true,

    /**
     * @default Geometry
     * @type {string}
     */
    className: 'Geometry',

    /**
     * 顶点数据
     * @default null
     * @type {GeometryData}
     */
    vertices: null,

    /**
     * uv 数据
     * @default null
     * @type {GeometryData}
     */
    uvs: null,

    /**
     * uv1 数据
     * @default null
     * @type {GeometryData}
     */
    uvs1: null,

    /**
     * color 数据
     * @default null
     * @type {GeometryData}
     */
    colors: null,

    /**
     * 顶点索引数据
     * @default null
     * @type {GeometryData}
     */
    indices: null,

    /**
     * 骨骼索引
     * @default null
     * @type {GeometryData}
     */
    skinIndices: null,

    /**
     * 骨骼权重数据
     * @default null
     * @type {GeometryData}
     */
    skinWeights: null,

    /**
     * 绘制模式
     * @default TRIANGLES
     * @type {number}
     */
    mode: TRIANGLES,

    /**
     * 是否是静态
     * @type {Boolean}
     * @default true
     */
    isStatic: true,

    /**
     * 是否需要更新
     * @type {Boolean}
     * @default true
     */
    isDirty: true,

    /**
     * 使用 aabb 碰撞检测
     * @type {Boolean}
     */
    useAABBRaycast: false,

    /**
     * @constructs
     * @param {object} [params] 初始化参数，所有params都会复制到实例上
     */
    constructor(params) {
        /**
         * id
         * @type {string}
         */
        this.id = math.generateUUID(this.className);

        Object.assign(this, params);

        this.currentVerticesCount = 0;
        this.currentIndicesCount = 0;
    },
    _needUpdateNormals: false,
    /**
     * 法向量数据，如果没有的话会自动生成
     * @default null
     * @type {Float32Array}
     */
    normals: {
        get() {
            if (this._needUpdateNormals || !this._normals) {
                this.calculateNormals();
            }
            return this._normals;
        },
        set(data) {
            this._normals = data;
            this._needUpdateNormals = false;
        }
    },
    calculateNormals() {
        const vertices = this.vertices;
        if (!vertices) {
            log.warnOnce('geometry.calculateNormals', 'geometry.calculateNormals error:no vertices data.');
            return;
        }

        if (!this._normals) {
            this._normals = new GeometryData(new Float32Array(vertices.realLength), 3);
        }
        const normals = this._normals;
        let indices;
        if (this.indices) {
            indices = this.indices.data;
        } else {
            const len = vertices.length / 3;
            indices = new Array(len);
            for (let i = 0; i < len; i++) {
                indices[i] = i;
            }
        }
        let idx = 0;
        const verticesInFaceCountList = new Uint8Array(vertices.count);
        for (let i = 0; i < indices.length; i += 3) {
            idx = indices[i];
            tempVector31.copy(vertices.get(idx));
            idx = indices[i + 1];
            tempVector32.copy(vertices.get(idx));
            idx = indices[i + 2];
            tempVector33.copy(vertices.get(idx));

            tempVector32.sub(tempVector31);
            tempVector33.sub(tempVector31);
            tempVector32.cross(tempVector33);

            for (let j = 0; j < 3; j++) {
                idx = indices[i + j];
                if (verticesInFaceCountList[idx]) {
                    let oldNormal = normals.get(idx);
                    oldNormal.scale(verticesInFaceCountList[idx]);
                    oldNormal.add(tempVector32);
                    oldNormal.scale(1 / (verticesInFaceCountList[idx] + 1));
                    normals.set(idx, oldNormal);
                } else {
                    normals.set(idx, tempVector32);
                }
                verticesInFaceCountList[idx]++;
            }
        }
        this.isDirty = true;
        this._needUpdateNormals = false;
    },
    /**
     * 切线向量数据，如果没有的话会自动生成
     * @default null
     * @type {Float32Array}
     */
    tangents: {
        get() {
            if (!this._tangents) {
                this.calculateTangents(this.uvs, '_tangents');
            }
            return this._tangents;
        },
        set(data) {
            this._tangents = data;
        }
    },
    /**
     * 切线向量数据，如果没有的话会自动生成
     * @default null
     * @type {Float32Array}
     */
    tangents1: {
        get() {
            if (!this._tangents1) {
                this.calculateTangents(this.uvs1, '_tangents1');
            }
            return this._tangents1;
        },
        set(data) {
            this._tangents1 = data;
        }
    },
    calculateTangents(uvs, tangentsName) {
        const vertices = this.vertices;
        if (!vertices) {
            log.warnOnce('geometry.calculateTangents', 'geometry.calculateTangents error:no vertices data.');
            return;
        }
        if (!this[tangentsName]) {
            this[tangentsName] = new GeometryData(new Float32Array(vertices.count * 4), 4);
        }
        const tangents = this[tangentsName];
        let indices;
        if (this.indices) {
            indices = this.indices.data;
        } else {
            const len = vertices.length / 3;
            indices = new Array(len);
            for (let i = 0; i < len; i++) {
                indices[i] = i;
            }
        }

        let idx = 0;
        for (let i = 0; i < indices.length; i += 3) {
            idx = indices[i];
            tempVector31.copy(vertices.get(idx));
            tempVector21.copy(uvs.get(idx));
            idx = indices[i + 1];
            tempVector32.copy(vertices.get(idx));
            tempVector22.copy(uvs.get(idx));
            idx = indices[i + 2];
            tempVector33.copy(vertices.get(idx));
            tempVector23.copy(uvs.get(idx));

            // eage1
            tempVector32.sub(tempVector31);
            // eage2
            tempVector33.sub(tempVector31);

            // deltauv1
            tempVector22.sub(tempVector21);
            // deltauv2
            tempVector23.sub(tempVector21);

            let f = 1 / (tempVector22.x * tempVector23.y - tempVector23.x * tempVector22.y);
            if (!Number.isFinite(f)) {
                tempVector31.x = 0;
                tempVector31.y = 0;
                tempVector31.z = 1;
            } else {
                tempVector31.x = f * (tempVector23.y * tempVector32.x - tempVector22.y * tempVector33.x);
                tempVector31.y = f * (tempVector23.y * tempVector32.y - tempVector22.y * tempVector33.y);
                tempVector31.z = f * (tempVector23.y * tempVector32.z - tempVector22.y * tempVector33.z);
            }

            tempVector41.set(tempVector31.x, tempVector31.y, tempVector31.z, 1);

            tangents.set(indices[i], tempVector41);
            tangents.set(indices[i + 1], tempVector41);
            tangents.set(indices[i + 2], tempVector41);
        }

        this.isDirty = true;
    },
    /**
     * 将三角形模式转换为线框模式，即 Material 中的 wireframe
     */
    convertToLinesMode() {
        if (this.mode !== TRIANGLES) {
            log.warn('Only support convert triangles to lines mode!');
            return;
        }
        if (!this.indices) {
            log.warn('Has no indices!');
            return;
        }

        let newIndices = new Uint16Array(this.indices.length * 2);
        let data = this.indices.data;
        for (let i = 0; i < data.length; i += 3) {
            newIndices[i * 2] = data[i]; // A
            newIndices[i * 2 + 1] = data[i + 1]; // B
            newIndices[i * 2 + 2] = data[i + 1]; // B
            newIndices[i * 2 + 3] = data[i + 2]; // C
            newIndices[i * 2 + 4] = data[i + 2]; // C
            newIndices[i * 2 + 5] = data[i]; // A
        }
        this.indices.data = newIndices;
        this.mode = LINES;
    },
    /**
     * 平移
     * @param  {Number} [x=0]
     * @param  {Number} [y=0]
     * @param  {Number} [z=0]
     * @return {Geometry} this
     */
    translate(x = 0, y = 0, z = 0) {
        this.transformMat4(tempMatrix4.fromTranslation(tempVector31.set(x, y, z)));
        return this;
    },
    /**
     * 缩放
     * @param  {Number} [x=1]
     * @param  {Number} [y=1]
     * @param  {Number} [z=1]
     * @return {Geometry} this
     */
    scale(x = 1, y = 1, z = 1) {
        this.transformMat4(tempMatrix4.fromScaling(tempVector31.set(x, y, z)));
        return this;
    },
    /**
     * 旋转
     * @param  {Number} [x=0] 旋转角度x
     * @param  {Number} [y=0] 旋转角度y
     * @param  {Number} [z=0] 旋转角度z
     * @return {Geometry} this
     */
    rotate(x = 0, y = 0, z = 0) {
        this.transformMat4(tempMatrix4.fromQuat(tempQuaternion.fromEuler({
            x: x * math.DEG2RAD,
            y: y * math.DEG2RAD,
            z: z * math.DEG2RAD
        })));
        return this;
    },
    /**
     * Transforms the geometry with a mat4.
     * @param  {Matrix4} mat4
     * @return {Geometry} this
     */
    transformMat4(mat4) {
        const vertices = this.vertices;
        if (vertices) {
            vertices.traverse((vertex, index, offset) => {
                vertices.setByOffset(offset, vertex.transformMat4(mat4));
            });
        }

        tempMatrix3.normalFromMat4(mat4);
        if (this._normals) {
            const normals = this.normals;
            normals.traverse((vertex, index, offset) => {
                normals.setByOffset(offset, vertex.transformMat3(tempMatrix3).normalize());
            });
        }

        if (this._tangents) {
            const tangents = this.tangents;
            tangents.traverse((vertex, index, offset) => {
                tangents.setByOffset(offset, vertex.transformMat3(tempMatrix3).normalize());
            });
        }

        this.isDirty = true;
        return this;
    },
    /**
     * 合并两个 geometry
     * @param  {Geometry} geometry
     * @param  {Matrix4} [matrix=null] 合并的矩阵
     * @return {Geometry} this
     */
    merge(geometry, matrix) {
        let vertices = geometry.vertices;
        if (vertices && this.vertices) {
            const count = this.vertices.count;

            if (matrix) {
                vertices = geometry.vertices.clone();
                vertices.traverse((vertex, index, offset) => {
                    vertices.setByOffset(offset, vertex.transformMat4(matrix));
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
    },
    ensureData(name, size, total, TypedArray) {
        let geometryData = this[name];
        if (!geometryData || total > geometryData.length) {
            const newData = new TypedArray(total);
            if (geometryData) {
                newData.set(geometryData.data);
                geometryData.data = newData;
            } else {
                this[name] = new GeometryData(newData, size);
            }
        }
    },
    /**
     * 添加顶点
     * @param {...number[]} points 顶点坐标，如 addPoints([x, y, z], [x, y, z])
     */
    addPoints() {
        const points = [].slice.call(arguments);
        const total = (this.currentVerticesCount + points.length) * 3;
        this.ensureData('vertices', 3, total, Float32Array);

        const data = this.vertices.data;
        points.forEach((point) => {
            let start = this.currentVerticesCount++ * 3;
            data[start] = point[0];
            data[start + 1] = point[1];
            data[start + 2] = point[2];
        });
        return this.currentVerticesCount - points.length;
    },
    /**
     * 添加顶点索引
     * @param {...number} indices 顶点索引，如 addIndices(0, 1, 2)
     */
    addIndices() {
        const indices = [].slice.call(arguments);
        const total = this.currentIndicesCount + indices.length;
        this.ensureData('indices', 1, total, Uint16Array);
        const data = this.indices.data;
        indices.forEach((idx) => {
            data[this.currentIndicesCount++] = idx;
        });

        this._needUpdateNormals = true;
    },
    /**
     * 添加一条线
     * @param {number[]} p1 起点坐标，如 [x, y, z]
     * @param {number[]} p2 终点坐标
     */
    addLine(p1, p2) {
        let start = this.addPoints(p1, p2);
        this.addIndices(start, start + 1);
    },
    /**
     * 添加一个三角形 ABC
     * @param {number[]} p1 点A，如 [x, y, z]
     * @param {number[]} p2 点B
     * @param {number[]} p3 点C
     */
    addFace(p1, p2, p3) {
        let start = this.addPoints(p1, p2, p3);
        this.addIndices(start, start + 1, start + 2);
    },
    /**
     * 添加一个矩形 ABCD
     * @param {number[]} p1 点A，如 [x, y, z]
     * @param {number[]} p2 点B
     * @param {number[]} p3 点C
     * @param {number[]} p4 点D
     */
    addRect(p1, p2, p3, p4) {
        let start = this.addPoints(p1, p2, p3, p4);
        // 0 1 2 & 0 2 3 make a rect
        this.addIndices(start, start + 1, start + 2, start, start + 2, start + 3);
    },
    /**
     * 设置顶点对应的uv坐标
     * @param {number} start 开始的顶点索引
     * @param {number[][]} uvs uv坐标数据，如 [[0, 0], [1, 0]]
     */
    setVertexUV(start, uvs) {
        this.ensureData('uvs', 2, this.vertices.length / 3 * 2, Float32Array);
        const data = this.uvs.data;
        for (let i = 0; i < uvs.length; i++) {
            data[start + i * 2] = uvs[i][0];
            data[start + i * 2 + 1] = uvs[i][1];
        }
    },
    /**
     * 设置三角形ABC的uv
     * @param {number} start 开始的顶点索引
     * @param {number[]} p1 点A的uv，如 [0, 0]
     * @param {number[]} p2 点B的uv
     * @param {number[]} p3 点C的uv
     */
    setFaceUV(start, p1, p2, p3) {
        this.setVertexUV(start, [p1, p2, p3]);
    },
    /**
     * 设置矩形ABCD的uv
     * @param {number} start 开始的顶点索引
     * @param {number[]} p1 点A的uv，如 [0, 0]
     * @param {number[]} p2 点B的uv
     * @param {number[]} p3 点C的uv
     * @param {number[]} p4 点D的uv
     */
    setRectUV(start, p1, p2, p3, p4) {
        this.setVertexUV(start, [p1, p2, p3, p4]);
    },
    /**
     * 获取指定matrix变化后的包围盒数据
     *
     * @param {Matrix4} [matrix=null] matrix 需要变换的矩阵
     * @param {Bounds} [bounds=null] 包围盒数据，传入的话会改变他
     * @return {Bounds} 包围盒数据
     */
    getBounds(matrix, bounds) {
        if (!bounds) {
            bounds = {
                xMin: Infinity,
                xMax: -Infinity,
                yMin: Infinity,
                yMax: -Infinity,
                zMin: Infinity,
                zMax: -Infinity
            };
        }

        const vertices = this.vertices;
        if (!vertices) {
            log.warnOnce('geometry.getBounds', 'geometry has no vertices data, geometry.getBounds will return Infinity bounds.');
            return bounds;
        }

        vertices.traverse((vertexData) => {
            if (matrix) {
                vertexData.transformMat4(matrix);
            }
            bounds.xMax = Math.max(bounds.xMax, vertexData.x);
            bounds.yMax = Math.max(bounds.yMax, vertexData.y);
            bounds.zMax = Math.max(bounds.zMax, vertexData.z);
            bounds.xMin = Math.min(bounds.xMin, vertexData.x);
            bounds.yMin = Math.min(bounds.yMin, vertexData.y);
            bounds.zMin = Math.min(bounds.zMin, vertexData.z);
        });

        bounds.width = bounds.xMax - bounds.xMin;
        bounds.height = bounds.yMax - bounds.yMin;
        bounds.depth = bounds.zMax - bounds.zMin;
        bounds.x = (bounds.xMin + bounds.xMax) / 2;
        bounds.y = (bounds.yMin + bounds.yMax) / 2;
        bounds.z = (bounds.zMin + bounds.zMax) / 2;
        return bounds;
    },
    /**
     * 获取本地包围盒
     * @param  {Boolean} [force=false] 是否强制刷新
     * @return {Bounds}
     */
    getLocalBounds(force = false) {
        if (!this._localBounds || force) {
            this._localBounds = this.getBounds();
        }
        return this._localBounds;
    },
    /**
     * 获取球面包围盒
     * @param  {Matrix4} matrix
     * @return {Sphere}
     */
    getSphereBounds(matrix) {
        if (!this._sphereBounds) {
            this._sphereBounds = new Sphere();
        }
        const sphereBounds = this._sphereBounds;
        sphereBounds.copy(this.getLocalSphereBounds());
        if (matrix) {
            sphereBounds.transformMat4(matrix);
        }
        return sphereBounds;
    },
    /**
     * 获取本地球面包围盒
     * @param  {Boolean} [force=false] 是否强制刷新
     * @return {Sphere}
     */
    getLocalSphereBounds(force = false) {
        if (!this._localSphereBounds || force) {
            const localBounds = this.getLocalBounds(force);
            const sphere = new Sphere({
                center: new Vector3(localBounds.x, localBounds.y, localBounds.z)
            });
            const vertices = this.vertices;
            if (vertices) {
                sphere.fromGeometryData(vertices);
            } else {
                log.warnOnce('geometry.getLocalSphereBounds', 'geometry has no vertices data, geometry.getLocalSphereBounds will return Infinity bounds.');
                sphere.radius = Infinity;
            }
            this._localSphereBounds = sphere;
        }
        return this._localSphereBounds;
    },
    /**
     * 将 Geometry 转换成无 indices
     * @param {number} [verticesItemLen=3] 转换结果的顶点数据的位数(3 or 4)，如果为4会补1
     */
    convertToNoIndices(verticesItemLen = 3) {
        if (this.mode !== TRIANGLES) {
            log.warn('Only support convert triangles to lines mode!');
            return;
        }
        if (!this.indices) {
            log.warn('Has no indices!');
            return;
        }
        const indices = this.indices.data;
        const indicesLen = indices.length;
        const vertices = new Float32Array(indicesLen * verticesItemLen);
        const uvs = this.uvs ? new Float32Array(indicesLen * 2) : null;
        const normals = new Float32Array(indicesLen * 3);
        const colors = this.colors ? new Float32Array(this.colors.size * indicesLen) : null;
        const skinIndices = this.skinIndices ? new Float32Array(indicesLen * 4) : null;
        const skinWeights = this.skinWeights ? new Float32Array(indicesLen * 4) : null;

        for (let i = 0; i < indicesLen; i++) {
            const idx = indices[i];
            copyArrayData(vertices, this.vertices, i * verticesItemLen, idx * 3, 3);
            if (verticesItemLen === 4) {
                vertices[i * 4 + 3] = 1;
            }
            copyArrayData(uvs, this.uvs, i * 2, idx * 2, 2);
            copyArrayData(normals, this.normals, i * 3, idx * 3, 3);
            copyArrayData(skinIndices, this.skinIndices, i * 4, idx * 4, 4);
            copyArrayData(skinWeights, this.skinWeights, i * 4, idx * 4, 4);
            if (this.colors) {
                copyArrayData(colors, this.colors, i * this.colors.size, idx * this.colors.size, this.colors.size);
            }
        }
        delete this.indices;
        this.vertices.data = vertices;
        if (this.uvs) {
            this.uvs.data = uvs;
        }
        if (this.normals) {
            this.normals.data = normals;
        }
        if (this.colors) {
            this.colors.data = colors;
        }
        if (this.skinIndices) {
            this.skinIndices.data = skinIndices;
        }
        if (this.skinWeights) {
            this.skinWeights.data = skinWeights;
        }
    },
    /**
     * clone当前Geometry
     * @return {Geometry} 返回clone的Geometry
     */
    clone() {
        const geometry = new this.constructor({
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
    },
    /**
     * 检测 aabb 碰撞
     * @param  {Ray} ray
     * @return {Vector3[]|null}
     */
    _aabbRaycast(ray) {
        const bounds = this.getLocalBounds();
        const res = ray.intersectsBox([
            [bounds.xMin, bounds.yMin, bounds.zMin],
            [bounds.xMax, bounds.yMax, bounds.zMax]
        ]);

        if (res) {
            return [res];
        }

        return null;
    },
    /**
     * _raycast，子类可覆盖实现
     * @param  {Ray} ray
     * @param  {GLenum} side
     * @return {Vector3[]|null}
     */
    _raycast(ray, side) {
        // TODO:optimize

        const vertices = this.vertices;

        if (!vertices) {
            return null;
        }

        const indices = this.indices;
        const triangle = [];
        const resArray = [];
        let len;
        if (indices) {
            len = indices.realLength;
        } else {
            len = vertices.realLength / 3;
        }

        for (let i = 0; i < len; i += 3) {
            let idx = indices ? indices.get(i) : i;
            tempVector31.copy(vertices.get(idx));
            idx = indices ? indices.get(i + 1) : (i + 1);
            tempVector32.copy(vertices.get(idx));
            idx = indices ? indices.get(i + 2) : (i + 2);
            tempVector33.copy(vertices.get(idx));

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
        }

        return resArray.length ? resArray : null;
    },
    /**
     * raycast
     * @param  {Ray} ray
     * @param  {GLenum} side
     * @param {Boolean} [sort=true] 是否按距离排序
     * @return {Vector3[]|null}
     */
    raycast(ray, side, sort = true) {
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
    },
    getRenderOption(opt = {}) {
        if (this.positionDecodeMat) {
            opt.QUANTIZED = 1;
            opt.POSITION_QUANTIZED = 1;
        }
        if (this.normalDecodeMat) {
            opt.QUANTIZED = 1;
            opt.NORMAL_QUANTIZED = 1;
        }
        if (this.uvDecodeMat) {
            opt.QUANTIZED = 1;
            opt.UV_QUANTIZED = 1;
        }
        if (this.uv1DecodeMat) {
            opt.QUANTIZED = 1;
            opt.UV1_QUANTIZED = 1;
        }
        if (this.colors) {
            opt.HAS_COLOR = 1;
            opt.COLOR_SIZE = this.colors.size;
        }
        return opt;
    },
    getShaderKey() {
        if (this._shaderKey === undefined) {
            this._shaderKey = 'geometry';
            if (this.isMorphGeometry) {
                this._shaderKey += `_id_${this.id}`;
            } else {
                if (this.colors) {
                    this._shaderKey += '_colors';
                }

                if (this.positionDecodeMat) {
                    this._shaderKey += 'positionDecodeMat';
                }
            }
        }

        return this._shaderKey;
    },
    /**
     * 获取数据的内存大小，只处理顶点数据，单位为字节
     * @return {number} 内存占用大小
     */
    getSize() {
        let sum = 0;
        for (const key in this) {
            if (hasOwnProperty(this, key) && this[key] && this[key].isGeometryData) {
                sum += this[key].getByteLength();
            }
        }
        return sum;
    },
    /**
     * @deprecated
     * @return {Geometry} this
     */
    destroy() {
        log.warn('Geometry.destroy has been deprecated, use mesh.destroy(renderer) instead.');
    }
});

export default Geometry;
