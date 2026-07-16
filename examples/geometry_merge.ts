import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './js/init';

const { stage, ticker } = createExampleContext();

const boxGeometry = new Hilo3d.BoxGeometry();
boxGeometry.setAllRectUV([
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0]
]);

const material = new Hilo3d.BasicMaterial({
    diffuse: new Hilo3d.LazyTexture({
        src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href
    })
});

const redMaterial = new Hilo3d.BasicMaterial({
    diffuse: new Hilo3d.Color(1, 0, 0)
});

const originMesh = new Hilo3d.Mesh({
    geometry: boxGeometry,
    material,
    x: -0.8,
    rotationY: 30
})
    .addTo(stage)
    .setScale(0.1);

const geometryGetters = [
    () => new Hilo3d.PlaneGeometry(),
    () =>
        new Hilo3d.SphereGeometry({
            radius: 0.3
        }),
    () =>
        new Hilo3d.BoxGeometry({
            width: 0.3,
            height: 0.3,
            depth: 0.3
        }).setAllRectUV([
            [0, 1],
            [1, 1],
            [1, 0],
            [0, 0]
        ])
];

const rand = (a: number, b: number): number => {
    return a + Math.random() * (b - a);
};
const randGeometry = (): Hilo3d.Geometry => {
    const getter = geometryGetters[Math.floor(Math.random() * geometryGetters.length)];
    if (!getter) throw new Error('No geometry factories are available');
    return getter();
};

const invertMatrix = new Hilo3d.Matrix4().copy(originMesh.matrix).invert();
const tempMatrix = new Hilo3d.Matrix4();
for (let i = 0; i < 100; i += 1) {
    const r = 0.9;
    const randomMesh = new Hilo3d.Mesh({
        geometry: randGeometry(),
        material,
        x: rand(-r, r),
        y: rand(-r, r),
        z: rand(-r, r)
    });
    randomMesh.rotationX = Math.random() * 360;
    randomMesh.rotationY = Math.random() * 360;
    randomMesh.rotationZ = Math.random() * 360;
    randomMesh.setScale(rand(0.3, 0.4));
    stage.addChild(randomMesh);
    ticker.timeout(
        function () {
            randomMesh.material = redMaterial;
            ticker.timeout(function () {
                randomMesh.removeFromParent();
                if (!randomMesh.geometry) throw new Error('Random mesh lost its geometry');
                boxGeometry.merge(
                    randomMesh.geometry,
                    tempMatrix.copy(invertMatrix).multiply(randomMesh.matrix)
                );
            }, 300);
        },
        i * 30 + 2000
    );
}
