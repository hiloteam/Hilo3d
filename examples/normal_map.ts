import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { stage } = createExampleContext();

function requireLoadedImage(id: string): HTMLImageElement {
    const image = loadQueue.getContent(id);
    if (image instanceof HTMLImageElement) return image;
    throw new TypeError(`Expected ${id} to load as an image`);
}

stage.addChild(new Hilo3d.AxisHelper());
const loadQueue = new Hilo3d.LoadQueue();
loadQueue
    .add([
        {
            id: 'brickwall',
            src: new URL('./models/BoomBox/BoomBox_baseColor.png', import.meta.url).href
        },
        {
            id: 'brickwall_normal',
            src: new URL('./models/BoomBox/BoomBox_normal.png', import.meta.url).href
        }
    ])
    .on('complete', () => {
        const geometry = new Hilo3d.PlaneGeometry();
        const diffuse = new Hilo3d.Texture({
            image: requireLoadedImage('brickwall')
        });
        const normalTexture = new Hilo3d.Texture({
            image: requireLoadedImage('brickwall_normal')
        });
        const material = new Hilo3d.BasicMaterial({
            specular: new Hilo3d.Color(0.5, 0.5, 0.5),
            diffuse,
            normalMap: normalTexture
        });
        const mesh = new Hilo3d.Mesh({
            geometry,
            material
        });
        stage.addChild(mesh);
    })
    .on('error', event => {
        console.error('Failed to load normal-map resources', event.detail);
    })
    .start();

const pointLight = new Hilo3d.PointLight({
    color: new Hilo3d.Color(0.5, 0.5, 0.5),
    x: 5,
    y: 2,
    z: 5,
    range: 100
});
stage.addChild(pointLight);

const blueBox = new Hilo3d.Mesh({
    geometry: new Hilo3d.BoxGeometry(),
    material: new Hilo3d.BasicMaterial({
        diffuse: new Hilo3d.Color(0, 0, 1),
        lightType: 'NONE'
    })
});
blueBox.setScale(0.1);
pointLight.addChild(blueBox);

Hilo3d.Tween.to(
    pointLight,
    {
        x: -5
    },
    {
        duration: 2000,
        loop: true,
        reverse: true
    }
);
