import type { GLContext, GLTypeInfo, UniformArray, UniformScalar } from './types';

type GLTypeName =
    | 'FLOAT'
    | 'FLOAT_VEC2'
    | 'FLOAT_VEC3'
    | 'FLOAT_VEC4'
    | 'FLOAT_MAT2'
    | 'FLOAT_MAT3'
    | 'FLOAT_MAT4'
    | 'INT'
    | 'INT_VEC2'
    | 'INT_VEC3'
    | 'INT_VEC4'
    | 'BOOL'
    | 'BOOL_VEC2'
    | 'BOOL_VEC3'
    | 'BOOL_VEC4'
    | 'SAMPLER_2D'
    | 'SAMPLER_CUBE';

type GLTypeDefinition = Omit<GLTypeInfo, 'name' | 'glValue' | 'uniform' | 'uniformArray'> & {
    name: GLTypeName;
};

const DATA_TYPES: readonly GLTypeDefinition[] = [
    { name: 'FLOAT', byteSize: 4, uniformFuncName: 'uniform1f', type: 'Scalar', size: 1 },
    { name: 'FLOAT_VEC2', byteSize: 8, uniformFuncName: 'uniform2f', type: 'Vector', size: 2 },
    { name: 'FLOAT_VEC3', byteSize: 12, uniformFuncName: 'uniform3f', type: 'Vector', size: 3 },
    { name: 'FLOAT_VEC4', byteSize: 16, uniformFuncName: 'uniform4f', type: 'Vector', size: 4 },
    {
        name: 'FLOAT_MAT2',
        byteSize: 16,
        uniformFuncName: 'uniformMatrix2fv',
        type: 'Matrix',
        size: 4
    },
    {
        name: 'FLOAT_MAT3',
        byteSize: 36,
        uniformFuncName: 'uniformMatrix3fv',
        type: 'Matrix',
        size: 9
    },
    {
        name: 'FLOAT_MAT4',
        byteSize: 64,
        uniformFuncName: 'uniformMatrix4fv',
        type: 'Matrix',
        size: 16
    },
    { name: 'INT', byteSize: 4, uniformFuncName: 'uniform1i', type: 'Scalar', size: 1 },
    { name: 'INT_VEC2', byteSize: 8, uniformFuncName: 'uniform2i', type: 'Vector', size: 2 },
    { name: 'INT_VEC3', byteSize: 12, uniformFuncName: 'uniform3i', type: 'Vector', size: 3 },
    { name: 'INT_VEC4', byteSize: 16, uniformFuncName: 'uniform4i', type: 'Vector', size: 4 },
    { name: 'BOOL', byteSize: 4, uniformFuncName: 'uniform1i', type: 'Scalar', size: 1 },
    { name: 'BOOL_VEC2', byteSize: 8, uniformFuncName: 'uniform2i', type: 'Vector', size: 2 },
    { name: 'BOOL_VEC3', byteSize: 12, uniformFuncName: 'uniform3i', type: 'Vector', size: 3 },
    { name: 'BOOL_VEC4', byteSize: 16, uniformFuncName: 'uniform4i', type: 'Vector', size: 4 },
    { name: 'SAMPLER_2D', byteSize: 4, uniformFuncName: 'uniform1i', type: 'Scalar', size: 1 },
    { name: 'SAMPLER_CUBE', byteSize: 4, uniformFuncName: 'uniform1i', type: 'Scalar', size: 1 }
];

const DATA_DICT: Partial<Record<GLenum, GLTypeInfo>> = {};

function setScalar(
    gl: GLContext,
    name: string,
    location: WebGLUniformLocation | null,
    value: UniformScalar | undefined
): void {
    if (value === undefined) return;
    if (name === 'FLOAT') {
        gl.uniform1f(location, Number(value));
    } else {
        gl.uniform1i(location, Number(value));
    }
}

function getGLValue(gl: GLContext, name: GLTypeName): GLenum {
    switch (name) {
        case 'FLOAT':
            return gl.FLOAT;
        case 'FLOAT_VEC2':
            return gl.FLOAT_VEC2;
        case 'FLOAT_VEC3':
            return gl.FLOAT_VEC3;
        case 'FLOAT_VEC4':
            return gl.FLOAT_VEC4;
        case 'FLOAT_MAT2':
            return gl.FLOAT_MAT2;
        case 'FLOAT_MAT3':
            return gl.FLOAT_MAT3;
        case 'FLOAT_MAT4':
            return gl.FLOAT_MAT4;
        case 'INT':
            return gl.INT;
        case 'INT_VEC2':
            return gl.INT_VEC2;
        case 'INT_VEC3':
            return gl.INT_VEC3;
        case 'INT_VEC4':
            return gl.INT_VEC4;
        case 'BOOL':
            return gl.BOOL;
        case 'BOOL_VEC2':
            return gl.BOOL_VEC2;
        case 'BOOL_VEC3':
            return gl.BOOL_VEC3;
        case 'BOOL_VEC4':
            return gl.BOOL_VEC4;
        case 'SAMPLER_2D':
            return gl.SAMPLER_2D;
        case 'SAMPLER_CUBE':
            return gl.SAMPLER_CUBE;
    }
}

function setArray(
    gl: GLContext,
    name: string,
    location: WebGLUniformLocation | null,
    value: UniformArray
): void {
    const values = Array.from(value);
    switch (name) {
        case 'FLOAT':
            gl.uniform1fv(location, values);
            break;
        case 'FLOAT_VEC2':
            gl.uniform2fv(location, values);
            break;
        case 'FLOAT_VEC3':
            gl.uniform3fv(location, values);
            break;
        case 'FLOAT_VEC4':
            gl.uniform4fv(location, values);
            break;
        case 'FLOAT_MAT2':
            gl.uniformMatrix2fv(location, false, values);
            break;
        case 'FLOAT_MAT3':
            gl.uniformMatrix3fv(location, false, values);
            break;
        case 'FLOAT_MAT4':
            gl.uniformMatrix4fv(location, false, values);
            break;
        case 'INT':
        case 'BOOL':
        case 'SAMPLER_2D':
        case 'SAMPLER_CUBE':
            gl.uniform1iv(location, values);
            break;
        case 'INT_VEC2':
        case 'BOOL_VEC2':
            gl.uniform2iv(location, values);
            break;
        case 'INT_VEC3':
        case 'BOOL_VEC3':
            gl.uniform3iv(location, values);
            break;
        case 'INT_VEC4':
        case 'BOOL_VEC4':
            gl.uniform4iv(location, values);
            break;
        default:
            throw new Error(`Unsupported WebGL uniform type: ${name}`);
    }
}

/** WebGL uniform and attribute metadata registry. */
const glType = {
    dict: DATA_DICT,

    init(gl: GLContext): void {
        for (const definition of DATA_TYPES) {
            const glValue = getGLValue(gl, definition.name);
            const info: GLTypeInfo = {
                ...definition,
                glValue,
                uniform: (location, value) => {
                    setScalar(gl, definition.name, location, value);
                },
                uniformArray: (location, value) => {
                    setArray(gl, definition.name, location, value);
                }
            };
            DATA_DICT[glValue] = info;
        }
    },

    get(type: GLenum): GLTypeInfo {
        const info = DATA_DICT[type];
        if (!info) {
            throw new Error(`Unknown WebGL data type: ${String(type)}`);
        }
        return info;
    }
};

export default glType;
