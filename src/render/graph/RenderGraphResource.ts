import type {
    RHIBuffer,
    RHIBufferDescriptor,
    RHIColor,
    RHILoadOp,
    RHIResourceLifetime,
    RHIStoreOp,
    RHITexture,
    RHITextureDescriptor,
    RHITextureViewDescriptor
} from '../rhi/core';

declare const rgTextureHandleBrand: unique symbol;
declare const rgTextureViewHandleBrand: unique symbol;
declare const rgBufferHandleBrand: unique symbol;
declare const rgPassHandleBrand: unique symbol;

/** Numeric texture identity scoped to one RenderGraphBuilder. */
export type RGTextureHandle = number & { readonly [rgTextureHandleBrand]: true };
/** Numeric texture-view identity scoped to one RenderGraphBuilder. */
export type RGTextureViewHandle = number & { readonly [rgTextureViewHandleBrand]: true };
/** Numeric buffer identity scoped to one RenderGraphBuilder. */
export type RGBufferHandle = number & { readonly [rgBufferHandleBrand]: true };
/** Numeric pass identity scoped to one RenderGraphBuilder. */
export type RGPassHandle = number & { readonly [rgPassHandleBrand]: true };
export type RGTextureAccessHandle = RGTextureHandle | RGTextureViewHandle;
export type RGResourceHandle = RGTextureAccessHandle | RGBufferHandle;

export type RGTextureDescriptor = Omit<RHITextureDescriptor, 'lifetime'>;
export type RGTextureViewDescriptor = RHITextureViewDescriptor;
export type RGBufferDescriptor = Omit<RHIBufferDescriptor, 'lifetime' | 'initialData'>;

/**
 * Acquires an externally-owned texture immediately before graph preparation. The provider is
 * never called while a graph is being built or compiled, and is skipped when the resource is
 * culled with the passes that reference it.
 */
export type RGImportedTextureProvider = () => RHITexture;

/** See {@link RGImportedTextureProvider}. */
export type RGImportedBufferProvider = () => RHIBuffer;

export type RGResourceKind = 'texture' | 'texture-view' | 'buffer';
export type RGResourceOrigin = 'imported' | 'transient';

/** Portable roles that consume initialized buffer contents. */
export type RGBufferReadUse = 'storage' | 'vertex' | 'index' | 'copy-source' | 'indirect';

/** Portable roles that completely replace buffer contents. */
export type RGBufferWriteUse = 'storage' | 'copy-destination';

/**
 * One setup-declared buffer access. Read-write is deliberately limited to storage bindings;
 * texture feedback and implicit buffer feedback remain invalid.
 */
export type RGBufferAccessDeclaration =
    | Readonly<{
          buffer: RGBufferHandle;
          mode: 'read';
          use: RGBufferReadUse;
      }>
    | Readonly<{
          buffer: RGBufferHandle;
          mode: 'write';
          use: RGBufferWriteUse;
      }>
    | Readonly<{
          buffer: RGBufferHandle;
          mode: 'read-write';
          use: 'storage';
      }>;

/** A color attachment is a render-pass read/write access, not sampled feedback. */
export interface RGColorAttachmentDeclaration {
    readonly texture: RGTextureAccessHandle;
    readonly resolveTarget?: RGTextureAccessHandle;
    readonly clearValue?: RHIColor;
    readonly loadOp: RHILoadOp;
    readonly storeOp: RHIStoreOp;
}

/** Depth/stencil access is tracked independently from ordinary sampled/copy reads and writes. */
export interface RGDepthStencilAttachmentDeclaration {
    readonly texture: RGTextureAccessHandle;
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
    /** Whether every selected subresource has contents before this graph invocation. */
    readonly initiallyInitialized: boolean;
    readonly extracted: boolean;
}

/** @internal Compiler snapshot for one view into a graph texture resource. */
export interface RGTextureViewResourceNode {
    readonly kind: 'texture-view';
    readonly handle: RGTextureViewHandle;
    readonly name: string;
    readonly texture: RGTextureHandle;
    readonly descriptor: RGTextureViewDescriptor;
    readonly extracted: false;
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
    /** Whether contents exist before the first graph writer in this invocation. */
    readonly initiallyInitialized: boolean;
    readonly extracted: boolean;
}

/** @internal */
export type RGResourceNode =
    RGTextureResourceNode | RGTextureViewResourceNode | RGBufferResourceNode;

export interface RGResourceLifetime {
    readonly firstUse: number;
    readonly lastUse: number;
}
