import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import { resolveStageBackend } from '../../../src/core/Stage';

const Stage = Hilo3d.Stage;
const Renderer = Hilo3d.Renderer;

function backendSelectionPipeline(
    requirements: Readonly<Hilo3d.RenderPipelineRequirements>
): Hilo3d.RenderPipelineFactory {
    return {
        name: 'stage-backend-selection-test',
        requirements,
        create() {
            throw new Error('Stage backend selection test pipeline must not be created');
        }
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('Stage', () => {
    it('creates only through the asynchronous factory', async () => {
        expect(() => {
            Reflect.construct(Stage, []);
        }).toThrow(/use await Stage\.create\(\)/u);
        const stage = await Stage.create({ backend: 'webgl2' });
        expect(stage.isStage).toBe(true);
        expect(stage.className).toBe('Stage');
        expect(stage.width).toBe(innerWidth);
        expect(stage.height).toBe(innerHeight);
        expect(stage.pixelRatio).toBeGreaterThanOrEqual(1);
        expect(stage.pixelRatio).toBeLessThanOrEqual(2);
        expect(stage.renderer).toBeInstanceOf(Renderer);
        expect(stage.renderer.backend).toBe('webgl2');
        stage.destroy();
    });

    it('resize', async () => {
        const stage = await Stage.create({
            backend: 'webgl2',
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
        stage.destroy();
    });

    it('owns scene fog and forwards instancing at renderer construction', async () => {
        const fog = new Hilo3d.Fog({ mode: 'EXP2', density: 0.2 });
        const stage = await Stage.create({ backend: 'webgl2', fog, useInstanced: true });

        expect(stage.fog).toBe(fog);
        expect(stage.renderer.useInstanced).toBe(true);
        stage.destroy();
    });

    it('forwards a scriptable pipeline factory through asynchronous Stage creation', async () => {
        const pass = new Hilo3d.SceneRenderPass('Stage pipeline clear');
        let recordCount = 0;
        let destroyCount = 0;
        const create = vi.fn(
            (_context: Hilo3d.RenderPipelineCreateContext): Hilo3d.RenderPipeline => ({
                name: 'stage-pipeline',
                record(context: Hilo3d.RenderPipelineContext): void {
                    const culling = context.cull();
                    const list = context.createRendererList({
                        cullingResults: culling,
                        queue: 'all',
                        sorting: 'none'
                    });
                    const output = context.graph.importOutput();
                    context.graph.addPass(pass, {
                        rendererList: list,
                        colorAttachments: [
                            {
                                texture: output.color(0),
                                loadOp: 'clear',
                                storeOp: 'store',
                                clearValue: context.clearColor
                            }
                        ]
                    });
                    recordCount++;
                },
                destroy(): void {
                    destroyCount++;
                }
            })
        );
        const stage = await Stage.create({
            backend: 'webgl2',
            width: 8,
            height: 8,
            pixelRatio: 1,
            renderPipeline: { name: 'stage-pipeline', create }
        });

        stage.renderer.render(stage, new Hilo3d.PerspectiveCamera());

        expect(create).toHaveBeenCalledOnce();
        expect(recordCount).toBe(1);
        stage.destroy();
        expect(destroyCount).toBe(1);
    });

    it('rounds fractional device-pixel backing dimensions once for renderer parity', async () => {
        const stage = await Stage.create({
            backend: 'webgl2',
            width: 375,
            height: 667,
            pixelRatio: 1.5
        });

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
        stage.destroy();
    });

    it('awaits real WebGL2 initialization and rejects unavailable contexts', async () => {
        const stage = await Stage.create({
            backend: 'webgl2',
            width: 16,
            height: 16,
            pixelRatio: 1
        });
        expect(stage.renderer.getExtension('rhi')).toMatchObject({
            device: { backend: 'webgl2' },
            surface: { state: 'configured' },
            recoveryState: 'ready'
        });
        const native = stage.renderer.getExtension('webgl2-native') as {
            readonly renderScene?: unknown;
        } | null;
        expect(typeof native?.renderScene).toBe('function');
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

    it('uses the same WebGPU-only pipeline selection policy as Renderer.create', async () => {
        const support = vi.spyOn(Renderer, 'isBackendSupported');
        support
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(true);

        await expect(
            resolveStageBackend({
                backend: 'auto',
                renderPipeline: backendSelectionPipeline({
                    requiredCapabilities: ['indirect-draw']
                })
            })
        ).resolves.toBe('webgpu');
        await expect(
            resolveStageBackend({
                backend: 'auto',
                renderPipeline: backendSelectionPipeline({
                    requiredTextureFormats: [{ format: 'rgba16float', use: 'storage' }]
                })
            })
        ).resolves.toBe('webgpu');
        await expect(
            resolveStageBackend({
                backend: 'auto',
                renderPipeline: backendSelectionPipeline({
                    requiredLimits: { maxComputeWorkgroupsPerDimension: 1024 }
                })
            })
        ).resolves.toBe('webgpu');
        await expect(
            resolveStageBackend({
                backend: 'auto',
                renderPipeline: backendSelectionPipeline({
                    requiredFeatures: ['shader-f16']
                })
            })
        ).resolves.toBe('webgpu');

        expect(support).toHaveBeenCalledTimes(4);
        expect(support.mock.calls[2]?.[0]).toBe('webgpu');
        expect(support.mock.calls[2]?.[1]).toMatchObject({
            requiredLimits: { maxComputeWorkgroupsPerDimension: 1024 }
        });
        expect(support.mock.lastCall?.[1]).toMatchObject({
            requiredFeatures: ['shader-f16']
        });
    });

    it('rejects Stage WebGPU-only requirements instead of falling back to WebGL2', async () => {
        const support = vi.spyOn(Renderer, 'isBackendSupported').mockResolvedValue(false);

        await expect(
            resolveStageBackend({
                backend: 'auto',
                renderPipeline: backendSelectionPipeline({
                    requiredCapabilities: ['storage-buffer']
                })
            })
        ).rejects.toThrow(
            /No compatible Stage backend: render pipeline capability storage-buffer requires WebGPU/u
        );
        await expect(
            resolveStageBackend({
                backend: 'auto',
                requiredFeatures: ['shader-f16']
            })
        ).rejects.toThrow(
            /No compatible Stage backend: renderer feature shader-f16 requires WebGPU/u
        );
        expect(support).toHaveBeenCalledTimes(2);
    });

    it('rejects Stage backend and canvas-policy conflicts before probing or creating a context', async () => {
        const support = vi.spyOn(Renderer, 'isBackendSupported');
        const canvas = document.createElement('canvas');
        const getContext = vi.spyOn(canvas, 'getContext');
        const computePipeline = backendSelectionPipeline({
            requiredCapabilities: ['compute-pass']
        });

        await expect(
            Stage.create({
                backend: 'webgl2',
                canvas,
                renderPipeline: computePipeline
            })
        ).rejects.toThrow(/capability compute-pass requires WebGPU.*backend webgl2/u);
        await expect(
            Stage.create({
                backend: 'webgl2',
                canvas,
                requiredFeatures: ['shader-f16']
            })
        ).rejects.toThrow(/renderer feature shader-f16 requires WebGPU.*backend webgl2/u);
        await expect(
            resolveStageBackend({
                backend: 'auto',
                preserveDrawingBuffer: false,
                renderPipeline: computePipeline
            })
        ).rejects.toThrow(/compute-pass requires WebGPU.*preserveDrawingBuffer is WebGL2-only/u);
        await expect(
            resolveStageBackend({
                backend: 'auto',
                alpha: true,
                premultipliedAlpha: false,
                renderPipeline: backendSelectionPipeline({
                    requiredTextureFormats: [{ format: 'rgba8unorm', use: 'storage' }]
                })
            })
        ).rejects.toThrow(
            /storage texture format rgba8unorm requires WebGPU.*premultipliedAlpha: false is WebGL2-only/u
        );
        expect(support).not.toHaveBeenCalled();
        expect(getContext).not.toHaveBeenCalled();
    });

    it('snapshots Stage pipeline requirements before awaiting adapter discovery', async () => {
        let resolveSupport: ((supported: boolean) => void) | undefined;
        vi.spyOn(Renderer, 'isBackendSupported').mockImplementation(
            async () =>
                new Promise<boolean>(resolve => {
                    resolveSupport = resolve;
                })
        );
        const requiredCapabilities: Hilo3d.RenderPipelineCapabilityName[] = ['compute-pass'];
        const pendingStage = Stage.create({
            backend: 'auto',
            renderPipeline: backendSelectionPipeline({ requiredCapabilities })
        });

        requiredCapabilities.length = 0;
        resolveSupport?.(false);

        await expect(pendingStage).rejects.toThrow(/capability compute-pass requires WebGPU/u);
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
        const params: Hilo3d.StageParameters = {
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

    it('rejects the WebGL2-only preserved-framebuffer option before WebGPU initialization', async () => {
        await expect(
            Stage.create({
                backend: 'webgpu',
                preserveDrawingBuffer: false
            } as unknown as Hilo3d.StageParameters<'webgpu'>)
        ).rejects.toThrow(/preserveDrawingBuffer is WebGL2-only/u);

        await expect(
            Hilo3d.Renderer.create({
                backend: 'webgpu',
                preserveDrawingBuffer: true
            } as never)
        ).rejects.toThrow(/Renderer preserveDrawingBuffer is WebGL2-only/u);
    });
});
