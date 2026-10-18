import { expect, it, vi } from 'vitest';
import { installWebGPUCanvasTestGuard } from '../../scripts/browser-test-capabilities';
import { RHIBufferUsage, RHITextureUsage } from '../../src/render/rhi/core/RHITypes';

it('blocks native swapchain acquisition while preserving real offscreen submission and readback', async () => {
    const adapter = await navigator.gpu.requestAdapter({ forceFallbackAdapter: true });
    if (adapter === null) throw new Error('The presentation guard fixture requires WebGPU');
    const device = await adapter.requestDevice();
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const context = canvas.getContext('webgpu');
    if (!(context instanceof GPUCanvasContext))
        throw new Error('The presentation guard fixture requires a WebGPU canvas');
    const descriptor = Object.getOwnPropertyDescriptor(
        GPUCanvasContext.prototype,
        'getCurrentTexture'
    );
    const nativeAcquire = vi.spyOn(GPUCanvasContext.prototype, 'getCurrentTexture');
    const restore = installWebGPUCanvasTestGuard(
        GPUCanvasContext.prototype,
        'reject-linux-headless-coverage'
    );
    const texture = device.createTexture({
        size: [1, 1],
        format: 'rgba8unorm',
        usage: RHITextureUsage.RENDER_ATTACHMENT | RHITextureUsage.COPY_SRC
    });
    const readback = device.createBuffer({
        size: 256,
        usage: RHIBufferUsage.COPY_DST | RHIBufferUsage.MAP_READ
    });
    try {
        context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat() });
        expect(() => context.getCurrentTexture()).toThrow(/test\/surface-render\//u);
        expect(nativeAcquire).not.toHaveBeenCalled();

        device.pushErrorScope('validation');
        const commands = device.createCommandEncoder();
        const pass = commands.beginRenderPass({
            colorAttachments: [
                {
                    view: texture.createView(),
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: [1, 0, 0, 1]
                }
            ]
        });
        pass.end();
        commands.copyTextureToBuffer({ texture }, { buffer: readback, bytesPerRow: 256 }, [1, 1]);
        device.queue.submit([commands.finish()]);
        await readback.mapAsync(0x1);
        expect([...new Uint8Array(readback.getMappedRange(), 0, 4)]).toEqual([255, 0, 0, 255]);
        readback.unmap();
        expect(await device.popErrorScope()).toBeNull();
        expect(nativeAcquire).not.toHaveBeenCalled();

        restore();
        expect(context.getCurrentTexture().width).toBe(2);
        expect(nativeAcquire).toHaveBeenCalledOnce();
        context.unconfigure();
        expect(() => context.getCurrentTexture()).toThrow(/not configured/u);
        expect(nativeAcquire).toHaveBeenCalledTimes(2);
    } finally {
        restore();
        nativeAcquire.mockRestore();
        context.unconfigure();
        readback.destroy();
        texture.destroy();
        device.destroy();
    }
    expect(
        Object.getOwnPropertyDescriptor(GPUCanvasContext.prototype, 'getCurrentTexture')
    ).toEqual(descriptor);
});
