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
    material: Hilo3d.Material;
    transparent: boolean;
    transparency: Hilo3d.Material['transparency'];
}

let selection: SelectedMeshState | null = null;

function clearSelection(): void {
    if (!selection) return;
    selection.material.transparent = selection.transparent;
    selection.material.transparency = selection.transparency;
    selection.material.isDirty = true;
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
            const material = mesh.material;
            if (!material) return;
            selection = {
                mesh,
                material,
                transparent: material.transparent,
                transparency: material.transparency
            };
            material.transparent = true;
            material.transparency = 0.45;
            material.isDirty = true;
        })
        .catch((error: unknown) => {
            queueMicrotask(() => {
                throw error;
            });
        });
});
