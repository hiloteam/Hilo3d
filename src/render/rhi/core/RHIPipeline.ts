import type {
    RHIBuffer,
    RHICompareFunction,
    RHIResource,
    RHIResourceDescriptorBase,
    RHISampler,
    RHIShader,
    RHITextureView
} from './RHIResources';
import type {
    RHIColorWriteFlags,
    RHIIndexFormat,
    RHIShaderStageFlags,
    RHITextureFormat,
    RHITextureViewDimension
} from './RHITypes';

export type RHIBufferBindingType = 'uniform' | 'storage' | 'read-only-storage';
export type RHISamplerBindingType = 'filtering' | 'non-filtering' | 'comparison';
export type RHITextureSampleType = 'float' | 'unfilterable-float' | 'depth' | 'sint' | 'uint';
export type RHIStorageTextureAccess = 'write-only' | 'read-only' | 'read-write';

export interface RHIBindGroupLayoutBufferBinding {
    readonly type?: RHIBufferBindingType;
    readonly hasDynamicOffset?: boolean;
    readonly minBindingSize?: number;
}

export interface RHIBindGroupLayoutSamplerBinding {
    readonly type?: RHISamplerBindingType;
}

export interface RHIBindGroupLayoutTextureBinding {
    readonly sampleType?: RHITextureSampleType;
    readonly viewDimension?: RHITextureViewDimension;
    readonly multisampled?: boolean;
}

export interface RHIBindGroupLayoutStorageTextureBinding {
    readonly access: RHIStorageTextureAccess;
    readonly format: RHITextureFormat;
    readonly viewDimension?: RHITextureViewDimension;
}

/** Exactly one resource-layout field must be present; validation enforces this at creation. */
export interface RHIBindGroupLayoutEntry {
    readonly binding: number;
    readonly visibility: RHIShaderStageFlags;
    readonly buffer?: RHIBindGroupLayoutBufferBinding;
    readonly sampler?: RHIBindGroupLayoutSamplerBinding;
    readonly texture?: RHIBindGroupLayoutTextureBinding;
    readonly storageTexture?: RHIBindGroupLayoutStorageTextureBinding;
}

export interface RHIBindGroupLayoutDescriptor extends RHIResourceDescriptorBase {
    readonly entries: readonly RHIBindGroupLayoutEntry[];
}

export interface RHIBindGroupLayout extends RHIResource {
    readonly descriptor: Readonly<RHIBindGroupLayoutDescriptor>;
    readonly entries: readonly RHIBindGroupLayoutEntry[];
}

export interface RHIPipelineLayoutDescriptor extends RHIResourceDescriptorBase {
    readonly bindGroupLayouts: readonly RHIBindGroupLayout[];
}

export interface RHIPipelineLayout extends RHIResource {
    readonly descriptor: Readonly<RHIPipelineLayoutDescriptor>;
    readonly bindGroupLayouts: readonly RHIBindGroupLayout[];
}

export interface RHIBufferBinding {
    readonly buffer: RHIBuffer;
    readonly offset?: number;
    readonly size?: number;
}

export type RHIBindingResource = RHISampler | RHITextureView | RHIBufferBinding;

export interface RHIBindGroupEntry {
    readonly binding: number;
    readonly resource: RHIBindingResource;
}

export interface RHIBindGroupDescriptor extends RHIResourceDescriptorBase {
    readonly layout: RHIBindGroupLayout;
    readonly entries: readonly RHIBindGroupEntry[];
}

export interface RHIBindGroup extends RHIResource {
    readonly descriptor: Readonly<RHIBindGroupDescriptor>;
    readonly layout: RHIBindGroupLayout;
    readonly entries: readonly RHIBindGroupEntry[];
}

export type RHIVertexFormat =
    | 'uint8x2'
    | 'uint8x4'
    | 'sint8x2'
    | 'sint8x4'
    | 'unorm8x2'
    | 'unorm8x4'
    | 'snorm8x2'
    | 'snorm8x4'
    | 'uint16x2'
    | 'uint16x4'
    | 'sint16x2'
    | 'sint16x4'
    | 'unorm16x2'
    | 'unorm16x4'
    | 'snorm16x2'
    | 'snorm16x4'
    | 'float16x2'
    | 'float16x4'
    | 'float32'
    | 'float32x2'
    | 'float32x3'
    | 'float32x4'
    | 'uint32'
    | 'uint32x2'
    | 'uint32x3'
    | 'uint32x4'
    | 'sint32'
    | 'sint32x2'
    | 'sint32x3'
    | 'sint32x4';

export interface RHIVertexAttribute {
    readonly format: RHIVertexFormat;
    readonly offset: number;
    readonly shaderLocation: number;
}

export type RHIVertexStepMode = 'vertex' | 'instance';

export interface RHIVertexBufferLayout {
    readonly arrayStride: number;
    readonly stepMode?: RHIVertexStepMode;
    readonly attributes: readonly RHIVertexAttribute[];
}

export interface RHIVertexState {
    readonly shader: RHIShader;
    readonly buffers?: readonly (RHIVertexBufferLayout | null)[];
}

export type RHIBlendFactor =
    | 'zero'
    | 'one'
    | 'src'
    | 'one-minus-src'
    | 'src-alpha'
    | 'one-minus-src-alpha'
    | 'dst'
    | 'one-minus-dst'
    | 'dst-alpha'
    | 'one-minus-dst-alpha'
    | 'src-alpha-saturated'
    | 'constant'
    | 'one-minus-constant';

export type RHIBlendOperation = 'add' | 'subtract' | 'reverse-subtract' | 'min' | 'max';

export interface RHIBlendComponent {
    readonly operation?: RHIBlendOperation;
    readonly srcFactor?: RHIBlendFactor;
    readonly dstFactor?: RHIBlendFactor;
}

export interface RHIBlendState {
    readonly color: RHIBlendComponent;
    readonly alpha: RHIBlendComponent;
}

export interface RHIColorTargetState {
    readonly format: RHITextureFormat;
    readonly blend?: RHIBlendState;
    readonly writeMask?: RHIColorWriteFlags;
}

export interface RHIFragmentState {
    readonly shader: RHIShader;
    readonly targets: readonly (RHIColorTargetState | null)[];
}

export type RHIPrimitiveTopology =
    'point-list' | 'line-list' | 'line-strip' | 'triangle-list' | 'triangle-strip';
export type RHIFrontFace = 'ccw' | 'cw';
export type RHICullMode = 'none' | 'front' | 'back';

export interface RHIPrimitiveState {
    readonly topology?: RHIPrimitiveTopology;
    readonly stripIndexFormat?: RHIIndexFormat;
    readonly frontFace?: RHIFrontFace;
    readonly cullMode?: RHICullMode;
}

export type RHIStencilOperation =
    | 'keep'
    | 'zero'
    | 'replace'
    | 'invert'
    | 'increment-clamp'
    | 'decrement-clamp'
    | 'increment-wrap'
    | 'decrement-wrap';

export interface RHIStencilFaceState {
    readonly compare?: RHICompareFunction;
    readonly failOp?: RHIStencilOperation;
    readonly depthFailOp?: RHIStencilOperation;
    readonly passOp?: RHIStencilOperation;
}

export interface RHIDepthStencilState {
    readonly format: RHITextureFormat;
    readonly depthWriteEnabled?: boolean;
    readonly depthCompare?: RHICompareFunction;
    readonly stencilFront?: RHIStencilFaceState;
    readonly stencilBack?: RHIStencilFaceState;
    readonly stencilReadMask?: number;
    readonly stencilWriteMask?: number;
    readonly depthBias?: number;
    readonly depthBiasSlopeScale?: number;
    readonly depthBiasClamp?: number;
}

export interface RHIMultisampleState {
    readonly count?: number;
    readonly mask?: number;
    readonly alphaToCoverageEnabled?: boolean;
}

/** One immutable view of a vertex-buffer range used to precompile backend vertex input. */
export interface RHIVertexInputBufferBinding {
    readonly buffer: RHIBuffer | null;
    readonly offset: number;
    readonly size?: number;
}

/** One immutable view of an optional index-buffer range used to precompile backend vertex input. */
export interface RHIVertexInputIndexBinding {
    readonly buffer: RHIBuffer | null;
    readonly format: RHIIndexFormat;
    readonly offset: number;
    readonly size?: number;
}

/**
 * Backend-neutral exact vertex/index binding packet.
 *
 * Renderers keep this object stable and update its fields outside command execution. Backends may
 * use it to create native vertex-input objects before a render pass begins.
 */
export interface RHIVertexInputBindings {
    readonly vertexBuffers: readonly Readonly<RHIVertexInputBufferBinding>[];
    readonly indexBuffer: Readonly<RHIVertexInputIndexBinding> | null;
}

export interface RHIGraphicsPipelineDescriptor extends RHIResourceDescriptorBase {
    readonly layout: RHIPipelineLayout;
    readonly vertex: RHIVertexState;
    readonly fragment?: RHIFragmentState;
    readonly primitive: RHIPrimitiveState;
    readonly depthStencil?: RHIDepthStencilState;
    readonly multisample?: RHIMultisampleState;
}

export interface RHIGraphicsPipeline extends RHIResource {
    readonly descriptor: Readonly<RHIGraphicsPipelineDescriptor>;
    getBindGroupLayout(index: number): RHIBindGroupLayout;
    /** Ensure this exact binding packet can execute without creating backend objects in draw. */
    prepareVertexInput(bindings: Readonly<RHIVertexInputBindings>): void;
}
