import * as Hilo3d from '../../../src/Hilo3d';

function createFullscreenPass(
    renderer: Hilo3d.Renderer,
    label: string,
    fragmentShader: string,
    samplers: Readonly<Record<string, () => Hilo3d.Texture<unknown>>> = {}
): (target: Hilo3d.RenderTarget) => void {
    const vertexShader = Hilo3d.Shader.shaders['screen.vert'];
    if (!vertexShader) throw new Error('Built-in fullscreen vertex shader is unavailable');
    const scene = new Hilo3d.Node();
    const camera = new Hilo3d.Camera();
    const material = new Hilo3d.ShaderMaterial({
        shaderName: label,
        shaderCacheId: label,
        needBasicAttributes: false,
        needBasicUniforms: false,
        depthTest: false,
        depthMask: false,
        cullFace: false,
        side: Hilo3d.constants.FRONT_AND_BACK,
        attributes: { a_position: 'POSITION', a_texcoord0: 'TEXCOORD_0' },
        uniforms: Object.fromEntries(
            Object.entries(samplers).map(([name, provider]) => [name, { get: provider }])
        ),
        vs: vertexShader,
        fs: fragmentShader
    });
    scene.addChild(
        new Hilo3d.Mesh({
            geometry: new Hilo3d.Geometry({
                mode: Hilo3d.constants.TRIANGLE_STRIP,
                vertices: new Hilo3d.GeometryData(
                    new Float32Array([-1, 1, 1, 1, -1, -1, 1, -1]),
                    2
                ),
                uvs: new Hilo3d.GeometryData(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), 2)
            }),
            material,
            frustumTest: false
        })
    );
    return target => {
        renderer.renderToTarget(target, scene, camera, false);
    };
}

const requestedBackend = new URL(location.href).searchParams.get('backend');
if (requestedBackend !== 'webgl2' && requestedBackend !== 'webgpu') {
    throw new TypeError('Fullscreen orientation fixture requires backend=webgl2 or backend=webgpu');
}
const backend: Hilo3d.RendererBackend = requestedBackend;
const container = document.querySelector<HTMLElement>('#stage');
if (!container) throw new Error('Fullscreen orientation fixture container is missing');
const camera = new Hilo3d.PerspectiveCamera({ aspect: 1, near: 0.1, far: 10, z: 3 });
const stage = await Hilo3d.Stage.create<Hilo3d.RendererBackend>({
    backend,
    container,
    camera,
    width: 64,
    height: 64,
    pixelRatio: 1,
    antialias: false,
    clearColor: new Hilo3d.Color(0, 0, 0)
});
const renderer = stage.renderer;
const targetParameters = {
    width: 4,
    height: 4,
    sampleCount: 1 as const,
    depthStencilAttachment: false as const
};
const source = renderer.createRenderTarget({ ...targetParameters, label: 'orientation.source' });
const copied = renderer.createRenderTarget({ ...targetParameters, label: 'orientation.copied' });
const renderSource = createFullscreenPass(
    renderer,
    'OrientationSource',
    `#version 300 es
        precision highp float;
        layout(location = 0) out vec4 fragmentColor;
        void main(void) {
            fragmentColor = gl_FragCoord.y < 2.0
                ? vec4(1.0, 0.0, 0.0, 1.0)
                : vec4(0.0, 0.0, 1.0, 1.0);
        }
    `
);
const renderCopy = createFullscreenPass(
    renderer,
    'OrientationCopy',
    `#version 300 es
        precision highp float;
        in vec2 v_texcoord0;
        uniform sampler2D u_source;
        layout(location = 0) out vec4 fragmentColor;
        void main(void) {
            fragmentColor = textureLod(u_source, v_texcoord0, 0.0);
        }
    `,
    { u_source: () => source.getColorTexture() }
);

renderSource(source);
renderCopy(copied);
renderer.present(copied);
const [sourceReadback, copiedReadback] = await Promise.all([
    source.readColorAttachment(),
    copied.readColorAttachment()
]);
window.__HILO3D_FULLSCREEN_ORIENTATION_RESULT__ = {
    backend,
    source: [...sourceReadback.data],
    copied: [...copiedReadback.data]
};
document.body.dataset['fullscreenOrientationComplete'] = 'true';

declare global {
    interface Window {
        __HILO3D_FULLSCREEN_ORIENTATION_RESULT__?: {
            readonly backend: Hilo3d.RendererBackend;
            readonly source: readonly number[];
            readonly copied: readonly number[];
        };
    }
}
