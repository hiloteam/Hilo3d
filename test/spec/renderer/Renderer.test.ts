import { afterEach, describe, expect, it, vi } from 'vitest';
import Renderer from '../../../src/render/Renderer';
import WebGPUDriver from '../../../src/render/internal/webgpu/WebGPUDriver';

const activeRenderers: Renderer[] = [];

afterEach(() => {
    for (const renderer of activeRenderers.splice(0)) renderer.destroy();
    vi.restoreAllMocks();
});

describe('Renderer public entry point', () => {
    it('returns the concrete WebGL2 driver directly behind the unified contract', async () => {
        const renderer = new Renderer<'webgl2'>({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 16,
            height: 8
        });
        activeRenderers.push(renderer);
        await renderer.ready;

        expect(renderer).toBeInstanceOf(Renderer);
        expect(renderer).toMatchObject({
            backend: 'webgl2',
            className: 'Renderer',
            isReady: true
        });
        expect(renderer.getExtension('webgl2-native')).toBe(renderer);
        expect(renderer.getExtension('webgpu-native')).toBeNull();
        expect(renderer).not.toHaveProperty('isWebGLRenderer');
    });

    it('awaits an explicitly selected backend through create', async () => {
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 12,
            height: 6
        });
        activeRenderers.push(renderer);

        expect(renderer.backend).toBe('webgl2');
        expect(renderer.isReady).toBe(true);
    });

    it('probes auto once and falls back to WebGL2 without a facade', async () => {
        const support = vi.spyOn(WebGPUDriver, 'isSupported').mockResolvedValue(false);
        const renderer = await Renderer.create({
            backend: 'auto',
            domElement: document.createElement('canvas'),
            width: 20,
            height: 10
        });
        activeRenderers.push(renderer);

        expect(support).toHaveBeenCalledOnce();
        expect(renderer.backend).toBe('webgl2');
        expect(renderer.getExtension('webgl2-native')).toBe(renderer);
    });

    it('snapshots create options before an asynchronous auto probe settles', async () => {
        let resolveSupport: ((supported: boolean) => void) | undefined;
        vi.spyOn(WebGPUDriver, 'isSupported').mockImplementation(
            async () =>
                new Promise<boolean>(resolve => {
                    resolveSupport = resolve;
                })
        );
        const options = {
            backend: 'auto' as const,
            domElement: document.createElement('canvas'),
            width: 18,
            height: 9
        };
        const pendingRenderer = Renderer.create(options);
        options.width = 36;
        resolveSupport?.(false);
        const renderer = await pendingRenderer;
        activeRenderers.push(renderer);

        expect(renderer.width).toBe(18);
        expect(renderer.height).toBe(9);
    });

    it('delegates WebGL2 support probing to the RHI-owned context boundary', async () => {
        const canvas = document.createElement('canvas');
        const getContext = vi.spyOn(canvas, 'getContext');

        await expect(
            Renderer.isBackendSupported('webgl2', {
                backend: 'webgl2',
                domElement: canvas,
                alpha: false
            })
        ).resolves.toBe(true);
        expect(getContext).toHaveBeenCalledOnce();
        expect(getContext).toHaveBeenCalledWith(
            'webgl2',
            expect.objectContaining({ alpha: false })
        );
    });
});
