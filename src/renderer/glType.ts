import type { GLenum } from '../types/common';

interface GLTypeInfo {
    name: string;
    byteSize: number;
    uniformFuncName: string;
    type: 'Scalar' | 'Vector' | 'Matrix';
    size: number;
    glValue?: GLenum;
    uniform?: (location: WebGLUniformLocation, value: any) => void;
    uniformArray?: (location: WebGLUniformLocation, value: any) => void;
}

const DATA_TYPES: GLTypeInfo[] = [{
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

const DATA_DICT: Record<number, GLTypeInfo> = {};

/**
 * @namespace glType
 * @type {Object}
 */
const glType = {
    dict: DATA_DICT,
    /**
     * init
     * @param gl WebGL context
     */
    init(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
        DATA_TYPES.forEach((dataType) => {
            const name = dataType.name;

            let uniform: (location: WebGLUniformLocation, value: any) => void;
            let uniformArray: (location: WebGLUniformLocation, value: any) => void;
            const uniformFuncName = dataType.uniformFuncName;
            const uniformArrayFuncName = uniformFuncName + 'v';

            if (dataType.type === 'Matrix') {
                uniform = uniformArray = (location, value) => {
                    if (value === undefined) {
                        return;
                    }
                    (gl as any)[uniformFuncName](location, false, value);
                };
            } else {
                uniform = (location, value) => {
                    if (value === undefined) {
                        return;
                    }
                    (gl as any)[uniformFuncName](location, value);
                };
                uniformArray = (location, value) => {
                    (gl as any)[uniformArrayFuncName](location, value);
                };
            }

            DATA_DICT[(gl as any)[name]] = Object.assign(dataType, {
                glValue: (gl as any)[name],
                uniform,
                uniformArray
            });
        });
    },
    /**
     * 获取信息
     * @param type GL enum type
     * @return glTypeInfo
     */
    get(type: GLenum): GLTypeInfo | undefined {
        return DATA_DICT[type];
    }
};

export default glType;
export type { GLTypeInfo };
