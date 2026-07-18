import * as Hilo3d from '../../../src/Hilo3d';
import { createExampleContext } from '../../shared/init';

const { camera, stage } = await createExampleContext();

stage.addChild(new Hilo3d.AxisNetHelper({ size: 4 }));
stage.addChild(new Hilo3d.AxisHelper());
stage.rotationX = 30;
const animationState = { difference: 0 };
Hilo3d.Tween.to(
    animationState,
    {
        difference: Math.PI * 2
    },
    {
        duration: 3000,
        loop: true
    }
).start();

const loader = new Hilo3d.ShaderMaterialLoader();
const diffuseTexture = new Hilo3d.LazyTexture({
    src: new URL('../../image/UV_Grid_Sm.jpg', import.meta.url).href
});
Hilo3d.registerUniformBlockBinding('ShaderLoaderBlock');
const shaderLayout = Hilo3d.createStd140Layout({ u_mat: 'mat4', u_diff: 'float' });
const shaderBlock = Hilo3d.UniformBuffer.fromSchema(shaderLayout);
const modelViewProjection = new Hilo3d.Matrix4();
void loader
    .load({
        fs: './test.frag',
        vs: './test.vert',
        attributes: {
            a_pos: 'POSITION',
            a_uv: 'TEXCOORD_0'
        },
        uniforms: {
            u_diffuse: {
                get: (_mesh, _material, _programInfo) =>
                    Hilo3d.semantic.handlerTexture(diffuseTexture)
            }
        },
        uniformBlocks: { ShaderLoaderBlock: shaderBlock },
        // cullFace: true,
        wireframe: true
    })
    .then(function (material) {
        const geometry = new Hilo3d.PlaneGeometry({
            heightSegments: 100,
            widthSegments: 100
        });
        const plane = new Hilo3d.Mesh({
            // rotationX: -90,
            material,
            geometry
        });
        plane.on('beforeRender', () => {
            camera.getModelProjectionMatrix(plane, modelViewProjection);
            shaderBlock.set('u_mat', modelViewProjection.elements);
            shaderBlock.set('u_diff', animationState.difference);
        });
        stage.addChild(plane);
    })
    .catch((error: unknown) => {
        console.error('Failed to load shader material', error);
    });
