import { describe, expect, it, vi } from 'vitest';
import { RenderGraph } from '../../../src/render/graph/RenderGraph';
import {
    RenderGraphBuilder,
    type RenderPassTemplate
} from '../../../src/render/graph/RenderGraphBuilder';
import { RHIBufferUsage, RHITextureUsage } from '../../../src/render/rhi/core';
import { FakeWebGLRHIBackend } from '../rhi/portable/FakeRHIBackend';

const emptyPass: RenderPassTemplate<undefined> = {
    name: 'access',
    setup(): void {
        /* Declarations are supplied by each test. */
    },
    execute(): void {
        /* This fixture tests compilation without commands. */
    }
};

describe('Render Graph imported identity', () => {
    it('retains the producer when a different import reads the same physical buffer', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const buffer = device.createBuffer({
            size: 16,
            usage: RHIBufferUsage.COPY_DST | RHIBufferUsage.COPY_SRC
        });
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const write = builder.importBuffer('writer', buffer);
        const read = builder.importBuffer('reader', buffer);
        builder.addPass(
            {
                ...emptyPass,
                name: 'write',
                setup(pass): void {
                    pass.writeBuffer(write, 'copy-destination');
                }
            },
            undefined
        );
        builder.addPass(
            {
                ...emptyPass,
                name: 'read',
                setup(pass): void {
                    pass.readBuffer(read, 'copy-source');
                    pass.markSideEffect();
                }
            },
            undefined
        );
        const compiled = graph.compile(builder, device.capabilities);
        expect(read).toBe(write);
        expect(compiled.passes.map(pass => pass.name)).toEqual(['write', 'read']);
        expect(compiled.resources).toHaveLength(1);
        const next = graph.createBuilder();
        expect(next.importBuffer('next frame', buffer)).not.toBe(read);
        next.discard();
        graph.destroy();
        backend.destroy();
    });

    it('rejects feedback disguised as two imports of the same texture', () => {
        const backend = new FakeWebGLRHIBackend();
        const texture = backend.createDevice().createTexture({
            size: { width: 2, height: 2 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING | RHITextureUsage.RENDER_ATTACHMENT
        });
        const builder = new RenderGraphBuilder();
        const first = builder.importTexture('first', texture);
        const second = builder.importTexture('second', texture);
        expect(() =>
            builder.addPass(
                {
                    ...emptyPass,
                    setup(pass): void {
                        pass.readTexture(first);
                        pass.writeTexture(second);
                    }
                },
                undefined
            )
        ).toThrow(/feedback/u);
        expect(() => builder.importTexture('contradiction', texture, false)).toThrow(
            /initialization/u
        );
        builder.discard();
        backend.destroy();
    });

    it('shares lazy imports by owner identity without acquiring culled providers', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const descriptor = {
            size: { width: 2, height: 2 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        } as const;
        const identity = {};
        const acquire = vi.fn(() => device.createTexture(descriptor));
        const first = builder.importTextureProvider(
            'first',
            descriptor,
            acquire,
            'persistent',
            true,
            identity
        );
        const second = builder.importTextureProvider(
            'second',
            { ...descriptor, label: 'other label' },
            () => acquire(),
            'persistent',
            true,
            identity
        );
        expect(second).toBe(first);
        expect(() =>
            builder.importTextureProvider(
                'conflict',
                { ...descriptor, size: { width: 4, height: 4 } },
                acquire,
                'persistent',
                true,
                identity
            )
        ).toThrow(/descriptor/u);
        expect(graph.compile(builder, device.capabilities).resources).toHaveLength(0);
        expect(acquire).not.toHaveBeenCalled();
        graph.destroy();
        backend.destroy();
    });

    it('shares buffer provider identities and rejects contradictory contracts', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const builder = new RenderGraphBuilder();
        const descriptor = { size: 16, usage: RHIBufferUsage.COPY_DST };
        const provider = (): ReturnType<typeof device.createBuffer> =>
            device.createBuffer(descriptor);
        const first = builder.importBufferProvider('first', descriptor, provider, 'persistent');
        expect(
            builder.importBufferProvider('same provider', descriptor, provider, 'persistent')
        ).toBe(first);
        expect(() =>
            builder.importBufferProvider(
                'different size',
                { ...descriptor, size: 32 },
                provider,
                'persistent'
            )
        ).toThrow(/descriptor/u);
        expect(() =>
            builder.importBufferProvider('different lifetime', descriptor, provider, 'frame')
        ).toThrow(/lifetime/u);
        expect(() =>
            builder.importBufferProvider(
                'different contents',
                descriptor,
                provider,
                'persistent',
                false
            )
        ).toThrow(/initialization/u);
        builder.discard();
        backend.destroy();
    });
});
