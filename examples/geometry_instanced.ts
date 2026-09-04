import { Color, LocalTransform, PBRMaterial, PointLight, SphereGeometry } from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity } from './shared/scene';

const runtime = await createExampleRuntime();
runtime.engine.renderer.clearColor.set(0.004, 0.007, 0.018, 1);
const root = runtime.world.createEntity(LocalTransform);
const geometry = new SphereGeometry({ radius: 0.095, heightSegments: 12, widthSegments: 16 });
const materials = [
    new PBRMaterial({ baseColor: new Color(0.12, 0.86, 0.82), metallic: 0.54, roughness: 0.24 }),
    new PBRMaterial({ baseColor: new Color(0.52, 0.38, 1), metallic: 0.3, roughness: 0.32 })
] as const;
for (let row = 0; row < 14; row++) {
    for (let column = 0; column < 24; column++) {
        const normalizedX = column / 23;
        const normalizedY = row / 13;
        const material = materials[(row + column) % materials.length];
        if (!material) throw new RangeError('Missing instanced material.');
        createMeshEntity(runtime.world, {
            parent: root,
            geometry,
            material,
            useInstanced: true,
            position: [
                (normalizedX - 0.5) * 5.8,
                (normalizedY - 0.5) * 3.2,
                Math.sin(normalizedX * Math.PI * 4 + normalizedY * Math.PI * 2) * 0.48
            ]
        });
    }
}
for (const [position, color, amount, range] of [
    [[-3.5, 2.5, 3.5], [0.2, 0.9, 1], 22, 14],
    [[3.8, -1.5, 2], [0.68, 0.32, 1], 18, 12]
] as const) {
    const light = runtime.world.createEntity(LocalTransform, { position });
    runtime.world.add(light, PointLight, { color, amount, range });
}
runtime.start(time => {
    const angle = time * 0.35;
    runtime.world.set(root, LocalTransform, {
        rotation: [0, Math.sin(angle * 0.5), 0, Math.cos(angle * 0.5)]
    });
});
