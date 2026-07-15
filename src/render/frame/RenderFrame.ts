import { RenderGraph } from '../graph/RenderGraph';
import type { RenderGraphBuilder } from '../graph/RenderGraphBuilder';
import type { RGExecutionResult } from '../graph/RenderGraphExecutor';
import type { RHIFrameDiagnostics } from '../rhi/core';
import { FrameArena } from './FrameArena';
import { RHIUploadBatch } from './RHIUploadBatch';
import type { RenderFrameContext } from './RenderFrameContext';

export interface RenderFrameBuildScope {
    readonly context: RenderFrameContext;
    readonly graph: RenderGraphBuilder;
    readonly arena: FrameArena;
    readonly uploads: RHIUploadBatch;
}

export type RenderFrameBuildCallback = (scope: RenderFrameBuildScope) => unknown;

function isPromiseLike(value: unknown): boolean {
    if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
        return false;
    }
    return typeof Reflect.get(value, 'then') === 'function';
}

function createFrameDiagnostics(): RHIFrameDiagnostics {
    return {
        commandCount: 0,
        drawCount: 0,
        pipelineSwitches: 0,
        bindGroupSwitches: 0,
        vertexBufferSwitches: 0,
        nativeStateCalls: 0,
        frameArenaGrowths: 0,
        transientAllocations: 0,
        cacheHits: 0,
        cacheMisses: 0
    };
}

/** Owns one reusable build arena and enforces a complete build/compile/execute frame boundary. */
export class RenderFrame {
    readonly arena: FrameArena;
    readonly uploads: RHIUploadBatch;
    readonly diagnostics = createFrameDiagnostics();
    readonly #renderGraph = new RenderGraph();
    #active = false;
    #destroyed = false;

    constructor(initialArenaCapacity?: number) {
        this.arena = new FrameArena(initialArenaCapacity);
        this.uploads = new RHIUploadBatch(this.arena);
    }

    get active(): boolean {
        return this.#active;
    }

    destroy(): void {
        if (this.#active) throw new Error('Cannot destroy an active RenderFrame');
        if (this.#destroyed) return;
        this.#destroyed = true;
        this.#renderGraph.destroy();
    }

    execute(context: RenderFrameContext, build: RenderFrameBuildCallback): RGExecutionResult {
        if (this.#active)
            throw new Error('Nested execution on the same RenderFrame is not allowed');
        if (this.#destroyed) throw new Error('Cannot execute a destroyed RenderFrame');
        if (context.rhi.destroyed) throw new Error('Cannot render with a destroyed RHI device');
        this.#active = true;
        this.arena.reset();
        this.uploads.reset();
        const growthsBeforeBuild = this.arena.growthCount;
        try {
            const graph = this.#renderGraph.createBuilder();
            const result = build(
                Object.freeze({ context, graph, arena: this.arena, uploads: this.uploads })
            );
            if (isPromiseLike(result)) {
                throw new TypeError('Render frame build callbacks must be synchronous');
            }
            const compiled = this.#renderGraph.compile(graph, context.rhi.capabilities);
            this.uploads.validate(context.rhi);
            const execution = this.#renderGraph.execute(compiled, context.rhi, {
                frameIndex: context.frameIndex,
                diagnostics: this.diagnostics,
                prePassCommands: this.uploads
            });
            this.uploads.commit(execution.submission);
            execution.diagnostics.frameArenaGrowths = this.arena.growthCount - growthsBeforeBuild;
            return execution;
        } catch (error) {
            this.uploads.rollback();
            throw error;
        } finally {
            this.#active = false;
        }
    }
}
