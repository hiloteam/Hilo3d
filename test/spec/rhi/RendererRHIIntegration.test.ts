import { afterEach, describe, expect, it, vi } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Node from '../../../src/core/Node';
import WebGPUDriver from '../../../src/render/internal/webgpu/WebGPUDriver';
import { NagaShaderTranslator } from '../../../src/render/shader/GlslToWgsl';
import {
    WebGPUDevice,
    type WebGPURHI,
    WebGPUSurface
} from '../../../src/render/rhi/webgpu/WebGPURHI';
import { createFakeWebGPU } from './FakeWebGPU';

const renderers: WebGPUDriver[] = [];

afterEach(() => {
    for (const renderer of renderers.splice(0)) renderer.destroy();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Renderer RHI integration', () => {
    it('routes the main frame and production managers through concrete RHI owners', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const createEncoder = vi.spyOn(WebGPUDevice.prototype, 'createNativeCommandEncoder');
        const submit = vi.spyOn(WebGPUDevice.prototype, 'submitNative');
        const currentTexture = vi.spyOn(WebGPUSurface.prototype, 'getCurrentNativeTexture');
        const fake = createFakeWebGPU();
        const renderer = new WebGPUDriver({
            domElement: fake.canvas,
            width: 16,
            height: 8,
            antialias: false
        });
        renderers.push(renderer);
        await renderer.ready;
        const rhi = Reflect.get(renderer, 'rhi') as WebGPURHI;

        expect(Reflect.get(Reflect.get(renderer, 'pipelineManager'), 'rhiDevice')).toBe(rhi.device);
        expect(Reflect.get(Reflect.get(renderer, 'bufferManager'), 'owner')).toBe(rhi.device);
        expect(Reflect.get(Reflect.get(renderer, 'textureManager'), '_rhiDevice')).toBe(rhi.device);
        expect(Reflect.get(Reflect.get(renderer, 'uniformBufferManager'), 'owner')).toBe(
            rhi.device
        );
        expect(Reflect.get(Reflect.get(renderer, 'bindGroupManager'), 'rhiDevice')).toBe(
            rhi.device
        );

        renderer.render(new Node(), new PerspectiveCamera());

        expect(createEncoder).toHaveBeenCalledOnce();
        expect(submit).toHaveBeenCalledOnce();
        expect(currentTexture).toHaveBeenCalledOnce();
    });

    it('retains one RHI identity while replacing its native WebGPU device after loss', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const first = createFakeWebGPU();
        const renderer = new WebGPUDriver({
            domElement: first.canvas,
            width: 16,
            height: 8,
            antialias: false
        });
        renderers.push(renderer);
        await renderer.ready;

        const rhi = Reflect.get(renderer, 'rhi') as WebGPURHI;
        expect(rhi).toBeInstanceOf(Object);
        expect(rhi.nativeDevice).toBe(first.device);
        expect(rhi.nativeContext).toBe(first.context);
        expect(renderer.gpuDevice).toBe(first.device);
        const generation = rhi.generation;

        const replacement = createFakeWebGPU();
        first.requestDevice.mockResolvedValueOnce(replacement.device);
        first.lost.resolve({ reason: 'unknown', message: 'integration loss' });
        await vi.waitFor(() => {
            expect(renderer.recoveryPromise).not.toBeNull();
        });
        await renderer.recoveryPromise;

        expect(Reflect.get(renderer, 'rhi')).toBe(rhi);
        expect(rhi.generation).toBe(generation + 1);
        expect(rhi.nativeDevice).toBe(replacement.device);
        expect(rhi.nativeContext).toBe(first.context);
        expect(renderer.gpuDevice).toBe(replacement.device);
        expect(renderer.recoveryState).toBe('ready');
    });
});
