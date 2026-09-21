import { describe, expect, it, vi } from 'vitest';
import { RenderGraph } from '../../../src/render/graph/RenderGraph';
import type { CompiledRenderGraph } from '../../../src/render/graph/RenderGraphCompiler';
import { TRANSIENT_RESOURCE_POOL_LIMITS } from '../../../src/render/graph/RenderGraphTransientResourcePool';
import {
    RHIBufferUsage,
    RHITextureUsage,
    type RHIDevice,
    type RHITexture,
    type RHIBuffer,
    type RHITextureDescriptor
} from '../../../src/render/rhi/core';
import { FakeWebGLRHIBackend, FakeWebGPURHIBackend } from '../rhi/portable/FakeRHIBackend';

function textureGraph(
    graph: RenderGraph,
    device: RHIDevice,
    descriptor: RHITextureDescriptor
): CompiledRenderGraph {
    const builder = graph.createBuilder();
    const texture = builder.createTexture('transient color', descriptor);
    builder.addPass(
        {
            name: 'write transient color',
            setup(pass) {
                pass.writeTexture(texture);
            },
            execute(context) {
                void context;
            }
        },
        undefined
    );
    builder.markOutput(texture);
    return graph.compile(builder, device.capabilities);
}

function colorDescriptor(width: number): RHITextureDescriptor {
    return {
        size: { width, height: 1 },
        format: 'rgba8unorm',
        usage: RHITextureUsage.RENDER_ATTACHMENT
    };
}

describe('Render Graph transient retention', () => {
    it('bounds historical texture and buffer descriptors after completed frames', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const textures = vi.spyOn(device, 'createTexture');
        const buffers = vi.spyOn(device, 'createBuffer');
        const count = TRANSIENT_RESOURCE_POOL_LIMITS.maxIdleEntries + 32;
        for (let index = 1; index <= count; index += 1) {
            const builder = graph.createBuilder();
            const texture = builder.createTexture('changing size', colorDescriptor(index));
            const buffer = builder.createBuffer('changing buffer', {
                size: index * 4,
                usage: RHIBufferUsage.COPY_DST
            });
            builder.addPass(
                {
                    name: 'write changing resources',
                    setup(pass) {
                        pass.writeTexture(texture);
                        pass.writeBuffer(buffer, 'copy-destination');
                        pass.markSideEffect();
                    },
                    execute(context) {
                        void context;
                    }
                },
                undefined
            );
            graph.execute(graph.compile(builder, device.capabilities), device);
        }
        const resources = [
            ...textures.mock.results.map(result => result.value as RHITexture),
            ...buffers.mock.results.map(result => result.value as RHIBuffer)
        ];
        expect(resources.filter(resource => !resource.destroyed)).toHaveLength(
            TRANSIENT_RESOURCE_POOL_LIMITS.maxIdleEntries
        );
        expect((textures.mock.results[0]?.value as RHITexture | undefined)?.destroyed).toBe(true);
        expect((buffers.mock.results[0]?.value as RHIBuffer | undefined)?.destroyed).toBe(true);
        graph.destroy();
        expect(resources.every(resource => resource.destroyed)).toBe(true);
        backend.destroy();
    });

    it('evicts old idle dimensions while continuously reusing a fixed working set', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const textures = vi.spyOn(device, 'createTexture');
        graph.execute(textureGraph(graph, device, colorDescriptor(1)), device);
        const current = textureGraph(graph, device, colorDescriptor(2));
        for (let frame = 0; frame <= TRANSIENT_RESOURCE_POOL_LIMITS.maxIdleFrames; frame += 1) {
            const result = graph.execute(current, device);
            if (frame > 0) expect(result.diagnostics.transientAllocations).toBe(0);
        }
        expect(textures).toHaveBeenCalledTimes(2);
        expect((textures.mock.results[0]?.value as RHITexture | undefined)?.destroyed).toBe(true);
        expect((textures.mock.results[1]?.value as RHITexture | undefined)?.destroyed).toBe(false);
        graph.destroy();
        backend.destroy();
    });

    it.each<RHITextureDescriptor>([
        {
            size: { width: 8192, height: 8192 },
            format: 'rgba8unorm',
            mipLevelCount: 2,
            usage: RHITextureUsage.RENDER_ATTACHMENT
        },
        {
            size: { width: 4096, height: 4096, depthOrArrayLayers: 5 },
            viewDimension: '2d-array',
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        },
        {
            size: { width: 4096, height: 4096 },
            format: 'rgba16float',
            sampleCount: 4,
            usage: RHITextureUsage.RENDER_ATTACHMENT
        }
    ])('includes mip levels, array layers, and samples in the retention budget: %o', descriptor => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const textures = vi.spyOn(device, 'createTexture');
        graph.execute(textureGraph(graph, device, descriptor), device);
        expect((textures.mock.results[0]?.value as RHITexture | undefined)?.destroyed).toBe(true);
        graph.destroy();
        backend.destroy();
    });

    it('never evicts an over-budget texture until its submission has completed', async () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const textures = vi.spyOn(device, 'createTexture');
        const huge = textureGraph(graph, device, {
            size: { width: 8192, height: 8192 },
            format: 'rgba16float',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const result = graph.execute(huge, device);
        expect((textures.mock.results[0]?.value as RHITexture | undefined)?.destroyed).toBe(false);
        backend.completeNextSubmission();
        await result.submission.done;
        expect((textures.mock.results[0]?.value as RHITexture | undefined)?.destroyed).toBe(true);
        graph.destroy();
        backend.destroy();
    });
});
