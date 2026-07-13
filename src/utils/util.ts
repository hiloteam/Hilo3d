import {
    BYTE,
    FLOAT,
    INT,
    SHORT,
    UNSIGNED_BYTE,
    UNSIGNED_INT,
    UNSIGNED_SHORT
} from '../constants/webgl';

export type TypedArray =
    | Int8Array
    | Uint8Array
    | Uint8ClampedArray
    | Int16Array
    | Uint16Array
    | Int32Array
    | Uint32Array
    | Float32Array
    | Float64Array;

export type TypedArrayConstructor =
    | Int8ArrayConstructor
    | Uint8ArrayConstructor
    | Uint8ClampedArrayConstructor
    | Int16ArrayConstructor
    | Uint16ArrayConstructor
    | Int32ArrayConstructor
    | Uint32ArrayConstructor
    | Float32ArrayConstructor
    | Float64ArrayConstructor;

export interface MutableArrayLike<Value> {
    length: number;
    [index: number]: Value;
}

export interface GeometryDataLike<Value> {
    readonly isGeometryData: true;
    readonly data: ArrayLike<Value>;
}

/**
 * @param basePath -
 * @param path -
 */
function getRelativePath(basePath: string, path: string): string {
    if (/^(?:https?:|blob:|data:|\/)/u.test(path)) {
        return path;
    }
    const baseSegments = basePath.replace(/\/[^/]*?$/, '').split('/');
    const pathSegments = path.split('/');
    let i;
    for (i = 0; i < pathSegments.length; i++) {
        const p = pathSegments[i];
        if (p === '..') {
            baseSegments.pop();
        } else if (p !== '.') {
            break;
        }
    }
    return `${baseSegments.join('/')}/${pathSegments.slice(i).join('/')}`;
}

const utf8Decoder = new TextDecoder('utf-8');

/**
 * @param array -
 */
function convertUint8ArrayToString(array: Uint8Array | readonly number[]): string {
    const bytes = array instanceof Uint8Array ? array : Uint8Array.from(array);
    return utf8Decoder.decode(bytes);
}

/**
 * @param url -
 */
function getExtension(url: string): string | null {
    const extRegExp = /\/?[^/]+\.(\w+)(?:\?\S+)?$/iu;
    const match = extRegExp.exec(url);

    return match?.[1]?.toLowerCase() ?? null;
}

/**
 * @param obj -
 * @param fn -
 */
function isReadonlyArray<Value>(
    value: readonly Value[] | Readonly<Record<string, Value>>
): value is readonly Value[] {
    return Array.isArray(value);
}

function each<Value>(
    obj: readonly Value[] | Readonly<Record<string, Value>> | null | undefined,
    fn: (value: Value, key: number | string) => void
): void {
    if (!obj) {
        return;
    }

    if (isReadonlyArray(obj)) {
        obj.forEach((value, index) => {
            fn(value, index);
        });
    } else {
        for (const [key, value] of Object.entries(obj)) fn(value, key);
    }
}

/**
 * @param array -
 * @param value -
 * @param compareFn -
 */
function getIndexFromSortedArray<Value>(
    array: readonly Value[] | null | undefined,
    value: Value,
    compareFn: (left: Value, right: Value) => number
): [number, number] {
    if (!array?.length) {
        return [0, 0];
    }
    const len = array.length;
    let low = 0;
    let high = len - 1;

    while (low <= high) {
        const mid = (low + high) >> 1;
        const middleValue = array[mid];
        if (middleValue === undefined) throw new RangeError(`Missing sorted item ${String(mid)}.`);
        const diff = compareFn(middleValue, value);
        if (diff === 0) {
            return [mid, mid];
        }
        if (diff < 0) {
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    if (low > high) {
        return [high, low];
    }
    return [low, high];
}

/**
 * @param array -
 * @param item -
 * @param compareFn -
 */
function insertToSortedArray<Value>(
    array: Value[],
    item: Value,
    compareFn: (left: Value, right: Value) => number
): void {
    const indices = getIndexFromSortedArray(array, item, compareFn);
    array.splice(indices[1], 0, item);
}

/**
 * @param str -
 * @param len -
 * @param char -
 */
function padLeft(str: string, len: number, char = '0'): string {
    if (len <= str.length) {
        return str;
    }

    return char.repeat(len - str.length) + str;
}

/**
 * @param array -
 */
function getTypedArrayGLType(array: TypedArray): GLenum {
    if (array instanceof Float32Array) {
        return FLOAT;
    }

    if (array instanceof Int8Array) {
        return BYTE;
    }

    if (array instanceof Uint8Array) {
        return UNSIGNED_BYTE;
    }

    if (array instanceof Uint8ClampedArray) {
        return UNSIGNED_BYTE;
    }

    if (array instanceof Int16Array) {
        return SHORT;
    }

    if (array instanceof Uint16Array) {
        return UNSIGNED_SHORT;
    }

    if (array instanceof Uint32Array) {
        return UNSIGNED_INT;
    }

    if (array instanceof Int32Array) {
        return INT;
    }

    throw new TypeError(`${array.constructor.name} is not a supported WebGL numeric array.`);
}

/**
 * @param type -
 */
const getTypedArrayClass = (() => {
    const typedArrayClassMap: Readonly<Record<number, TypedArrayConstructor>> = {
        [BYTE]: Int8Array,
        [UNSIGNED_BYTE]: Uint8Array,
        [SHORT]: Int16Array,
        [UNSIGNED_SHORT]: Uint16Array,
        [INT]: Int32Array,
        [UNSIGNED_INT]: Uint32Array,
        [FLOAT]: Float32Array
    };
    return (type: GLenum): TypedArrayConstructor => {
        const TypedArrayClass = typedArrayClassMap[type];
        if (!TypedArrayClass) {
            throw new RangeError(`Unsupported WebGL data type: ${String(type)}.`);
        }
        return TypedArrayClass;
    };
})();

/**
 * @param destArr -
 * @param source -
 * @param destIdx -
 * @param srcIdx -
 * @param count -
 */
function copyArrayData<Value>(
    destArr: MutableArrayLike<Value>,
    source: ArrayLike<Value> | GeometryDataLike<Value>,
    destIdx: number,
    srcIdx: number,
    count: number
): void {
    const srcArr = 'isGeometryData' in source ? source.data : source;
    for (let i = 0; i < count; i++) {
        const sourceIndex = srcIdx + i;
        const value = srcArr[sourceIndex];
        if (value === undefined) throw new RangeError(`Missing array item ${String(sourceIndex)}.`);
        destArr[destIdx + i] = value;
    }
}

/**
 * @param value -
 */
function isStrOrNumber(value: unknown): value is string | number {
    return typeof value === 'string' || typeof value === 'number';
}

/**
 * @param url -
 */
function isBlobUrl(url: string): boolean {
    return url.startsWith('blob:');
}

/**
 * @param blobUrl -
 */
function revokeBlobUrl(blobUrl: string): void {
    URL.revokeObjectURL(blobUrl);
}

/**
 * @param mimeType -
 * @param data -
 */
function getBlobUrl(mimeType: string, data: ArrayBuffer | ArrayBufferView): string {
    const bytes =
        data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const ownedBuffer = Uint8Array.from(bytes).buffer;
    return URL.createObjectURL(new Blob([ownedBuffer], { type: mimeType }));
}

/**
 * @param value -
 */
function isArrayLike(value: unknown): value is ArrayLike<unknown> {
    return (
        value !== null &&
        typeof value === 'object' &&
        'length' in value &&
        typeof value.length === 'number'
    );
}

/**
 * @param elem -
 */
function getElementRect(elem: HTMLElement): {
    left: number;
    top: number;
    width: number;
    height: number;
} {
    const docElem = document.documentElement;
    const bounds = elem.getBoundingClientRect();
    const offsetX = window.scrollX - docElem.clientLeft;
    const offsetY = window.scrollY - docElem.clientTop;
    const styles = getComputedStyle(elem);
    const paddingLeft =
        Number.parseFloat(styles.paddingLeft) + Number.parseFloat(styles.borderLeftWidth) || 0;
    const paddingTop =
        Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.borderTopWidth) || 0;
    const paddingRight =
        Number.parseFloat(styles.paddingRight) + Number.parseFloat(styles.borderRightWidth) || 0;
    const paddingBottom =
        Number.parseFloat(styles.paddingBottom) + Number.parseFloat(styles.borderBottomWidth) || 0;

    const top = bounds.top || 0;
    const left = bounds.left || 0;
    const right = bounds.right || 0;
    const bottom = bounds.bottom || 0;

    return {
        left: left + offsetX + paddingLeft,
        top: top + offsetY + paddingTop,
        width: right - paddingRight - left - paddingLeft,
        height: bottom - paddingBottom - top - paddingTop
    };
}

/**
 * @param data -
 * @param fn -
 */
async function serialRun<Value>(
    data: readonly Value[] | Readonly<Record<string, Value>> = [],
    fn: (value: Value, index: number) => void | PromiseLike<void>
): Promise<void> {
    const values: readonly Value[] = Array.isArray(data) ? data : Object.values<Value>(data);
    for (const [index, value] of values.entries()) {
        await fn(value, index);
    }
}

/**
 * @param obj -
 * @param name -
 */
function hasOwnProperty<Key extends PropertyKey>(
    obj: object,
    name: Key
): obj is object & Record<Key, unknown> {
    return Object.prototype.hasOwnProperty.call(obj, name);
}

export {
    each,
    getRelativePath,
    convertUint8ArrayToString,
    getExtension,
    getIndexFromSortedArray,
    insertToSortedArray,
    padLeft,
    getTypedArrayClass,
    copyArrayData,
    isStrOrNumber,
    getTypedArrayGLType,
    getBlobUrl,
    isBlobUrl,
    revokeBlobUrl,
    isArrayLike,
    getElementRect,
    serialRun,
    hasOwnProperty
};
