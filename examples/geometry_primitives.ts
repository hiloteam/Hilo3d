import {
    BasicMaterial,
    BoxGeometry,
    Color,
    Geometry,
    LazyTexture,
    LocalTransform,
    PBRMaterial,
    PlaneGeometry,
    PointLight,
    SphereGeometry,
    constants
} from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity, quaternionFromDegrees } from './shared/scene';

const runtime = await createExampleRuntime();
runtime.engine.renderer.clearColor.set(0.008, 0.012, 0.028, 1);
createMeshEntity(runtime.world, {
    geometry: new PlaneGeometry(),
    material: new PBRMaterial({
        baseColorMap: new LazyTexture({
            src: new URL('./image/hilo-showroom-grid-v2.jpg', import.meta.url).href
        }),
        baseColor: new Color(0.24, 0.28, 0.38),
        metallic: 0.35,
        roughness: 0.62
    }),
    position: [0, -1, 0],
    rotation: quaternionFromDegrees(-90),
    scale: [7, 7, 7],
    castShadows: false
});
const geometries = [
    new BoxGeometry({ width: 1.25, height: 1.25, depth: 1.25 }),
    new SphereGeometry({ radius: 0.72, heightSegments: 24, widthSegments: 36 })
] as const;
const colors = [new Color(0.2, 0.86, 0.78), new Color(0.52, 0.42, 1)] as const;
const primitiveEntities = geometries.map((geometry, index) => {
    const baseColor = colors[index];
    if (!baseColor) throw new RangeError(`Missing primitive color ${String(index)}.`);
    return createMeshEntity(runtime.world, {
        geometry,
        material: new PBRMaterial({
            baseColor,
            metallic: index === 0 ? 0.72 : 0.18,
            roughness: index === 0 ? 0.22 : 0.38
        }),
        position: [index === 0 ? -1.25 : 0.55, -0.25, 0]
    });
});
const lineGeometry = new Geometry({ mode: constants.LINES });
for (let segment = 0; segment < 64; segment++) {
    const angle0 = (segment / 64) * Math.PI * 2;
    const angle1 = ((segment + 1) / 64) * Math.PI * 2;
    lineGeometry.addPoints(
        [Math.cos(angle0), Math.sin(angle0), 0],
        [Math.cos(angle1), Math.sin(angle1), 0]
    );
    lineGeometry.addIndices(segment * 2, segment * 2 + 1);
}
const ring = createMeshEntity(runtime.world, {
    geometry: lineGeometry,
    material: new BasicMaterial({ diffuse: new Color(0.42, 0.82, 1), lightType: 'NONE' }),
    position: [2.25, -0.25, 0]
});
for (const [position, color, amount, range] of [
    [[-2.5, 3, 2], [0.25, 0.9, 1], 18, 12],
    [[3, 1.5, 1], [0.62, 0.35, 1], 12, 10]
] as const) {
    const light = runtime.world.createEntity(LocalTransform, { position });
    runtime.world.add(light, PointLight, { color, amount, range });
}
runtime.start(time => {
    primitiveEntities.forEach((entity, index) => {
        runtime.world.set(entity, LocalTransform, {
            position: [index === 0 ? -1.25 : 0.55, -0.25, 0],
            rotation: quaternionFromDegrees(
                Math.sin(time * 0.45 + index) * 12,
                time * (index === 0 ? 24 : -18)
            )
        });
    });
    runtime.world.set(ring, LocalTransform, {
        position: [2.25, -0.25, 0],
        rotation: quaternionFromDegrees(68, time * 30, time * 16)
    });
});
