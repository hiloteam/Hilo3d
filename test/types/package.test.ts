import {
    BasicLoader,
    BasicMaterial,
    BoxGeometry,
    ComputeKernel,
    ComputeRenderPass,
    ComputeSampler,
    ComputeShader,
    constants,
    createStorageLayout,
    EventDispatcher,
    GLTFLoader,
    HiloEvent,
    Loader,
    Mesh,
    MeshPicker,
    PerspectiveCamera,
    Renderer,
    SCENE_STORAGE_BIND_GROUP,
    SceneRenderPass,
    Stage,
    StorageGraphicsShader,
    Texture,
    Tween,
    GPUDrivenRenderPass,
    version,
    type BasicLoadRequest,
    type BasicMaterialParameters,
    type AreaLightParameters,
    type DispatchEvent,
    type EventListener,
    type ForwardRenderFeatureContext,
    type KTXTextureOptions,
    type LoaderRequest,
    type MeshParameters,
    type CullingResultsHandle,
    type ComputeTextureSampleType,
    type ComputeTextureViewDimension,
    type RendererBackend,
    type RendererResourceDiagnostics,
    type RendererSupportOptions,
    type RendererWebGL2Options,
    type RendererWebGPUOptions,
    type RenderTarget,
    type RenderTargetColorAttachmentReadback,
    type RenderTargetParameters,
    type RenderPipelineOutput,
    type RenderPipelineOutputColorAttachment,
    type RenderPipelineOutputDepthStencilAttachment,
    type RenderPipelineRequirements,
    type RenderGraphBufferHandle,
    type RenderGraphTextureHandle,
    type RendererListHandle,
    type StorageBuffer,
    type StorageBufferReadback,
    type ShaderTextureSampleType,
    type ShaderTextureViewDimension,
    type ScriptableRenderGraph,
    type StageParameters,
    type StageBackend,
    type StagePointerEvent,
    type ShadowCastingLightParameters,
    type TextureCompressionFormat,
    type TextureMipmap,
    type TexturePixelData,
    type TextureParameters,
    type TweenParameters
} from 'hilo3d';

const camera = new PerspectiveCamera({ aspect: 16 / 9, near: 0.1, far: 1_000, z: 4 });
const rendererParameters = {
    backend: 'webgl2',
    width: 640,
    height: 360,
    pixelRatio: 1
} satisfies RendererWebGL2Options;
const webglRendererPromise: Promise<Renderer<'webgl2'>> = Renderer.create(rendererParameters);
const renderer = await webglRendererPromise;
const stageParameters = {
    camera,
    width: rendererParameters.width,
    height: rendererParameters.height
} satisfies StageParameters;
const stage = await Stage.create(stageParameters);
const webgpuRendererParameters = {
    backend: 'webgpu',
    domElement: document.createElement('canvas'),
    width: 640,
    height: 360,
    pixelRatio: 1
} satisfies RendererWebGPUOptions;
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
const renderTargetParameters = {
    width: 320,
    height: 180,
    sampleCount: 4,
    colorAttachments: [{ format: 'rgba16float' }, { format: 'rgba8unorm' }]
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
renderer.setRenderTarget(webglRenderTarget, { present: true, takeOwnership: true });
webgpuRenderer.setRenderTarget(webgpuRenderTarget, { present: true, takeOwnership: true });
renderer.renderToTarget(webglRenderTarget, stage, camera);
webgpuRenderer.renderToTarget(webgpuRenderTarget, webgpuStage, camera);
renderers.forEach(currentRenderer => {
    currentRenderer.present(
        currentRenderer.backend === 'webgl2' ? webglRenderTarget : webgpuRenderTarget
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
const persistentTargetReleased: boolean = scriptableGraph.releasePersistentTarget(
    Object.freeze({})
);
const featureCullingResults: CullingResultsHandle = forwardFeatureContext.cullingResults;
const outputColorPolicy: Readonly<RenderPipelineOutputColorAttachment> =
    pipelineOutput.colorAttachment(0);
const outputDepthStencilPolicy: Readonly<RenderPipelineOutputDepthStencilAttachment> | null =
    pipelineOutput.depthStencilAttachment;

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
    transparent: false
} satisfies BasicMaterialParameters;
const material = new BasicMaterial(materialParameters);
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
    material,
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
