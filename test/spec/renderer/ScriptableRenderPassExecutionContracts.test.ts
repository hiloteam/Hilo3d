import { afterEach, describe, expect, it, vi } from 'vitest';
import { RenderGraph } from '../../../src/render/graph/RenderGraph';
import type { CompiledRenderGraph } from '../../../src/render/graph/RenderGraphCompiler';
import { ScriptablePassSlot } from '../../../src/render/internal/ScriptableRenderPassExecution';
import { ScriptableRenderPipelineContextImpl } from '../../../src/render/internal/ScriptableRenderPipelineContext';
import { ScriptableRenderPipelineResources } from '../../../src/render/internal/ScriptableRenderPipelineResources';
import type {
    BufferRecord,
    ScriptableRenderPipelineServices
} from '../../../src/render/internal/ScriptableRenderPipelineTypes';
import * as validation from '../../../src/render/internal/ScriptableRenderPipelineValidation';
import { createRenderPipelineCapabilities } from '../../../src/render/pipeline/RenderPipelineCapabilities';
import type {
    RenderGraphBufferHandle,
    ScriptableRenderCommands,
    ScriptableRenderPass,
    ScriptableRenderPassContext
} from '../../../src/render/pipeline/ScriptableRenderGraph';
import { RHIBufferUsage } from '../../../src/render/rhi/core';
import { FakeRHICommandContext, FakeWebGPURHIBackend } from '../rhi/portable/FakeRHIBackend';

class PassFixture {
    readonly backend = new FakeWebGPURHIBackend();
    readonly device = this.backend.createDevice();
    readonly graph = new RenderGraph();
    readonly slot = new ScriptablePassSlot();
    readonly resources = new ScriptableRenderPipelineResources();
    readonly recordPass = vi.fn();
    // These callback-only tests do not request scene, surface, or draw processor services.
    readonly owner = new ScriptableRenderPipelineContextImpl(
        {
            renderer: { backend: 'webgpu' },
            recordScriptablePass: this.recordPass
        } as unknown as ScriptableRenderPipelineServices,
        this.resources
    );
    readonly capabilities = createRenderPipelineCapabilities(this.device.capabilities);

    compile(pass: ScriptableRenderPass<object>): CompiledRenderGraph {
        this.slot.begin(this.owner, pass, {}, this.capabilities);
        const builder = this.graph.createBuilder();
        builder.addPass(this.slot.template, this.slot);
        return this.graph.compile(builder, this.device.capabilities);
    }

    destroy(): void {
        this.slot.releaseFrameReferences(this.resources);
        this.graph.destroy();
        this.backend.destroy();
    }
}

const fixtures: PassFixture[] = [];

function fixture(): PassFixture {
    const result = new PassFixture();
    fixtures.push(result);
    return result;
}

afterEach(() => {
    for (const item of fixtures) item.destroy();
    fixtures.length = 0;
    vi.restoreAllMocks();
});

describe('Scriptable pass callback execution contracts', () => {
    it('allocates immutable command facades before beginFrame and never revives a retained scope', () => {
        const item = fixture();
        const contexts: ScriptableRenderPassContext[] = [];
        const commands: ScriptableRenderCommands[] = [];
        const pass: ScriptableRenderPass<object> = {
            name: 'Scoped commands',
            setup(builder): void {
                builder.markSideEffect();
            },
            execute(context): void {
                for (const previous of contexts) {
                    expect(() => previous.commands).toThrow('only during its execute() callback');
                }
                for (const previous of commands) {
                    expect(() => {
                        previous.setStencilReference(0);
                    }).toThrow('only during its execute() callback');
                }
                contexts.push(context);
                commands.push(context.commands);
                expect(context.commands).toBe(commands.at(-1));
            }
        };
        const freeze = vi.spyOn(Object, 'freeze');
        const beginFrame = item.device.graphicsQueue.beginFrame.bind(item.device.graphicsQueue);
        let freezesBeforeBegin = 0;
        vi.spyOn(item.device.graphicsQueue, 'beginFrame').mockImplementation(options => {
            freezesBeforeBegin = freeze.mock.calls.length;
            return beginFrame(options);
        });

        for (let invocation = 0; invocation < 3; invocation++) {
            const graph = item.compile(pass);
            freeze.mockClear();
            item.graph.execute(graph, item.device);
            const context = contexts[invocation];
            const command = commands[invocation];
            for (const facade of [context, command]) {
                const allocation = freeze.mock.calls.findIndex(([value]) => value === facade);
                expect(allocation).toBeGreaterThanOrEqual(0);
                expect(allocation).toBeLessThan(freezesBeforeBegin);
                expect(Object.isFrozen(facade)).toBe(true);
            }
            expect(() => context?.commands).toThrow('only during its execute() callback');
            item.slot.releaseFrameReferences(item.resources);
        }
        expect(new Set(contexts).size).toBe(3);
        expect(new Set(commands).size).toBe(3);
    });

    it('expires the context when execute throws and prepares a new one on the next invocation', () => {
        const item = fixture();
        const contexts: ScriptableRenderPassContext[] = [];
        const failure = new Error('callback failed');
        const pass: ScriptableRenderPass<object> = {
            name: 'Failing commands',
            setup(builder): void {
                builder.markSideEffect();
            },
            execute(context): void {
                expect(() => contexts[0]?.commands).not.toThrow();
                contexts.push(context);
                throw failure;
            }
        };
        expect(() => item.graph.execute(item.compile(pass), item.device)).toThrow(failure);
        expect(() => contexts[0]?.commands).toThrow('only during its execute() callback');
        item.slot.releaseFrameReferences(item.resources);
        pass.execute = context => {
            expect(() => contexts[0]?.commands).toThrow('only during its execute() callback');
            contexts.push(context);
        };
        item.graph.execute(item.compile(pass), item.device);
        expect(contexts[1]).not.toBe(contexts[0]);
        expect(() => contexts[1]?.commands).toThrow('only during its execute() callback');
    });

    it.each(['setup', 'prepare', 'execute'] as const)(
        'rejects asynchronous %s and observes its rejected Promise',
        async phase => {
            const item = fixture();
            const begin = vi.spyOn(item.device.graphicsQueue, 'beginFrame');
            const abort = vi.spyOn(item.device.graphicsQueue, 'abortFrame');
            const end = vi.spyOn(item.device.graphicsQueue, 'endFrame');
            const contexts: ScriptableRenderPassContext[] = [];
            const reject = (): Promise<never> => Promise.reject(new Error('late rejection'));
            const pass: ScriptableRenderPass<object> = {
                name: 'Async callback',
                setup(builder): unknown {
                    builder.markSideEffect();
                    return phase === 'setup' ? reject() : undefined;
                },
                prepare(): unknown {
                    return phase === 'prepare' ? reject() : undefined;
                },
                execute(context): unknown {
                    contexts.push(context);
                    return reject();
                }
            };
            expect(() => item.graph.execute(item.compile(pass), item.device)).toThrow(
                `Async callback.${phase}() must be synchronous`
            );
            expect(begin).toHaveBeenCalledTimes(phase === 'execute' ? 1 : 0);
            expect(abort).toHaveBeenCalledTimes(phase === 'execute' ? 1 : 0);
            expect(end).not.toHaveBeenCalled();
            if (phase === 'execute') {
                expect(() => contexts[0]?.commands).toThrow('only during its execute() callback');
            }
            await Promise.resolve();
        }
    );

    it.each([
        { offset: undefined, length: undefined, error: null },
        { offset: 4, length: 12, error: null },
        { offset: 4, length: undefined, error: null },
        { offset: -4, length: 4, error: 'is invalid' },
        { offset: 0, length: 0, error: 'is invalid' },
        { offset: 12, length: 8, error: 'is invalid' },
        { offset: 2, length: 4, error: '4-byte aligned' },
        { offset: 4, length: 6, error: '4-byte aligned' },
        { offset: 0, length: 8, error: 'Exact buffer clear destination/range' }
    ])('validates clear range $offset/$length without allocating a normalized range', options => {
        const item = fixture();
        const handle = 1 as RenderGraphBufferHandle;
        const builder = item.graph.createBuilder();
        const native = item.device.createBuffer({ size: 16, usage: RHIBufferUsage.COPY_DST });
        const internal = builder.importBuffer('clear destination', native);
        const record: BufferRecord = {
            handle,
            name: 'clear destination',
            byteLength: 16,
            internal,
            source: null,
            transient: false,
            initialized: true,
            graphDescriptor: {
                label: 'clear destination',
                size: 16,
                usage: RHIBufferUsage.COPY_DST
            }
        };
        vi.spyOn(ScriptableRenderPipelineContextImpl.prototype, 'requireBuffer').mockReturnValue(
            record
        );
        vi.spyOn(ScriptableRenderPipelineContextImpl.prototype, 'resolveBuffer').mockReturnValue(
            internal
        );
        const normalizedRange = vi.spyOn(validation, 'normalizeBufferRange');
        const clear = vi.spyOn(FakeRHICommandContext.prototype, 'clearBuffer');
        item.slot.begin(
            item.owner,
            {
                name: 'Clear commands',
                setup(pass): void {
                    pass.clearBuffer(handle);
                    pass.clearBuffer(handle, 4, 12);
                    pass.markSideEffect();
                },
                execute(context): void {
                    context.commands.clearBuffer(handle, options.offset, options.length);
                }
            },
            {},
            item.capabilities
        );
        builder.addPass(item.slot.template, item.slot);
        const graph = item.graph.compile(builder, item.device.capabilities);
        expect(normalizedRange).toHaveBeenCalledTimes(2);
        normalizedRange.mockClear();
        if (options.error === null) {
            item.graph.execute(graph, item.device);
            expect(clear).toHaveBeenCalledWith(
                native,
                options.offset ?? 0,
                options.length ?? 16 - (options.offset ?? 0)
            );
        } else {
            expect(() => item.graph.execute(graph, item.device)).toThrow(options.error);
            expect(clear).not.toHaveBeenCalled();
        }
        expect(normalizedRange).not.toHaveBeenCalled();
    });
});
