import {
    BoxGeometry,
    Color,
    DirectionalLight,
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
runtime.engine.renderer.clearColor.set(0.008, 0.012, 0.028, 1);
runtime.controls.setView({ x: 0, y: 0.35, z: 0 }, 5, 0.32, Math.PI / 2);

createMeshEntity(runtime.world, {
    geometry: new PlaneGeometry({ width: 8, height: 8 }),
    material: new PBRMaterial({
        baseColor: new Color(0.26, 0.3, 0.42),
        baseColorMap: new LazyTexture({
            src: new URL('./image/hilo-showroom-grid-v2.jpg', import.meta.url).href
        }),
        metallic: 0.35,
        roughness: 0.64
    }),
    position: [0, -1, 0],
    rotation: quaternionFromDegrees(-90),
    castShadows: false,
    receiveShadows: true
});

const hero = runtime.world.createEntity(LocalTransform, { position: [0, 0.05, 0] });
const core = createMeshEntity(runtime.world, {
    parent: hero,
    geometry: new BoxGeometry({ width: 1.25, height: 1.25, depth: 1.25 }),
    material: new PBRMaterial({
        baseColor: new Color(0.18, 0.9, 0.78),
        metallic: 0.74,
        roughness: 0.2
    }),
    rotation: quaternionFromDegrees(24, 35),
    castShadows: true,
    receiveShadows: true
});
const satelliteGeometry = new SphereGeometry({
    radius: 0.14,
    heightSegments: 16,
    widthSegments: 24
});
for (let index = 0; index < 10; index += 1) {
    const angle = (index / 10) * Math.PI * 2;
    createMeshEntity(runtime.world, {
        parent: hero,
        geometry: satelliteGeometry,
        material: new PBRMaterial({
            baseColor: index % 2 === 0 ? new Color(0.5, 0.42, 1) : new Color(0.25, 0.78, 1),
            metallic: 0.42,
            roughness: 0.25
        }),
        position: [Math.cos(angle) * 1.55, Math.sin(angle * 2) * 0.28, Math.sin(angle) * 1.55],
        castShadows: true,
        receiveShadows: true
    });
}

const sun = runtime.world.createEntity(LocalTransform);
runtime.world.add(sun, DirectionalLight, {
    color: [0.82, 0.92, 1],
    amount: 4.2,
    direction: [-1.3, -1.8, -0.6],
    shadow: { minBias: 0.0004 }
});
for (const light of [
    {
        position: [-2.8, 2.4, 2.4] as const,
        amount: 20,
        range: 12,
        color: [0.2, 0.9, 0.85] as const
    },
    { position: [3.2, 1.2, 1.2] as const, amount: 15, range: 10, color: [0.62, 0.35, 1] as const }
]) {
    const entity = runtime.world.createEntity(LocalTransform, { position: light.position });
    runtime.world.add(entity, PointLight, {
        amount: light.amount,
        range: light.range,
        color: light.color
    });
}

runtime.start(time => {
    runtime.world.set(hero, LocalTransform, {
        position: [0, 0.05, 0],
        rotation: quaternionFromDegrees(0, time * 18, 0)
    });
    runtime.world.set(core, LocalTransform, {
        rotation: quaternionFromDegrees(24 + time * 13, 35, time * 9)
    });
});
