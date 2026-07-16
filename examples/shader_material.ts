import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './js/init';

const { stage, renderer } = createExampleContext();

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
const mesh = new Hilo3d.Mesh({
    rotationX: 90,
    geometry,
    material: new Hilo3d.ShaderMaterial({
        shaderCacheId: 'UVAnimation',
        getCustomRenderOption(option) {
            option['CUSTOM_OPTION'] = 1;
            return option;
        },
        needBasicUnifroms: false,
        needBasicAttributes: false,
        uniforms: {
            u_diffuse: {
                get(_mesh, _material, programInfo) {
                    if (programInfo.textureIndex === undefined)
                        throw new Error('u_diffuse has no texture unit');
                    return Hilo3d.semantic.handlerTexture(diffuseTexture, programInfo.textureIndex);
                }
            },
            u_modelViewProjectionMatrix: 'MODELVIEWPROJECTION',
            u_mixTexture: {
                get(_mesh, _material, programInfo) {
                    if (programInfo.textureIndex === undefined)
                        throw new Error('u_mixTexture has no texture unit');
                    return Hilo3d.semantic.handlerTexture(mixTexture, programInfo.textureIndex);
                }
            },
            u_time: { get: () => elapsedTime },
            'u_light.color.r': { get: () => 0 },
            'u_light.color.g': { get: () => 0 },
            'u_light.color.b': {
                get() {
                    return Math.random() - 0.5;
                }
            }
        },
        attributes: {
            a_position: 'POSITION',
            a_texcoord0: 'TEXCOORD_0'
        },
        fs: `
                precision HILO_MAX_FRAGMENT_PRECISION float;
                varying vec2 v_texcoord0;
                uniform sampler2D u_diffuse;
                uniform sampler2D u_mixTexture;
                uniform float u_time;
                
                struct color{
                    float r;
                    float g;
                    float b;
                };

                struct light{
                    color color;
                };
                
                uniform light u_light;
                void main(void) {
                    float uOffset = sin(u_time * 0.0005);
                    float vOffset = cos(u_time * 0.0003);
                    vec4 diffuse = texture2D(u_diffuse, vec2(v_texcoord0.x + uOffset, v_texcoord0.y + vOffset));    
                    vec4 mixTexture = texture2D(u_mixTexture, v_texcoord0);    
                    gl_FragColor = mix(vec4(diffuse.r, diffuse.g, u_light.color.b, 1), mixTexture, 0.05);
                }
            `,
        vs: `
                precision HILO_MAX_VERTEX_PRECISION float;
                attribute vec3 a_position;
                attribute vec2 a_texcoord0;
                uniform mat4 u_modelViewProjectionMatrix;
                varying vec2 v_texcoord0;

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
};

container.addChild(mesh);
stage.addChild(container);
