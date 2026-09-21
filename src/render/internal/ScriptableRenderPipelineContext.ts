import Camera from '../../camera/Camera';
import Mesh from '../../core/Mesh';
import type Light from '../../light/Light';
import type LightManager from '../../light/LightManager';
import type Material from '../../material/MaterialInstance';
import type { MaterialPassRole } from '../../material/MaterialDefinition';
import Texture from '../../texture/Texture';
import type StorageGraphicsShader from '../compute/StorageGraphicsShader';
import type { RenderGraphFrameBuildScope } from '../frame/RenderGraphFrame';
import type {
    RGBufferHandle,
    RGPassHandle,
    RGTextureAccessHandle,
    RGTextureHandle
} from '../graph/RenderGraphResource';
import RenderList from '../RenderList';
import { RenderGraphFramePlanner } from '../RenderGraphFramePlan';
import type {
    RenderTarget,
    RenderTargetColor,
    RenderTargetDepthStencilFormat,
    RenderTargetLoadOp,
    RenderTargetStoreOp
} from '../RenderTarget';
import type { RendererScene, RendererViewport } from '../RendererCore';
import {
    RHITextureUsage,
    rhiTextureFormatHasDepth,
    rhiTextureFormatHasStencil,
    type RHIBuffer,
    type RHISurface,
    type RHITextureFormat,
    type RHIViewport
} from '../rhi/core';
import {
    normalizeRHITextureDescriptor,
    normalizeRHITextureViewDescriptorForTextureDescriptor
} from '../rhi/core/RHIValidation';
import type { RendererStorageBuffer, StorageBuffer } from '../StorageBuffer';
import type {
    CullingOptions,
    CullingResultsHandle,
    OrderedRendererListDescriptor,
    RendererListDescriptor,
    RendererListHandle
} from '../pipeline/RendererList';
import type {
    RenderPipelineCapabilities,
    RenderPipelineContext,
    RenderPipelineOutput,
    RenderPipelineOutputColorAttachment,
    RenderPipelineOutputDepthStencilAttachment,
    RenderPipelineShadowResources,
    RenderPipelineShadowOptions,
    RenderPipelineShadowSlice
} from '../pipeline/RenderPipeline';
import {
    acquireRenderPassParameters,
    type RenderPassParameterPool
} from '../pipeline/RenderPassParameterPool';
import type {
    FullscreenRenderPass,
    FullscreenRenderPassParameters
} from '../pipeline/passes/FullscreenRenderPass';
import type {
    ComputeRenderPass,
    ComputeRenderPassParameters
} from '../pipeline/passes/ComputeRenderPass';
import type {
    GPUDrivenRenderPass,
    GPUDrivenRenderPassParameters
} from '../pipeline/passes/GPUDrivenRenderPass';
import type { SceneStorageShaderVariant } from '../pipeline/passes/SceneRenderPass';
import type {
    RenderGraphBufferHandle,
    RenderGraphBufferReadUse,
    RenderGraphBufferWriteUse,
    RenderGraphPassHandle,
    RenderGraphTextureAccessHandle,
    RenderGraphTextureHandle,
    RenderGraphTextureViewHandle,
    RenderPipelineBufferDescriptor,
    RenderPipelineColorFormat,
    RenderPipelineExtent,
    RenderPipelineHistoryTextureDescriptor,
    RenderPipelineHistoryTextureResources,
    RenderPipelinePersistentTargetDescriptor,
    RenderPipelinePersistentTextureUsage,
    RenderPipelineTargetResources,
    RenderPipelineTextureDescriptor,
    RenderPipelineTextureViewDescriptor,
    ScriptableRenderGraph,
    ScriptableRenderPass
} from '../pipeline/ScriptableRenderGraph';
import { MeshDrawListPlanner, type MeshDrawListPlan } from '../renderer/MeshDrawListPlanner';
import type {
    SceneTexturePreparationState,
    StorageScenePreparationState
} from '../renderer/MeshDrawProcessor';
import type {
    RenderTargetResourceDescriptor,
    RenderTargetResourceRecord
} from '../renderer/RenderTargetResourceCache';
import type { RHIMeshDrawTargetDescriptor } from '../renderer/RHIDescriptorMapping';
import type { ResourceRegistryHandle } from '../renderer/ResourceRegistry';
import type { RHIRenderTarget } from '../renderer/RHIRenderTarget';
import {
    ScriptableComputeDispatch,
    type ScriptableComputeDispatchServices,
    type ScriptableComputeGraphResolver
} from '../renderer/ScriptableComputeDispatch';
import {
    ScriptableGPUDrivenDraw,
    type ScriptableGPUDrivenDrawServices
} from '../renderer/ScriptableGPUDrivenDraw';
import { importSurfaceColor, importSurfaceDepthStencil } from '../renderer/SurfaceGraphBridge';
import type { SharedDrawPassParameters } from '../renderer/passes/SharedDrawPass';
import { refreshShadowAtlasSceneBinding } from '../renderer/ShadowAtlasTextureBinding';
import { depthClearValue } from '../renderer/DepthConvention';
import type {
    TextureAccess,
    PipelineTextureFormat,
    MutableRHIViewport,
    MutableRenderTargetColor,
    MutableTextureGraphDescriptor,
    MutableBufferGraphDescriptor,
    TextureRecord,
    TextureViewRecord,
    TextureAccessRecord,
    TextureRecordSource,
    BufferRecord,
    ScriptableRenderPipelineServices
} from './ScriptableRenderPipelineTypes';
import type {
    PersistentHistoryState,
    HistoryTextureRecipe,
    ScriptableRenderPipelineResources
} from './ScriptableRenderPipelineResources';
import { positiveInteger, graphBufferUsage } from './ScriptableRenderPipelineValidation';
import { ScriptableFullscreenDraw, ScriptablePassSlot } from './ScriptableRenderPassExecution';

const EMPTY_LIGHTS: readonly Light[] = Object.freeze([]);
const EMPTY_MESHES: readonly Mesh[] = Object.freeze([]);

interface MutablePipelineOutputState {
    kind: 'surface' | 'render-target';
    width: number;
    height: number;
    sampleCount: 1 | 4;
    colorAttachmentCount: number;
    depthStencilFormat: RenderPipelineOutput['depthStencilFormat'];
}

interface MutablePipelineOutputColorAttachmentState {
    readonly clearValue: MutableRenderTargetColor;
    loadOp: RenderTargetLoadOp;
    storeOp: RenderTargetStoreOp;
}

interface MutablePipelineOutputDepthStencilAttachmentState {
    depthClearValue: number;
    depthLoadOp: RenderTargetLoadOp;
    depthStoreOp: RenderTargetStoreOp;
    stencilClearValue: number;
    stencilLoadOp: RenderTargetLoadOp;
    stencilStoreOp: RenderTargetStoreOp;
}

interface MutablePersistentTargetResourceDescriptor extends RenderTargetResourceDescriptor {
    label?: string;
    width: number;
    height: number;
    readonly colorFormats: RHITextureFormat[];
    sampleCount: 1 | 4;
    multisampleAttachmentLifetime: 'persistent';
    depthStencilFormat: RHITextureFormat | null;
    depthStencilSampled: boolean;
}

interface MutableRenderPipelineShadowSlice {
    kind: RenderPipelineShadowSlice['kind'];
    sliceIndex: number;
    physicalIndex: number;
    face: number | null;
    cascade: number | null;
    readonly viewport: [number, number, number, number];
    readonly viewProjectionMatrix: Float32Array;
    near: number;
    far: number;
    dirty: boolean;
}

function createTextureGraphDescriptor(): MutableTextureGraphDescriptor {
    return {
        label: '',
        size: { width: 1, height: 1, depthOrArrayLayers: 1 },
        mipLevelCount: 1,
        sampleCount: 1,
        dimension: '2d',
        viewDimension: '2d',
        format: 'rgba8unorm',
        usage: RHITextureUsage.RENDER_ATTACHMENT,
        viewFormats: []
    };
}

function createBufferGraphDescriptor(): MutableBufferGraphDescriptor {
    return { label: '', size: 4, usage: 0 };
}

function historyTextureUsage(uses: readonly RenderPipelinePersistentTextureUsage[]): number {
    const candidate: unknown = uses;
    if (!Array.isArray(candidate) || uses.length === 0) {
        throw new TypeError('History texture usage must be a non-empty array');
    }
    let usage = 0;
    const seen = new Set<string>();
    for (const use of uses) {
        if (seen.has(use)) throw new TypeError(`Duplicate history texture usage ${use}`);
        seen.add(use);
        switch (use) {
            case 'sampled':
                usage |= RHITextureUsage.TEXTURE_BINDING;
                break;
            case 'storage':
                usage |= RHITextureUsage.STORAGE_BINDING;
                break;
            case 'attachment':
                usage |= RHITextureUsage.RENDER_ATTACHMENT;
                break;
            case 'copy-source':
                usage |= RHITextureUsage.COPY_SRC;
                break;
            case 'copy-destination':
                usage |= RHITextureUsage.COPY_DST;
                break;
            default:
                throw new TypeError(`Unsupported history texture usage ${String(use)}`);
        }
    }
    return usage;
}

function historyTextureBufferCount(value: unknown): 2 | 3 {
    if (value !== 2 && value !== 3) {
        throw new RangeError('History texture bufferCount must be two or three');
    }
    return value;
}

function createPersistentTargetResourceDescriptor(): MutablePersistentTargetResourceDescriptor {
    return {
        width: 1,
        height: 1,
        colorFormats: [],
        sampleCount: 1,
        multisampleAttachmentLifetime: 'persistent',
        depthStencilFormat: null,
        depthStencilSampled: false
    };
}

class CullingSlot {
    readonly planner = new RenderGraphFramePlanner();
    readonly renderList = new RenderList();
    readonly visibleMeshes: Mesh[] = [];
    readonly #collectVisible = (mesh: Mesh): void => {
        this.visibleMeshes.push(mesh);
    };
    handle = 0 as CullingResultsHandle;
    frameIndex = -1;
    camera: Camera | null = null;
    scene: RendererScene | null = null;
    lights: readonly Light[] = EMPTY_LIGHTS;
    used = false;

    build(
        handle: CullingResultsHandle,
        frameIndex: number,
        scene: RendererScene,
        camera: Camera,
        lightManager: LightManager,
        useInstanced: boolean,
        frustumCulling: boolean
    ): void {
        this.handle = handle;
        this.frameIndex = frameIndex;
        this.camera = camera;
        this.scene = scene;
        this.used = false;
        this.renderList.orderedOnly = true;
        this.renderList.useInstanced = useInstanced;
        const plan = this.planner.build(
            scene,
            camera,
            this.renderList,
            lightManager,
            frustumCulling
        );
        this.lights = plan.lights;
        this.visibleMeshes.length = 0;
        this.renderList.traverse(this.#collectVisible);
    }

    activate(services: ScriptableRenderPipelineServices): Camera {
        const camera = this.camera;
        const scene = this.scene;
        if (camera === null || scene === null) throw new Error('Culling slot is incomplete');
        services.prepareScriptableCullingScene(scene, camera);
        const manager = services.lightManager;
        manager.reset();
        for (const light of this.lights) manager.addLight(light);
        manager.updateInfo(camera);
        refreshShadowAtlasSceneBinding(manager);
        return camera;
    }

    releaseFrameReferences(): void {
        this.planner.reset();
        this.renderList.reset();
        this.visibleMeshes.length = 0;
        this.camera = null;
        this.scene = null;
        this.lights = EMPTY_LIGHTS;
        this.frameIndex = -1;
        this.used = false;
    }
}

class RendererListSlot {
    readonly planner = new MeshDrawListPlanner();
    readonly selectedMeshes: Mesh[] = [];
    readonly meshIdentities = new Set<Mesh>();
    handle = 0 as RendererListHandle;
    frameIndex = -1;
    culling: CullingSlot | null = null;
    overrideMaterial: Material | null = null;
    materialPass: MaterialPassRole = 'forward';
    ordered = false;
    plan: Readonly<MeshDrawListPlan> | null = null;

    build(
        handle: RendererListHandle,
        frameIndex: number,
        culling: CullingSlot,
        descriptor: Readonly<RendererListDescriptor>
    ): void {
        const queue: unknown = descriptor.queue;
        const sorting: unknown = descriptor.sorting;
        if (queue !== 'opaque' && queue !== 'transparent' && queue !== 'all') {
            throw new TypeError(`Unsupported renderer-list queue ${String(queue)}`);
        }
        if (
            sorting !== 'material-front-to-back' &&
            sorting !== 'back-to-front' &&
            sorting !== 'none'
        ) {
            throw new TypeError(`Unsupported renderer-list sorting ${String(sorting)}`);
        }
        if (
            sorting !== 'none' &&
            ((queue === 'opaque' && sorting !== 'material-front-to-back') ||
                (queue === 'transparent' && sorting !== 'back-to-front') ||
                (queue === 'all' && sorting !== 'material-front-to-back'))
        ) {
            throw new TypeError(
                `Renderer-list sorting ${sorting} is incompatible with queue ${queue}`
            );
        }
        this.handle = handle;
        this.frameIndex = frameIndex;
        this.culling = culling;
        this.ordered = false;
        this.overrideMaterial = descriptor.overrideMaterial ?? null;
        this.materialPass = descriptor.materialPass ?? 'forward';
        this.meshIdentities.clear();
        const excludedMeshes: unknown = descriptor.excludeMeshes;
        if (excludedMeshes !== undefined) {
            if (!Array.isArray(excludedMeshes)) {
                throw new TypeError('Renderer-list excludeMeshes must be an array');
            }
            for (let index = 0; index < excludedMeshes.length; index += 1) {
                const mesh: unknown = excludedMeshes[index];
                if (!(mesh instanceof Mesh)) {
                    throw new TypeError(
                        `Renderer-list excludeMeshes[${String(index)}] must be a Mesh`
                    );
                }
                this.meshIdentities.add(mesh);
            }
        }
        const selected = this.selectedMeshes;
        selected.length = 0;
        for (const mesh of culling.visibleMeshes) {
            if (this.meshIdentities.has(mesh)) continue;
            const material = this.overrideMaterial ?? mesh.material;
            if (material === null) continue;
            if (descriptor.castShadowsOnly === true && !mesh.castShadows) continue;
            if (queue === 'opaque' && material.forwardQueue !== 'opaque') continue;
            if (queue === 'transparent' && material.forwardQueue !== 'transparent') continue;
            selected.push(mesh);
        }
        this.plan = this.planner.build(
            selected,
            this.overrideMaterial,
            sorting !== 'none',
            sorting === 'none' ? null : culling.camera
        );
    }

    buildOrdered(
        handle: RendererListHandle,
        frameIndex: number,
        culling: CullingSlot,
        descriptor: Readonly<OrderedRendererListDescriptor>
    ): void {
        const meshes: unknown = descriptor.meshes;
        if (!Array.isArray(meshes)) {
            throw new TypeError('Ordered renderer-list meshes must be an array');
        }
        this.handle = handle;
        this.frameIndex = frameIndex;
        this.culling = culling;
        this.overrideMaterial = descriptor.overrideMaterial ?? null;
        this.materialPass = descriptor.materialPass ?? 'forward';
        this.ordered = true;
        this.plan = null;
        this.planner.reset();
        this.selectedMeshes.length = 0;
        this.meshIdentities.clear();
        try {
            for (let index = 0; index < meshes.length; index += 1) {
                const mesh: unknown = meshes[index];
                if (!(mesh instanceof Mesh)) {
                    throw new TypeError(
                        `Ordered renderer-list meshes[${String(index)}] must be a Mesh`
                    );
                }
                if (mesh.isDestroyed) throw new Error(`Mesh ${mesh.id} is destroyed`);
                if (mesh.geometry === null || (this.overrideMaterial ?? mesh.material) === null) {
                    throw new Error(`Mesh ${mesh.id} requires geometry and material`);
                }
                if (this.meshIdentities.has(mesh)) {
                    throw new TypeError(`Mesh ${mesh.id} appears more than once in a draw list`);
                }
                this.meshIdentities.add(mesh);
                this.selectedMeshes.push(mesh);
            }
        } finally {
            this.meshIdentities.clear();
        }
    }

    releaseFrameReferences(): void {
        this.planner.reset();
        this.selectedMeshes.length = 0;
        this.meshIdentities.clear();
        this.frameIndex = -1;
        this.culling = null;
        this.overrideMaterial = null;
        this.materialPass = 'forward';
        this.ordered = false;
        this.plan = null;
    }
}

type PipelineInvocationLease = object;

class TargetResourcesSlot {
    readonly #colors: RenderGraphTextureHandle[] = [];
    width = 1;
    height = 1;
    sampleCount: 1 | 4 = 1;
    colorAttachmentCount = 0;
    depthStencil: RenderGraphTextureHandle | null = null;

    configure(
        width: number,
        height: number,
        sampleCount: 1 | 4,
        colors: readonly RenderGraphTextureHandle[],
        depthStencil: RenderGraphTextureHandle | null
    ): void {
        this.width = width;
        this.height = height;
        this.sampleCount = sampleCount;
        this.colorAttachmentCount = colors.length;
        this.#colors.length = colors.length;
        for (let index = 0; index < colors.length; index += 1) {
            const handle = colors[index];
            if (handle !== undefined) this.#colors[index] = handle;
        }
        this.depthStencil = depthStencil;
    }

    color(index: number): RenderGraphTextureHandle {
        if (!Number.isSafeInteger(index) || index < 0 || index >= this.colorAttachmentCount) {
            throw new RangeError(`Color attachment ${String(index)} does not exist`);
        }
        const handle = this.#colors[index];
        if (handle === undefined) throw new Error('Target color attachment handle is incomplete');
        return handle;
    }
}

class TargetResourcesFacade implements RenderPipelineTargetResources {
    readonly #owner: ScriptableRenderPipelineContextImpl;
    readonly #lease: PipelineInvocationLease;
    readonly #slot: TargetResourcesSlot;

    constructor(
        owner: ScriptableRenderPipelineContextImpl,
        lease: PipelineInvocationLease,
        slot: TargetResourcesSlot
    ) {
        this.#owner = owner;
        this.#lease = lease;
        this.#slot = slot;
        Object.freeze(this);
    }

    get width(): number {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#slot.width;
    }

    get height(): number {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#slot.height;
    }

    get sampleCount(): 1 | 4 {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#slot.sampleCount;
    }

    get colorAttachmentCount(): number {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#slot.colorAttachmentCount;
    }

    get depthStencil(): RenderGraphTextureHandle | null {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#slot.depthStencil;
    }

    color(index: number): RenderGraphTextureHandle {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#slot.color(index);
    }
}

class PipelineClearColorFacade implements Readonly<RenderTargetColor> {
    readonly #owner: ScriptableRenderPipelineContextImpl;
    readonly #lease: PipelineInvocationLease;

    constructor(owner: ScriptableRenderPipelineContextImpl, lease: PipelineInvocationLease) {
        this.#owner = owner;
        this.#lease = lease;
        Object.freeze(this);
    }

    get r(): number {
        return this.#owner.readClearColorState(this.#lease).r;
    }

    get g(): number {
        return this.#owner.readClearColorState(this.#lease).g;
    }

    get b(): number {
        return this.#owner.readClearColorState(this.#lease).b;
    }

    get a(): number {
        return this.#owner.readClearColorState(this.#lease).a;
    }
}

class PipelineOutputAttachmentClearColorFacade implements Readonly<RenderTargetColor> {
    readonly #owner: ScriptableRenderPipelineContextImpl;
    readonly #lease: PipelineInvocationLease;
    readonly #index: number;

    constructor(
        owner: ScriptableRenderPipelineContextImpl,
        lease: PipelineInvocationLease,
        index: number
    ) {
        this.#owner = owner;
        this.#lease = lease;
        this.#index = index;
        Object.freeze(this);
    }

    get r(): number {
        return this.#owner.readOutputColorAttachmentState(this.#lease, this.#index).clearValue.r;
    }

    get g(): number {
        return this.#owner.readOutputColorAttachmentState(this.#lease, this.#index).clearValue.g;
    }

    get b(): number {
        return this.#owner.readOutputColorAttachmentState(this.#lease, this.#index).clearValue.b;
    }

    get a(): number {
        return this.#owner.readOutputColorAttachmentState(this.#lease, this.#index).clearValue.a;
    }
}

class PipelineOutputColorAttachmentFacade implements Readonly<RenderPipelineOutputColorAttachment> {
    readonly #clearValue: Readonly<RenderTargetColor>;
    readonly #owner: ScriptableRenderPipelineContextImpl;
    readonly #lease: PipelineInvocationLease;
    readonly #index: number;

    constructor(
        owner: ScriptableRenderPipelineContextImpl,
        lease: PipelineInvocationLease,
        index: number
    ) {
        this.#owner = owner;
        this.#lease = lease;
        this.#index = index;
        this.#clearValue = new PipelineOutputAttachmentClearColorFacade(owner, lease, index);
        Object.freeze(this);
    }

    get clearValue(): Readonly<RenderTargetColor> {
        void this.#owner.readOutputColorAttachmentState(this.#lease, this.#index);
        return this.#clearValue;
    }

    get loadOp(): RenderTargetLoadOp {
        return this.#owner.readOutputColorAttachmentState(this.#lease, this.#index).loadOp;
    }

    get storeOp(): RenderTargetStoreOp {
        return this.#owner.readOutputColorAttachmentState(this.#lease, this.#index).storeOp;
    }
}

class PipelineOutputDepthStencilAttachmentFacade implements Readonly<RenderPipelineOutputDepthStencilAttachment> {
    readonly #owner: ScriptableRenderPipelineContextImpl;
    readonly #lease: PipelineInvocationLease;

    constructor(owner: ScriptableRenderPipelineContextImpl, lease: PipelineInvocationLease) {
        this.#owner = owner;
        this.#lease = lease;
        Object.freeze(this);
    }

    get depthClearValue(): number {
        return this.#owner.readOutputDepthStencilState(this.#lease).depthClearValue;
    }

    get depthLoadOp(): RenderTargetLoadOp {
        return this.#owner.readOutputDepthStencilState(this.#lease).depthLoadOp;
    }

    get depthStoreOp(): RenderTargetStoreOp {
        return this.#owner.readOutputDepthStencilState(this.#lease).depthStoreOp;
    }

    get stencilClearValue(): number {
        return this.#owner.readOutputDepthStencilState(this.#lease).stencilClearValue;
    }

    get stencilLoadOp(): RenderTargetLoadOp {
        return this.#owner.readOutputDepthStencilState(this.#lease).stencilLoadOp;
    }

    get stencilStoreOp(): RenderTargetStoreOp {
        return this.#owner.readOutputDepthStencilState(this.#lease).stencilStoreOp;
    }
}

class PipelineOutputFacade implements RenderPipelineOutput {
    readonly #colorAttachments: PipelineOutputColorAttachmentFacade[] = [];
    readonly #depthStencilAttachment: Readonly<RenderPipelineOutputDepthStencilAttachment>;
    readonly #owner: ScriptableRenderPipelineContextImpl;
    readonly #lease: PipelineInvocationLease;

    constructor(owner: ScriptableRenderPipelineContextImpl, lease: PipelineInvocationLease) {
        this.#owner = owner;
        this.#lease = lease;
        this.#depthStencilAttachment = new PipelineOutputDepthStencilAttachmentFacade(owner, lease);
        Object.freeze(this);
    }

    get kind(): RenderPipelineOutput['kind'] {
        return this.#owner.readOutputState(this.#lease).kind;
    }

    get width(): number {
        return this.#owner.readOutputState(this.#lease).width;
    }

    get height(): number {
        return this.#owner.readOutputState(this.#lease).height;
    }

    get sampleCount(): 1 | 4 {
        return this.#owner.readOutputState(this.#lease).sampleCount;
    }

    get colorAttachmentCount(): number {
        return this.#owner.readOutputState(this.#lease).colorAttachmentCount;
    }

    get depthStencilFormat(): RenderPipelineOutput['depthStencilFormat'] {
        return this.#owner.readOutputState(this.#lease).depthStencilFormat;
    }

    get depthStencilAttachment(): Readonly<RenderPipelineOutputDepthStencilAttachment> | null {
        return this.#owner.readOutputState(this.#lease).depthStencilFormat === null
            ? null
            : this.#depthStencilAttachment;
    }

    colorFormat(index: number): RenderPipelineColorFormat {
        return this.#owner.readOutputColorFormat(this.#lease, index);
    }

    colorAttachment(index: number): Readonly<RenderPipelineOutputColorAttachment> {
        void this.#owner.readOutputColorAttachmentState(this.#lease, index);
        let facade = this.#colorAttachments[index];
        if (facade === undefined) {
            facade = new PipelineOutputColorAttachmentFacade(this.#owner, this.#lease, index);
            this.#colorAttachments[index] = facade;
        }
        return facade;
    }
}

class RenderPipelineContextLease implements RenderPipelineContext, ScriptableRenderGraph {
    readonly #viewport: RendererViewport;
    readonly #clearColor: Readonly<RenderTargetColor>;
    readonly #output: RenderPipelineOutput;
    readonly #owner: ScriptableRenderPipelineContextImpl;
    readonly #lease: PipelineInvocationLease;

    constructor(owner: ScriptableRenderPipelineContextImpl, lease: PipelineInvocationLease) {
        this.#owner = owner;
        this.#lease = lease;
        const viewport: number[] = [];
        for (let index = 0; index < 4; index += 1) {
            Object.defineProperty(viewport, index, {
                enumerable: true,
                get: (): number => this.#owner.readViewportComponent(this.#lease, index)
            });
        }
        this.#viewport = Object.freeze(viewport) as unknown as RendererViewport;
        this.#clearColor = new PipelineClearColorFacade(owner, lease);
        this.#output = new PipelineOutputFacade(owner, lease);
        Object.freeze(this);
    }

    get frameIndex(): number {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.frameIndex;
    }

    get scene(): RendererScene {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.scene;
    }

    get camera(): Camera {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.camera;
    }

    get viewport(): RendererViewport {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#viewport;
    }

    get clearColor(): Readonly<RenderTargetColor> {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#clearColor;
    }

    get output(): RenderPipelineOutput {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#output;
    }

    get capabilities(): RenderPipelineCapabilities {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.capabilities;
    }

    get useLogDepth(): boolean {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.services.renderer.useLogDepth;
    }

    get graph(): ScriptableRenderGraph {
        this.#owner.assertLeaseActive(this.#lease);
        return this;
    }

    prepareScene(): void {
        this.#owner.assertLeaseActive(this.#lease);
        this.#owner.prepareScene();
    }

    cull(options?: Readonly<CullingOptions>): CullingResultsHandle {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.cull(options);
    }

    createRendererList(descriptor: Readonly<RendererListDescriptor>): RendererListHandle {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.createRendererList(descriptor);
    }

    createOrderedRendererList(
        descriptor: Readonly<OrderedRendererListDescriptor>
    ): RendererListHandle {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.createOrderedRendererList(descriptor);
    }

    recordShadows(
        cullingResults: CullingResultsHandle,
        options?: Readonly<RenderPipelineShadowOptions>
    ): Readonly<RenderPipelineShadowResources> | null {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.recordShadows(cullingResults, options);
    }

    acquirePassParameters<P extends object>(pool: RenderPassParameterPool<P>): P {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.acquirePassParameters(pool);
    }

    writeStorageBuffer(buffer: StorageBuffer, byteOffset: number, data: ArrayBufferView): void {
        this.#owner.assertLeaseActive(this.#lease);
        this.#owner.writeStorageBuffer(buffer, byteOffset, data);
    }

    createTexture(
        name: string,
        descriptor: Readonly<RenderPipelineTextureDescriptor>
    ): RenderGraphTextureHandle {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.createTexture(name, descriptor);
    }

    createTextureView(
        name: string,
        texture: RenderGraphTextureHandle,
        descriptor: Readonly<RenderPipelineTextureViewDescriptor> = {}
    ): RenderGraphTextureViewHandle {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.createTextureView(name, texture, descriptor);
    }

    createBuffer(
        name: string,
        descriptor: Readonly<RenderPipelineBufferDescriptor>
    ): RenderGraphBufferHandle {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.createBuffer(name, descriptor);
    }

    importStorageBuffer(buffer: StorageBuffer): RenderGraphBufferHandle {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.importStorageBuffer(buffer);
    }

    importTexture(texture: Texture<unknown>): RenderGraphTextureHandle {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.importTexture(texture);
    }

    importOutput(): RenderPipelineTargetResources {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.importOutput();
    }

    importRenderTarget(target: RenderTarget): RenderPipelineTargetResources {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.importRenderTarget(target);
    }

    acquirePersistentTarget(
        key: object,
        descriptor: Readonly<RenderPipelinePersistentTargetDescriptor>
    ): RenderPipelineTargetResources {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.acquirePersistentTarget(key, descriptor);
    }

    acquireHistoryTexture(
        key: object,
        descriptor: Readonly<RenderPipelineHistoryTextureDescriptor>
    ): RenderPipelineHistoryTextureResources {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.acquireHistoryTexture(key, descriptor);
    }

    invalidateHistoryTexture(key: object): boolean {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.invalidateHistoryTexture(key);
    }

    releaseHistoryTexture(key: object): boolean {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.releaseHistoryTexture(key);
    }

    releasePersistentTarget(key: object): boolean {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.releasePersistentTarget(key);
    }

    addPass<P extends object>(pass: ScriptableRenderPass<P>, parameters: P): RenderGraphPassHandle {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.addPass(pass, parameters);
    }
}

/** @internal High-water storage behind per-invocation public pipeline leases. */
export class ScriptableRenderPipelineContextImpl implements ScriptableComputeGraphResolver {
    readonly #viewportState: [number, number, number, number] = [0, 0, 1, 1];
    readonly rhiViewport: MutableRHIViewport = {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        minDepth: 0,
        maxDepth: 1
    };
    readonly #outputState: MutablePipelineOutputState = {
        kind: 'surface',
        width: 1,
        height: 1,
        sampleCount: 1,
        colorAttachmentCount: 1,
        depthStencilFormat: null
    };
    readonly #outputColorAttachmentStates: MutablePipelineOutputColorAttachmentState[] = [];
    readonly #outputDepthStencilState: MutablePipelineOutputDepthStencilAttachmentState = {
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
        stencilClearValue: 0,
        stencilLoadOp: 'clear',
        stencilStoreOp: 'discard'
    };
    readonly #clearColorState: MutableRenderTargetColor = { r: 0, g: 0, b: 0, a: 1 };

    readonly #cullingSlots: CullingSlot[] = [];
    readonly #cullingByHandle = new Map<CullingResultsHandle, CullingSlot>();
    readonly #rendererListSlots: RendererListSlot[] = [];
    readonly #rendererListByHandle = new Map<RendererListHandle, RendererListSlot>();
    readonly #textureRecords: TextureRecord[] = [];
    readonly #textureByHandle = new Map<RenderGraphTextureHandle, TextureRecord>();
    readonly #textureViewRecords: TextureViewRecord[] = [];
    readonly #textureAccessByHandle = new Map<
        RenderGraphTextureAccessHandle,
        TextureAccessRecord
    >();
    readonly #bufferRecords: BufferRecord[] = [];
    readonly #bufferByHandle = new Map<RenderGraphBufferHandle, BufferRecord>();
    readonly #targetSlots: TargetResourcesSlot[] = [];
    readonly #passSlots: ScriptablePassSlot[] = [];
    readonly #passByHandle = new Map<RenderGraphPassHandle, RGPassHandle>();
    readonly #targetColorScratch: RenderGraphTextureHandle[] = [];
    readonly #fullscreenInputScratch: RGTextureAccessHandle[] = [];
    readonly #fullscreenUniformScratch: ResourceRegistryHandle<RHIBuffer>[] = [];
    readonly #outputColorFormats: RenderPipelineColorFormat[] = [];
    readonly #persistentTargetDescriptors: MutablePersistentTargetResourceDescriptor[] = [];
    readonly #historyFacadeByState = new Map<
        PersistentHistoryState,
        RenderPipelineHistoryTextureResources
    >();
    readonly #beforeEventMeshSet = new Set<Mesh>();
    readonly #beforeEventMeshScratch: Mesh[] = [];
    readonly #eventMeshes: Mesh[] = [];
    readonly #eventMeshSet = new Set<Mesh>();
    readonly #cleanupFailures: unknown[] = [];
    readonly #shadowExcludedMeshes = new Set<Mesh>();
    readonly #shadowDrawMeshes: Mesh[] = [];
    readonly #shadowSliceRecords: MutableRenderPipelineShadowSlice[] = [];

    #scope: RenderGraphFrameBuildScope | null = null;
    #scene: RendererScene | null = null;
    #camera: Camera | null = null;
    #target: RenderTarget | null = null;
    #fireEvent = false;
    #capabilities: RenderPipelineCapabilities | null = null;
    #runtimeOwner: object | null = null;
    #activeLease: PipelineInvocationLease | null = null;
    #cullingCursor = 0;
    #rendererListCursor = 0;
    #textureCursor = 0;
    #textureViewCursor = 0;
    #bufferCursor = 0;
    #targetSlotCursor = 0;
    #passCursor = 0;
    #persistentTargetDescriptorCursor = 0;
    #shadowPassCount = 0;
    #shadowsRecorded = false;
    #shadowCulling: CullingSlot | null = null;
    #hasTerminalWork = false;
    #active = false;
    #outputFacade: TargetResourcesFacade | null = null;
    #storageBufferBySource = new WeakMap<RendererStorageBuffer, BufferRecord>();
    #sampledTextureBySource = new WeakMap<Texture<unknown>, TextureRecord>();

    constructor(
        readonly services: ScriptableRenderPipelineServices,
        readonly resources: ScriptableRenderPipelineResources
    ) {
        Object.freeze(this);
    }

    get frameIndex(): number {
        return this.requireScope().context.frameIndex;
    }

    get scene(): RendererScene {
        this.assertActive();
        return this.requireScene();
    }

    get camera(): Camera {
        this.assertActive();
        return this.requireCamera();
    }

    get outputWidth(): number {
        this.assertActive();
        return this.#outputState.width;
    }

    get outputHeight(): number {
        this.assertActive();
        return this.#outputState.height;
    }

    get capabilities(): RenderPipelineCapabilities {
        if (this.#capabilities === null) throw new Error('Pipeline context is not active');
        return this.#capabilities;
    }

    begin(
        scene: RendererScene,
        camera: Camera,
        target: RenderTarget | null,
        fireEvent: boolean,
        capabilities: RenderPipelineCapabilities,
        runtimeOwner: object,
        scope: RenderGraphFrameBuildScope
    ): RenderPipelineContext {
        if (this.#active) throw new Error('Scriptable pipeline context is already active');
        this.#scope = scope;
        this.#scene = scene;
        this.#camera = camera;
        this.#target = target;
        this.#fireEvent = fireEvent;
        this.#capabilities = capabilities;
        this.#runtimeOwner = runtimeOwner;
        this.#cullingCursor = 0;
        this.#rendererListCursor = 0;
        this.#textureCursor = 0;
        this.#textureViewCursor = 0;
        this.#bufferCursor = 0;
        this.#targetSlotCursor = 0;
        this.#passCursor = 0;
        this.#persistentTargetDescriptorCursor = 0;
        this.#shadowPassCount = 0;
        this.#shadowsRecorded = false;
        this.#shadowCulling = null;
        this.#hasTerminalWork = false;
        this.#outputFacade = null;
        this.#beforeEventMeshSet.clear();
        this.#beforeEventMeshScratch.length = 0;
        this.#eventMeshes.length = 0;
        this.#eventMeshSet.clear();
        this.#cullingByHandle.clear();
        this.#rendererListByHandle.clear();
        this.#textureByHandle.clear();
        this.#textureAccessByHandle.clear();
        this.#historyFacadeByState.clear();
        this.#bufferByHandle.clear();
        this.#storageBufferBySource = new WeakMap();
        this.#sampledTextureBySource = new WeakMap();
        this.#passByHandle.clear();
        const rendererClearColor = this.services.renderer.clearColor;
        this.#clearColorState.r = rendererClearColor.r;
        this.#clearColorState.g = rendererClearColor.g;
        this.#clearColorState.b = rendererClearColor.b;
        this.#clearColorState.a = rendererClearColor.a;
        if (target === null) {
            const configuration = servicesConfiguration(this.services.getScriptableSurface());
            const surfacePolicy = this.services.getScriptableSurfaceFramePolicy(camera);
            this.#outputState.kind = 'surface';
            this.#outputState.width = configuration.width;
            this.#outputState.height = configuration.height;
            this.#outputState.sampleCount = surfacePolicy.sampleCount;
            this.#outputState.colorAttachmentCount = 1;
            this.#outputColorFormats.length = 1;
            this.#outputColorFormats[0] = pipelineColorFormat(configuration.format);
            this.#outputState.depthStencilFormat = pipelineDepthFormat(
                configuration.depthStencilFormat
            );
            this.configureOutputColorAttachment(
                0,
                this.#clearColorState,
                surfacePolicy.colorLoadOp,
                'store'
            );
            this.configureOutputDepthStencilAttachment(
                this.#outputState.depthStencilFormat === null
                    ? null
                    : {
                          depthClearValue: depthClearValue(camera.depthMode),
                          depthLoadOp: surfacePolicy.depthLoadOp,
                          depthStoreOp: surfacePolicy.depthStoreOp,
                          stencilClearValue: 0,
                          stencilLoadOp: surfacePolicy.stencilLoadOp,
                          stencilStoreOp: surfacePolicy.stencilStoreOp
                      }
            );
            this.setViewport(
                this.services.renderer.offsetX,
                this.services.renderer.offsetY,
                configuration.width,
                configuration.height
            );
        } else {
            const resolved = this.services.resolveScriptableRenderTarget(target);
            this.#outputState.kind = 'render-target';
            this.#outputState.width = resolved.width;
            this.#outputState.height = resolved.height;
            this.#outputState.sampleCount = resolved.sampleCount;
            this.#outputState.colorAttachmentCount = resolved.colorAttachmentCount;
            this.#outputColorFormats.length = resolved.colorFormats.length;
            const normalized = resolved.normalizedParameters;
            const normalizedDepth = normalized.depthStencilAttachment;
            if (normalizedDepth !== null && normalizedDepth.depthMode !== camera.depthMode) {
                throw new TypeError(
                    `Render target depth mode ${normalizedDepth.depthMode} does not match camera depth mode ${camera.depthMode}`
                );
            }
            for (let index = 0; index < resolved.colorFormats.length; index += 1) {
                const format = resolved.colorFormats[index];
                if (format !== undefined) this.#outputColorFormats[index] = format;
                const attachment = normalized.colorAttachments[index];
                if (attachment === undefined) {
                    throw new Error('Render-target color attachment policy is unavailable');
                }
                this.configureOutputColorAttachment(
                    index,
                    attachment.clearValue,
                    attachment.loadOp,
                    attachment.storeOp
                );
            }
            this.#outputState.depthStencilFormat = resolved.depthStencilFormat;
            this.configureOutputDepthStencilAttachment(normalizedDepth);
            this.setViewport(0, 0, resolved.width, resolved.height);
        }
        const lease = Object.freeze({});
        this.#activeLease = lease;
        this.#active = true;
        try {
            this.services.fireScriptableBeforeScene([], this.#fireEvent, true);
            return new RenderPipelineContextLease(this, lease);
        } catch (error) {
            this.end(false);
            throw error;
        }
    }

    end(completed: boolean): void {
        if (!this.#active) return;
        this.#activeLease = null;
        try {
            if (!completed) return;
            if (!this.#hasTerminalWork) {
                throw new Error(
                    'Render pipeline must write an output/persistent target or declare a side effect'
                );
            }
            if (this.#shadowPassCount > 0) {
                this.services.recordScriptablePass(this.#shadowPassCount);
            }
            this.services.queueScriptableAfterScene(this.#eventMeshes, this.#fireEvent);
            if (this.#target === null) {
                this.services.retainScriptablePresentation(
                    this.requireScene(),
                    this.requireCamera()
                );
            }
        } finally {
            this.#active = false;
            this.#scope = null;
            this.#scene = null;
            this.#camera = null;
            this.#target = null;
            this.#capabilities = null;
            this.#runtimeOwner = null;
            this.#activeLease = null;
        }
    }

    releaseFrameReferences(): void {
        const failures = this.#cleanupFailures;
        failures.length = 0;
        for (let index = 0; index < this.#passCursor; index += 1) {
            try {
                this.#passSlots[index]?.releaseFrameReferences(this.resources);
            } catch (error) {
                failures.push(error);
            }
        }
        for (let index = 0; index < this.#rendererListCursor; index += 1) {
            this.#rendererListSlots[index]?.releaseFrameReferences();
        }
        for (let index = 0; index < this.#cullingCursor; index += 1) {
            this.#cullingSlots[index]?.releaseFrameReferences();
        }
        for (let index = 0; index < this.#bufferCursor; index += 1) {
            const record = this.#bufferRecords[index];
            if (record === undefined) continue;
            record.name = '';
            record.internal = null;
            record.source = null;
            record.initialized = false;
        }
        for (let index = 0; index < this.#textureCursor; index += 1) {
            const record = this.#textureRecords[index];
            if (record === undefined) continue;
            record.name = '';
            record.attachment = null;
            record.readable = null;
            record.writable = null;
            record.resolveTarget = null;
            record.outputRoot = null;
            record.historyState = null;
            record.historyCurrent = false;
        }
        for (let index = 0; index < this.#textureViewCursor; index += 1) {
            const record = this.#textureViewRecords[index];
            if (record === undefined) continue;
            record.name = '';
            record.attachment = null;
            record.readable = null;
            record.writable = null;
            record.resolveTarget = null;
            record.outputRoot = null;
            record.historyState = null;
            record.historyCurrent = false;
        }
        this.#cullingByHandle.clear();
        this.#rendererListByHandle.clear();
        this.#textureByHandle.clear();
        this.#textureAccessByHandle.clear();
        this.#historyFacadeByState.clear();
        this.#bufferByHandle.clear();
        this.#storageBufferBySource = new WeakMap();
        this.#sampledTextureBySource = new WeakMap();
        this.#passByHandle.clear();
        this.#outputFacade = null;
        this.#beforeEventMeshSet.clear();
        this.#beforeEventMeshScratch.length = 0;
        this.#eventMeshes.length = 0;
        this.#eventMeshSet.clear();
        this.#fireEvent = false;
        if (failures.length !== 0) {
            const failure = new AggregateError(
                failures,
                'Scriptable pipeline frame references failed during cleanup',
                { cause: failures[0] }
            );
            failures.length = 0;
            throw failure;
        }
    }

    cull(options: Readonly<CullingOptions> = {}): CullingResultsHandle {
        this.assertActive();
        const camera = options.camera ?? this.camera;
        if (!(camera instanceof Camera)) throw new TypeError('Culling camera must be a Camera');
        const handle = this.allocateHandle() as CullingResultsHandle;
        let slot = this.#cullingSlots[this.#cullingCursor++];
        if (slot === undefined) {
            slot = new CullingSlot();
            this.#cullingSlots.push(slot);
        }
        this.services.prepareScriptableCullingScene(this.scene, camera);
        slot.build(
            handle,
            this.frameIndex,
            this.scene,
            camera,
            this.services.lightManager,
            this.services.renderer.useInstanced,
            options.frustumCulling ?? true
        );
        this.#cullingByHandle.set(handle, slot);
        return handle;
    }

    prepareScene(): void {
        this.assertActive();
        this.services.prepareScriptableCullingScene(this.scene, this.camera);
    }

    createRendererList(descriptor: Readonly<RendererListDescriptor>): RendererListHandle {
        this.assertActive();
        const culling = this.requireCulling(descriptor.cullingResults);
        const handle = this.allocateHandle() as RendererListHandle;
        let slot = this.#rendererListSlots[this.#rendererListCursor++];
        if (slot === undefined) {
            slot = new RendererListSlot();
            this.#rendererListSlots.push(slot);
        }
        slot.build(handle, this.frameIndex, culling, descriptor);
        this.#rendererListByHandle.set(handle, slot);
        return handle;
    }

    createOrderedRendererList(
        descriptor: Readonly<OrderedRendererListDescriptor>
    ): RendererListHandle {
        this.assertActive();
        const culling = this.requireCulling(descriptor.cullingResults);
        const handle = this.allocateHandle() as RendererListHandle;
        let slot = this.#rendererListSlots[this.#rendererListCursor++];
        if (slot === undefined) {
            slot = new RendererListSlot();
            this.#rendererListSlots.push(slot);
        }
        slot.buildOrdered(handle, this.frameIndex, culling, descriptor);
        this.#rendererListByHandle.set(handle, slot);
        return handle;
    }

    recordShadows(
        cullingResults: CullingResultsHandle,
        options: Readonly<RenderPipelineShadowOptions> = {}
    ): Readonly<RenderPipelineShadowResources> | null {
        this.assertActive();
        if (this.#shadowsRecorded) {
            throw new Error('A pipeline invocation can record the shared shadow atlas only once');
        }
        this.#shadowsRecorded = true;
        const culling = this.requireCulling(cullingResults);
        for (let index = 0; index < this.#cullingCursor; index += 1) {
            const used = this.#cullingSlots[index];
            if (used?.used === true && used !== culling) {
                throw new Error(
                    'Shadow recording and scene draws must use the same culling results'
                );
            }
        }
        this.#shadowCulling = culling;
        const camera = culling.activate(this.services);
        this.#shadowExcludedMeshes.clear();
        const excludedMeshes: unknown = options.excludeMeshes;
        if (excludedMeshes !== undefined) {
            if (!Array.isArray(excludedMeshes)) {
                throw new TypeError('Shadow excludeMeshes must be an array');
            }
            for (let index = 0; index < excludedMeshes.length; index += 1) {
                const mesh: unknown = excludedMeshes[index];
                if (!(mesh instanceof Mesh)) {
                    throw new TypeError(`Shadow excludeMeshes[${String(index)}] must be a Mesh`);
                }
                this.#shadowExcludedMeshes.add(mesh);
            }
        }
        this.#shadowDrawMeshes.length = 0;
        for (const mesh of culling.visibleMeshes) {
            if (!this.#shadowExcludedMeshes.has(mesh)) this.#shadowDrawMeshes.push(mesh);
        }
        const shadowBuild = this.services.recordScriptableShadows(
            this.#shadowDrawMeshes,
            culling.visibleMeshes,
            camera,
            this.rhiViewport,
            this.#outputState.width,
            this.#outputState.height
        );
        if (shadowBuild === null) return null;
        this.#shadowPassCount += shadowBuild.passCount;
        const atlas = shadowBuild.atlas;
        const atlasHandle = this.acquireTextureRecord({
            name: 'Shared shadow atlas',
            format: atlas.format,
            width: atlas.width,
            height: atlas.height,
            depthOrArrayLayers: atlas.textureDescriptor.size.depthOrArrayLayers,
            sampleCount: 1,
            mipLevelCount: atlas.textureDescriptor.mipLevelCount,
            textureDimension: atlas.textureDescriptor.dimension,
            viewDimension: atlas.textureDescriptor.viewDimension,
            viewFormats: atlas.textureDescriptor.viewFormats,
            attachment: shadowBuild.texture,
            readable: shadowBuild.texture,
            writable: null,
            resolveTarget: null,
            outputRoot: null,
            transient: false,
            historyState: null,
            historyCurrent: false
        }).handle;
        const block = shadowBuild.plan.lightBlock;
        const manager = this.services.lightManager;
        this.#shadowSliceRecords.length = shadowBuild.plan.slices.length;
        for (let index = 0; index < shadowBuild.plan.slices.length; index += 1) {
            const slice = shadowBuild.plan.slices[index];
            if (slice === undefined) throw new Error('Shadow slice metadata is incomplete');
            let record = this.#shadowSliceRecords[index];
            if (record === undefined) {
                record = {
                    kind: 'directional',
                    sliceIndex: 0,
                    physicalIndex: 0,
                    face: null,
                    cascade: null,
                    viewport: [0, 0, 0, 0],
                    viewProjectionMatrix: new Float32Array(16),
                    near: 0,
                    far: 0,
                    dirty: false
                };
                this.#shadowSliceRecords[index] = record;
            }
            record.kind = slice.kind;
            record.sliceIndex = slice.sliceIndex;
            record.physicalIndex = slice.physicalIndex;
            record.face = slice.face;
            record.cascade = slice.cascade;
            record.viewport[0] = slice.viewport.x;
            record.viewport[1] = slice.viewport.y;
            record.viewport[2] = slice.viewport.width;
            record.viewport[3] = slice.viewport.height;
            record.viewProjectionMatrix.set(slice.viewProjectionMatrix.elements);
            record.near = slice.near;
            record.far = slice.far;
            record.dirty = shadowBuild.dirtySlices[index] === true;
        }
        return Object.freeze({
            atlas: atlasHandle,
            atlasSize: block.atlasSize,
            atlasRects: block.atlasRects,
            depthMode: atlas.depthMode,
            directionalLights: manager.directionalLights,
            spotLights: manager.spotLights,
            pointLights: manager.pointLights,
            directionalShadowCount: block.directionalShadowCount,
            spotShadowCount: block.spotShadowCount,
            pointShadowCount: block.pointShadowCount,
            directionalBiases: block.directionalBiases,
            directionalCascadeSplits: block.directionalCascadeSplits,
            directionalCascadeParams: block.directionalCascadeParams,
            directionalCascadeMatrices: block.directionalCascadeMatrices,
            spotBiases: block.spotBiases,
            spotMatrices: block.spotMatrices,
            pointBiases: block.pointBiases,
            pointMatrices: block.pointMatrices,
            slices: this.#shadowSliceRecords,
            pageRegions: shadowBuild.pageRegions
        });
    }

    acquirePassParameters<P extends object>(pool: RenderPassParameterPool<P>): P {
        this.assertActive();
        const owner = this.#runtimeOwner;
        if (owner === null) throw new Error('Pipeline runtime owner is unavailable');
        return acquireRenderPassParameters(pool, owner, this.frameIndex);
    }

    writeStorageBuffer(buffer: StorageBuffer, byteOffset: number, data: ArrayBufferView): void {
        this.assertActive();
        if (!ArrayBuffer.isView(data)) {
            throw new TypeError('RenderPipeline storage-buffer data must be an ArrayBufferView');
        }
        const source = this.services.resolveScriptableStorageBuffer(buffer);
        if (this.#storageBufferBySource.has(source)) {
            throw new Error(
                'RenderPipeline storage-buffer writes must occur before the buffer is imported'
            );
        }
        source.writeFromRenderPipeline(byteOffset, data);
    }

    createTexture(
        name: string,
        descriptor: Readonly<RenderPipelineTextureDescriptor>
    ): RenderGraphTextureHandle {
        this.assertActive();
        if (typeof name !== 'string' || name.length === 0) {
            throw new TypeError('Render graph texture name must be non-empty');
        }
        const extent = this.resolveExtent(descriptor.extent);
        const sampleCount: unknown = descriptor.sampleCount ?? 1;
        if (sampleCount !== 1 && sampleCount !== 4) {
            throw new RangeError('Render graph texture sample count must be one or four');
        }
        const mipLevelCount = positiveInteger(
            descriptor.mipLevelCount ?? 1,
            'Render graph texture mipLevelCount'
        );
        if (sampleCount > 1 && mipLevelCount !== 1) {
            throw new RangeError('Multisampled render graph textures require one mip level');
        }
        const depthOrArrayLayers = positiveInteger(
            descriptor.depthOrArrayLayers ?? 1,
            'Render graph texture depthOrArrayLayers'
        );
        const dimension = descriptor.dimension ?? '2d';
        const viewDimension =
            descriptor.viewDimension ??
            (dimension === '1d'
                ? '1d'
                : dimension === '3d'
                  ? '3d'
                  : depthOrArrayLayers === 1
                    ? '2d'
                    : '2d-array');
        return this.acquireTextureRecord({
            name,
            format: descriptor.format,
            width: extent.width,
            height: extent.height,
            depthOrArrayLayers,
            sampleCount,
            mipLevelCount,
            textureDimension: dimension,
            viewDimension,
            viewFormats: Object.freeze([...(descriptor.viewFormats ?? [])]),
            attachment: null,
            readable: null,
            writable: null,
            resolveTarget: null,
            outputRoot: null,
            transient: true,
            historyState: null,
            historyCurrent: false
        }).handle;
    }

    createTextureView(
        name: string,
        texture: RenderGraphTextureHandle,
        descriptor: Readonly<RenderPipelineTextureViewDescriptor> = {}
    ): RenderGraphTextureViewHandle {
        this.assertActive();
        if (typeof name !== 'string' || name.length === 0) {
            throw new TypeError('Render graph texture view name must be non-empty');
        }
        const parent = this.#textureByHandle.get(texture);
        if (parent === undefined) {
            throw new Error(`Render graph texture handle ${String(texture)} is stale or invalid`);
        }
        const normalizedTexture = normalizeRHITextureDescriptor(
            {
                label: parent.name,
                lifetime: parent.transient ? 'transient' : 'persistent',
                size: {
                    width: parent.width,
                    height: parent.height,
                    depthOrArrayLayers: parent.depthOrArrayLayers
                },
                mipLevelCount: parent.mipLevelCount,
                sampleCount: parent.sampleCount,
                dimension: parent.textureDimension,
                viewDimension: parent.viewDimension,
                format: parent.format,
                usage: RHITextureUsage.COPY_SRC,
                viewFormats: parent.viewFormats
            },
            this.services.getScriptableMeshProcessor().registry.deviceCapabilities
        );
        const view = normalizeRHITextureViewDescriptorForTextureDescriptor(
            normalizedTexture,
            descriptor
        );
        const mipScale = 2 ** view.baseMipLevel;
        return this.acquireTextureViewRecord({
            name,
            texture: parent,
            descriptor: view,
            format: view.format,
            width: Math.max(1, Math.floor(parent.width / mipScale)),
            height: Math.max(1, Math.floor(parent.height / mipScale)),
            depthOrArrayLayers:
                parent.textureDimension === '3d'
                    ? Math.max(1, Math.floor(parent.depthOrArrayLayers / mipScale))
                    : view.arrayLayerCount,
            sampleCount: parent.sampleCount,
            mipLevelCount: view.mipLevelCount,
            textureDimension: parent.textureDimension,
            attachment: null,
            readable: null,
            writable: null,
            resolveTarget: null,
            outputRoot: parent.outputRoot,
            transient: parent.transient,
            historyState: parent.historyState,
            historyCurrent: parent.historyCurrent
        }).handle;
    }

    createBuffer(
        name: string,
        descriptor: Readonly<RenderPipelineBufferDescriptor>
    ): RenderGraphBufferHandle {
        this.assertActive();
        if (typeof name !== 'string' || name.length === 0) {
            throw new TypeError('Render graph buffer name must be non-empty');
        }
        if (!Number.isSafeInteger(descriptor.byteLength) || descriptor.byteLength < 1) {
            throw new RangeError('Render graph buffer byteLength must be a positive safe integer');
        }
        if (descriptor.label !== undefined && typeof descriptor.label !== 'string') {
            throw new TypeError('Render graph buffer label must be a string');
        }
        return this.acquireBufferRecord({
            name: descriptor.label ?? name,
            byteLength: descriptor.byteLength,
            internal: null,
            source: null,
            transient: true,
            initialized: false
        }).handle;
    }

    importStorageBuffer(buffer: StorageBuffer): RenderGraphBufferHandle {
        this.assertActive();
        const source = this.services.resolveScriptableStorageBuffer(buffer);
        const existing = this.#storageBufferBySource.get(source);
        if (existing !== undefined) return existing.handle;
        const cache = this.services.getScriptableStorageBufferResources();
        const resource = cache.prepare(source);
        const initialized = cache.isInitializedAtFrameStart(source);
        const internal = this.requireScope().graph.importBuffer(
            source.label,
            resource,
            initialized
        );
        this.requireScope().graph.markOutput(internal);
        const record = this.acquireBufferRecord({
            name: source.label,
            byteLength: source.byteLength,
            internal,
            source,
            transient: false,
            initialized
        });
        this.#storageBufferBySource.set(source, record);
        return record.handle;
    }

    importTexture(texture: Texture<unknown>): RenderGraphTextureHandle {
        this.assertActive();
        if (!(texture instanceof Texture)) {
            throw new TypeError('RenderPipeline texture import requires a Texture');
        }
        const existing = this.#sampledTextureBySource.get(texture);
        if (existing !== undefined) return existing.handle;
        const processor = this.services.getScriptableMeshProcessor();
        const handles = processor.textures.prepare(texture);
        const resource = processor.registry.resolve(handles.texture);
        const descriptor = resource.descriptor;
        if (descriptor.sampleCount !== 1) {
            throw new RangeError('RenderPipeline sampled Texture imports must be single-sample');
        }
        const internal = this.requireScope().graph.importTextureProvider(
            texture.name || texture.id,
            descriptor,
            () => processor.registry.resolve(handles.texture),
            'persistent',
            true
        );
        const record = this.acquireTextureRecord({
            name: texture.name || texture.id,
            format: descriptor.format,
            width: descriptor.size.width,
            height: descriptor.size.height,
            depthOrArrayLayers: descriptor.size.depthOrArrayLayers,
            sampleCount: 1,
            mipLevelCount: descriptor.mipLevelCount,
            textureDimension: descriptor.dimension,
            viewDimension: descriptor.viewDimension,
            viewFormats: descriptor.viewFormats,
            attachment: null,
            readable: internal,
            writable: null,
            resolveTarget: null,
            outputRoot: null,
            transient: false,
            historyState: null,
            historyCurrent: false
        });
        this.#sampledTextureBySource.set(texture, record);
        return record.handle;
    }

    importOutput(): RenderPipelineTargetResources {
        this.assertActive();
        if (this.#outputFacade !== null) return this.#outputFacade;
        const target = this.#target;
        const facade =
            target === null
                ? this.importSurfaceOutput()
                : this.importTarget(this.services.resolveScriptableRenderTarget(target));
        this.#outputFacade = facade;
        return facade;
    }

    importRenderTarget(target: RenderTarget): RenderPipelineTargetResources {
        this.assertActive();
        return this.importTarget(this.services.resolveScriptableRenderTarget(target));
    }

    acquirePersistentTarget(
        key: object,
        descriptor: Readonly<RenderPipelinePersistentTargetDescriptor>
    ): RenderPipelineTargetResources {
        this.assertActive();
        const runtimeOwner = this.#runtimeOwner;
        if (runtimeOwner === null) throw new Error('Pipeline runtime owner is unavailable');
        const extent = this.resolveExtent(descriptor.extent);
        const targetResources = this.services.getScriptableTargetResources();
        let targetDescriptor =
            this.#persistentTargetDescriptors[this.#persistentTargetDescriptorCursor++];
        if (targetDescriptor === undefined) {
            targetDescriptor = createPersistentTargetResourceDescriptor();
            this.#persistentTargetDescriptors.push(targetDescriptor);
        }
        if (descriptor.label === undefined) delete targetDescriptor.label;
        else targetDescriptor.label = descriptor.label;
        targetDescriptor.width = extent.width;
        targetDescriptor.height = extent.height;
        targetDescriptor.colorFormats.length = descriptor.colorFormats.length;
        for (let index = 0; index < descriptor.colorFormats.length; index += 1) {
            const format = descriptor.colorFormats[index];
            if (format === undefined) {
                throw new TypeError('Persistent target color format array must not be sparse');
            }
            targetDescriptor.colorFormats[index] = format;
        }
        targetDescriptor.sampleCount = descriptor.sampleCount ?? 1;
        targetDescriptor.depthStencilFormat = descriptor.depthStencilFormat ?? null;
        targetDescriptor.depthStencilSampled = descriptor.depthStencilSampled ?? false;
        const record = this.resources.preparePersistentTarget(
            runtimeOwner,
            key,
            this.frameIndex,
            targetResources,
            targetDescriptor
        );
        this.services.markScriptableTargetUsed(record);
        return this.importTargetRecord(record);
    }

    releasePersistentTarget(key: object): boolean {
        this.assertActive();
        const runtimeOwner = this.#runtimeOwner;
        if (runtimeOwner === null) throw new Error('Pipeline runtime owner is unavailable');
        return this.resources.releasePersistentTarget(runtimeOwner, key);
    }

    acquireHistoryTexture(
        key: object,
        descriptor: Readonly<RenderPipelineHistoryTextureDescriptor>
    ): RenderPipelineHistoryTextureResources {
        this.assertActive();
        const runtimeOwner = this.#runtimeOwner;
        if (runtimeOwner === null) throw new Error('Pipeline runtime owner is unavailable');
        const extent = this.resolveExtent(descriptor.extent);
        const usage = historyTextureUsage(descriptor.usage);
        const bufferCount = historyTextureBufferCount(descriptor.bufferCount ?? 2);
        const normalized = normalizeRHITextureDescriptor(
            {
                label: descriptor.label ?? 'Scriptable history texture',
                lifetime: 'persistent',
                size: {
                    width: extent.width,
                    height: extent.height,
                    depthOrArrayLayers: descriptor.depthOrArrayLayers ?? 1
                },
                mipLevelCount: descriptor.mipLevelCount ?? 1,
                sampleCount: descriptor.sampleCount ?? 1,
                dimension: descriptor.dimension ?? '2d',
                ...(descriptor.viewDimension === undefined
                    ? {}
                    : { viewDimension: descriptor.viewDimension }),
                format: descriptor.format,
                usage,
                viewFormats: descriptor.viewFormats ?? []
            },
            this.services.getScriptableMeshProcessor().registry.deviceCapabilities
        );
        if (
            normalized.dimension !== '2d' ||
            normalized.viewDimension !== '2d' ||
            normalized.size.depthOrArrayLayers !== 1 ||
            normalized.mipLevelCount !== 1 ||
            normalized.sampleCount !== 1 ||
            rhiTextureFormatHasDepth(normalized.format) ||
            rhiTextureFormatHasStencil(normalized.format)
        ) {
            throw new RangeError(
                'History textures currently require one single-sample 2D color mip and array layer'
            );
        }
        const recipe: Readonly<HistoryTextureRecipe> = {
            label: normalized.label,
            width: normalized.size.width,
            height: normalized.size.height,
            depthOrArrayLayers: normalized.size.depthOrArrayLayers,
            mipLevelCount: normalized.mipLevelCount,
            sampleCount: normalized.sampleCount,
            dimension: normalized.dimension,
            viewDimension: normalized.viewDimension,
            format: normalized.format,
            usage: normalized.usage,
            viewFormats: normalized.viewFormats,
            bufferCount
        };
        const registry = this.services.getScriptableMeshProcessor().registry;
        const prepared = this.resources.prepareHistoryTexture(
            runtimeOwner,
            key,
            this.frameIndex,
            registry,
            recipe
        );
        const existing = this.#historyFacadeByState.get(prepared.state);
        if (existing !== undefined) return existing;
        const graph = this.requireScope().graph;
        const publicHandles: RenderGraphTextureHandle[] = [];
        for (let index = 0; index < prepared.handles.length; index += 1) {
            const registryHandle = prepared.handles[index];
            if (registryHandle === undefined) {
                throw new Error('History texture registry handle is incomplete');
            }
            const internal = graph.importTextureProvider(
                `${recipe.label} [${String(index)}]`,
                {
                    label: `${recipe.label} [${String(index)}]`,
                    size: {
                        width: recipe.width,
                        height: recipe.height,
                        depthOrArrayLayers: recipe.depthOrArrayLayers
                    },
                    mipLevelCount: recipe.mipLevelCount,
                    sampleCount: recipe.sampleCount,
                    dimension: recipe.dimension,
                    viewDimension: recipe.viewDimension,
                    format: recipe.format,
                    usage: recipe.usage,
                    viewFormats: recipe.viewFormats
                },
                () => registry.resolve(registryHandle),
                'persistent',
                prepared.initialized[index] ?? false
            );
            const current = index === prepared.writeIndex;
            publicHandles[index] = this.acquireTextureRecord({
                name: `${recipe.label} [${String(index)}]`,
                format: recipe.format,
                width: recipe.width,
                height: recipe.height,
                depthOrArrayLayers: recipe.depthOrArrayLayers,
                sampleCount: recipe.sampleCount,
                mipLevelCount: recipe.mipLevelCount,
                textureDimension: recipe.dimension,
                viewDimension: recipe.viewDimension,
                viewFormats: recipe.viewFormats,
                attachment: internal,
                readable: internal,
                writable: internal,
                resolveTarget: null,
                outputRoot: current ? internal : null,
                transient: false,
                historyState: prepared.state,
                historyCurrent: current
            }).handle;
        }
        const historyIndices: number[] = [];
        for (let index = 0; index < bufferCount - 1; index += 1) {
            historyIndices.push((prepared.writeIndex - 1 - index + bufferCount * 2) % bufferCount);
        }
        const previousIndex = historyIndices[0];
        const currentHandle = publicHandles[prepared.writeIndex];
        if (currentHandle === undefined)
            throw new Error('History texture current slot is incomplete');
        const result: RenderPipelineHistoryTextureResources = Object.freeze({
            current: currentHandle,
            valid: previousIndex !== undefined && prepared.initialized[previousIndex] === true,
            generation: prepared.generation,
            historyCount: historyIndices.length,
            history(index = 0): RenderGraphTextureHandle {
                if (!Number.isSafeInteger(index) || index < 0 || index >= historyIndices.length) {
                    throw new RangeError(`History texture index ${String(index)} does not exist`);
                }
                const slot = historyIndices[index];
                const handle = slot === undefined ? undefined : publicHandles[slot];
                if (handle === undefined) throw new Error('History texture slot is incomplete');
                return handle;
            }
        });
        this.#historyFacadeByState.set(prepared.state, result);
        return result;
    }

    invalidateHistoryTexture(key: object): boolean {
        this.assertActive();
        const runtimeOwner = this.#runtimeOwner;
        if (runtimeOwner === null) throw new Error('Pipeline runtime owner is unavailable');
        return this.resources.invalidateHistoryTexture(runtimeOwner, key);
    }

    releaseHistoryTexture(key: object): boolean {
        this.assertActive();
        const runtimeOwner = this.#runtimeOwner;
        if (runtimeOwner === null) throw new Error('Pipeline runtime owner is unavailable');
        return this.resources.releaseHistoryTexture(runtimeOwner, key);
    }

    addPass<P extends object>(pass: ScriptableRenderPass<P>, parameters: P): RenderGraphPassHandle {
        this.assertActive();
        const passCandidate: unknown = pass;
        if (
            (typeof passCandidate !== 'object' && typeof passCandidate !== 'function') ||
            passCandidate === null
        ) {
            throw new TypeError('Scriptable render pass must be an object');
        }
        if (typeof pass.name !== 'string' || pass.name.length === 0) {
            throw new TypeError('Scriptable render pass name must be non-empty');
        }
        if (typeof pass.setup !== 'function' || typeof pass.execute !== 'function') {
            throw new TypeError('Scriptable render pass must implement setup() and execute()');
        }
        const parameterCandidate: unknown = parameters;
        if (
            (typeof parameterCandidate !== 'object' && typeof parameterCandidate !== 'function') ||
            parameterCandidate === null
        ) {
            throw new TypeError('Scriptable render pass parameters must be an object');
        }
        const publicHandle = this.allocateHandle() as RenderGraphPassHandle;
        let slot = this.#passSlots[this.#passCursor++];
        if (slot === undefined) {
            slot = new ScriptablePassSlot();
            this.#passSlots.push(slot);
        }
        slot.begin(this, pass, parameters, this.capabilities);
        const internal = this.requireScope().graph.addPass(slot.template, slot);
        slot.commitSetupState();
        this.#passByHandle.set(publicHandle, internal);
        return publicHandle;
    }

    assertLeaseActive(lease: PipelineInvocationLease): void {
        if (!this.#active || this.#activeLease !== lease) {
            throw new Error('RenderPipelineContext is valid only during synchronous record()');
        }
    }

    requireRendererList(handle: RendererListHandle): RendererListSlot {
        const slot = this.#rendererListByHandle.get(handle);
        if (slot?.frameIndex !== this.frameIndex) {
            throw new Error(`Renderer list handle ${String(handle)} is stale or invalid`);
        }
        return slot;
    }

    resolvePass(handle: RenderGraphPassHandle): RGPassHandle {
        const pass = this.#passByHandle.get(handle);
        if (pass === undefined) {
            throw new Error(`Render graph pass handle ${String(handle)} is stale or invalid`);
        }
        return pass;
    }

    requireTexture(handle: RenderGraphTextureAccessHandle): TextureAccessRecord {
        const record = this.#textureAccessByHandle.get(handle);
        if (record === undefined) {
            throw new Error(`Render graph texture handle ${String(handle)} is stale or invalid`);
        }
        return record;
    }

    requireBuffer(handle: RenderGraphBufferHandle): BufferRecord {
        const record = this.#bufferByHandle.get(handle);
        if (record === undefined) {
            throw new Error(`Render graph buffer handle ${String(handle)} is stale or invalid`);
        }
        return record;
    }

    bufferByteLength(handle: RenderGraphBufferHandle): number {
        return this.requireBuffer(handle).byteLength;
    }

    resolveBuffer(
        handle: RenderGraphBufferHandle,
        use: RenderGraphBufferReadUse | RenderGraphBufferWriteUse
    ): RGBufferHandle {
        const record = this.requireBuffer(handle);
        const usage = graphBufferUsage(use);
        let internal = record.internal;
        if (internal === null) {
            if (!record.transient) {
                throw new Error(`${record.name} does not support requested buffer access`);
            }
            const descriptor = record.graphDescriptor;
            descriptor.label = record.name;
            descriptor.size = record.byteLength;
            descriptor.usage = usage;
            internal = this.requireScope().graph.createBuffer(record.name, descriptor);
            record.internal = internal;
        } else this.requireScope().graph.addBufferUsage(internal, usage);
        return internal;
    }

    resolveTexture(
        handle: RenderGraphTextureAccessHandle,
        access: TextureAccess
    ): RGTextureAccessHandle {
        const record = this.requireTexture(handle);
        if (
            access === 'storage-write' &&
            (record.sampleCount !== 1 || record.mipLevelCount !== 1)
        ) {
            throw new RangeError(
                `${record.name} storage writes require one complete single-sample 2d mip subresource or one explicit single-mip view`
            );
        }
        if (record.kind === 'texture-view') {
            let internal =
                access === 'attachment'
                    ? record.attachment
                    : access === 'sampled' || access === 'copy-source'
                      ? record.readable
                      : record.writable;
            if (internal !== null) return internal;
            const parent = this.resolvePhysicalTexture(record.texture, access);
            internal = this.requireScope().graph.createTextureView(
                record.name,
                parent,
                record.descriptor
            );
            if (access === 'attachment') record.attachment = internal;
            else if (access === 'sampled' || access === 'copy-source') {
                record.readable = internal;
            } else record.writable = internal;
            return internal;
        }
        return this.resolvePhysicalTexture(record, access);
    }

    private resolvePhysicalTexture(record: TextureRecord, access: TextureAccess): RGTextureHandle {
        const usage =
            access === 'attachment' || access === 'resolve-target'
                ? RHITextureUsage.RENDER_ATTACHMENT
                : access === 'sampled'
                  ? RHITextureUsage.TEXTURE_BINDING
                  : access === 'storage-write'
                    ? RHITextureUsage.STORAGE_BINDING
                    : access === 'copy-source'
                      ? RHITextureUsage.COPY_SRC
                      : RHITextureUsage.COPY_DST;
        let internal =
            access === 'attachment'
                ? record.attachment
                : access === 'sampled' || access === 'copy-source'
                  ? record.readable
                  : record.writable;
        if (internal === null) {
            if (!record.transient) {
                throw new Error(`${record.name} does not support requested texture access`);
            }
            const descriptor = record.graphDescriptor;
            descriptor.label = record.name;
            descriptor.size.width = record.width;
            descriptor.size.height = record.height;
            descriptor.size.depthOrArrayLayers = record.depthOrArrayLayers;
            descriptor.mipLevelCount = record.mipLevelCount;
            descriptor.sampleCount = record.sampleCount;
            descriptor.dimension = record.textureDimension;
            descriptor.viewDimension = record.viewDimension;
            descriptor.format = record.format;
            descriptor.usage = usage;
            descriptor.viewFormats.length = record.viewFormats.length;
            for (let index = 0; index < record.viewFormats.length; index += 1) {
                const format = record.viewFormats[index];
                if (format !== undefined) descriptor.viewFormats[index] = format;
            }
            internal = this.requireScope().graph.createTexture(record.name, descriptor);
            record.attachment ??= internal;
            record.readable ??= internal;
            record.writable ??= internal;
        } else this.requireScope().graph.addTextureUsage(internal, usage);
        return internal;
    }

    noteTextureWrite(handle: RenderGraphTextureAccessHandle): void {
        const record = this.requireTexture(handle);
        if (record.historyCurrent && record.historyState !== null) {
            const output = record.outputRoot;
            if (output === null) throw new Error('History texture current slot has no graph root');
            this.resources.noteHistoryTextureWrite(record.historyState, output);
            this.requireScope().graph.markOutput(output);
            this.#hasTerminalWork = true;
        } else if (record.historyState !== null) {
            throw new Error('Only the current history texture slot may be written');
        } else if (record.outputRoot !== null) this.#hasTerminalWork = true;
    }

    noteBufferWrite(record: BufferRecord, internal: RGBufferHandle): void {
        if (record.source === null) return;
        if (record.internal !== internal) {
            throw new Error('Imported StorageBuffer graph identity is inconsistent');
        }
        this.#hasTerminalWork = true;
    }

    noteSideEffect(): void {
        this.#hasTerminalWork = true;
    }

    passAttachmentDimensions(
        attachments: ReadonlySet<RenderGraphTextureAccessHandle>
    ): Readonly<{ width: number; height: number }> {
        let width = 0;
        let height = 0;
        for (const handle of attachments) {
            const record = this.requireTexture(handle);
            if (width === 0) {
                width = record.width;
                height = record.height;
            } else if (record.width !== width || record.height !== height) {
                throw new Error('Scriptable pass attachments require matching dimensions');
            }
        }
        if (width === 0 || height === 0) throw new Error('Scriptable pass has no attachments');
        return { width, height };
    }

    appendRendererListDraws(
        handle: RendererListHandle,
        drawPass: SharedDrawPassParameters,
        viewport: Readonly<RHIViewport>,
        target: RHIMeshDrawTargetDescriptor,
        storageVariant: Readonly<SceneStorageShaderVariant> | null,
        storagePreparation: StorageScenePreparationState,
        sceneTexturePreparation: SceneTexturePreparationState | null
    ): void {
        const list = this.requireRendererList(handle);
        const culling = list.culling;
        const plan = list.plan;
        const firstItems = list.ordered ? list.selectedMeshes : plan?.opaqueItems;
        const remainingItems = plan?.transparentItems ?? EMPTY_MESHES;
        if (culling === null || firstItems === undefined) {
            throw new Error('Renderer list is incomplete');
        }
        if (this.#shadowCulling !== null && this.#shadowCulling !== culling) {
            throw new Error('Shadow recording and scene draws must use the same culling results');
        }
        const camera = culling.activate(this.services);
        culling.used = true;
        const beforeEventMeshes = this.#beforeEventMeshScratch;
        beforeEventMeshes.length = 0;
        if (this.#fireEvent) {
            for (const mesh of list.selectedMeshes) {
                if (this.#beforeEventMeshSet.has(mesh)) continue;
                this.#beforeEventMeshSet.add(mesh);
                beforeEventMeshes.push(mesh);
            }
        }
        this.services.fireScriptableBeforeScene(beforeEventMeshes, this.#fireEvent, false);
        const context = this.services.createScriptableFrameContext(
            camera,
            viewport,
            this.frameIndex
        );
        this.services.beginScriptableMeshPass(context);
        const processor = this.services.getScriptableMeshProcessor();
        const storagePipelines = this.services.getScriptableGPUDrivenPipelineResources();
        if (storageVariant !== null && list.materialPass !== 'forward') {
            throw new TypeError(
                `Storage scene draws do not support material pass ${list.materialPass}`
            );
        }
        const storageShader = (mesh: Mesh): StorageGraphicsShader => {
            if (storageVariant === null) {
                throw new Error('Scene storage shader variant is unavailable');
            }
            return storageVariant.shaderByMesh?.get(mesh) ?? storageVariant.shader;
        };
        for (let group = 0; group < 2; group += 1) {
            const items = group === 0 ? firstItems : remainingItems;
            for (const item of items) {
                if (item instanceof Mesh) {
                    drawPass.addDrawSnapshot(
                        storageVariant === null
                            ? processor.prepare(
                                  item,
                                  target,
                                  list.overrideMaterial,
                                  sceneTexturePreparation,
                                  list.materialPass,
                                  list.ordered
                              )
                            : processor.prepareStorageScene(
                                  item,
                                  target,
                                  storageShader(item),
                                  storagePipelines,
                                  storagePreparation,
                                  list.overrideMaterial,
                                  list.ordered
                              )
                    );
                    continue;
                }
                if (storageVariant === null) {
                    drawPass.addDrawSnapshot(
                        processor.prepareInstancedBatch(
                            item,
                            item.meshes,
                            target,
                            list.overrideMaterial,
                            sceneTexturePreparation,
                            list.materialPass
                        )
                    );
                    continue;
                }
                for (const mesh of item.meshes) {
                    drawPass.addDrawSnapshot(
                        processor.prepareStorageScene(
                            mesh,
                            target,
                            storageShader(mesh),
                            storagePipelines,
                            storagePreparation,
                            list.overrideMaterial,
                            true
                        )
                    );
                }
            }
        }
        this.services
            .getScriptableTargetBridge()
            .addSampledTextureReads(
                this.requireScope().graph,
                drawPass,
                processor.sampledGraphDependencies
            );
    }

    recordRendererListDraw(handle: RendererListHandle): void {
        const list = this.#rendererListByHandle.get(handle);
        if (list === undefined) {
            throw new Error(`Renderer list handle ${String(handle)} is stale or invalid`);
        }
        this.services.recordScriptableFaces(list.selectedMeshes);
        for (const mesh of list.selectedMeshes) {
            if (this.#fireEvent && !this.#eventMeshSet.has(mesh)) {
                this.#eventMeshSet.add(mesh);
                this.#eventMeshes.push(mesh);
            }
        }
    }

    configureFullscreenDraw(
        retained: ScriptableFullscreenDraw | null,
        pass: FullscreenRenderPass,
        parameters: FullscreenRenderPassParameters,
        target: RHIMeshDrawTargetDescriptor,
        declaredInputs: ReadonlyMap<RenderGraphTextureAccessHandle, RGTextureAccessHandle>
    ): ScriptableFullscreenDraw {
        const context = this.services.createScriptableFrameContext(
            this.camera,
            this.rhiViewport,
            this.frameIndex
        );
        this.services.beginScriptableResourcePass(context);
        this.services.beginScriptableFullscreenPass(context);
        const fullscreen = this.services.getScriptableFullscreenProcessor();
        const inputs = this.#fullscreenInputScratch;
        inputs.length = parameters.inputTextures.length;
        let numericDepthSamplerMask = 0;
        for (let index = 0; index < parameters.inputTextures.length; index += 1) {
            const publicHandle = parameters.inputTextures[index];
            if (publicHandle === undefined) {
                throw new TypeError('Fullscreen input texture array must not be sparse');
            }
            const internal = declaredInputs.get(publicHandle);
            if (internal === undefined) {
                throw new Error('Fullscreen input texture was not declared during setup');
            }
            const format = this.requireTexture(publicHandle).format;
            const numericDepth = rhiTextureFormatHasDepth(format);
            const use = numericDepth ? 'sampled' : 'filterable-sampled';
            if (!this.capabilities.supportsTextureFormat(format, use)) {
                throw new Error(
                    numericDepth
                        ? `Fullscreen depth input texture format ${format} does not support sampling`
                        : `Fullscreen input texture format ${format} does not support linear filtering`
                );
            }
            if (numericDepth) {
                if (index >= 52) {
                    throw new RangeError(
                        'Fullscreen numeric depth specialization supports at most 52 inputs'
                    );
                }
                numericDepthSamplerMask += 2 ** index;
            }
            inputs[index] = internal;
        }
        const pipeline = fullscreen.prepareGraphPipeline(
            pass.shader,
            pass.pipelineState,
            target,
            numericDepthSamplerMask
        );
        const processor = this.services.getScriptableMeshProcessor();
        const uniformHandles = this.#fullscreenUniformScratch;
        uniformHandles.length = pass.uniformBuffers.length;
        for (let index = 0; index < pass.uniformBuffers.length; index += 1) {
            const uniformBuffer = pass.uniformBuffers[index];
            if (uniformBuffer === undefined) {
                throw new TypeError('Fullscreen uniform buffer array must not be sparse');
            }
            processor.buffers.prepareUniformBuffer(uniformBuffer);
            const handle = processor.buffers.getUniformBufferHandle(uniformBuffer);
            processor.resourceUses.use(handle);
            uniformHandles[index] = handle;
        }
        const draw =
            retained ??
            new ScriptableFullscreenDraw(
                fullscreen.registry.deviceCapabilities.limits.maxBindGroups
            );
        draw.configure(pipeline, inputs, uniformHandles, this.frameIndex);
        return draw;
    }

    configureComputeDispatch(
        retained: ScriptableComputeDispatch | null,
        pass: ComputeRenderPass,
        parameters: ComputeRenderPassParameters,
        services: ScriptableComputeDispatchServices
    ): ScriptableComputeDispatch {
        if (this.services.renderer.backend !== 'webgpu') {
            throw new Error('ComputeRenderPass is supported only by the WebGPU renderer');
        }
        const context = this.services.createScriptableFrameContext(
            this.camera,
            this.rhiViewport,
            this.frameIndex
        );
        this.services.beginScriptableResourcePass(context);
        const dispatch = retained ?? new ScriptableComputeDispatch();
        dispatch.configure(pass, parameters, this, services, this.frameIndex);
        return dispatch;
    }

    configureGPUDrivenDraw(
        retained: ScriptableGPUDrivenDraw | null,
        pass: GPUDrivenRenderPass,
        parameters: GPUDrivenRenderPassParameters,
        target: RHIMeshDrawTargetDescriptor,
        services: ScriptableGPUDrivenDrawServices
    ): ScriptableGPUDrivenDraw {
        if (this.services.renderer.backend !== 'webgpu') {
            throw new Error('GPUDrivenRenderPass is supported only by the WebGPU renderer');
        }
        const context = this.services.createScriptableFrameContext(
            this.camera,
            this.rhiViewport,
            this.frameIndex
        );
        this.services.beginScriptableResourcePass(context);
        const draw = retained ?? new ScriptableGPUDrivenDraw();
        draw.configure(
            pass,
            parameters,
            this,
            services,
            target,
            this.frameIndex,
            this.camera.depthMode
        );
        return draw;
    }

    private importSurfaceOutput(): TargetResourcesFacade {
        const graph = this.requireScope().graph;
        const surface = this.services.getScriptableSurface();
        const configuration = servicesConfiguration(surface);
        const surfaceColor = importSurfaceColor(graph, surface, 'scriptable surface color');
        graph.markOutput(surfaceColor);
        const colors = this.#targetColorScratch;
        colors.length = 1;
        if (this.#outputState.sampleCount === 4) {
            const color = this.acquireTextureRecord({
                name: 'scriptable multisampled surface color',
                format: pipelineColorFormat(configuration.format),
                width: configuration.width,
                height: configuration.height,
                sampleCount: 4,
                mipLevelCount: 1,
                attachment: null,
                readable: surfaceColor,
                writable: surfaceColor,
                resolveTarget: surfaceColor,
                outputRoot: surfaceColor,
                transient: true
            });
            colors[0] = color.handle;
        } else {
            colors[0] = this.acquireImportedTextureRecord(
                'scriptable surface color',
                pipelineColorFormat(configuration.format),
                configuration.width,
                configuration.height,
                1,
                surfaceColor,
                surfaceColor,
                surfaceColor,
                null,
                surfaceColor
            ).handle;
        }
        let depth: RenderGraphTextureHandle | null = null;
        const depthFormat = configuration.depthStencilFormat;
        if (depthFormat !== null) {
            if (this.#outputState.sampleCount === 4) {
                depth = this.createTexture('scriptable multisampled surface depth-stencil', {
                    format: pipelineDepthFormat(depthFormat) ?? 'depth24plus',
                    extent: { width: configuration.width, height: configuration.height },
                    sampleCount: 4
                });
            } else {
                const internal = importSurfaceDepthStencil(
                    graph,
                    surface,
                    'scriptable surface depth-stencil'
                );
                depth = this.acquireImportedTextureRecord(
                    'scriptable surface depth-stencil',
                    pipelineDepthFormat(depthFormat) ?? 'depth24plus',
                    configuration.width,
                    configuration.height,
                    1,
                    internal,
                    internal,
                    internal,
                    null,
                    null
                ).handle;
            }
        }
        const slot = this.acquireTargetSlot();
        slot.configure(
            configuration.width,
            configuration.height,
            this.#outputState.sampleCount,
            colors,
            depth
        );
        const facade = new TargetResourcesFacade(this, this.requireActiveLease(), slot);
        this.services.markScriptableSurfaceRequested();
        return facade;
    }

    private importTarget(target: RHIRenderTarget): TargetResourcesFacade {
        const record = target.resourceRecord;
        this.services.markScriptableTargetUsed(record);
        return this.importTargetRecord(record);
    }

    private importTargetRecord(
        record: Readonly<RenderTargetResourceRecord>
    ): TargetResourcesFacade {
        const imported = this.services
            .getScriptableTargetBridge()
            .import(this.requireScope().graph, record);
        const colors = this.#targetColorScratch;
        colors.length = imported.colorAttachments.length;
        for (let index = 0; index < imported.colorAttachments.length; index += 1) {
            const color = imported.colorAttachments[index];
            if (color === undefined) throw new Error('Imported target color attachment is missing');
            const outputRoot = color.resolveTarget ?? color.readableTexture;
            this.requireScope().graph.markOutput(outputRoot);
            colors[index] = this.acquireImportedTextureRecord(
                `${record.label} color ${String(index)}`,
                pipelineColorFormat(color.format),
                imported.width,
                imported.height,
                imported.sampleCount,
                color.texture,
                color.readableTexture,
                color.readableTexture,
                color.resolveTarget,
                outputRoot
            ).handle;
        }
        let depth: RenderGraphTextureHandle | null = null;
        if (imported.depthStencilAttachment !== null && record.depthStencilAttachment !== null) {
            const internal = imported.depthStencilAttachment;
            this.requireScope().graph.markOutput(internal);
            depth = this.acquireImportedTextureRecord(
                `${record.label} depth-stencil`,
                pipelineDepthFormat(record.depthStencilAttachment.format) ?? 'depth24plus',
                imported.width,
                imported.height,
                imported.sampleCount,
                internal,
                internal,
                internal,
                null,
                internal
            ).handle;
        }
        const slot = this.acquireTargetSlot();
        slot.configure(imported.width, imported.height, imported.sampleCount, colors, depth);
        return new TargetResourcesFacade(this, this.requireActiveLease(), slot);
    }

    private acquireImportedTextureRecord(
        name: string,
        format: PipelineTextureFormat,
        width: number,
        height: number,
        sampleCount: 1 | 4,
        attachment: RGTextureHandle,
        readable: RGTextureHandle,
        writable: RGTextureHandle,
        resolveTarget: RGTextureHandle | null,
        outputRoot: RGTextureHandle | null
    ): TextureRecord {
        return this.acquireTextureRecord({
            name,
            format,
            width,
            height,
            sampleCount,
            mipLevelCount: 1,
            attachment,
            readable,
            writable,
            resolveTarget,
            outputRoot,
            transient: false
        });
    }

    private acquireTextureRecord(source: TextureRecordSource): TextureRecord {
        let record = this.#textureRecords[this.#textureCursor++];
        if (record === undefined) {
            record = {
                kind: 'texture',
                handle: 0 as RenderGraphTextureHandle,
                name: '',
                format: 'rgba8unorm',
                width: 1,
                height: 1,
                depthOrArrayLayers: 1,
                sampleCount: 1,
                mipLevelCount: 1,
                textureDimension: '2d',
                viewDimension: '2d',
                viewFormats: Object.freeze([]),
                attachment: null,
                readable: null,
                writable: null,
                resolveTarget: null,
                outputRoot: null,
                transient: false,
                historyState: null,
                historyCurrent: false,
                graphDescriptor: createTextureGraphDescriptor()
            };
            this.#textureRecords.push(record);
        }
        record.handle = this.allocateHandle() as RenderGraphTextureHandle;
        record.name = source.name;
        record.format = source.format;
        record.width = source.width;
        record.height = source.height;
        record.depthOrArrayLayers = source.depthOrArrayLayers ?? 1;
        record.sampleCount = source.sampleCount;
        record.mipLevelCount = source.mipLevelCount;
        record.textureDimension = source.textureDimension ?? '2d';
        record.viewDimension = source.viewDimension ?? '2d';
        record.viewFormats = source.viewFormats ?? Object.freeze([]);
        record.attachment = source.attachment;
        record.readable = source.readable;
        record.writable = source.writable;
        record.resolveTarget = source.resolveTarget;
        record.outputRoot = source.outputRoot;
        record.transient = source.transient;
        record.historyState = source.historyState ?? null;
        record.historyCurrent = source.historyCurrent ?? false;
        this.#textureByHandle.set(record.handle, record);
        this.#textureAccessByHandle.set(record.handle, record);
        return record;
    }

    private acquireTextureViewRecord(
        source: Omit<TextureViewRecord, 'kind' | 'handle'>
    ): TextureViewRecord {
        let record = this.#textureViewRecords[this.#textureViewCursor++];
        if (record === undefined) {
            record = {
                kind: 'texture-view',
                handle: 0 as RenderGraphTextureViewHandle,
                name: '',
                texture: source.texture,
                descriptor: source.descriptor,
                format: 'rgba8unorm',
                width: 1,
                height: 1,
                depthOrArrayLayers: 1,
                sampleCount: 1,
                mipLevelCount: 1,
                textureDimension: '2d',
                attachment: null,
                readable: null,
                writable: null,
                resolveTarget: null,
                outputRoot: null,
                transient: false,
                historyState: null,
                historyCurrent: false
            };
            this.#textureViewRecords.push(record);
        }
        record.handle = this.allocateHandle() as RenderGraphTextureViewHandle;
        record.name = source.name;
        record.texture = source.texture;
        record.descriptor = source.descriptor;
        record.format = source.format;
        record.width = source.width;
        record.height = source.height;
        record.depthOrArrayLayers = source.depthOrArrayLayers;
        record.sampleCount = source.sampleCount;
        record.mipLevelCount = source.mipLevelCount;
        record.textureDimension = source.textureDimension;
        record.attachment = source.attachment;
        record.readable = source.readable;
        record.writable = source.writable;
        record.resolveTarget = source.resolveTarget;
        record.outputRoot = source.outputRoot;
        record.transient = source.transient;
        record.historyState = source.historyState;
        record.historyCurrent = source.historyCurrent;
        this.#textureAccessByHandle.set(record.handle, record);
        return record;
    }

    private acquireBufferRecord(
        source: Omit<BufferRecord, 'handle' | 'graphDescriptor'>
    ): BufferRecord {
        let record = this.#bufferRecords[this.#bufferCursor++];
        if (record === undefined) {
            record = {
                handle: 0 as RenderGraphBufferHandle,
                name: '',
                byteLength: 4,
                internal: null,
                source: null,
                transient: false,
                initialized: false,
                graphDescriptor: createBufferGraphDescriptor()
            };
            this.#bufferRecords.push(record);
        }
        record.handle = this.allocateHandle() as RenderGraphBufferHandle;
        record.name = source.name;
        record.byteLength = source.byteLength;
        record.internal = source.internal;
        record.source = source.source;
        record.transient = source.transient;
        record.initialized = source.initialized;
        record.graphDescriptor.label = source.name;
        record.graphDescriptor.size = source.byteLength;
        record.graphDescriptor.usage = 0;
        this.#bufferByHandle.set(record.handle, record);
        return record;
    }

    private acquireTargetSlot(): TargetResourcesSlot {
        let slot = this.#targetSlots[this.#targetSlotCursor++];
        if (slot === undefined) {
            slot = new TargetResourcesSlot();
            this.#targetSlots.push(slot);
        }
        return slot;
    }

    private requireCulling(handle: CullingResultsHandle): CullingSlot {
        const slot = this.#cullingByHandle.get(handle);
        if (slot?.frameIndex !== this.frameIndex) {
            throw new Error(`Culling result handle ${String(handle)} is stale or invalid`);
        }
        return slot;
    }

    private resolveExtent(extent: RenderPipelineExtent): { width: number; height: number } {
        if ('relativeTo' in extent) {
            const relativeTo: unknown = extent.relativeTo;
            if (relativeTo !== 'output') {
                throw new TypeError(`Unsupported relative extent ${String(relativeTo)}`);
            }
            if (!Number.isFinite(extent.scale) || extent.scale <= 0) {
                throw new RangeError('Relative texture extent scale must be positive and finite');
            }
            const minWidth = positiveInteger(extent.minWidth ?? 1, 'Texture minimum width');
            const minHeight = positiveInteger(extent.minHeight ?? 1, 'Texture minimum height');
            return {
                width: Math.max(minWidth, Math.floor(this.#outputState.width * extent.scale)),
                height: Math.max(minHeight, Math.floor(this.#outputState.height * extent.scale))
            };
        }
        return {
            width: positiveInteger(extent.width, 'Texture width'),
            height: positiveInteger(extent.height, 'Texture height')
        };
    }

    private setViewport(x: number, y: number, width: number, height: number): void {
        this.#viewportState[0] = x;
        this.#viewportState[1] = y;
        this.#viewportState[2] = width;
        this.#viewportState[3] = height;
        this.rhiViewport.x = x;
        this.rhiViewport.y = y;
        this.rhiViewport.width = width;
        this.rhiViewport.height = height;
        this.rhiViewport.minDepth = 0;
        this.rhiViewport.maxDepth = 1;
    }

    private allocateHandle(): number {
        return this.resources.allocateHandle();
    }

    private requireScope(): RenderGraphFrameBuildScope {
        if (this.#scope === null) throw new Error('Pipeline context has no graph scope');
        return this.#scope;
    }

    private requireScene(): RendererScene {
        if (this.#scene === null) throw new Error('Pipeline context has no scene');
        return this.#scene;
    }

    private requireCamera(): Camera {
        if (this.#camera === null) throw new Error('Pipeline context has no camera');
        return this.#camera;
    }

    private requireActiveLease(): PipelineInvocationLease {
        const lease = this.#activeLease;
        if (lease === null) {
            throw new Error('RenderPipelineContext is valid only during synchronous record()');
        }
        return lease;
    }

    readViewportComponent(lease: PipelineInvocationLease, index: number): number {
        this.assertLeaseActive(lease);
        const value = this.#viewportState[index];
        if (value === undefined) {
            throw new Error('Scriptable viewport storage is incomplete');
        }
        return value;
    }

    readClearColorState(lease: PipelineInvocationLease): Readonly<MutableRenderTargetColor> {
        this.assertLeaseActive(lease);
        return this.#clearColorState;
    }

    readOutputState(lease: PipelineInvocationLease): Readonly<MutablePipelineOutputState> {
        this.assertLeaseActive(lease);
        return this.#outputState;
    }

    readOutputColorFormat(
        lease: PipelineInvocationLease,
        index: number
    ): RenderPipelineColorFormat {
        this.assertLeaseActive(lease);
        return this.outputColorFormat(index);
    }

    readOutputColorAttachmentState(
        lease: PipelineInvocationLease,
        index: number
    ): Readonly<MutablePipelineOutputColorAttachmentState> {
        this.assertLeaseActive(lease);
        return this.requireOutputColorAttachmentState(index);
    }

    readOutputDepthStencilState(
        lease: PipelineInvocationLease
    ): Readonly<MutablePipelineOutputDepthStencilAttachmentState> {
        this.assertLeaseActive(lease);
        return this.requireOutputDepthStencilState();
    }

    private outputColorFormat(index: number): RenderPipelineColorFormat {
        this.assertActive();
        if (
            !Number.isSafeInteger(index) ||
            index < 0 ||
            index >= this.#outputState.colorAttachmentCount
        ) {
            throw new RangeError(`Color attachment ${String(index)} does not exist`);
        }
        const format = this.#outputColorFormats[index];
        if (format === undefined) throw new Error('Output color format is unavailable');
        return format;
    }

    private configureOutputColorAttachment(
        index: number,
        clearValue: Readonly<RenderTargetColor>,
        loadOp: RenderTargetLoadOp,
        storeOp: RenderTargetStoreOp
    ): void {
        let state = this.#outputColorAttachmentStates[index];
        if (state === undefined) {
            state = {
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: 'clear',
                storeOp: 'store'
            };
            this.#outputColorAttachmentStates[index] = state;
        }
        state.clearValue.r = clearValue.r;
        state.clearValue.g = clearValue.g;
        state.clearValue.b = clearValue.b;
        state.clearValue.a = clearValue.a;
        state.loadOp = loadOp;
        state.storeOp = storeOp;
    }

    private configureOutputDepthStencilAttachment(
        attachment: Readonly<MutablePipelineOutputDepthStencilAttachmentState> | null
    ): void {
        if (attachment === null) return;
        const state = this.#outputDepthStencilState;
        state.depthClearValue = attachment.depthClearValue;
        state.depthLoadOp = attachment.depthLoadOp;
        state.depthStoreOp = attachment.depthStoreOp;
        state.stencilClearValue = attachment.stencilClearValue;
        state.stencilLoadOp = attachment.stencilLoadOp;
        state.stencilStoreOp = attachment.stencilStoreOp;
    }

    private requireOutputColorAttachmentState(
        index: number
    ): Readonly<MutablePipelineOutputColorAttachmentState> {
        this.outputColorFormat(index);
        const state = this.#outputColorAttachmentStates[index];
        if (state === undefined) throw new Error('Output color attachment policy is unavailable');
        return state;
    }

    private requireOutputDepthStencilState(): Readonly<MutablePipelineOutputDepthStencilAttachmentState> {
        this.assertActive();
        if (this.#outputState.depthStencilFormat === null) {
            throw new Error('Output depth/stencil attachment does not exist');
        }
        return this.#outputDepthStencilState;
    }

    private assertActive(): void {
        if (!this.#active) {
            throw new Error('RenderPipelineContext is valid only during synchronous record()');
        }
    }
}

function servicesConfiguration(surface: RHISurface): NonNullable<RHISurface['configuration']> {
    const configuration = surface.configuration;
    if (surface.state !== 'configured' || configuration === null) {
        throw new Error(
            `Scriptable rendering requires a configured surface, received ${surface.state}`
        );
    }
    return configuration;
}

function pipelineColorFormat(format: RHITextureFormat): RenderPipelineColorFormat {
    switch (format) {
        case 'rgba8unorm':
        case 'rgba8unorm-srgb':
        case 'bgra8unorm':
        case 'bgra8unorm-srgb':
        case 'rgba16float':
        case 'rgba32float':
            return format;
        default:
            throw new Error(`Surface color format ${format} is outside the public pipeline set`);
    }
}

function pipelineDepthFormat(
    format: RHITextureFormat | null
): RenderTargetDepthStencilFormat | null {
    switch (format) {
        case null:
        case 'depth16unorm':
        case 'depth24plus':
        case 'depth24plus-stencil8':
        case 'depth32float':
        case 'depth32float-stencil8':
            return format;
        default:
            throw new Error(`Depth/stencil format ${format} is outside the public pipeline set`);
    }
}
