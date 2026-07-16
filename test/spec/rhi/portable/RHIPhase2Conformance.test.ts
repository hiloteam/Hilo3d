import { describe, expect, it } from 'vitest';
import { createWebGL2RHIDevice } from '../../../../src/render/rhi/backends/webgl2';
import { WebGPUDevice } from '../../../../src/render/rhi/backends/webgpu';
import { expectRHIPhase2Conformance, runRHIPhase2Conformance } from './RHIPhase2Conformance';
import { createStructuredWebGPUMock } from './StructuredWebGPUMock';

describe('RHI Phase 2 shared concrete conformance', () => {
    it('executes the shared scene matrix on real WebGL2', async () => {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('webgl2');
        if (context === null) return;
        const device = createWebGL2RHIDevice(context);
        try {
            const result = await runRHIPhase2Conformance({ device, canvas });
            expectRHIPhase2Conformance(result);
        } finally {
            device.destroy();
        }
    });

    it('executes the same scene matrix and readback assertions on structured WebGPU', async () => {
        const native = createStructuredWebGPUMock();
        const device = new WebGPUDevice(native.device);
        try {
            const result = await runRHIPhase2Conformance({ device, canvas: native.canvas });
            expectRHIPhase2Conformance(result);
            expect(native.log).toContain('pass.drawIndexed');
            expect(native.log).toContain('pass.setStencilReference');
            expect(native.log).toContain('encoder.copyTextureToTexture');
            expect(native.log).toContain('encoder.copyTextureToBuffer');
            expect(native.log).toContain('encoder.copyBufferToTexture');
            expect(native.log).toContain('surface.getCurrentTexture');
            expect(native.log.filter(event => event === 'queue.submit')).toHaveLength(7);
        } finally {
            device.destroy();
        }
    });
});
