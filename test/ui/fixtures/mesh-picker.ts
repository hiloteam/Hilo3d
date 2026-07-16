import {
    BasicMaterial,
    BoxGeometry,
    Color,
    Mesh,
    MeshPicker,
    PerspectiveCamera,
    Stage,
    Vector3,
    type RendererBackend
} from '../../../src/Hilo3d';

const requestedBackend = new URL(location.href).searchParams.get('backend');
if (requestedBackend !== 'webgl2' && requestedBackend !== 'webgpu') {
    throw new TypeError('GPU picking fixture requires backend=webgl2 or backend=webgpu');
}
const backend: RendererBackend = requestedBackend;
const container = document.querySelector<HTMLElement>('#stage');
if (!container) throw new Error('GPU picking fixture container is missing');
const camera = new PerspectiveCamera({ aspect: 1, near: 0.1, far: 10, z: 3 });
camera.lookAt(new Vector3());
const stage = await Stage.create<RendererBackend>({
    backend,
    container,
    camera,
    width: 64,
    height: 64,
    pixelRatio: 1,
    antialias: false,
    clearColor: new Color(0, 0, 0)
});
const mesh = new Mesh({
    geometry: new BoxGeometry(),
    material: new BasicMaterial({ lightType: 'NONE' })
});
mesh.frustumTest = false;
stage.addChild(mesh);
const picker = new MeshPicker({ stage });
const selection = await picker.getSelection(32, 32);
window.__HILO3D_MESH_PICKER_RESULT__ = {
    backend: stage.renderer.backend,
    selectedCount: selection.length,
    selectedExpectedMesh: selection[0] === mesh
};
picker.destroy();
stage.destroy();

declare global {
    interface Window {
        __HILO3D_MESH_PICKER_RESULT__?: {
            backend: RendererBackend;
            selectedCount: number;
            selectedExpectedMesh: boolean;
        };
    }
}
