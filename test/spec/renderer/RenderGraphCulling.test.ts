import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RenderGraph } from '../../../src/render/graph/RenderGraph';
import type {
    RGPassBuilder,
    RenderGraphBuilder
} from '../../../src/render/graph/RenderGraphBuilder';
import type {
    RGPassHandle,
    RGTextureAccessHandle
} from '../../../src/render/graph/RenderGraphResource';
import { RHIBufferUsage, RHITextureUsage, type RHIDevice } from '../../../src/render/rhi/core';
import { FakeWebGPURHIBackend } from '../rhi/portable/FakeRHIBackend';

function addPass(
    builder: RenderGraphBuilder,
    name: string,
    setup: (pass: RGPassBuilder) => void
): RGPassHandle {
    return builder.addPass(
        {
            name,
            setup,
            execute(context): void {
                void context;
            }
        },
        undefined
    );
}

function colorWrite(
    pass: RGPassBuilder,
    texture: RGTextureAccessHandle,
    loadOp: 'clear' | 'load' = 'clear',
    storeOp: 'store' | 'discard' = 'store'
): void {
    pass.useColorAttachment({
        texture,
        loadOp,
        storeOp,
        ...(loadOp === 'clear' ? { clearValue: { r: 0, g: 0, b: 0, a: 1 } } : {})
    });
}

const COLOR_DESCRIPTOR = {
    size: { width: 4, height: 4 },
    format: 'rgba8unorm' as const,
    usage: RHITextureUsage.RENDER_ATTACHMENT | RHITextureUsage.TEXTURE_BINDING
};

describe('RenderGraph content liveness', () => {
    let graph: RenderGraph;
    let backend: FakeWebGPURHIBackend;
    let device: RHIDevice;

    beforeEach(() => {
        graph = new RenderGraph();
        backend = new FakeWebGPURHIBackend();
        device = backend.createDevice();
    });

    afterEach(() => {
        graph.destroy();
        backend.destroy();
    });

    it('culls an unused reader and an overwritten producer before a full attachment clear', () => {
        const builder = graph.createBuilder();
        const color = builder.createTexture('color', COLOR_DESCRIPTOR);
        addPass(builder, 'old color', pass => {
            colorWrite(pass, color);
        });
        addPass(builder, 'unused reader', pass => pass.readTexture(color));
        addPass(builder, 'replacement color', pass => {
            colorWrite(pass, color);
        });
        builder.markOutput(color);

        const compiled = graph.compile(builder, device.capabilities);

        expect(compiled.passes.map(pass => pass.name)).toEqual(['replacement color']);
        expect(compiled.resourceByHandle.get(color)).toMatchObject({
            lifetime: { firstUse: 0, lastUse: 0 },
            writtenByGraph: true,
            initializedAfterExecution: true
        });
        expect(backend.executeCount).toBe(0);
    });

    it('retains RAW and WAR order when the reader has a real side effect', () => {
        const builder = graph.createBuilder();
        const color = builder.createTexture('color', COLOR_DESCRIPTOR);
        addPass(builder, 'old color', pass => {
            colorWrite(pass, color);
        });
        addPass(builder, 'readback', pass => {
            pass.readTexture(color);
            pass.markSideEffect();
        });
        addPass(builder, 'replacement color', pass => {
            colorWrite(pass, color);
        });
        builder.markOutput(color);

        expect(graph.compile(builder, device.capabilities).passes.map(pass => pass.name)).toEqual([
            'old color',
            'readback',
            'replacement color'
        ]);
    });

    it('retains attachment load chains used for partial raster updates', () => {
        const builder = graph.createBuilder();
        const color = builder.createTexture('atlas', COLOR_DESCRIPTOR);
        addPass(builder, 'atlas clear', pass => {
            colorWrite(pass, color);
        });
        addPass(builder, 'first page update', pass => {
            colorWrite(pass, color, 'load');
        });
        addPass(builder, 'unused reader', pass => pass.readTexture(color));
        addPass(builder, 'second page update', pass => {
            colorWrite(pass, color, 'load');
        });
        builder.markOutput(color);

        expect(graph.compile(builder, device.capabilities).passes.map(pass => pass.name)).toEqual([
            'atlas clear',
            'first page update',
            'second page update'
        ]);
    });

    it('keeps explicit dependencies even when a write fully replaces their contents', () => {
        const builder = graph.createBuilder();
        const color = builder.createTexture('color', COLOR_DESCRIPTOR);
        const original = addPass(builder, 'explicit prerequisite', pass => {
            colorWrite(pass, color);
        });
        const replacement = addPass(builder, 'replacement', pass => {
            colorWrite(pass, color);
        });
        builder.addDependency(original, replacement);
        builder.markOutput(color);

        expect(graph.compile(builder, device.capabilities).passes.map(pass => pass.name)).toEqual([
            'explicit prerequisite',
            'replacement'
        ]);
    });

    it('retains only the complete write consumed by a storage read-write update', () => {
        const builder = graph.createBuilder();
        const buffer = builder.createBuffer('particles', {
            size: 16,
            usage: RHIBufferUsage.STORAGE
        });
        addPass(builder, 'obsolete write', pass => pass.writeBuffer(buffer, 'storage'));
        addPass(builder, 'unused reader', pass => pass.readBuffer(buffer, 'storage'));
        addPass(builder, 'initialize', pass => pass.writeBuffer(buffer, 'storage'));
        addPass(builder, 'integrate', pass => pass.readWriteBuffer(buffer, 'storage'));
        builder.markOutput(buffer);

        expect(graph.compile(builder, device.capabilities).passes.map(pass => pass.name)).toEqual([
            'initialize',
            'integrate'
        ]);
    });

    it('preserves preceding contents for repeated partial copy-destination updates', () => {
        const builder = graph.createBuilder();
        const buffer = builder.createBuffer('clear destination', {
            size: 16,
            usage: RHIBufferUsage.COPY_DST
        });
        addPass(builder, 'initialize', pass => pass.writeBuffer(buffer, 'copy-destination'));
        addPass(builder, 'partial clears', pass => {
            pass.readWriteBuffer(buffer, 'copy-destination');
            pass.readWriteBuffer(buffer, 'copy-destination');
        });
        builder.markOutput(buffer);

        const compiled = graph.compile(builder, device.capabilities);
        expect(compiled.passes.map(pass => pass.name)).toEqual(['initialize', 'partial clears']);
        expect(compiled.passes[1]?.bufferAccesses).toEqual([
            { buffer, mode: 'read-write', use: 'copy-destination' }
        ]);
        expect(compiled.resourceByHandle.get(buffer)?.descriptor.usage).toBe(
            RHIBufferUsage.COPY_DST
        );
    });

    it.each([true, false])('permits mixed full/partial clears with full-first=%s', fullFirst => {
        const builder = graph.createBuilder();
        const buffer = builder.createBuffer('clear destination', {
            size: 16,
            usage: RHIBufferUsage.COPY_DST
        });
        addPass(builder, 'initialize', pass => pass.writeBuffer(buffer, 'copy-destination'));
        addPass(builder, 'mixed clears', pass => {
            if (fullFirst) pass.writeBuffer(buffer, 'copy-destination');
            pass.readWriteBuffer(buffer, 'copy-destination');
            pass.writeBuffer(buffer, 'copy-destination');
            pass.readWriteBuffer(buffer, 'copy-destination');
        });
        builder.markOutput(buffer);

        const compiled = graph.compile(builder, device.capabilities);
        expect(compiled.passes.map(pass => pass.name)).toEqual(
            fullFirst ? ['mixed clears'] : ['initialize', 'mixed clears']
        );
    });

    it('rejects a preserving update of uninitialized buffer contents', () => {
        const builder = graph.createBuilder();
        const buffer = builder.createBuffer('uninitialized', {
            size: 16,
            usage: RHIBufferUsage.COPY_DST
        });
        addPass(builder, 'partial update', pass =>
            pass.readWriteBuffer(buffer, 'copy-destination')
        );
        builder.markOutput(buffer);

        expect(() => graph.compile(builder, device.capabilities)).toThrow(
            expect.objectContaining({ code: 'uninitialized-read' })
        );
    });

    it.each([true, false])('tracks full-parent versus single-mip output with parent=%s', parent => {
        const builder = graph.createBuilder();
        const texture = builder.createTexture('mipmapped', {
            ...COLOR_DESCRIPTOR,
            mipLevelCount: 2
        });
        const mip = builder.createTextureView('first mip', texture, {
            baseMipLevel: 0,
            mipLevelCount: 1
        });
        addPass(builder, 'initialize all mips', pass => pass.writeTexture(texture));
        addPass(builder, 'replace first mip', pass => {
            colorWrite(pass, mip);
        });
        builder.markOutput(parent ? texture : mip);

        const compiled = graph.compile(builder, device.capabilities);
        expect(compiled.passes.map(pass => pass.name)).toEqual(
            parent ? ['initialize all mips', 'replace first mip'] : ['replace first mip']
        );
        expect(compiled.resourceByHandle.get(mip)?.initializedAfterExecution).toBe(true);
        expect(compiled.resourceByHandle.get(texture)?.initializedAfterExecution).toBe(parent);
    });

    it('retains stencil contents independently of an overwritten depth aspect', () => {
        const builder = graph.createBuilder();
        const texture = builder.createTexture('depth stencil', {
            ...COLOR_DESCRIPTOR,
            format: 'depth24plus-stencil8'
        });
        const depth = builder.createTextureView('depth', texture, { aspect: 'depth-only' });
        const stencil = builder.createTextureView('stencil', texture, { aspect: 'stencil-only' });
        addPass(builder, 'initialize both', pass => {
            pass.useDepthStencilAttachment({
                texture,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
                depthClearValue: 1,
                stencilLoadOp: 'clear',
                stencilStoreOp: 'store',
                stencilClearValue: 0
            });
        });
        addPass(builder, 'replace depth', pass => {
            pass.useDepthStencilAttachment({
                texture: depth,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
                depthClearValue: 1
            });
        });
        addPass(builder, 'load stencil', pass => {
            pass.useDepthStencilAttachment({
                texture: stencil,
                stencilLoadOp: 'load',
                stencilStoreOp: 'store'
            });
        });
        builder.markOutput(texture);

        expect(graph.compile(builder, device.capabilities).passes.map(pass => pass.name)).toEqual([
            'initialize both',
            'replace depth',
            'load stencil'
        ]);
    });

    it('resolves a last-writer import to its surviving clear/load chain even for an early reader', () => {
        const builder = graph.createBuilder();
        const imported = device.createTexture({ ...COLOR_DESCRIPTOR, lifetime: 'persistent' });
        const color = builder.importTexture('imported color', imported, false);
        builder.readTextureFromLastGraphWriter(color);
        addPass(builder, 'consume completed color', pass => {
            pass.readTexture(color);
            pass.markSideEffect();
        });
        addPass(builder, 'obsolete clear', pass => {
            colorWrite(pass, color);
        });
        addPass(builder, 'replacement clear', pass => {
            colorWrite(pass, color);
        });
        addPass(builder, 'overlay', pass => {
            colorWrite(pass, color, 'load');
        });

        const compiled = graph.compile(builder, device.capabilities);
        expect(compiled.passes.map(pass => pass.name)).toEqual([
            'replacement clear',
            'overlay',
            'consume completed color'
        ]);
        expect(compiled.resourceByHandle.get(color)?.initializedAfterExecution).toBe(true);
        imported.destroy();
    });

    it('computes final availability from live passes and ignores a culled discard', () => {
        const builder = graph.createBuilder();
        const color = builder.createTexture('color', COLOR_DESCRIPTOR);
        addPass(builder, 'live clear', pass => {
            colorWrite(pass, color);
            pass.markSideEffect();
        });
        addPass(builder, 'dead discard', pass => {
            colorWrite(pass, color, 'clear', 'discard');
        });

        const compiled = graph.compile(builder, device.capabilities);
        expect(compiled.passes.map(pass => pass.name)).toEqual(['live clear']);
        expect(compiled.resourceByHandle.get(color)).toMatchObject({
            writtenByGraph: true,
            initializedAfterExecution: true
        });
    });

    it('reports a live discard as written but not initialized', () => {
        const builder = graph.createBuilder();
        const color = builder.createTexture('color', COLOR_DESCRIPTOR);
        addPass(builder, 'discarded clear', pass => {
            colorWrite(pass, color, 'clear', 'discard');
        });
        builder.markOutput(color);

        expect(
            graph.compile(builder, device.capabilities).resourceByHandle.get(color)
        ).toMatchObject({
            writtenByGraph: true,
            initializedAfterExecution: false
        });
    });

    it('preserves independent depth and stencil store state on views and their parent', () => {
        const builder = graph.createBuilder();
        const texture = builder.createTexture('mixed history', {
            ...COLOR_DESCRIPTOR,
            format: 'depth24plus-stencil8'
        });
        const depth = builder.createTextureView('stored depth', texture, { aspect: 'depth-only' });
        const stencil = builder.createTextureView('discarded stencil', texture, {
            aspect: 'stencil-only'
        });
        addPass(builder, 'store depth', pass => {
            pass.useDepthStencilAttachment({
                texture: depth,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
                depthClearValue: 1
            });
        });
        addPass(builder, 'discard stencil', pass => {
            pass.useDepthStencilAttachment({
                texture: stencil,
                stencilLoadOp: 'clear',
                stencilStoreOp: 'discard',
                stencilClearValue: 0
            });
        });
        builder.markOutput(texture);

        const compiled = graph.compile(builder, device.capabilities);
        expect(compiled.resourceByHandle.get(depth)).toMatchObject({
            writtenByGraph: true,
            initializedAfterExecution: true
        });
        for (const handle of [stencil, texture]) {
            expect(compiled.resourceByHandle.get(handle)).toMatchObject({
                writtenByGraph: true,
                initializedAfterExecution: false
            });
        }
    });

    it('roots extracted resources at their final complete writer', () => {
        const builder = graph.createBuilder();
        const color = builder.createTexture('extracted color', COLOR_DESCRIPTOR);
        addPass(builder, 'obsolete color', pass => {
            colorWrite(pass, color);
        });
        addPass(builder, 'final color', pass => {
            colorWrite(pass, color);
        });
        builder.extractTexture(color);

        const compiled = graph.compile(builder, device.capabilities);
        expect(compiled.passes.map(pass => pass.name)).toEqual(['final color']);
        expect(compiled.resourceByHandle.get(color)).toMatchObject({
            extracted: true,
            descriptor: { lifetime: 'persistent' },
            writtenByGraph: true,
            initializedAfterExecution: true
        });
    });

    it('distinguishes imported prior contents from a write by this graph', () => {
        const builder = graph.createBuilder();
        const imported = device.createTexture({ ...COLOR_DESCRIPTOR, lifetime: 'persistent' });
        const color = builder.importTexture('imported color', imported);
        addPass(builder, 'read existing', pass => {
            pass.readTexture(color);
            pass.markSideEffect();
        });

        expect(
            graph.compile(builder, device.capabilities).resourceByHandle.get(color)
        ).toMatchObject({
            writtenByGraph: false,
            initializedAfterExecution: true
        });
        imported.destroy();
    });
});
