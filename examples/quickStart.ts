import * as Hilo3d from '../src/Hilo3d';
import OrbitControls from './shared/OrbitControls';
import { addEnvironmentSkybox, applyEnvironmentMaps } from './shared/environment';
import { loadEnvironmentMaps, resolveExampleBackend } from './shared/init';

const cameraTarget = new Hilo3d.Vector3(0, 0.35, 0);
const camera = new Hilo3d.PerspectiveCamera({
    aspect: innerWidth / innerHeight,
    far: 40,
    near: 0.1,
    x: 0,
    y: 1.65,
    z: 5
});
const container = document.querySelector<HTMLElement>('#container');
if (!container) throw new Error('Quick start example requires #container');

const stage = await Hilo3d.Stage.create<Hilo3d.RendererBackend>({
    backend: resolveExampleBackend(),
    container,
    camera,
    width: innerWidth,
    height: innerHeight,
    antialias: true,
    clearColor: new Hilo3d.Color(0.008, 0.012, 0.028)
});
const orbitControls = new OrbitControls(stage, {
    target: cameraTarget,
    enablePan: false,
    minDistance: 2,
    maxDistance: 12
});

const environment = await loadEnvironmentMaps();
addEnvironmentSkybox(stage, environment.skyboxMap);

const floorMaterial = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.26, 0.3, 0.42),
    baseColorMap: new Hilo3d.LazyTexture({
        src: new URL('./image/hilo-showroom-grid-v2.jpg', import.meta.url).href
    }),
    metallic: 0.35,
    roughness: 0.64,
    castShadows: false,
    receiveShadows: true
});
new Hilo3d.Mesh({
    y: -1,
    rotationX: -90,
    geometry: new Hilo3d.PlaneGeometry(),
    material: floorMaterial
})
    .setScale(8)
    .addTo(stage);

const hero = new Hilo3d.Node({ y: 0.05 }).addTo(stage);
const coreMaterial = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.18, 0.9, 0.78),
    metallic: 0.74,
    roughness: 0.2
});
const core = new Hilo3d.Mesh({
    geometry: new Hilo3d.BoxGeometry({ width: 1.25, height: 1.25, depth: 1.25 }),
    material: coreMaterial,
    rotationX: 24,
    rotationY: 35
}).addTo(hero);

const satelliteGeometry = new Hilo3d.SphereGeometry({
    radius: 0.14,
    heightSegments: 16,
    widthSegments: 24
});
const satelliteMaterials: Hilo3d.PBRMaterial[] = [];
for (let index = 0; index < 10; index += 1) {
    const angle = (index / 10) * Math.PI * 2;
    const material = new Hilo3d.PBRMaterial({
        baseColor:
            index % 2 === 0 ? new Hilo3d.Color(0.5, 0.42, 1) : new Hilo3d.Color(0.25, 0.78, 1),
        metallic: 0.42,
        roughness: 0.25
    });
    satelliteMaterials.push(material);
    new Hilo3d.Mesh({
        x: Math.cos(angle) * 1.55,
        y: Math.sin(angle * 2) * 0.28,
        z: Math.sin(angle) * 1.55,
        geometry: satelliteGeometry,
        material
    }).addTo(hero);
}
applyEnvironmentMaps([floorMaterial, coreMaterial, ...satelliteMaterials], environment);
hero.onUpdate = deltaTime => {
    hero.rotationY += deltaTime * 0.018;
    core.rotationX += deltaTime * 0.013;
    core.rotationZ += deltaTime * 0.009;
};

stage
    .addChild(
        new Hilo3d.AmbientLight({
            color: new Hilo3d.Color(0.28, 0.34, 0.55),
            amount: 0.32
        })
    )
    .addChild(
        new Hilo3d.DirectionalLight({
            color: new Hilo3d.Color(0.82, 0.92, 1),
            amount: 4.2,
            direction: new Hilo3d.Vector3(-1.3, -1.8, -0.6),
            shadow: {
                width: 2048,
                height: 2048,
                cameraInfo: {
                    left: -7,
                    right: 7,
                    bottom: -7,
                    top: 7,
                    near: 0.1,
                    far: 30,
                    x: 6.5,
                    y: 9,
                    z: 3
                }
            }
        })
    )
    .addChild(
        new Hilo3d.PointLight({
            x: -2.8,
            y: 2.4,
            z: 2.4,
            amount: 20,
            range: 12,
            color: new Hilo3d.Color(0.2, 0.9, 0.85)
        })
    )
    .addChild(
        new Hilo3d.PointLight({
            x: 3.2,
            y: 1.2,
            z: 1.2,
            amount: 15,
            range: 10,
            color: new Hilo3d.Color(0.62, 0.35, 1)
        })
    );

const ticker = new Hilo3d.Ticker(60);
ticker.addTick(stage);
ticker.start();

const handleResize = (): void => {
    camera.aspect = innerWidth / innerHeight;
    stage.resize(innerWidth, innerHeight);
};
window.addEventListener('resize', handleResize);
window.addEventListener('beforeunload', () => {
    window.removeEventListener('resize', handleResize);
    orbitControls.dispose();
    ticker.stop();
});
