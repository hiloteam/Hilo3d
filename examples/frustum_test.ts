import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './js/init';

const { stage } = createExampleContext();

function rand(min: number, max: number): number {
    return Math.random() * (max - min) + min;
}

function randomItem<Item>(items: readonly Item[]): Item {
    const item = items[Math.floor(Math.random() * items.length)];
    if (item === undefined) throw new Error('Cannot choose from an empty collection');
    return item;
}

const loader = new Hilo3d.BasicLoader();
void loader
    .load({
        src: new URL('./image/brdfLUT.png', import.meta.url).href
    })
    .then(image => {
        if (!(image instanceof HTMLImageElement)) throw new TypeError('Expected a texture image');
        return new Hilo3d.Texture({ image });
    })
    .then(function (diffuse) {
        const textureMaterial = new Hilo3d.BasicMaterial({
            diffuse,
            side: Hilo3d.constants.FRONT_AND_BACK
        });
        const colorMaterial = new Hilo3d.BasicMaterial({
            diffuse: new Hilo3d.Color(0.3, 0.6, 0.9),
            side: Hilo3d.constants.FRONT_AND_BACK
        });
        const planeGeometry = new Hilo3d.PlaneGeometry();
        const sphereGeometry = new Hilo3d.SphereGeometry({
            radius: 0.3
        });
        const boxGeometry = new Hilo3d.BoxGeometry({
            width: 0.3,
            height: 0.3,
            depth: 0.3
        });
        boxGeometry.setAllRectUV([
            [0, 1],
            [1, 1],
            [1, 0],
            [0, 0]
        ]);

        const geometryes = [planeGeometry, sphereGeometry, boxGeometry];
        const materials = [colorMaterial, textureMaterial];

        for (let i = 0; i < 700; i++) {
            const r = 1;
            const rect = new Hilo3d.Mesh({
                frustumTest: true,
                geometry: randomItem(geometryes),
                material: randomItem(materials),
                x: rand(-r * 4, r * 4),
                y: rand(-r, r),
                z: rand(-r, r)
            });
            rect.rotationX = Math.random() * 360;
            rect.rotationY = Math.random() * 360;
            rect.rotationZ = Math.random() * 360;
            rect.setScale(rand(0.2, 0.3));
            stage.addChild(rect);
        }
    })
    .catch((error: unknown) => {
        console.error('Failed to initialize frustum example', error);
    });
