/** Read a numeric array element while enforcing the bounds assumed by math APIs. */
export function requireNumber(array: ArrayLike<number>, index: number): number {
    const value = array[index];
    if (value === undefined) {
        throw new RangeError(`Expected a number at index ${String(index)}.`);
    }
    return value;
}

export type MutableNumberArray =
    | number[]
    | Float32Array
    | Float64Array
    | Int8Array
    | Uint8Array
    | Uint8ClampedArray
    | Int16Array
    | Uint16Array
    | Int32Array
    | Uint32Array;
