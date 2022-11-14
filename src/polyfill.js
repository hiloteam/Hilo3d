import ObjectAssign from 'object-assign';
import objectKeys from 'object.keys';
import ObjectValues from 'object-values';
import pinkiePromise from 'pinkie-promise';

if (!Object.assign) {
    Object.assign = ObjectAssign;
}

if (!Object.keys) {
    Object.keys = objectKeys;
}

if (!Object.values) {
    Object.values = ObjectValues;
}

if (typeof Promise === 'undefined') {
    window.Promise = pinkiePromise;
}

// iOS 9 doesn't support TypedArray slice, forEach
[
    Int8Array,
    Uint8Array,
    Int16Array,
    Uint16Array,
    Uint32Array,
    Float32Array
].forEach((TypedArray) => {
    if (!TypedArray.prototype.slice) {
        Object.defineProperty(TypedArray.prototype, 'slice', {
            value(begin, end) {
                return new TypedArray(Array.prototype.slice.call(this, begin, end));
            }
        });
    }

    if (!TypedArray.prototype.forEach) {
        Object.defineProperty(TypedArray.prototype, 'forEach', {
            value(callback, thisArg) {
                const array = this;
                thisArg = thisArg || this;
                for (let i = 0, l = array.length; i !== l; ++i) {
                    callback.call(thisArg, array[i], i, array);
                }
            }
        });
    }
});
