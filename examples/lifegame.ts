import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './js/init';
import postProcess from './js/postProcess';

const CELL_SCALE = 8;
const width = Math.max(1, Math.floor(window.innerWidth / CELL_SCALE));
const height = Math.max(1, Math.floor(window.innerHeight / CELL_SCALE));
Hilo3d.registerUniformBlockBinding('LifeGameBlock');
const materialLayout = Hilo3d.createStd140Layout({ u_size: 'vec2' });
const materialBlock = Hilo3d.UniformBuffer.fromSchema(materialLayout, {
    u_size: [width, height]
});
const liveCell = new Uint8Array([255, 255, 255, 255]);

let framebuffer: Hilo3d.Framebuffer | null = null;
let currentTexture: Hilo3d.FramebufferTexture | null = null;
let nextTexture: Hilo3d.FramebufferTexture | null = null;

function requireTexture(
    texture: Hilo3d.FramebufferTexture | null,
    description: string
): Hilo3d.FramebufferTexture {
    if (!texture) throw new Error(`${description} is not initialized.`);
    return texture;
}

const { renderer, ticker } = createExampleContext();
postProcess.init(renderer);

renderer.onInit(() => {
    framebuffer?.destroy();
    const data = new Uint8Array(width * height * 4);
    for (let index = 0; index < width * height; index++) {
        data[index * 4 + 2] = Math.random() < 0.6 ? 255 : 0;
    }

    const nextFramebuffer = new Hilo3d.Framebuffer(renderer, {
        needRenderbuffer: false,
        width,
        height,
        data
    });
    nextFramebuffer.bind();
    try {
        currentTexture = requireTexture(nextFramebuffer.texture, 'Life-game current texture');
        nextTexture = nextFramebuffer.createTexture();
    } finally {
        nextFramebuffer.unbind();
    }
    framebuffer = nextFramebuffer;
});

renderer.on('afterRender', () => {
    const target = framebuffer;
    const sourceTexture = currentTexture;
    const targetTexture = nextTexture;
    if (!target || !sourceTexture || !targetTexture) return;

    const { gl, state } = renderer;
    target.bind();
    try {
        target.texture = targetTexture;
        gl.framebufferTexture2D(
            gl.FRAMEBUFFER,
            target.attachment,
            target.target,
            targetTexture.getGLTexture(state),
            0
        );
        postProcess.draw(sourceTexture, {
            uniformBlocks: { LifeGameBlock: materialBlock },
            frag: `#version 300 es
                precision highp float;
                in vec2 v_texcoord0;
                uniform sampler2D u_diffuse;
                layout(std140) uniform LifeGameBlock {
                    vec2 u_size;
                };
                layout(location = 0) out vec4 fragmentColor;

                int get(int x, int y) {
                    return int(texture(u_diffuse, (gl_FragCoord.xy + vec2(x, y)) / u_size).b);
                }

                void main(void) {
                    int sum = get(-1, -1) +
                              get(-1,  0) +
                              get(-1,  1) +
                              get( 0, -1) +
                              get( 0,  1) +
                              get( 1, -1) +
                              get( 1,  0) +
                              get( 1,  1);

                    if (sum == 3) {
                        fragmentColor = vec4(1.0);
                    } else if (sum == 2) {
                        float current = float(get(0, 0));
                        fragmentColor = vec4(current, current, current, 1.0);
                    } else {
                        fragmentColor = vec4(0.0);
                    }
                }
            `
        });
    } finally {
        target.unbind();
    }

    currentTexture = targetTexture;
    nextTexture = sourceTexture;
    target.render(0, 0, 1, 1, null, currentTexture);
});

document.addEventListener('click', event => {
    const firstTexture = currentTexture;
    const secondTexture = nextTexture;
    if (!firstTexture || !secondTexture || !renderer.isInit) return;

    const x = Math.max(0, Math.min(width - 1, Math.floor(event.offsetX / CELL_SCALE)));
    const y = Math.max(0, Math.min(height - 1, Math.floor(height - event.offsetY / CELL_SCALE)));
    const { gl, state } = renderer;
    for (const texture of [firstTexture, secondTexture]) {
        gl.bindTexture(gl.TEXTURE_2D, texture.getGLTexture(state));
        gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, liveCell);
    }
});

ticker.targetFPS = 24;
