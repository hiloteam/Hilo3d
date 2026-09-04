import {
    BoxGeometry,
    Color,
    GLTFLoader,
    LazyTexture,
    LocalTransform,
    PBRMaterial,
    PlaneGeometry,
    SpotLight
} from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity, quaternionFromDegrees } from './shared/scene';

const runtime = await createExampleRuntime();
runtime.controls.setView({ x: 0, y: 0.2, z: 0 }, 3, 0.8, 1.1);
const model = await new GLTFLoader().load({ src: './models/Tmall/Tmall.gltf' });
const instance = model.instantiate(runtime.world);
for (const root of instance.roots) {
    const transform = runtime.world.get(root, LocalTransform);
    runtime.world.set(root, LocalTransform, {
        ...(transform.position === undefined ? {} : { position: transform.position }),
        ...(transform.rotation === undefined ? {} : { rotation: transform.rotation }),
        scale: [0.002, 0.002, 0.002]
    });
}
createMeshEntity(runtime.world, {
    geometry: new PlaneGeometry(),
    material: new PBRMaterial({
        baseColorMap: new LazyTexture({
            src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href
        })
    }),
    rotation: quaternionFromDegrees(-90)
});
const animatedLight = runtime.world.createEntity(LocalTransform, { position: [0, 1, 0] });
runtime.world.add(animatedLight, SpotLight, {
    color: [1, 0, 0],
    direction: [0.4, -1, 0],
    cutoff: 5,
    outerCutoff: 7,
    range: 2,
    amount: 10,
    shadow: { maxBias: 0.01, minBias: 0.0001 }
});
const greenLight = runtime.world.createEntity(LocalTransform, { position: [0, 1, 0] });
runtime.world.add(greenLight, SpotLight, {
    color: [0.3, 0.9, 0.6],
    direction: [0, -1, 0],
    cutoff: 24,
    outerCutoff: 26,
    range: 2,
    amount: 10,
    shadow: { maxBias: 0.03, minBias: 0.001 }
});
const box = createMeshEntity(runtime.world, {
    geometry: new BoxGeometry(),
    material: new PBRMaterial({ baseColor: new Color(0.9, 0.3, 0.6), roughness: 1, metallic: 1 }),
    position: [0.2, 0.3, 0.2],
    scale: [0.1, 0.1, 0.1]
});
runtime.start(time => {
    runtime.world.set(animatedLight, SpotLight, {
        color: [1, 0, 0],
        direction: [Math.cos(time) * 0.4, -1, Math.sin(time) * 0.4],
        cutoff: 5,
        outerCutoff: 7,
        range: 2,
        amount: 10,
        shadow: { maxBias: 0.01, minBias: 0.0001 }
    });
    runtime.world.set(box, LocalTransform, {
        position: [0.2, 0.3, 0.2],
        rotation: quaternionFromDegrees(time * 40, time * 50),
        scale: [0.1, 0.1, 0.1]
    });
});
