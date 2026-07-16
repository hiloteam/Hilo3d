/**
 * Backend-neutral rendering hardware interface.
 *
 * The object model and descriptor names intentionally follow WebGPU, while the supported surface
 * is limited to the portable feature set required by Hilo3d's WebGPU and WebGL 2 backends.
 *
 * @internal
 */

export type RHIBackend = 'webgl2' | 'webgpu';

export const RHIBufferUsage = Object.freeze({
    MAP_READ: 0x0001,
    MAP_WRITE: 0x0002,
    COPY_SRC: 0x0004,
    COPY_DST: 0x0008,
    INDEX: 0x0010,
    VERTEX: 0x0020,
    UNIFORM: 0x0040,
    STORAGE: 0x0080
});

export const RHITextureUsage = Object.freeze({
    COPY_SRC: 0x01,
    COPY_DST: 0x02,
    TEXTURE_BINDING: 0x04,
    STORAGE_BINDING: 0x08,
    RENDER_ATTACHMENT: 0x10
});

export const RHIShaderStage = Object.freeze({
    VERTEX: 0x1,
    FRAGMENT: 0x2
});

export const RHIColorWrite = Object.freeze({
    RED: 0x1,
    GREEN: 0x2,
    BLUE: 0x4,
    ALPHA: 0x8,
    ALL: 0xf
});

export type RHIBufferUsageFlags = number;
export type RHITextureUsageFlags = number;
export type RHIShaderStageFlags = number;
export type RHIColorWriteFlags = number;

export type RHIPowerPreference = 'low-power' | 'high-performance';
export type RHIFeatureName =
    | 'buffer-mapping'
    | 'texture-1d'
    | 'draw-base-vertex'
    | 'draw-first-instance'
    | 'storage-buffers'
    | 'storage-textures'
    | 'compute-pipelines'
    | 'texture-compression-bc'
    | 'texture-compression-etc2'
    | 'texture-compression-astc'
    | 'depth32float-stencil8'
    | 'float32-filterable';

export interface RHILimits {
    readonly maxTextureDimension1D: number;
    readonly maxTextureDimension2D: number;
    readonly maxTextureDimension3D: number;
    readonly maxTextureArrayLayers: number;
    readonly maxBindGroups: number;
    readonly maxBindingsPerBindGroup: number;
    readonly maxDynamicUniformBuffersPerPipelineLayout: number;
    readonly maxSampledTexturesPerShaderStage: number;
    readonly maxSamplersPerShaderStage: number;
    readonly maxUniformBuffersPerShaderStage: number;
    /** Zero when storage buffers are outside the backend's supported RHI subset. */
    readonly maxStorageBuffersPerShaderStage: number;
    /** Zero when storage textures are outside the backend's supported RHI subset. */
    readonly maxStorageTexturesPerShaderStage: number;
    /** Zero when storage-buffer bindings are outside the backend's supported RHI subset. */
    readonly maxStorageBufferBindingSize: number;
    /** Zero when dynamic storage-buffer offsets are outside the supported RHI subset. */
    readonly minStorageBufferOffsetAlignment: number;
    readonly maxUniformBufferBindingSize: number;
    readonly maxVertexBuffers: number;
    readonly maxBufferSize: number;
    readonly maxVertexAttributes: number;
    readonly maxVertexBufferArrayStride: number;
    readonly minUniformBufferOffsetAlignment: number;
    readonly maxColorAttachments: number;
}

export interface RHILabelled {
    readonly label: string;
}

export interface RHIObject extends RHILabelled {
    readonly id: number;
    readonly backend: RHIBackend;
}

export interface RHIDestroyable extends RHIObject {
    readonly destroyed: boolean;
    destroy(): void;
}

export type RHIBufferSource = ArrayBuffer | ArrayBufferView;

export interface RHIBufferDescriptor {
    readonly label?: string;
    readonly size: number;
    readonly usage: RHIBufferUsageFlags;
    readonly mappedAtCreation?: boolean;
}

export interface RHIBufferBinding {
    readonly buffer: RHIBuffer;
    readonly offset?: number;
    readonly size?: number;
}

export interface RHIBuffer extends RHIDestroyable {
    readonly size: number;
    readonly usage: RHIBufferUsageFlags;
    readonly mapState: 'unmapped' | 'pending' | 'mapped';
    mapAsync(mode: 'read' | 'write', offset?: number, size?: number): Promise<void>;
    getMappedRange(offset?: number, size?: number): ArrayBuffer;
    unmap(): void;
}

export type RHITextureDimension = '1d' | '2d' | '3d';
export type RHITextureViewDimension = '1d' | '2d' | '2d-array' | 'cube' | 'cube-array' | '3d';
export type RHITextureAspect = 'all' | 'stencil-only' | 'depth-only';

export type RHITextureFormat =
    | 'r8unorm'
    | 'r8snorm'
    | 'r8uint'
    | 'r8sint'
    | 'r16uint'
    | 'r16sint'
    | 'r16float'
    | 'rg8unorm'
    | 'rg8snorm'
    | 'rg8uint'
    | 'rg8sint'
    | 'r32uint'
    | 'r32sint'
    | 'r32float'
    | 'rg16uint'
    | 'rg16sint'
    | 'rg16float'
    | 'rgba8unorm'
    | 'rgba8unorm-srgb'
    | 'rgba8snorm'
    | 'rgba8uint'
    | 'rgba8sint'
    | 'bgra8unorm'
    | 'bgra8unorm-srgb'
    | 'rgb10a2unorm'
    | 'rgb10a2uint'
    | 'rg11b10ufloat'
    | 'rgb9e5ufloat'
    | 'rg32uint'
    | 'rg32sint'
    | 'rg32float'
    | 'rgba16uint'
    | 'rgba16sint'
    | 'rgba16float'
    | 'rgba32uint'
    | 'rgba32sint'
    | 'rgba32float'
    | 'stencil8'
    | 'depth16unorm'
    | 'depth24plus'
    | 'depth24plus-stencil8'
    | 'depth32float'
    | 'depth32float-stencil8'
    | 'bc1-rgba-unorm'
    | 'bc1-rgba-unorm-srgb'
    | 'bc2-rgba-unorm'
    | 'bc2-rgba-unorm-srgb'
    | 'bc3-rgba-unorm'
    | 'bc3-rgba-unorm-srgb'
    | 'etc2-rgb8unorm'
    | 'etc2-rgb8unorm-srgb'
    | 'etc2-rgb8a1unorm'
    | 'etc2-rgb8a1unorm-srgb'
    | 'etc2-rgba8unorm'
    | 'etc2-rgba8unorm-srgb'
    | 'eac-r11unorm'
    | 'eac-r11snorm'
    | 'eac-rg11unorm'
    | 'eac-rg11snorm'
    | 'astc-4x4-unorm'
    | 'astc-4x4-unorm-srgb';

export interface RHIOrigin3D {
    readonly x?: number;
    readonly y?: number;
    readonly z?: number;
}

export interface RHIExtent3D {
    readonly width: number;
    readonly height?: number;
    readonly depthOrArrayLayers?: number;
}

export interface RHITextureDescriptor {
    readonly label?: string;
    readonly size: RHIExtent3D;
    readonly mipLevelCount?: number;
    readonly sampleCount?: number;
    readonly dimension?: RHITextureDimension;
    readonly format: RHITextureFormat;
    readonly usage: RHITextureUsageFlags;
    /** Formats that native WebGPU may use for alternate views of this allocation. */
    readonly viewFormats?: readonly RHITextureFormat[];
}

/** Lightweight, immutable capabilities for one texture format on a device. */
export interface RHITextureFormatCapabilities {
    /** The format can be used with TEXTURE_BINDING. */
    readonly sampled: boolean;
    /** Sampled textures of this format support linear filtering. */
    readonly filterable: boolean;
    /** The format can be used with RENDER_ATTACHMENT. */
    readonly renderable: boolean;
    /** The format can be used with STORAGE_BINDING. */
    readonly storage: boolean;
    /** Supported render-attachment sample counts, including one when renderable. */
    readonly sampleCounts: readonly number[];
}

export interface RHITextureViewDescriptor {
    readonly label?: string;
    readonly format?: RHITextureFormat;
    readonly dimension?: RHITextureViewDimension;
    readonly aspect?: RHITextureAspect;
    readonly baseMipLevel?: number;
    readonly mipLevelCount?: number;
    readonly baseArrayLayer?: number;
    readonly arrayLayerCount?: number;
}

export interface RHITexture extends RHIDestroyable {
    readonly width: number;
    readonly height: number;
    readonly depthOrArrayLayers: number;
    readonly mipLevelCount: number;
    readonly sampleCount: number;
    readonly dimension: RHITextureDimension;
    readonly format: RHITextureFormat;
    readonly usage: RHITextureUsageFlags;
    createView(descriptor?: RHITextureViewDescriptor): RHITextureView;
}

export interface RHITextureView extends RHIObject {
    readonly texture: RHITexture;
    readonly format: RHITextureFormat;
    readonly dimension: RHITextureViewDimension;
    readonly aspect: RHITextureAspect;
    readonly baseMipLevel: number;
    readonly mipLevelCount: number;
    readonly baseArrayLayer: number;
    readonly arrayLayerCount: number;
}

export type RHIAddressMode = 'clamp-to-edge' | 'repeat' | 'mirror-repeat';
export type RHIFilterMode = 'nearest' | 'linear';
export type RHIMipmapFilterMode = 'nearest' | 'linear';
export type RHICompareFunction =
    | 'never'
    | 'less'
    | 'equal'
    | 'less-equal'
    | 'greater'
    | 'not-equal'
    | 'greater-equal'
    | 'always';

export interface RHISamplerDescriptor {
    readonly label?: string;
    readonly addressModeU?: RHIAddressMode;
    readonly addressModeV?: RHIAddressMode;
    readonly addressModeW?: RHIAddressMode;
    readonly magFilter?: RHIFilterMode;
    readonly minFilter?: RHIFilterMode;
    readonly mipmapFilter?: RHIMipmapFilterMode;
    readonly lodMinClamp?: number;
    readonly lodMaxClamp?: number;
    readonly compare?: RHICompareFunction;
    readonly maxAnisotropy?: number;
}

/** Fully defaulted sampler state; comparison remains absent for ordinary filtering samplers. */
export interface RHINormalizedSamplerDescriptor {
    readonly addressModeU: RHIAddressMode;
    readonly addressModeV: RHIAddressMode;
    readonly addressModeW: RHIAddressMode;
    readonly magFilter: RHIFilterMode;
    readonly minFilter: RHIFilterMode;
    readonly mipmapFilter: RHIMipmapFilterMode;
    readonly lodMinClamp: number;
    readonly lodMaxClamp: number;
    readonly compare?: RHICompareFunction;
    readonly maxAnisotropy: number;
}

export interface RHISampler extends RHIObject {
    readonly descriptor: Readonly<RHINormalizedSamplerDescriptor>;
}

export type RHIShaderLanguage = 'glsl' | 'wgsl';
export type RHIShaderModuleStage = 'vertex' | 'fragment';

/** Binding assigned to a prepared GLSL uniform block by the shader compiler. */
export interface RHIPreparedUniformBlockBinding {
    readonly name: string;
    readonly group: number;
    readonly binding: number;
}

/** Texture/sampler bindings assigned to one prepared GLSL sampler element. */
export interface RHIPreparedSamplerBinding {
    readonly name: string;
    readonly arrayIndex: number;
    readonly group: number;
    readonly textureBinding: number;
    readonly samplerBinding: number;
}

/**
 * Backend binding metadata emitted by the shader compiler.
 *
 * The RHI never derives these engine-independent bindings from GL reflection order. Reflection is
 * used only to discover which named GLSL resources survived native program linking.
 */
export interface RHIPreparedShaderBindings {
    readonly uniformBlocks?: readonly RHIPreparedUniformBlockBinding[];
    readonly samplers?: readonly RHIPreparedSamplerBinding[];
}

export interface RHIShaderModuleDescriptor {
    readonly label?: string;
    readonly code: string;
    readonly language: RHIShaderLanguage;
    readonly stage: RHIShaderModuleStage;
    /** Required by WebGL when the linked GLSL program exposes bindable resources. */
    readonly preparedBindings?: RHIPreparedShaderBindings;
}

export interface RHIShaderModule extends RHIObject {
    readonly language: RHIShaderLanguage;
    readonly stage: RHIShaderModuleStage;
    readonly preparedBindings?: RHIPreparedShaderBindings;
}

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

export interface RHIBindGroupLayoutEntry {
    readonly binding: number;
    readonly visibility: RHIShaderStageFlags;
    readonly buffer?: RHIBindGroupLayoutBufferBinding;
    readonly sampler?: RHIBindGroupLayoutSamplerBinding;
    readonly texture?: RHIBindGroupLayoutTextureBinding;
    readonly storageTexture?: RHIBindGroupLayoutStorageTextureBinding;
}

export interface RHIBindGroupLayoutDescriptor {
    readonly label?: string;
    readonly entries: readonly RHIBindGroupLayoutEntry[];
}

export interface RHIBindGroupLayout extends RHIObject {
    readonly entries: readonly RHIBindGroupLayoutEntry[];
}

export interface RHIPipelineLayoutDescriptor {
    readonly label?: string;
    readonly bindGroupLayouts: readonly RHIBindGroupLayout[];
}

export interface RHIPipelineLayout extends RHIObject {
    readonly bindGroupLayouts: readonly RHIBindGroupLayout[];
}

export interface RHIBindGroupEntry {
    readonly binding: number;
    readonly resource: RHISampler | RHITextureView | RHIBufferBinding;
}

export interface RHIBindGroupDescriptor {
    readonly label?: string;
    readonly layout: RHIBindGroupLayout;
    readonly entries: readonly RHIBindGroupEntry[];
}

export interface RHIBindGroup extends RHIObject {
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
    readonly module: RHIShaderModule;
    readonly entryPoint?: string;
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
    readonly module: RHIShaderModule;
    readonly entryPoint?: string;
    readonly targets: readonly (RHIColorTargetState | null)[];
}

export type RHIPrimitiveTopology =
    'point-list' | 'line-list' | 'line-strip' | 'triangle-list' | 'triangle-strip';
export type RHIIndexFormat = 'uint16' | 'uint32';
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

export interface RHIRenderPipelineDescriptor {
    readonly label?: string;
    /** Portable pipelines always use an explicit layout; backend-inferred layouts are not exposed. */
    readonly layout: RHIPipelineLayout;
    readonly vertex: RHIVertexState;
    readonly primitive?: RHIPrimitiveState;
    readonly depthStencil?: RHIDepthStencilState;
    readonly multisample?: RHIMultisampleState;
    readonly fragment?: RHIFragmentState;
}

export interface RHIRenderPipeline extends RHIObject {
    readonly descriptor: RHIRenderPipelineDescriptor;
    getBindGroupLayout(index: number): RHIBindGroupLayout;
}

export type RHILoadOp = 'load' | 'clear';
export type RHIStoreOp = 'store' | 'discard';

export interface RHIColor {
    readonly r: number;
    readonly g: number;
    readonly b: number;
    readonly a: number;
}

export interface RHIRenderPassColorAttachment {
    readonly view: RHITextureView;
    readonly resolveTarget?: RHITextureView;
    readonly clearValue?: RHIColor;
    readonly loadOp: RHILoadOp;
    readonly storeOp: RHIStoreOp;
}

export interface RHIRenderPassDepthStencilAttachment {
    readonly view: RHITextureView;
    readonly depthClearValue?: number;
    readonly depthLoadOp?: RHILoadOp;
    readonly depthStoreOp?: RHIStoreOp;
    readonly depthReadOnly?: boolean;
    readonly stencilClearValue?: number;
    readonly stencilLoadOp?: RHILoadOp;
    readonly stencilStoreOp?: RHIStoreOp;
    readonly stencilReadOnly?: boolean;
}

export interface RHIRenderPassDescriptor {
    readonly label?: string;
    readonly colorAttachments: readonly (RHIRenderPassColorAttachment | null)[];
    readonly depthStencilAttachment?: RHIRenderPassDepthStencilAttachment;
}

export interface RHIImageDataLayout {
    readonly offset?: number;
    readonly bytesPerRow?: number;
    readonly rowsPerImage?: number;
}

export interface RHIImageCopyTexture {
    readonly texture: RHITexture;
    readonly mipLevel?: number;
    readonly origin?: RHIOrigin3D;
    readonly aspect?: RHITextureAspect;
}

export interface RHIImageCopyBuffer {
    readonly buffer: RHIBuffer;
    readonly offset?: number;
    readonly bytesPerRow?: number;
    readonly rowsPerImage?: number;
}

export interface RHIImageCopyExternalImage {
    readonly source: TexImageSource;
    readonly origin?: { readonly x?: number; readonly y?: number };
    readonly flipY?: boolean;
}

export type RHICommandBuffer = RHIObject;

export interface RHIRenderPassEncoder extends RHILabelled {
    setPipeline(pipeline: RHIRenderPipeline): void;
    setBindGroup(index: number, bindGroup: RHIBindGroup, dynamicOffsets?: readonly number[]): void;
    setVertexBuffer(slot: number, buffer: RHIBuffer, offset?: number, size?: number): void;
    setIndexBuffer(
        buffer: RHIBuffer,
        indexFormat: RHIIndexFormat,
        offset?: number,
        size?: number
    ): void;
    setViewport(
        x: number,
        y: number,
        width: number,
        height: number,
        minDepth: number,
        maxDepth: number
    ): void;
    setScissorRect(x: number, y: number, width: number, height: number): void;
    setBlendConstant(color: RHIColor): void;
    setStencilReference(reference: number): void;
    draw(
        vertexCount: number,
        instanceCount?: number,
        firstVertex?: number,
        firstInstance?: number
    ): void;
    drawIndexed(
        indexCount: number,
        instanceCount?: number,
        firstIndex?: number,
        baseVertex?: number,
        firstInstance?: number
    ): void;
    end(): void;
}

export interface RHICommandEncoder extends RHILabelled {
    beginRenderPass(descriptor: RHIRenderPassDescriptor): RHIRenderPassEncoder;
    copyBufferToBuffer(
        source: RHIBuffer,
        sourceOffset: number,
        destination: RHIBuffer,
        destinationOffset: number,
        size: number
    ): void;
    copyTextureToBuffer(
        source: RHIImageCopyTexture,
        destination: RHIImageCopyBuffer,
        copySize: RHIExtent3D
    ): void;
    copyBufferToTexture(
        source: RHIImageCopyBuffer,
        destination: RHIImageCopyTexture,
        copySize: RHIExtent3D
    ): void;
    copyTextureToTexture(
        source: RHIImageCopyTexture,
        destination: RHIImageCopyTexture,
        copySize: RHIExtent3D
    ): void;
    finish(): RHICommandBuffer;
}

export interface RHIQueue extends RHIObject {
    submit(commandBuffers: readonly RHICommandBuffer[]): void;
    writeBuffer(
        buffer: RHIBuffer,
        bufferOffset: number,
        data: RHIBufferSource,
        /** Offset into `data`: typed-array elements, or bytes for ArrayBuffer and DataView. */
        dataOffset?: number,
        /** Copy size: typed-array elements, or bytes for ArrayBuffer and DataView. */
        size?: number
    ): void;
    writeTexture(
        destination: RHIImageCopyTexture,
        data: RHIBufferSource,
        dataLayout: RHIImageDataLayout,
        size: RHIExtent3D
    ): void;
    copyExternalImageToTexture(
        source: RHIImageCopyExternalImage,
        destination: RHIImageCopyTexture,
        copySize: RHIExtent3D
    ): void;
    onSubmittedWorkDone(): Promise<void>;
}

export interface RHIDeviceLostInfo {
    readonly reason: 'destroyed' | 'unknown';
    readonly message: string;
}

export interface RHIDevice extends RHIDestroyable {
    readonly features: ReadonlySet<RHIFeatureName>;
    readonly limits: RHILimits;
    readonly queue: RHIQueue;
    readonly lost: Promise<RHIDeviceLostInfo>;
    getTextureFormatCapabilities(format: RHITextureFormat): RHITextureFormatCapabilities;
    createBuffer(descriptor: RHIBufferDescriptor): RHIBuffer;
    createTexture(descriptor: RHITextureDescriptor): RHITexture;
    createSampler(descriptor?: RHISamplerDescriptor): RHISampler;
    createShaderModule(descriptor: RHIShaderModuleDescriptor): RHIShaderModule;
    createBindGroupLayout(descriptor: RHIBindGroupLayoutDescriptor): RHIBindGroupLayout;
    createPipelineLayout(descriptor: RHIPipelineLayoutDescriptor): RHIPipelineLayout;
    createBindGroup(descriptor: RHIBindGroupDescriptor): RHIBindGroup;
    createRenderPipeline(descriptor: RHIRenderPipelineDescriptor): RHIRenderPipeline;
    createRenderPipelineAsync(descriptor: RHIRenderPipelineDescriptor): Promise<RHIRenderPipeline>;
    createCommandEncoder(descriptor?: { readonly label?: string }): RHICommandEncoder;
}

export interface RHISurfaceConfiguration {
    readonly format: RHITextureFormat;
    readonly usage?: RHITextureUsageFlags;
    readonly alphaMode?: 'opaque' | 'premultiplied';
}

export interface RHISurface extends RHIDestroyable {
    readonly canvas: HTMLCanvasElement;
    readonly width: number;
    readonly height: number;
    readonly format: RHITextureFormat;
    configure(configuration: RHISurfaceConfiguration): void;
    resize(width: number, height: number): void;
    getCurrentTexture(): RHITexture;
}

export interface RHI extends RHIDestroyable {
    readonly device: RHIDevice;
    readonly surface: RHISurface;
    readonly ready: Promise<void>;
    readonly isReady: boolean;
}

export interface RHICreateOptions {
    readonly canvas: HTMLCanvasElement;
    readonly width: number;
    readonly height: number;
    readonly powerPreference?: RHIPowerPreference;
    readonly alpha?: boolean;
    readonly antialias?: boolean;
    readonly requiredFeatures?: readonly RHIFeatureName[];
    /** Minimum portable limits required by the upper renderer before it creates resources. */
    readonly requiredLimits?: Readonly<Partial<RHILimits>>;
}

/** Backend-bound constructor signature used by concrete RHI modules. */
export type RHIBackendFactory<Options extends RHICreateOptions = RHICreateOptions> = (
    options: Options
) => Promise<RHI>;
