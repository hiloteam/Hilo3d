import { GLTFLoader, LocalTransform, MeshPicker, type Entity } from 'hilo3d';
import { createExampleRuntime } from '../shared/runtime';

interface ResourceProgress {
    readonly loaded: number;
    readonly total: number;
}

function isResourceProgress(value: unknown): value is ResourceProgress {
    return (
        typeof value === 'object' &&
        value !== null &&
        'loaded' in value &&
        typeof value.loaded === 'number' &&
        'total' in value &&
        typeof value.total === 'number'
    );
}

const progressElement = document.querySelector<HTMLElement>('#progress');
if (!progressElement) throw new Error('Loader progress example requires #progress.');
const runtime = await createExampleRuntime();
runtime.controls.setView({ x: 0, y: 0, z: 0 }, 4, 0.65, 1.1);
const loader = new GLTFLoader();
loader.on('progress', event => {
    if (!isResourceProgress(event.detail)) return;
    const { loaded, total } = event.detail;
    progressElement.textContent =
        total > 0
            ? `resource loaded: ${String(Math.round((loaded / total) * 100))}%`
            : `resource loaded: ${String(loaded)} bytes`;
});
const model = await loader.load({ src: '../models/Tmall/Tmall.gltf' });
await model.ready;
progressElement.textContent = 'resource loaded: 100%';
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
const selected = new Map<Entity, readonly [number, number, number]>();
runtime.engine.canvas.addEventListener('click', event => {
    void picker.getSelection(event.offsetX, event.offsetY).then(entities => {
        const entity = entities[0];
        if (entity === undefined) return;
        const transform = runtime.world.get(entity, LocalTransform);
        const previous = selected.get(entity);
        if (previous) {
            runtime.world.set(entity, LocalTransform, { ...transform, scale: previous });
            selected.delete(entity);
            return;
        }
        const scale = transform.scale ?? [1, 1, 1];
        selected.set(entity, scale);
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
