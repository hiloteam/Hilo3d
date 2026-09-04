import {
    LazyTexture,
    MaterialAttributeSemantic,
    Matrix4,
    PlaneGeometry,
    RENDER_WORLD,
    ShaderMaterialLoader,
    UniformBuffer,
    WorldTransform,
    createStd140Layout,
    registerUniformBlockBinding,
    semantic
} from 'hilo3d';
import { createExampleRuntime } from '../../shared/runtime';
import { createMeshEntity } from '../../shared/scene';

const runtime = await createExampleRuntime();
runtime.controls.setView({ x: 0, y: 0, z: 0 }, 2.5, 0, Math.PI / 2);
registerUniformBlockBinding('ShaderLoaderBlock');
const layout = createStd140Layout({ u_mat: 'mat4', u_diff: 'float' });
const block = UniformBuffer.fromSchema(layout);
const diffuseTexture = new LazyTexture({
    src: new URL('../../image/UV_Grid_Sm.jpg', import.meta.url).href
});
const material = await new ShaderMaterialLoader().load({
    fs: './test.frag',
    vs: './test.vert',
    attributes: {
        a_pos: MaterialAttributeSemantic.POSITION,
        a_uv: MaterialAttributeSemantic.TEXCOORD_0
    },
    uniforms: {
        u_diffuse: {
            get: () => semantic.handlerTexture(diffuseTexture)
        }
    },
    uniformBlocks: { ShaderLoaderBlock: block },
    state: { wireframe: true }
});
const plane = createMeshEntity(runtime.world, {
    geometry: new PlaneGeometry({ widthSegments: 100, heightSegments: 100 }),
    material,
    scale: [1.6, 1.6, 1.6]
});
const modelMatrix = new Matrix4();
const modelViewProjection = new Matrix4();
runtime.start(time => {
    if (!runtime.world.has(plane, WorldTransform)) return;
    const renderWorld = runtime.world.getResource(RENDER_WORLD);
    const cameraIndex = runtime.world.entityIndex(runtime.camera);
    if (!renderWorld.cameras.has(cameraIndex)) return;
    modelMatrix.fromArray(runtime.world.get(plane, WorldTransform).matrix);
    modelViewProjection.multiply(
        renderWorld.cameras.get(cameraIndex).viewProjectionMatrix,
        modelMatrix
    );
    block.set('u_mat', modelViewProjection.elements);
    block.set('u_diff', time * 2);
});
