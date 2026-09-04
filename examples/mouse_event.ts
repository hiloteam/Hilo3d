import {
    BasicMaterial,
    Color,
    MeshPicker,
    PlaneGeometry,
    type Entity,
    type MaterialInstance
} from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity } from './shared/scene';

function random(min: number, max: number): number {
    return Math.random() * (max - min) + min;
}

const runtime = await createExampleRuntime();
runtime.controls.setView({ x: 0, y: 0, z: 0 }, 3, 0, Math.PI / 2);
const materials = new Map<Entity, MaterialInstance>();
const geometry = new PlaneGeometry();
for (let index = 0; index < 100; index += 1) {
    const material = new BasicMaterial({
        lightType: 'NONE',
        diffuse: new Color(Math.random(), Math.random(), Math.random()),
        cullMode: 'none',
        compositing: { mode: 'alpha-blend', premultiplied: true }
    });
    const entity = createMeshEntity(runtime.world, {
        geometry,
        material,
        position: [random(-0.75, 0.75), random(-0.75, 0.75), random(-1, 1)],
        scale: [0.18, 0.18, 0.18]
    });
    materials.set(entity, material);
}
const picker = new MeshPicker({
    engine: runtime.engine,
    world: runtime.world,
    camera: runtime.camera
});
let hovered: Entity | null = null;
let request = 0;
runtime.engine.canvas.addEventListener('pointermove', event => {
    const revision = ++request;
    void picker.getSelection(event.offsetX, event.offsetY).then(entities => {
        if (revision !== request) return;
        const next = entities[0] ?? null;
        if (next === hovered) return;
        if (hovered !== null) {
            const material = materials.get(hovered);
            if (material) material.opacity = 1;
        }
        hovered = next;
        if (hovered !== null) {
            const material = materials.get(hovered);
            if (material) material.opacity = 0.5;
        }
        runtime.engine.canvas.style.cursor = hovered === null ? '' : 'pointer';
    });
});
runtime.engine.canvas.addEventListener('pointerleave', () => {
    request += 1;
    if (hovered !== null) {
        const material = materials.get(hovered);
        if (material) material.opacity = 1;
    }
    hovered = null;
    runtime.engine.canvas.style.cursor = '';
});
addEventListener(
    'pagehide',
    () => {
        picker.destroy();
    },
    { once: true }
);
runtime.start();
