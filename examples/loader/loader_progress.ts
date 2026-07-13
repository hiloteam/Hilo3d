import * as Hilo3d from '../../src/Hilo3d';
import { createExampleContext } from '../shared/init';

const { stage } = createExampleContext();
const progressElement = document.querySelector<HTMLElement>('#progress');
if (!progressElement) throw new Error('Loader progress example requires #progress.');

interface ResourceProgress {
    url: string;
    loaded: number;
    total: number;
}

function isResourceProgress(value: unknown): value is ResourceProgress {
    return (
        typeof value === 'object' &&
        value !== null &&
        'url' in value &&
        typeof value.url === 'string' &&
        'loaded' in value &&
        typeof value.loaded === 'number' &&
        'total' in value &&
        typeof value.total === 'number'
    );
}

const loader = new Hilo3d.GLTFLoader();
loader.on('progress', event => {
    if (!isResourceProgress(event.detail)) {
        throw new TypeError('Loader progress event has an invalid payload.');
    }
    const { loaded, total } = event.detail;
    progressElement.textContent =
        total > 0
            ? `resource loaded: ${String(Math.round((loaded / total) * 100))}%`
            : `resource loaded: ${String(loaded)} bytes`;
});
loader
    .load({ src: '../models/Tmall/Tmall.gltf' })
    .then(async model => {
        await model.ready;
        model.node.setScale(0.002);
        stage.addChild(model.node);
    })
    .catch((error: unknown) => {
        queueMicrotask(() => {
            throw error;
        });
    });

const picker = new Hilo3d.MeshPicker({ renderer: stage.renderer });
const selectedMeshes = new Set<Hilo3d.Mesh>();
stage.canvas.addEventListener('click', event => {
    const mesh = picker.getSelection(event.clientX, event.clientY)[0];
    const material = mesh?.material;
    if (!mesh || !material || typeof material.transparency !== 'number') return;
    if (selectedMeshes.delete(mesh)) {
        material.transparency = 1;
    } else {
        selectedMeshes.add(mesh);
        material.transparent = true;
        material.transparency = 0.5;
    }
    material.isDirty = true;
});
