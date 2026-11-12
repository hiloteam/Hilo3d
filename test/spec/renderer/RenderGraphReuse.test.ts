import { describe, expect, it, vi } from 'vitest';
import { RenderGraph } from '../../../src/render/graph/RenderGraph';
import type { RenderPassTemplate } from '../../../src/render/graph/RenderGraphBuilder';
import type { RGTextureHandle } from '../../../src/render/graph/RenderGraphResource';
import {
    RHIBufferUsage,
    RHITextureUsage,
    type RHIDevice,
    type RHITexture
} from '../../../src/render/rhi/core';
import { FakeWebGLRHIBackend, FakeWebGPURHIBackend } from '../rhi/portable/FakeRHIBackend';

const descriptor = {
    size: { width: 8, height: 4 },
    format: 'rgba8unorm' as const,
    usage: RHITextureUsage.RENDER_ATTACHMENT | RHITextureUsage.TEXTURE_BINDING
};
interface ChainOptions {
    readonly width?: number;
    readonly fail?: boolean;
    readonly reverse?: boolean;
    readonly lastRead?: boolean;
    readonly extracted?: boolean;
    readonly log?: RHITexture[];
}
function chain(
    graph: RenderGraph,
    device: RHIDevice,
    options: ChainOptions = {}
): ReturnType<RenderGraph['compile']> {
    const builder = graph.createBuilder();
    const handles = Array.from({ length: 3 }, (_, i) =>
        builder.createTexture(`chain-${String(i)}`, {
            ...descriptor,
            size: { width: options.width ?? 8, height: 4 }
        })
    );
    if (options.reverse) handles.reverse();
    for (let i = 0; i < handles.length; i++) {
        const output = handles[i];
        if (output === undefined) throw new Error('Missing chain output');
        const input = handles[i - 1];
        builder.addPass(
            {
                name: `chain pass ${String(i)}`,
                setup(pass) {
                    if (input !== undefined) pass.readTexture(input);
                    if (options.lastRead && i === 2 && handles[0] !== undefined)
                        pass.readTexture(handles[0]);
                    pass.useColorAttachment({
                        texture: output,
                        loadOp: 'clear',
                        storeOp: 'store',
                        clearValue: { r: 0, g: 0, b: 0, a: 1 }
                    });
                },
                execute(context) {
                    options.log?.push(context.getTexture(output));
                    if (options.fail) throw new Error('chain aborted');
                }
            },
            undefined
        );
    }
    const last = handles[2];
    if (last === undefined) throw new Error('Missing chain output');
    if (options.extracted) builder.extractTexture(last);
    builder.markOutput(last);
    return graph.compile(builder, device.capabilities, device);
}

describe('Render Graph structural reuse', () => {
    it('rebinds current callbacks, params and providers while retaining independent old graphs', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const log: string[] = [];
        const imports = [device.createTexture(descriptor), device.createTexture(descriptor)];
        const providers = imports.map(texture => vi.fn(() => texture));
        const build = (frame: number): ReturnType<RenderGraph['compile']> => {
            const builder = graph.createBuilder();
            const provider = providers[frame];
            if (!provider) throw new Error('Missing provider');
            const texture = builder.importTextureProvider(
                'import',
                descriptor,
                provider,
                'persistent'
            );
            const template: RenderPassTemplate<{ texture: RGTextureHandle; value: string }> = {
                name: 'current frame',
                setup(pass, params) {
                    pass.readTexture(params.texture);
                    pass.markSideEffect();
                },
                execute(context, params) {
                    expect(context.getTexture(params.texture)).toBe(imports[frame]);
                    log.push(params.value);
                }
            };
            builder.addPass(template, { texture, value: `frame-${String(frame)}` });
            return graph.compile(builder, device.capabilities, device);
        };
        const first = build(0);
        expect(first.scheduleCacheHit).toBe(false);
        graph.execute(first, device);
        const second = build(1);
        expect(second.scheduleCacheHit).toBe(true);
        expect(providers[1]).not.toHaveBeenCalled();
        graph.execute(second, device);
        graph.execute(first, device);
        expect(log).toEqual(['frame-0', 'frame-1', 'frame-0']);
        graph.destroy();
        backend.destroy();
    });

    it('publishes plans only after submission and rejects new illegal declarations before a frame', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const failure = chain(graph, device, { fail: true });
        expect(() => graph.execute(failure, device)).toThrow('chain aborted');
        const retry = chain(graph, device);
        expect(retry.scheduleCacheHit).toBe(false);
        graph.execute(retry, device);
        expect(chain(graph, device).scheduleCacheHit).toBe(true);
        const begin = vi.spyOn(device.graphicsQueue, 'beginFrame');
        const builder = graph.createBuilder();
        const texture = builder.createTexture('uninitialized', descriptor);
        builder.addPass(
            {
                name: 'illegal reader',
                setup(pass) {
                    pass.readTexture(texture);
                    pass.markSideEffect();
                },
                execute() {
                    /* Setup declares this CPU-only fixture. */
                }
            },
            undefined
        );
        expect(() => graph.compile(builder, device.capabilities, device)).toThrow(/initializ/u);
        expect(begin).not.toHaveBeenCalled();
        graph.destroy();
        backend.destroy();
    });

    it('invalidates on resize, access changes and device generations', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        graph.execute(chain(graph, device), device);
        expect(chain(graph, device).scheduleCacheHit).toBe(true);
        const resized = chain(graph, device, { width: 16 });
        expect(resized.scheduleCacheHit).toBe(false);
        graph.execute(resized, device);
        const reads = chain(graph, device, { width: 16, lastRead: true });
        expect(reads.scheduleCacheHit).toBe(false);
        expect(reads.memory.aliasedTextures).toBe(0);
        graph.execute(reads, device);
        device.advanceGeneration();
        const restored = chain(graph, device, { width: 16, lastRead: true });
        expect(restored.scheduleCacheHit).toBe(false);
        graph.execute(restored, device);
        expect(chain(graph, device, { width: 16, lastRead: true }).scheduleCacheHit).toBe(true);
        graph.destroy();
        backend.destroy();
    });
});

describe('Render Graph transient texture reuse', () => {
    it.each([false, true])(
        'reuses disjoint intervals with reverse declaration order=%s',
        reverse => {
            const backend = new FakeWebGLRHIBackend();
            const device = backend.createDevice();
            const graph = new RenderGraph();
            const create = vi.spyOn(device, 'createTexture');
            const log: RHITexture[] = [];
            const compiled = chain(graph, device, { reverse, log });
            expect(compiled.memory).toEqual({
                logicalBytes: 384,
                peakLiveBytes: 256,
                physicalBytes: 256,
                aliasedTextures: 1
            });
            graph.execute(compiled, device);
            expect(create).toHaveBeenCalledTimes(2);
            expect(log[0]).toBe(log[2]);
            expect(log[0]).not.toBe(log[1]);
            graph.destroy();
            backend.destroy();
        }
    );

    it('keeps extracted allocations and overlapping views separate', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        expect(chain(graph, device, { extracted: true }).memory.aliasedTextures).toBe(0);
        const builder = graph.createBuilder();
        const a = builder.createTexture('view parent', descriptor);
        const view = builder.createTextureView('late view', a, {});
        const b = builder.createTexture('other', descriptor);
        builder.addPass(
            {
                name: 'initialize',
                setup(pass) {
                    pass.writeTexture(a);
                },
                execute() {
                    /* Setup declares this CPU-only fixture. */
                }
            },
            undefined
        );
        builder.addPass(
            {
                name: 'overlapping view',
                setup(pass) {
                    pass.readTexture(view);
                    pass.writeTexture(b);
                    pass.markSideEffect();
                },
                execute() {
                    /* Setup declares this CPU-only fixture. */
                }
            },
            undefined
        );
        const compiled = graph.compile(builder, device.capabilities, device);
        expect(compiled.memory.aliasedTextures).toBe(0);
        graph.destroy();
        backend.destroy();
    });

    it('holds physical slots until their own submission settles and retires failures once', async () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const create = vi.spyOn(device, 'createTexture');
        const first = graph.execute(chain(graph, device), device);
        const second = graph.execute(chain(graph, device), device);
        expect(create).toHaveBeenCalledTimes(4);
        backend.completeNextSubmission();
        await first.submission.done;
        const third = graph.execute(chain(graph, device), device);
        expect(create).toHaveBeenCalledTimes(4);
        backend.completeNextSubmission();
        await second.submission.done;
        backend.completeNextSubmission();
        await third.submission.done;
        const destroys = create.mock.results.map(result =>
            vi.spyOn(result.value as RHITexture, 'destroy')
        );
        expect(() => graph.execute(chain(graph, device, { fail: true }), device)).toThrow(
            'chain aborted'
        );
        expect(destroys.reduce((sum, spy) => sum + spy.mock.calls.length, 0)).toBe(2);
        graph.destroy();
        expect(destroys.every(spy => spy.mock.calls.length === 1)).toBe(true);
        backend.destroy();
    });

    it('does not alias transient buffers or confuse byte estimates for views', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        for (let index = 0; index < 2; index++) {
            const buffer = builder.createBuffer(`buffer-${String(index)}`, {
                size: 64,
                usage: RHIBufferUsage.COPY_DST
            });
            builder.addPass(
                {
                    name: 'buffer',
                    setup(pass) {
                        pass.writeBuffer(buffer, 'copy-destination');
                        pass.markSideEffect();
                    },
                    execute() {
                        /* Setup declares this CPU-only fixture. */
                    }
                },
                undefined
            );
        }
        const compiled = graph.compile(builder, device.capabilities, device);
        expect(compiled.memory).toEqual({
            logicalBytes: 128,
            physicalBytes: 128,
            peakLiveBytes: 64,
            aliasedTextures: 0
        });
        graph.destroy();
        backend.destroy();
    });
});
