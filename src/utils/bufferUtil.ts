type TypedArrayConstructor = 
    | Int8ArrayConstructor
    | Uint8ArrayConstructor
    | Uint8ClampedArrayConstructor
    | Int16ArrayConstructor
    | Uint16ArrayConstructor
    | Int32ArrayConstructor
    | Uint32ArrayConstructor
    | Float32ArrayConstructor
    | Float64ArrayConstructor;

type TypedArray =
    | Int8Array
    | Uint8Array
    | Uint8ClampedArray
    | Int16Array
    | Uint16Array
    | Int32Array
    | Uint32Array
    | Float32Array
    | Float64Array;

let cachedBuffer = new ArrayBuffer(1);

const bufferUtil = {
    getTypedArray<T extends TypedArray>(
        constructor: TypedArrayConstructor,
        length: number
    ): T {
        this._updateBuffer(length * constructor.BYTES_PER_ELEMENT);
        return new (constructor as any)(cachedBuffer, 0, length) as T;
    },

    fillArrayData(
        typedArray: TypedArray,
        data: number[] | TypedArray,
        offset: number = 0
    ): void {
        for (let i = 0, l = data.length; i < l; i++) {
            typedArray[offset + i] = data[i];
        }
    },

    _updateBuffer(byteSize: number): void {
        if (cachedBuffer.byteLength < byteSize) {
            cachedBuffer = new ArrayBuffer(byteSize * 2);
        }
    }
};

export default bufferUtil;
