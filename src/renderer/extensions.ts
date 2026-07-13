import {
    WebGL1VertexArrayObjectExtension,
    WebGL2VertexArrayObjectExtension,
    type VertexArrayObjectExtension
} from './extensions/VertexArrayObjectExtension';
import {
    WebGL1InstancedArraysExtension,
    WebGL2InstancedArraysExtension,
    type InstancedArraysExtension
} from './extensions/InstancedArraysExtension';
import {
    WebGL1DrawBuffersExtension,
    WebGL2DrawBuffersExtension,
    type DrawBuffersExtension
} from './extensions/drawBuffersExtension';
import { isWebGL2 } from '../utils/util';
import type { GLContext } from './types';

export type { DrawBuffersExtension, InstancedArraysExtension, VertexArrayObjectExtension };

interface NativeSupportMarker {
    readonly name: string;
}

type ExtensionObject = object;

function isAnisotropicExtension(
    value: ExtensionObject | null
): value is EXT_texture_filter_anisotropic {
    return (
        value !== null &&
        'MAX_TEXTURE_MAX_ANISOTROPY_EXT' in value &&
        typeof value.MAX_TEXTURE_MAX_ANISOTROPY_EXT === 'number'
    );
}

function isWebGL2Context(gl: GLContext): gl is WebGL2RenderingContext {
    return 'createVertexArray' in gl && 'drawBuffers' in gl;
}

const NATIVE_WEBGL2_EXTENSIONS: Readonly<Record<string, NativeSupportMarker>> = {
    OES_texture_float: { name: 'OES_texture_float' },
    EXT_frag_depth: { name: 'EXT_frag_depth' },
    OES_element_index_uint: { name: 'OES_element_index_uint' },
    EXT_shader_texture_lod: { name: 'EXT_shader_texture_lod' },
    EXT_sRGB: { name: 'EXT_sRGB' }
};

class WebGLExtensions {
    instanced: InstancedArraysExtension | null = null;
    vao: VertexArrayObjectExtension | null = null;
    drawBuffers: DrawBuffersExtension | null = null;
    texFloat: ExtensionObject | null = null;
    fragDepth: ExtensionObject | null = null;
    loseContext: ExtensionObject | null = null;
    textureFilterAnisotropic: EXT_texture_filter_anisotropic | null = null;
    sRGB: ExtensionObject | null = null;
    uintIndices: ExtensionObject | null = null;
    shaderTextureLod: ExtensionObject | null = null;
    colorBufferFloat: ExtensionObject | null = null;
    isWebGL2 = false;

    private gl: GLContext | null = null;
    private readonly usedExtensions = new Map<string, string>();
    private readonly disabledExtensions = new Set<string>();
    private readonly customExtensions = new Map<string, ExtensionObject | null>();

    init(gl: GLContext): void {
        this.reset(gl);
    }

    reset(gl: GLContext): void {
        this.gl = gl;
        this.isWebGL2 = isWebGL2(gl);
        for (const [name, alias] of this.usedExtensions) {
            this.loadAndAssign(name, alias);
        }
    }

    use(name: string, alias = name): void {
        this.usedExtensions.set(name, alias);
        if (this.gl) this.loadAndAssign(name, alias);
    }

    get(name: string, alias = name): ExtensionObject | null {
        if (this.disabledExtensions.has(name)) return null;
        const known = this.readAlias(alias);
        if (known !== undefined) return known;
        const cached = this.customExtensions.get(alias);
        if (cached !== undefined) return cached;
        return this.loadAndAssign(name, alias);
    }

    disable(name: string): void {
        this.disabledExtensions.add(name);
    }

    enable(name: string): void {
        this.disabledExtensions.delete(name);
    }

    private loadAndAssign(name: string, alias: string): ExtensionObject | null {
        if (this.disabledExtensions.has(name)) return null;
        const extension = this.load(name);
        this.assignAlias(alias, extension);
        return extension;
    }

    private load(name: string): ExtensionObject | null {
        const gl = this.gl;
        if (!gl) return null;

        if (isWebGL2Context(gl)) {
            const native = NATIVE_WEBGL2_EXTENSIONS[name];
            if (native) return native;
            switch (name) {
                case 'OES_vertex_array_object':
                    return new WebGL2VertexArrayObjectExtension(gl);
                case 'ANGLE_instanced_arrays':
                    return new WebGL2InstancedArraysExtension(gl);
                case 'WEBGL_draw_buffers':
                    return new WebGL2DrawBuffersExtension(gl);
            }
        } else {
            switch (name) {
                case 'OES_vertex_array_object': {
                    const extension = gl.getExtension('OES_vertex_array_object');
                    return extension ? new WebGL1VertexArrayObjectExtension(extension) : null;
                }
                case 'ANGLE_instanced_arrays': {
                    const extension = gl.getExtension('ANGLE_instanced_arrays');
                    return extension ? new WebGL1InstancedArraysExtension(extension) : null;
                }
                case 'WEBGL_draw_buffers': {
                    const extension = gl.getExtension('WEBGL_draw_buffers');
                    return extension ? new WebGL1DrawBuffersExtension(extension) : null;
                }
            }
        }

        const extension: unknown =
            gl.getExtension(name) ??
            gl.getExtension(`WEBKIT_${name}`) ??
            gl.getExtension(`MOZ_${name}`);
        return typeof extension === 'object' && extension !== null ? extension : null;
    }

    private readAlias(alias: string): ExtensionObject | null | undefined {
        switch (alias) {
            case 'instanced':
                return this.instanced;
            case 'vao':
                return this.vao;
            case 'drawBuffers':
                return this.drawBuffers;
            case 'texFloat':
                return this.texFloat;
            case 'fragDepth':
                return this.fragDepth;
            case 'loseContext':
                return this.loseContext;
            case 'textureFilterAnisotropic':
                return this.textureFilterAnisotropic;
            case 'sRGB':
                return this.sRGB;
            case 'uintIndices':
                return this.uintIndices;
            case 'shaderTextureLod':
                return this.shaderTextureLod;
            case 'colorBufferFloat':
                return this.colorBufferFloat;
            default:
                return this.customExtensions.get(alias);
        }
    }

    private assignAlias(alias: string, extension: ExtensionObject | null): void {
        switch (alias) {
            case 'instanced':
                this.instanced =
                    extension instanceof WebGL1InstancedArraysExtension ||
                    extension instanceof WebGL2InstancedArraysExtension
                        ? extension
                        : null;
                break;
            case 'vao':
                this.vao =
                    extension instanceof WebGL1VertexArrayObjectExtension ||
                    extension instanceof WebGL2VertexArrayObjectExtension
                        ? extension
                        : null;
                break;
            case 'drawBuffers':
                this.drawBuffers =
                    extension instanceof WebGL1DrawBuffersExtension ||
                    extension instanceof WebGL2DrawBuffersExtension
                        ? extension
                        : null;
                break;
            case 'texFloat':
                this.texFloat = extension;
                break;
            case 'fragDepth':
                this.fragDepth = extension;
                break;
            case 'loseContext':
                this.loseContext = extension;
                break;
            case 'textureFilterAnisotropic':
                this.textureFilterAnisotropic = isAnisotropicExtension(extension)
                    ? extension
                    : null;
                break;
            case 'sRGB':
                this.sRGB = extension;
                break;
            case 'uintIndices':
                this.uintIndices = extension;
                break;
            case 'shaderTextureLod':
                this.shaderTextureLod = extension;
                break;
            case 'colorBufferFloat':
                this.colorBufferFloat = extension;
                break;
            default:
                this.customExtensions.set(alias, extension);
        }
    }
}

const extensions = new WebGLExtensions();

extensions.use('ANGLE_instanced_arrays', 'instanced');
extensions.use('OES_vertex_array_object', 'vao');
extensions.use('OES_texture_float', 'texFloat');
extensions.use('OES_element_index_uint', 'uintIndices');
extensions.use('EXT_shader_texture_lod', 'shaderTextureLod');
extensions.use('EXT_frag_depth', 'fragDepth');
extensions.use('EXT_texture_filter_anisotropic', 'textureFilterAnisotropic');
extensions.use('WEBGL_lose_context', 'loseContext');
extensions.use('EXT_color_buffer_float', 'colorBufferFloat');
extensions.use('EXT_sRGB', 'sRGB');
extensions.use('WEBGL_draw_buffers', 'drawBuffers');

export { WebGLExtensions };
export default extensions;
