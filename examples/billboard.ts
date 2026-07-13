import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { camera, renderer, stage } = createExampleContext();

const planeGeometry = new Hilo3d.PlaneGeometry();
const billboardTexture = new Hilo3d.LazyTexture({
    src: new URL('./image/brdfLUT.png', import.meta.url).href
});
Hilo3d.registerUniformBlockBinding('BillboardCameraBlock');
Hilo3d.registerUniformBlockBinding('BillboardModelBlock');
const cameraLayout = Hilo3d.createStd140Layout({ u_projectionMatrix: 'mat4' });
const cameraBlock = Hilo3d.UniformBuffer.fromSchema(cameraLayout);
const modelLayout = Hilo3d.createStd140Layout({
    u_modelViewMatrix: 'mat4',
    u_scale: 'vec3'
});
const billboardScale = new Hilo3d.Vector3();
renderer.on('beforeRender', () => {
    cameraBlock.set('u_projectionMatrix', camera.projectionMatrix.elements);
});

const fragmentShader = `#version 300 es
    precision highp float;
    in vec2 v_texcoord0;
    uniform sampler2D u_diffuse;
    layout(location = 0) out vec4 fragmentColor;

    void main(void) {
        fragmentColor = texture(u_diffuse, v_texcoord0);
    }
`;
const vertexShader = `#version 300 es
    precision highp float;
    in vec3 a_position;
    in vec2 a_texcoord0;
    out vec2 v_texcoord0;
    layout(std140) uniform BillboardCameraBlock {
        mat4 u_projectionMatrix;
    };
    layout(std140) uniform BillboardModelBlock {
        mat4 u_modelViewMatrix;
        vec3 u_scale;
    };

    void main(void) {
        vec4 center = u_modelViewMatrix * vec4(0, 0, 0, 1);
        center.xy += a_position.xy * u_scale.xy;
        gl_Position = u_projectionMatrix * center;
        v_texcoord0 = a_texcoord0;
    }
`;

function createBillboard(scale: number, x: number, y: number, z: number): Hilo3d.Mesh {
    const modelBlock = Hilo3d.UniformBuffer.fromSchema(modelLayout);
    const modelViewMatrix = new Hilo3d.Matrix4();
    const material = new Hilo3d.ShaderMaterial({
        shaderCacheId: 'BillboardWebGL2',
        needBasicUniforms: false,
        needBasicAttributes: false,
        uniforms: {
            u_diffuse: {
                get: (_mesh, _material, _programInfo) =>
                    Hilo3d.semantic.handlerTexture(billboardTexture)
            }
        },
        uniformBlocks: {
            BillboardCameraBlock: cameraBlock,
            BillboardModelBlock: modelBlock
        },
        attributes: {
            a_position: 'POSITION',
            a_texcoord0: 'TEXCOORD_0'
        },
        fs: fragmentShader,
        vs: vertexShader
    });
    const mesh = new Hilo3d.Mesh({ geometry: planeGeometry, material, x, y, z });
    mesh.setScale(scale);
    mesh.on('beforeRender', () => {
        camera.getModelViewMatrix(mesh, modelViewMatrix);
        mesh.worldMatrix.getScaling(billboardScale);
        modelBlock.set('u_modelViewMatrix', modelViewMatrix.elements);
        modelBlock.set('u_scale', billboardScale.elements);
    });
    return mesh;
}

function rand(min: number, max: number): number {
    return Math.random() * (max - min) + min;
}

for (let i = 0; i < 100; i++) {
    stage.addChild(createBillboard(rand(0.08, 0.2), rand(-1, 1), rand(-1, 1), rand(-1, 1)));
}

stage.addChild(createBillboard(1, 0, 0, 0));
