import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { camera, stage } = createExampleContext();

camera.z = 4.5;
const boxGeometry = new Hilo3d.BoxGeometry();
boxGeometry.setAllRectUV([
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0]
]);

const textureBox = new Hilo3d.Mesh({
    name: 'textureBox',
    geometry: boxGeometry,
    material: new Hilo3d.BasicMaterial({
        diffuse: new Hilo3d.LazyTexture({
            src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href
        })
    })
});
stage.addChild(textureBox);

const anim = new Hilo3d.Animation({
    animStatesList: [
        new Hilo3d.AnimationStates({
            interpolationType: 'LINEAR',
            nodeName: 'textureBox',
            keyTime: [1, 1.5, 2, 2.5, 3.5],
            states: [
                [1, 1, 0],
                [0.4, -0.5, 0.3],
                [-0.4, -0.5, 0.3],
                [-1, 1, 0],
                [1, 1, 0]
            ],
            type: 'Translation'
        }),
        new Hilo3d.AnimationStates({
            interpolationType: 'LINEAR',
            nodeName: 'textureBox',
            keyTime: [1, 1.5, 2, 2.5],
            states: [
                [0.5, 1, 1],
                [1, 0.5, 1],
                [0.5, 1, 1],
                [1, 0.5, 1]
            ],
            type: 'Scale'
        })
    ]
});
anim.rootNode = textureBox;
anim.play();
