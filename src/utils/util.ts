import log from './log';
import constants from '../constants';

/**
 * @namespace util
 */

const {
    BYTE,
    UNSIGNED_BYTE,
    SHORT,
    UNSIGNED_SHORT,
    UNSIGNED_INT,
    FLOAT
} = constants;

/**
 * @memberOf util
 * @param  {string} basePath
 * @param  {string} path
 * @return {string}
 */
function getRelativePath(basePath, path) {
    if (/^(?:http|blob|data:|\/)/.test(path)) {
        return path;
    }
    basePath = basePath.replace(/\/[^/]*?$/, '').split('/');
    path = path.split('/');
    let i;
    for (i = 0; i < path.length; i++) {
        let p = path[i];
        if (p === '..') {
            basePath.pop();
        } else if (p !== '.') {
            break;
        }
    }
    return basePath.join('/') + '/' + path.slice(i).join('/');
}

let utf8Decoder;

/**
 * @memberOf util
 * @param  {Uint8Array|number[]} array
 * @param  {boolean} [isUTF8=false]
 * @return {string}
 */
function convertUint8ArrayToString(array, isUTF8) {
    if (window.TextDecoder) {
        if (!utf8Decoder) {
            utf8Decoder = new TextDecoder('utf-8');
        }

        if (!(array instanceof Uint8Array)) {
            array = new Uint8Array(array);
        }
        return utf8Decoder.decode(array);
    }

    let str = '';

    for (let i = 0; i < array.length; i++) {
        str += String.fromCharCode(array[i]);
    }

    if (isUTF8) {
        // utf8 str fix
        // https://developer.mozilla.org/zh-CN/docs/Web/API/WindowBase64/btoa
        str = decodeURIComponent(escape(str));
    }
    return str;
}

/**
 * @memberOf util
 * @param  {string} url
 * @return {string}
 */
function getExtension(url) {
    const extRegExp = /\/?[^/]+\.(\w+)(\?\S+)?$/i;
    const match = String(url).match(extRegExp);

    return match && match[1].toLowerCase() || null;
}

/**
 * @memberOf util
 * @param  {object}   obj
 * @param  {Function} fn
 */
function each(obj, fn) {
    if (!obj) {
        return;
    }

    if (Array.isArray(obj)) {
        obj.forEach(fn);
    } else {
        Object.keys(obj).forEach((key) => {
            fn(obj[key], key);
        });
    }
}

/**
 * @memberOf util
 * @param  {any[]} array
 * @param  {any} value
 * @param  {Function} compareFn
 * @return {number[]}
 */
function getIndexFromSortedArray(array, value, compareFn) {
    if (!array || !array.length) {
        return [0, 0];
    }
    const len = array.length;
    let low = 0;
    let high = len - 1;

    while (low <= high) {
        let mid = (low + high) >> 1;
        let diff = compareFn(array[mid], value);
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
 * @memberOf util
 * @param  {any[]} array
 * @param  {any} item
 * @param  {Function} compareFn
 */
function insertToSortedArray(array, item, compareFn) {
    const indices = getIndexFromSortedArray(array, item, compareFn);
    array.splice(indices[1], 0, item);
}

/**
 * @memberOf util
 * @param  {string} str
 * @param  {number} len
 * @param  {string} char
 * @return {string}
 */
function padLeft(str, len, char) {
    if (len <= str.length) {
        return str;
    }

    return new Array(len - str.length + 1).join(char || '0') + str;
}

/**
 * @memberOf util
 * @param  {TypedArray} array
 * @return {GLenum}
 */
function getTypedArrayGLType(array) {
    if (array instanceof Float32Array) {
        return FLOAT;
    }

    if (array instanceof Int8Array) {
        return BYTE;
    }

    if (array instanceof Uint8Array) {
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

    return FLOAT;
}

/**
 * @memberOf util
 * @method getTypedArrayClass
 * @param  {GLenum} type
 * @return {any}
 */
const getTypedArrayClass = (function() {
    const TypedArrayClassMap = {
        [BYTE]: Int8Array,
        [UNSIGNED_BYTE]: Uint8Array,
        [SHORT]: Int16Array,
        [UNSIGNED_SHORT]: Uint16Array,
        [UNSIGNED_INT]: Uint32Array,
        [FLOAT]: Float32Array
    };
    return function(type) {
        return TypedArrayClassMap[type] || Float32Array;
    };
}());

/**
 * @memberOf util
 * @param  {any[]} destArr
 * @param  {any[]} srcArr
 * @param  {number} destIdx
 * @param  {number} srcIdx
 * @param  {number} count
 */
function copyArrayData(destArr, srcArr, destIdx, srcIdx, count) {
    if (!destArr || !srcArr) {
        return;
    }
    if (srcArr.isGeometryData) {
        srcArr = srcArr.data;
    }
    for (let i = 0; i < count; i++) {
        destArr[destIdx + i] = srcArr[srcIdx + i];
    }
}

/**
 * @memberOf util
 * @param  {any}  d
 * @return {boolean}
 */
function isStrOrNumber(d) {
    return typeof d === 'string' || typeof d === 'number';
}

/**
 * @memberOf util
 * @param  {string}  url
 * @return {boolean}
 */
function isBlobUrl(url) {
    return /^blob:/.test(url);
}

/**
 * @memberOf util
 * @param  {string} blobUrl
 */
function revokeBlobUrl(blobUrl) {
    if (window.URL) {
        URL.revokeObjectURL(blobUrl);
    }
}

/**
 * @memberOf util
 * @param  {string} mimeType
 * @param  {ArrayBuffer|TypedArray} data
 * @return {string}
 */
function getBlobUrl(mimeType, data) {
    if (data instanceof ArrayBuffer) {
        data = new Uint8Array(data);
    }
    if (window.Blob && window.URL) {
        try {
            const blob = new Blob([data], {
                type: mimeType
            });

            const blobUrl = window.URL.createObjectURL(blob);
            return blobUrl;
        } catch (err) {
            log.warn('new Blob error', mimeType);
        }
    }

    return `data:${mimeType};base64,${btoa(convertUint8ArrayToString(data))}`;
}

/**
 * @memberOf util
 * @param  {any}  obj
 * @return {boolean}
 */
function isArrayLike(obj) {
    return Array.isArray(obj) || obj.BYTES_PER_ELEMENT || obj.length;
}

/**
 * @memberOf util
 * @param  {Element} elem
 * @return {any}
 */
function getElementRect(elem) {
    const docElem = document.documentElement;
    let bounds;
    try {
        // this fails if it's a disconnected DOM node
        bounds = elem.getBoundingClientRect();
    } catch (e) {
        bounds = {
            top: elem.offsetTop,
            left: elem.offsetLeft,
            right: elem.offsetLeft + elem.offsetWidth,
            bottom: elem.offsetTop + elem.offsetHeight
        };
    }

    const offsetX = ((window.pageXOffset || docElem.scrollLeft) - (docElem.clientLeft || 0)) || 0;
    const offsetY = ((window.pageYOffset || docElem.scrollTop) - (docElem.clientTop || 0)) || 0;
    const styles = window.getComputedStyle ? getComputedStyle(elem) : elem.currentStyle;
    const parseIntFn = parseInt;

    const padLeft = (parseIntFn(styles.paddingLeft) + parseIntFn(styles.borderLeftWidth)) || 0;
    const padTop = (parseIntFn(styles.paddingTop) + parseIntFn(styles.borderTopWidth)) || 0;
    const padRight = (parseIntFn(styles.paddingRight) + parseIntFn(styles.borderRightWidth)) || 0;
    const padBottom = (parseIntFn(styles.paddingBottom) + parseIntFn(styles.borderBottomWidth)) || 0;

    const top = bounds.top || 0;
    const left = bounds.left || 0;
    const right = bounds.right || 0;
    const bottom = bounds.bottom || 0;

    return {
        left: left + offsetX + padLeft,
        top: top + offsetY + padTop,
        width: right - padRight - left - padLeft,
        height: bottom - padBottom - top - padTop
    };
}

/**
 * @memberOf util
 * @param  {any}   data
 * @param  {Function} fn
 * @return {Promise<any>}
 */
function serialRun(data = {}, fn) {
    if (!Array.isArray(data)) {
        data = Object.values(data);
    }
    return data.reduce((seq, d, i) => {
        return seq.then(() => {
            return fn(d, i);
        });
    }, Promise.resolve());
}

/**
 * @memberOf util
 * @param  {any}  obj
 * @param  {string}  name
 * @return {boolean}
 */
function hasOwnProperty(obj, name) {
    return Object.prototype.hasOwnProperty.call(obj, name);
}

/**
 * 是否是 WebGL2
 * @memberOf util
 * @param  {any}  gl
 * @return {boolean}
 */
function isWebGL2(gl) {
    return typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
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
    hasOwnProperty,
    isWebGL2,
};
