import { describe, expect, it } from 'vitest';
import * as H from '../../src/Hilo3d';
import { NagaShaderTranslator } from '../../src/render/shader/GlslToWgsl';
import {
    createMagicPlumeMaterial,
    PIANO_MAGIC_PLUME_FRAGMENT_SOURCE,
    PIANO_MAGIC_PLUME_LAYOUT,
    PIANO_MAGIC_PLUME_VERTEX_SOURCE
} from './pianoMagicShader';

const WIDTH = 80;
const HEIGHT = 96;

interface PlumeFrames {
    readonly active: Uint8Array;
    readonly animated: Uint8Array;
    readonly growing: Uint8Array;
}

function channelMean(pixels: Uint8Array, channel: number, rows = HEIGHT): number {
    let total = 0;
    for (let pixel = 0; pixel < WIDTH * rows; pixel++) {
        total += pixels[pixel * 4 + channel] ?? 0;
    }
    return total / (WIDTH * rows);
}

function difference(first: Uint8Array, second: Uint8Array): number {
    let total = 0;
    for (let offset = 0; offset < first.length; offset++) {
        if (offset % 4 === 3) continue;
        total += Math.abs((first[offset] ?? 0) - (second[offset] ?? 0));
    }
    return total / ((first.length / 4) * 3);
}

async function renderPlume(backend: 'webgl2' | 'webgpu'): Promise<PlumeFrames> {
    const camera = new H.OrthographicCamera({
        left: -0.65,
        right: 0.65,
        bottom: -0.1,
        top: 2.5,
        near: 0.1,
        far: 10,
        z: 3
    });
    const stage = await H.Stage.create({
        backend,
        width: WIDTH,
        height: HEIGHT,
        pixelRatio: 1,
        antialias: false,
        camera,
        clearColor: new H.Color(0, 0, 0, 1)
    });
    const plume = createMagicPlumeMaterial();
    const colors = new Float32Array(16);
    const colorData = new H.GeometryData(colors, 4);
    const geometry = new H.PlaneGeometry({ width: 1, height: 2.4 });
    geometry.colors = colorData;
    new H.Mesh({
        name: 'Procedural plume pixel fixture',
        y: 1.2,
        geometry,
        material: plume.material,
        castShadows: false,
        receiveShadows: false
    }).addTo(stage);
    const target = stage.renderer.createRenderTarget({
        width: WIDTH,
        height: HEIGHT,
        colorAttachments: [{ format: 'rgba8unorm' }],
        depthStencilAttachment: { format: 'depth24plus-stencil8' }
    });
    const read = async (seconds: number, intensity = 1, head = 1): Promise<Uint8Array> => {
        for (let vertex = 0; vertex < 4; vertex++) {
            colors.set([0.37, intensity, head, 0.8], vertex * 4);
        }
        colorData.isDirty = true;
        plume.update(seconds);
        stage.renderer.renderToTarget(target, stage, camera);
        await stage.renderer.waitForIdle();
        const result = await target.readColorAttachment();
        const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
        for (let row = 0; row < HEIGHT; row++) {
            pixels.set(
                result.data.subarray(
                    row * result.bytesPerRow,
                    row * result.bytesPerRow + WIDTH * 4
                ),
                row * WIDTH * 4
            );
        }
        return pixels;
    };
    try {
        const silent = await read(0, 0);
        expect(channelMean(silent, 2), `${backend} silence leaves the void black`).toBe(0);

        const active = await read(0);
        const blue = channelMean(active, 2);
        expect(blue, `${backend} actual key plume pixels`).toBeGreaterThan(5);
        expect(blue, `${backend} electric blue palette`).toBeGreaterThan(
            channelMean(active, 0) * 3
        );
        for (let row = 0; row < HEIGHT; row++) {
            for (const column of [10, WIDTH - 11]) {
                expect(
                    active[(row * WIDTH + column) * 4 + 2],
                    `${backend} no visible vertical quad border`
                ).toBe(0);
            }
        }

        const animated = await read(2.4);
        expect(
            difference(active, animated),
            `${backend} flowing filament animation`
        ).toBeGreaterThan(1);
        const growing = await read(0, 1, 0.46);
        expect(
            channelMean(growing, 2, HEIGHT / 2),
            `${backend} growing head cuts off the upper half in top-left readback rows`
        ).toBe(0);
        expect(
            channelMean(growing, 2),
            `${backend} growth remains anchored above the key`
        ).toBeGreaterThan(1);
        const faded = await read(0, 0.15);
        expect(
            channelMean(faded, 2),
            `${backend} release envelope dims the same field`
        ).toBeLessThan(blue * 0.25);
        expect(
            difference(active, await read(0)),
            `${backend} deterministic shader restart after release`
        ).toBe(0);
        expect(
            channelMean(await read(7, 0), 2),
            `${backend} complete release returns to black while time advances`
        ).toBe(0);
        return { active, animated, growing };
    } finally {
        target.destroy();
        stage.destroy();
    }
}

describe('procedural piano magic plume', () => {
    it('translates the shared vertex path and one std140 animation block through Naga', async () => {
        const shader = H.Shader.getCustomShader(
            PIANO_MAGIC_PLUME_VERTEX_SOURCE,
            PIANO_MAGIC_PLUME_FRAGMENT_SOURCE,
            '#define HILO_HAS_COLOR 1\n#define HILO_COLOR_SIZE 4\n#define HILO_HAS_TEXCOORD0 1\n'
        );
        const translator = new NagaShaderTranslator();
        await translator.initialize();
        const translated = translator.translate(shader.vs, shader.fs);
        expect(translated.vertexInputs.map(input => input.name).sort()).toEqual([
            'a_color',
            'a_position',
            'a_texcoord0'
        ]);
        expect(translated.uniformBlocks.map(block => block.name)).toEqual(
            expect.arrayContaining(['CameraBlock', 'ModelBlock', 'PianoMagicPlumeBlock'])
        );
        expect(translated.fragmentOutputs.map(output => output.location)).toEqual([0]);
        expect(translated.samplers).toEqual([]);
        expect(PIANO_MAGIC_PLUME_LAYOUT.byteLength).toBe(16);
        expect(PIANO_MAGIC_PLUME_LAYOUT.fields.u_flow.offset).toBe(0);
    });

    it('draws flowing blue light with matching rows, growth and release on both real backends', async () => {
        const webgl = await renderPlume('webgl2');
        const webgpu = await renderPlume('webgpu');
        for (const state of ['active', 'animated', 'growing'] as const) {
            expect(
                difference(webgl[state], webgpu[state]),
                `${state} shader backend parity`
            ).toBeLessThan(3);
        }
    });
});
