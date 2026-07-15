import type {
    RHIBuffer,
    RHIBufferDescriptor,
    RHIColor,
    RHILoadOp,
    RHIResourceLifetime,
    RHIStoreOp,
    RHITexture,
    RHITextureDescriptor
} from '../rhi/core';

declare const rgTextureHandleBrand: unique symbol;
declare const rgBufferHandleBrand: unique symbol;
declare const rgPassHandleBrand: unique symbol;

/** Numeric texture identity scoped to one RenderGraphBuilder. */
export type RGTextureHandle = number & { readonly [rgTextureHandleBrand]: true };
/** Numeric buffer identity scoped to one RenderGraphBuilder. */
export type RGBufferHandle = number & { readonly [rgBufferHandleBrand]: true };
/** Numeric pass identity scoped to one RenderGraphBuilder. */
export type RGPassHandle = number & { readonly [rgPassHandleBrand]: true };
export type RGResourceHandle = RGTextureHandle | RGBufferHandle;

export type RGTextureDescriptor = Omit<RHITextureDescriptor, 'lifetime'>;
export type RGBufferDescriptor = Omit<RHIBufferDescriptor, 'lifetime' | 'initialData'>;

/**
 * Acquires an externally-owned texture immediately before graph preparation. The provider is
 * never called while a graph is being built or compiled, and is skipped when the resource is
 * culled with the passes that reference it.
 */
export type RGImportedTextureProvider = () => RHITexture;

/** See {@link RGImportedTextureProvider}. */
export type RGImportedBufferProvider = () => RHIBuffer;

export type RGResourceKind = 'texture' | 'buffer';
export type RGResourceOrigin = 'imported' | 'transient';

/** A color attachment is a render-pass read/write access, not sampled feedback. */
export interface RGColorAttachmentDeclaration {
    readonly texture: RGTextureHandle;
    readonly resolveTarget?: RGTextureHandle;
    readonly clearValue?: RHIColor;
    readonly loadOp: RHILoadOp;
    readonly storeOp: RHIStoreOp;
}

/** Depth/stencil access is tracked independently from ordinary sampled/copy reads and writes. */
export interface RGDepthStencilAttachmentDeclaration {
    readonly texture: RGTextureHandle;
    readonly depthClearValue?: number;
    readonly depthLoadOp?: RHILoadOp;
    readonly depthStoreOp?: RHIStoreOp;
    readonly depthReadOnly?: boolean;
    readonly stencilClearValue?: number;
    readonly stencilLoadOp?: RHILoadOp;
    readonly stencilStoreOp?: RHIStoreOp;
    readonly stencilReadOnly?: boolean;
}

/** @internal Compiler snapshot; renderer features should use numeric handles instead. */
export interface RGTextureResourceNode {
    readonly kind: 'texture';
    readonly handle: RGTextureHandle;
    readonly name: string;
    readonly origin: RGResourceOrigin;
    readonly descriptor: RGTextureDescriptor;
    readonly imported: RHITexture | null;
    readonly provider: RGImportedTextureProvider | null;
    readonly resourceLifetime: RHIResourceLifetime;
    /** @internal Pure graph reads prefer this graph's complete writer chain when one exists. */
    readonly readFromLastGraphWriter: boolean;
    readonly extracted: boolean;
}

/** @internal Compiler snapshot; renderer features should use numeric handles instead. */
export interface RGBufferResourceNode {
    readonly kind: 'buffer';
    readonly handle: RGBufferHandle;
    readonly name: string;
    readonly origin: RGResourceOrigin;
    readonly descriptor: RGBufferDescriptor;
    readonly imported: RHIBuffer | null;
    readonly provider: RGImportedBufferProvider | null;
    readonly resourceLifetime: RHIResourceLifetime;
    readonly extracted: boolean;
}

/** @internal */
export type RGResourceNode = RGTextureResourceNode | RGBufferResourceNode;

export interface RGResourceLifetime {
    readonly firstUse: number;
    readonly lastUse: number;
}
