import type Texture from '../../texture/Texture';
import type { WebGLLegacySamplerDescriptor, WebGLRHIDevice } from '../../rhi/webgl/WebGLDevice';
import type { WebGLRHIState } from '../../rhi/webgl/WebGLInternal';
import requireGLResource from './requireGLResource';
import type WebGLState from './WebGLState';

const MAX_SAMPLERS = 256;

interface CachedSampler {
    readonly sampler: WebGLSampler;
}

interface TextureSamplerKeyMemo {
    readonly magFilter: GLenum;
    readonly minFilter: GLenum;
    readonly wrapS: GLenum;
    readonly wrapT: GLenum;
    readonly wrapR: GLenum;
    readonly anisotropy: number;
    readonly regularDescriptor: WebGLLegacySamplerDescriptor;
    readonly comparisonDescriptors: Map<GLenum, WebGLLegacySamplerDescriptor>;
}

const textureCompareFunctions = new WeakMap<Texture<unknown>, GLenum>();

/** Associate one sampled depth texture with its backend comparison function. @internal */
export function setWebGLTextureCompareFunction(
    texture: Texture<unknown>,
    compareFunction: GLenum
): void {
    textureCompareFunctions.set(texture, compareFunction);
}

/** Resolve the comparison function selected by a WebGL render-target contract. @internal */
export function getWebGLTextureCompareFunction(texture: Texture<unknown>): GLenum | undefined {
    return textureCompareFunctions.get(texture);
}

/** Bounded immutable WebGLSampler cache owned by one WebGLState/context. */
export class WebGLSamplerManager {
    private readonly state: WebGLState;
    private rhiState: WebGLRHIState | null = null;
    private rhiDevice: WebGLRHIDevice | null = null;
    private readonly cache = new Map<string, CachedSampler>();
    private readonly bindings = new Map<number, WebGLSampler | null>();
    private readonly textureKeys = new WeakMap<Texture<unknown>, TextureSamplerKeyMemo>();

    constructor(state: WebGLState) {
        this.state = state;
    }

    /** Attach the canonical state and device owners before the first renderer draw. @internal */
    attachRHI(rhiState: WebGLRHIState, rhiDevice: WebGLRHIDevice): void {
        if (this.cache.size !== 0 || this.bindings.size !== 0) {
            throw new Error('WebGL sampler RHI owner must be attached before sampler use');
        }
        this.rhiState = rhiState;
        this.rhiDevice = rhiDevice;
    }

    bind(
        texture: Texture<unknown>,
        textureUnit: number,
        comparison: boolean,
        compareFunction: GLenum = this.state.gl.LEQUAL
    ): WebGLSampler {
        const sampler = this.get(texture, comparison, compareFunction);
        if (this.rhiState) {
            this.rhiState.bindSampler(textureUnit, sampler);
        } else if (this.bindings.get(textureUnit) !== sampler) {
            this.state.gl.bindSampler(textureUnit, sampler);
            this.bindings.set(textureUnit, sampler);
        }
        this.trimCache();
        return sampler;
    }

    private get(
        texture: Texture<unknown>,
        comparison: boolean,
        compareFunction: GLenum
    ): WebGLSampler {
        const anisotropy = this.effectiveAnisotropy(texture);
        const descriptor = this.resolveDescriptor(texture, anisotropy, comparison, compareFunction);
        const rhiDevice = this.rhiDevice;
        if (rhiDevice) return rhiDevice.createLegacySampler(descriptor);
        const key = descriptor.cacheKey;
        const cached = this.cache.get(key);
        if (cached) {
            this.cache.delete(key);
            this.cache.set(key, cached);
            return cached.sampler;
        }

        const { gl } = this.state;
        const sampler = requireGLResource(gl.createSampler(), 'a sampler');
        try {
            gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, texture.magFilter);
            gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, texture.minFilter);
            gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, texture.wrapS);
            gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, texture.wrapT);
            gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_R, texture.wrapR);
            gl.samplerParameteri(
                sampler,
                gl.TEXTURE_COMPARE_MODE,
                comparison ? gl.COMPARE_REF_TO_TEXTURE : gl.NONE
            );
            gl.samplerParameteri(sampler, gl.TEXTURE_COMPARE_FUNC, compareFunction);
            const anisotropyExtension = this.state.extensions.textureFilterAnisotropic;
            if (anisotropyExtension) {
                gl.samplerParameterf(
                    sampler,
                    anisotropyExtension.TEXTURE_MAX_ANISOTROPY_EXT,
                    this.effectiveAnisotropy(texture)
                );
            }
        } catch (error: unknown) {
            gl.deleteSampler(sampler);
            throw error;
        }
        this.cache.set(key, { sampler });
        return sampler;
    }

    private trimCache(): void {
        if (this.rhiDevice) return;
        if (this.cache.size <= MAX_SAMPLERS) return;
        const boundSamplers = new Set(this.bindings.values());
        for (const [key, cached] of this.cache) {
            if (this.cache.size <= MAX_SAMPLERS) break;
            if (boundSamplers.has(cached.sampler)) continue;
            this.cache.delete(key);
            this.state.gl.deleteSampler(cached.sampler);
        }
    }

    private effectiveAnisotropy(texture: Texture<unknown>): number {
        if (!this.state.extensions.textureFilterAnisotropic) return 1;
        return Math.min(
            Math.max(texture.anisotropic, 1),
            this.state.capabilities.MAX_TEXTURE_MAX_ANISOTROPY
        );
    }

    private resolveDescriptor(
        texture: Texture<unknown>,
        anisotropy: number,
        comparison: boolean,
        compareFunction: GLenum
    ): WebGLLegacySamplerDescriptor {
        let memo = this.textureKeys.get(texture);
        if (
            memo?.magFilter !== texture.magFilter ||
            memo.minFilter !== texture.minFilter ||
            memo.wrapS !== texture.wrapS ||
            memo.wrapT !== texture.wrapT ||
            memo.wrapR !== texture.wrapR ||
            memo.anisotropy !== anisotropy
        ) {
            const base = `legacy:${String(texture.magFilter)}:${String(texture.minFilter)}:${String(texture.wrapS)}:${String(texture.wrapT)}:${String(texture.wrapR)}:${String(anisotropy)}`;
            const anisotropyExtension = this.state.extensions.textureFilterAnisotropic;
            const common = {
                magFilter: texture.magFilter,
                minFilter: texture.minFilter,
                wrapS: texture.wrapS,
                wrapT: texture.wrapT,
                wrapR: texture.wrapR,
                anisotropy,
                ...(anisotropyExtension
                    ? {
                          anisotropyParameter: anisotropyExtension.TEXTURE_MAX_ANISOTROPY_EXT
                      }
                    : {})
            } as const;
            memo = {
                magFilter: texture.magFilter,
                minFilter: texture.minFilter,
                wrapS: texture.wrapS,
                wrapT: texture.wrapT,
                wrapR: texture.wrapR,
                anisotropy,
                regularDescriptor: {
                    ...common,
                    cacheKey: `${base}:0`,
                    comparison: false,
                    compareFunction
                },
                comparisonDescriptors: new Map<GLenum, WebGLLegacySamplerDescriptor>()
            };
            this.textureKeys.set(texture, memo);
        }
        if (!comparison) return memo.regularDescriptor;
        let descriptor = memo.comparisonDescriptors.get(compareFunction);
        if (!descriptor) {
            descriptor = {
                ...memo.regularDescriptor,
                cacheKey: `${memo.regularDescriptor.cacheKey}:1:${String(compareFunction)}`,
                comparison: true,
                compareFunction
            };
            memo.comparisonDescriptors.set(compareFunction, descriptor);
        }
        return descriptor;
    }

    destroy(): void {
        if (!this.rhiDevice) {
            for (const { sampler } of this.cache.values()) this.state.gl.deleteSampler(sampler);
        }
        this.cache.clear();
        this.bindings.clear();
    }

    resetBindings(): void {
        this.bindings.clear();
    }
}
