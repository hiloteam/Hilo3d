import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';
import { createTexturePreview } from './shared/ScreenMesh';

const { camera, stage, renderer } = await createExampleContext();
const diffuseTexture = new Hilo3d.LazyTexture({
    src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href
});
const boxGeometry = new Hilo3d.BoxGeometry();
boxGeometry.setAllRectUV([
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0]
]);

const vertexShader = `#version 300 es
        precision highp float;
        in vec3 a_position;
        in vec3 a_normal;
        in vec2 a_texcoord0;
        layout(std140) uniform DrawBuffersModelBlock {
            mat4 u_modelViewProjectionMatrix;
            mat4 u_modelMatrix;
            mat3 u_normalMatrix;
        };
        out vec2 v_texcoord0;
        out vec3 v_normal;
        out vec3 v_fragPos;
        void main(void) {
            vec4 worldPosition = u_modelMatrix * vec4(a_position, 1.0);
            v_fragPos = worldPosition.xyz;
            v_normal = normalize(u_normalMatrix * a_normal);
            v_texcoord0 = a_texcoord0;
            gl_Position = u_modelViewProjectionMatrix * vec4(a_position, 1.0);
        }
    `;
const fragmentShader = `#version 300 es
        precision highp float;
        uniform sampler2D u_diffuse;
        in vec2 v_texcoord0;
        in vec3 v_normal;
        in vec3 v_fragPos;
        layout(location = 0) out vec4 diffuseOutput;
        layout(location = 1) out vec4 normalOutput;
        layout(location = 2) out vec4 positionOutput;
        layout(location = 3) out vec4 facingOutput;

        void main(void) {
            vec3 diffuse = texture(u_diffuse, v_texcoord0).rgb;
            diffuseOutput = vec4(diffuse, 1.0);
            normalOutput = vec4(v_normal, 1.0);
            positionOutput = vec4(v_fragPos, 1.0);
            facingOutput = vec4(dot(v_normal, vec3(0.0, 0.0, 1.0)), 0.0, 0.0, 1.0);
        }
    `;

const modelLayout = Hilo3d.createStd140Layout({
    u_modelViewProjectionMatrix: 'mat4',
    u_modelMatrix: 'mat4',
    u_normalMatrix: 'mat3'
});
Hilo3d.registerUniformBlockBinding('DrawBuffersModelBlock');

function createDrawBufferMaterial(modelBlock: Hilo3d.UniformBuffer): Hilo3d.ShaderMaterial {
    return new Hilo3d.ShaderMaterial({
        sourceRevision: 'HiloDrawBuffersWebGL2',
        vs: vertexShader,
        fs: fragmentShader,
        uniformBlocks: { DrawBuffersModelBlock: modelBlock },
        attributes: {
            a_position: Hilo3d.MaterialAttributeSemantic.POSITION,
            a_normal: Hilo3d.MaterialAttributeSemantic.NORMAL,
            a_texcoord0: Hilo3d.MaterialAttributeSemantic.TEXCOORD_0
        },
        uniforms: {
            u_diffuse: {
                get: (_mesh, _material, _programInfo) =>
                    Hilo3d.semantic.handlerTexture(diffuseTexture)
            }
        }
    });
}

const sceneNode = new Hilo3d.Node();
sceneNode.onUpdate = () => {
    sceneNode.rotationY += 0.5;
    sceneNode.rotationX += 0.5;
};
for (let index = 0; index < 20; index++) {
    const modelBlock = Hilo3d.UniformBuffer.fromSchema(modelLayout);
    const modelViewProjection = new Hilo3d.Matrix4();
    const modelView = new Hilo3d.Matrix4();
    const normalMatrix = new Hilo3d.Matrix3();
    const mesh = new Hilo3d.Mesh({
        material: createDrawBufferMaterial(modelBlock),
        geometry: boxGeometry,
        x: (Math.random() * 2 - 1) * 5,
        y: (Math.random() * 2 - 1) * 5,
        z: (Math.random() * 2 - 1) * 5,
        rotationX: Math.random() * 360,
        rotationY: Math.random() * 360,
        rotationZ: Math.random() * 360
    });
    mesh.onUpdate = () => {
        mesh.rotationY -= 1;
        mesh.rotationZ += 1;
    };
    mesh.on('beforeRender', () => {
        camera.getModelProjectionMatrix(mesh, modelViewProjection);
        camera.getModelViewMatrix(mesh, modelView);
        normalMatrix.normalFromMat4(modelView);
        modelBlock.set('u_modelViewProjectionMatrix', modelViewProjection.elements);
        modelBlock.set('u_modelMatrix', mesh.worldMatrix.elements);
        modelBlock.set('u_normalMatrix', normalMatrix.elements);
    });
    mesh.setScale(0.2).addTo(sceneNode);
}

const renderTarget = renderer.createRenderTarget({
    width: renderer.width,
    height: renderer.height,
    colorAttachments: Array.from({ length: 4 }, () => ({ format: 'rgba8unorm' as const })),
    label: 'DrawBuffers.gbuffer'
});

const previewRects = [
    { x: 0, y: 0, width: 0.5, height: 0.5 },
    { x: 0.5, y: 0, width: 0.5, height: 0.5 },
    { x: 0, y: 0.5, width: 0.5, height: 0.5 },
    { x: 0.5, y: 0.5, width: 0.5, height: 0.5 }
] as const;
previewRects.forEach((rect, index) => {
    stage.addChild(
        createTexturePreview(
            () => renderTarget.getColorTexture(index),
            rect,
            `DrawBuffers.preview.${String(index)}`
        )
    );
});

stage.onUpdate = deltaTime => {
    if (renderTarget.width !== renderer.width || renderTarget.height !== renderer.height) {
        renderTarget.resize(renderer.width, renderer.height);
    }
    sceneNode.traverseUpdate(deltaTime);
    renderer.renderToTarget(renderTarget, sceneNode, camera, false);
};
