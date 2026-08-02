import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { stage } = await createExampleContext();

const loader = new Hilo3d.GLTFLoader();
loader
    .load({
        src: './models/Tmall/Tmall.gltf'
    })
    .then(model => {
        model.node.setScale(0.002);
        stage.addChild(model.node);
    })
    .catch((error: unknown) => {
        queueMicrotask(() => {
            throw error;
        });
    });

const meshPickerHelper = new Hilo3d.MeshPicker({
    stage
});

interface SelectedMeshState {
    mesh: Hilo3d.Mesh;
    scale: readonly [number, number, number];
}

let selection: SelectedMeshState | null = null;

function clearSelection(): void {
    if (!selection) return;
    selection.mesh.setScale(selection.scale[0], selection.scale[1], selection.scale[2]);
    selection = null;
}

stage.canvas.addEventListener('click', event => {
    void meshPickerHelper
        .getSelection(event.offsetX, event.offsetY)
        .then(meshes => {
            const mesh = meshes[0];
            if (!mesh || mesh === selection?.mesh) {
                clearSelection();
                return;
            }

            clearSelection();
            selection = {
                mesh,
                scale: [mesh.scaleX, mesh.scaleY, mesh.scaleZ]
            };
            mesh.setScale(mesh.scaleX * 1.08, mesh.scaleY * 1.08, mesh.scaleZ * 1.08);
        })
        .catch((error: unknown) => {
            queueMicrotask(() => {
                throw error;
            });
        });
});
