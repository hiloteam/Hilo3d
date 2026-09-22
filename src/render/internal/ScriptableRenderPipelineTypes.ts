import type Camera from '../../camera/Camera';
import type { RenderPipelineContext, RenderPipelineCapabilities } from '../pipeline/RenderPipeline';
import type Mesh from '../../core/Mesh';
import type LightManager from '../../light/LightManager';
import type { RenderGraphFrameContext } from '../frame/RenderGraphFrameContext';
import type {
    RGBufferHandle,
    RGTextureAccessHandle,
    RGTextureHandle
} from '../graph/RenderGraphResource';
import type {
    RenderTarget,
    RenderTargetColor,
    RenderTargetLoadOp,
    RenderTargetStoreOp
} from '../RenderTarget';
import type { RendererCore, RendererScene } from '../RendererCore';
import type {
    RHINormalizedTextureViewDescriptor,
    RHISurface,
    RHITextureDimension,
    RHITextureFormat,
    RHITextureViewDimension,
    RHIViewport
} from '../rhi/core';
import type { RendererStorageBuffer, StorageBuffer } from '../StorageBuffer';
import type {
    RenderGraphBufferHandle,
    RenderGraphTextureAccessHandle,
    RenderGraphTextureHandle,
    RenderGraphTextureViewHandle
} from '../pipeline/ScriptableRenderGraph';
import type { FullscreenDrawProcessor } from '../renderer/FullscreenDrawProcessor';
import type { MeshDrawProcessor } from '../renderer/MeshDrawProcessor';
import type { ComputePipelineResourceCache } from '../renderer/ComputePipelineResourceCache';
import type { ComputeSamplerResourceCache } from '../renderer/ComputeSamplerResourceCache';
import type { GPUDrivenPipelineResourceCache } from '../renderer/GPUDrivenPipelineResourceCache';
import type { ScriptableBindGroupResourceCache } from '../renderer/ScriptableBindGroupResourceCache';
import type { RenderTargetGraphBridge } from '../renderer/RenderTargetGraphBridge';
import type {
    RenderTargetResourceCache,
    RenderTargetResourceRecord
} from '../renderer/RenderTargetResourceCache';
import type { RHIRenderTarget } from '../renderer/RHIRenderTarget';
import type { StorageBufferResourceCache } from '../renderer/StorageBufferResourceCache';
import type { ShadowAtlasScenePlan } from '../renderer/ShadowAtlasSceneAdapter';
import type { ShadowAtlasResourceRecord } from '../renderer/ShadowAtlasResourceCache';
import type { ShadowAtlasPageRegion } from '../renderer/ShadowAtlasPageResidency';
import type { PersistentHistoryState } from './ScriptableRenderPipelineResources';

export type TextureAccess =
    | 'attachment'
    | 'resolve-target'
    | 'sampled'
    | 'storage-write'
    | 'copy-source'
    | 'copy-destination';

export type PipelineTextureFormat = RHITextureFormat;

export type MutableRHIViewport = { -readonly [Key in keyof RHIViewport]: RHIViewport[Key] };

export type MutableRenderTargetColor = {
    -readonly [Key in keyof RenderTargetColor]: RenderTargetColor[Key];
};

/** @internal Surface load/store and multisample policy for one camera invocation. */
export interface ScriptableSurfaceFramePolicy {
    readonly sampleCount: 1 | 4;
    readonly colorLoadOp: RenderTargetLoadOp;
    readonly depthLoadOp: RenderTargetLoadOp;
    readonly depthStoreOp: RenderTargetStoreOp;
    readonly stencilLoadOp: RenderTargetLoadOp;
    readonly stencilStoreOp: RenderTargetStoreOp;
}

export interface MutableTextureGraphDescriptor {
    label: string;
    readonly size: { width: number; height: number; depthOrArrayLayers: number };
    mipLevelCount: number;
    sampleCount: number;
    dimension: RHITextureDimension;
    viewDimension: RHITextureViewDimension;
    format: PipelineTextureFormat;
    usage: number;
    readonly viewFormats: RHITextureFormat[];
}

export interface MutableBufferGraphDescriptor {
    label: string;
    size: number;
    usage: number;
}

interface TextureAccessRecordBase {
    handle: RenderGraphTextureAccessHandle;
    name: string;
    format: PipelineTextureFormat;
    width: number;
    height: number;
    depthOrArrayLayers: number;
    sampleCount: 1 | 4;
    mipLevelCount: number;
    textureDimension: RHITextureDimension;
    attachment: RGTextureAccessHandle | null;
    readable: RGTextureAccessHandle | null;
    writable: RGTextureAccessHandle | null;
    resolveTarget: RGTextureAccessHandle | null;
    outputRoot: RGTextureHandle | null;
    transient: boolean;
    historyState: PersistentHistoryState | null;
    historyCurrent: boolean;
}

export interface TextureRecord extends TextureAccessRecordBase {
    readonly kind: 'texture';
    handle: RenderGraphTextureHandle;
    attachment: RGTextureHandle | null;
    readable: RGTextureHandle | null;
    writable: RGTextureHandle | null;
    resolveTarget: RGTextureHandle | null;
    viewDimension: RHITextureViewDimension;
    viewFormats: readonly RHITextureFormat[];
    readonly graphDescriptor: MutableTextureGraphDescriptor;
}

export interface TextureViewRecord extends TextureAccessRecordBase {
    readonly kind: 'texture-view';
    handle: RenderGraphTextureViewHandle;
    texture: TextureRecord;
    descriptor: Readonly<RHINormalizedTextureViewDescriptor>;
}

export type TextureAccessRecord = TextureRecord | TextureViewRecord;

export interface TextureRecordSource {
    readonly name: string;
    readonly format: PipelineTextureFormat;
    readonly width: number;
    readonly height: number;
    readonly depthOrArrayLayers?: number;
    readonly sampleCount: 1 | 4;
    readonly mipLevelCount: number;
    readonly textureDimension?: RHITextureDimension;
    readonly viewDimension?: RHITextureViewDimension;
    readonly viewFormats?: readonly RHITextureFormat[];
    readonly attachment: RGTextureHandle | null;
    readonly readable: RGTextureHandle | null;
    readonly writable: RGTextureHandle | null;
    readonly resolveTarget: RGTextureHandle | null;
    readonly outputRoot: RGTextureHandle | null;
    readonly transient: boolean;
    readonly historyState?: PersistentHistoryState | null;
    readonly historyCurrent?: boolean;
}

export interface BufferRecord {
    handle: RenderGraphBufferHandle;
    name: string;
    byteLength: number;
    internal: RGBufferHandle | null;
    source: RendererStorageBuffer | null;
    transient: boolean;
    initialized: boolean;
    readonly graphDescriptor: MutableBufferGraphDescriptor;
}

/** @internal Renderer services deliberately narrower than either Renderer or the portable RHI. */
export interface ScriptableRenderPipelineServices {
    recordScriptableView(
        scene: RendererScene,
        camera: Camera,
        target: RenderTarget,
        capabilities: RenderPipelineCapabilities,
        runtimeOwner: object,
        record: (context: RenderPipelineContext) => unknown
    ): void;
    readonly renderer: RendererCore;
    readonly lightManager: LightManager;
    readonly antialias: boolean;
    getScriptableSurfaceFramePolicy(camera: Camera): Readonly<ScriptableSurfaceFramePolicy>;
    getScriptableSurface(): RHISurface;
    getScriptableMeshProcessor(): MeshDrawProcessor;
    getScriptableFullscreenProcessor(): FullscreenDrawProcessor;
    getScriptableTargetResources(): RenderTargetResourceCache;
    getScriptableStorageBufferResources(): StorageBufferResourceCache;
    getScriptableComputePipelineResources(): ComputePipelineResourceCache;
    getScriptableComputeSamplerResources(): ComputeSamplerResourceCache;
    getScriptableGPUDrivenPipelineResources(): GPUDrivenPipelineResourceCache;
    getScriptableBindGroupResources(): ScriptableBindGroupResourceCache;
    getScriptableTargetBridge(): RenderTargetGraphBridge;
    resolveScriptableRenderTarget(target: RenderTarget): RHIRenderTarget;
    resolveScriptableStorageBuffer(buffer: StorageBuffer): RendererStorageBuffer;
    createScriptableFrameContext(
        camera: Camera,
        viewport: Readonly<RHIViewport>,
        frameIndex: number
    ): RenderGraphFrameContext;
    beginScriptableResourcePass(context: RenderGraphFrameContext): void;
    beginScriptableMeshPass(context: RenderGraphFrameContext): void;
    beginScriptableFullscreenPass(context: RenderGraphFrameContext): void;
    prepareScriptableCullingScene(scene: RendererScene, camera: Camera): void;
    markScriptableTargetUsed(record: Readonly<RenderTargetResourceRecord>): void;
    markScriptableSurfaceRequested(): void;
    fireScriptableBeforeScene(
        meshes: readonly Mesh[],
        enabled: boolean,
        fireRendererEvents: boolean
    ): void;
    recordScriptableShadows(
        meshes: readonly Mesh[],
        cacheMeshes: readonly Mesh[],
        camera: Camera,
        viewport: Readonly<RHIViewport>,
        width: number,
        height: number
    ): Readonly<ScriptableShadowAtlasBuild> | null;
    recordScriptablePass(passCount: number): void;
    recordScriptableFaces(meshes: readonly Mesh[]): void;
    queueScriptableAfterScene(meshes: readonly Mesh[], enabled: boolean): void;
    retainScriptablePresentation(scene: RendererScene, camera: Camera): void;
}

/** @internal Exact renderer-owned atlas build attached to the current application graph. */
export interface ScriptableShadowAtlasBuild {
    readonly passCount: number;
    readonly texture: RGTextureHandle;
    readonly atlas: Readonly<ShadowAtlasResourceRecord>;
    readonly plan: Readonly<ShadowAtlasScenePlan>;
    readonly dirtySlices: readonly boolean[];
    readonly pageRegions: readonly Readonly<ShadowAtlasPageRegion>[];
}
