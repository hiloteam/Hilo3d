import * as Hilo3d from '../../../src/Hilo3d';
import * as Particle from '@hilo3d/addon-particle';

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
        sourceRevision: label,
        state: { depthTest: false, depthWrite: false, cullMode: 'none' },
        cullMode: 'none',
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

function createManagedMaterialPass(
    renderer: Hilo3d.Renderer,
    material: Hilo3d.BasicMaterial,
    positions: Float32Array,
    uvs?: Float32Array
): (target: Hilo3d.RenderTarget) => void {
    const scene = new Hilo3d.Node();
    const camera = new Hilo3d.OrthographicCamera({
        left: -1,
        right: 1,
        bottom: -1,
        top: 1,
        near: 0.1,
        far: 10,
        z: 3
    });
    camera.lookAt(new Hilo3d.Vector3(0, 0, 0));
    scene.addChild(
        new Hilo3d.Mesh({
            geometry: new Hilo3d.Geometry({
                mode: Hilo3d.constants.TRIANGLE_STRIP,
                vertices: new Hilo3d.GeometryData(positions, 3),
                ...(uvs === undefined ? {} : { uvs: new Hilo3d.GeometryData(uvs, 2) })
            }),
            material,
            frustumTest: false
        })
    );
    return target => {
        renderer.renderToTarget(target, scene, camera, false);
    };
}

function cubeFace(top: readonly [number, number, number, number], bottom = top): ImageData {
    return new ImageData(new Uint8ClampedArray([...top, ...top, ...bottom, ...bottom]), 2, 2);
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
const managed2D = renderer.createRenderTarget({
    ...targetParameters,
    label: 'orientation.managed-2d'
});
const managedCube = renderer.createRenderTarget({
    ...targetParameters,
    label: 'orientation.managed-cube'
});
const particleTarget = renderer.createRenderTarget({
    width: 8,
    height: 8,
    sampleCount: 1,
    depthStencilAttachment: false,
    label: 'orientation.particle'
});
const spriteTarget = renderer.createRenderTarget({
    width: 8,
    height: 8,
    sampleCount: 1,
    depthStencilAttachment: false,
    label: 'orientation.sprite'
});
const portableCoordinateShader = Hilo3d.Shader.shaders['method/portableCoordinates.glsl'];
if (!portableCoordinateShader) {
    throw new Error('Portable coordinate shader helpers are unavailable');
}
const renderSource = createFullscreenPass(
    renderer,
    'OrientationSource',
    `#version 300 es
        precision highp float;
        layout(location = 0) out vec4 fragmentColor;
        ${portableCoordinateShader}
        void main(void) {
            vec2 fragCoord = hiloBottomLeftFragCoord(gl_FragCoord.xy, vec2(4.0));
            fragmentColor = fragCoord.y < 2.0
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
const managedTexture = new Hilo3d.Texture({
    image: new ImageData(
        new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]),
        2,
        2
    ),
    internalFormat: Hilo3d.constants.RGBA8,
    format: Hilo3d.constants.RGBA,
    minFilter: Hilo3d.constants.webgl.NEAREST,
    magFilter: Hilo3d.constants.webgl.NEAREST
});
const quadPositions = new Float32Array([-1, 1, 0, 1, 1, 0, -1, -1, 0, 1, -1, 0]);
const renderManaged2D = createManagedMaterialPass(
    renderer,
    new Hilo3d.BasicMaterial({
        lightType: 'NONE',
        diffuse: managedTexture,
        state: { depthTest: false, depthWrite: false, cullMode: 'none' }
    }),
    quadPositions,
    new Float32Array([0, 0, 1, 0, 0, 1, 1, 1])
);
const blackFace = cubeFace([0, 0, 0, 255]);
const managedCubeTexture = new Hilo3d.CubeTexture({
    image: [
        blackFace,
        blackFace,
        blackFace,
        blackFace,
        cubeFace([255, 0, 0, 255], [0, 0, 255, 255]),
        blackFace
    ],
    internalFormat: Hilo3d.constants.RGBA8,
    format: Hilo3d.constants.RGBA,
    minFilter: Hilo3d.constants.webgl.NEAREST,
    magFilter: Hilo3d.constants.webgl.NEAREST
});
const renderManagedCube = createManagedMaterialPass(
    renderer,
    new Hilo3d.BasicMaterial({
        lightType: 'NONE',
        diffuse: managedCubeTexture,
        state: { depthTest: false, depthWrite: false, cullMode: 'none' }
    }),
    new Float32Array([-1, 1, 1, 1, 1, 1, -1, -1, 1, 1, -1, 1])
);
const particleTexture = new Hilo3d.Texture({
    image: new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255]),
    width: 2,
    height: 2,
    internalFormat: Hilo3d.constants.RGBA8,
    format: Hilo3d.constants.RGBA,
    type: Hilo3d.constants.UNSIGNED_BYTE,
    minFilter: Hilo3d.constants.webgl.NEAREST,
    magFilter: Hilo3d.constants.webgl.NEAREST,
    wrapS: Hilo3d.constants.webgl.CLAMP_TO_EDGE,
    wrapT: Hilo3d.constants.webgl.CLAMP_TO_EDGE
});
const particleScene = new Hilo3d.Node();
const particleCamera = new Hilo3d.OrthographicCamera({
    left: -1,
    right: 1,
    bottom: -1,
    top: 1,
    near: 0.1,
    far: 10,
    z: 3
});
particleCamera.lookAt(new Hilo3d.Vector3(0, 0, 0));
const particleSystem = new Particle.ParticleSystem({
    definition: Particle.ParticleSystemDefinition.create({
        emitters: [
            {
                name: 'orientation-sprite',
                capacity: 1,
                execution: 'cpu',
                bounds: { mode: 'manual', min: [-1, -1, -1], max: [1, 1, 1] },
                initialize: { lifetime: 10, speed: 0, size: 1.5 },
                renderers: [
                    {
                        type: 'sprite',
                        texture: particleTexture,
                        depthTest: false,
                        depthWrite: false
                    }
                ]
            }
        ]
    }),
    autoPlay: false,
    compilationEnvironment: { backend }
}).addTo(particleScene);
particleSystem.emit(1).simulate(1 / 60);
const spriteScene = new Hilo3d.Node();
const spriteCamera = new Hilo3d.Camera2D({ width: 8, height: 8 });
new Hilo3d.Sprite({
    texture: particleTexture,
    x: 4,
    y: 4,
    width: 6,
    height: 6
}).addTo(spriteScene);

renderSource(source);
renderCopy(copied);
renderManaged2D(managed2D);
renderManagedCube(managedCube);
renderer.renderToTarget(particleTarget, particleScene, particleCamera, false);
renderer.renderToTarget(spriteTarget, spriteScene, spriteCamera, false);
renderer.present(copied);
const [
    sourceReadback,
    copiedReadback,
    managed2DReadback,
    managedCubeReadback,
    particleReadback,
    spriteReadback
] = await Promise.all([
    source.readColorAttachment(),
    copied.readColorAttachment(),
    managed2D.readColorAttachment(),
    managedCube.readColorAttachment(),
    particleTarget.readColorAttachment(),
    spriteTarget.readColorAttachment()
]);
window.__HILO3D_FULLSCREEN_ORIENTATION_RESULT__ = {
    backend,
    source: [...sourceReadback.data],
    copied: [...copiedReadback.data],
    managed2D: [...managed2DReadback.data],
    managedCube: [...managedCubeReadback.data],
    particle: [...particleReadback.data],
    sprite: [...spriteReadback.data]
};
document.body.dataset['fullscreenOrientationComplete'] = 'true';

declare global {
    interface Window {
        __HILO3D_FULLSCREEN_ORIENTATION_RESULT__?: {
            readonly backend: Hilo3d.RendererBackend;
            readonly source: readonly number[];
            readonly copied: readonly number[];
            readonly managed2D: readonly number[];
            readonly managedCube: readonly number[];
            readonly particle: readonly number[];
            readonly sprite: readonly number[];
        };
    }
}
