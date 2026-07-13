import type { GLContext, GLTypeInfo } from './types';

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
    | 'UNSIGNED_INT'
    | 'UNSIGNED_INT_VEC2'
    | 'UNSIGNED_INT_VEC3'
    | 'UNSIGNED_INT_VEC4'
    | 'BOOL'
    | 'BOOL_VEC2'
    | 'BOOL_VEC3'
    | 'BOOL_VEC4'
    | 'SAMPLER_2D'
    | 'SAMPLER_CUBE';

type GLTypeDefinition = Omit<GLTypeInfo, 'name' | 'glValue'> & {
    name: GLTypeName;
};

const DATA_TYPES: readonly GLTypeDefinition[] = [
    { name: 'FLOAT', byteSize: 4, type: 'Scalar', size: 1 },
    { name: 'FLOAT_VEC2', byteSize: 8, type: 'Vector', size: 2 },
    { name: 'FLOAT_VEC3', byteSize: 12, type: 'Vector', size: 3 },
    { name: 'FLOAT_VEC4', byteSize: 16, type: 'Vector', size: 4 },
    {
        name: 'FLOAT_MAT2',
        byteSize: 16,
        type: 'Matrix',
        size: 4
    },
    {
        name: 'FLOAT_MAT3',
        byteSize: 36,
        type: 'Matrix',
        size: 9
    },
    {
        name: 'FLOAT_MAT4',
        byteSize: 64,
        type: 'Matrix',
        size: 16
    },
    { name: 'INT', byteSize: 4, type: 'Scalar', size: 1 },
    { name: 'INT_VEC2', byteSize: 8, type: 'Vector', size: 2 },
    { name: 'INT_VEC3', byteSize: 12, type: 'Vector', size: 3 },
    { name: 'INT_VEC4', byteSize: 16, type: 'Vector', size: 4 },
    { name: 'UNSIGNED_INT', byteSize: 4, type: 'Scalar', size: 1 },
    { name: 'UNSIGNED_INT_VEC2', byteSize: 8, type: 'Vector', size: 2 },
    { name: 'UNSIGNED_INT_VEC3', byteSize: 12, type: 'Vector', size: 3 },
    { name: 'UNSIGNED_INT_VEC4', byteSize: 16, type: 'Vector', size: 4 },
    { name: 'BOOL', byteSize: 4, type: 'Scalar', size: 1 },
    { name: 'BOOL_VEC2', byteSize: 8, type: 'Vector', size: 2 },
    { name: 'BOOL_VEC3', byteSize: 12, type: 'Vector', size: 3 },
    { name: 'BOOL_VEC4', byteSize: 16, type: 'Vector', size: 4 },
    { name: 'SAMPLER_2D', byteSize: 4, type: 'Scalar', size: 1 },
    { name: 'SAMPLER_CUBE', byteSize: 4, type: 'Scalar', size: 1 }
];

const DATA_DICT: Partial<Record<GLenum, GLTypeInfo>> = {};

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
        case 'UNSIGNED_INT':
            return gl.UNSIGNED_INT;
        case 'UNSIGNED_INT_VEC2':
            return gl.UNSIGNED_INT_VEC2;
        case 'UNSIGNED_INT_VEC3':
            return gl.UNSIGNED_INT_VEC3;
        case 'UNSIGNED_INT_VEC4':
            return gl.UNSIGNED_INT_VEC4;
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

/** WebGL vertex attribute metadata registry. */
const glType = {
    dict: DATA_DICT,

    init(gl: GLContext): void {
        for (const definition of DATA_TYPES) {
            const glValue = getGLValue(gl, definition.name);
            const info: GLTypeInfo = {
                ...definition,
                glValue
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
