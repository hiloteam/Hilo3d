import { afterEach, describe, expect, it, vi } from 'vitest';
import { constructRHI, createRHI, isRHIBackendSupported } from '../../../src/render/rhi/RHIFactory';
import { WebGLRHI } from '../../../src/render/rhi/webgl2/WebGLRHI';
import { WebGPURHI } from '../../../src/render/rhi/webgpu/WebGPURHI';
import { createFakeWebGL2 } from './FakeWebGL2';
import { createFakeWebGPU, deferred } from './FakeWebGPU';

interface DestroyableRHI {
    destroy(): void;
}

const activeRhis: DestroyableRHI[] = [];

afterEach(() => {
    for (const rhi of activeRhis.splice(0)) rhi.destroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('RHIFactory', () => {
    it('probes WebGL2 with getContext only, without constructing a device or resources', async () => {
        const fake = createFakeWebGL2();
        const contextAttributes: WebGLContextAttributes = {
            alpha: false,
            antialias: false
        };
        const initialSize = [fake.canvas.width, fake.canvas.height];

        await expect(
            isRHIBackendSupported('webgl2', {
                canvas: fake.canvas,
                contextAttributes
            })
        ).resolves.toBe(true);

        expect(fake.getContext).toHaveBeenCalledOnce();
        expect(fake.getContext).toHaveBeenCalledWith('webgl2', contextAttributes);
        expect([fake.canvas.width, fake.canvas.height]).toEqual(initialSize);
        for (const method of [
            'getParameter',
            'getExtension',
            'createBuffer',
            'createFramebuffer',
            'createProgram',
            'createRenderbuffer',
            'createSampler',
            'createShader',
            'createTexture',
            'createVertexArray'
        ]) {
            expect(
                fake.call(method),
                `${method} must not run during a support probe`
            ).not.toHaveBeenCalled();
        }
    });

    it('constructs and returns each concrete backend directly', async () => {
        const webgl = createFakeWebGL2();
        const webglRhi = constructRHI('webgl2', {
            canvas: webgl.canvas,
            width: 16,
            height: 8
        });
        activeRhis.push(webglRhi);

        expect(webglRhi).toBeInstanceOf(WebGLRHI);
        expect(webglRhi.backend).toBe('webgl2');

        const webgpu = createFakeWebGPU();
        const webgpuRhi = constructRHI('webgpu', {
            canvas: webgpu.canvas,
            width: 16,
            height: 8
        });
        activeRhis.push(webgpuRhi);

        expect(webgpuRhi).toBeInstanceOf(WebGPURHI);
        expect(webgpuRhi.backend).toBe('webgpu');
        await webgpuRhi.ready;
    });

    it('does not resolve createRHI until WebGPU device and surface initialization finish', async () => {
        const fake = createFakeWebGPU();
        const deviceRequest = deferred<GPUDevice>();
        fake.requestDevice.mockReturnValueOnce(deviceRequest.promise);

        const result = createRHI('webgpu', {
            canvas: fake.canvas,
            width: 32,
            height: 18
        });
        const resolved = vi.fn();
        void result.then(resolved);

        await vi.waitFor(() => {
            expect(fake.requestDevice).toHaveBeenCalledOnce();
        });
        await Promise.resolve();
        expect(resolved).not.toHaveBeenCalled();
        expect(fake.configure).not.toHaveBeenCalled();

        deviceRequest.resolve(fake.device);
        const rhi = await result;
        activeRhis.push(rhi);

        expect(rhi).toBeInstanceOf(WebGPURHI);
        expect(rhi.isReady).toBe(true);
        expect(fake.configure).toHaveBeenCalledOnce();
        expect(resolved).toHaveBeenCalledWith(rhi);
    });

    it('probes WebGPU through the adapter without requesting a device', async () => {
        const fake = createFakeWebGPU();
        const adapterValidator = vi.fn();

        await expect(
            isRHIBackendSupported('webgpu', {
                powerPreference: 'high-performance',
                adapterValidator
            })
        ).resolves.toBe(true);

        expect(fake.requestAdapter).toHaveBeenCalledOnce();
        expect(fake.requestAdapter).toHaveBeenCalledWith({
            powerPreference: 'high-performance'
        });
        expect(adapterValidator).toHaveBeenCalledOnce();
        expect(adapterValidator).toHaveBeenCalledWith(fake.adapter);
        expect(fake.requestDevice).not.toHaveBeenCalled();
        expect(fake.configure).not.toHaveBeenCalled();
        expect(fake.createBuffer).not.toHaveBeenCalled();
        expect(fake.createTexture).not.toHaveBeenCalled();
    });
});
