import {
    Color,
    LocalTransform,
    PBRMaterial,
    PointLight,
    SphereGeometry,
    SphericalHarmonics3
} from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity } from './shared/scene';

const runtime = await createExampleRuntime();
runtime.controls.setView({ x: 0, y: 0, z: 0 }, 15, 0.85, 1.1);
const coefficients = [
    [1.8839, 1.2337, 1.6816],
    [1.0005, 0.8691, 1.4888],
    [0.5604, 0.2578, 0.1937],
    [1.3072, 0.6636, 0.6695],
    [0.564, 0.3794, 0.4919],
    [0.2726, 0.1433, 0.1156],
    [-0.1382, -0.0571, -0.0488],
    [0.5351, 0.2632, 0.2453],
    [0.4328, 0.1264, -0.0042]
] as const;
const harmonics = new SphericalHarmonics3()
    .fromArray(coefficients.map(value => [...value]))
    .scaleForRender();
const colors = [
    [0.56, 0.57, 0.58],
    [0.95, 0.64, 0.54],
    [1, 0.71, 0.29],
    [0.95, 0.93, 0.88]
] as const;
const geometry = new SphereGeometry({ radius: 0.42, heightSegments: 16, widthSegments: 32 });
for (let row = 0; row < 6; row++) {
    for (let column = 0; column < 6; column++) {
        const color = colors[column % colors.length] ?? colors[0];
        createMeshEntity(runtime.world, {
            geometry,
            material: new PBRMaterial({
                baseColor: new Color(...color),
                metallic: column / 5,
                roughness: row / 5,
                diffuseEnvSphereHarmonics3: harmonics
            }),
            position: [(column - 2.5) * 1.05, (2.5 - row) * 1.05, 0]
        });
    }
}
const light = runtime.world.createEntity(LocalTransform, { position: [5, 0, 5] });
runtime.world.add(light, PointLight, { color: [0.3, 0.3, 0.3], range: 50, amount: 6 });
runtime.start(time => {
    runtime.world.set(light, LocalTransform, { position: [Math.sin(time) * 5, 0, 5] });
});
