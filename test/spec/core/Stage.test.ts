import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import { resolveStageBackend } from '../../../src/core/Stage';

const Stage = Hilo3d.Stage;
const Renderer = Hilo3d.Renderer;

afterEach(() => {
    vi.restoreAllMocks();
});

describe('Stage', () => {
    it('create', () => {
        const stage = new Stage({});
        expect(stage.isStage).toBe(true);
        expect(stage.className).toBe('Stage');
        expect(stage.width).toBe(innerWidth);
        expect(stage.height).toBe(innerHeight);
        expect(stage.pixelRatio).toBeGreaterThanOrEqual(1);
        expect(stage.pixelRatio).toBeLessThanOrEqual(2);
        expect(stage.renderer).toBeInstanceOf(Renderer);
        expect(stage.renderer.backend).toBe('webgl2');
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
        const stage = await Stage.create({
            backend: 'webgl2',
            width: 16,
            height: 16,
            pixelRatio: 1
        });
        expect(stage.renderer.getExtension('rhi-v2')).toMatchObject({
            device: { backend: 'webgl2' },
            surface: { state: 'configured' },
            recoveryState: 'ready'
        });
        expect(stage.renderer.getExtension('webgl2-native')).toMatchObject({
            renderScene: expect.any(Function)
        });
        expect(stage.renderer.isReady).toBe(true);
        stage.renderer.destroy();

        const unavailableCanvas = document.createElement('canvas');
        vi.spyOn(unavailableCanvas, 'getContext').mockReturnValue(null);
        await expect(
            Stage.create({
                backend: 'webgl2',
                canvas: unavailableCanvas,
                width: 16,
                height: 16,
                pixelRatio: 1
            })
        ).rejects.toThrow(/WebGL2 is unavailable/u);
    });

    it('resolves auto through the lightweight support probe without probing explicit backends', async () => {
        const support = vi.spyOn(Renderer, 'isBackendSupported');
        support.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

        await expect(resolveStageBackend()).resolves.toBe('webgpu');
        await expect(resolveStageBackend({ backend: 'auto' })).resolves.toBe('webgl2');
        expect(support).toHaveBeenCalledTimes(2);

        support.mockClear();
        await expect(resolveStageBackend({ backend: 'webgpu' })).resolves.toBe('webgpu');
        await expect(resolveStageBackend({ backend: 'webgl2' })).resolves.toBe('webgl2');
        await expect(
            resolveStageBackend({ backend: 'auto', preserveDrawingBuffer: false })
        ).resolves.toBe('webgl2');
        await expect(
            resolveStageBackend({
                backend: 'auto',
                alpha: true,
                premultipliedAlpha: false
            })
        ).resolves.toBe('webgl2');
        expect(support).not.toHaveBeenCalled();
    });

    it('rejects invalid runtime backend values instead of silently selecting WebGL2', async () => {
        await expect(
            resolveStageBackend({
                backend: 'invalid'
            } as unknown as Hilo3d.StageParameters<Hilo3d.StageBackend>)
        ).rejects.toThrow(/Unsupported Stage backend invalid/u);
    });

    it('snapshots auto parameters before awaiting adapter discovery', async () => {
        let resolveSupport: ((supported: boolean) => void) | undefined;
        vi.spyOn(Renderer, 'isBackendSupported').mockImplementation(
            async () =>
                new Promise<boolean>(resolve => {
                    resolveSupport = resolve;
                })
        );
        const params: Hilo3d.StageParameters<'auto'> = {
            width: 16,
            height: 16,
            pixelRatio: 1
        };
        const pendingStage = Stage.create(params);
        params.width = 32;
        params.height = 32;
        resolveSupport?.(false);
        const stage = await pendingStage;

        expect(stage.width).toBe(16);
        expect(stage.height).toBe(16);
        stage.renderer.destroy();
    });

    it('creates WebGL2 when the default auto probe reports WebGPU unsupported', async () => {
        const support = vi.spyOn(Renderer, 'isBackendSupported').mockResolvedValue(false);
        const stage = await Stage.create({ width: 16, height: 16, pixelRatio: 1 });

        expect(support).toHaveBeenCalledOnce();
        expect(stage.renderer).toBeInstanceOf(Renderer);
        expect(stage.renderer.backend).toBe('webgl2');
        expect(stage.canvas.dataset['hilo3dBackend']).toBe('webgl2');
        stage.renderer.destroy();
    });

    it('rejects the WebGL2-only preserved-framebuffer option before WebGPU initialization', () => {
        expect(() => {
            new Stage<'webgpu'>({
                backend: 'webgpu',
                preserveDrawingBuffer: false
            } as unknown as Hilo3d.StageParameters<'webgpu'>);
        }).toThrow(/preserveDrawingBuffer is WebGL2-only/);

        expect(() => {
            new Hilo3d.Renderer({
                backend: 'webgpu',
                preserveDrawingBuffer: true
            } as never);
        }).toThrow(/Renderer preserveDrawingBuffer is WebGL2-only/);
    });
});
