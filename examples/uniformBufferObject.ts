import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './js/init';

const { camera, renderer, stage } = createExampleContext({
    stage: {
        clearColor: new Hilo3d.Color(0, 0, 0, 1),
        preferWebGL2: true
    }
});

const modelData = new Float32Array(16);
const materialData = new Float32Array(8);
const modelUniformBuffer = new Hilo3d.UniformBuffer(modelData);
const materialUniformBuffer = new Hilo3d.UniformBuffer(materialData);
const modelViewProjection = new Hilo3d.Matrix4();

function requiredTextureUnit(textureIndex: number | undefined): number {
    if (textureIndex === undefined) {
        throw new Error('The UBO example shader did not receive a texture unit.');
    }
    return textureIndex;
}

function showWebGL2Requirement(): void {
    const message = document.createElement('p');
    message.className = 'example-requirement';
    message.textContent = 'This example requires WebGL 2 Uniform Buffer Objects.';
    document.body.append(message);
}

renderer.onInit(() => {
    if (!renderer.isWebGL2) {
        showWebGL2Requirement();
        return;
    }

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
        needBasicUnifroms: false,
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
            MaterialBlock: materialUniformBuffer,
            ModelBlock: modelUniformBuffer
        },
        attributes: {
            a_position: 'POSITION',
            a_texcoord0: 'TEXCOORD_0'
        },
        fs: `precision highp float;

            varying vec2 v_texcoord0;
            uniform sampler2D u_diffuse;
            uniform sampler2D u_mixTexture;

            layout(std140) uniform MaterialBlock {
                vec4 color;
                float u_time;
            };

            void main(void) {
                float uOffset = sin(u_time * 0.0005);
                float vOffset = cos(u_time * 0.0003);
                vec4 diffuseColor = texture2D(
                    u_diffuse,
                    vec2(v_texcoord0.x + uOffset, v_texcoord0.y + vOffset)
                );
                vec4 mixedColor = texture2D(u_mixTexture, v_texcoord0);
                gl_FragColor = mix(
                    vec4(diffuseColor.r, diffuseColor.g, color.b, 1.0),
                    mixedColor,
                    0.05
                );
            }
        `,
        vs: `precision highp float;

            layout(location = 0) attribute vec3 a_position;
            layout(location = 1) attribute vec2 a_texcoord0;

            layout(std140) uniform ModelBlock {
                mat4 u_modelViewProjectionMatrix;
            };

            varying vec2 v_texcoord0;

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

        materialData.set([1, 0, Math.sin(elapsed * 0.001) * 0.5 + 0.5, 1], 0);
        materialData[4] = elapsed;
        materialUniformBuffer.isDirty = true;

        camera.getModelProjectionMatrix(mesh, modelViewProjection);
        modelData.set(modelViewProjection.elements);
        modelUniformBuffer.isDirty = true;
    };
    mesh.addTo(stage);
});
