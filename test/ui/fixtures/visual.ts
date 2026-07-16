import {
    AmbientLight,
    BoxGeometry,
    Color,
    DirectionalLight,
    Mesh,
    PBRMaterial,
    PerspectiveCamera,
    Stage,
    Vector3
} from '../../../src/Hilo3d';

const container = document.querySelector<HTMLElement>('#stage');
if (!container) throw new Error('Visual fixture container is missing.');

const camera = new PerspectiveCamera({ aspect: 4 / 3, near: 0.1, far: 100, z: 4 });
const stage = new Stage({
    container,
    camera,
    width: 640,
    height: 480,
    pixelRatio: 1,
    antialias: false,
    preferWebGL2: false,
    clearColor: new Color(0.08, 0.1, 0.14)
});

const mesh = new Mesh({
    geometry: new BoxGeometry(),
    material: new PBRMaterial({
        baseColor: new Color(0.82, 0.19, 0.12),
        metallic: 0.2,
        roughness: 0.55
    }),
    rotationX: 22,
    rotationY: 35
});
stage.addChild(mesh);
stage.addChild(new AmbientLight({ color: new Color(1, 1, 1), amount: 0.45 }));
stage.addChild(
    new DirectionalLight({
        color: new Color(1, 0.96, 0.9),
        amount: 3,
        direction: new Vector3(-1, -0.8, -0.5)
    })
);

stage.tick(0);
window.__HILO3D_VISUAL_READY__ = true;

declare global {
    interface Window {
        __HILO3D_VISUAL_READY__?: boolean;
    }
}
