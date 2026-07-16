import extensions from './extensions';
import { isWebGL2 } from '../utils/util';
import type { GLContext, ShaderPrecision } from './types';

export type NumericCapabilityName =
    | 'MAX_RENDERBUFFER_SIZE'
    | 'MAX_COMBINED_TEXTURE_IMAGE_UNITS'
    | 'MAX_CUBE_MAP_TEXTURE_SIZE'
    | 'MAX_FRAGMENT_UNIFORM_VECTORS'
    | 'MAX_TEXTURE_IMAGE_UNITS'
    | 'MAX_TEXTURE_SIZE'
    | 'MAX_VARYING_VECTORS'
    | 'MAX_VERTEX_ATTRIBS'
    | 'MAX_VERTEX_TEXTURE_IMAGE_UNITS'
    | 'MAX_VERTEX_UNIFORM_VECTORS';

function capabilityEnum(gl: GLContext, name: NumericCapabilityName): GLenum {
    switch (name) {
        case 'MAX_RENDERBUFFER_SIZE':
            return gl.MAX_RENDERBUFFER_SIZE;
        case 'MAX_COMBINED_TEXTURE_IMAGE_UNITS':
            return gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS;
        case 'MAX_CUBE_MAP_TEXTURE_SIZE':
            return gl.MAX_CUBE_MAP_TEXTURE_SIZE;
        case 'MAX_FRAGMENT_UNIFORM_VECTORS':
            return gl.MAX_FRAGMENT_UNIFORM_VECTORS;
        case 'MAX_TEXTURE_IMAGE_UNITS':
            return gl.MAX_TEXTURE_IMAGE_UNITS;
        case 'MAX_TEXTURE_SIZE':
            return gl.MAX_TEXTURE_SIZE;
        case 'MAX_VARYING_VECTORS':
            return gl.MAX_VARYING_VECTORS;
        case 'MAX_VERTEX_ATTRIBS':
            return gl.MAX_VERTEX_ATTRIBS;
        case 'MAX_VERTEX_TEXTURE_IMAGE_UNITS':
            return gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS;
        case 'MAX_VERTEX_UNIFORM_VECTORS':
            return gl.MAX_VERTEX_UNIFORM_VECTORS;
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
    isWebGL2 = false;
    MAX_TEXTURE_INDEX = 0;
    MAX_PRECISION: ShaderPrecision = 'lowp';
    MAX_VERTEX_PRECISION: ShaderPrecision = 'lowp';
    MAX_FRAGMENT_PRECISION: ShaderPrecision = 'lowp';
    VERTEX_TEXTURE_FLOAT = false;
    FRAGMENT_TEXTURE_FLOAT = false;
    MAX_TEXTURE_MAX_ANISOTROPY = 1;
    MAX_RENDERBUFFER_SIZE = 0;
    MAX_COMBINED_TEXTURE_IMAGE_UNITS = 0;
    MAX_CUBE_MAP_TEXTURE_SIZE = 0;
    MAX_FRAGMENT_UNIFORM_VECTORS = 0;
    MAX_TEXTURE_IMAGE_UNITS = 0;
    MAX_TEXTURE_SIZE = 0;
    MAX_VARYING_VECTORS = 0;
    MAX_VERTEX_ATTRIBS = 0;
    MAX_VERTEX_TEXTURE_IMAGE_UNITS = 0;
    MAX_VERTEX_UNIFORM_VECTORS = 0;
    FRAG_DEPTH = false;
    SHADER_TEXTURE_LOD = false;
    DRAW_BUFFERS = false;
    private gl: GLContext | null = null;

    init(gl: GLContext): void {
        this.gl = gl;
        this.isWebGL2 = isWebGL2(gl);

        this.MAX_RENDERBUFFER_SIZE = this.get('MAX_RENDERBUFFER_SIZE');
        this.MAX_COMBINED_TEXTURE_IMAGE_UNITS = this.get('MAX_COMBINED_TEXTURE_IMAGE_UNITS');
        this.MAX_CUBE_MAP_TEXTURE_SIZE = this.get('MAX_CUBE_MAP_TEXTURE_SIZE');
        this.MAX_FRAGMENT_UNIFORM_VECTORS = this.get('MAX_FRAGMENT_UNIFORM_VECTORS');
        this.MAX_TEXTURE_IMAGE_UNITS = this.get('MAX_TEXTURE_IMAGE_UNITS');
        this.MAX_TEXTURE_SIZE = this.get('MAX_TEXTURE_SIZE');
        this.MAX_VARYING_VECTORS = this.get('MAX_VARYING_VECTORS');
        this.MAX_VERTEX_ATTRIBS = this.get('MAX_VERTEX_ATTRIBS');
        this.MAX_VERTEX_TEXTURE_IMAGE_UNITS = this.get('MAX_VERTEX_TEXTURE_IMAGE_UNITS');
        this.MAX_VERTEX_UNIFORM_VECTORS = this.get('MAX_VERTEX_UNIFORM_VECTORS');

        this.MAX_TEXTURE_INDEX = this.MAX_COMBINED_TEXTURE_IMAGE_UNITS - 1;
        this.MAX_VERTEX_PRECISION = this.getMaxSupportedPrecision(gl.VERTEX_SHADER);
        this.MAX_FRAGMENT_PRECISION = this.getMaxSupportedPrecision(gl.FRAGMENT_SHADER);
        this.MAX_PRECISION = this.getMaxPrecision(
            this.MAX_FRAGMENT_PRECISION,
            this.MAX_VERTEX_PRECISION
        );
        this.VERTEX_TEXTURE_FLOAT =
            Boolean(extensions.texFloat) && this.MAX_VERTEX_TEXTURE_IMAGE_UNITS > 0;
        this.FRAGMENT_TEXTURE_FLOAT = Boolean(extensions.texFloat);
        this.FRAG_DEPTH = Boolean(extensions.fragDepth);
        this.SHADER_TEXTURE_LOD = Boolean(extensions.shaderTextureLod);
        this.DRAW_BUFFERS = Boolean(extensions.drawBuffers);

        const anisotropic = extensions.textureFilterAnisotropic;
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

const capabilities = new WebGLCapabilities();

export { WebGLCapabilities };
export default capabilities;
