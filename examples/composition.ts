import {
    BasicMaterial,
    BoxGeometry,
    Color,
    Hierarchy,
    LocalTransform,
    MeshRenderer,
    PointerTarget
} from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';

const runtime = await createExampleRuntime();
const pivot = runtime.world.createEntity();
runtime.world.add(pivot, LocalTransform, {});
for (let index = 0; index < 12; index++) {
    const angle = (index / 12) * Math.PI * 2;
    const entity = runtime.world.createEntity();
    runtime.world.add(entity, LocalTransform, {
        position: [Math.cos(angle) * 2.2, Math.sin(angle * 3) * 0.35, Math.sin(angle) * 2.2],
        scale: [0.35, 0.35, 0.35]
    });
    runtime.world.add(entity, Hierarchy, { parent: pivot });
    runtime.world.add(entity, MeshRenderer, {
        geometry: new BoxGeometry(),
        material: new BasicMaterial({
            diffuse: new Color(0.25 + index * 0.035, 0.45, 1 - index * 0.045)
        })
    });
    runtime.world.add(entity, PointerTarget, { propagation: 'ancestors' });
}
runtime.start(time => {
    runtime.world.set(pivot, LocalTransform, {
        rotation: [0, Math.sin(time * 0.3) * 0.55, 0, 1]
    });
});
