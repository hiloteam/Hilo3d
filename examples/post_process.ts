import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './js/init';
import postProcess from './js/postProcess';

const { camera, stage, renderer, directionLight } = createExampleContext({
    stage: { useFramebuffer: true }
});

camera.far = 5;
stage.rotationX = 25;
directionLight.shadow = {};
const glTFLoader = new Hilo3d.GLTFLoader();
glTFLoader
    .load({
        src: './models/Tmall/Tmall.gltf'
    })
    .then(model => {
        model.node.y = 0.2;
        model.node.setScale(0.0015);
        model.materials.forEach(material => {
            material.side = Hilo3d.constants.FRONT_AND_BACK;
        });
        model.node.onUpdate = function () {
            this.rotationY += 1;
        };
        stage.addChild(model.node);
    })
    .catch((error: unknown) => {
        queueMicrotask(() => {
            throw error;
        });
    });

const plane = new Hilo3d.Mesh({
    y: -0.4,
    rotationX: -90,
    geometry: new Hilo3d.PlaneGeometry(),
    material: new Hilo3d.BasicMaterial({
        lightType: 'LAMBERT',
        side: Hilo3d.constants.FRONT_AND_BACK,
        diffuse: new Hilo3d.Color(0.612, 0.612, 0.612)
    })
});
plane.setScale(1.8);
stage.addChild(plane);

postProcess.init(renderer);
postProcess.addPass({
    frag: '#version 300 es\n\
        precision highp float;\n\
        in vec2 v_texcoord0;\n\
        uniform sampler2D u_diffuse;\n\
        layout(location = 0) out vec4 fragmentColor;\n\
        void main(void) {\n\
            vec4 color = texture(u_diffuse, v_texcoord0);\n\
            float luminance = color.r * 0.3 + color.g * 0.59 + color.b * 0.11;\n\
            fragmentColor = vec4(vec3(luminance), color.a);\n\
        }'
});

const currentKernel = 'edgeDetect6';
const initialKernel = postProcess.kernels[currentKernel];
if (!initialKernel) throw new Error(`Unknown post-process kernel: ${currentKernel}`);
const kernelPass = postProcess.addKernelPass(initialKernel);

renderer.on('afterRender', () => {
    postProcess.render();
});

const kernelSelect = document.querySelector<HTMLSelectElement>('#kernelSelect');
if (!kernelSelect) throw new Error('Kernel selector is missing.');
for (const name in postProcess.kernels) {
    const option = document.createElement('option');
    option.textContent = name;
    option.value = name;
    kernelSelect.append(option);
}

kernelSelect.value = currentKernel;
kernelSelect.addEventListener('change', () => {
    const kernel = postProcess.kernels[kernelSelect.value];
    if (!kernel) throw new Error(`Unknown post-process kernel: ${kernelSelect.value}`);
    kernelPass.kernel = kernel;
});
