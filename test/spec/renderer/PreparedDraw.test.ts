import {
    PreparedDraw,
    PreparedDrawCache,
    type PreparedDrawRevision
} from '../../../src/render/renderer/PreparedDraw';
import {
    RHIBufferUsage,
    RHITextureUsage,
    type RHICommandContext,
    type RHIDrawArgumentsRecord,
    type RHIGraphicsPipeline,
    type RHIIndexBufferBindingRecord,
    type RHIRenderPassEncoder,
    type RHIViewport,
    type RHIVertexBufferBindingRecord
} from '../../../src/render/rhi/core';
import { describe, expect, it, vi } from 'vitest';
import { FakeWebGLRHIBackend, type FakeRHIDevice } from '../rhi/portable/FakeRHIBackend';

function revision(overrides: Partial<PreparedDrawRevision> = {}): PreparedDrawRevision {
    return {
        geometry: 1,
        materialVariant: 1,
        renderState: 1,
        resourceBindings: 1,
        target: 1,
        deviceGeneration: 1,
        ...overrides
    };
}

function pipeline(
    device: FakeRHIDevice,
    format: 'rgba8unorm' | 'rgba16float' = 'rgba8unorm'
): RHIGraphicsPipeline {
    const vertex = device.createShader({
        artifact: {
            backend: 'webgl2',
            stage: 'vertex',
            code: '#version 300 es\nvoid main() { gl_Position = vec4(0.0); }',
            entryPoint: 'main',
            reflection: { bindings: [], vertexInputs: [] },
            cacheKey: 1
        }
    });
    const fragment = device.createShader({
        artifact: {
            backend: 'webgl2',
            stage: 'fragment',
            code: '#version 300 es\nout vec4 color; void main() { color = vec4(1.0); }',
            entryPoint: 'main',
            reflection: { bindings: [], fragmentOutputs: [{ location: 0 }] },
            cacheKey: 2
        }
    });
    return device.createGraphicsPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [] }),
        vertex: { shader: vertex, buffers: [] },
        fragment: { shader: fragment, targets: [{ format }] },
        primitive: {}
    });
}

function beginPass(device: FakeRHIDevice): {
    readonly context: RHICommandContext;
    readonly pass: RHIRenderPassEncoder;
} {
    const texture = device.createTexture({
        size: { width: 4, height: 4 },
        format: 'rgba8unorm',
        usage: RHITextureUsage.RENDER_ATTACHMENT
    });
    const context = device.graphicsQueue.beginFrame();
    const pass = context.beginRenderPass({
        colorAttachments: [
            {
                view: texture.createView(),
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: 0, g: 0, b: 0, a: 1 }
            }
        ]
    });
    return { context, pass };
}

describe('PreparedDrawCache', () => {
    it('reuses a sealed record until an explicit revision changes', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graphicsPipeline = pipeline(device);
        const cache = new PreparedDrawCache<object>(4, 8);
        const key = {};
        const update = vi.fn((draw: PreparedDraw) => {
            draw.setPipeline(graphicsPipeline);
            draw.setDraw(3);
            draw.setSortKey(10, 20);
        });

        const first = cache.prepare(key, revision(), update);
        const second = cache.prepare(key, revision(), update);
        expect(second).toBe(first);
        expect(update).toHaveBeenCalledTimes(1);
        expect(first.sortKeyHigh).toBe(10);
        expect(first.sortKeyLow).toBe(20);

        const third = cache.prepare(key, revision({ resourceBindings: 2 }), update);
        expect(third).toBe(first);
        expect(update).toHaveBeenCalledTimes(2);
        expect(cache.metrics).toMatchObject({
            hits: 1,
            misses: 2,
            evictions: 1,
            size: 1,
            highWater: 1
        });
        expect(() => {
            first.setDraw(6);
        }).toThrow(/sealed/u);
        expect(cache.delete(key)).toBe(true);
        expect(cache.delete(key)).toBe(false);
        expect(cache.metrics).toMatchObject({ evictions: 2, size: 0, highWater: 1 });
        backend.destroy();
    });

    it('issues a prepared non-indexed draw without rebuilding in the draw loop', async () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graphicsPipeline = pipeline(device);
        const cache = new PreparedDrawCache<object>(4, 8);
        const prepared = cache.prepare({}, revision(), draw => {
            draw.setPipeline(graphicsPipeline);
            draw.setDraw(3, 2, 1, 0);
        });
        const { context, pass } = beginPass(device);
        const drawRecords: Readonly<RHIDrawArgumentsRecord>[] = [];
        const applyDrawRecord = pass.drawRecord.bind(pass);
        vi.spyOn(pass, 'drawRecord').mockImplementation(record => {
            drawRecords.push(record);
            applyDrawRecord(record);
        });

        prepared.execute(pass);
        prepared.execute(pass);
        expect(drawRecords).toHaveLength(2);
        expect(drawRecords[0]).toBe(drawRecords[1]);
        expect(drawRecords[0]).toMatchObject({
            elementCount: 3,
            instanceCount: 2,
            firstElement: 1,
            baseVertex: 0,
            firstInstance: 0
        });
        pass.end();
        const submission = device.graphicsQueue.endFrame(context);
        await submission.done;
        expect(backend.executionLog).toContain('draw:3');
        backend.destroy();
    });

    it('applies per-draw depth range and stencil reference without allocating command objects', async () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graphicsPipeline = pipeline(device);
        const cache = new PreparedDrawCache<object>(4, 8);
        const prepared = cache.prepare({}, revision(), draw => {
            draw.setPipeline(graphicsPipeline);
            draw.setDynamicState({
                minDepth: 0.2,
                maxDepth: 0.8,
                stencilReference: 19,
                usesStencil: true
            });
            draw.setDraw(3);
        });
        const defaultDepth = cache.prepare({}, revision({ target: 2 }), draw => {
            draw.setPipeline(graphicsPipeline);
            draw.setDraw(3);
        });
        const { context, pass } = beginPass(device);
        const scalarViewport = vi.spyOn(pass, 'setViewport');
        const viewportRecords: Readonly<RHIViewport>[] = [];
        const viewportSnapshots: RHIViewport[] = [];
        const applyViewportRecord = pass.setViewportRecord.bind(pass);
        const setViewportRecord = vi
            .spyOn(pass, 'setViewportRecord')
            .mockImplementation(viewport => {
                viewportRecords.push(viewport);
                viewportSnapshots.push({ ...viewport });
                applyViewportRecord(viewport);
            });
        const setStencilReference = vi.spyOn(pass, 'setStencilReference');
        const viewport = { x: 3, y: 4, width: 5, height: 6 };
        const viewportState = { minDepth: 0, maxDepth: 1 };

        prepared.execute(pass, viewport, viewportState);
        prepared.execute(pass, viewport, viewportState);
        viewportState.minDepth = 0;
        viewportState.maxDepth = 1;
        prepared.execute(pass, viewport, viewportState);
        defaultDepth.execute(pass, viewport, viewportState);

        expect(setViewportRecord).toHaveBeenCalledTimes(3);
        expect(viewportRecords[0]).toBe(viewportRecords[1]);
        expect(viewportRecords[2]).not.toBe(viewportRecords[0]);
        expect(viewportSnapshots).toEqual([
            { x: 3, y: 4, width: 5, height: 6, minDepth: 0.2, maxDepth: 0.8 },
            { x: 3, y: 4, width: 5, height: 6, minDepth: 0.2, maxDepth: 0.8 },
            { x: 3, y: 4, width: 5, height: 6, minDepth: 0, maxDepth: 1 }
        ]);
        expect(scalarViewport).not.toHaveBeenCalled();
        expect(viewportState).toEqual({ minDepth: 0, maxDepth: 1 });
        expect(setStencilReference).toHaveBeenCalledWith(19);
        pass.end();
        await device.graphicsQueue.endFrame(context).done;
        backend.destroy();
    });

    it('encodes indexed arguments and requires a complete update before sealing', async () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graphicsPipeline = pipeline(device);
        const indexBuffer = device.createBuffer({
            size: 12,
            usage: RHIBufferUsage.INDEX
        });
        const cache = new PreparedDrawCache<object>(4, 8);
        expect(() => cache.prepare({}, revision(), () => undefined)).toThrow(/pipeline/u);

        const prepared = cache.prepare({}, revision(), draw => {
            draw.setPipeline(graphicsPipeline);
            draw.setIndexBuffer(indexBuffer, 'uint16', 0, 12);
            draw.setDrawIndexed(6, 1, 0, 0, 0);
        });
        const { context, pass } = beginPass(device);
        prepared.execute(pass);
        pass.end();
        const submission = device.graphicsQueue.endFrame(context);
        await submission.done;
        expect(backend.executionLog).toContain('draw-indexed:6');
        backend.destroy();
    });

    it('copies every execute-time field into an independent deferred pass snapshot', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const firstPipeline = pipeline(device, 'rgba8unorm');
        const secondPipeline = pipeline(device, 'rgba16float');
        const layout = device.createBindGroupLayout({ entries: [] });
        const firstGroup = device.createBindGroup({ layout, entries: [] });
        const secondGroup = device.createBindGroup({ layout, entries: [] });
        const firstVertex = device.createBuffer({ size: 16, usage: RHIBufferUsage.VERTEX });
        const secondVertex = device.createBuffer({ size: 32, usage: RHIBufferUsage.VERTEX });
        const firstIndex = device.createBuffer({ size: 24, usage: RHIBufferUsage.INDEX });
        const secondIndex = device.createBuffer({ size: 36, usage: RHIBufferUsage.INDEX });
        const firstOffsets = new Uint32Array([4]);
        const secondOffsets = new Uint32Array([12]);
        const cache = new PreparedDrawCache<object>(1, 1);
        const key = {};
        const source = cache.prepare(key, revision(), draw => {
            draw.setPipeline(firstPipeline);
            draw.setBindGroup(0, firstGroup, firstOffsets);
            draw.setVertexBuffer(0, firstVertex, 4, 12);
            draw.setIndexBuffer(firstIndex, 'uint16', 2, 20);
            draw.setDrawIndexed(6, 2, 1, 3, 4);
            draw.setDynamicState({
                minDepth: 0.2,
                maxDepth: 0.8,
                stencilReference: 7,
                usesStencil: true
            });
            draw.setSortKey(10, 20);
        });
        const snapshot = new PreparedDraw(1, 1);
        snapshot.copyFrom(source);

        cache.prepare(key, revision({ resourceBindings: 2, target: 2 }), draw => {
            draw.setPipeline(secondPipeline);
            draw.setBindGroup(0, secondGroup, secondOffsets);
            draw.setVertexBuffer(0, secondVertex, 8, 24);
            draw.setIndexBuffer(secondIndex, 'uint32', 4, 32);
            draw.setDrawIndexed(9, 3, 2, 5, 6);
            draw.setDynamicState({
                minDepth: 0,
                maxDepth: 1,
                stencilReference: 13,
                usesStencil: true
            });
            draw.setSortKey(30, 40);
        });

        const setPipeline = vi.fn();
        const setBindGroup = vi.fn();
        const setVertexBuffer = vi.fn();
        const setIndexBuffer = vi.fn();
        const drawIndexed = vi.fn();
        const vertexBufferRecords: Readonly<RHIVertexBufferBindingRecord>[] = [];
        const indexBufferRecords: Readonly<RHIIndexBufferBindingRecord>[] = [];
        const drawIndexedRecords: Readonly<RHIDrawArgumentsRecord>[] = [];
        const vertexBufferSnapshots: RHIVertexBufferBindingRecord[] = [];
        const indexBufferSnapshots: RHIIndexBufferBindingRecord[] = [];
        const drawIndexedSnapshots: RHIDrawArgumentsRecord[] = [];
        const setVertexBufferRecord = vi.fn((record: Readonly<RHIVertexBufferBindingRecord>) => {
            vertexBufferRecords.push(record);
            vertexBufferSnapshots.push({ ...record });
        });
        const setIndexBufferRecord = vi.fn((record: Readonly<RHIIndexBufferBindingRecord>) => {
            indexBufferRecords.push(record);
            indexBufferSnapshots.push({ ...record });
        });
        const drawIndexedRecord = vi.fn((record: Readonly<RHIDrawArgumentsRecord>) => {
            drawIndexedRecords.push(record);
            drawIndexedSnapshots.push({ ...record });
        });
        const setViewportRecord = vi.fn();
        const setStencilReference = vi.fn();
        const pass = {
            setPipeline,
            setBindGroup,
            setVertexBuffer,
            setVertexBufferRecord,
            setIndexBuffer,
            setIndexBufferRecord,
            setViewportRecord,
            setStencilReference,
            drawIndexed,
            drawIndexedRecord
        } as unknown as RHIRenderPassEncoder;
        snapshot.execute(pass, { x: 3, y: 4, width: 5, height: 6 });
        snapshot.execute(pass, { x: 3, y: 4, width: 5, height: 6 });
        snapshot.execute(pass, { x: 3, y: 4, width: 5, height: 6 }, undefined, snapshot);

        expect(snapshot.pipeline.descriptor.fragment?.targets[0]?.format).toBe('rgba8unorm');
        expect(setPipeline).toHaveBeenCalledWith(firstPipeline);
        expect(setBindGroup).toHaveBeenCalledWith(0, firstGroup, firstOffsets);
        expect(setVertexBuffer).not.toHaveBeenCalled();
        expect(setIndexBuffer).not.toHaveBeenCalled();
        expect(drawIndexed).not.toHaveBeenCalled();
        expect(vertexBufferRecords).toHaveLength(2);
        expect(indexBufferRecords).toHaveLength(2);
        expect(drawIndexedRecords).toHaveLength(3);
        expect(vertexBufferRecords[0]).toBe(vertexBufferRecords[1]);
        expect(indexBufferRecords[0]).toBe(indexBufferRecords[1]);
        expect(drawIndexedRecords[0]).toBe(drawIndexedRecords[2]);
        expect(vertexBufferSnapshots).toEqual([
            { slot: 0, buffer: firstVertex, offset: 4, size: 12 },
            { slot: 0, buffer: firstVertex, offset: 4, size: 12 }
        ]);
        expect(indexBufferSnapshots).toEqual([
            { buffer: firstIndex, format: 'uint16', offset: 2, size: 20 },
            { buffer: firstIndex, format: 'uint16', offset: 2, size: 20 }
        ]);
        expect(drawIndexedSnapshots).toEqual([
            {
                elementCount: 6,
                instanceCount: 2,
                firstElement: 1,
                baseVertex: 3,
                firstInstance: 4
            },
            {
                elementCount: 6,
                instanceCount: 2,
                firstElement: 1,
                baseVertex: 3,
                firstInstance: 4
            },
            {
                elementCount: 6,
                instanceCount: 2,
                firstElement: 1,
                baseVertex: 3,
                firstInstance: 4
            }
        ]);
        expect(setViewportRecord).toHaveBeenCalledWith({
            x: 3,
            y: 4,
            width: 5,
            height: 6,
            minDepth: 0.2,
            maxDepth: 0.8
        });
        expect(setStencilReference).toHaveBeenCalledWith(7);
        expect(snapshot.sortKeyHigh).toBe(10);
        expect(snapshot.sortKeyLow).toBe(20);
        expect(setBindGroup).not.toHaveBeenCalledWith(0, secondGroup, secondOffsets);
        backend.destroy();
    });
});
