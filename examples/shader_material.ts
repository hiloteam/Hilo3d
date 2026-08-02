import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { camera, stage, renderer } = await createExampleContext();

renderer.clearColor = new Hilo3d.Color(0, 0, 0, 1);
const container = new Hilo3d.Node();
const geometry = new Hilo3d.SphereGeometry({
    radius: 1,
    heightSegments: 32,
    widthSegments: 64
});
const diffuseTexture = new Hilo3d.LazyTexture({
    src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href
});
const mixTexture = new Hilo3d.LazyTexture({
    src: new URL('./image/brdfLUT.png', import.meta.url).href
});
let elapsedTime = 0;
Hilo3d.registerUniformBlockBinding('ShaderMaterialModelBlock');
Hilo3d.registerUniformBlockBinding('ShaderMaterialAnimationBlock');
const modelLayout = Hilo3d.createStd140Layout({ u_modelViewProjectionMatrix: 'mat4' });
const materialLayout = Hilo3d.createStd140Layout({ u_time: 'float', u_lightColor: 'vec3' });
const modelBlock = Hilo3d.UniformBuffer.fromSchema(modelLayout);
const materialBlock = Hilo3d.UniformBuffer.fromSchema(materialLayout, {
    u_time: 0,
    u_lightColor: [0, 0, 0]
});
const modelViewProjection = new Hilo3d.Matrix4();
const mesh = new Hilo3d.Mesh({
    rotationX: 90,
    geometry,
    material: new Hilo3d.ShaderMaterial({
        sourceRevision: 'UVAnimation',
        defines: { CUSTOM_OPTION: 1 },
        uniforms: {
            u_diffuse: {
                get(_mesh, _material, _programInfo) {
                    return Hilo3d.semantic.handlerTexture(diffuseTexture);
                }
            },
            u_mixTexture: {
                get(_mesh, _material, _programInfo) {
                    return Hilo3d.semantic.handlerTexture(mixTexture);
                }
            }
        },
        uniformBlocks: {
            ShaderMaterialModelBlock: modelBlock,
            ShaderMaterialAnimationBlock: materialBlock
        },
        attributes: {
            a_position: Hilo3d.MaterialAttributeSemantic.POSITION,
            a_texcoord0: Hilo3d.MaterialAttributeSemantic.TEXCOORD_0
        },
        fs: `#version 300 es
                precision highp float;
                in vec2 v_texcoord0;
                uniform sampler2D u_diffuse;
                uniform sampler2D u_mixTexture;
                layout(std140) uniform ShaderMaterialAnimationBlock {
                    float u_time;
                    vec3 u_lightColor;
                };
                layout(location = 0) out vec4 fragmentColor;
                void main(void) {
                    float uOffset = sin(u_time * 0.0005);
                    float vOffset = cos(u_time * 0.0003);
                    vec4 diffuse = texture(u_diffuse, vec2(v_texcoord0.x + uOffset, v_texcoord0.y + vOffset));
                    vec4 mixTexture = texture(u_mixTexture, v_texcoord0);
                    fragmentColor = mix(vec4(diffuse.r, diffuse.g, u_lightColor.b, 1), mixTexture, 0.05);
                }
            `,
        vs: `#version 300 es
                precision highp float;
                in vec3 a_position;
                in vec2 a_texcoord0;
                layout(std140) uniform ShaderMaterialModelBlock {
                    mat4 u_modelViewProjectionMatrix;
                };
                out vec2 v_texcoord0;

                void main(void) {
                    vec4 pos = vec4(a_position, 1.0);
                    gl_Position = u_modelViewProjectionMatrix * pos;
                    v_texcoord0 = a_texcoord0;
                }
            `
    })
});
mesh.onUpdate = deltaTime => {
    elapsedTime += deltaTime;
    materialBlock.set('u_time', elapsedTime);
    materialBlock.set('u_lightColor', [0, 0, Math.random() - 0.5]);
};
mesh.on('beforeRender', () => {
    camera.getModelProjectionMatrix(mesh, modelViewProjection);
    modelBlock.set('u_modelViewProjectionMatrix', modelViewProjection.elements);
});

container.addChild(mesh);
stage.addChild(container);
