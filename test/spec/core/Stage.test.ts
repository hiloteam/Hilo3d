import { describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const Stage = Hilo3d.Stage;
const WebGLRenderer = Hilo3d.WebGLRenderer;

describe('Stage', () => {
    it('create', () => {
        const stage = new Stage({});
        expect(stage.isStage).toBe(true);
        expect(stage.className).toBe('Stage');
        expect(stage.width).toBe(innerWidth);
        expect(stage.height).toBe(innerHeight);
        expect(stage.pixelRatio).toBeGreaterThanOrEqual(1);
        expect(stage.pixelRatio).toBeLessThanOrEqual(2);
        expect(stage.renderer).toBeInstanceOf(WebGLRenderer);
    });

    it('resize', () => {
        const stage = new Stage({
            width: 800,
            height: 600
        });

        stage.resize(1000, 800, 2);
        expect(stage.width).toBe(1000);
        expect(stage.height).toBe(800);
        expect(stage.pixelRatio).toBe(2);
        expect(stage.rendererWidth).toBe(2000);
        expect(stage.rendererHeight).toBe(1600);
        expect(stage.canvas.style.width).toBe('1000px');
        expect(stage.canvas.style.height).toBe('800px');
    });

    it('owns scene fog and forwards instancing at renderer construction', () => {
        const fog = new Hilo3d.Fog({ mode: 'EXP2', density: 0.2 });
        const stage = new Stage({ fog, useInstanced: true });

        expect(stage.fog).toBe(fog);
        expect(stage.renderer.useInstanced).toBe(true);
        expect(stage.renderer.renderList.useInstanced).toBe(true);
    });

    it('rounds fractional device-pixel backing dimensions once for renderer parity', () => {
        const stage = new Stage({ width: 375, height: 667, pixelRatio: 1.5 });

        expect(stage.rendererWidth).toBe(563);
        expect(stage.rendererHeight).toBe(1001);
        expect(stage.renderer.width).toBe(563);
        expect(stage.renderer.height).toBe(1001);
        expect(stage.canvas.width).toBe(563);
        expect(stage.canvas.height).toBe(1001);
        const target = stage.renderer.createRenderTarget({
            width: stage.renderer.width,
            height: stage.renderer.height,
            colorAttachments: [{}]
        });
        expect(target.width).toBe(563);
        expect(target.height).toBe(1001);
        target.destroy();
    });

    it('awaits real WebGL2 initialization and rejects unavailable contexts', async () => {
        const stage = await Stage.create({ width: 16, height: 16, pixelRatio: 1 });
        expect(stage.renderer.isInit).toBe(true);
        expect(stage.renderer.isReady).toBe(true);
        stage.renderer.destroy();

        const unavailableCanvas = document.createElement('canvas');
        vi.spyOn(unavailableCanvas, 'getContext').mockReturnValue(null);
        await expect(
            Stage.create({
                canvas: unavailableCanvas,
                width: 16,
                height: 16,
                pixelRatio: 1
            })
        ).rejects.toThrow(/could not create a WebGL 2 context/u);
    });

    it('rejects the WebGL2-only preserved-framebuffer option before WebGPU initialization', () => {
        expect(() => {
            new Stage<'webgpu'>({
                backend: 'webgpu',
                preserveDrawingBuffer: false
            } as unknown as Hilo3d.StageParameters<'webgpu'>);
        }).toThrow(/preserveDrawingBuffer is WebGL2-only/);

        expect(() => {
            new Hilo3d.WebGPURenderer({
                preserveDrawingBuffer: true
            } as unknown as Hilo3d.WebGPURendererParameters);
        }).toThrow(/does not expose preserveDrawingBuffer/);
    });
});
