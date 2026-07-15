import {
    CLAMP_TO_EDGE,
    DEPTH_COMPONENT,
    DEPTH_COMPONENT16,
    DEPTH_STENCIL,
    FLOAT,
    LINEAR,
    NEAREST,
    RGBA,
    UNSIGNED_BYTE,
    UNSIGNED_INT,
    UNSIGNED_SHORT
} from '../../constants/webgl';
import {
    DEPTH24_STENCIL8,
    DEPTH32F_STENCIL8,
    DEPTH_COMPONENT24,
    DEPTH_COMPONENT32F,
    FLOAT_32_UNSIGNED_INT_24_8_REV,
    HALF_FLOAT,
    RGBA8,
    RGBA16F,
    RGBA32F,
    SRGB8_ALPHA8,
    UNSIGNED_INT_24_8
} from '../../constants/webgl2';
import Texture, {
    observeTextureDestroy,
    rebaseTextureExternalAllocation,
    unobserveTextureDestroy,
    type TextureDestroyObserver,
    type TextureParameters
} from '../../texture/Texture';
import type { RendererBackend } from '../RendererCore';
import {
    normalizeRenderTargetParameters,
    type NormalizedRenderTargetParameters,
    type RenderTarget,
    type RenderTargetColorAttachmentReadback,
    type RenderTargetColorFormat,
    type RenderTargetCompareFunction,
    type RenderTargetDepthStencilFormat,
    type RenderTargetParameters,
    type RenderTargetReadColorAttachmentOptions,
    type RenderTargetSampleCount
} from '../RenderTarget';
import {
    selectRenderTargetMultisampleAttachmentLifetime,
    type RenderTargetResourceCache,
    type RenderTargetResourceRecord
} from './RenderTargetResourceCache';

export interface RHIRenderTargetHost {
    readonly backend: RendererBackend;
    readonly renderTargetResources: RenderTargetResourceCache;
    assertRenderTargetMutationAllowed(operation: string): void;
    registerRenderTargetColorTexture(
        target: RHIRenderTarget,
        attachmentIndex: number,
        texture: Texture<unknown>
    ): () => void;
    registerRenderTargetDepthTexture(
        target: RHIRenderTarget,
        texture: Texture<unknown>,
        compare: RenderTargetCompareFunction
    ): () => void;
    readRenderTargetColorAttachment(
        target: RHIRenderTarget,
        options?: RenderTargetReadColorAttachmentOptions
    ): Promise<RenderTargetColorAttachmentReadback>;
    renderTargetResized(target: RHIRenderTarget): void;
    renderTargetDestroyed(target: RHIRenderTarget): void;
}

interface EngineTextureDeclaration {
    readonly internalFormat: number;
    readonly format: number;
    readonly type: number;
    readonly minFilter: number;
    readonly magFilter: number;
}

function colorTextureDeclaration(format: RenderTargetColorFormat): EngineTextureDeclaration {
    switch (format) {
        case 'rgba8unorm':
            return {
                internalFormat: RGBA8,
                format: RGBA,
                type: UNSIGNED_BYTE,
                minFilter: LINEAR,
                magFilter: LINEAR
            };
        case 'rgba8unorm-srgb':
            return {
                internalFormat: SRGB8_ALPHA8,
                format: RGBA,
                type: UNSIGNED_BYTE,
                minFilter: LINEAR,
                magFilter: LINEAR
            };
        case 'rgba16float':
            return {
                internalFormat: RGBA16F,
                format: RGBA,
                type: HALF_FLOAT,
                minFilter: LINEAR,
                magFilter: LINEAR
            };
        case 'rgba32float':
            return {
                internalFormat: RGBA32F,
                format: RGBA,
                type: FLOAT,
                minFilter: NEAREST,
                magFilter: NEAREST
            };
    }
}

function depthTextureDeclaration(format: RenderTargetDepthStencilFormat): EngineTextureDeclaration {
    switch (format) {
        case 'depth16unorm':
            return {
                internalFormat: DEPTH_COMPONENT16,
                format: DEPTH_COMPONENT,
                type: UNSIGNED_SHORT,
                minFilter: NEAREST,
                magFilter: NEAREST
            };
        case 'depth24plus':
            return {
                internalFormat: DEPTH_COMPONENT24,
                format: DEPTH_COMPONENT,
                type: UNSIGNED_INT,
                minFilter: NEAREST,
                magFilter: NEAREST
            };
        case 'depth24plus-stencil8':
            return {
                internalFormat: DEPTH24_STENCIL8,
                format: DEPTH_STENCIL,
                type: UNSIGNED_INT_24_8,
                minFilter: NEAREST,
                magFilter: NEAREST
            };
        case 'depth32float':
            return {
                internalFormat: DEPTH_COMPONENT32F,
                format: DEPTH_COMPONENT,
                type: FLOAT,
                minFilter: NEAREST,
                magFilter: NEAREST
            };
        case 'depth32float-stencil8':
            return {
                internalFormat: DEPTH32F_STENCIL8,
                format: DEPTH_STENCIL,
                type: FLOAT_32_UNSIGNED_INT_24_8_REV,
                minFilter: NEAREST,
                magFilter: NEAREST
            };
    }
}

function attachmentTexture(
    width: number,
    height: number,
    name: string,
    declaration: Readonly<EngineTextureDeclaration>
): Texture<unknown> {
    const parameters: TextureParameters<unknown> = {
        image: null,
        width,
        height,
        internalFormat: declaration.internalFormat,
        format: declaration.format,
        type: declaration.type,
        minFilter: declaration.minFilter,
        magFilter: declaration.magFilter,
        wrapS: CLAMP_TO_EDGE,
        wrapT: CLAMP_TO_EDGE,
        name,
        flipY: false,
        premultiplyAlpha: false,
        needUpdate: false,
        needDestroy: false,
        autoUpdate: false,
        isImageCanRelease: false
    };
    return new Texture(parameters);
}

function targetDescriptor(parameters: Readonly<NormalizedRenderTargetParameters>) {
    const descriptor = {
        label: parameters.label,
        width: parameters.width,
        height: parameters.height,
        colorFormats: Object.freeze(
            parameters.colorAttachments.map(attachment => attachment.format)
        ),
        sampleCount: parameters.sampleCount,
        depthStencilFormat: parameters.depthStencilAttachment?.format ?? null,
        depthStencilSampled: parameters.depthStencilAttachment?.sampled ?? false
    } as const;
    const depth = parameters.depthStencilAttachment;
    return Object.freeze({
        ...descriptor,
        multisampleAttachmentLifetime: selectRenderTargetMultisampleAttachmentLifetime(descriptor, {
            colorOperations: parameters.colorAttachments,
            ...(depth === null
                ? {}
                : {
                      depthLoadOp: depth.depthLoadOp,
                      depthStoreOp: depth.depthStoreOp,
                      stencilLoadOp: depth.stencilLoadOp,
                      stencilStoreOp: depth.stencilStoreOp
                  })
        })
    });
}

/** Public render-target identity backed only by shared RHI resources. */
export class RHIRenderTarget implements RenderTarget {
    readonly backend: RendererBackend;
    readonly label: string;
    readonly sampleCount: RenderTargetSampleCount;
    readonly colorFormats: readonly RenderTargetColorFormat[];
    readonly depthStencilFormat: RenderTargetDepthStencilFormat | null;

    readonly #host: RHIRenderTargetHost;
    #parameters: Readonly<NormalizedRenderTargetParameters>;
    readonly #colorTextures: readonly Texture<unknown>[];
    readonly #depthTexture: Texture<unknown> | null;
    readonly #unregisterBindings: (() => void)[] = [];
    readonly #textureDestroyObservers = new Map<Texture<unknown>, TextureDestroyObserver>();
    #record: Readonly<RenderTargetResourceRecord>;
    #destroyed = false;

    constructor(host: RHIRenderTargetHost, parameters: RenderTargetParameters) {
        const normalized = normalizeRenderTargetParameters(parameters);
        this.#host = host;
        this.backend = host.backend;
        this.#parameters = normalized;
        this.label = normalized.label;
        this.sampleCount = normalized.sampleCount;
        this.colorFormats = Object.freeze(
            normalized.colorAttachments.map(attachment => attachment.format)
        );
        this.depthStencilFormat = normalized.depthStencilAttachment?.format ?? null;
        this.#record = host.renderTargetResources.prepare(this, targetDescriptor(normalized));

        const colorTextures: Texture<unknown>[] = [];
        let depthTexture: Texture<unknown> | null = null;
        try {
            for (let index = 0; index < normalized.colorAttachments.length; index += 1) {
                const attachment = normalized.colorAttachments[index];
                if (attachment === undefined) {
                    throw new Error('Normalized render-target color attachment is missing');
                }
                const texture = attachmentTexture(
                    normalized.width,
                    normalized.height,
                    attachment.label,
                    colorTextureDeclaration(attachment.format)
                );
                colorTextures.push(texture);
                this.#observeAttachmentTexture(texture);
                this.#unregisterBindings.push(
                    host.registerRenderTargetColorTexture(this, index, texture)
                );
            }
            const depth = normalized.depthStencilAttachment;
            if (depth?.sampled) {
                depthTexture = attachmentTexture(
                    normalized.width,
                    normalized.height,
                    depth.label,
                    depthTextureDeclaration(depth.format)
                );
                this.#observeAttachmentTexture(depthTexture);
                this.#unregisterBindings.push(
                    host.registerRenderTargetDepthTexture(this, depthTexture, depth.compare)
                );
            }
        } catch (error) {
            for (let index = this.#unregisterBindings.length - 1; index >= 0; index -= 1) {
                this.#unregisterBindings[index]?.();
            }
            for (const [texture, observer] of this.#textureDestroyObservers) {
                unobserveTextureDestroy(texture, observer);
            }
            host.renderTargetResources.release(this);
            throw error;
        }
        this.#colorTextures = Object.freeze(colorTextures);
        this.#depthTexture = depthTexture;
    }

    get width(): number {
        return this.#parameters.width;
    }

    get height(): number {
        return this.#parameters.height;
    }

    get colorAttachmentCount(): number {
        return this.#colorTextures.length;
    }

    get isDestroyed(): boolean {
        return this.#destroyed;
    }

    /** Internal immutable operations consumed by the shared offscreen renderer. */
    get normalizedParameters(): Readonly<NormalizedRenderTargetParameters> {
        this.#assertAlive();
        return this.#parameters;
    }

    /** Internal logical handles; concrete resources still resolve through ResourceRegistry. */
    get resourceRecord(): Readonly<RenderTargetResourceRecord> {
        this.#assertAlive();
        return this.#record;
    }

    belongsTo(host: RHIRenderTargetHost): boolean {
        return this.#host === host;
    }

    getColorTexture(index = 0): Texture<unknown> {
        this.#assertAlive();
        if (!Number.isSafeInteger(index) || index < 0) {
            throw new RangeError('Color attachment index must be a non-negative safe integer');
        }
        const texture = this.#colorTextures[index];
        if (texture === undefined) {
            throw new RangeError(`Color attachment ${String(index)} does not exist`);
        }
        return texture;
    }

    getDepthTexture(): Texture<unknown> | null {
        this.#assertAlive();
        return this.#depthTexture;
    }

    readColorAttachment(
        options?: RenderTargetReadColorAttachmentOptions
    ): Promise<RenderTargetColorAttachmentReadback> {
        this.#assertAlive();
        return this.#host.readRenderTargetColorAttachment(this, options);
    }

    resize(width: number, height: number): void {
        this.#assertAlive();
        this.#host.assertRenderTargetMutationAllowed('resize');
        if (!Number.isSafeInteger(width) || width <= 0) {
            throw new RangeError('Render-target width must be a positive safe integer');
        }
        if (!Number.isSafeInteger(height) || height <= 0) {
            throw new RangeError('Render-target height must be a positive safe integer');
        }
        if (width === this.width && height === this.height) return;
        this.#record = this.#host.renderTargetResources.resize(this, width, height);
        this.#parameters = Object.freeze({ ...this.#parameters, width, height });
        for (const texture of this.#colorTextures) {
            texture.width = width;
            texture.height = height;
            rebaseTextureExternalAllocation(texture);
        }
        if (this.#depthTexture !== null) {
            this.#depthTexture.width = width;
            this.#depthTexture.height = height;
            rebaseTextureExternalAllocation(this.#depthTexture);
        }
        // Notify backend-local revision trackers only after the stable public Texture identities
        // expose the new dimensions and their obsolete partial CPU checkpoints are gone.
        this.#host.renderTargetResized(this);
    }

    destroy(): void {
        this.#destroyInternal(null);
    }

    #observeAttachmentTexture(texture: Texture<unknown>): void {
        const observer = (): void => {
            this.#destroyInternal(texture);
        };
        this.#textureDestroyObservers.set(texture, observer);
        observeTextureDestroy(texture, observer);
    }

    #destroyInternal(originatingTexture: Texture<unknown> | null): void {
        if (this.#destroyed) return;
        this.#host.assertRenderTargetMutationAllowed(
            originatingTexture === null ? 'destroy' : 'attachment recovery'
        );
        this.#destroyed = true;
        const errors: unknown[] = [];
        for (const [texture, observer] of this.#textureDestroyObservers) {
            unobserveTextureDestroy(texture, observer);
        }
        for (let index = this.#unregisterBindings.length - 1; index >= 0; index -= 1) {
            try {
                this.#unregisterBindings[index]?.();
            } catch (error) {
                errors.push(error);
            }
        }
        try {
            this.#host.renderTargetResources.release(this);
        } catch (error) {
            errors.push(error);
        }
        try {
            this.#host.renderTargetDestroyed(this);
        } catch (error) {
            errors.push(error);
        }
        for (const texture of this.#colorTextures) {
            // An attachment identity must never fall back to TextureResourceCache as a blank CPU
            // texture after its renderer-owned provider has been detached.
            texture.width = 0;
            texture.height = 0;
            if (texture === originatingTexture) continue;
            try {
                texture.destroy();
            } catch (error) {
                errors.push(error);
            }
        }
        if (this.#depthTexture !== null && this.#depthTexture !== originatingTexture) {
            this.#depthTexture.width = 0;
            this.#depthTexture.height = 0;
            try {
                this.#depthTexture.destroy();
            } catch (error) {
                errors.push(error);
            }
        } else if (this.#depthTexture !== null) {
            this.#depthTexture.width = 0;
            this.#depthTexture.height = 0;
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) {
            throw new AggregateError(errors, `Render target ${this.label} destruction failed`);
        }
    }

    #assertAlive(): void {
        if (this.#destroyed) throw new Error(`Render target ${this.label} is destroyed`);
    }
}
