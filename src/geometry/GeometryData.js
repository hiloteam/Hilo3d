import Class from '../core/Class';
import math from '../math/math';
import Vector2 from '../math/Vector2';
import Vector3 from '../math/Vector3';
import Vector4 from '../math/Vector4';
import Matrix4 from '../math/Matrix4';
import log from '../utils/log';
import {
    getTypedArrayGLType,
    getTypedArrayClass
} from '../utils/util';

const sizeVectorMap = {
    2: new Vector2(),
    3: new Vector3(),
    4: new Vector4(),
    16: new Matrix4()
};

/**
 * geometry vertex data
 * @class
 */
const GeometryData = Class.create(/** @lends GeometryData.prototype */ {
    className: 'GeometryData',
    isGeometryData: true,

    /**
     * The number of components per vertex attribute.Must be 1, 2, 3, or 4.
     * @type {Number}
     */
    size: undefined,

    /**
     * Whether integer data values should be normalized when being casted to a float.
     * @type {Boolean}
     * @default false
     */
    normalized: false,

    /**
     * The data type of each component in the array.
     * @type {GLenum}
     */
    type: undefined,

    _isSubDirty: false,
    _isAllDirty: false,

    /**
     * @type {Boolean}
     * @default false
     */
    isDirty: {
        get() {
            return this._isSubDirty || this._isAllDirty;
        },
        set(value) {
            this._isAllDirty = value;
            if (value === false) {
                this.clearSubData();
            }
        }
    },

    /**
     * @type {String}
     */
    bufferViewId: undefined,

    /**
     * glBuffer
     * @type {Buffer}
     */
    glBuffer: null,

    /**
     * @constructs
     * @param  {TypedArray} data  数据
     * @param  {Number} size The number of components per vertex attribute.Must be 1, 2, 3, or 4.
     * @param  {Object} [params] 初始化参数，所有params都会复制到实例上
     */
    constructor(data, size, params) {
        /**
         * id
         * @type {string}
         */
        this.id = math.generateUUID(this.className);

        /**
         * @type {TypedArray}
         */
        this.data = data;
        this.size = size;

        Object.assign(this, params);
        if (!this.bufferViewId) {
            this.bufferViewId = this.id;
        }

        if (!this.size) {
            log.warn('GeometryData.constructor: geometryData must set size!', this);
        }
    },

    _stride: 0,
    /**
     * The offset in bytes between the beginning of consecutive vertex attributes.
     * @type {Number}
     * @default this.size
     */
    stride: {
        get() {
            return this._stride;
        },
        set(value) {
            this._stride = value;
            this.strideSize = value === 0 ? 0 : value / this.data.BYTES_PER_ELEMENT;
        }
    },

    strideSize: 0,

    _offset: 0,
    /**
     * An offset in bytes of the first component in the vertex attribute array. Must be a multiple of type.
     * @type {Number}
     * @default 0
     */
    offset: {
        get() {
            return this._offset;
        },
        set(value) {
            this._offset = value;
            this.offsetSize = value / this.data.BYTES_PER_ELEMENT;
        }
    },

    offsetSize: 0,

    /**
     * @type {TypedArray}
     */
    data: {
        set(data) {
            if (data) {
                this._data = data;
                this.type = getTypedArrayGLType(data);
                this.stride = this._stride;
                this.offset = this._offset;
                this._isAllDirty = true;
            }
        },
        get() {
            return this._data;
        }
    },

    /**
     * @type {Number}
     * @readOnly
     */
    length: {
        get() {
            return this._data.length;
        }
    },

    /**
     * @type {Number}
     * @readOnly
     */
    realLength: {
        get() {
            if (this.strideSize === 0) {
                return this._data.length;
            }
            return this._data.length / this.strideSize * this.size;
        }
    },

    /**
     * 获取数据大小，单位为字节
     * @return {number} 数据大小
     */
    getByteLength() {
        return this._data.BYTES_PER_ELEMENT * this.realLength;
    },

    /**
     * @type {Number}
     * @readOnly
     */
    count: {
        get() {
            if (this.strideSize === 0) {
                return this._data.length / this.size;
            }
            return this._data.length / this.strideSize;
        }
    },

    /**
     * 更新部分数据
     * @param {Number} offset 偏移index
     * @param {TypedArray} data 数据
     */
    setSubData(offset, data) {
        this._isSubDirty = true;
        this.data.set(data, offset);

        if (!this.subDataList) {
            this.subDataList = [];
        }

        const byteOffset = data.BYTES_PER_ELEMENT * offset;
        this.subDataList.push({
            byteOffset,
            data
        });
    },

    /**
     * 清除 subData
     */
    clearSubData() {
        if (this.subDataList) {
            this.subDataList.length = 0;
        }
        this._isSubDirty = false;
    },

    /**
     * clone
     * @return {GeometryData}
     */
    clone() {
        const res = new GeometryData(null, 1);
        res.copy(this);
        return res;
    },
    /**
     * copy
     * @param  {GeometryData} geometryData
     */
    copy(geometryData) {
        const data = geometryData.data;
        this.data = new data.constructor(data);
        this.size = geometryData.size;
        this.stride = geometryData.stride;
        this.normalized = geometryData.normalized;
        this.type = geometryData.type;
        this.offset = geometryData.offset;
    },
    /**
     * 获取偏移值
     * @param  {Number} index
     * @return {Number}
     */
    getOffset(index) {
        const strideSize = this.strideSize;
        if (strideSize === 0) {
            return index * this.size;
        }
        return index * strideSize + this.offsetSize;
    },
    /**
     * Get the value by index.
     * Please note that it will return the same reference for performance reasons. If you want to get a copy, use #getCopy instead.
     * @param  {Number} index
     * @return {Number|Vector2|Vector3|Vector4}
     */
    get(index) {
        const offset = this.getOffset(index);
        return this.getByOffset(offset);
    },

    /**
     * Get the value by index.
     * It will return a copy of value.
     * @param  {Number} index
     * @return {Number|Vector2|Vector3|Vector4}
     */
    getCopy(index) {
        return this.get(index).clone();
    },

    /**
     * 设置值
     * @param {Number} index
     * @param {Number|Vector2|Vector3|Vector4} value
     */
    set(index, value) {
        const offset = this.getOffset(index);
        this.setByOffset(offset, value);
        return offset;
    },
    /**
     * 根据 offset 获取值
     * @param  {Number} offset
     * @return {Number|Vector2|Vector3|Vector4}
     */
    getByOffset(offset) {
        const size = this.size;
        if (size > 1) {
            const tempVector = sizeVectorMap[size];
            return tempVector.fromArray(this._data, offset);
        }

        return this._data[offset];
    },
    /**
     * 根据 offset 设置值
     * @param {Number} offset
     * @param {Number|Vector2|Vector3|Vector4} value
     */
    setByOffset(offset, value) {
        const size = this.size;
        const data = this._data;
        if (size > 1) {
            value.toArray(data, offset);
        } else {
            data[offset] = value;
        }
        this._isAllDirty = true;
    },
    /**
     * 按 index 遍历
     * @param  {GeometryDataTraverseCallback} callback
     * @return {Boolean}
     */
    traverse(callback) {
        const count = this.count;
        for (let index = 0; index < count; index++) {
            const offset = this.getOffset(index);
            const attribute = this.getByOffset(offset);
            if (callback(attribute, index, offset)) {
                return true;
            }
        }

        return false;
    },
    /**
     * 按 Component 遍历 Component
     * @param  {GeometryDataTraverseByComponentCallback} callback
     * @return {Boolean}
     */
    traverseByComponent(callback) {
        const count = this.count;
        const size = this.size;
        const data = this._data;
        for (let index = 0; index < count; index++) {
            const offset = this.getOffset(index);
            const componentIndex = index * size;
            for (let i = 0; i < size; i++) {
                const componentOffset = offset + i;
                if (callback(data[componentOffset], componentIndex + i, componentOffset)) {
                    return true;
                }
            }
        }

        return false;
    },
    merge(geometryData, transform) {
        if (geometryData.type !== this.type || geometryData.size !== this.size) {
            log.warn('geometryData type or size not same, cannot merge!', this, geometryData);
            return this;
        }

        const DataClass = getTypedArrayClass(this.type);
        const length0 = this.realLength;
        const length1 = geometryData.realLength;

        const newData = new DataClass(length0 + length1);
        this.traverseByComponent((data, index) => {
            newData[index] = data;
        });
        geometryData.traverseByComponent((data, index) => {
            if (transform) {
                data = transform(data, index);
            }
            newData[length0 + index] = data;
        });

        this.stride = 0;
        this.offset = 0;
        this.data = newData;

        return this;
    }
});

export default GeometryData;

/**
 * @callback GeometryDataTraverseCallback
 * @param {Number|Vector2|Vector3|Vector4} attribute
 * @param {Number} index
 * @param {Number} offset
 */

/**
 * @callback GeometryDataTraverseByComponentCallback
 * @param {Number} component
 * @param {Number} index
 * @param {Number} offset
 */
