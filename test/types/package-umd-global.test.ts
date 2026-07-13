import 'hilo3d/umd';

const camera = new Hilo3d.PerspectiveCamera({ z: 3 });
const stageParameters = { camera, width: 320, height: 180 } satisfies Hilo3d.StageParameters;
const stage = new Hilo3d.Stage(stageParameters);
const texture = new Hilo3d.Texture();
const material = new Hilo3d.BasicMaterial({ lightType: 'NONE', diffuse: texture });
const mesh = new Hilo3d.Mesh({ geometry: new Hilo3d.BoxGeometry(), material });
stage.addChild(mesh);

const loader = new Hilo3d.Loader();
const loadRequest = { src: '/model.glb', type: 'glb' } satisfies Hilo3d.LoaderRequest;
const load = loader.load(loadRequest);
const tweenParameters = { duration: 100 } satisfies Hilo3d.TweenParameters;
const tween = new Hilo3d.Tween({ x: 0 }, { x: 1 }, tweenParameters);

const compilationError: Error = new Hilo3d.ShaderCompilationError(
    0x8b31,
    'compile failed',
    '1 invalid shader'
);
const linkError: Error = new Hilo3d.ProgramLinkError('link failed');

void stage;
void load;
void tween;
void compilationError;
void linkError;
