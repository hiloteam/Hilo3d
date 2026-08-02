import * as Hilo3d from '../../src/Hilo3d';
import { createExampleContext } from '../shared/init';

const { stage } = await createExampleContext();
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

const picker = new Hilo3d.MeshPicker({ stage });
const selectedMeshes = new Map<Hilo3d.Mesh, readonly [number, number, number]>();
stage.canvas.addEventListener('click', event => {
    void picker
        .getSelection(event.offsetX, event.offsetY)
        .then(meshes => {
            const mesh = meshes[0];
            if (!mesh) return;
            const previousScale = selectedMeshes.get(mesh);
            if (previousScale) {
                mesh.setScale(previousScale[0], previousScale[1], previousScale[2]);
                selectedMeshes.delete(mesh);
            } else {
                selectedMeshes.set(mesh, [mesh.scaleX, mesh.scaleY, mesh.scaleZ]);
                mesh.setScale(mesh.scaleX * 1.08, mesh.scaleY * 1.08, mesh.scaleZ * 1.08);
            }
        })
        .catch((error: unknown) => {
            queueMicrotask(() => {
                throw error;
            });
        });
});
