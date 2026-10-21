import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RenderGraph } from '../../../src/render/graph/RenderGraph';
import type {
    RGPassBuilder,
    RenderGraphBuilder
} from '../../../src/render/graph/RenderGraphBuilder';
import { RHIBufferUsage, RHITextureUsage, type RHIDevice } from '../../../src/render/rhi/core';
import { FakeWebGPURHIBackend } from '../rhi/portable/FakeRHIBackend';

function addPass(
    builder: RenderGraphBuilder,
    name: string,
    setup: (pass: RGPassBuilder) => void
): void {
    builder.addPass(
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

describe('RenderGraph compiler subresource storage', () => {
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

    it('separates array mip/layer hazards across textures and adjacent buffer resources', () => {
        const builder = graph.createBuilder();
        const buffer = builder.createBuffer('buffer', { size: 16, usage: RHIBufferUsage.STORAGE });
        const descriptor = {
            size: { width: 16, height: 16, depthOrArrayLayers: 4 },
            format: 'rgba8unorm' as const,
            mipLevelCount: 5,
            usage: RHITextureUsage.TEXTURE_BINDING | RHITextureUsage.STORAGE_BINDING
        };
        const first = builder.createTexture('first array', descriptor);
        const second = builder.createTexture('second array', descriptor);
        const firstView = builder.createTextureView('first selected', first, {
            dimension: '2d',
            baseMipLevel: 3,
            mipLevelCount: 1,
            baseArrayLayer: 2,
            arrayLayerCount: 1
        });
        const secondView = builder.createTextureView('second selected', second, {
            dimension: '2d',
            baseMipLevel: 3,
            mipLevelCount: 1,
            baseArrayLayer: 2,
            arrayLayerCount: 1
        });
        addPass(builder, 'initialize first', pass => pass.writeTexture(first));
        addPass(builder, 'replace first selection', pass => pass.writeTexture(firstView));
        addPass(builder, 'write second selection', pass => pass.writeTexture(secondView));
        addPass(builder, 'write buffer', pass => pass.writeBuffer(buffer, 'storage'));
        builder.markOutput(firstView);
        builder.markOutput(buffer);

        const compiled = graph.compile(builder, device.capabilities);
        expect(compiled.passes.map(pass => pass.name)).toEqual([
            'replace first selection',
            'write buffer'
        ]);
        expect(compiled.resourceByHandle.get(firstView)?.initializedAfterExecution).toBe(true);
        expect(compiled.resourceByHandle.get(first)?.initializedAfterExecution).toBe(false);
        expect(compiled.resourceByHandle.has(second)).toBe(false);
        expect(compiled.resourceByHandle.get(buffer)?.initializedAfterExecution).toBe(true);
    });

    it('rejects reads of an unwritten array layer even when neighboring subresources and buffers are initialized', () => {
        const builder = graph.createBuilder();
        const volume = builder.createTexture('volume', {
            dimension: '3d',
            size: { width: 8, height: 8, depthOrArrayLayers: 8 },
            format: 'rgba8unorm',
            mipLevelCount: 4,
            usage: RHITextureUsage.TEXTURE_BINDING | RHITextureUsage.STORAGE_BINDING
        });
        const array = builder.createTexture('array', {
            size: { width: 8, height: 8, depthOrArrayLayers: 3 },
            format: 'rgba8unorm',
            mipLevelCount: 4,
            usage: RHITextureUsage.TEXTURE_BINDING | RHITextureUsage.STORAGE_BINDING
        });
        const buffer = builder.createBuffer('neighbor buffer', {
            size: 16,
            usage: RHIBufferUsage.STORAGE
        });
        const written = builder.createTextureView('written layer', array, {
            dimension: '2d',
            baseMipLevel: 3,
            mipLevelCount: 1,
            baseArrayLayer: 1,
            arrayLayerCount: 1
        });
        const unwritten = builder.createTextureView('unwritten layer', array, {
            dimension: '2d',
            baseMipLevel: 3,
            mipLevelCount: 1,
            baseArrayLayer: 2,
            arrayLayerCount: 1
        });
        addPass(builder, 'initialize neighbors', pass => {
            pass.writeTexture(volume);
            pass.writeTexture(written);
            pass.writeBuffer(buffer, 'storage');
        });
        addPass(builder, 'read missing layer', pass => {
            pass.readTexture(unwritten);
            pass.markSideEffect();
        });

        expect(() => graph.compile(builder, device.capabilities)).toThrow(
            expect.objectContaining({ code: 'uninitialized-read', path: 'read missing layer' })
        );
        expect(device.graphicsQueue.state).toBe('idle');
        expect(backend.executeCount).toBe(0);
    });

    it('resets high-water hazard state after successful, smaller, failed and empty compilations', () => {
        const build = (layers: number, initialize: boolean): ReturnType<RenderGraph['compile']> => {
            const builder = graph.createBuilder();
            const texture = builder.createTexture('array', {
                size: { width: 32, height: 32, depthOrArrayLayers: layers },
                format: 'depth24plus-stencil8',
                mipLevelCount: 6,
                usage: RHITextureUsage.RENDER_ATTACHMENT | RHITextureUsage.TEXTURE_BINDING
            });
            if (initialize) addPass(builder, 'initialize', pass => pass.writeTexture(texture));
            addPass(builder, 'consume', pass => {
                pass.readTexture(texture);
                pass.markSideEffect();
            });
            return graph.compile(builder, device.capabilities);
        };
        const first = build(8, true);
        const growths = graph.storageDiagnostics.compilerStorageGrowths;
        expect(build(1, true).passes.map(pass => pass.name)).toEqual(['initialize', 'consume']);
        expect(() => build(8, false)).toThrow(
            expect.objectContaining({ code: 'uninitialized-read' })
        );
        expect(graph.compile(graph.createBuilder(), device.capabilities).passes).toEqual([]);
        const recovered = build(8, true);

        expect(graph.storageDiagnostics.compilerStorageGrowths).toBe(growths);
        expect(recovered.resources[0]?.initializedAfterExecution).toBe(true);
        expect(first.resources[0]?.initializedAfterExecution).toBe(true);
        expect(first.passes.map(pass => pass.name)).toEqual(['initialize', 'consume']);
    });
});
