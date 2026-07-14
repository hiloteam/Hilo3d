import { describe, expect, it, vi } from 'vitest';
import WebGPUCommandState from '../../../src/render/internal/webgpu/WebGPUCommandState';
import WebGPUDriver from '../../../src/render/internal/webgpu/WebGPUDriver';

interface FakeRenderPass {
    readonly pass: GPURenderPassEncoder;
    readonly setPipeline: ReturnType<typeof vi.fn>;
    readonly setBindGroup: ReturnType<typeof vi.fn>;
    readonly setVertexBuffer: ReturnType<typeof vi.fn>;
    readonly setIndexBuffer: ReturnType<typeof vi.fn>;
    readonly setViewport: ReturnType<typeof vi.fn>;
    readonly setStencilReference: ReturnType<typeof vi.fn>;
    readonly drawIndexed: ReturnType<typeof vi.fn>;
}

function createFakeRenderPass(): FakeRenderPass {
    const setPipeline = vi.fn();
    const setBindGroup = vi.fn();
    const setVertexBuffer = vi.fn();
    const setIndexBuffer = vi.fn();
    const setViewport = vi.fn();
    const setStencilReference = vi.fn();
    const drawIndexed = vi.fn();
    const pass = {
        setPipeline,
        setBindGroup,
        setVertexBuffer,
        setIndexBuffer,
        setViewport,
        setStencilReference,
        drawIndexed
    } as unknown as GPURenderPassEncoder;
    return {
        pass,
        setPipeline,
        setBindGroup,
        setVertexBuffer,
        setIndexBuffer,
        setViewport,
        setStencilReference,
        drawIndexed
    };
}

describe('WebGPUCommandState', () => {
    it('does not encode unchanged render state more than once in a pass', () => {
        const fake = createFakeRenderPass();
        const state = new WebGPUCommandState();
        const pipeline = {} as GPURenderPipeline;
        const bindGroup = {} as GPUBindGroup;
        const vertexBuffer = {} as GPUBuffer;
        const indexBuffer = {} as GPUBuffer;
        state.beginPass(fake.pass);

        for (let iteration = 0; iteration < 2; iteration++) {
            state.setPipeline(pipeline);
            state.setBindGroup(0, bindGroup, [16, 32]);
            state.setVertexBuffer(1, vertexBuffer, 4, 64);
            state.setIndexBuffer(indexBuffer, 'uint16', 8, 32);
            state.setViewport(2, 3, 640, 480, 0.1, 0.9);
            state.setStencilReference(7);
        }

        expect(fake.setPipeline).toHaveBeenCalledOnce();
        expect(fake.setBindGroup).toHaveBeenCalledOnce();
        expect(fake.setVertexBuffer).toHaveBeenCalledOnce();
        expect(fake.setIndexBuffer).toHaveBeenCalledOnce();
        expect(fake.setViewport).toHaveBeenCalledOnce();
        expect(fake.setStencilReference).toHaveBeenCalledOnce();
    });

    it('encodes changes to resources, ranges, formats, and dynamic state', () => {
        const fake = createFakeRenderPass();
        const state = new WebGPUCommandState();
        const firstPipeline = {} as GPURenderPipeline;
        const secondPipeline = {} as GPURenderPipeline;
        const firstBindGroup = {} as GPUBindGroup;
        const secondBindGroup = {} as GPUBindGroup;
        const firstBuffer = {} as GPUBuffer;
        const secondBuffer = {} as GPUBuffer;
        state.beginPass(fake.pass);

        state.setPipeline(firstPipeline);
        state.setPipeline(secondPipeline);
        state.setPipeline(secondPipeline);
        expect(fake.setPipeline).toHaveBeenCalledTimes(2);

        state.setBindGroup(0, firstBindGroup, [0]);
        state.setBindGroup(0, firstBindGroup, [256]);
        state.setBindGroup(0, secondBindGroup, [256]);
        expect(fake.setBindGroup).toHaveBeenCalledTimes(3);

        state.setVertexBuffer(0, firstBuffer);
        state.setVertexBuffer(0, firstBuffer, 4);
        state.setVertexBuffer(0, firstBuffer, 4, 32);
        state.setVertexBuffer(0, secondBuffer, 4, 32);
        expect(fake.setVertexBuffer).toHaveBeenCalledTimes(4);

        state.setIndexBuffer(firstBuffer, 'uint16');
        state.setIndexBuffer(firstBuffer, 'uint32');
        state.setIndexBuffer(firstBuffer, 'uint32', 8);
        state.setIndexBuffer(secondBuffer, 'uint32', 8);
        expect(fake.setIndexBuffer).toHaveBeenCalledTimes(4);

        state.setViewport(0, 0, 640, 480, 0, 1);
        state.setViewport(0, 0, 640, 480, 0, 0.5);
        expect(fake.setViewport).toHaveBeenCalledTimes(2);

        state.setStencilReference(1);
        state.setStencilReference(2);
        expect(fake.setStencilReference).toHaveBeenCalledTimes(2);
    });

    it('snapshots the selected dynamic offsets instead of caching their array identity', () => {
        const fake = createFakeRenderPass();
        const state = new WebGPUCommandState();
        const bindGroup = {} as GPUBindGroup;
        const offsets = new Uint32Array([99, 16, 32]);
        state.beginPass(fake.pass);

        state.setBindGroup(0, bindGroup, offsets, 1, 2);
        state.setBindGroup(0, bindGroup, new Uint32Array([99, 16, 32]), 1, 2);
        expect(fake.setBindGroup).toHaveBeenCalledOnce();

        offsets[2] = 64;
        state.setBindGroup(0, bindGroup, offsets, 1, 2);
        expect(fake.setBindGroup).toHaveBeenCalledTimes(2);

        state.setBindGroup(0, bindGroup, [16, 64]);
        expect(fake.setBindGroup).toHaveBeenCalledTimes(2);
    });

    it('resets every cached command at each logical render pass boundary', () => {
        const fake = createFakeRenderPass();
        const nextFake = createFakeRenderPass();
        const state = new WebGPUCommandState();
        const pipeline = {} as GPURenderPipeline;
        const bindGroup = {} as GPUBindGroup;
        const vertexBuffer = {} as GPUBuffer;
        const indexBuffer = {} as GPUBuffer;
        const recordState = () => {
            state.setPipeline(pipeline);
            state.setBindGroup(0, bindGroup);
            state.setVertexBuffer(0, vertexBuffer);
            state.setIndexBuffer(indexBuffer, 'uint16');
            state.setViewport(0, 0, 16, 16, 0, 1);
            state.setStencilReference(3);
        };

        state.beginPass(fake.pass);
        recordState();
        state.beginPass(fake.pass);
        recordState();

        expect(fake.setPipeline).toHaveBeenCalledTimes(2);
        expect(fake.setBindGroup).toHaveBeenCalledTimes(2);
        expect(fake.setVertexBuffer).toHaveBeenCalledTimes(2);
        expect(fake.setIndexBuffer).toHaveBeenCalledTimes(2);
        expect(fake.setViewport).toHaveBeenCalledTimes(2);
        expect(fake.setStencilReference).toHaveBeenCalledTimes(2);

        state.endPass();
        expect(() => {
            state.setPipeline(pipeline);
        }).toThrow(/active render pass/);

        state.beginPass(nextFake.pass);
        recordState();
        expect(nextFake.setPipeline).toHaveBeenCalledOnce();
        expect(nextFake.setBindGroup).toHaveBeenCalledOnce();
        expect(nextFake.setVertexBuffer).toHaveBeenCalledOnce();
        expect(nextFake.setIndexBuffer).toHaveBeenCalledOnce();
        expect(nextFake.setViewport).toHaveBeenCalledOnce();
        expect(nextFake.setStencilReference).toHaveBeenCalledOnce();
    });

    it('deduplicates state through WebGPUDriver.encodeDraw but preserves every draw', () => {
        const fake = createFakeRenderPass();
        const renderer = Object.create(WebGPUDriver.prototype) as WebGPUDriver;
        const pipeline = {} as GPURenderPipeline;
        const bindGroup = {} as GPUBindGroup;
        const vertexBuffer = {} as GPUBuffer;
        const indexBuffer = {} as GPUBuffer;
        Reflect.set(renderer, 'commandState', new WebGPUCommandState());
        Reflect.set(renderer, 'activeViewport', [1, 2, 320, 240]);
        Reflect.set(renderer, 'activePass', fake.pass);
        const encodeDraw = Reflect.get(renderer, 'encodeDraw') as (setup: {
            readonly pipeline: GPURenderPipeline;
            readonly renderState: {
                readonly usesStencil: boolean;
                readonly dynamic: {
                    readonly depthRange: readonly [number, number];
                    readonly stencilReference: number;
                };
            };
            readonly vertexBuffers: readonly { readonly buffer: GPUBuffer }[];
            readonly indexBuffer: {
                readonly buffer: GPUBuffer;
                readonly format: GPUIndexFormat;
            };
            readonly bindGroups: readonly GPUBindGroup[];
            readonly vertexCount: number;
            readonly instanceCount: number;
        }) => void;
        const setup = {
            pipeline,
            renderState: {
                usesStencil: true,
                dynamic: { depthRange: [0.25, 0.75] as const, stencilReference: 5 }
            },
            vertexBuffers: [{ buffer: vertexBuffer }],
            indexBuffer: { buffer: indexBuffer, format: 'uint16' as const },
            bindGroups: [bindGroup],
            vertexCount: 3,
            instanceCount: 1
        };

        encodeDraw.call(renderer, setup);
        encodeDraw.call(renderer, setup);

        expect(fake.setPipeline).toHaveBeenCalledOnce();
        expect(fake.setBindGroup).toHaveBeenCalledOnce();
        expect(fake.setVertexBuffer).toHaveBeenCalledOnce();
        expect(fake.setIndexBuffer).toHaveBeenCalledOnce();
        expect(fake.setViewport).toHaveBeenCalledOnce();
        expect(fake.setStencilReference).toHaveBeenCalledOnce();
        expect(fake.drawIndexed).toHaveBeenCalledTimes(2);

        Reflect.set(renderer, 'activePass', null);
        Reflect.set(renderer, 'activePass', fake.pass);
        encodeDraw.call(renderer, setup);

        expect(fake.setPipeline).toHaveBeenCalledTimes(2);
        expect(fake.setBindGroup).toHaveBeenCalledTimes(2);
        expect(fake.setVertexBuffer).toHaveBeenCalledTimes(2);
        expect(fake.setIndexBuffer).toHaveBeenCalledTimes(2);
        expect(fake.setViewport).toHaveBeenCalledTimes(2);
        expect(fake.setStencilReference).toHaveBeenCalledTimes(2);
        expect(fake.drawIndexed).toHaveBeenCalledTimes(3);
    });
});
