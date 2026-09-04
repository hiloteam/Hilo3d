import {
    BasicMaterial,
    BoxGeometry,
    Color,
    LazyTexture,
    Matrix4,
    PlaneGeometry,
    Quaternion,
    SphereGeometry,
    Vector3,
    type Geometry
} from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity } from './shared/scene';

const runtime = await createExampleRuntime();
const material = new BasicMaterial({
    diffuse: new LazyTexture({ src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href })
});
const geometryFactories: readonly (() => Geometry)[] = [
    () => new PlaneGeometry({ width: 0.25, height: 0.25 }),
    () => new SphereGeometry({ radius: 0.15 }),
    () => new BoxGeometry({ width: 0.25, height: 0.25, depth: 0.25 })
];
const merged = new BoxGeometry({ width: 0.15, height: 0.15, depth: 0.15 });
const matrix = new Matrix4();
const rotation = new Quaternion();
const position = new Vector3();
const scale = new Vector3();
for (let index = 0; index < 100; index++) {
    const factory = geometryFactories[index % geometryFactories.length];
    if (!factory) throw new RangeError('Missing geometry factory.');
    const radius = 1.35;
    position.set(
        (Math.random() * 2 - 1) * radius,
        (Math.random() * 2 - 1) * radius,
        (Math.random() * 2 - 1) * radius
    );
    rotation
        .identity()
        .rotateX(Math.random() * Math.PI * 2)
        .rotateY(Math.random() * Math.PI * 2)
        .rotateZ(Math.random() * Math.PI * 2);
    const uniformScale = 0.3 + Math.random() * 0.2;
    scale.set(uniformScale, uniformScale, uniformScale);
    merged.merge(factory(), matrix.compose(rotation, position, scale));
}
merged.calculateNormals();
createMeshEntity(runtime.world, {
    geometry: merged,
    material,
    scale: [0.8, 0.8, 0.8]
});
createMeshEntity(runtime.world, {
    geometry: new BoxGeometry(),
    material: new BasicMaterial({ diffuse: new Color(1, 0.08, 0.08) }),
    position: [-1.8, 0, 0],
    scale: [0.1, 0.1, 0.1]
});
runtime.start();
