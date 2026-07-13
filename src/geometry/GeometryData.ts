import math from '../math/math';
import Vector2 from '../math/Vector2';
import Vector3 from '../math/Vector3';
import Vector4 from '../math/Vector4';
import Matrix3 from '../math/Matrix3';
import Matrix4 from '../math/Matrix4';
import { getTypedArrayGLType, getTypedArrayClass } from '../utils/util';
import type Buffer from '../renderer/Buffer';
import type { TypedArray } from '../renderer/types';

export type GeometryComponentSize = 1 | 2 | 3 | 4 | 9 | 16;
export type GeometryAttributeValue = number | Vector2 | Vector3 | Vector4 | Matrix3 | Matrix4;
export type GeometryDataTraverseCallback = (
    attribute: GeometryAttributeValue,
    index: number,
    offset: number
) => boolean | undefined;
export type GeometryDataComponentCallback = (
    component: number,
    index: number,
    offset: number
) => boolean | undefined;

export interface GeometryDataParameters {
    normalized?: boolean;
    type?: GLenum;
    bufferViewId?: string;
    stride?: number;
    offset?: number;
}

export interface SubDataUpdate {
    readonly revision: number;
    readonly byteOffset: number;
    readonly data: TypedArray;
}

const MAX_RETAINED_SUB_DATA_UPDATES = 64;

function createAttributeValue(
    size: Exclude<GeometryComponentSize, 1>
): Vector2 | Vector3 | Vector4 | Matrix3 | Matrix4 {
    switch (size) {
        case 2:
            return new Vector2();
        case 3:
            return new Vector3();
        case 4:
            return new Vector4();
        case 9:
            return new Matrix3();
        case 16:
            return new Matrix4();
    }
}

function copyTypedArray(data: TypedArray): TypedArray {
    if (data instanceof Int8Array) return data.slice();
    if (data instanceof Uint8Array) return data.slice();
    if (data instanceof Uint8ClampedArray) return data.slice();
    if (data instanceof Int16Array) return data.slice();
    if (data instanceof Uint16Array) return data.slice();
    if (data instanceof Int32Array) return data.slice();
    if (data instanceof Uint32Array) return data.slice();
    if (data instanceof Float32Array) return data.slice();
    return data.slice();
}
/**
 * geometry vertex data
 */
class GeometryData {
    /**
     * 类名
     */
    readonly className = 'GeometryData';
    /**
     * isGeometryData
     */
    readonly isGeometryData = true;
    /**
     * Components in one logical vertex value. Matrices use 9 (`mat3`) or 16 (`mat4`);
     * `mat2` shares the four-component representation with `vec4`.
     */
    size: GeometryComponentSize;
    /**
     * Whether integer data values should be normalized when being casted to a float.
     */
    normalized = false;
    /**
     * The data type of each component in the array.
     */
    type: GLenum;
    private _isSubDirty = false;
    private _isAllDirty = false;
    private _revision = 0;
    private _fullDataRevision = 0;
    private discardedSubDataRevision = 0;
    /** Monotonic CPU-data revision used by every graphics backend resource cache. */
    get revision(): number {
        return this._revision;
    }
    /** Most recent revision that requires a complete backend upload. */
    get fullDataRevision(): number {
        return this._fullDataRevision;
    }
    get isDirty(): boolean {
        return this._isSubDirty || this._isAllDirty;
    }
    set isDirty(value: boolean) {
        if (value) {
            this._revision++;
            this._fullDataRevision = this._revision;
            this.clearSubData();
        }
        this._isAllDirty = value;
        if (!value) this.clearSubData();
    }
    bufferViewId: string;
    /**
     * glBuffer
     */
    glBuffer: Buffer | null = null;
    readonly id: string;
    private _data: TypedArray;
    private readonly subDataList: SubDataUpdate[] = [];

    get isAllDataDirty(): boolean {
        return this._isAllDirty;
    }

    get subDataUpdates(): readonly SubDataUpdate[] {
        return this.subDataList;
    }

    /**
     * Return partial writes newer than a backend-local revision. `null` means that backend must
     * perform a full upload because a whole-data edit occurred or bounded history was compacted.
     */
    getSubDataUpdatesSince(revision: number): readonly SubDataUpdate[] | null {
        if (revision < this._fullDataRevision || revision < this.discardedSubDataRevision) {
            return null;
        }
        return this.subDataList.filter(update => update.revision > revision);
    }
    /**
     * @param data - 数据
     * @param size - Components in one logical scalar, vector, or square-matrix value.
     * @param params - 初始化参数，所有params都会复制到实例上
     */
    constructor(data: TypedArray, size: GeometryComponentSize, params?: GeometryDataParameters);
    constructor(data: TypedArray, size: number, params: GeometryDataParameters = {}) {
        if (size !== 1 && size !== 2 && size !== 3 && size !== 4 && size !== 9 && size !== 16) {
            throw new RangeError(`GeometryData size ${String(size)} is unsupported`);
        }
        /**
         * id
         */
        this.id = math.generateUUID(this.className);
        this.size = size;
        this._data = data;
        this.type = getTypedArrayGLType(data);
        this.bufferViewId = this.id;
        this.data = data;
        Object.assign(this, params);
        if (!this.bufferViewId) {
            this.bufferViewId = this.id;
        }
    }
    private _stride = 0;
    /**
     * The offset in bytes between the beginning of consecutive vertex attributes.
     */
    get stride(): number {
        return this._stride;
    }
    /**
     * The offset in bytes between the beginning of consecutive vertex attributes.
     */
    set stride(value: number) {
        this._stride = value;
        this.strideSize = value === 0 ? 0 : value / this.data.BYTES_PER_ELEMENT;
    }
    strideSize = 0;
    private _offset = 0;
    /**
     * An offset in bytes of the first component in the vertex attribute array. Must be a multiple of type.
     */
    get offset(): number {
        return this._offset;
    }
    /**
     * An offset in bytes of the first component in the vertex attribute array. Must be a multiple of type.
     */
    set offset(value: number) {
        this._offset = value;
        this.offsetSize = value / this.data.BYTES_PER_ELEMENT;
    }
    offsetSize = 0;
    set data(data: TypedArray) {
        this._data = data;
        this.type = getTypedArrayGLType(data);
        this.stride = this._stride;
        this.offset = this._offset;
        this._isAllDirty = true;
        this._revision++;
        this._fullDataRevision = this._revision;
        this.clearSubData();
    }
    get data(): TypedArray {
        return this._data;
    }
    get length(): number {
        return this._data.length;
    }
    get realLength(): number {
        if (this.strideSize === 0) {
            return this._data.length;
        }
        return (this._data.length / this.strideSize) * this.size;
    }
    /**
     * 获取数据大小，单位为字节
     * @returns 数据大小
     */
    getByteLength(): number {
        return this._data.BYTES_PER_ELEMENT * this.realLength;
    }
    get count(): number {
        if (this.strideSize === 0) {
            return this._data.length / this.size;
        }
        return this._data.length / this.strideSize;
    }
    /**
     * 更新部分数据
     * @param offset - 偏移index
     * @param data - 数据
     */
    setSubData(offset: number, data: TypedArray): void {
        this.data.set(data, offset);
        this._isSubDirty = true;
        this._revision++;
        const byteOffset = this.data.BYTES_PER_ELEMENT * offset;
        const snapshot = copyTypedArray(this.data.subarray(offset, offset + data.length));
        this.subDataList.push({
            revision: this._revision,
            byteOffset,
            data: snapshot
        });
        if (this.subDataList.length > MAX_RETAINED_SUB_DATA_UPDATES) {
            const discarded = this.subDataList.shift();
            if (discarded) this.discardedSubDataRevision = discarded.revision;
        }
    }
    /**
     * 清除 subData
     */
    clearSubData(): void {
        const latest = this.subDataList.at(-1);
        if (latest) this.discardedSubDataRevision = latest.revision;
        this.subDataList.length = 0;
        this._isSubDirty = false;
    }
    /**
     * clone
     */
    clone(): GeometryData {
        const res = new GeometryData(new Uint8Array(0), 1);
        res.copy(this);
        return res;
    }
    /**
     * copy
     * @param geometryData -
     */
    copy(geometryData: GeometryData): this {
        this.data = copyTypedArray(geometryData.data);
        this.size = geometryData.size;
        this.stride = geometryData.stride;
        this.normalized = geometryData.normalized;
        this.type = geometryData.type;
        this.offset = geometryData.offset;
        return this;
    }
    /**
     * 获取偏移值
     * @param index -
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
     * @param index -
     */
    get(index: number): GeometryAttributeValue {
        const offset = this.getOffset(index);
        return this.getByOffset(offset);
    }
    /**
     * Get the value by index.
     * It will return a copy of value.
     * @param index -
     */
    getCopy(index: number): GeometryAttributeValue {
        const value = this.get(index);
        return typeof value === 'number' ? value : value.clone();
    }
    /**
     * 设置值
     * @param index -
     * @param value -
     */
    set(index: number, value: GeometryAttributeValue): number {
        const offset = this.getOffset(index);
        this.setByOffset(offset, value);
        return offset;
    }
    /**
     * 根据 offset 获取值
     * @param offset -
     */
    getByOffset(offset: number): GeometryAttributeValue {
        const size = this.size;
        if (size !== 1) {
            const tempVector = createAttributeValue(size);
            return tempVector.fromArray(this._data, offset);
        }
        const value = this._data[offset];
        if (value === undefined) {
            throw new RangeError(`GeometryData offset ${String(offset)} is out of bounds`);
        }
        return value;
    }
    /**
     * 根据 offset 设置值
     * @param offset -
     * @param value -
     */
    setByOffset(offset: number, value: GeometryAttributeValue): void {
        const size = this.size;
        const data = this._data;
        if (size !== 1) {
            if (typeof value === 'number') {
                throw new TypeError(
                    `GeometryData with size ${String(size)} requires a vector or matrix value`
                );
            }
            value.toArray(data, offset);
        } else {
            if (typeof value !== 'number') {
                throw new TypeError('GeometryData with size 1 requires a numeric value');
            }
            data[offset] = value;
        }
        this._isAllDirty = true;
        this._revision++;
        this._fullDataRevision = this._revision;
        this.clearSubData();
    }
    /**
     * 按 index 遍历
     * @param callback -
     */
    traverse(callback: GeometryDataTraverseCallback): boolean {
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
     * @param callback -
     */
    traverseByComponent(callback: GeometryDataComponentCallback): boolean {
        const count = this.count;
        const size = this.size;
        const data = this._data;
        for (let index = 0; index < count; index++) {
            const offset = this.getOffset(index);
            const componentIndex = index * size;
            for (let i = 0; i < size; i++) {
                const componentOffset = offset + i;
                const component = data[componentOffset];
                if (component === undefined) {
                    throw new RangeError(
                        `GeometryData offset ${String(componentOffset)} is out of bounds`
                    );
                }
                if (callback(component, componentIndex + i, componentOffset)) {
                    return true;
                }
            }
        }
        return false;
    }
    merge(
        geometryData: GeometryData,
        transform?: (component: number, index: number) => number
    ): this {
        if (geometryData.type !== this.type || geometryData.size !== this.size) {
            throw new TypeError('GeometryData.merge requires matching component type and size');
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
}
export default GeometryData;
