import {
    BasicLoader,
    BasicMaterial,
    BoxGeometry,
    EventDispatcher,
    GLTFLoader,
    HiloEvent,
    Loader,
    Mesh,
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
    type DispatchEvent,
    type EventListener,
    type GLContext,
    type LoaderRequest,
    type MeshParameters,
    type ProgramParameters,
    type RendererBackend,
    type StageParameters,
    type StagePointerEvent,
    type StageRenderer,
    type TextureParameters,
    type TweenParameters,
    type WebGLRendererParameters,
    type WebGPUColorAttachmentReadback,
    type WebGPUFramebufferParameters,
    type WebGPURendererParameters,
    type WebGPURenderTarget,
    type WebGPURenderTargetParameters
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
    pixelRatio: 1,
    useFramebuffer: true,
    framebufferOption: {
        sampleCount: 4,
        colorAttachments: [{ format: 'rgba16float' }]
    } satisfies WebGPUFramebufferParameters
} satisfies WebGPURendererParameters;
const webgpuRenderer = new WebGPURenderer(webgpuRendererParameters);
const webgpuStageParameters = {
    backend: 'webgpu',
    camera,
    width: webgpuRendererParameters.width,
    height: webgpuRendererParameters.height,
    useFramebuffer: true,
    framebufferOption: { sampleCount: 4, colorAttachments: [{ format: 'rgba8unorm' }] }
} satisfies StageParameters<'webgpu'>;
const webgpuStage = new Stage(webgpuStageParameters);
const webgpuStagePromise: Promise<Stage<'webgpu'>> = Stage.create(webgpuStageParameters);
const typedWebgpuStageRenderer: StageRenderer<'webgpu'> = webgpuStage.renderer;
const selectedBackend: RendererBackend = webgpuRenderer.backend;
const nagaTranslator = new NagaShaderTranslator();
const cameraBlockBinding = getWebGPUUniformBlockBinding('CameraBlock');
const renderTargetParameters = {
    width: 320,
    height: 180,
    sampleCount: 4,
    colorAttachments: [{ format: 'rgba16float' }]
} satisfies WebGPURenderTargetParameters;
const renderTarget: WebGPURenderTarget = webgpuRenderer.createRenderTarget(renderTargetParameters);
webgpuRenderer.setRenderTarget(renderTarget, { present: true, takeOwnership: true });
const colorReadback: Promise<WebGPUColorAttachmentReadback> = renderTarget.readColorAttachment();

const textureParameters = {
    uv: 0,
    anisotropic: 2,
    flipY: false
} satisfies TextureParameters;
const texture = new Texture(textureParameters);
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
void webgpuStagePromise;
void typedWebgpuStageRenderer;
void selectedBackend;
void nagaTranslator;
void cameraBlockBinding;
void colorReadback;
void material;
void mesh;
void registryLoad;
void textLoad;
void modelLoad;
void tween;
void dispatchEvent;
void pointerListener;
void dispatcher;
void program;

export {};
