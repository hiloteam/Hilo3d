import { GLTFLoader, LocalTransform, MeshPicker, type Entity } from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';

const runtime = await createExampleRuntime();
runtime.controls.setView({ x: 0, y: 0, z: 0 }, 4, 0.65, 1.1);
const model = await new GLTFLoader().load({ src: './models/Tmall/Tmall.gltf' });
const instance = model.instantiate(runtime.world);
for (const root of instance.roots) {
    runtime.world.set(root, LocalTransform, {
        ...runtime.world.get(root, LocalTransform),
        scale: [0.0018, 0.0018, 0.0018]
    });
}
const picker = new MeshPicker({
    engine: runtime.engine,
    world: runtime.world,
    camera: runtime.camera
});
let selection: {
    readonly entity: Entity;
    readonly scale: readonly [number, number, number];
} | null = null;

function clearSelection(): void {
    if (!selection || !runtime.world.isAlive(selection.entity)) return;
    const transform = runtime.world.get(selection.entity, LocalTransform);
    runtime.world.set(selection.entity, LocalTransform, { ...transform, scale: selection.scale });
    selection = null;
}

runtime.engine.canvas.addEventListener('click', event => {
    void picker.getSelection(event.offsetX, event.offsetY).then(entities => {
        const entity = entities[0];
        if (entity === undefined || entity === selection?.entity) {
            clearSelection();
            return;
        }
        clearSelection();
        const transform = runtime.world.get(entity, LocalTransform);
        const scale = transform.scale ?? [1, 1, 1];
        selection = { entity, scale };
        runtime.world.set(entity, LocalTransform, {
            ...transform,
            scale: [scale[0] * 1.08, scale[1] * 1.08, scale[2] * 1.08]
        });
    });
});
addEventListener(
    'pagehide',
    () => {
        picker.destroy();
    },
    { once: true }
);
runtime.start();
