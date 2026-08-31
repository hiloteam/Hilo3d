import {
    BasicLoader,
    BasicMaterial,
    BoxGeometry,
    ClusteredForwardPlusPipelineFactory,
    ComputeKernel,
    ComputeRenderPass,
    ComputeSampler,
    ComputeShader,
    constants,
    createStageSystemService,
    createStorageLayout,
    DEFAULT_MATERIAL_PIPELINE_STATE,
    DirectionalLight,
    EventDispatcher,
    GLTFLoader,
    HiloEvent,
    Loader,
    Mesh,
    MeshPicker,
    Node,
    OrbitControls,
    PBRMaterial,
    PerspectiveCamera,
    Renderer,
    SCENE_STORAGE_BIND_GROUP,
    SceneRenderPass,
    Stage,
    STAGE_SYSTEM_API_VERSION,
    SpotLight,
    StorageGraphicsShader,
    TemporalAA,
    Texture,
    Tween,
    Vector3,
    GPUDrivenRenderPass,
    version,
    type BasicLoadRequest,
    type CameraDepthMode,
    type BasicMaterialParameters,
    type AreaLightParameters,
    type DispatchEvent,
    type DirectionalLightShadowOptions,
    type EventListener,
    type ForwardRenderFeatureContext,
    type KTXTextureOptions,
    type LoaderRequest,
    type MeshParameters,
    type NodeParameters,
    type OrbitControlsOptions,
    type CullingResultsHandle,
    type ComputeTextureSampleType,
    type ComputeTextureViewDimension,
    type ClusteredMaterialVariantManifest,
    type RendererBackend,
    type RendererResourceDiagnostics,
    type RendererRenderingProfile,
    type RendererSupportOptions,
    type RendererWebGL2Options,
    type RendererWebGPUOptions,
    type RenderColorEncoding,
    type RenderTarget,
    type RenderTargetColorAttachmentReadback,
    type RenderTargetParameters,
    type RenderPipelineOutput,
    type RenderPipelineOutputColorAttachment,
    type RenderPipelineOutputDepthStencilAttachment,
    type RenderPipelineRequirements,
    type RenderGraphBufferHandle,
    type RenderGraphTextureAccessHandle,
    type RenderGraphTextureHandle,
    type RenderGraphTimelineSnapshot,
    type RenderGraphTextureViewHandle,
    type RenderPipelineHistoryTextureResources,
    type RenderPipelineTextureFormat,
    type RendererListHandle,
    type StorageBuffer,
    type StorageBufferReadback,
    type SpotLightCookie,
    type SpotLightIESProfile,
    type TemporalAAOptions,
    type DynamicResolutionOptions,
    type ShaderTextureSampleType,
    type ShaderTextureViewDimension,
    type ScriptableRenderGraph,
    type StageParameters,
    type StageBackend,
    type StageSystem,
    type StagePointerEvent,
    type ShadowCastingLightParameters,
    type TextureCompressionFormat,
    type TextureMipmap,
    type TexturePixelData,
    type TextureParameters,
    type TweenParameters
} from 'hilo3d';
import {
    ParticleAuthoringPreviewController,
    ParticleBudgetManager,
    ParticleCurve,
    ParticleEventChannel,
    ParticleGradient,
    ParticleParameter,
    ParticleParameterSet,
    ParticleSystem,
    ParticleSystemDefinition,
    ParticleSystemPool,
    PARTICLE_STAGE_SERVICE,
    analyzeParticleStatelessEligibility,
    compileParticleAuthoringGraph,
    createParticleAuthoringGraph,
    createParticleStageSystem,
    deserializeParticleSystemDefinition,
    parseParticleSystemDefinitionJSON,
    PARTICLE_DEFINITION_SCHEMA,
    PARTICLE_AUTHORING_JSON_SCHEMA,
    PARTICLE_AUTHORING_SCHEMA,
    PARTICLE_AUTHORING_VERSION,
    PARTICLE_BAKE_VERSION,
    PARTICLE_PREVIEW_PROTOCOL_VERSION,
    PARTICLE_SIMULATION_CACHE_VERSION,
    serializeParticleSystemDefinition,
    type ParticleModule,
    type ParticleAdvancedQualityPlan,
    type ParticleAuthoringCompileResult,
    type ParticleAuthoringGraph,
    type ParticleAuthoringPreviewRequest,
    type ParticleAuthoringPreviewResponse,
    type ParticleBudgetProfile,
    type ParticleFlipbook,
    type ParticleFlipbookOptions,
    type ParticleMeshCache,
    type ParticleMeshCacheOptions,
    type ParticleMeshRendererDefinition,
    type ParticleDefinitionDeserializationOptions,
    type ParticleDefinitionSerializationOptions,
    type ParticleDefinitionUpgrade,
    type ParticleSystemDefinitionJSON,
    type ParticleRibbonRendererDefinition,
    type ParticleSimulationCache,
    type ParticleStatelessSupport,
    type ParticleSystemDefinitionInput,
    type ParticleSystemParameters
} from '@hilo3d/addon-particle';
import { createPhysicsStageSystem } from '@hilo3d/addon-physics';
import { createRapier2DPhysicsSystem } from '@hilo3d/addon-physics/rapier2d';
import { createRapier3DPhysicsSystem } from '@hilo3d/addon-physics/rapier3d';

const clusteredGeometry = new BoxGeometry();
const clusteredMaterial = new PBRMaterial({ clearcoatFactor: 0.5 });
const clusteredExemplar = new Mesh({
    geometry: clusteredGeometry,
    material: clusteredMaterial
});
const clusteredManifest = {
    entries: [{ mesh: clusteredExemplar, shadowed: true }],
    maxVariants: 8,
    warmupBatchSize: 2
} satisfies ClusteredMaterialVariantManifest;
const clusteredFactory = new ClusteredForwardPlusPipelineFactory({
    buckets: [{ geometry: new BoxGeometry(), material: new PBRMaterial() }],
    variantManifest: clusteredManifest
});
const spotCookie = {
    scale: [0.8, 0.6],
    offset: [0.1, -0.1],
    intensity: 0.9,
    softness: 0.2
} as const satisfies SpotLightCookie;
const spotIES = { intensity: 1.1, exponent: 1.5 } satisfies SpotLightIESProfile;
const clusteredSpot = new SpotLight({
    lightLayerMask: 3,
    cookie: spotCookie,
    iesProfile: spotIES
});
void clusteredFactory;
void clusteredSpot;

const orderedNodeParameters = {
    sortingLayer: 100,
    zIndex: 20
} satisfies NodeParameters;
const orderedNode = new Node(orderedNodeParameters);
orderedNode.zIndex = 21;

const depthMode: CameraDepthMode = 'reversed';
const camera = new PerspectiveCamera({
    aspect: 16 / 9,
    near: 0.1,
    far: null,
    depthMode,
    z: 4
});
camera.invalidateTransformHistory();
const rendererParameters = {
    backend: 'webgl2',
    width: 640,
    height: 360,
    pixelRatio: 1
} satisfies RendererWebGL2Options;
const webglRendererPromise: Promise<Renderer<'webgl2'>> = Renderer.create(rendererParameters);
const renderer = await webglRendererPromise;
const exampleService = createStageSystemService<number>('example/value');
const exampleSystem = {
    descriptor: {
        id: 'example/system',
        version: '1.0.0',
        apiVersion: STAGE_SYSTEM_API_VERSION,
        provides: [exampleService]
    },
    setup(context) {
        context.provide(exampleService, 1);
        return {};
    }
} satisfies StageSystem;
const stageParameters = {
    camera,
    width: rendererParameters.width,
    height: rendererParameters.height,
    systems: [exampleSystem]
} satisfies StageParameters;
const stage = await Stage.create(stageParameters);
void PARTICLE_STAGE_SERVICE;
void createParticleStageSystem;
void createPhysicsStageSystem;
void createRapier2DPhysicsSystem;
void createRapier3DPhysicsSystem;
const orbitControlsOptions = {
    camera,
    target: new Vector3(0, 0, 0),
    enablePan: false,
    minDistance: 1,
    maxDistance: 20
} satisfies OrbitControlsOptions;
const orbitControls = new OrbitControls(stage, orbitControlsOptions);
orbitControls.setView(camera.position, orbitControls.target);
orbitControls.dispose();
const particleModules = [
    { type: 'gravity', force: [0, -1, 0] },
    {
        type: 'size-over-lifetime',
        curve: new ParticleCurve([
            { time: 0, value: 1 },
            { time: 1, value: 0 }
        ])
    },
    {
        type: 'color-over-lifetime',
        gradient: new ParticleGradient([
            { time: 0, color: [1, 1, 1, 1] },
            { time: 1, color: [1, 0, 0, 0] }
        ])
    },
    {
        type: 'collision',
        colliders: [{ type: 'plane', normal: [0, 1, 0] }],
        event: 'impact'
    }
] satisfies readonly ParticleModule[];
const particleRate = new ParticleParameter('type.spawn-rate', 'float', 8);
const particleParameters = new ParticleParameterSet().set(particleRate, 12);
const particleDefinitionInput = {
    emitters: [
        {
            name: 'type-consumer',
            capacity: 64,
            execution: 'cpu',
            eventCapacity: 32,
            emission: { rateOverTime: particleRate },
            initialize: { lifetime: 1, size: 0.1 },
            bounds: { mode: 'manual', min: [-2, -2, -2], max: [2, 2, 2] },
            modules: particleModules,
            renderers: [{ type: 'sprite', blend: 'additive' }]
        }
    ]
} satisfies ParticleSystemDefinitionInput;
const particleDefinition = ParticleSystemDefinition.create(particleDefinitionInput);
const particleSerializationOptions = {} satisfies ParticleDefinitionSerializationOptions;
const particleDefinitionJSON: Readonly<ParticleSystemDefinitionJSON> =
    serializeParticleSystemDefinition(particleDefinition, particleSerializationOptions);
const particleUpgrade = {
    fromVersion: 0,
    upgrade: document => ({ ...document, version: 1, parameters: [] })
} satisfies ParticleDefinitionUpgrade;
const particleDeserializationOptions = {
    upgrades: [particleUpgrade]
} satisfies ParticleDefinitionDeserializationOptions;
const decodedParticleDefinition = deserializeParticleSystemDefinition(particleDefinitionJSON);
const parsedParticleDefinition = parseParticleSystemDefinitionJSON(
    JSON.stringify(particleDefinitionJSON)
);
const particleAuthoringGraph: Readonly<ParticleAuthoringGraph> =
    createParticleAuthoringGraph(particleDefinition);
const particleAuthoringResult: ParticleAuthoringCompileResult =
    compileParticleAuthoringGraph(particleAuthoringGraph);
const particlePreviewRequest = {
    protocolVersion: PARTICLE_PREVIEW_PROTOCOL_VERSION,
    requestId: 'package-type-preview',
    command: 'compile',
    graph: particleAuthoringGraph,
    seed: 42
} satisfies ParticleAuthoringPreviewRequest;
const particlePreview = new ParticleAuthoringPreviewController();
const particlePreviewResponse: Readonly<ParticleAuthoringPreviewResponse> =
    particlePreview.handle(particlePreviewRequest);
void PARTICLE_AUTHORING_JSON_SCHEMA;
void PARTICLE_AUTHORING_SCHEMA;
void PARTICLE_AUTHORING_VERSION;
void particleAuthoringResult;
void particlePreviewResponse;
void PARTICLE_DEFINITION_SCHEMA;
void PARTICLE_BAKE_VERSION;
void PARTICLE_SIMULATION_CACHE_VERSION;
void particleDeserializationOptions;
void decodedParticleDefinition;
void parsedParticleDefinition;
const particleMeshRenderer = {
    type: 'mesh',
    meshes: [{ geometry: new BoxGeometry() }],
    coverage: 'opaque',
    lighting: 'lambert',
    motionVectors: true
} satisfies ParticleMeshRendererDefinition;
const particleRibbonRenderer = {
    type: 'trail',
    widthScale: 0.5,
    uvMode: 'repeat',
    tilesPerUnit: 2
} satisfies ParticleRibbonRendererDefinition;
const particleAdvancedQuality = {
    ribbons: true,
    litParticles: true,
    motionVectors: true
} satisfies ParticleAdvancedQualityPlan;
void particleMeshRenderer;
void particleRibbonRenderer;
void particleAdvancedQuality;
const particleSystemParameters = {
    definition: particleDefinition,
    seed: 42,
    autoPlay: false,
    parameters: particleParameters,
    budgetId: 'type-consumer'
} satisfies ParticleSystemParameters;
const particleSystem = new ParticleSystem(particleSystemParameters);
const particleSimulationCache: ParticleSimulationCache = particleSystem.captureSimulation();
particleSystem.restoreSimulation(particleSimulationCache);
const particleMeshCacheOptions = {
    duration: 1,
    frameRate: 30
} satisfies ParticleMeshCacheOptions;
const particleMeshCache: ParticleMeshCache = particleSystem.bakeMeshCache(particleMeshCacheOptions);
const particleFlipbookOptions = {
    duration: 1,
    frameRate: 30,
    captureFrame: () => ({
        data: new Uint8Array(4),
        format: 'rgba8unorm' as const,
        width: 1,
        height: 1,
        bytesPerPixel: 4,
        bytesPerRow: 4
    })
} satisfies ParticleFlipbookOptions;
const particleFlipbook: Promise<ParticleFlipbook> =
    particleSystem.bakeFlipbook(particleFlipbookOptions);
void particleMeshCache;
void particleFlipbook;
particleSystem
    .emit(4)
    .simulate(1 / 60)
    .play()
    .pause()
    .restart();
const particleEventChannel = new ParticleEventChannel<{
    readonly position: readonly [number, number, number];
    readonly kind: number;
}>({
    name: 'type-consumer-impact',
    capacity: 8,
    schema: { position: 'vec3', kind: 'uint' }
});
particleEventChannel.submit({ position: [0, 1, 0], kind: 1 });
particleEventChannel.emitTo(particleSystem, { positionField: 'position' });
void particleSystem.readEvents(8);
const particleBudgetProfile = {
    maxSystems: 32,
    maxParticles: 10_000,
    sorting: false
} satisfies ParticleBudgetProfile;
const particleBudgetManager = new ParticleBudgetManager(particleBudgetProfile);
particleBudgetManager.apply([particleSystem]);
const particleEmitter = particleDefinition.emitters[0];
if (!particleEmitter) throw new Error('Particle type fixture requires an emitter');
const statelessSupport: ParticleStatelessSupport =
    analyzeParticleStatelessEligibility(particleEmitter)[0]?.support ?? 'exact';
const particleSystemPool = new ParticleSystemPool(4);
const pooledParticles = particleSystemPool.acquire({
    definition: particleDefinition,
    seed: 42,
    autoPlay: false
});
particleSystemPool.release(pooledParticles);
void statelessSupport;
const webgpuRendererParameters = {
    backend: 'webgpu',
    domElement: document.createElement('canvas'),
    width: 640,
    height: 360,
    pixelRatio: 1,
    renderingProfile: 'high-end'
} satisfies RendererWebGPUOptions;
const renderingProfile: RendererRenderingProfile = webgpuRendererParameters.renderingProfile;
const webgpuRendererPromise: Promise<Renderer<'webgpu'>> =
    Renderer.create(webgpuRendererParameters);
const webgpuRenderer = await webgpuRendererPromise;
type WebgpuRendererPreserveDrawingBufferValue = Exclude<
    RendererWebGPUOptions['preserveDrawingBuffer'],
    undefined
>;
const webgpuRendererPreserveDrawingBufferIsNever: WebgpuRendererPreserveDrawingBufferValue extends never
    ? true
    : false = true;
const webgpuStageParameters = {
    backend: 'webgpu',
    camera,
    width: webgpuRendererParameters.width,
    height: webgpuRendererParameters.height
} satisfies StageParameters<'webgpu'>;
const webgpuStage = await Stage.create(webgpuStageParameters);
type WebgpuStagePreserveDrawingBufferValue = Exclude<
    StageParameters<'webgpu'>['preserveDrawingBuffer'],
    undefined
>;
const webgpuStagePreserveDrawingBufferIsNever: WebgpuStagePreserveDrawingBufferValue extends never
    ? true
    : false = true;
const webgpuStagePromise: Promise<Stage<'webgpu'>> = Stage.create(webgpuStageParameters);
const autoBackend: StageBackend = 'auto';
const autoStageParameters = {
    backend: autoBackend,
    requiredLimits: { maxBindGroups: 4 }
} satisfies StageParameters;
const autoStagePromise: Promise<Stage> = Stage.create(autoStageParameters);
const defaultStagePromise: Promise<Stage> = Stage.create();
declare const dynamicStageParameters: StageParameters<StageBackend>;
const dynamicStagePromise: Promise<Stage> = Stage.create(dynamicStageParameters);
const webgpuSupportOptions = {
    powerPreference: 'high-performance',
    requiredLimits: { maxBindGroups: 4 }
} satisfies RendererSupportOptions;
const webgpuSupportedPromise: Promise<boolean> = Renderer.isBackendSupported(
    'webgpu',
    webgpuSupportOptions
);
const webglSupportedPromise: Promise<boolean> = Renderer.isBackendSupported(
    'webgl2',
    rendererParameters
);
const autoRendererPromise: Promise<Renderer> = Renderer.create({
    backend: 'auto',
    ...webgpuSupportOptions
});
const stageWebgpuRenderContract: Renderer<'webgpu'> = webgpuStage.renderer;
const selectedBackend: RendererBackend = webgpuRenderer.backend;
const areaLightHasShadow: 'shadow' extends keyof AreaLightParameters ? true : false = false;
const shadowCastingLightHasShadow: 'shadow' extends keyof ShadowCastingLightParameters
    ? true
    : false = true;
const cascadedDirectionalShadow = {
    cascadeCount: 4,
    cascadeSplitLambda: 0.65,
    cascadeMaxDistance: 250,
    cascadeBlend: 0.1,
    stabilizeCascades: true,
    shadowStrength: 1.5
} satisfies DirectionalLightShadowOptions;
const cascadedDirectionalLight = new DirectionalLight({ shadow: cascadedDirectionalShadow });
if (cascadedDirectionalLight.shadow !== null) {
    cascadedDirectionalLight.shadow.cascadeCount = 3;
}
const renderTargetParameters = {
    width: 320,
    height: 180,
    sampleCount: 4,
    colorAttachments: [{ format: 'rgba16float' }, { format: 'rgba8unorm' }],
    depthStencilAttachment: { depthMode: 'reversed', sampled: true }
} satisfies RenderTargetParameters;
const renderers: readonly Renderer[] = [renderer, webgpuRenderer];
const compressionFormat: TextureCompressionFormat = 'bc';
const ktxTextureOptions = {
    minFilter: 9729,
    anisotropic: 2,
    isImageCanRelease: true
} satisfies KTXTextureOptions;
const compressionSupport: readonly boolean[] = renderers.map(currentRenderer =>
    currentRenderer.supportsTextureCompression(compressionFormat)
);
const webglRenderTarget: RenderTarget = renderer.createRenderTarget(renderTargetParameters);
const webgpuRenderTarget: RenderTarget = webgpuRenderer.createRenderTarget(renderTargetParameters);
const displayEncoding: RenderColorEncoding = 'srgb';
renderer.setRenderTarget(webglRenderTarget, {
    present: true,
    takeOwnership: true,
    colorEncoding: displayEncoding
});
webgpuRenderer.setRenderTarget(webgpuRenderTarget, { present: true, takeOwnership: true });
renderer.renderToTarget(webglRenderTarget, stage, camera);
webgpuRenderer.renderToTarget(webgpuRenderTarget, webgpuStage, camera);
renderers.forEach(currentRenderer => {
    currentRenderer.present(
        currentRenderer.backend === 'webgl2' ? webglRenderTarget : webgpuRenderTarget,
        { colorEncoding: 'linear' }
    );
});
const colorReadbacks: readonly Promise<RenderTargetColorAttachmentReadback>[] = [
    webglRenderTarget.readColorAttachment({ attachmentIndex: 1 }),
    webgpuRenderTarget.readColorAttachment({ attachmentIndex: 1 })
];
const resourceDiagnostics: RendererResourceDiagnostics =
    webgpuRenderer.resourceManager.getDiagnostics(webgpuStage);
const webglIdlePromise: Promise<void> = renderer.waitForIdle();
const webgpuIdlePromise: Promise<void> = webgpuRenderer.waitForIdle();
declare const scriptableGraph: ScriptableRenderGraph;
declare const forwardFeatureContext: ForwardRenderFeatureContext;
declare const pipelineOutput: RenderPipelineOutput;
const graphTextureFormat: RenderPipelineTextureFormat = 'r32float';
const graphMipChain: RenderGraphTextureHandle = scriptableGraph.createTexture('typed mip chain', {
    format: graphTextureFormat,
    extent: { width: 8, height: 8 },
    mipLevelCount: 2
});
const graphMipView: RenderGraphTextureViewHandle = scriptableGraph.createTextureView(
    'typed mip view',
    graphMipChain,
    { baseMipLevel: 1, mipLevelCount: 1 }
);
const graphTextureAccess: RenderGraphTextureAccessHandle = graphMipView;
const typedHistory: RenderPipelineHistoryTextureResources = scriptableGraph.acquireHistoryTexture(
    Object.freeze({}),
    {
        format: 'rgba16float',
        extent: { relativeTo: 'output', scale: 1 },
        usage: ['sampled', 'storage'],
        bufferCount: 3
    }
);
const typedPreviousHistory: RenderGraphTextureHandle = typedHistory.history();
const persistentTargetReleased: boolean = scriptableGraph.releasePersistentTarget(
    Object.freeze({})
);
const featureCullingResults: CullingResultsHandle = forwardFeatureContext.cullingResults;
forwardFeatureContext.resources.replaceDepth(graphMipChain);
const temporalAAOptions = { renderScale: 0.75, sharpness: 0.1 } satisfies TemporalAAOptions;
const temporalAA = new TemporalAA(temporalAAOptions);
const dynamicResolutionOptions = {
    minScale: 0.6,
    targetFrameTimeMs: 16.667
} satisfies DynamicResolutionOptions;
const dynamicTemporalAA = new TemporalAA({ dynamicResolution: dynamicResolutionOptions });
const timelineSnapshot: RenderGraphTimelineSnapshot | null = null;
const outputColorPolicy: Readonly<RenderPipelineOutputColorAttachment> =
    pipelineOutput.colorAttachment(0);
const outputDepthStencilPolicy: Readonly<RenderPipelineOutputDepthStencilAttachment> | null =
    pipelineOutput.depthStencilAttachment;
void graphTextureAccess;
void typedPreviousHistory;
void dynamicTemporalAA;
void timelineSnapshot;

const textureParameters = {
    uv: 0,
    anisotropic: 2,
    flipY: false
} satisfies TextureParameters;
const texture = new Texture(textureParameters);
const rawTextureStorage: TexturePixelData = new DataView(new ArrayBuffer(16));
const volumeBasePixels = new Uint8Array(2 * 2 * 2 * 4);
const volumeMipmaps = [
    { width: 2, height: 2, depth: 2, data: volumeBasePixels },
    { width: 1, height: 1, depth: 1, data: new Uint8Array(4) }
] satisfies TextureMipmap[];
const volumeTextureParameters = {
    target: constants.TEXTURE_3D,
    internalFormat: constants.RGBA8,
    format: constants.RGBA,
    type: constants.UNSIGNED_BYTE,
    width: 2,
    height: 2,
    depth: 2,
    image: volumeBasePixels,
    mipmaps: volumeMipmaps,
    magFilter: constants.NEAREST,
    minFilter: constants.NEAREST_MIPMAP_NEAREST,
    wrapS: constants.CLAMP_TO_EDGE,
    wrapT: constants.CLAMP_TO_EDGE,
    wrapR: constants.CLAMP_TO_EDGE,
    anisotropic: 1
} satisfies TextureParameters<Uint8Array>;
const integerArrayBasePixels = new Uint8Array(2 * 2 * 2 * 4);
const integerArrayMipmaps = [
    { width: 2, height: 2, depth: 2, data: integerArrayBasePixels },
    { width: 1, height: 1, depth: 2, data: new Uint8Array(2 * 4) }
] satisfies TextureMipmap[];
const integerArrayTextureParameters = {
    target: constants.TEXTURE_2D_ARRAY,
    internalFormat: constants.RGBA8UI,
    format: constants.RGBA_INTEGER,
    type: constants.UNSIGNED_BYTE,
    width: 2,
    height: 2,
    depth: 2,
    image: integerArrayBasePixels,
    mipmaps: integerArrayMipmaps,
    magFilter: constants.NEAREST,
    minFilter: constants.NEAREST_MIPMAP_NEAREST,
    wrapR: constants.CLAMP_TO_EDGE,
    anisotropic: 1
} satisfies TextureParameters<Uint8Array>;
const materialParameters = {
    lightType: 'NONE',
    diffuse: texture,
    temporalReactiveFactor: 0.5,
    compositing: { mode: 'opaque' }
} satisfies BasicMaterialParameters;
const material = new BasicMaterial(materialParameters);
material.temporalReactiveFactor = 0.25;
const meshParameters = {
    geometry: new BoxGeometry(),
    material,
    frustumTest: true
} satisfies MeshParameters;
const mesh = new Mesh(meshParameters);
stage.addChild(mesh);
const meshPicker = new MeshPicker({ stage });
const meshSelection: Promise<Mesh[]> = meshPicker.getSelection(0, 0);

const storageLayout = createStorageLayout({
    position: 'vec4<f32>',
    lifetime: 'f32',
    metadata: { type: 'struct', fields: { flags: 'u32', velocity: 'vec3<f32>' } }
});
const storageInitialData = storageLayout.createBuffer({
    position: [0, 1, 2, 1],
    lifetime: 1,
    metadata: { flags: 1, velocity: [0, 0, 0] }
});
const storageBuffer: StorageBuffer = webgpuRenderer.createStorageBuffer({
    label: 'Type consumer storage',
    byteLength: storageInitialData.byteLength,
    usage: ['storage', 'vertex', 'indirect', 'copy-source', 'copy-destination'],
    initialData: storageInitialData,
    recovery: 'cpu-shadow'
});
storageBuffer.write(storageLayout.fields.lifetime.offset, new Float32Array([0.5]));
const storageReadback: Promise<StorageBufferReadback> = storageBuffer.read();
const graphStorageBuffer: RenderGraphBufferHandle =
    scriptableGraph.importStorageBuffer(storageBuffer);
const transientStorageBuffer: RenderGraphBufferHandle = scriptableGraph.createBuffer(
    'Type consumer transient storage',
    { byteLength: 256 }
);
const graphOutput = scriptableGraph.importOutput();
const graphColor: RenderGraphTextureHandle = graphOutput.color(0);

const computeShader = new ComputeShader({
    label: 'Type consumer compute',
    source: `
        @group(0) @binding(0) var<storage, read_write> values: array<u32>;
        override scale: u32;
        @compute @workgroup_size(64)
        fn main(@builtin(global_invocation_id) id: vec3<u32>) {
            values[id.x] = values[id.x] * scale;
        }
    `,
    entryPoint: 'main',
    workgroupSize: [64],
    bindings: [
        { name: 'values', group: 0, binding: 0, kind: 'storage-buffer', access: 'read-write' }
    ]
});
const computeKernel = new ComputeKernel({ shader: computeShader, constants: { scale: 2 } });
const computePass = new ComputeRenderPass(computeKernel);
const computeSampler = new ComputeSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
    maxAnisotropy: 2
});
scriptableGraph.addPass(computePass, {
    buffers: [{ buffer: graphStorageBuffer }],
    textures: [],
    dispatch: { x: 1 }
});

const storageGraphicsShader = new StorageGraphicsShader({
    label: 'Type consumer storage graphics',
    vertexSource: `#version 310 es
        layout(std430) readonly buffer Values {
            vec4 values[];
        };
        void main() { gl_Position = values[gl_VertexID]; }
    `,
    fragmentSource: `#version 310 es
        precision highp float;
        layout(location = 0) out vec4 fragColor;
        void main() { fragColor = vec4(1.0); }
    `,
    bindings: [
        {
            name: 'Values',
            group: SCENE_STORAGE_BIND_GROUP,
            binding: 0,
            kind: 'read-only-storage-buffer'
        }
    ]
});
const gpuDrivenPass = new GPUDrivenRenderPass({
    shader: storageGraphicsShader,
    pipelineState: DEFAULT_MATERIAL_PIPELINE_STATE,
    vertexLayouts: []
});
scriptableGraph.addPass(gpuDrivenPass, {
    buffers: [{ buffer: graphStorageBuffer }],
    draw: { kind: 'draw-indirect', buffer: graphStorageBuffer },
    colorAttachments: [{ texture: graphColor, loadOp: 'load', storeOp: 'store' }]
});
declare const typeConsumerRendererList: RendererListHandle;
const sceneStoragePass = new SceneRenderPass('Type consumer Forward+');
scriptableGraph.addPass(sceneStoragePass, {
    rendererList: typeConsumerRendererList,
    colorAttachments: [{ texture: graphColor, loadOp: 'load', storeOp: 'store' }],
    storageShaderVariant: {
        shader: storageGraphicsShader,
        buffers: [{ buffer: graphStorageBuffer }]
    }
});
const computeRequirements = {
    requiredCapabilities: ['storage-buffer', 'compute-pass', 'indirect-draw'],
    requiredLimits: { maxComputeWorkgroupsPerDimension: 1 }
} satisfies RenderPipelineRequirements;
const computeTextureSampleType: ComputeTextureSampleType = 'unfilterable-float';
const computeTextureViewDimension: ComputeTextureViewDimension = '2d';
const storageGraphicsSampleType: ShaderTextureSampleType = 'uint';
const storageGraphicsViewDimension: ShaderTextureViewDimension = 'cube';

const registry = new Loader();
const transport = new BasicLoader();
const gltfLoader = new GLTFLoader(transport);
const loaderRequest = { src: '/models/scene.glb', type: 'glb' } satisfies LoaderRequest;
const textRequest = { src: '/data/config.json', type: 'json' } satisfies BasicLoadRequest;
const registryLoad = registry.load(loaderRequest);
const textLoad = transport.load(textRequest);
const modelLoad = gltfLoader.load(loaderRequest);

const tweenParameters = {
    duration: 250,
    ease: Tween.Ease.Quad.EaseOut,
    onUpdate(ratio, tween) {
        ratio satisfies number;
        tween satisfies Tween;
    }
} satisfies TweenParameters;
const tween = new Tween({ x: 0 }, { x: 1 }, tweenParameters);

const readyEvent = new HiloEvent('ready', stage, { initialized: true });
const dispatchEvent: DispatchEvent = readyEvent;
const eventListener: EventListener = event => {
    event.type satisfies string;
};
const pointerListener: EventListener<StagePointerEvent> = event => {
    event.stageX satisfies number;
    event.stageY satisfies number;
};
const dispatcher = new EventDispatcher().on('ready', eventListener);

version satisfies string;
void renderer;
void stage;
void webgpuRenderer;
void renderingProfile;
void webglRendererPromise;
void webgpuRendererPromise;
void webgpuRendererPreserveDrawingBufferIsNever;
void webgpuStagePreserveDrawingBufferIsNever;
void webgpuStagePromise;
void autoStagePromise;
void defaultStagePromise;
void dynamicStagePromise;
void webgpuSupportedPromise;
void webglSupportedPromise;
void autoRendererPromise;
void stageWebgpuRenderContract;
void selectedBackend;
void areaLightHasShadow;
void shadowCastingLightHasShadow;
void compressionSupport;
void ktxTextureOptions;
void colorReadbacks;
void resourceDiagnostics;
void webglIdlePromise;
void webgpuIdlePromise;
void persistentTargetReleased;
void featureCullingResults;
void temporalAA;
void outputColorPolicy;
void outputDepthStencilPolicy;
void rawTextureStorage;
void volumeTextureParameters;
void integerArrayTextureParameters;
void material;
void mesh;
void meshPicker;
void meshSelection;
void storageReadback;
void transientStorageBuffer;
void computeSampler;
void computeRequirements;
void computeTextureSampleType;
void computeTextureViewDimension;
void storageGraphicsSampleType;
void storageGraphicsViewDimension;
void registryLoad;
void textLoad;
void modelLoad;
void tween;
void dispatchEvent;
void pointerListener;
void dispatcher;

export {};
