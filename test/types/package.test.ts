import {
    BasicLoader,
    BasicMaterial,
    BoxGeometry,
    constants,
    EventDispatcher,
    GLTFLoader,
    HiloEvent,
    Loader,
    Mesh,
    MeshPicker,
    PerspectiveCamera,
    Program,
    ProgramLinkError,
    ShaderCompilationError,
    Stage,
    Texture,
    Tween,
    WebGLRenderer,
    WebGLState,
    WebGPURenderer,
    NagaShaderTranslator,
    getWebGPUUniformBlockBinding,
    version,
    type BasicLoadRequest,
    type BasicMaterialParameters,
    type AreaLightParameters,
    type DispatchEvent,
    type EventListener,
    type GLContext,
    type KTXTextureOptions,
    type LoaderRequest,
    type MeshParameters,
    type ProgramParameters,
    type Renderer,
    type RendererBackend,
    type RendererResourceDiagnostics,
    type RenderTarget,
    type RenderTargetColorAttachmentReadback,
    type RenderTargetParameters,
    type StageParameters,
    type StageBackend,
    type StagePointerEvent,
    type StageRenderer,
    type ShadowCastingLightParameters,
    type TextureCompressionFormat,
    type TextureMipmap,
    type TexturePixelData,
    type TextureParameters,
    type TweenParameters,
    type WebGLRendererParameters,
    type WebGPUTextureDimension,
    type WebGPURendererParameters,
    type WebGPUSupportOptions
} from 'hilo3d';

const camera = new PerspectiveCamera({ aspect: 16 / 9, near: 0.1, far: 1_000, z: 4 });
const rendererParameters = {
    width: 640,
    height: 360,
    pixelRatio: 1
} satisfies WebGLRendererParameters;
const renderer = new WebGLRenderer(rendererParameters);
const stageParameters = {
    camera,
    width: rendererParameters.width,
    height: rendererParameters.height
} satisfies StageParameters;
const stage = new Stage(stageParameters);
const webgpuRendererParameters = {
    domElement: document.createElement('canvas'),
    width: 640,
    height: 360,
    pixelRatio: 1
} satisfies WebGPURendererParameters;
const webgpuRenderer = new WebGPURenderer(webgpuRendererParameters);
type WebgpuRendererPreserveDrawingBufferIsAbsent =
    'preserveDrawingBuffer' extends keyof WebGPURendererParameters ? false : true;
const webgpuRendererPreserveDrawingBufferIsAbsent: WebgpuRendererPreserveDrawingBufferIsAbsent = true;
const webgpuStageParameters = {
    backend: 'webgpu',
    camera,
    width: webgpuRendererParameters.width,
    height: webgpuRendererParameters.height
} satisfies StageParameters<'webgpu'>;
const webgpuStage = new Stage(webgpuStageParameters);
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
} satisfies StageParameters<'auto'>;
const autoStagePromise: Promise<Stage<RendererBackend>> = Stage.create(autoStageParameters);
const defaultStagePromise: Promise<Stage<RendererBackend>> = Stage.create();
declare const dynamicStageParameters: StageParameters<StageBackend>;
const dynamicStagePromise: Promise<Stage<RendererBackend>> = Stage.create(dynamicStageParameters);
const webgpuSupportOptions = {
    powerPreference: 'high-performance',
    requiredLimits: { maxBindGroups: 4 }
} satisfies WebGPUSupportOptions;
const webgpuSupportedPromise: Promise<boolean> = WebGPURenderer.isSupported(webgpuSupportOptions);
const typedWebgpuStageRenderer: StageRenderer<'webgpu'> = webgpuStage.renderer;
const selectedBackend: RendererBackend = webgpuRenderer.backend;
const areaLightHasShadow: 'shadow' extends keyof AreaLightParameters ? true : false = false;
const shadowCastingLightHasShadow: 'shadow' extends keyof ShadowCastingLightParameters
    ? true
    : false = true;
const nagaTranslator = new NagaShaderTranslator();
const cameraBlockBinding = getWebGPUUniformBlockBinding('CameraBlock');
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

const textureParameters = {
    uv: 0,
    anisotropic: 2,
    flipY: false
} satisfies TextureParameters;
const texture = new Texture(textureParameters);
const rawTextureStorage: TexturePixelData = new DataView(new ArrayBuffer(16));
const webgpuTextureDimensions = [
    '2d',
    'cube',
    '2d-array',
    '3d'
] as const satisfies readonly WebGPUTextureDimension[];
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

declare const gl: GLContext;
const state = new WebGLState(gl);
const programParameters = {
    state,
    vertexShader: '#version 300 es\nvoid main(){gl_Position=vec4(0.0);}',
    fragShader:
        '#version 300 es\nprecision mediump float;layout(location=0) out vec4 fragmentColor;void main(){fragmentColor=vec4(1.0);}'
} satisfies ProgramParameters;
const program = new Program(programParameters);
const compilationError = new ShaderCompilationError(
    gl.VERTEX_SHADER,
    'compile failed',
    '1 invalid shader'
);
const linkError = new ProgramLinkError('link failed');
const typedProgramErrors: readonly (ShaderCompilationError | ProgramLinkError)[] = [
    compilationError,
    linkError
];
typedProgramErrors.forEach(error => {
    error satisfies Error;
});

version satisfies string;
void renderer;
void stage;
void webgpuRenderer;
void webgpuRendererPreserveDrawingBufferIsAbsent;
void webgpuStagePreserveDrawingBufferIsNever;
void webgpuStagePromise;
void autoStagePromise;
void defaultStagePromise;
void dynamicStagePromise;
void webgpuSupportedPromise;
void typedWebgpuStageRenderer;
void selectedBackend;
void areaLightHasShadow;
void shadowCastingLightHasShadow;
void nagaTranslator;
void cameraBlockBinding;
void compressionSupport;
void ktxTextureOptions;
void colorReadbacks;
void resourceDiagnostics;
void rawTextureStorage;
void webgpuTextureDimensions;
void volumeTextureParameters;
void integerArrayTextureParameters;
void material;
void mesh;
void meshPicker;
void meshSelection;
void registryLoad;
void textLoad;
void modelLoad;
void tween;
void dispatchEvent;
void pointerListener;
void dispatcher;
void program;

export {};
