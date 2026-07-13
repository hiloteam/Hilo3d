import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './js/init';

const { camera, renderer, stage } = createExampleContext({
    stage: {
        clearColor: new Hilo3d.Color(0, 0, 0, 1)
    }
});

Hilo3d.registerUniformBlockBinding('ExampleModelBlock');
Hilo3d.registerUniformBlockBinding('ExampleMaterialBlock');
const modelLayout = Hilo3d.createStd140Layout({ u_modelViewProjectionMatrix: 'mat4' });
const materialLayout = Hilo3d.createStd140Layout({ color: 'vec4', u_time: 'float' });
const modelUniformBuffer = Hilo3d.UniformBuffer.fromSchema(modelLayout);
const materialUniformBuffer = Hilo3d.UniformBuffer.fromSchema(materialLayout);
const modelViewProjection = new Hilo3d.Matrix4();

function requiredTextureUnit(textureIndex: number | undefined): number {
    if (textureIndex === undefined) {
        throw new Error('The UBO example shader did not receive a texture unit.');
    }
    return textureIndex;
}

renderer.onInit(() => {
    const diffuse = new Hilo3d.LazyTexture({
        src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href
    });
    const mixTexture = new Hilo3d.LazyTexture({
        src: new URL('./image/brdfLUT.png', import.meta.url).href
    });
    const geometry = new Hilo3d.SphereGeometry({
        radius: 1,
        heightSegments: 32,
        widthSegments: 64
    });
    const material = new Hilo3d.ShaderMaterial({
        shaderCacheId: 'UniformBufferAnimation',
        needBasicUniforms: false,
        needBasicAttributes: false,
        uniforms: {
            u_diffuse: {
                get(_mesh, _material, programInfo) {
                    return Hilo3d.semantic.handlerTexture(
                        diffuse,
                        requiredTextureUnit(programInfo.textureIndex)
                    );
                }
            },
            u_mixTexture: {
                get(_mesh, _material, programInfo) {
                    return Hilo3d.semantic.handlerTexture(
                        mixTexture,
                        requiredTextureUnit(programInfo.textureIndex)
                    );
                }
            }
        },
        uniformBlocks: {
            ExampleMaterialBlock: materialUniformBuffer,
            ExampleModelBlock: modelUniformBuffer
        },
        attributes: {
            a_position: 'POSITION',
            a_texcoord0: 'TEXCOORD_0'
        },
        fs: `#version 300 es
            precision highp float;

            in vec2 v_texcoord0;
            uniform sampler2D u_diffuse;
            uniform sampler2D u_mixTexture;
            layout(location = 0) out vec4 fragmentColor;

            layout(std140) uniform ExampleMaterialBlock {
                vec4 color;
                float u_time;
            };

            void main(void) {
                float uOffset = sin(u_time * 0.0005);
                float vOffset = cos(u_time * 0.0003);
                vec4 diffuseColor = texture(
                    u_diffuse,
                    vec2(v_texcoord0.x + uOffset, v_texcoord0.y + vOffset)
                );
                vec4 mixedColor = texture(u_mixTexture, v_texcoord0);
                fragmentColor = mix(
                    vec4(diffuseColor.r, diffuseColor.g, color.b, 1.0),
                    mixedColor,
                    0.05
                );
            }
        `,
        vs: `#version 300 es
            precision highp float;

            layout(location = 0) in vec3 a_position;
            layout(location = 1) in vec2 a_texcoord0;

            layout(std140) uniform ExampleModelBlock {
                mat4 u_modelViewProjectionMatrix;
            };

            out vec2 v_texcoord0;

            void main(void) {
                gl_Position = u_modelViewProjectionMatrix * vec4(a_position, 1.0);
                v_texcoord0 = a_texcoord0;
            }
        `
    });

    let elapsed = 0;
    const mesh = new Hilo3d.Mesh({
        rotationX: 90,
        geometry,
        material
    });
    mesh.onUpdate = deltaTime => {
        elapsed += deltaTime;

        materialUniformBuffer.set('color', [1, 0, Math.sin(elapsed * 0.001) * 0.5 + 0.5, 1]);
        materialUniformBuffer.set('u_time', elapsed);
    };
    mesh.on('beforeRender', () => {
        camera.getModelProjectionMatrix(mesh, modelViewProjection);
        modelUniformBuffer.set('u_modelViewProjectionMatrix', modelViewProjection.elements);
    });
    mesh.addTo(stage);
});
