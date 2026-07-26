import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { camera, stage, renderer } = await createExampleContext({
    stage: {
        renderPipeline: new Hilo3d.PostProcessRenderPipelineFactory({
            bloom: {
                threshold: 0.8,
                knee: 0.45,
                intensity: 1.15,
                scatter: 0.72,
                maxLevels: 7
            },
            colorUber: {
                exposure: -0.15,
                contrast: 0.08,
                saturation: 0.08,
                toneMapping: 'pbr-neutral',
                vignetteIntensity: 0.7,
                vignetteSmoothness: 0.55,
                vignetteColor: new Hilo3d.Color(0.002, 0.004, 0.012, 0.55)
            }
        })
    }
});

camera.far = 20;
camera.z = 4.35;
camera.lookAt(new Hilo3d.Vector3());
renderer.clearColor.set(0.002, 0.004, 0.012, 1);

const root = new Hilo3d.Node().addTo(stage);
const sphereGeometry = new Hilo3d.SphereGeometry({
    radius: 0.11,
    heightSegments: 14,
    widthSegments: 18
});
const materials = [
    new Hilo3d.BasicMaterial({
        lightType: 'NONE',
        diffuse: new Hilo3d.Color(0.35, 2.2, 2.5)
    }),
    new Hilo3d.BasicMaterial({
        lightType: 'NONE',
        diffuse: new Hilo3d.Color(1.5, 0.36, 2.4)
    }),
    new Hilo3d.BasicMaterial({
        lightType: 'NONE',
        diffuse: new Hilo3d.Color(2.5, 0.72, 0.2)
    })
] as const;

const particleCount = 72;
for (let index = 0; index < particleCount; index += 1) {
    const progress = index / particleCount;
    const angle = progress * Math.PI * 8;
    const radius = 0.75 + progress * 1.55;
    const material = materials[index % materials.length];
    if (material === undefined) throw new RangeError('Missing bloom particle material');
    const mesh = new Hilo3d.Mesh({
        geometry: sphereGeometry,
        material,
        x: Math.cos(angle) * radius,
        y: (progress - 0.5) * 3.2,
        z: Math.sin(angle) * radius * 0.42
    }).addTo(root);
    mesh.setScale(0.65 + (index % 5) * 0.11);
}

const core = new Hilo3d.Mesh({
    geometry: new Hilo3d.BoxGeometry({ width: 0.8, height: 0.8, depth: 0.8 }),
    material: new Hilo3d.BasicMaterial({
        lightType: 'NONE',
        diffuse: new Hilo3d.Color(1.2, 0.42, 2.1)
    }),
    rotationX: 35,
    rotationY: 45
}).addTo(root);

root.onUpdate = deltaTime => {
    root.rotationY += deltaTime * 0.018;
    root.rotationZ += deltaTime * 0.006;
    core.rotationX += deltaTime * 0.02;
    core.rotationY -= deltaTime * 0.014;
};
