import { describe, expect, it } from 'vitest';
import { RendererDiagnostics } from '../../../src/render/RendererDiagnostics';
import {
    WebGPUBufferUsage,
    WebGPUTextureUsage
} from '../../../src/render/internal/webgpu/WebGPUConstants';
import { WebGLRHIDiagnostics } from '../../../src/render/rhi/webgl2/WebGLInternal';
import { WebGPURHIDiagnostics } from '../../../src/render/rhi/webgpu/WebGPUBase';
import { WebGPUDevice } from '../../../src/render/rhi/webgpu/WebGPUDevice';
import { createFakeWebGPU } from './FakeWebGPU';

describe('legacy RHI renderer diagnostics bridge', () => {
    it('forwards exact WebGL creation and frame counters without inventing lifetimes', () => {
        const renderer = new RendererDiagnostics();
        const diagnostics = new WebGLRHIDiagnostics(true, renderer);

        diagnostics.recordResource('buffer');
        diagnostics.recordResource('pipeline');
        diagnostics.recordResource('bindGroup');
        diagnostics.recordStateChange();
        diagnostics.recordBufferUpload();
        diagnostics.recordTextureUpload();
        diagnostics.recordRenderPass();
        diagnostics.recordDraw();
        diagnostics.recordCommandEncoder();
        diagnostics.recordCommandBuffer();
        diagnostics.recordSubmission();

        const snapshot = renderer.snapshot();
        expect(snapshot.nativeObjects.buffer).toEqual({
            created: 1,
            destroyed: null,
            live: null,
            highWater: null
        });
        expect(snapshot.nativeObjects.program.created).toBe(1);
        expect(snapshot.nativeObjects.pipeline.created).toBe(0);
        expect(snapshot.nativeObjects.bindGroup.created).toBe(0);
        expect(snapshot.nativeObjects.commandEncoder.created).toBe(0);
        expect(snapshot.nativeObjects.commandBuffer.created).toBe(0);
        expect(snapshot.caches.pipeline).toEqual({
            hits: 0,
            misses: 0,
            evictions: 0,
            size: 0,
            highWater: 0
        });
        expect(snapshot.frame).toMatchObject({
            draws: 1,
            passes: 1,
            stateChanges: 1,
            uploads: 2,
            submissions: 1
        });
    });

    it('forwards WebGPU native fast-path creations, cache diagnostics, uploads, and submissions', () => {
        const fake = createFakeWebGPU();
        const renderer = new RendererDiagnostics();
        const diagnostics = new WebGPURHIDiagnostics(renderer);
        const device = new WebGPUDevice(fake.adapter, fake.device, diagnostics);

        device.createNativeBuffer({ size: 4, usage: WebGPUBufferUsage.COPY_DST });
        device.createNativeTexture({
            size: { width: 1, height: 1 },
            format: 'rgba8unorm',
            usage: WebGPUTextureUsage.TEXTURE_BINDING
        });
        device.createNativeSampler();
        device.createNativeSampler();
        device.createNativeCommandEncoder();
        device.writeNativeBuffer(
            fake.device.createBuffer({ size: 4, usage: WebGPUBufferUsage.COPY_DST }),
            0,
            new Uint32Array([1])
        );
        device.submitNative([]);

        const snapshot = renderer.snapshot();
        expect(snapshot.nativeObjects.buffer.created).toBe(1);
        expect(snapshot.nativeObjects.buffer.live).toBeNull();
        expect(snapshot.nativeObjects.texture.created).toBe(1);
        expect(snapshot.nativeObjects.sampler.created).toBe(1);
        expect(snapshot.nativeObjects.commandEncoder.created).toBe(1);
        expect(snapshot.caches.sampler).toEqual({
            hits: 1,
            misses: null,
            evictions: null,
            size: null,
            highWater: null
        });
        expect(snapshot.frame.uploads).toBe(1);
        expect(snapshot.frame.submissions).toBe(1);

        device.destroy();
    });
});
