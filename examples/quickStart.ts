import * as Hilo3d from '../src/Hilo3d';
import { resolveExampleBackend } from './shared/init';

const camera = new Hilo3d.PerspectiveCamera({
    aspect: innerWidth / innerHeight,
    z: 4
});
const container = document.querySelector<HTMLElement>('#container');
if (!container) throw new Error('Quick start example requires #container');

const stage = await Hilo3d.Stage.create<Hilo3d.RendererBackend>({
    backend: resolveExampleBackend(),
    container,
    camera,
    width: innerWidth,
    height: innerHeight
});

const mesh = new Hilo3d.Mesh({
    geometry: new Hilo3d.BoxGeometry(),
    material: new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.832, 0.119, 0.093)
    })
}).addTo(stage);
mesh.onUpdate = () => {
    mesh.rotationY += 1;
    mesh.rotationX += 1;
};

stage
    .addChild(
        new Hilo3d.AmbientLight({
            color: new Hilo3d.Color(1, 1, 1),
            amount: 0.5
        })
    )
    .addChild(
        new Hilo3d.DirectionalLight({
            color: new Hilo3d.Color(1, 1, 1),
            amount: 5,
            direction: new Hilo3d.Vector3(-1.3, -0.8, 0)
        })
    );

const ticker = new Hilo3d.Ticker(60);
ticker.addTick(stage);
ticker.start();
