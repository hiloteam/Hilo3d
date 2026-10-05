import { describe, expect, it } from 'vitest';
import * as H from '../../src/Hilo3d';
import { NagaShaderTranslator } from '../../src/render/shader/GlslToWgsl';
import {
    createPianoNebula,
    PIANO_NEBULA_FRAGMENT_SOURCE,
    PIANO_NEBULA_LAYOUT,
    PIANO_NEBULA_VERTEX_SOURCE
} from './pianoNebula';

const WIDTH = 64;
const HEIGHT = 40;

interface NebulaFrames {
    readonly idle: Uint8Array;
    readonly initial: Uint8Array;
    readonly animated: Uint8Array;
}

function meanBrightness(pixels: Uint8Array): number {
    let total = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
        total +=
            (pixels[offset] ?? 0) * 0.2126 +
            (pixels[offset + 1] ?? 0) * 0.7152 +
            (pixels[offset + 2] ?? 0) * 0.0722;
    }
    return total / (pixels.length / 4);
}

function difference(first: Uint8Array, second: Uint8Array): number {
    let total = 0;
    for (let offset = 0; offset < first.length; offset++) {
        if (offset % 4 === 3) continue;
        total += Math.abs((first[offset] ?? 0) - (second[offset] ?? 0));
    }
    return total / ((first.length / 4) * 3);
}

async function renderNebula(backend: 'webgl2' | 'webgpu'): Promise<NebulaFrames> {
    const camera = new H.PerspectiveCamera({ aspect: WIDTH / HEIGHT });
    camera.setPosition(9, 8, 15).lookAt(new H.Vector3(1.1, 2, -0.7));
    const stage = await H.Stage.create({
        backend,
        width: WIDTH,
        height: HEIGHT,
        pixelRatio: 1,
        antialias: false,
        camera,
        clearColor: new H.Color(0, 0, 0, 1),
        // Assess visible clouds through the showcase's display transform. Reading linear
        // radiance directly into rgba8 would quantize away deliberately dark cloud detail.
        renderPipeline: new H.PostProcessRenderPipelineFactory({
            bloom: false,
            colorUber: {
                exposure: -0.25,
                toneMapping: 'aces',
                vignetteIntensity: 0.28,
                vignetteSmoothness: 0.7
            },
            opaqueTexture: false
        })
    });
    const nebula = createPianoNebula(stage, camera);
    const target = stage.renderer.createRenderTarget({
        width: WIDTH,
        height: HEIGHT,
        colorAttachments: [{ format: 'rgba8unorm' }],
        depthStencilAttachment: false
    });
    const read = async (seconds: number, energy = 0): Promise<Uint8Array> => {
        nebula.update(seconds, energy);
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
        const idle = await read(0, 0);
        const initial = await read(0, 1);
        const animated = await read(30, 1);
        let darkest = 255;
        let brightest = 0;
        for (let offset = 0; offset < initial.length; offset += 4) {
            const brightness =
                ((initial[offset] ?? 0) + (initial[offset + 1] ?? 0) + (initial[offset + 2] ?? 0)) /
                3;
            darkest = Math.min(darkest, brightness);
            brightest = Math.max(brightest, brightness);
            expect(initial[offset + 3], `${backend} opaque background`).toBe(255);
        }
        expect(brightest, `${backend} rendered nebula pixels`).toBeGreaterThan(8);
        expect(brightest - darkest, `${backend} spatial cloud structure`).toBeGreaterThan(5);
        expect(difference(initial, animated), `${backend} animated cloud pixels`).toBeGreaterThan(
            0.5
        );
        expect(
            meanBrightness(idle),
            `${backend} the same clouds remain dark until notes illuminate them`
        ).toBeLessThan(meanBrightness(initial) * 0.5);

        nebula.setEnabled(false);
        const disabled = await read(30);
        const stillDisabled = await read(75, 1);
        expect(difference(disabled, stillDisabled), `${backend} effects-off stability`).toBe(0);
        nebula.setEnabled(true);
        const restored = await read(0, 1);
        expect(difference(initial, restored), `${backend} deterministic effects restart`).toBe(0);
        const silent = await read(0, 0);
        expect(difference(idle, silent), `${backend} darkness returns without note energy`).toBe(0);
        return { idle, initial, animated };
    } finally {
        nebula.dispose();
        target.destroy();
        stage.destroy();
    }
}

describe('procedural piano nebula', () => {
    it('translates the single GLSL source and its std140 ABI through Naga without image samplers', async () => {
        const shader = H.Shader.getCustomShader(
            PIANO_NEBULA_VERTEX_SOURCE,
            PIANO_NEBULA_FRAGMENT_SOURCE
        );
        const translator = new NagaShaderTranslator();
        await translator.initialize();
        const translated = translator.translate(shader.vs, shader.fs);
        expect(translated.vertexInputs.map(input => input.name)).toEqual([
            'a_position',
            'a_texcoord0'
        ]);
        expect(translated.fragmentOutputs.map(output => output.location)).toEqual([0]);
        expect(translated.uniformBlocks.map(block => block.name)).toEqual(['PianoNebulaBlock']);
        expect(translated.samplers).toEqual([]);
        expect(PIANO_NEBULA_LAYOUT.byteLength).toBe(16);
        expect(PIANO_NEBULA_LAYOUT.fields.u_nebula.offset).toBe(0);
    });

    it('draws animated clouds with matching rows through real WebGL2 and WebGPU pipelines', async () => {
        const webgl = await renderNebula('webgl2');
        const webgpu = await renderNebula('webgpu');
        expect(difference(webgl.idle, webgpu.idle), 'idle shader backend parity').toBeLessThan(3);
        expect(
            difference(webgl.initial, webgpu.initial),
            'initial shader backend parity'
        ).toBeLessThan(3);
        expect(
            difference(webgl.animated, webgpu.animated),
            'animated shader backend parity'
        ).toBeLessThan(3);
    });
});
