import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { stage } = await createExampleContext();

let diffuseTexture: Hilo3d.Texture<unknown> | null = null;
const textureMaterial = new Hilo3d.ShaderMaterial({
    vs: `#version 300 es
        in vec3 a_position;
        in vec2 a_texcoord0;
        out vec2 v_uv;
        void main(void) {
            v_uv = a_texcoord0;
            gl_Position = vec4(a_position * 2.0, 1.0);
        }`,
    fs: `#version 300 es
        precision highp float;
        uniform sampler2D u_diffuse;
        in vec2 v_uv;
        layout(location = 0) out vec4 fragmentColor;
        void main(void) {
            fragmentColor = texture(u_diffuse, v_uv);
        }`,
    uniforms: {
        u_diffuse: {
            get: (_mesh, _material, _programInfo) => Hilo3d.semantic.handlerTexture(diffuseTexture)
        }
    }
});
const texMesh = new Hilo3d.Mesh({
    geometry: new Hilo3d.PlaneGeometry(),
    material: textureMaterial
});

const uvMaterial = new Hilo3d.ShaderMaterial({
    state: { wireframe: true },
    vs: `#version 300 es
                in vec2 a_texcoord0;
                out vec2 v_uv;
                void main(void) {
                    v_uv = a_texcoord0;
                    gl_Position = vec4(a_texcoord0 * 2.0 - 1.0, 0.0, 1.0);
                }`,
    fs: `#version 300 es
                precision highp float;
                in vec2 v_uv;
                layout(location = 0) out vec4 fragmentColor;
                void main(void) {
                    fragmentColor = vec4(0.0, 1.0, 0.0, 1.0);
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
