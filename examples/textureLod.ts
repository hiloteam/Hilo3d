import { LazyTexture, LocalTransform, PBRMaterial, SphereGeometry } from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity, quaternionFromDegrees } from './shared/scene';

const runtime = await createExampleRuntime();
const mesh = createMeshEntity(runtime.world, {
    geometry: new SphereGeometry({ radius: 1, widthSegments: 64, heightSegments: 32 }),
    material: new PBRMaterial({
        baseColorMap: new LazyTexture({
            src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href
        })
    })
});
runtime.start(time => {
    runtime.world.set(mesh, LocalTransform, { rotation: quaternionFromDegrees(0, time * 24) });
});
