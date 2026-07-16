import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { stage } = await createExampleContext();

// basic loader will cache all requests,
// if you want to release image memory,
// you should disable or clear(Hilo3d.BasicLoader.clearCache()) after load
Hilo3d.BasicLoader.disableCache();
const cubeTextureLoader = new Hilo3d.CubeTextureLoader();
const imageLoader = new Hilo3d.BasicLoader();
const imageUrl = (name: string): string => new URL(`./image/${name}`, import.meta.url).href;

void cubeTextureLoader
    .load({
        isImageCanRelease: true,
        images: [
            imageUrl('px.jpg'),
            imageUrl('nx.jpg'),
            imageUrl('py.jpg'),
            imageUrl('ny.jpg'),
            imageUrl('pz.jpg'),
            imageUrl('nz.jpg')
        ]
    })
    .then(skyboxMap => {
        const skybox = new Hilo3d.Mesh({
            geometry: new Hilo3d.BoxGeometry(),
            material: new Hilo3d.BasicMaterial({
                lightType: 'NONE',
                side: Hilo3d.constants.BACK,
                diffuse: skyboxMap
            })
        }).addTo(stage);
        skybox.setScale(20);
    })
    .catch((error: unknown) => {
        console.error('Failed to load releasable skybox', error);
    });

const boxGeometry = new Hilo3d.BoxGeometry();
boxGeometry.setAllRectUV([
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0]
]);
const texture = new Hilo3d.LazyTexture({
    isImageCanRelease: true,
    src: imageUrl('UV_Grid_Sm.jpg')
});

let angle = 0;
const axis = new Hilo3d.Vector3(1, 1, 1).normalize();
const textureBox = new Hilo3d.Mesh({
    geometry: boxGeometry,
    material: new Hilo3d.BasicMaterial({ diffuse: texture })
});
textureBox.onUpdate = () => {
    angle += Hilo3d.math.DEG2RAD;
    textureBox.quaternion.setAxisAngle(axis, angle);
};
stage.addChild(textureBox);

let idx = 0;
setInterval(function () {
    void imageLoader
        .load({
            src: ++idx % 2 ? './models/Tmall/baseColor.png' : imageUrl('UV_Grid_Sm.jpg')
        })
        .then(img => {
            if (!(img instanceof HTMLImageElement)) {
                throw new TypeError('Replacement texture request did not return an image');
            }
            if (Math.random() < 0.5) {
                texture.image = img;
            }
            texture.needUpdate = true;
        })
        .catch((error: unknown) => {
            console.error('Failed to replace texture image', error);
        });
}, 3000);
