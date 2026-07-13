import type { GLContext } from './types';

type ExtensionObject = object;

function isAnisotropicExtension(
    value: ExtensionObject | null
): value is EXT_texture_filter_anisotropic {
    return (
        value !== null &&
        'MAX_TEXTURE_MAX_ANISOTROPY_EXT' in value &&
        typeof value.MAX_TEXTURE_MAX_ANISOTROPY_EXT === 'number' &&
        'TEXTURE_MAX_ANISOTROPY_EXT' in value &&
        typeof value.TEXTURE_MAX_ANISOTROPY_EXT === 'number'
    );
}

/** Optional WebGL 2 extensions. Core WebGL 2 features are accessed directly on the context. */
class WebGLExtensions {
    loseContext: ExtensionObject | null = null;
    textureFilterAnisotropic: EXT_texture_filter_anisotropic | null = null;
    colorBufferFloat: ExtensionObject | null = null;

    private gl: GLContext | null = null;
    private readonly usedExtensions = new Map<string, string>();
    private readonly disabledExtensions = new Set<string>();
    private readonly loadedExtensions = new Map<string, ExtensionObject | null>();

    constructor() {
        const extensions: readonly (readonly [string, string?])[] = [
            ['EXT_texture_filter_anisotropic', 'textureFilterAnisotropic'],
            ['WEBGL_lose_context', 'loseContext'],
            ['EXT_color_buffer_float', 'colorBufferFloat'],
            ['WEBGL_compressed_texture_astc'],
            ['WEBGL_compressed_texture_atc'],
            ['WEBGL_compressed_texture_etc'],
            ['WEBGL_compressed_texture_etc1'],
            ['WEBGL_compressed_texture_pvrtc'],
            ['WEBGL_compressed_texture_s3tc'],
            ['WEBGL_compressed_texture_s3tc_srgb']
        ];
        for (const [name, alias] of extensions) this.use(name, alias);
    }

    init(gl: GLContext): void {
        this.reset(gl);
    }

    reset(gl: GLContext): void {
        this.gl = gl;
        this.loadedExtensions.clear();
        for (const [name, alias] of this.usedExtensions) this.loadAndAssign(name, alias);
    }

    use(name: string, alias = name): void {
        this.usedExtensions.set(name, alias);
        if (this.gl) this.loadAndAssign(name, alias);
    }

    get(name: string, alias = name): ExtensionObject | null {
        if (this.disabledExtensions.has(name)) return null;
        if (this.loadedExtensions.has(alias)) return this.loadedExtensions.get(alias) ?? null;
        return this.loadAndAssign(name, alias);
    }

    disable(name: string): void {
        this.disabledExtensions.add(name);
        const alias = this.usedExtensions.get(name) ?? name;
        this.loadedExtensions.set(alias, null);
        this.assignAlias(alias, null);
    }

    enable(name: string): void {
        this.disabledExtensions.delete(name);
        const alias = this.usedExtensions.get(name) ?? name;
        if (this.gl) this.loadAndAssign(name, alias);
    }

    private loadAndAssign(name: string, alias: string): ExtensionObject | null {
        if (this.disabledExtensions.has(name)) {
            this.loadedExtensions.set(alias, null);
            this.assignAlias(alias, null);
            return null;
        }
        const extension = this.load(name);
        this.loadedExtensions.set(alias, extension);
        this.assignAlias(alias, extension);
        return extension;
    }

    private load(name: string): ExtensionObject | null {
        const extension: unknown = this.gl?.getExtension(name);
        return typeof extension === 'object' && extension !== null ? extension : null;
    }

    private assignAlias(alias: string, extension: ExtensionObject | null): void {
        switch (alias) {
            case 'loseContext':
                this.loseContext = extension;
                break;
            case 'textureFilterAnisotropic':
                this.textureFilterAnisotropic = isAnisotropicExtension(extension)
                    ? extension
                    : null;
                break;
            case 'colorBufferFloat':
                this.colorBufferFloat = extension;
                break;
        }
    }
}

export { WebGLExtensions };
