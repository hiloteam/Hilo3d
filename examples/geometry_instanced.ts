import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { camera, stage, renderer, ambientLight } = await createExampleContext({
    camera: { far: 50, near: 0.1, x: 0, y: 1.1, z: 6.5 },
    stage: { useInstanced: true },
    controls: { enablePan: true }
});
camera.lookAt(new Hilo3d.Vector3());
renderer.clearColor.set(0.004, 0.007, 0.018, 1);
ambientLight.amount = 0.18;

const root = new Hilo3d.Node().addTo(stage);
const geometry = new Hilo3d.SphereGeometry({
    radius: 0.095,
    heightSegments: 12,
    widthSegments: 16
});
const materials = [
    new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.12, 0.86, 0.82),
        metallic: 0.54,
        roughness: 0.24
    }),
    new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.52, 0.38, 1),
        metallic: 0.3,
        roughness: 0.32
    })
] as const;

const columnCount = 24;
const rowCount = 14;
for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < columnCount; column += 1) {
        const normalizedX = column / (columnCount - 1);
        const normalizedY = row / (rowCount - 1);
        const x = (normalizedX - 0.5) * 5.8;
        const y = (normalizedY - 0.5) * 3.2;
        const wave = Math.sin(normalizedX * Math.PI * 4 + normalizedY * Math.PI * 2);
        const material = materials[(row + column) % materials.length];
        if (!material) throw new RangeError('Missing instanced material');
        new Hilo3d.Mesh({
            useInstanced: true,
            geometry,
            material,
            x,
            y,
            z: wave * 0.48
        }).addTo(root);
    }
}

root.onUpdate = deltaTime => {
    root.rotationY += deltaTime * 0.012;
    root.rotationX = Math.sin(performance.now() * 0.00035) * 9;
};

new Hilo3d.PointLight({
    x: -3.5,
    y: 2.5,
    z: 3.5,
    amount: 22,
    range: 14,
    color: new Hilo3d.Color(0.2, 0.9, 1)
}).addTo(stage);
new Hilo3d.PointLight({
    x: 3.8,
    y: -1.5,
    z: 2,
    amount: 18,
    range: 12,
    color: new Hilo3d.Color(0.68, 0.32, 1)
}).addTo(stage);
