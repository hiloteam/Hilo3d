import * as Hilo3d from '../src/Hilo3d';
import { FullscreenPass } from './shared/FullscreenPass';
import { createExampleContext } from './shared/init';
import {
    changedReadbackPixelCount,
    exactReadbackPixelCount,
    hashReadback
} from './shared/readbackDiagnostics';

const CELL_SCALE = 8;
const width = Math.max(1, Math.floor(window.innerWidth / CELL_SCALE));
const height = Math.max(1, Math.floor(window.innerHeight / CELL_SCALE));

Hilo3d.registerUniformBlockBinding('LifeGameBlock');
const lifeLayout = Hilo3d.createStd140Layout({ u_size: 'vec2' });
const lifeBlock = Hilo3d.UniformBuffer.fromSchema(lifeLayout, {
    u_size: [width, height]
});

const initialData = new Float32Array(width * height * 4);
for (let index = 0; index < width * height; index++) {
    const alive = Math.random() < 0.6 ? 1 : 0;
    initialData[index * 4 + 2] = alive;
    initialData[index * 4 + 3] = 1;
}
const initialState = new Hilo3d.DataTexture({
    data: initialData,
    width,
    height,
    minFilter: Hilo3d.constants.NEAREST,
    magFilter: Hilo3d.constants.NEAREST,
    wrapS: Hilo3d.constants.CLAMP_TO_EDGE,
    wrapT: Hilo3d.constants.CLAMP_TO_EDGE
});

const context = await createExampleContext({ autoStart: false });
const { renderer, stage, ticker } = context;
const createLifeTarget = (label: string): Hilo3d.RenderTarget =>
    renderer.createRenderTarget({
        width,
        height,
        colorAttachments: [{ format: 'rgba8unorm' }],
        depthStencilAttachment: false,
        label
    });

let currentTarget = createLifeTarget('Life game current');
let nextTarget = createLifeTarget('Life game next');
for (const target of [currentTarget, nextTarget]) {
    const texture = target.getColorTexture();
    texture.minFilter = Hilo3d.constants.NEAREST;
    texture.magFilter = Hilo3d.constants.NEAREST;
    texture.wrapS = Hilo3d.constants.CLAMP_TO_EDGE;
    texture.wrapT = Hilo3d.constants.CLAMP_TO_EDGE;
}

let copySource: Hilo3d.Texture<unknown> = initialState;
const screenFragment = Hilo3d.Shader.shaders['screen.frag'];
if (!screenFragment) throw new Error('Built-in fullscreen fragment shader is unavailable.');
const copyPass = new FullscreenPass({
    renderer,
    fragmentShader: screenFragment,
    samplers: { u_diffuse: () => copySource },
    label: 'Life game copy'
});

const lifePass = new FullscreenPass({
    renderer,
    label: 'Life game simulation',
    samplers: { u_diffuse: () => currentTarget.getColorTexture() },
    uniformBlocks: { LifeGameBlock: lifeBlock },
    fragmentShader: `#version 300 es
        precision highp float;
        in vec2 v_texcoord0;
        uniform sampler2D u_diffuse;
        layout(std140) uniform LifeGameBlock {
            vec2 u_size;
        };
        layout(location = 0) out vec4 fragmentColor;

        int getCell(int x, int y) {
            vec2 coordinates = (gl_FragCoord.xy + vec2(x, y)) / u_size;
            return int(round(texture(u_diffuse, coordinates).b));
        }

        void main(void) {
            int neighbors = getCell(-1, -1) +
                            getCell(-1,  0) +
                            getCell(-1,  1) +
                            getCell( 0, -1) +
                            getCell( 0,  1) +
                            getCell( 1, -1) +
                            getCell( 1,  0) +
                            getCell( 1,  1);
            float alive = neighbors == 3 || (neighbors == 2 && getCell(0, 0) == 1) ? 1.0 : 0.0;
            fragmentColor = vec4(alive, alive, alive, 1.0);
        }
    `
});

copyPass.render(currentTarget);
copyPass.render(nextTarget);
copySource = currentTarget.getColorTexture();
copyPass.render();
initialState.destroy();

const lifeFrame: Hilo3d.Tickable = {
    tick(deltaTime): void {
        stage.traverseUpdate(deltaTime);
        lifePass.render(nextTarget);
        [currentTarget, nextTarget] = [nextTarget, currentTarget];
        copySource = currentTarget.getColorTexture();
        copyPass.render();
    }
};
ticker.removeTick(stage);
ticker.addTick(lifeFrame);
ticker.targetFPS = 24;
ticker.start();

const injectedLiveCell = new ImageData(new Uint8ClampedArray([255, 0, 255, 255]), 1, 1);
let injectionSequence = 0;
let injectionQueue = Promise.resolve();

function reportAsyncError(error: unknown): void {
    queueMicrotask(() => {
        throw error;
    });
}

async function injectLiveCell(x: number, y: number): Promise<void> {
    ticker.stop();
    try {
        const before = await currentTarget.readColorAttachment();
        const update = {
            mipLevel: 0,
            x,
            y,
            width: 1,
            height: 1,
            image: injectedLiveCell
        } as const;
        currentTarget.getColorTexture().updateSubTexture(update);
        nextTarget.getColorTexture().updateSubTexture(update);
        copySource = currentTarget.getColorTexture();
        copyPass.render();
        const after = await currentTarget.readColorAttachment();
        window.__HILO3D_LIFE_GAME_INTERACTION_RESULT__ = {
            backend: renderer.backend,
            sequence: ++injectionSequence,
            beforeHash: hashReadback(before.data),
            afterHash: hashReadback(after.data),
            changedPixelCount: changedReadbackPixelCount(before.data, after.data),
            injectedPixelCount: exactReadbackPixelCount(after.data, [255, 0, 255, 255])
        };
    } finally {
        ticker.start();
    }
}

document.addEventListener('click', event => {
    const canvas = renderer.domElement;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const x = Math.max(
        0,
        Math.min(width - 1, Math.floor(((event.clientX - bounds.left) / bounds.width) * width))
    );
    const y = Math.max(
        0,
        Math.min(height - 1, Math.floor(((bounds.bottom - event.clientY) / bounds.height) * height))
    );
    injectionQueue = injectionQueue.then(() => injectLiveCell(x, y));
    void injectionQueue.catch(reportAsyncError);
});

window.addEventListener(
    'pagehide',
    () => {
        copyPass.destroy();
        lifePass.destroy();
        currentTarget.destroy();
        nextTarget.destroy();
        context.dispose();
    },
    { once: true }
);

declare global {
    interface Window {
        __HILO3D_LIFE_GAME_INTERACTION_RESULT__?: {
            readonly backend: Hilo3d.RendererBackend;
            readonly sequence: number;
            readonly beforeHash: string;
            readonly afterHash: string;
            readonly changedPixelCount: number;
            readonly injectedPixelCount: number;
        };
    }
}
