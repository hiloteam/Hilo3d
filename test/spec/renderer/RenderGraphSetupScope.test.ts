import { describe, expect, it } from 'vitest';
import { RenderGraph } from '../../../src/render/graph/RenderGraph';
import {
    RenderGraphBuilder,
    type RGPassBuilder,
    type RenderPassTemplate
} from '../../../src/render/graph/RenderGraphBuilder';
import { RHIBufferUsage } from '../../../src/render/rhi/core';
import { FakeWebGLRHIBackend } from '../rhi/portable/FakeRHIBackend';

const emptyPass: RenderPassTemplate<undefined> = {
    name: 'unused pass',
    setup(): void {
        // Each fixture supplies its own declarations.
    },
    execute(): void {
        // These tests inspect graph compilation without recording commands.
    }
};

describe('Render Graph setup scope', () => {
    it('invalidates a retained pass builder before recycling its pass storage', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        let retained: RGPassBuilder | undefined;
        builder.addPass(
            {
                ...emptyPass,
                setup(pass): void {
                    retained = pass;
                }
            },
            undefined
        );
        expect(() => retained?.markSideEffect()).toThrow(/only valid during setup/u);
        expect(graph.compile(builder, device.capabilities).passes).toHaveLength(0);
        const next = graph.createBuilder();
        next.addPass(
            {
                ...emptyPass,
                setup(): void {
                    expect(() => retained?.markSideEffect()).toThrow(/only valid during setup/u);
                }
            },
            undefined
        );
        expect(graph.compile(next, device.capabilities).passes).toHaveLength(0);
        graph.destroy();
        backend.destroy();
    });

    it('rejects async setup, closes its scope and rolls back usage declarations', async () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const buffer = builder.createBuffer('output', { size: 16, usage: RHIBufferUsage.COPY_DST });
        let continuation: Promise<void> | undefined;
        expect(() =>
            builder.addPass(
                {
                    ...emptyPass,
                    setup(pass): Promise<void> {
                        pass.readBuffer(buffer, 'vertex');
                        continuation = Promise.resolve().then(() => {
                            pass.markSideEffect();
                        });
                        return continuation;
                    }
                },
                undefined
            )
        ).toThrow(/setup callbacks must be synchronous/u);
        await expect(continuation).rejects.toThrow(/only valid during setup/u);
        builder.addPass(
            {
                ...emptyPass,
                setup(pass): void {
                    pass.writeBuffer(buffer, 'copy-destination');
                }
            },
            undefined
        );
        builder.markOutput(buffer);
        const compiled = graph.compile(builder, device.capabilities);
        expect(compiled.passes).toHaveLength(1);
        expect(compiled.resourceByHandle.get(buffer)?.descriptor.usage).toBe(
            RHIBufferUsage.COPY_DST
        );
        graph.destroy();
        backend.destroy();
    });

    it.each(['addPass', 'finish', 'discard'] as const)(
        'rejects reentrant %s without corrupting the recording',
        operation => {
            const builder = new RenderGraphBuilder();
            expect(() =>
                builder.addPass(
                    {
                        ...emptyPass,
                        setup(): void {
                            if (operation === 'addPass') builder.addPass(emptyPass, undefined);
                            else builder[operation]();
                        }
                    },
                    undefined
                )
            ).toThrow(/during pass setup/u);
            builder.addPass(emptyPass, undefined);
            expect(builder.finish().passes).toHaveLength(1);
            builder.discard();
        }
    );
});
