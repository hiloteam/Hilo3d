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
    src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href,
    minFilter: Hilo3d.constants.LINEAR_MIPMAP_LINEAR
});
let elapsedTime = 0;
const extensionChunk = Hilo3d.Shader.shaders['chunk/extensions.frag'];
if (extensionChunk === undefined) throw new Error('Texture LOD shader chunk is unavailable');
const mesh = new Hilo3d.Mesh({
    geometry,
    material: new Hilo3d.ShaderMaterial({
        shaderCacheId: 'UVAnimation',
        needBasicUnifroms: false,
        needBasicAttributes: false,
        side: Hilo3d.constants.BACK,
        enableTextureLod: true,
        uniforms: {
            u_diffuse: {
                get: (_mesh, _material, programInfo) => {
                    if (programInfo.textureIndex === undefined) {
                        throw new Error('u_diffuse is not a texture sampler.');
                    }
                    return Hilo3d.semantic.handlerTexture(diffuseTexture, programInfo.textureIndex);
                }
            },
            u_modelViewProjectionMatrix: 'MODELVIEWPROJECTION',
            u_time: { get: () => elapsedTime }
        },
        attributes: {
            a_position: 'POSITION',
            a_texcoord0: 'TEXCOORD_0'
        },
        fs: `
                precision HILO_MAX_FRAGMENT_PRECISION float;
                ${extensionChunk}
                varying vec2 v_texcoord0;
                uniform sampler2D u_diffuse;
                uniform float u_time;
                                
                void main(void) {
                    float uOffset = cos(u_time * 0.0001) + .5;
                    float level = (sin(u_time * 0.0013) * 0.5 + 0.5) * 9.;
                    vec4 diffuse = texture2DLodEXT(u_diffuse, vec2(v_texcoord0.x + uOffset, v_texcoord0.y), level);    
                    gl_FragColor = diffuse;
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
