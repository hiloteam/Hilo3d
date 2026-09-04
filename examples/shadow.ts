import {
    BoxGeometry,
    Color,
    DirectionalLight,
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
    runtime.world.set(root, LocalTransform, {
        position: [0, 0.205, 0],
        scale: [0.0005, 0.0005, 0.0005]
    });
}
createMeshEntity(runtime.world, {
    geometry: new PlaneGeometry(),
    material: new PBRMaterial({
        baseColorMap: new LazyTexture({
            src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href
        })
    }),
    rotation: quaternionFromDegrees(-90),
    castShadows: false
});
const box = createMeshEntity(runtime.world, {
    geometry: new BoxGeometry(),
    material: new PBRMaterial({ baseColor: new Color(0.9, 0.6, 0.3) }),
    position: [0.3, 0.2, 0.2],
    scale: [0.1, 0.1, 0.1]
});
const directional = runtime.world.createEntity(LocalTransform);
runtime.world.add(directional, DirectionalLight, {
    color: [1, 1, 1],
    direction: [-0.8, -1, 0],
    amount: 3,
    shadow: {
        cameraInfo: { left: -0.5, right: 0.5, near: -0.5, far: 0.5, top: 0.5, bottom: -0.5 },
        debug: true
    }
});
const spot = runtime.world.createEntity(LocalTransform, { position: [0, 1, 0] });
runtime.world.add(spot, SpotLight, {
    cutoff: 8,
    outerCutoff: 9,
    range: 3,
    color: [1, 0, 0],
    direction: [0.2, -1, 0],
    amount: 5,
    shadow: { debug: true, minBias: 0.0001 }
});
runtime.start(time => {
    runtime.world.set(box, LocalTransform, {
        position: [0.3, 0.2, 0.2],
        rotation: quaternionFromDegrees(time * 48, time * 48),
        scale: [0.1, 0.1, 0.1]
    });
    runtime.world.set(directional, DirectionalLight, {
        color: [1, 1, 1],
        direction: [-Math.cos(time * 0.5) * 0.8, -1, Math.sin(time * 0.5) * 0.8],
        amount: 3,
        shadow: {
            cameraInfo: { left: -0.5, right: 0.5, near: -0.5, far: 0.5, top: 0.5, bottom: -0.5 },
            debug: true
        }
    });
});
