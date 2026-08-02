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
    src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href,
    minFilter: Hilo3d.constants.LINEAR_MIPMAP_LINEAR
});
let elapsedTime = 0;
Hilo3d.registerUniformBlockBinding('TextureLodModelBlock');
Hilo3d.registerUniformBlockBinding('TextureLodMaterialBlock');
const modelLayout = Hilo3d.createStd140Layout({ u_modelViewProjectionMatrix: 'mat4' });
const materialLayout = Hilo3d.createStd140Layout({ u_time: 'float' });
const modelBlock = Hilo3d.UniformBuffer.fromSchema(modelLayout);
const materialBlock = Hilo3d.UniformBuffer.fromSchema(materialLayout, { u_time: 0 });
const modelViewProjection = new Hilo3d.Matrix4();
const mesh = new Hilo3d.Mesh({
    geometry,
    material: new Hilo3d.ShaderMaterial({
        sourceRevision: 'UVAnimation',
        cullMode: 'front',
        defines: { USE_SHADER_TEXTURE_LOD: 1 },
        uniforms: {
            u_diffuse: {
                get: (_mesh, _material, _programInfo) =>
                    Hilo3d.semantic.handlerTexture(diffuseTexture)
            }
        },
        uniformBlocks: {
            TextureLodModelBlock: modelBlock,
            TextureLodMaterialBlock: materialBlock
        },
        attributes: {
            a_position: Hilo3d.MaterialAttributeSemantic.POSITION,
            a_texcoord0: Hilo3d.MaterialAttributeSemantic.TEXCOORD_0
        },
        fs: `#version 300 es
                precision highp float;
                in vec2 v_texcoord0;
                uniform sampler2D u_diffuse;
                layout(std140) uniform TextureLodMaterialBlock {
                    float u_time;
                };
                layout(location = 0) out vec4 fragmentColor;
                                
                void main(void) {
                    float uOffset = cos(u_time * 0.0001) + .5;
                    float level = (sin(u_time * 0.0013) * 0.5 + 0.5) * 9.;
                    vec4 diffuse = textureLod(u_diffuse, vec2(v_texcoord0.x + uOffset, v_texcoord0.y), level);
                    fragmentColor = diffuse;
                }
            `,
        vs: `#version 300 es
                precision highp float;
                in vec3 a_position;
                in vec2 a_texcoord0;
                layout(std140) uniform TextureLodModelBlock {
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
};
mesh.on('beforeRender', () => {
    camera.getModelProjectionMatrix(mesh, modelViewProjection);
    modelBlock.set('u_modelViewProjectionMatrix', modelViewProjection.elements);
});

container.addChild(mesh);
stage.addChild(container);
