import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './js/init';

const { camera, stage, renderer } = createExampleContext();
const fragmentExtensions = Hilo3d.Shader.shaders['chunk/extensions.frag'];
const fragmentPrecision = Hilo3d.Shader.shaders['chunk/precision.frag'];
if (!fragmentExtensions || !fragmentPrecision) {
    throw new Error('Draw-buffer shader chunks are unavailable.');
}
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

const material = new Hilo3d.ShaderMaterial({
    shaderCacheId: 'HiloDrawBuffers',
    shaderName: 'HiloDrawBuffers',
    vs: `
        attribute vec3 a_position;
        attribute vec3 a_normal;
        attribute vec2 a_texcoord0;
        uniform mat4 u_modelViewProjectionMatrix;
        uniform mat4 u_modelMatrix;
        uniform mat3 u_normalMatrix;
        varying vec2 v_texcoord0;
        varying vec3 v_normal;
        varying vec3 v_fragPos;
        void main(void) {
            vec4 worldPosition = u_modelMatrix * vec4(a_position, 1.0);
            v_fragPos = worldPosition.xyz;
            v_normal = normalize(u_normalMatrix * a_normal);
            v_texcoord0 = a_texcoord0;
            gl_Position = u_modelViewProjectionMatrix * vec4(a_position, 1.0);
        }
    `,
    fs: `
        ${fragmentExtensions}
        ${fragmentPrecision}
        #ifdef HILO_IS_WEBGL2
          layout(location = 1) out highp vec4 hilo_FragData1;
          layout(location = 2) out highp vec4 hilo_FragData2;
          layout(location = 3) out highp vec4 hilo_FragData3;
        #endif

        uniform sampler2D u_diffuse;
        varying vec2 v_texcoord0;
        varying vec3 v_normal;
        varying vec3 v_fragPos;

        void main(void) {
            vec3 diffuse = texture2D(u_diffuse, v_texcoord0).rgb;
            gl_FragData[0] = vec4(diffuse, 1.0);
            gl_FragData[1] = vec4(v_normal, 1.0);
            gl_FragData[2] = vec4(v_fragPos, 1.0);
            gl_FragData[3] = vec4(dot(v_normal, vec3(0.0, 0.0, 1.0)), 0.0, 0.0, 1.0);
        }
    `,
    attributes: {
        a_position: 'POSITION',
        a_normal: 'NORMAL',
        a_texcoord0: 'TEXCOORD_0'
    },
    uniforms: {
        u_modelViewProjectionMatrix: 'MODELVIEWPROJECTION',
        u_modelMatrix: 'MODEL',
        u_normalMatrix: 'MODELVIEWINVERSETRANSPOSE',
        u_diffuse: {
            get: (_mesh, _material, programInfo) => {
                if (programInfo.textureIndex === undefined) {
                    throw new Error('u_diffuse is not a sampler uniform.');
                }
                return Hilo3d.semantic.handlerTexture(diffuseTexture, programInfo.textureIndex);
            }
        }
    },
    enableDrawBuffers: true
});

const sceneNode = new Hilo3d.Node();
sceneNode.onUpdate = () => {
    sceneNode.rotationY += 0.5;
    sceneNode.rotationX += 0.5;
};
for (let index = 0; index < 20; index++) {
    const mesh = new Hilo3d.Mesh({
        material,
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
    mesh.setScale(0.2).addTo(sceneNode);
}

const framebuffer = new Hilo3d.Framebuffer(renderer, {
    colorAttachmentInfos: Array.from({ length: 4 }, () => ({
        attachmentType: Hilo3d.Framebuffer.ATTACHMENT_TYPE_TEXTURE
    }))
});

stage.onUpdate = () => {
    framebuffer.bind();
    try {
        sceneNode.traverseUpdate(0);
        renderer.render(sceneNode, camera);
    } finally {
        framebuffer.unbind();
    }
};

function attachment(index: number): Hilo3d.FramebufferTexture {
    const texture = framebuffer.colorAttachmentInfos[index]?.texture;
    if (!texture) throw new Error(`Draw buffer ${String(index)} has no texture attachment.`);
    return texture;
}

renderer.on('afterRender', () => {
    framebuffer.render(0, 0, 0.5, 0.5, null, attachment(0));
    framebuffer.render(0.5, 0, 0.5, 0.5, null, attachment(1));
    framebuffer.render(0, 0.5, 0.5, 0.5, null, attachment(2));
    framebuffer.render(0.5, 0.5, 0.5, 0.5, null, attachment(3));
});
