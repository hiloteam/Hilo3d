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

type TypedArray = Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array;

const sizeVectorMap: Record<number, Vector2 | Vector3 | Vector4 | Matrix4> = {
    2: new Vector2(),
    3: new Vector3(),
    4: new Vector4(),
    16: new Matrix4()
};

interface SubDataItem {
    byteOffset: number;
    data: TypedArray;
}

/**
 * geometry vertex data
 * @class
 */
class GeometryData {
    /**
     * 类名
     * @type {String}
     * @readOnly
     * @default GeometryData
     */
    readonly className: string = 'GeometryData';

    /**
     * isGeometryData
     * @type {Boolean}
     * @readOnly
     * @default true
     */
    readonly isGeometryData: boolean = true;

    /**
     * id
     * @type {string}
     */
    id: string;

    /**
     * The number of components per vertex attribute.Must be 1, 2, 3, or 4.
     * @type {Number}
     */
    size: number;

    /**
     * Whether integer data values should be normalized when being casted to a float.
     * @type {Boolean}
     * @default false
     */
    normalized: boolean = false;

    /**
     * The data type of each component in the array.
     * @type {GLenum}
     */
    type?: number;

    private _isSubDirty: boolean = false;

    private _isAllDirty: boolean = false;

    /**
     * @type {String}
     */
    bufferViewId?: string;

    /**
     * glBuffer
     * @type {Buffer}
     */
    glBuffer: any = null;

    private _stride: number = 0;

    strideSize: number = 0;

    private _offset: number = 0;

    offsetSize: number = 0;

    private _data!: TypedArray;

    subDataList?: SubDataItem[];

    /**
     * @constructs
     * @param  {TypedArray} data  数据
     * @param  {Number} size The number of components per vertex attribute.Must be 1, 2, 3, or 4.
     * @param  {Object} [params] 初始化参数，所有params都会复制到实例上
     */
    constructor(data: TypedArray | null, size: number, params?: any) {
        this.id = math.generateUUID(this.className);
        this.size = size;

        if (data) {
            this.data = data;
        }

        Object.assign(this, params);
        if (!this.bufferViewId) {
            this.bufferViewId = this.id;
        }

        if (!this.size) {
            log.warn('GeometryData.constructor: geometryData must set size!', this);
        }
    }

    /**
     * @type {Boolean}
     * @default false
     */
    get isDirty(): boolean {
        return this._isSubDirty || this._isAllDirty;
    }

    set isDirty(value: boolean) {
        this._isAllDirty = value;
        if (value === false) {
            this.clearSubData();
        }
    }

    /**
     * The offset in bytes between the beginning of consecutive vertex attributes.
     * @type {Number}
     * @default this.size
     */
    get stride(): number {
        return this._stride;
    }

    set stride(value: number) {
        this._stride = value;
        this.strideSize = value === 0 ? 0 : value / this._data.BYTES_PER_ELEMENT;
    }

    /**
     * An offset in bytes of the first component in the vertex attribute array. Must be a multiple of type.
     * @type {Number}
     * @default 0
     */
    get offset(): number {
        return this._offset;
    }

    set offset(value: number) {
        this._offset = value;
        this.offsetSize = value / this._data.BYTES_PER_ELEMENT;
    }

    /**
     * @type {TypedArray}
     */
    get data(): TypedArray {
        return this._data;
    }

    set data(data: TypedArray) {
        if (data) {
            this._data = data;
            this.type = getTypedArrayGLType(data);
            this.stride = this._stride;
            this.offset = this._offset;
            this._isAllDirty = true;
        }
    }

    /**
     * @type {Number}
     * @readOnly
     */
    get length(): number {
        return this._data.length;
    }

    /**
     * @type {Number}
     * @readOnly
     */
    get realLength(): number {
        if (this.strideSize === 0) {
            return this._data.length;
        }
        return this._data.length / this.strideSize * this.size;
    }

    /**
     * @type {Number}
     * @readOnly
     */
    get count(): number {
        if (this.strideSize === 0) {
            return this._data.length / this.size;
        }
        return this._data.length / this.strideSize;
    }

    /**
     * 获取数据大小，单位为字节
     * @return {number} 数据大小
     */
    getByteLength(): number {
        return this._data.BYTES_PER_ELEMENT * this.realLength;
    }

    /**
     * 更新部分数据
     * @param {Number} offset 偏移index
     * @param {TypedArray} data 数据
     */
    setSubData(offset: number, data: TypedArray): void {
        this._isSubDirty = true;
        this._data.set(data, offset);

        if (!this.subDataList) {
            this.subDataList = [];
        }

        const byteOffset = data.BYTES_PER_ELEMENT * offset;
        this.subDataList.push({
            byteOffset,
            data
        });
    }

    /**
     * 清除 subData
     */
    clearSubData(): void {
        if (this.subDataList) {
            this.subDataList.length = 0;
        }
        this._isSubDirty = false;
    }

    /**
     * clone
     * @return {GeometryData}
     */
    clone(): GeometryData {
        const res = new GeometryData(null, 1);
        res.copy(this);
        return res;
    }

    /**
     * copy
     * @param  {GeometryData} geometryData
     */
    copy(geometryData: GeometryData): void {
        const data = geometryData.data;
        this.data = new (data.constructor as any)(data);
        this.size = geometryData.size;
        this.stride = geometryData.stride;
        this.normalized = geometryData.normalized;
        this.type = geometryData.type;
        this.offset = geometryData.offset;
    }

    /**
     * 获取偏移值
     * @param  {Number} index
     * @return {Number}
     */
    getOffset(index: number): number {
        const strideSize = this.strideSize;
        if (strideSize === 0) {
            return index * this.size;
        }
        return index * strideSize + this.offsetSize;
    }

    /**
     * Get the value by index.
     * Please note that it will return the same reference for performance reasons. If you want to get a copy, use #getCopy instead.
     * @param  {Number} index
     * @return {Number|Vector2|Vector3|Vector4}
     */
    get(index: number): number | Vector2 | Vector3 | Vector4 {
        const offset = this.getOffset(index);
        return this.getByOffset(offset);
    }

    /**
     * Get the value by index.
     * It will return a copy of value.
     * @param  {Number} index
     * @return {Number|Vector2|Vector3|Vector4}
     */
    getCopy(index: number): number | Vector2 | Vector3 | Vector4 {
        const result = this.get(index);
        return typeof result === 'number' ? result : result.clone();
    }

    /**
     * 设置值
     * @param {Number} index
     * @param {Number|Vector2|Vector3|Vector4} value
     */
    set(index: number, value: number | Vector2 | Vector3 | Vector4): number {
        const offset = this.getOffset(index);
        this.setByOffset(offset, value);
        return offset;
    }

    /**
     * 根据 offset 获取值
     * @param  {Number} offset
     * @return {Number|Vector2|Vector3|Vector4}
     */
    getByOffset(offset: number): number | Vector2 | Vector3 | Vector4 {
        const size = this.size;
        if (size > 1) {
            const tempVector = sizeVectorMap[size];
            return (tempVector as any).fromArray(this._data, offset);
        }

        return this._data[offset];
    }

    /**
     * 根据 offset 设置值
     * @param {Number} offset
     * @param {Number|Vector2|Vector3|Vector4} value
     */
    setByOffset(offset: number, value: number | Vector2 | Vector3 | Vector4): void {
        const size = this.size;
        const data = this._data;
        if (size > 1) {
            (value as Vector2 | Vector3 | Vector4).toArray(data, offset);
        } else {
            data[offset] = value as number;
        }
        this._isAllDirty = true;
    }

    /**
     * 按 index 遍历
     * @param  {GeometryDataTraverseCallback} callback
     * @return {Boolean}
     */
    traverse(callback: (attribute: number | Vector2 | Vector3 | Vector4, index: number, offset: number) => boolean | void): boolean {
        const count = this.count;
        for (let index = 0; index < count; index++) {
            const offset = this.getOffset(index);
            const attribute = this.getByOffset(offset);
            if (callback(attribute, index, offset)) {
                return true;
            }
        }

        return false;
    }

    /**
     * 按 Component 遍历 Component
     * @param  {GeometryDataTraverseByComponentCallback} callback
     * @return {Boolean}
     */
    traverseByComponent(callback: (component: number, index: number, offset: number) => boolean | void): boolean {
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
    }

    merge(geometryData: GeometryData, transform?: (data: number, index: number) => number): this {
        if (geometryData.type !== this.type || geometryData.size !== this.size) {
            log.warn('geometryData type or size not same, cannot merge!', this, geometryData);
            return this;
        }

        const DataClass = getTypedArrayClass(this.type!) as any;
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
}

export default GeometryData;
