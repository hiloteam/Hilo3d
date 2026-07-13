type MutableTypedArray =
    | Float32Array
    | Float64Array
    | Int8Array
    | Int16Array
    | Int32Array
    | Uint8Array
    | Uint8ClampedArray
    | Uint16Array
    | Uint32Array;

interface TypedArrayConstructor<ArrayType extends MutableTypedArray> {
    readonly BYTES_PER_ELEMENT: number;
    new (buffer: ArrayBuffer, byteOffset: number, length: number): ArrayType;
}

let cachedBuffer = new ArrayBuffer(1);

function updateBuffer(byteSize: number): void {
    if (cachedBuffer.byteLength < byteSize) cachedBuffer = new ArrayBuffer(byteSize * 2);
}

const bufferUtil = {
    getTypedArray<ArrayType extends MutableTypedArray>(
        constructor: TypedArrayConstructor<ArrayType>,
        length: number
    ): ArrayType {
        updateBuffer(length * constructor.BYTES_PER_ELEMENT);
        return new constructor(cachedBuffer, 0, length);
    },

    fillArrayData(typedArray: MutableTypedArray, data: ArrayLike<number>, offset = 0): void {
        for (let index = 0; index < data.length; index++) {
            const value = data[index];
            if (value === undefined) throw new RangeError(`Missing buffer item ${String(index)}.`);
            typedArray[offset + index] = value;
        }
    }
};

export default bufferUtil;
