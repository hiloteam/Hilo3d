import {
    BasicMaterial,
    Color,
    LocalTransform,
    MeshPicker,
    PlaneGeometry,
    type Entity
} from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity } from './shared/scene';

function random(min: number, max: number): number {
    return Math.random() * (max - min) + min;
}

const runtime = await createExampleRuntime();
runtime.controls.setView({ x: 0, y: 0, z: 0 }, 3, 0, Math.PI / 2);
const geometry = new PlaneGeometry();
for (let index = 0; index < 100; index += 1) {
    createMeshEntity(runtime.world, {
        geometry,
        material: new BasicMaterial({
            lightType: 'NONE',
            cullMode: 'none',
            diffuse: new Color(Math.random(), Math.random(), Math.random())
        }),
        position: [random(-0.75, 0.75), random(-0.75, 0.75), random(-1, 1)],
        scale: [0.18, 0.18, 0.18]
    });
}
const picker = new MeshPicker({
    engine: runtime.engine,
    world: runtime.world,
    camera: runtime.camera
});
const shrinking = new Map<Entity, number>();
runtime.engine.canvas.addEventListener('click', event => {
    void picker.getSelection(event.offsetX, event.offsetY, 6, 6).then(entities => {
        entities.forEach((entity, index) => shrinking.set(entity, performance.now() + index * 120));
    });
});
addEventListener(
    'pagehide',
    () => {
        picker.destroy();
    },
    { once: true }
);
runtime.start(() => {
    const now = performance.now();
    for (const [entity, startedAt] of shrinking) {
        if (!runtime.world.isAlive(entity) || now < startedAt) continue;
        const transform = runtime.world.get(entity, LocalTransform);
        const scale = transform.scale ?? [1, 1, 1];
        const nextScale = Math.max(0, scale[0] - 0.012);
        if (nextScale === 0) {
            runtime.world.destroyEntity(entity);
            shrinking.delete(entity);
        } else {
            runtime.world.set(entity, LocalTransform, {
                ...transform,
                scale: [nextScale, nextScale, nextScale]
            });
        }
    }
});
