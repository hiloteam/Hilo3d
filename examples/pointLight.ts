import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { stage, renderer, directionLight, ambientLight } = await createExampleContext({
    camera: { far: 40, near: 0.1, x: 0, y: 1.85, z: 6.4 },
    controls: { enablePan: true, target: new Hilo3d.Vector3(0, 0.1, 0) }
});
renderer.clearColor.set(0.005, 0.008, 0.02, 1);
directionLight.amount = 0.45;
ambientLight.amount = 0.12;

new Hilo3d.Mesh({
    y: -1.25,
    rotationX: -90,
    geometry: new Hilo3d.PlaneGeometry(),
    material: new Hilo3d.PBRMaterial({
        baseColorMap: new Hilo3d.LazyTexture({
            src: new URL('./image/hilo-showroom-grid-v2.jpg', import.meta.url).href
        }),
        baseColor: new Hilo3d.Color(0.2, 0.24, 0.34),
        metallic: 0.28,
        roughness: 0.6
    }),
    castShadows: false
})
    .setScale(8)
    .addTo(stage);

const sculpture = new Hilo3d.Node({ y: -0.1 }).addTo(stage);
const sphereGeometry = new Hilo3d.SphereGeometry({
    radius: 0.46,
    heightSegments: 24,
    widthSegments: 32
});
const boxGeometry = new Hilo3d.BoxGeometry({ width: 0.76, height: 0.76, depth: 0.76 });
const materials = [
    new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.13, 0.18, 0.28),
        metallic: 0.88,
        roughness: 0.16
    }),
    new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.36, 0.42, 0.56),
        metallic: 0.25,
        roughness: 0.32
    })
] as const;

const sculpturePositions = [
    [-1.6, -0.35, 0],
    [-0.8, 0.35, -0.35],
    [0, -0.28, 0.25],
    [0.82, 0.42, -0.2],
    [1.62, -0.3, 0.1]
] as const;
sculpturePositions.forEach((position, index) => {
    const [x, y, z] = position;
    const material = materials[index % materials.length];
    if (!material) throw new RangeError('Missing sculpture material');
    const mesh = new Hilo3d.Mesh({
        x,
        y,
        z,
        rotationX: index * 19,
        rotationY: index * 31,
        geometry: index % 2 === 0 ? sphereGeometry : boxGeometry,
        material
    }).addTo(sculpture);
    mesh.onUpdate = deltaTime => {
        mesh.rotationY += deltaTime * (0.012 + index * 0.0015);
        mesh.rotationX += deltaTime * 0.006;
    };
});

const lightSpecs = [
    {
        color: new Hilo3d.Color(0.1, 0.68, 1),
        radius: 2.6,
        speed: 0.00042,
        phase: 0
    },
    {
        color: new Hilo3d.Color(1, 0.18, 0.48),
        radius: 3.1,
        speed: -0.00034,
        phase: Math.PI * 0.66
    },
    {
        color: new Hilo3d.Color(0.42, 1, 0.58),
        radius: 2.25,
        speed: 0.0005,
        phase: Math.PI * 1.3
    }
] as const;

lightSpecs.forEach((spec, index) => {
    let elapsed = 0;
    const light = new Hilo3d.PointLight({
        amount: 24,
        range: 9,
        color: spec.color,
        ...(index === 0 ? { shadow: { minBias: 0.001, maxBias: 0.02 } } : {})
    }).addTo(stage);
    new Hilo3d.Mesh({
        geometry: new Hilo3d.SphereGeometry({
            radius: 0.09,
            heightSegments: 12,
            widthSegments: 16
        }),
        material: new Hilo3d.BasicMaterial({
            diffuse: new Hilo3d.Color(spec.color.r * 2.4, spec.color.g * 2.4, spec.color.b * 2.4),
            lightType: 'NONE'
        })
    }).addTo(light);
    light.onUpdate = deltaTime => {
        elapsed += deltaTime;
        const angle = spec.phase + elapsed * spec.speed;
        light.x = Math.cos(angle) * spec.radius;
        light.z = Math.sin(angle) * spec.radius + 0.8;
        light.y = 1.25 + Math.sin(angle * 1.7 + index) * 1.05;
    };
});
