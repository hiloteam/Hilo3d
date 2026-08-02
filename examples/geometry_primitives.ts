import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { stage, renderer } = await createExampleContext({
    camera: { far: 30, near: 0.1, x: 0, y: 1.4, z: 6 },
    controls: { enablePan: true, target: new Hilo3d.Vector3(0, 0.15, 0) }
});
renderer.clearColor.set(0.008, 0.012, 0.028, 1);

const floorTexture = new Hilo3d.LazyTexture({
    src: new URL('./image/hilo-showroom-grid-v2.jpg', import.meta.url).href
});
new Hilo3d.Mesh({
    y: -1,
    rotationX: -90,
    geometry: new Hilo3d.PlaneGeometry(),
    material: new Hilo3d.PBRMaterial({
        baseColorMap: floorTexture,
        baseColor: new Hilo3d.Color(0.24, 0.28, 0.38),
        metallic: 0.35,
        roughness: 0.62
    }),
    castShadows: false
})
    .setScale(7)
    .addTo(stage);

const geometries = [
    new Hilo3d.BoxGeometry({ width: 1.25, height: 1.25, depth: 1.25 }),
    new Hilo3d.SphereGeometry({ radius: 0.72, heightSegments: 24, widthSegments: 36 })
] as const;
const colors = [new Hilo3d.Color(0.2, 0.86, 0.78), new Hilo3d.Color(0.52, 0.42, 1)] as const;

geometries.forEach((geometry, index) => {
    const baseColor = colors[index];
    if (!baseColor) throw new RangeError(`Missing primitive color ${String(index)}`);
    const mesh = new Hilo3d.Mesh({
        x: index === 0 ? -1.25 : 0.55,
        y: -0.25,
        geometry,
        material: new Hilo3d.PBRMaterial({
            baseColor,
            metallic: index === 0 ? 0.72 : 0.18,
            roughness: index === 0 ? 0.22 : 0.38
        })
    }).addTo(stage);
    mesh.onUpdate = deltaTime => {
        mesh.rotationY += deltaTime * (index === 0 ? 0.028 : -0.02);
        mesh.rotationX = Math.sin(performance.now() * 0.00045 + index) * 12;
    };
});

const lineGeometry = new Hilo3d.Geometry({ mode: Hilo3d.constants.LINES });
const ringSegments = 64;
for (let segment = 0; segment < ringSegments; segment += 1) {
    const angle0 = (segment / ringSegments) * Math.PI * 2;
    const angle1 = ((segment + 1) / ringSegments) * Math.PI * 2;
    lineGeometry.addPoints(
        [Math.cos(angle0), Math.sin(angle0), 0],
        [Math.cos(angle1), Math.sin(angle1), 0]
    );
    lineGeometry.addIndices(segment * 2, segment * 2 + 1);
}
const ring = new Hilo3d.Mesh({
    x: 2.25,
    y: -0.25,
    rotationX: 68,
    geometry: lineGeometry,
    material: new Hilo3d.BasicMaterial({
        diffuse: new Hilo3d.Color(0.42, 0.82, 1),
        lightType: 'NONE'
    })
}).addTo(stage);
ring.onUpdate = deltaTime => {
    ring.rotationY += deltaTime * 0.035;
    ring.rotationZ += deltaTime * 0.018;
};

new Hilo3d.PointLight({
    x: -2.5,
    y: 3,
    z: 2,
    amount: 18,
    range: 12,
    color: new Hilo3d.Color(0.25, 0.9, 1)
}).addTo(stage);
new Hilo3d.PointLight({
    x: 3,
    y: 1.5,
    z: 1,
    amount: 12,
    range: 10,
    color: new Hilo3d.Color(0.62, 0.35, 1)
}).addTo(stage);
