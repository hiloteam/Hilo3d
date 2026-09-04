import {
    BasicMaterial,
    Color,
    Fog,
    LazyTexture,
    LocalTransform,
    PBRMaterial,
    PlaneGeometry
} from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity, quaternionFromDegrees } from './shared/scene';

const runtime = await createExampleRuntime();
const background = new Color(0.6, 0.8, 0.9);
runtime.engine.renderer.clearColor.copy(background);
runtime.engine.fog = new Fog({ mode: 'EXP2', start: 5, end: 15, density: 0.1, color: background });
const geometry = new PlaneGeometry();
const textured = new PBRMaterial({
    unlit: true,
    baseColorMap: new LazyTexture({ src: new URL('./image/brdfLUT.png', import.meta.url).href }),
    cullMode: 'none'
});
for (let index = 0; index < 100; index++) {
    const radius = 5;
    createMeshEntity(runtime.world, {
        geometry,
        material:
            index % 2 === 0
                ? textured
                : new BasicMaterial({
                      lightType: 'NONE',
                      diffuse: new Color(
                          ((index * 37) % 100) / 100,
                          ((index * 53) % 100) / 100,
                          ((index * 71) % 100) / 100
                      ),
                      cullMode: 'none'
                  }),
        useInstanced: true,
        position: [
            ((index * 47) % 100) / 10 - radius,
            ((index * 61) % 100) / 10 - radius,
            ((index * 29) % 100) / 10 - radius
        ],
        rotation: quaternionFromDegrees(index * 17, index * 29, index * 11),
        scale: [1 + (index % 2), 1 + (index % 2), 1]
    });
}
runtime.start(time => {
    runtime.world.set(runtime.camera, LocalTransform, {
        position: [Math.sin(time * 0.12) * 3, 1.5, 8]
    });
});
