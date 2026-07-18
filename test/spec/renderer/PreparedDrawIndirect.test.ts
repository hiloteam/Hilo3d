import { PreparedDraw } from '../../../src/render/renderer/PreparedDraw';
import { RHIBufferUsage, type RHIRenderPassEncoder } from '../../../src/render/rhi/core';
import { describe, expect, it, vi } from 'vitest';
import { FakeWebGPURHIBackend } from '../rhi/portable/FakeRHIBackend';

function revision(): {
    readonly geometry: number;
    readonly materialVariant: number;
    readonly renderState: number;
    readonly resourceBindings: number;
    readonly target: number;
    readonly deviceGeneration: number;
} {
    return {
        geometry: 1,
        materialVariant: 1,
        renderState: 1,
        resourceBindings: 1,
        target: 1,
        deviceGeneration: 1
    };
}

function createResources() {
    const backend = new FakeWebGPURHIBackend();
    const device = backend.createDevice();
    const layout = device.createPipelineLayout({ bindGroupLayouts: [] });
    const vertex = device.createShader({
        artifact: {
            backend: 'webgpu',
            stage: 'vertex',
            code: '@vertex fn main()->@builtin(position) vec4f{return vec4f();}',
            entryPoint: 'main',
            reflection: { bindings: [], vertexInputs: [] },
            cacheKey: 1
        }
    });
    const fragment = device.createShader({
        artifact: {
            backend: 'webgpu',
            stage: 'fragment',
            code: '@fragment fn main()->@location(0) vec4f{return vec4f();}',
            entryPoint: 'main',
            reflection: { bindings: [], fragmentOutputs: [{ location: 0 }] },
            cacheKey: 2
        }
    });
    const pipeline = device.createGraphicsPipeline({
        layout,
        vertex: { shader: vertex, buffers: [] },
        fragment: { shader: fragment, targets: [{ format: 'rgba8unorm' }] },
        primitive: { topology: 'triangle-list' }
    });
    const indirect = device.createBuffer({ size: 64, usage: RHIBufferUsage.INDIRECT });
    const indices = device.createBuffer({ size: 64, usage: RHIBufferUsage.INDEX });
    return { backend, pipeline, indirect, indices };
}

function passEncoder(): {
    readonly pass: RHIRenderPassEncoder;
    readonly drawIndirect: ReturnType<typeof vi.fn>;
    readonly drawIndexedIndirect: ReturnType<typeof vi.fn>;
    readonly setIndexBufferRecord: ReturnType<typeof vi.fn>;
} {
    const drawIndirect = vi.fn();
    const drawIndexedIndirect = vi.fn();
    const setIndexBufferRecord = vi.fn();
    return {
        drawIndirect,
        drawIndexedIndirect,
        setIndexBufferRecord,
        pass: {
            setPipeline: vi.fn(),
            setBindGroup: vi.fn(),
            setVertexBuffer: vi.fn(),
            setVertexBufferRecord: vi.fn(),
            setIndexBuffer: vi.fn(),
            setIndexBufferRecord,
            setViewport: vi.fn(),
            setViewportRecord: vi.fn(),
            setScissorRect: vi.fn(),
            setScissorRectRecord: vi.fn(),
            setBlendConstant: vi.fn(),
            setStencilReference: vi.fn(),
            draw: vi.fn(),
            drawRecord: vi.fn(),
            drawIndexed: vi.fn(),
            drawIndexedRecord: vi.fn(),
            drawIndirect,
            drawIndexedIndirect,
            end: vi.fn()
        } as unknown as RHIRenderPassEncoder
    };
}

describe('PreparedDraw indirect modes', () => {
    it('seals and emits a non-indexed indirect packet without CPU argument reads', () => {
        const { backend, pipeline, indirect } = createResources();
        const draw = new PreparedDraw(1, 1);
        draw.beginUpdate();
        draw.setPipeline(pipeline);
        draw.setDrawIndirect(indirect, 16);
        draw.finishUpdate(revision());
        draw.prepareVertexInput();
        const encoder = passEncoder();
        draw.execute(encoder.pass);

        expect(encoder.drawIndirect).toHaveBeenCalledWith(indirect, 16);
        expect(encoder.drawIndexedIndirect).not.toHaveBeenCalled();
        backend.destroy();
    });

    it('binds the index range before indexed indirect draw', () => {
        const { backend, pipeline, indirect, indices } = createResources();
        const draw = new PreparedDraw(1, 1);
        draw.beginUpdate();
        draw.setPipeline(pipeline);
        draw.setIndexBuffer(indices, 'uint32', 8, 40);
        draw.setDrawIndexedIndirect(indirect, 20);
        draw.finishUpdate(revision());
        const encoder = passEncoder();
        draw.execute(encoder.pass);

        expect(encoder.setIndexBufferRecord).toHaveBeenCalledWith(
            expect.objectContaining({ buffer: indices, format: 'uint32', offset: 8, size: 40 })
        );
        expect(encoder.drawIndexedIndirect).toHaveBeenCalledWith(indirect, 20);
        backend.destroy();
    });
});
