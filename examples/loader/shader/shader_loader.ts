import * as Hilo3d from '../../../src/Hilo3d';
import { createExampleContext } from '../../js/init';

const { stage } = createExampleContext();

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
void loader
    .load({
        fs: './test.frag',
        vs: './test.vert',
        attributes: {
            a_pos: 'POSITION',
            a_uv: 'TEXCOORD_0'
        },
        uniforms: {
            u_mat: 'MODELVIEWPROJECTION',
            u_diffuse: {
                get: (_mesh, _material, programInfo) => {
                    if (programInfo.textureIndex === undefined) {
                        throw new Error('u_diffuse is not a texture sampler.');
                    }
                    return Hilo3d.semantic.handlerTexture(diffuseTexture, programInfo.textureIndex);
                }
            },
            u_diff: {
                get() {
                    return animationState.difference;
                }
            }
        },
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
        stage.addChild(plane);
    })
    .catch((error: unknown) => {
        console.error('Failed to load shader material', error);
    });
