import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './js/init';

const { stage } = createExampleContext();

const planeGeometry = new Hilo3d.PlaneGeometry();
const billboardTexture = new Hilo3d.LazyTexture({
    src: new URL('./image/brdfLUT.png', import.meta.url).href
});
const billboardScales = new WeakMap<Hilo3d.Mesh, Hilo3d.Vector3>();

const billdboardMaterial = new Hilo3d.ShaderMaterial({
    uniforms: {
        u_diffuse: {
            get: (_mesh, _material, programInfo) => {
                if (programInfo.textureIndex === undefined) {
                    throw new Error('u_diffuse is not a texture sampler.');
                }
                return Hilo3d.semantic.handlerTexture(billboardTexture, programInfo.textureIndex);
            }
        },
        u_modelViewMatrix: 'MODELVIEW',
        u_projectionMatrix: 'PROJECTION',
        u_scale: {
            isDependMesh: true,
            get(mesh) {
                let scale = billboardScales.get(mesh);
                if (!scale) {
                    scale = new Hilo3d.Vector3(1, 1, 1);
                    billboardScales.set(mesh, scale);
                }
                return mesh.worldMatrix.getScaling(scale).elements;
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
                         
            void main(void) {
                vec4 diffuse = texture2D(u_diffuse, vec2(v_texcoord0.x, v_texcoord0.y));    
                gl_FragColor = diffuse;
            }
        `,
    vs: `
            precision HILO_MAX_VERTEX_PRECISION float;
            uniform vec3 u_scale;
            attribute vec3 a_position;
            attribute vec2 a_texcoord0;
            varying vec2 v_texcoord0;

            uniform mat4 u_modelViewMatrix;
            uniform mat4 u_projectionMatrix;

            void main(void) {
                vec4 center = u_modelViewMatrix * vec4(0, 0, 0, 1);
                center.xy += a_position.xy * u_scale.xy;
                gl_Position = u_projectionMatrix * center;
                v_texcoord0 = a_texcoord0;
            }
        `
});

function rand(min: number, max: number): number {
    return Math.random() * (max - min) + min;
}

for (let i = 0; i < 100; i++) {
    const rect = new Hilo3d.Mesh({
        geometry: planeGeometry,
        material: billdboardMaterial,
        x: rand(-1, 1),
        y: rand(-1, 1),
        z: rand(-1, 1)
    });
    rect.setScale(rand(0.08, 0.2));
    stage.addChild(rect);
}

const centerRect = new Hilo3d.Mesh({
    geometry: planeGeometry,
    material: billdboardMaterial,
    x: 0,
    y: 0,
    z: 0
});
centerRect.setScale(1);
stage.addChild(centerRect);
