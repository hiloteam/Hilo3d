import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const context = await createExampleContext();
const { stage, lifecycle } = context;

const loader = new Hilo3d.GLTFLoader();
loader
    .load({
        src: './models/Tmall/Tmall.gltf'
    })
    .then(model => {
        context.onDispose(() => {
            model.anim?.destroy();
            model.node.destroy(stage.renderer);
            for (const texture of model.textures) texture.destroy();
        });
        if (lifecycle.disposed) return;
        model.node.setScale(0.002);
        stage.addChild(model.node);
    })
    .catch((error: unknown) => {
        if (lifecycle.disposed) return;
        queueMicrotask(() => {
            throw error;
        });
    });

const meshPickerHelper = new Hilo3d.MeshPicker({
    stage
});
context.onDispose(() => {
    meshPickerHelper.destroy();
});

interface SelectedMeshState {
    mesh: Hilo3d.Mesh;
    scale: readonly [number, number, number];
}

let selection: SelectedMeshState | null = null;
let selectionRevision = 0;

function clearSelection(): void {
    if (!selection) return;
    selection.mesh.setScale(selection.scale[0], selection.scale[1], selection.scale[2]);
    selection = null;
}

stage.canvas.addEventListener('click', event => {
    if (!lifecycle.active) return;
    const revision = ++selectionRevision;
    void meshPickerHelper
        .getSelection(event.offsetX, event.offsetY)
        .then(meshes => {
            if (!lifecycle.active || revision !== selectionRevision) return;
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
            if (lifecycle.disposed) return;
            queueMicrotask(() => {
                throw error;
            });
        });
});
