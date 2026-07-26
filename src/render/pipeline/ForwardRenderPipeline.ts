import {
    renderTargetFormatHasStencil,
    type RenderTargetColor,
    type RenderTargetColorFormat,
    type RenderTargetDepthStencilFormat,
    type RenderTargetLoadOp,
    type RenderTargetSampleCount,
    type RenderTargetStoreOp
} from '../RenderTarget';
import type {
    CullingResultsHandle,
    RendererListDescriptor,
    RendererListHandle
} from './RendererList';
import { RenderPassParameterPool } from './RenderPassParameterPool';
import type {
    RenderPipeline,
    RenderPipelineContext,
    RenderPipelineCreateContext,
    RenderPipelineFactory,
    RenderPipelineOutputDepthStencilAttachment,
    RenderPipelineRequirements
} from './RenderPipeline';
import { snapshotRenderPipelineRequirements } from './RenderPipelineFactory';
import {
    PresentRenderPass,
    SceneRenderPass,
    ShadowRenderPass,
    TextureCopyPass,
    type FullscreenRenderPassParameters,
    type SceneRenderPassParameters
} from './passes';
import type {
    RenderGraphTextureHandle,
    RenderPipelineColorAttachment,
    RenderPipelineDepthStencilAttachment,
    RenderPipelineExtent,
    RenderPipelineTextureDescriptor
} from './ScriptableRenderGraph';

/** Stable stages at which a forward feature may synchronously record graph work. */
export type ForwardRenderInjectionPoint =
    | 'before-shadow'
    | 'after-shadow'
    | 'before-opaque'
    | 'after-opaque'
    | 'before-transparent'
    | 'after-transparent'
    | 'before-post-process'
    | 'after-post-process'
    | 'before-output';

/** Static resource and device requirements declared before backend selection. */
export interface ForwardRenderFeatureRequirements extends RenderPipelineRequirements {
    /** Route scene color through a linearly filterable sampled graph texture. */
    readonly sampledSceneColor: boolean;
    /**
     * Reserved scene-depth sampling requirement. `true` is rejected until the public fullscreen
     * binding ABI supports portable non-filtering depth sampling end to end.
     */
    readonly sampledDepth: boolean;
}

/** Renderer-local feature state created by a reusable feature configuration. */
export interface ForwardRenderPipelineFeatureRuntime {
    /**
     * Record this feature at its configured injection point.
     *
     * @returns An ignored synchronous value. Promise-like values are rejected before RHI execution.
     */
    record(context: ForwardRenderFeatureContext): unknown;
    /** Release renderer-local feature state exactly once. */
    destroy(): void;
}

/** Reusable feature configuration snapshotted by {@link ForwardRenderPipelineFactory}. */
export interface ForwardRenderPipelineFeature {
    /** Unique diagnostic name within one forward factory. */
    readonly name: string;
    /** Stable point at which the runtime records its graph work. */
    readonly injectionPoint: ForwardRenderInjectionPoint;
    /** Static scene-resource and device constraints. */
    readonly requirements: Readonly<ForwardRenderFeatureRequirements>;
    /**
     * Create independent state for one Renderer. This callback must complete synchronously and
     * must not return a runtime already attached to another Renderer.
     */
    create(context: RenderPipelineCreateContext): ForwardRenderPipelineFeatureRuntime;
}

/** Callback-scoped forward resources visible only during one synchronous feature record call. */
export interface ForwardRenderPipelineResources {
    /** Current attachment-zero scene color, or null for a depth-only output. */
    readonly color: RenderGraphTextureHandle | null;
    /** Current scene depth, or null when no depth resource was requested or configured. */
    readonly depth: RenderGraphTextureHandle | null;
    /** Replace attachment-zero scene color for subsequent features and final output. */
    replaceColor(texture: RenderGraphTextureHandle): void;
}

/** Callback-scoped inputs passed to one forward feature runtime. */
export interface ForwardRenderFeatureContext {
    /** Active frame-scoped pipeline context. */
    readonly pipeline: RenderPipelineContext;
    /** Built-in culling results shared by shadows and every default forward scene pass. */
    readonly cullingResults: CullingResultsHandle;
    /** Forward resources at this feature's injection point. */
    readonly resources: ForwardRenderPipelineResources;
}

/** Construction options for the built-in scriptable forward pipeline. */
export interface ForwardRenderPipelineFactoryOptions {
    /** Ordered reusable feature configurations. */
    readonly features?: readonly ForwardRenderPipelineFeature[];
    /**
     * Linear scene-color format used before final output. Use `rgba16float` for HDR lighting,
     * Bloom, and display-referred color grading.
     */
    readonly sceneColorFormat?: RenderTargetColorFormat;
    /**
     * Capture opaque scene color before transparent rendering and bind it to transmission/volume
     * materials as `u_opaqueTexture`.
     */
    readonly opaqueTexture?: boolean;
}

interface FeatureSnapshot extends ForwardRenderPipelineFeature {
    readonly requirements: Readonly<ForwardRenderFeatureRequirements>;
}

interface CompiledFeature {
    readonly name: string;
    readonly runtime: ForwardRenderPipelineFeatureRuntime;
}

interface MutableRendererListDescriptor extends RendererListDescriptor {
    cullingResults: CullingResultsHandle;
}

interface MutableColorAttachment extends RenderPipelineColorAttachment {
    texture: RenderGraphTextureHandle;
    resolveTarget?: RenderGraphTextureHandle;
    loadOp: RenderTargetLoadOp;
    storeOp: RenderTargetStoreOp;
    clearValue?: RenderTargetColor;
}

interface MutableDepthStencilAttachment extends RenderPipelineDepthStencilAttachment {
    texture: RenderGraphTextureHandle;
    depthLoadOp?: RenderTargetLoadOp;
    depthStoreOp?: RenderTargetStoreOp;
    depthClearValue?: number;
    stencilLoadOp?: RenderTargetLoadOp;
    stencilStoreOp?: RenderTargetStoreOp;
    stencilClearValue?: number;
}

interface MutableTextureDescriptor extends RenderPipelineTextureDescriptor {
    format: RenderTargetColorFormat | RenderTargetDepthStencilFormat;
    sampleCount: RenderTargetSampleCount;
}

type MutableOutputDepthStencilAttachment = {
    -readonly [
        Key in keyof RenderPipelineOutputDepthStencilAttachment
    ]: RenderPipelineOutputDepthStencilAttachment[Key];
};

const INVALID_TEXTURE_HANDLE = 0 as RenderGraphTextureHandle;
const INVALID_RENDERER_LIST_HANDLE = 0 as RendererListHandle;
const INVALID_CULLING_RESULTS_HANDLE = 0 as CullingResultsHandle;
const OUTPUT_EXTENT: RenderPipelineExtent = Object.freeze({
    relativeTo: 'output',
    scale: 1
});
const EMPTY_CULLING_OPTIONS = Object.freeze({});
const attachedForwardFeatureRuntimes = new WeakSet();
const INJECTION_POINTS: readonly ForwardRenderInjectionPoint[] = Object.freeze([
    'before-shadow',
    'after-shadow',
    'before-opaque',
    'after-opaque',
    'before-transparent',
    'after-transparent',
    'before-post-process',
    'after-post-process',
    'before-output'
]);

function isPromiseLike(value: unknown): boolean {
    return (
        ((typeof value === 'object' && value !== null) || typeof value === 'function') &&
        typeof Reflect.get(value, 'then') === 'function'
    );
}

function injectionPointIndex(point: ForwardRenderInjectionPoint): number {
    switch (point) {
        case 'before-shadow':
            return 0;
        case 'after-shadow':
            return 1;
        case 'before-opaque':
            return 2;
        case 'after-opaque':
            return 3;
        case 'before-transparent':
            return 4;
        case 'after-transparent':
            return 5;
        case 'before-post-process':
            return 6;
        case 'after-post-process':
            return 7;
        case 'before-output':
            return 8;
    }
}

function isInjectionPoint(value: unknown): value is ForwardRenderInjectionPoint {
    return INJECTION_POINTS.some(point => point === value);
}

function createColorAttachment(): MutableColorAttachment {
    return {
        texture: INVALID_TEXTURE_HANDLE,
        loadOp: 'clear',
        storeOp: 'store'
    };
}

function createDepthStencilAttachment(): MutableDepthStencilAttachment {
    return {
        texture: INVALID_TEXTURE_HANDLE,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
        depthClearValue: 1
    };
}

class MutableSceneParameters implements SceneRenderPassParameters {
    rendererList = INVALID_RENDERER_LIST_HANDLE;
    readonly colorAttachments: MutableColorAttachment[] = [];
    readonly #retiredColorAttachments: MutableColorAttachment[] = [];
    readonly #depthStencil = createDepthStencilAttachment();
    depthStencilAttachment?: MutableDepthStencilAttachment;
    opaqueTexture?: RenderGraphTextureHandle;

    reset(): void {
        this.rendererList = INVALID_RENDERER_LIST_HANDLE;
        delete this.depthStencilAttachment;
        delete this.opaqueTexture;
    }

    setColorAttachmentCount(count: number): void {
        while (this.colorAttachments.length < count) {
            this.colorAttachments.push(
                this.#retiredColorAttachments.pop() ?? createColorAttachment()
            );
        }
        while (this.colorAttachments.length > count) {
            const retired = this.colorAttachments.pop();
            if (retired !== undefined) this.#retiredColorAttachments.push(retired);
        }
    }

    configureDepthStencil(
        texture: RenderGraphTextureHandle | null,
        format: RenderTargetDepthStencilFormat | null,
        operations: Readonly<RenderPipelineOutputDepthStencilAttachment>
    ): void {
        if (texture === null) {
            delete this.depthStencilAttachment;
            return;
        }
        const attachment = this.#depthStencil;
        attachment.texture = texture;
        attachment.depthLoadOp = operations.depthLoadOp;
        attachment.depthStoreOp = operations.depthStoreOp;
        attachment.depthClearValue = operations.depthClearValue;
        if (format !== null && renderTargetFormatHasStencil(format)) {
            attachment.stencilLoadOp = operations.stencilLoadOp;
            attachment.stencilStoreOp = operations.stencilStoreOp;
            attachment.stencilClearValue = operations.stencilClearValue;
        } else {
            delete attachment.stencilLoadOp;
            delete attachment.stencilStoreOp;
            delete attachment.stencilClearValue;
        }
        this.depthStencilAttachment = attachment;
    }
}

class MutablePresentParameters implements FullscreenRenderPassParameters {
    readonly inputTextures: RenderGraphTextureHandle[] = [INVALID_TEXTURE_HANDLE];
    readonly colorAttachments: MutableColorAttachment[] = [createColorAttachment()];

    reset(): void {
        this.inputTextures[0] = INVALID_TEXTURE_HANDLE;
        const attachment = this.colorAttachments[0];
        if (attachment !== undefined) {
            attachment.texture = INVALID_TEXTURE_HANDLE;
            attachment.loadOp = 'clear';
            attachment.storeOp = 'store';
            delete attachment.resolveTarget;
            delete attachment.clearValue;
        }
    }
}

class MutableTextureCopyParameters {
    source = INVALID_TEXTURE_HANDLE;
    destination = INVALID_TEXTURE_HANDLE;

    reset(): void {
        this.source = INVALID_TEXTURE_HANDLE;
        this.destination = INVALID_TEXTURE_HANDLE;
    }
}

type ForwardFeatureCallbackLease = object;

class ForwardFeatureState {
    #pipeline: RenderPipelineContext | null = null;
    #cullingResults = INVALID_CULLING_RESULTS_HANDLE;
    #color: RenderGraphTextureHandle | null = null;
    #depth: RenderGraphTextureHandle | null = null;
    #replacementAllowed = false;
    #activeCallbackLease: ForwardFeatureCallbackLease | null = null;

    beginFrame(
        pipeline: RenderPipelineContext,
        cullingResults: CullingResultsHandle,
        color: RenderGraphTextureHandle | null,
        depth: RenderGraphTextureHandle | null
    ): void {
        if (this.#pipeline !== null) throw new Error('Forward feature frame is already active');
        this.#pipeline = pipeline;
        this.#cullingResults = cullingResults;
        this.#color = color;
        this.#depth = depth;
        this.#replacementAllowed = false;
    }

    endFrame(): void {
        this.#activeCallbackLease = null;
        this.#cullingResults = INVALID_CULLING_RESULTS_HANDLE;
        this.#pipeline = null;
        this.#color = null;
        this.#depth = null;
        this.#replacementAllowed = false;
    }

    beginCallback(): ForwardRenderFeatureContext {
        this.assertFrameActive();
        if (this.#activeCallbackLease !== null) {
            throw new Error('Forward feature callback is already active');
        }
        const lease = Object.freeze({});
        this.#activeCallbackLease = lease;
        return new ForwardFeatureContextLease(this, lease);
    }

    endCallback(): void {
        this.#activeCallbackLease = null;
    }

    allowColorReplacement(): void {
        this.assertFrameActive();
        this.#replacementAllowed = true;
    }

    get currentColor(): RenderGraphTextureHandle | null {
        this.assertFrameActive();
        return this.#color;
    }

    readPipeline(lease: ForwardFeatureCallbackLease): RenderPipelineContext {
        this.assertCallbackActive(lease);
        return this.assertFrameActive();
    }

    readCullingResults(lease: ForwardFeatureCallbackLease): CullingResultsHandle {
        this.assertCallbackActive(lease);
        if (this.#cullingResults === INVALID_CULLING_RESULTS_HANDLE) {
            throw new Error('Forward feature culling results are unavailable');
        }
        return this.#cullingResults;
    }

    readColor(lease: ForwardFeatureCallbackLease): RenderGraphTextureHandle | null {
        this.assertCallbackActive(lease);
        return this.#color;
    }

    readDepth(lease: ForwardFeatureCallbackLease): RenderGraphTextureHandle | null {
        this.assertCallbackActive(lease);
        return this.#depth;
    }

    replaceColor(lease: ForwardFeatureCallbackLease, texture: RenderGraphTextureHandle): void {
        this.assertCallbackActive(lease);
        if (!this.#replacementAllowed) {
            throw new Error('Forward scene color cannot be replaced before opaque rendering');
        }
        if (!Number.isSafeInteger(texture) || texture <= 0) {
            throw new TypeError('Forward scene color replacement requires a graph texture handle');
        }
        this.#color = texture;
    }

    assertCallbackActive(lease: ForwardFeatureCallbackLease): void {
        if (this.#activeCallbackLease !== lease) {
            throw new Error(
                'Forward feature context is valid only during synchronous record() callback'
            );
        }
        void this.assertFrameActive();
    }

    private assertFrameActive(): RenderPipelineContext {
        const pipeline = this.#pipeline;
        if (pipeline === null) {
            throw new Error('Forward resources are valid only during synchronous record()');
        }
        return pipeline;
    }
}

class ForwardFeatureResourcesLease implements ForwardRenderPipelineResources {
    readonly #state: ForwardFeatureState;
    readonly #lease: ForwardFeatureCallbackLease;

    constructor(state: ForwardFeatureState, lease: ForwardFeatureCallbackLease) {
        this.#state = state;
        this.#lease = lease;
        Object.freeze(this);
    }

    get color(): RenderGraphTextureHandle | null {
        return this.#state.readColor(this.#lease);
    }

    get depth(): RenderGraphTextureHandle | null {
        return this.#state.readDepth(this.#lease);
    }

    replaceColor(texture: RenderGraphTextureHandle): void {
        this.#state.replaceColor(this.#lease, texture);
    }
}

class ForwardFeatureContextLease implements ForwardRenderFeatureContext {
    readonly #state: ForwardFeatureState;
    readonly #lease: ForwardFeatureCallbackLease;
    readonly #resources: ForwardRenderPipelineResources;

    constructor(state: ForwardFeatureState, lease: ForwardFeatureCallbackLease) {
        this.#state = state;
        this.#lease = lease;
        this.#resources = new ForwardFeatureResourcesLease(state, lease);
        Object.freeze(this);
    }

    get pipeline(): RenderPipelineContext {
        return this.#state.readPipeline(this.#lease);
    }

    get cullingResults(): CullingResultsHandle {
        return this.#state.readCullingResults(this.#lease);
    }

    get resources(): ForwardRenderPipelineResources {
        this.#state.assertCallbackActive(this.#lease);
        return this.#resources;
    }
}

function snapshotFeature(feature: ForwardRenderPipelineFeature): FeatureSnapshot {
    const candidate: unknown = feature;
    if ((typeof candidate !== 'object' && typeof candidate !== 'function') || candidate === null) {
        throw new TypeError('Forward render feature must be an object');
    }
    if (typeof feature.name !== 'string' || feature.name.length === 0) {
        throw new TypeError('Forward render feature name must be non-empty');
    }
    const injectionPoint: unknown = feature.injectionPoint;
    if (!isInjectionPoint(injectionPoint)) {
        throw new TypeError(
            `Forward render feature ${feature.name} has invalid injection point ${String(injectionPoint)}`
        );
    }
    if (typeof feature.create !== 'function') {
        throw new TypeError(`Forward render feature ${feature.name} must implement create()`);
    }
    const requirementCandidate: unknown = feature.requirements;
    if (
        (typeof requirementCandidate !== 'object' && typeof requirementCandidate !== 'function') ||
        requirementCandidate === null
    ) {
        throw new TypeError(
            `Forward render feature ${feature.name} requirements must be an object`
        );
    }
    const sampledSceneColor = feature.requirements.sampledSceneColor;
    const sampledDepth = feature.requirements.sampledDepth;
    if (typeof sampledSceneColor !== 'boolean' || typeof sampledDepth !== 'boolean') {
        throw new TypeError(
            `Forward render feature ${feature.name} must declare sampledSceneColor and sampledDepth`
        );
    }
    if (sampledDepth) {
        throw new Error(
            `Forward render feature ${feature.name} sampledDepth is not implemented end to end`
        );
    }
    if (
        sampledSceneColor &&
        injectionPointIndex(injectionPoint) < injectionPointIndex('after-opaque')
    ) {
        throw new Error(
            `Forward render feature ${feature.name} cannot sample scene color before opaque rendering`
        );
    }
    const requirements = Object.freeze({
        ...snapshotRenderPipelineRequirements(feature.requirements),
        sampledSceneColor,
        sampledDepth
    });
    const create = feature.create.bind(feature);
    return Object.freeze({
        name: feature.name,
        injectionPoint,
        requirements,
        create(context: RenderPipelineCreateContext): ForwardRenderPipelineFeatureRuntime {
            return create(context);
        }
    });
}

function mergeFeatureRequirements(
    features: readonly FeatureSnapshot[]
): Readonly<RenderPipelineRequirements> {
    const requiredFeatures = new Set<
        NonNullable<RenderPipelineRequirements['requiredFeatures']>[number]
    >();
    const requiredCapabilities = new Set<
        NonNullable<RenderPipelineRequirements['requiredCapabilities']>[number]
    >();
    const requiredLimits: Record<string, number> = {};
    const requiredTextureFormats: NonNullable<
        RenderPipelineRequirements['requiredTextureFormats']
    >[number][] = [];
    for (const feature of features) {
        const requirements = feature.requirements;
        for (const value of requirements.requiredFeatures ?? []) requiredFeatures.add(value);
        for (const value of requirements.requiredCapabilities ?? []) {
            requiredCapabilities.add(value);
        }
        for (const [name, value] of Object.entries(requirements.requiredLimits ?? {})) {
            requiredLimits[name] = Math.max(requiredLimits[name] ?? 0, value);
        }
        for (const value of requirements.requiredTextureFormats ?? []) {
            requiredTextureFormats.push(value);
        }
    }
    return snapshotRenderPipelineRequirements({
        ...(requiredFeatures.size === 0 ? {} : { requiredFeatures: [...requiredFeatures] }),
        ...(requiredCapabilities.size === 0
            ? {}
            : { requiredCapabilities: [...requiredCapabilities] }),
        ...(Object.keys(requiredLimits).length === 0 ? {} : { requiredLimits }),
        ...(requiredTextureFormats.length === 0 ? {} : { requiredTextureFormats })
    });
}

function validateFeatureRuntime(
    feature: FeatureSnapshot,
    candidate: unknown
): ForwardRenderPipelineFeatureRuntime {
    if ((typeof candidate !== 'object' && typeof candidate !== 'function') || candidate === null) {
        throw new TypeError(`Forward render feature ${feature.name} must create a runtime object`);
    }
    if (
        typeof Reflect.get(candidate, 'record') !== 'function' ||
        typeof Reflect.get(candidate, 'destroy') !== 'function'
    ) {
        throw new TypeError(
            `Forward render feature ${feature.name} runtime must implement record() and destroy()`
        );
    }
    return candidate as ForwardRenderPipelineFeatureRuntime;
}

class DirectForwardRenderPipeline implements RenderPipeline {
    readonly name = 'forward';

    record(_context: RenderPipelineContext): void {
        throw new Error('The direct forward pipeline must be recorded by RenderPipelineHost');
    }

    destroy(): void {
        // The direct marker has no renderer-local state.
    }
}

class ScriptableForwardRenderPipeline implements RenderPipeline {
    readonly name = 'forward';
    readonly #groups: CompiledFeature[][] = INJECTION_POINTS.map(() => []);
    readonly #featureState = new ForwardFeatureState();
    readonly #scenePass = new SceneRenderPass('Forward scene');
    readonly #shadowPass = new ShadowRenderPass('Forward shadows');
    readonly #loadPass = new PresentRenderPass('Forward output load');
    readonly #presentPass = new PresentRenderPass('Forward output');
    readonly #opaqueCopyPass = new TextureCopyPass('Forward opaque texture');
    readonly #sceneParameters = new RenderPassParameterPool(
        () => new MutableSceneParameters(),
        parameters => {
            parameters.reset();
        }
    );
    readonly #presentParameters = new RenderPassParameterPool(
        () => new MutablePresentParameters(),
        parameters => {
            parameters.reset();
        }
    );
    readonly #textureCopyParameters = new RenderPassParameterPool(
        () => new MutableTextureCopyParameters(),
        parameters => {
            parameters.reset();
        }
    );
    readonly #allListDescriptor: MutableRendererListDescriptor = {
        cullingResults: INVALID_CULLING_RESULTS_HANDLE,
        queue: 'all' as const,
        sorting: 'material-front-to-back' as const
    };
    readonly #opaqueListDescriptor: MutableRendererListDescriptor = {
        cullingResults: INVALID_CULLING_RESULTS_HANDLE,
        queue: 'opaque' as const,
        sorting: 'material-front-to-back' as const
    };
    readonly #transparentListDescriptor: MutableRendererListDescriptor = {
        cullingResults: INVALID_CULLING_RESULTS_HANDLE,
        queue: 'transparent' as const,
        sorting: 'back-to-front' as const
    };
    readonly #shadowParameters = {
        cullingResults: INVALID_CULLING_RESULTS_HANDLE
    };
    readonly #outputColors: RenderGraphTextureHandle[] = [];
    readonly #sceneColorSources: RenderGraphTextureHandle[] = [];
    readonly #sceneColorResolved: RenderGraphTextureHandle[] = [];
    readonly #sceneColorResolveTargets: (RenderGraphTextureHandle | null)[] = [];
    readonly #colorDescriptors: MutableTextureDescriptor[] = [];
    readonly #resolveDescriptors: MutableTextureDescriptor[] = [];
    readonly #colorNames: string[] = [];
    readonly #resolveNames: string[] = [];
    readonly #depthDescriptor: MutableTextureDescriptor = {
        format: 'depth24plus',
        extent: OUTPUT_EXTENT,
        sampleCount: 1,
        mipLevelCount: 1
    };
    readonly #depthOperations: MutableOutputDepthStencilAttachment = {
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
        stencilClearValue: 0,
        stencilLoadOp: 'clear',
        stencilStoreOp: 'discard'
    };
    readonly #opaqueTextureDescriptor: MutableTextureDescriptor = {
        format: 'rgba8unorm',
        extent: OUTPUT_EXTENT,
        sampleCount: 1,
        mipLevelCount: 1
    };
    readonly #compiledFeatures: readonly CompiledFeature[];
    readonly #requiresSampledColor: boolean;
    readonly #requiresSampledDepth: boolean;
    readonly #samplesBetweenQueues: boolean;
    readonly #splitScene: boolean;
    readonly #sceneColorFormat: RenderTargetColorFormat | null;
    readonly #opaqueTextureEnabled: boolean;
    #destroyed = false;

    constructor(
        features: readonly FeatureSnapshot[],
        runtimes: readonly ForwardRenderPipelineFeatureRuntime[],
        options: Readonly<{
            sceneColorFormat: RenderTargetColorFormat | null;
            opaqueTexture: boolean;
        }>
    ) {
        const compiled: CompiledFeature[] = [];
        let sampledColor = false;
        let sampledDepth = false;
        let samplesBetweenQueues = false;
        for (let index = 0; index < features.length; index += 1) {
            const feature = features[index];
            const runtime = runtimes[index];
            if (feature === undefined || runtime === undefined) {
                throw new Error('Forward feature compilation lost a runtime');
            }
            const entry = Object.freeze({ name: feature.name, runtime });
            compiled.push(entry);
            this.#groups[injectionPointIndex(feature.injectionPoint)]?.push(entry);
            sampledColor ||= feature.requirements.sampledSceneColor;
            sampledDepth ||= feature.requirements.sampledDepth;
            if (
                feature.requirements.sampledSceneColor &&
                (feature.injectionPoint === 'after-opaque' ||
                    feature.injectionPoint === 'before-transparent')
            ) {
                samplesBetweenQueues = true;
            }
        }
        this.#sceneColorFormat = options.sceneColorFormat;
        this.#opaqueTextureEnabled = options.opaqueTexture;
        sampledColor ||= options.opaqueTexture || options.sceneColorFormat !== null;
        samplesBetweenQueues ||= options.opaqueTexture;
        this.#compiledFeatures = Object.freeze(compiled);
        this.#requiresSampledColor = sampledColor;
        this.#requiresSampledDepth = sampledDepth;
        this.#samplesBetweenQueues = samplesBetweenQueues;
        this.#splitScene =
            options.opaqueTexture ||
            this.#groups[injectionPointIndex('after-opaque')]?.length !== 0 ||
            this.#groups[injectionPointIndex('before-transparent')]?.length !== 0;
    }

    record(context: RenderPipelineContext): void {
        if (this.#destroyed) throw new Error('Forward render pipeline is destroyed');
        const output = context.graph.importOutput();
        const colorCount = output.colorAttachmentCount;
        if (this.#requiresSampledColor && colorCount === 0) {
            throw new Error('Sampled forward scene color requires a color output attachment');
        }
        const sceneSampleCount: RenderTargetSampleCount =
            this.#requiresSampledDepth || this.#samplesBetweenQueues
                ? 1
                : context.output.sampleCount;
        const usesIntermediateColor =
            this.#requiresSampledColor || sceneSampleCount !== context.output.sampleCount;
        this.prepareSceneColors(
            context,
            output,
            colorCount,
            sceneSampleCount,
            usesIntermediateColor
        );
        const depth = this.prepareSceneDepth(
            context,
            output.depthStencil,
            sceneSampleCount,
            usesIntermediateColor
        );
        this.recordLoadedSceneColors(context, output, colorCount);
        const culling = context.cull(EMPTY_CULLING_OPTIONS);
        this.#allListDescriptor.cullingResults = culling;
        this.#opaqueListDescriptor.cullingResults = culling;
        this.#transparentListDescriptor.cullingResults = culling;
        this.#shadowParameters.cullingResults = culling;
        const initialColor = this.#sceneColorResolved[0] ?? null;
        this.#featureState.beginFrame(context, culling, initialColor, depth);
        try {
            this.recordFeatureGroup('before-shadow');
            this.#shadowPass.record(context, this.#shadowParameters);
            this.recordFeatureGroup('after-shadow');
            this.recordFeatureGroup('before-opaque');

            if (this.#splitScene) {
                const opaque = context.createRendererList(this.#opaqueListDescriptor);
                this.recordScenePass(context, output, opaque, depth, true, false, sceneSampleCount);
                const opaqueTexture = this.#opaqueTextureEnabled
                    ? this.recordOpaqueTexture(context)
                    : null;
                this.#featureState.allowColorReplacement();
                this.recordFeatureGroup('after-opaque');
                this.recordFeatureGroup('before-transparent');
                const transparent = context.createRendererList(this.#transparentListDescriptor);
                this.recordScenePass(
                    context,
                    output,
                    transparent,
                    depth,
                    false,
                    true,
                    sceneSampleCount,
                    opaqueTexture
                );
            } else {
                const all = context.createRendererList(this.#allListDescriptor);
                this.recordScenePass(context, output, all, depth, true, true, sceneSampleCount);
                this.#featureState.allowColorReplacement();
            }

            this.recordFeatureGroup('after-transparent');
            this.recordFeatureGroup('before-post-process');
            this.recordFeatureGroup('after-post-process');
            this.recordFeatureGroup('before-output');
            this.recordOutputPasses(context, output, colorCount);
        } finally {
            this.#featureState.endFrame();
        }
    }

    destroy(): void {
        if (this.#destroyed) return;
        this.#destroyed = true;
        const failures: unknown[] = [];
        for (let index = this.#compiledFeatures.length - 1; index >= 0; index -= 1) {
            try {
                this.#compiledFeatures[index]?.runtime.destroy();
            } catch (error) {
                failures.push(error);
            }
        }
        if (failures.length !== 0) {
            throw new AggregateError(
                failures,
                'Forward render features failed while being destroyed'
            );
        }
    }

    private prepareSceneColors(
        context: RenderPipelineContext,
        output: ReturnType<RenderPipelineContext['graph']['importOutput']>,
        colorCount: number,
        sampleCount: RenderTargetSampleCount,
        useIntermediate: boolean
    ): void {
        this.#outputColors.length = colorCount;
        this.#sceneColorSources.length = colorCount;
        this.#sceneColorResolved.length = colorCount;
        this.#sceneColorResolveTargets.length = colorCount;
        for (let index = 0; index < colorCount; index += 1) {
            const outputColor = output.color(index);
            this.#outputColors[index] = outputColor;
            if (!useIntermediate) {
                this.#sceneColorSources[index] = outputColor;
                this.#sceneColorResolved[index] = outputColor;
                this.#sceneColorResolveTargets[index] = null;
                continue;
            }
            const format = context.output.colorFormat(index);
            const sceneFormat =
                index === 0 && this.#sceneColorFormat !== null ? this.#sceneColorFormat : format;
            const descriptor = this.colorDescriptor(index, sceneFormat, sampleCount, false);
            const source = context.graph.createTexture(this.#colorNames[index] ?? '', descriptor);
            this.#sceneColorSources[index] = source;
            if (sampleCount === 4) {
                const resolveDescriptor = this.colorDescriptor(index, sceneFormat, 1, true);
                const resolve = context.graph.createTexture(
                    this.#resolveNames[index] ?? '',
                    resolveDescriptor
                );
                this.#sceneColorResolved[index] = resolve;
                this.#sceneColorResolveTargets[index] = resolve;
            } else {
                this.#sceneColorResolved[index] = source;
                this.#sceneColorResolveTargets[index] = null;
            }
        }
    }

    private prepareSceneDepth(
        context: RenderPipelineContext,
        outputDepth: RenderGraphTextureHandle | null,
        sampleCount: RenderTargetSampleCount,
        usesIntermediateColor: boolean
    ): RenderGraphTextureHandle | null {
        const outputFormat = context.output.depthStencilFormat;
        const canUseOutput =
            outputDepth !== null &&
            sampleCount === context.output.sampleCount &&
            !this.#requiresSampledDepth &&
            !(context.output.kind === 'surface' && usesIntermediateColor);
        if (canUseOutput) return outputDepth;
        if (outputDepth !== null && context.output.kind === 'render-target') {
            throw new Error(
                'Forward features requiring intermediate depth cannot preserve the selected RenderTarget depth/stencil attachment; use a custom RenderPipeline'
            );
        }
        if (outputFormat === null && !this.#requiresSampledDepth) return null;
        this.#depthDescriptor.format = outputFormat ?? 'depth24plus';
        this.#depthDescriptor.sampleCount = sampleCount;
        return context.graph.createTexture('forward scene depth', this.#depthDescriptor);
    }

    private recordLoadedSceneColors(
        context: RenderPipelineContext,
        output: ReturnType<RenderPipelineContext['graph']['importOutput']>,
        colorCount: number
    ): void {
        for (let index = 0; index < colorCount; index += 1) {
            const source = this.#outputColors[index];
            const destination = this.#sceneColorSources[index];
            if (source === undefined || destination === undefined || source === destination) {
                continue;
            }
            const operations = context.output.colorAttachment(index);
            if (operations.loadOp !== 'load') continue;
            if (context.output.sampleCount !== 1) {
                throw new Error(
                    'Forward intermediate color cannot preserve multisampled RenderTarget loadOp; use a custom RenderPipeline'
                );
            }
            const format = context.output.colorFormat(index);
            if (!context.capabilities.supportsTextureFormat(format, 'filterable-sampled')) {
                throw new Error(
                    `Forward intermediate color cannot preserve loadOp for non-filterable output format ${format}; use a custom RenderPipeline`
                );
            }
            const parameters = context.acquirePassParameters(this.#presentParameters);
            parameters.inputTextures[0] = output.color(index);
            const attachment = parameters.colorAttachments[0];
            if (attachment === undefined) {
                throw new Error('Forward output load attachment is unavailable');
            }
            attachment.texture = destination;
            attachment.loadOp = 'clear';
            attachment.storeOp = 'store';
            attachment.clearValue = operations.clearValue;
            const resolve = this.#sceneColorResolveTargets[index];
            if (resolve === null || resolve === undefined) delete attachment.resolveTarget;
            else attachment.resolveTarget = resolve;
            context.graph.addPass(this.#loadPass, parameters);
        }
    }

    private recordScenePass(
        context: RenderPipelineContext,
        output: ReturnType<RenderPipelineContext['graph']['importOutput']>,
        rendererList: RendererListHandle,
        depth: RenderGraphTextureHandle | null,
        firstScenePass: boolean,
        lastScenePass: boolean,
        sampleCount: RenderTargetSampleCount,
        opaqueTexture: RenderGraphTextureHandle | null = null
    ): void {
        const parameters = context.acquirePassParameters(this.#sceneParameters);
        parameters.rendererList = rendererList;
        if (opaqueTexture === null) delete parameters.opaqueTexture;
        else parameters.opaqueTexture = opaqueTexture;
        parameters.setColorAttachmentCount(this.#sceneColorSources.length);
        const currentColor = this.#featureState.currentColor;
        for (let index = 0; index < parameters.colorAttachments.length; index += 1) {
            const attachment = parameters.colorAttachments[index];
            if (attachment === undefined) continue;
            const resolved = this.#sceneColorResolved[index];
            const replaced = index === 0 && currentColor !== null && currentColor !== resolved;
            attachment.texture = replaced
                ? currentColor
                : (this.#sceneColorSources[index] ?? INVALID_TEXTURE_HANDLE);
            const outputColor = this.#outputColors[index];
            const writesOutput = outputColor !== undefined && attachment.texture === outputColor;
            const operations = context.output.colorAttachment(index);
            attachment.loadOp = firstScenePass ? operations.loadOp : 'load';
            attachment.storeOp = lastScenePass && writesOutput ? operations.storeOp : 'store';
            if (attachment.loadOp === 'clear') attachment.clearValue = operations.clearValue;
            else delete attachment.clearValue;
            const resolve = replaced ? null : this.#sceneColorResolveTargets[index];
            if (resolve === null || resolve === undefined) delete attachment.resolveTarget;
            else attachment.resolveTarget = resolve;
        }
        this.configureDepthOperations(
            context,
            depth,
            output.depthStencil,
            firstScenePass,
            lastScenePass
        );
        parameters.configureDepthStencil(
            depth,
            context.output.depthStencilFormat ??
                (depth === null
                    ? null
                    : (this.#depthDescriptor.format as RenderTargetDepthStencilFormat)),
            this.#depthOperations
        );
        context.graph.addPass(this.#scenePass, parameters);
        if (sampleCount === 1 && currentColor !== null && this.#sceneColorResolved.length > 0) {
            this.#sceneColorResolved[0] = currentColor;
        }
    }

    private recordOpaqueTexture(context: RenderPipelineContext): RenderGraphTextureHandle {
        const source = this.#featureState.currentColor;
        if (source === null) throw new Error('Forward opaque texture requires scene color');
        this.#opaqueTextureDescriptor.format =
            this.#sceneColorFormat ?? context.output.colorFormat(0);
        const destination = context.graph.createTexture(
            'forward opaque scene color',
            this.#opaqueTextureDescriptor
        );
        const parameters = context.acquirePassParameters(this.#textureCopyParameters);
        parameters.source = source;
        parameters.destination = destination;
        context.graph.addPass(this.#opaqueCopyPass, parameters);
        return destination;
    }

    private configureDepthOperations(
        context: RenderPipelineContext,
        depth: RenderGraphTextureHandle | null,
        outputDepth: RenderGraphTextureHandle | null,
        firstScenePass: boolean,
        lastScenePass: boolean
    ): void {
        const operations = this.#depthOperations;
        const selected = context.output.depthStencilAttachment;
        operations.depthClearValue = selected?.depthClearValue ?? 1;
        operations.stencilClearValue = selected?.stencilClearValue ?? 0;
        const writesOutput = depth !== null && depth === outputDepth;
        if (writesOutput) {
            if (selected === null) {
                throw new Error('Forward output depth/stencil operations are unavailable');
            }
            operations.depthLoadOp = firstScenePass ? selected.depthLoadOp : 'load';
            operations.depthStoreOp = lastScenePass ? selected.depthStoreOp : 'store';
            operations.stencilLoadOp = firstScenePass ? selected.stencilLoadOp : 'load';
            operations.stencilStoreOp = lastScenePass ? selected.stencilStoreOp : 'store';
            return;
        }
        operations.depthLoadOp = firstScenePass ? 'clear' : 'load';
        operations.depthStoreOp =
            lastScenePass && !this.#requiresSampledDepth ? 'discard' : 'store';
        operations.stencilLoadOp = firstScenePass ? 'clear' : 'load';
        operations.stencilStoreOp =
            lastScenePass && !this.#requiresSampledDepth ? 'discard' : 'store';
    }

    private recordOutputPasses(
        context: RenderPipelineContext,
        output: ReturnType<RenderPipelineContext['graph']['importOutput']>,
        colorCount: number
    ): void {
        for (let index = 0; index < colorCount; index += 1) {
            const source =
                index === 0
                    ? this.#featureState.currentColor
                    : (this.#sceneColorResolved[index] ?? null);
            const destination = this.#outputColors[index];
            if (source === null || destination === undefined || source === destination) continue;
            const parameters = context.acquirePassParameters(this.#presentParameters);
            parameters.inputTextures[0] = source;
            const attachment = parameters.colorAttachments[0];
            if (attachment === undefined)
                throw new Error('Forward output attachment is unavailable');
            attachment.texture = output.color(index);
            const operations = context.output.colorAttachment(index);
            attachment.loadOp = operations.loadOp;
            attachment.storeOp = operations.storeOp;
            if (operations.loadOp === 'clear') attachment.clearValue = operations.clearValue;
            else delete attachment.clearValue;
            context.graph.addPass(this.#presentPass, parameters);
        }
    }

    private recordFeatureGroup(point: ForwardRenderInjectionPoint): void {
        const group = this.#groups[injectionPointIndex(point)] ?? [];
        for (const feature of group) {
            const context = this.#featureState.beginCallback();
            try {
                const result: unknown = feature.runtime.record(context);
                if (isPromiseLike(result)) {
                    throw new TypeError('record() must be synchronous');
                }
            } catch (error) {
                throw new Error(`Forward render feature ${feature.name} failed at ${point}`, {
                    cause: error
                });
            } finally {
                this.#featureState.endCallback();
            }
        }
    }

    private colorDescriptor(
        index: number,
        format: RenderTargetColorFormat,
        sampleCount: RenderTargetSampleCount,
        resolve: boolean
    ): MutableTextureDescriptor {
        const descriptors = resolve ? this.#resolveDescriptors : this.#colorDescriptors;
        let descriptor = descriptors[index];
        if (descriptor === undefined) {
            descriptor = {
                format,
                extent: OUTPUT_EXTENT,
                sampleCount,
                mipLevelCount: 1
            };
            descriptors[index] = descriptor;
            if (resolve) this.#resolveNames[index] = `forward scene color ${String(index)} resolve`;
            else this.#colorNames[index] = `forward scene color ${String(index)}`;
        }
        descriptor.format = format;
        descriptor.sampleCount = sampleCount;
        return descriptor;
    }
}

/** Default forward pipeline factory. An empty feature set retains the direct renderer fast path. */
export class ForwardRenderPipelineFactory implements RenderPipelineFactory {
    /** Stable factory name. */
    readonly name = 'forward';
    /** Merged static requirements from every feature configuration. */
    readonly requirements: Readonly<RenderPipelineRequirements>;
    /** Constructor-snapshotted feature configurations in insertion order. */
    readonly features: readonly ForwardRenderPipelineFeature[];
    /** Linear intermediate scene-color format, or null to match the selected output. */
    readonly sceneColorFormat: RenderTargetColorFormat | null;
    /** Whether the forward pipeline captures opaque scene color for transparent materials. */
    readonly opaqueTexture: boolean;

    constructor(options: ForwardRenderPipelineFactoryOptions = {}) {
        const features = (options.features ?? []).map(snapshotFeature);
        const names = new Set<string>();
        for (const feature of features) {
            if (names.has(feature.name)) {
                throw new Error(`Forward render feature name ${feature.name} is duplicated`);
            }
            names.add(feature.name);
        }
        this.features = Object.freeze(features);
        const sceneColorFormat: unknown = options.sceneColorFormat ?? null;
        if (
            sceneColorFormat !== null &&
            sceneColorFormat !== 'rgba8unorm' &&
            sceneColorFormat !== 'rgba8unorm-srgb' &&
            sceneColorFormat !== 'rgba16float' &&
            sceneColorFormat !== 'rgba32float'
        ) {
            const formatLabel =
                typeof sceneColorFormat === 'string' ? sceneColorFormat : '<non-string>';
            throw new RangeError(`Unsupported forward scene color format ${formatLabel}`);
        }
        this.sceneColorFormat = sceneColorFormat;
        this.opaqueTexture = options.opaqueTexture ?? false;
        if (typeof this.opaqueTexture !== 'boolean') {
            throw new TypeError('Forward opaqueTexture must be a boolean');
        }
        const featureRequirements = mergeFeatureRequirements(features);
        this.requirements =
            this.sceneColorFormat === null
                ? featureRequirements
                : snapshotRenderPipelineRequirements({
                      ...featureRequirements,
                      requiredTextureFormats: [
                          ...(featureRequirements.requiredTextureFormats ?? []),
                          { format: this.sceneColorFormat, use: 'color-attachment' },
                          { format: this.sceneColorFormat, use: 'filterable-sampled' }
                      ]
                  });
    }

    /** Create an independent forward runtime and feature runtime set for one Renderer. */
    create(context: RenderPipelineCreateContext): RenderPipeline {
        if (this.features.length === 0 && this.sceneColorFormat === null && !this.opaqueTexture) {
            return new DirectForwardRenderPipeline();
        }
        const features = this.features as readonly FeatureSnapshot[];
        const runtimes: ForwardRenderPipelineFeatureRuntime[] = [];
        try {
            for (const feature of features) {
                const candidate: unknown = feature.create(context);
                if (isPromiseLike(candidate)) {
                    throw new TypeError(
                        `Forward render feature ${feature.name} create() must be synchronous`
                    );
                }
                if (
                    ((typeof candidate === 'object' && candidate !== null) ||
                        typeof candidate === 'function') &&
                    attachedForwardFeatureRuntimes.has(candidate)
                ) {
                    throw new Error(
                        `Forward render feature ${feature.name} runtime is already attached to another Renderer`
                    );
                }
                let runtime: ForwardRenderPipelineFeatureRuntime;
                try {
                    runtime = validateFeatureRuntime(feature, candidate);
                } catch (validationError) {
                    let cleanupError: unknown;
                    if (
                        ((typeof candidate === 'object' && candidate !== null) ||
                            typeof candidate === 'function') &&
                        typeof Reflect.get(candidate, 'destroy') === 'function'
                    ) {
                        try {
                            Reflect.apply(
                                Reflect.get(candidate, 'destroy') as (...args: never[]) => unknown,
                                candidate,
                                []
                            );
                        } catch (error) {
                            cleanupError = error;
                        }
                    }
                    if (cleanupError !== undefined) {
                        throw new AggregateError(
                            [validationError, cleanupError],
                            `Forward render feature ${feature.name} validation and cleanup both failed`,
                            { cause: validationError }
                        );
                    }
                    throw validationError;
                }
                attachedForwardFeatureRuntimes.add(runtime);
                runtimes.push(runtime);
            }
            return new ScriptableForwardRenderPipeline(features, runtimes, {
                sceneColorFormat: this.sceneColorFormat,
                opaqueTexture: this.opaqueTexture
            });
        } catch (creationError) {
            const failures: unknown[] = [creationError];
            for (let index = runtimes.length - 1; index >= 0; index -= 1) {
                try {
                    runtimes[index]?.destroy();
                } catch (error) {
                    failures.push(error);
                }
            }
            if (failures.length > 1) {
                throw new AggregateError(
                    failures,
                    'Forward render feature creation and cleanup both failed',
                    { cause: creationError }
                );
            }
            throw creationError;
        }
    }
}

/** @internal Process-wide immutable default factory. */
export const defaultForwardRenderPipelineFactory = Object.freeze(
    new ForwardRenderPipelineFactory()
);

/** @internal Default runtime marker used to bind the allocation-free direct recorder. */
export function isDirectForwardRenderPipeline(runtime: RenderPipeline): boolean {
    return runtime instanceof DirectForwardRenderPipeline;
}
