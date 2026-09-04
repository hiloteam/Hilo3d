import {
    BasicMaterial,
    BoxGeometry,
    Color,
    Hierarchy,
    LazyTexture,
    LocalTransform,
    PBRMaterial,
    PlaneGeometry,
    PointLight,
    SphereGeometry
} from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity, quaternionFromDegrees } from './shared/scene';

const runtime = await createExampleRuntime();
runtime.engine.renderer.clearColor.set(0.005, 0.008, 0.02, 1);
createMeshEntity(runtime.world, {
    geometry: new PlaneGeometry(),
    material: new PBRMaterial({
        baseColorMap: new LazyTexture({
            src: new URL('./image/hilo-showroom-grid-v2.jpg', import.meta.url).href
        }),
        baseColor: new Color(0.2, 0.24, 0.34),
        metallic: 0.28,
        roughness: 0.6
    }),
    position: [0, -1.25, 0],
    rotation: quaternionFromDegrees(-90),
    scale: [8, 8, 8],
    castShadows: false
});
const sculpture = runtime.world.createEntity(LocalTransform, { position: [0, -0.1, 0] });
const sphereGeometry = new SphereGeometry({ radius: 0.46, heightSegments: 24, widthSegments: 32 });
const boxGeometry = new BoxGeometry({ width: 0.76, height: 0.76, depth: 0.76 });
const materials = [
    new PBRMaterial({ baseColor: new Color(0.13, 0.18, 0.28), metallic: 0.88, roughness: 0.16 }),
    new PBRMaterial({ baseColor: new Color(0.36, 0.42, 0.56), metallic: 0.25, roughness: 0.32 })
] as const;
const sculpturePositions = [
    [-1.6, -0.35, 0],
    [-0.8, 0.35, -0.35],
    [0, -0.28, 0.25],
    [0.82, 0.42, -0.2],
    [1.62, -0.3, 0.1]
] as const;
const objects = sculpturePositions.map((position, index) =>
    createMeshEntity(runtime.world, {
        parent: sculpture,
        geometry: index % 2 === 0 ? sphereGeometry : boxGeometry,
        material: materials[index % materials.length] ?? materials[0],
        position,
        rotation: quaternionFromDegrees(index * 19, index * 31, 0)
    })
);
const lightSpecs = [
    { color: [0.1, 0.68, 1] as const, radius: 2.6, speed: 0.42, phase: 0 },
    { color: [1, 0.18, 0.48] as const, radius: 3.1, speed: -0.34, phase: Math.PI * 0.66 },
    { color: [0.42, 1, 0.58] as const, radius: 2.25, speed: 0.5, phase: Math.PI * 1.3 }
] as const;
const lights = lightSpecs.map((spec, index) => {
    const entity = runtime.world.createEntity(LocalTransform);
    runtime.world.add(entity, PointLight, {
        amount: 24,
        range: 9,
        color: spec.color,
        ...(index === 0 ? { shadow: { minBias: 0.001, maxBias: 0.02 } } : {})
    });
    const marker = createMeshEntity(runtime.world, {
        geometry: new SphereGeometry({ radius: 0.09 }),
        material: new BasicMaterial({
            diffuse: new Color(spec.color[0] * 2.4, spec.color[1] * 2.4, spec.color[2] * 2.4),
            lightType: 'NONE'
        })
    });
    runtime.world.add(marker, Hierarchy, { parent: entity });
    return entity;
});
runtime.start(time => {
    objects.forEach((entity, index) => {
        const position = sculpturePositions[index];
        if (!position) return;
        runtime.world.set(entity, LocalTransform, {
            position,
            rotation: quaternionFromDegrees(time * 12 + index * 19, time * 22 + index * 31)
        });
    });
    lights.forEach((entity, index) => {
        const spec = lightSpecs[index];
        if (!spec) return;
        const angle = spec.phase + time * spec.speed;
        runtime.world.set(entity, LocalTransform, {
            position: [
                Math.cos(angle) * spec.radius,
                1.25 + Math.sin(angle * 1.7 + index) * 1.05,
                Math.sin(angle) * spec.radius + 0.8
            ]
        });
    });
});
