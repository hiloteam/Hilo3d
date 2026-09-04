import {
    BasicMaterial,
    BoxGeometry,
    LazyTexture,
    LocalTransform,
    MeshPicker,
    PlaneGeometry,
    SphereGeometry,
    type Entity,
    type Geometry,
    type MaterialInstance
} from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity, quaternionFromDegrees } from './shared/scene';

const hitElement = document.querySelector<HTMLElement>('#hit');
if (!hitElement) throw new Error('Raycast example requires #hit.');
const runtime = await createExampleRuntime();
runtime.controls.setView({ x: 0, y: 0, z: 0 }, 3.5, 0.1, Math.PI / 2);
const texture = new LazyTexture({
    src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href
});
const material = new BasicMaterial({ diffuse: texture });
const doubleSided = new BasicMaterial({ diffuse: texture, cullMode: 'none' });
const backSided = new BasicMaterial({ diffuse: texture, cullMode: 'front' });
const rotating: {
    entity: Entity;
    position: readonly [number, number, number];
    scale: number;
    speed: number;
}[] = [];

function addMesh(
    geometry: Geometry,
    meshMaterial: MaterialInstance,
    position: readonly [number, number, number],
    scale: number,
    speed: number
): void {
    const entity = createMeshEntity(runtime.world, {
        geometry,
        material: meshMaterial,
        position,
        scale: [scale, scale, scale]
    });
    rotating.push({ entity, position, scale, speed });
}

addMesh(new BoxGeometry(), material, [-0.8, 0, 0], 0.4, 42);
addMesh(new SphereGeometry(), material, [0, 0, 0], 0.3, 30);
addMesh(new PlaneGeometry(), doubleSided, [0.8, -0.5, 0], 0.4, 24);
addMesh(new PlaneGeometry(), material, [0.8, 0, 0], 0.4, 34);
addMesh(new PlaneGeometry(), backSided, [0.8, 0.5, 0], 0.4, 44);

const picker = new MeshPicker({
    engine: runtime.engine,
    world: runtime.world,
    camera: runtime.camera
});
runtime.engine.canvas.addEventListener('pointermove', event => {
    hitElement.style.transform = `translate3d(${String(event.clientX)}px, ${String(event.clientY)}px, 0)`;
    void picker.getSelection(event.offsetX, event.offsetY).then(entities => {
        hitElement.style.opacity = entities.length > 0 ? '1' : '0.1';
    });
});
addEventListener(
    'pagehide',
    () => {
        picker.destroy();
    },
    { once: true }
);
runtime.start(time => {
    for (const item of rotating) {
        runtime.world.set(item.entity, LocalTransform, {
            position: item.position,
            rotation: quaternionFromDegrees(time * item.speed, time * item.speed, time * 12),
            scale: [item.scale, item.scale, item.scale]
        });
    }
});
