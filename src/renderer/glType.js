const DATA_TYPES = [{
    name: 'FLOAT',
    byteSize: 4,
    uniformFuncName: 'uniform1f',
    type: 'Scalar',
    size: 1
}, {
    name: 'FLOAT_VEC2',
    byteSize: 8,
    uniformFuncName: 'uniform2f',
    type: 'Vector',
    size: 2
}, {
    name: 'FLOAT_VEC3',
    byteSize: 12,
    uniformFuncName: 'uniform3f',
    type: 'Vector',
    size: 3
}, {
    name: 'FLOAT_VEC4',
    byteSize: 16,
    uniformFuncName: 'uniform4f',
    type: 'Vector',
    size: 4
}, {
    name: 'FLOAT_MAT2',
    byteSize: 16,
    uniformFuncName: 'uniformMatrix2fv',
    type: 'Matrix',
    size: 4
}, {
    name: 'FLOAT_MAT3',
    byteSize: 36,
    uniformFuncName: 'uniformMatrix3fv',
    type: 'Matrix',
    size: 9
}, {
    name: 'FLOAT_MAT4',
    byteSize: 64,
    uniformFuncName: 'uniformMatrix4fv',
    type: 'Matrix',
    size: 16
}, {
    name: 'INT',
    byteSize: 4,
    uniformFuncName: 'uniform1i',
    type: 'Scalar',
    size: 1
}, {
    name: 'INT_VEC2',
    byteSize: 8,
    uniformFuncName: 'uniform2i',
    type: 'Vector',
    size: 2
}, {
    name: 'INT_VEC3',
    byteSize: 12,
    uniformFuncName: 'uniform3i',
    type: 'Vector',
    size: 3
}, {
    name: 'INT_VEC4',
    byteSize: 16,
    uniformFuncName: 'uniform4i',
    type: 'Vector',
    size: 4
}, {
    name: 'BOOL',
    byteSize: 4,
    uniformFuncName: 'uniform1i',
    type: 'Scalar',
    size: 1
}, {
    name: 'BOOL_VEC2',
    byteSize: 8,
    uniformFuncName: 'uniform2i',
    type: 'Vector',
    size: 2
}, {
    name: 'BOOL_VEC3',
    byteSize: 12,
    uniformFuncName: 'uniform3i',
    type: 'Vector',
    size: 3
}, {
    name: 'BOOL_VEC4',
    byteSize: 16,
    uniformFuncName: 'uniform4i',
    type: 'Vector',
    size: 4
}, {
    name: 'SAMPLER_2D',
    byteSize: 4,
    uniformFuncName: 'uniform1i',
    type: 'Scalar',
    size: 1
}, {
    name: 'SAMPLER_CUBE',
    byteSize: 4,
    uniformFuncName: 'uniform1i',
    type: 'Scalar',
    size: 1
}];

const DATA_DICT = {};

/**
 * @namespace glType
 * @type {Object}
 */
const glType = {
    dict: DATA_DICT,
    /**
     * init
     * @param  {WebGLRenderingContext} gl
     */
    init(gl) {
        DATA_TYPES.forEach((dataType) => {
            const name = dataType.name;

            let uniform;
            let uniformArray;
            let uniformFuncName = dataType.uniformFuncName;
            let uniformArrayFuncName = uniformFuncName + 'v';

            if (dataType.type === 'Matrix') {
                uniform = uniformArray = (location, value) => {
                    if (value === undefined) {
                        return;
                    }
                    gl[uniformFuncName](location, false, value);
                };
            } else {
                uniform = (location, value) => {
                    if (value === undefined) {
                        return;
                    }
                    gl[uniformFuncName](location, value);
                };
                uniformArray = (location, value) => {
                    gl[uniformArrayFuncName](location, value);
                };
            }

            DATA_DICT[gl[name]] = Object.assign(dataType, {
                glValue: gl[name],
                uniform,
                uniformArray
            });
        });
    },
    /**
     * 获取信息
     * @param  {GLenum} type
     * @return {glTypeInfo}
     */
    get(type) {
        return DATA_DICT[type];
    }
};

export default glType;

/**
 * @typedef {Object} glTypeInfo
 * @property {String} name 名字，e.g. FLOAT_VEC2
 * @property {Number} byteSize 字节大小
 * @property {String} uniformFuncName uniform方法名字，e.g. uniform3f
 * @property {String} type 类型，可以是 Scalar, Vector, Matrix
 * @property {Number} size 数量
 * @property {GLenum} glValue gl enum值
 * @property {function} uniform uniform单个值方法
 * @property {function} uniformArray uniform多个值方法
 */
