import Texture from '../../texture/Texture';
import type { ShaderSampledBindingResources } from './ShaderBindGroupResourceCache';
import type { ShaderSampledBindingPlan } from './ShaderBindingLayoutCompiler';
import type { RenderTargetResourceRecord } from './RenderTargetResourceCache';

export type ExternalTextureSamplerKind = ShaderSampledBindingPlan['samplerKind'];

/** Stable graph identity for a renderer-owned public render-target attachment. */
export type ExternalTextureGraphDependency =
    | Readonly<{
          record: Readonly<RenderTargetResourceRecord>;
          attachment: 'color';
          attachmentIndex: number;
      }>
    | Readonly<{
          record: Readonly<RenderTargetResourceRecord>;
          attachment: 'sampled-depth';
      }>;

/**
 * Dynamically resolves renderer-owned texture handles for one stable engine Texture identity.
 *
 * Returning `null` explicitly rejects the requested sampler kind. This is distinct from an
 * unregistered texture, for which ExternalTextureBindingRegistry.resolve returns `undefined`.
 */
export interface ExternalTextureBindingProvider {
    /**
     * Optional producer identity used only while declaring a RenderGraph pass. Providers should
     * keep this object stable for their lifetime; ordinary uploaded/external textures omit it.
     */
    readonly graphDependency?: ExternalTextureGraphDependency;
    resolve(
        samplerKind: ExternalTextureSamplerKind
    ): Readonly<ShaderSampledBindingResources> | null;
}

/**
 * Weak association between public engine Texture identities and renderer-owned RHI resources.
 * Providers are consulted on every resolve so render-target resize/recovery may replace logical
 * handles without replacing the engine Texture exposed to materials.
 */
export class ExternalTextureBindingRegistry {
    readonly #providers = new WeakMap<Texture<unknown>, ExternalTextureBindingProvider>();

    register(texture: Texture<unknown>, provider: ExternalTextureBindingProvider): () => void {
        if (!(texture instanceof Texture)) {
            throw new TypeError('External texture binding requires a real Texture identity');
        }
        if (typeof provider.resolve !== 'function') {
            throw new TypeError('External texture binding provider requires resolve()');
        }
        const current = this.#providers.get(texture);
        if (current !== undefined && current !== provider) {
            throw new Error('Texture already has another external binding provider');
        }
        this.#providers.set(texture, provider);
        let registered = true;
        return () => {
            if (!registered) return;
            registered = false;
            if (this.#providers.get(texture) === provider) this.#providers.delete(texture);
        };
    }

    resolve(
        texture: Texture<unknown>,
        samplerKind: ExternalTextureSamplerKind
    ): Readonly<ShaderSampledBindingResources> | null | undefined {
        return this.#providers.get(texture)?.resolve(samplerKind);
    }

    graphDependency(texture: Texture<unknown>): ExternalTextureGraphDependency | undefined {
        return this.#providers.get(texture)?.graphDependency;
    }
}

/** Process-wide weak registry shared by material draw processors and public render targets. */
export const externalTextureBindingRegistry = new ExternalTextureBindingRegistry();
