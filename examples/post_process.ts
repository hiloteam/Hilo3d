import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';
import postProcess from './shared/postProcess';
import { changedReadbackPixelCount, hashReadback } from './shared/readbackDiagnostics';

const context = await createExampleContext({
    autoStart: false
});
const { camera, stage, renderer, directionLight, ticker } = context;

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
        cullMode: 'none',
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
postProcess.prepare();

const sceneTarget = renderer.createRenderTarget({
    width: Math.max(1, renderer.width),
    height: Math.max(1, renderer.height),
    colorAttachments: [{ format: 'rgba8unorm' }],
    label: 'Post-process scene'
});
const diagnosticTarget = renderer.createRenderTarget({
    width: 256,
    height: 144,
    colorAttachments: [{ format: 'rgba8unorm' }],
    depthStencilAttachment: false,
    label: 'Post-process interaction diagnostics'
});

const postProcessFrame: Hilo3d.Tickable = {
    tick(deltaTime): void {
        stage.traverseUpdate(deltaTime);
        renderer.renderFrame(() => {
            renderer.renderToTarget(sceneTarget, stage, camera, true);
            postProcess.render(sceneTarget.getColorTexture());
        });
    }
};
ticker.removeTick(stage);
ticker.addTick(postProcessFrame);

window.addEventListener('resize', () => {
    sceneTarget.resize(Math.max(1, renderer.width), Math.max(1, renderer.height));
    postProcess.resize();
});

const kernelSelectElement = document.querySelector<HTMLSelectElement>('#kernelSelect');
if (!kernelSelectElement) throw new Error('Kernel selector is missing.');
const kernelSelect: HTMLSelectElement = kernelSelectElement;
for (const name in postProcess.kernels) {
    const option = document.createElement('option');
    option.textContent = name;
    option.value = name;
    kernelSelect.append(option);
}

kernelSelect.value = currentKernel;
let activeKernelName = currentKernel;
let comparisonSequence = 0;

function reportAsyncError(error: unknown): void {
    queueMicrotask(() => {
        throw error;
    });
}

async function compareKernelOutput(nextKernelName: string): Promise<void> {
    const previousKernelName = activeKernelName;
    const previousKernel = postProcess.kernels[previousKernelName];
    const nextKernel = postProcess.kernels[nextKernelName];
    if (!previousKernel) throw new Error(`Unknown post-process kernel: ${previousKernelName}`);
    if (!nextKernel) throw new Error(`Unknown post-process kernel: ${nextKernelName}`);

    ticker.stop();
    try {
        renderer.renderToTarget(sceneTarget, stage, camera, true);
        const source = sceneTarget.getColorTexture();
        kernelPass.kernel = previousKernel;
        postProcess.render(source, diagnosticTarget);
        const before = await diagnosticTarget.readColorAttachment();
        kernelPass.kernel = nextKernel;
        postProcess.render(source, diagnosticTarget);
        const after = await diagnosticTarget.readColorAttachment();
        activeKernelName = nextKernelName;
        window.__HILO3D_POST_PROCESS_INTERACTION_RESULT__ = {
            backend: renderer.backend,
            sequence: ++comparisonSequence,
            previousKernel: previousKernelName,
            currentKernel: nextKernelName,
            beforeHash: hashReadback(before.data),
            afterHash: hashReadback(after.data),
            changedPixelCount: changedReadbackPixelCount(before.data, after.data)
        };
    } catch (error: unknown) {
        kernelPass.kernel = previousKernel;
        kernelSelect.value = previousKernelName;
        throw error;
    } finally {
        ticker.start();
    }
}

kernelSelect.addEventListener('change', () => {
    const nextKernelName = kernelSelect.value;
    void compareKernelOutput(nextKernelName).catch(reportAsyncError);
});

ticker.start();

window.addEventListener(
    'pagehide',
    () => {
        diagnosticTarget.destroy();
        sceneTarget.destroy();
        postProcess.destroy();
        context.dispose();
    },
    { once: true }
);

declare global {
    interface Window {
        __HILO3D_POST_PROCESS_INTERACTION_RESULT__?: {
            readonly backend: Hilo3d.RendererBackend;
            readonly sequence: number;
            readonly previousKernel: string;
            readonly currentKernel: string;
            readonly beforeHash: string;
            readonly afterHash: string;
            readonly changedPixelCount: number;
        };
    }
}
