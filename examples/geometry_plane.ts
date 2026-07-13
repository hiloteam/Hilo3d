import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { stage } = createExampleContext();

function rand(min: number, max: number): number {
    return Math.random() * (max - min) + min;
}

const geometry = new Hilo3d.PlaneGeometry();
const textureMaterial = new Hilo3d.BasicMaterial({
    lightType: 'NONE',
    side: Hilo3d.constants.FRONT_AND_BACK,
    diffuse: new Hilo3d.LazyTexture({
        flipY: true,
        src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href
    })
});

for (let i = 0; i < 100; i++) {
    const rect = new Hilo3d.Mesh({
        geometry,
        material:
            Math.random() < 0.5
                ? textureMaterial
                : new Hilo3d.BasicMaterial({
                      lightType: 'NONE',
                      side: Hilo3d.constants.FRONT_AND_BACK,
                      diffuse: new Hilo3d.Color(Math.random(), Math.random(), Math.random())
                  }),
        x: rand(-1, 1),
        y: rand(-1, 1),
        z: rand(-1, 1)
    });
    rect.setScale(rand(0.2, 0.2));
    stage.addChild(rect);
}
