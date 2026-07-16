import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './js/init';

const { stage } = createExampleContext();
const fragmentPrecision = Hilo3d.Shader.shaders['chunk/precision.frag'];
if (!fragmentPrecision) throw new Error('Fragment precision shader chunk is unavailable.');

let diffuseTexture: Hilo3d.Texture | null = null;
const textureMaterial = new Hilo3d.ShaderMaterial({
    vs: `
        attribute vec3 a_position;
        attribute vec2 a_texcoord0;
        varying vec2 v_uv;
        void main(void) {
            v_uv = a_texcoord0;
            gl_Position = vec4(a_position * 2.0, 1.0);
        }`,
    fs: `
        ${fragmentPrecision}
        uniform sampler2D u_diffuse;
        varying vec2 v_uv;
        void main(void) {
            gl_FragColor = texture2D(u_diffuse, v_uv);
        }`,
    uniforms: {
        u_diffuse: {
            get: (_mesh, _material, programInfo) => {
                if (programInfo.textureIndex === undefined) {
                    throw new Error('u_diffuse is not a sampler uniform.');
                }
                return Hilo3d.semantic.handlerTexture(diffuseTexture, programInfo.textureIndex);
            }
        }
    }
});
const texMesh = new Hilo3d.Mesh({
    geometry: new Hilo3d.PlaneGeometry(),
    material: textureMaterial
});

const uvMaterial = new Hilo3d.ShaderMaterial({
    wireframe: true,
    vs: `
                attribute vec2 a_texcoord0;
                varying vec2 v_uv;
                void main(void) {
                    v_uv = a_texcoord0;
                    gl_Position = vec4(a_texcoord0 * 2.0 - 1.0, 0.0, 1.0);
                }`,
    fs: `
                ${fragmentPrecision}
                varying vec2 v_uv;
                void main(void) {
                    gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0);
                }`
});
const loader = new Hilo3d.GLTFLoader();
loader
    .load({
        src: './models/Tmall/Tmall.gltf'
    })
    .then(async model => {
        await model.ready;
        const sourceMesh = model.meshes[0];
        if (!sourceMesh?.material) throw new Error('The glTF model has no material to inspect.');
        const sourceMaterial = sourceMesh.material;
        diffuseTexture =
            sourceMaterial instanceof Hilo3d.PBRMaterial
                ? sourceMaterial.baseColorMap
                : sourceMaterial instanceof Hilo3d.BasicMaterial &&
                    sourceMaterial.diffuse instanceof Hilo3d.Texture
                  ? sourceMaterial.diffuse
                  : null;
        if (!diffuseTexture) throw new Error('The glTF material has no diffuse texture.');
        sourceMesh.material = uvMaterial;
        stage.addChild(texMesh);
        stage.addChild(sourceMesh);
    })
    .catch((error: unknown) => {
        queueMicrotask(() => {
            throw error;
        });
    });
