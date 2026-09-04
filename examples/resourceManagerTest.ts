import {
    BasicMaterial,
    BoxGeometry,
    Color,
    LazyTexture,
    LocalTransform,
    RENDER_WORLD
} from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity, quaternionFromDegrees } from './shared/scene';

const runtime = await createExampleRuntime();
const panel = document.createElement('pre');
panel.id = 'resource-diagnostics';
panel.style.cssText =
    'position:fixed;left:1rem;top:1rem;margin:0;padding:.75rem;background:#000b;color:#fff;font:12px/1.5 monospace;z-index:2';
document.body.append(panel);
const geometry = new BoxGeometry();
const entities = [
    createMeshEntity(runtime.world, {
        geometry,
        material: new BasicMaterial({ diffuse: new Color(0.8, 0, 0) }),
        position: [-1, 0, 0]
    }),
    createMeshEntity(runtime.world, {
        geometry,
        material: new BasicMaterial({
            diffuse: new LazyTexture({
                src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href
            })
        }),
        position: [1, 0, 0]
    })
];
let destroyed = false;
runtime.start(time => {
    entities.forEach((entity, index) => {
        if (!runtime.world.isAlive(entity)) return;
        runtime.world.set(entity, LocalTransform, {
            position: [index === 0 ? -1 : 1, 0, 0],
            rotation: quaternionFromDegrees(time * 30, time * 30)
        });
    });
    const diagnostics = runtime.engine.renderer.resourceManager.getDiagnostics(
        runtime.world.getResource(RENDER_WORLD)
    );
    panel.textContent = JSON.stringify(diagnostics, null, 2);
    if (!destroyed && time % 8 > 4) {
        destroyed = true;
        const target = entities[0];
        if (target && runtime.world.isAlive(target)) runtime.world.destroyEntity(target);
        document.body.dataset['resourceDiagnosticsComplete'] = 'true';
    }
});
