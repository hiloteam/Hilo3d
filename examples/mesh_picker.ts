import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';
import postProcess from './shared/postProcess';

const { stage, renderer } = createExampleContext();

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
    renderer: stage.renderer
});

let selectedMesh: Hilo3d.Mesh | null = null;
stage.canvas.addEventListener('click', event => {
    selectedMesh = meshPickerHelper.getSelection(event.clientX, event.clientY)[0] ?? selectedMesh;
});

const transparentMaterial = new Hilo3d.Material();
transparentMaterial.transparent = true;

postProcess.init(renderer);
const edgeKernel = postProcess.kernels['edgeDetect6'];
if (!edgeKernel) throw new Error('The edge detection kernel is unavailable.');
const edgePass = postProcess.addKernelPass(edgeKernel, 'edgeDetect6');
const selectionMaterial = new Hilo3d.BasicMaterial({
    diffuse: new Hilo3d.Color(1, 1, 1),
    lightType: 'NONE'
});

renderer.on('afterRender', () => {
    if (selectedMesh) {
        // Render the selected mesh into a mask.
        postProcess.frontBuffer.bind();
        renderer.clear(new Hilo3d.Color(0, 0, 0, 0));
        const previousMaterial = renderer.forceMaterial;
        renderer.forceMaterial = selectionMaterial;
        try {
            renderer.renderMesh(selectedMesh);
        } finally {
            renderer.forceMaterial = previousMaterial;
        }

        // Detect edges from the mask.
        postProcess.backBuffer.bind();
        renderer.setupBlend(transparentMaterial);
        postProcess.draw(postProcess.frontBuffer.texture, edgePass);

        // Composite the outline over the scene.
        renderer.state.bindSystemFramebuffer();
        renderer.setupBlend(transparentMaterial);
        postProcess.backBuffer.render(0, 0, 1, 1);
    }
});
