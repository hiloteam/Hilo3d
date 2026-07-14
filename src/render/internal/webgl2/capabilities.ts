import type { WebGLExtensions } from './extensions';
import type { ShaderPrecision } from '../../types';
import type { GLContext } from './WebGLTypes';

export type NumericCapabilityName =
    | 'MAX_RENDERBUFFER_SIZE'
    | 'MAX_COMBINED_TEXTURE_IMAGE_UNITS'
    | 'MAX_CUBE_MAP_TEXTURE_SIZE'
    | 'MAX_FRAGMENT_UNIFORM_COMPONENTS'
    | 'MAX_TEXTURE_IMAGE_UNITS'
    | 'MAX_TEXTURE_SIZE'
    | 'MAX_3D_TEXTURE_SIZE'
    | 'MAX_ARRAY_TEXTURE_LAYERS'
    | 'MAX_COLOR_ATTACHMENTS'
    | 'MAX_DRAW_BUFFERS'
    | 'MAX_SAMPLES'
    | 'MAX_VARYING_COMPONENTS'
    | 'MAX_VERTEX_ATTRIBS'
    | 'MAX_VERTEX_TEXTURE_IMAGE_UNITS'
    | 'MAX_VERTEX_UNIFORM_COMPONENTS'
    | 'MAX_UNIFORM_BUFFER_BINDINGS'
    | 'MAX_UNIFORM_BLOCK_SIZE'
    | 'UNIFORM_BUFFER_OFFSET_ALIGNMENT'
    | 'MAX_COMBINED_UNIFORM_BLOCKS'
    | 'MAX_VERTEX_UNIFORM_BLOCKS'
    | 'MAX_FRAGMENT_UNIFORM_BLOCKS';

function capabilityEnum(gl: GLContext, name: NumericCapabilityName): GLenum {
    switch (name) {
        case 'MAX_RENDERBUFFER_SIZE':
            return gl.MAX_RENDERBUFFER_SIZE;
        case 'MAX_COMBINED_TEXTURE_IMAGE_UNITS':
            return gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS;
        case 'MAX_CUBE_MAP_TEXTURE_SIZE':
            return gl.MAX_CUBE_MAP_TEXTURE_SIZE;
        case 'MAX_FRAGMENT_UNIFORM_COMPONENTS':
            return gl.MAX_FRAGMENT_UNIFORM_COMPONENTS;
        case 'MAX_TEXTURE_IMAGE_UNITS':
            return gl.MAX_TEXTURE_IMAGE_UNITS;
        case 'MAX_TEXTURE_SIZE':
            return gl.MAX_TEXTURE_SIZE;
        case 'MAX_3D_TEXTURE_SIZE':
            return gl.MAX_3D_TEXTURE_SIZE;
        case 'MAX_ARRAY_TEXTURE_LAYERS':
            return gl.MAX_ARRAY_TEXTURE_LAYERS;
        case 'MAX_COLOR_ATTACHMENTS':
            return gl.MAX_COLOR_ATTACHMENTS;
        case 'MAX_DRAW_BUFFERS':
            return gl.MAX_DRAW_BUFFERS;
        case 'MAX_SAMPLES':
            return gl.MAX_SAMPLES;
        case 'MAX_VARYING_COMPONENTS':
            return gl.MAX_VARYING_COMPONENTS;
        case 'MAX_VERTEX_ATTRIBS':
            return gl.MAX_VERTEX_ATTRIBS;
        case 'MAX_VERTEX_TEXTURE_IMAGE_UNITS':
            return gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS;
        case 'MAX_VERTEX_UNIFORM_COMPONENTS':
            return gl.MAX_VERTEX_UNIFORM_COMPONENTS;
        case 'MAX_UNIFORM_BUFFER_BINDINGS':
            return gl.MAX_UNIFORM_BUFFER_BINDINGS;
        case 'MAX_UNIFORM_BLOCK_SIZE':
            return gl.MAX_UNIFORM_BLOCK_SIZE;
        case 'UNIFORM_BUFFER_OFFSET_ALIGNMENT':
            return gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT;
        case 'MAX_COMBINED_UNIFORM_BLOCKS':
            return gl.MAX_COMBINED_UNIFORM_BLOCKS;
        case 'MAX_VERTEX_UNIFORM_BLOCKS':
            return gl.MAX_VERTEX_UNIFORM_BLOCKS;
        case 'MAX_FRAGMENT_UNIFORM_BLOCKS':
            return gl.MAX_FRAGMENT_UNIFORM_BLOCKS;
    }
}

function numericParameter(gl: GLContext, name: NumericCapabilityName): number {
    const value: unknown = gl.getParameter(capabilityEnum(gl, name));
    if (typeof value !== 'number') {
        throw new Error(`WebGL capability ${name} did not return a number`);
    }
    return value;
}

class WebGLCapabilities {
    MAX_TEXTURE_INDEX = 0;
    MAX_PRECISION: ShaderPrecision = 'lowp';
    MAX_VERTEX_PRECISION: ShaderPrecision = 'lowp';
    MAX_FRAGMENT_PRECISION: ShaderPrecision = 'lowp';
    MAX_TEXTURE_MAX_ANISOTROPY = 1;
    MAX_RENDERBUFFER_SIZE = 0;
    MAX_COMBINED_TEXTURE_IMAGE_UNITS = 0;
    MAX_CUBE_MAP_TEXTURE_SIZE = 0;
    MAX_FRAGMENT_UNIFORM_COMPONENTS = 0;
    MAX_TEXTURE_IMAGE_UNITS = 0;
    MAX_TEXTURE_SIZE = 0;
    MAX_3D_TEXTURE_SIZE = 0;
    MAX_ARRAY_TEXTURE_LAYERS = 0;
    MAX_COLOR_ATTACHMENTS = 0;
    MAX_DRAW_BUFFERS = 0;
    MAX_SAMPLES = 0;
    MAX_VARYING_COMPONENTS = 0;
    MAX_VERTEX_ATTRIBS = 0;
    MAX_VERTEX_TEXTURE_IMAGE_UNITS = 0;
    MAX_VERTEX_UNIFORM_COMPONENTS = 0;
    MAX_UNIFORM_BUFFER_BINDINGS = 0;
    MAX_UNIFORM_BLOCK_SIZE = 0;
    UNIFORM_BUFFER_OFFSET_ALIGNMENT = 0;
    MAX_COMBINED_UNIFORM_BLOCKS = 0;
    MAX_VERTEX_UNIFORM_BLOCKS = 0;
    MAX_FRAGMENT_UNIFORM_BLOCKS = 0;
    private gl: GLContext | null = null;
    private readonly extensions: WebGLExtensions;

    constructor(contextExtensions: WebGLExtensions) {
        this.extensions = contextExtensions;
    }

    init(gl: GLContext): void {
        this.gl = gl;
        this.MAX_TEXTURE_MAX_ANISOTROPY = 1;

        this.MAX_RENDERBUFFER_SIZE = this.get('MAX_RENDERBUFFER_SIZE');
        this.MAX_COMBINED_TEXTURE_IMAGE_UNITS = this.get('MAX_COMBINED_TEXTURE_IMAGE_UNITS');
        this.MAX_CUBE_MAP_TEXTURE_SIZE = this.get('MAX_CUBE_MAP_TEXTURE_SIZE');
        this.MAX_FRAGMENT_UNIFORM_COMPONENTS = this.get('MAX_FRAGMENT_UNIFORM_COMPONENTS');
        this.MAX_TEXTURE_IMAGE_UNITS = this.get('MAX_TEXTURE_IMAGE_UNITS');
        this.MAX_TEXTURE_SIZE = this.get('MAX_TEXTURE_SIZE');
        this.MAX_3D_TEXTURE_SIZE = this.get('MAX_3D_TEXTURE_SIZE');
        this.MAX_ARRAY_TEXTURE_LAYERS = this.get('MAX_ARRAY_TEXTURE_LAYERS');
        this.MAX_COLOR_ATTACHMENTS = this.get('MAX_COLOR_ATTACHMENTS');
        this.MAX_DRAW_BUFFERS = this.get('MAX_DRAW_BUFFERS');
        this.MAX_SAMPLES = this.get('MAX_SAMPLES');
        this.MAX_VARYING_COMPONENTS = this.get('MAX_VARYING_COMPONENTS');
        this.MAX_VERTEX_ATTRIBS = this.get('MAX_VERTEX_ATTRIBS');
        this.MAX_VERTEX_TEXTURE_IMAGE_UNITS = this.get('MAX_VERTEX_TEXTURE_IMAGE_UNITS');
        this.MAX_VERTEX_UNIFORM_COMPONENTS = this.get('MAX_VERTEX_UNIFORM_COMPONENTS');
        this.MAX_UNIFORM_BUFFER_BINDINGS = this.get('MAX_UNIFORM_BUFFER_BINDINGS');
        this.MAX_UNIFORM_BLOCK_SIZE = this.get('MAX_UNIFORM_BLOCK_SIZE');
        this.UNIFORM_BUFFER_OFFSET_ALIGNMENT = this.get('UNIFORM_BUFFER_OFFSET_ALIGNMENT');
        this.MAX_COMBINED_UNIFORM_BLOCKS = this.get('MAX_COMBINED_UNIFORM_BLOCKS');
        this.MAX_VERTEX_UNIFORM_BLOCKS = this.get('MAX_VERTEX_UNIFORM_BLOCKS');
        this.MAX_FRAGMENT_UNIFORM_BLOCKS = this.get('MAX_FRAGMENT_UNIFORM_BLOCKS');

        this.MAX_TEXTURE_INDEX = this.MAX_COMBINED_TEXTURE_IMAGE_UNITS - 1;
        this.MAX_VERTEX_PRECISION = this.getMaxSupportedPrecision(gl.VERTEX_SHADER);
        this.MAX_FRAGMENT_PRECISION = this.getMaxSupportedPrecision(gl.FRAGMENT_SHADER);
        this.MAX_PRECISION = this.getMaxPrecision(
            this.MAX_FRAGMENT_PRECISION,
            this.MAX_VERTEX_PRECISION
        );
        const anisotropic = this.extensions.textureFilterAnisotropic;
        if (anisotropic) {
            const value: unknown = gl.getParameter(anisotropic.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
            if (typeof value === 'number') this.MAX_TEXTURE_MAX_ANISOTROPY = value;
        }
    }

    get(name: NumericCapabilityName): number {
        if (!this.gl) throw new Error('WebGL capabilities have not been initialized');
        return numericParameter(this.gl, name);
    }

    private getMaxSupportedPrecision(shaderType: GLenum): ShaderPrecision {
        if (!this.gl) throw new Error('WebGL capabilities have not been initialized');
        const precisionCandidates: readonly {
            name: Exclude<ShaderPrecision, 'lowp'>;
            type: GLenum;
        }[] = [
            { name: 'highp', type: this.gl.HIGH_FLOAT },
            { name: 'mediump', type: this.gl.MEDIUM_FLOAT }
        ];
        for (const candidate of precisionCandidates) {
            const format = this.gl.getShaderPrecisionFormat(shaderType, candidate.type);
            if (format && format.precision > 0) return candidate.name;
        }
        return 'lowp';
    }

    getMaxPrecision(a: ShaderPrecision, b: ShaderPrecision): ShaderPrecision {
        if (a === 'highp' || (a === 'mediump' && b === 'lowp')) return b;
        return a;
    }
}

export { WebGLCapabilities };
