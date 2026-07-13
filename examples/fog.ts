import * as Hilo3d from '../src/Hilo3d';
import OrbitControls from './shared/OrbitControls';
import Stats from './shared/stats';

const container = document.getElementById('container');
if (!container) throw new Error('Fog example requires #container');
const camera = new Hilo3d.PerspectiveCamera({
    aspect: innerWidth / innerHeight,
    far: 200,
    z: 10
});
const backgroundColor = new Hilo3d.Color(0.6, 0.8, 0.9);
const stage = new Hilo3d.Stage({
    container,
    camera,
    width: innerWidth,
    height: innerHeight,
    clearColor: backgroundColor
});
stage.renderer.fog = new Hilo3d.Fog({
    mode: 'EXP2',
    start: 5,
    end: 15,
    density: 0.1,
    color: backgroundColor
});
stage.renderer.useInstanced = true;

const ticker = new Hilo3d.Ticker(60);
ticker.addTick(stage);
ticker.addTick(Hilo3d.Tween);
ticker.start();

new Stats(ticker, stage.renderer.renderInfo);
new OrbitControls(stage);

function randInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min)) + min;
}

const loader = new Hilo3d.BasicLoader();
void loader
    .load({
        src: new URL('./image/brdfLUT.png', import.meta.url).href
    })
    .then(image => {
        if (!(image instanceof HTMLImageElement)) {
            throw new TypeError('Fog texture request did not return an image');
        }
        return new Hilo3d.Texture({ image });
    })
    .then(function (diffuse) {
        const material = new Hilo3d.PBRMaterial({
            lightType: 'NONE',
            baseColorMap: diffuse,
            side: Hilo3d.constants.FRONT_AND_BACK
        });
        const geometry = new Hilo3d.PlaneGeometry();

        for (let i = 0; i < 100; i++) {
            const r = 5;
            const rect = new Hilo3d.Mesh({
                useInstanced: true,
                geometry,
                material:
                    Math.random() < 0.5
                        ? material
                        : new Hilo3d.BasicMaterial({
                              lightType: 'NONE',
                              diffuse: new Hilo3d.Color(
                                  Math.random(),
                                  Math.random(),
                                  Math.random()
                              ),
                              side: Hilo3d.constants.FRONT_AND_BACK
                          }),
                x: randInt(-r, r),
                y: randInt(-r, r),
                z: randInt(-r, r)
            });
            rect.rotationX = Math.random() * 360;
            rect.rotationY = Math.random() * 360;
            rect.rotationZ = Math.random() * 360;
            rect.setScale(randInt(1, 2));
            stage.addChild(rect);
        }
    })
    .catch((error: unknown) => {
        console.error('Failed to initialize fog example', error);
    });
