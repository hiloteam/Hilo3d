import type { RHICapabilities, RHIDevice } from '../rhi/core';
import { RenderGraphBuilder, RenderGraphBuilderStorage } from './RenderGraphBuilder';
import { RenderGraphCompiler, type CompiledRenderGraph } from './RenderGraphCompiler';
import {
    RenderGraphExecutor,
    type RGExecutionOptions,
    type RGExecutionResult
} from './RenderGraphExecutor';

/** Small owner facade for one build/compile/execute graph pipeline. */
export class RenderGraph {
    readonly #compiler = new RenderGraphCompiler();
    readonly #executor = new RenderGraphExecutor();
    readonly #builderStorages: RenderGraphBuilderStorage[] = [];
    readonly #availableBuilderStorages: RenderGraphBuilderStorage[] = [];
    readonly #releaseBuilderStorage = (storage: RenderGraphBuilderStorage): void => {
        this.#availableBuilderStorages.push(storage);
    };
    readonly #storageDiagnostics: MutableRenderGraphStorageDiagnostics = {
        builderStorageCapacity: 0,
        resourceNodeCapacity: 0,
        passNodeCapacity: 0,
        colorAttachmentCapacity: 0,
        builderStorageGrowths: 0,
        compilerResourceCapacity: 0,
        compilerPassCapacity: 0,
        compilerReaderSetCapacity: 0,
        compilerStorageGrowths: 0,
        executorWorkspaceCapacity: 0,
        executorResourceCapacity: 0,
        executorLookupCapacity: 0,
        executorStorageGrowths: 0
    };

    createBuilder(): RenderGraphBuilder {
        let storage = this.#availableBuilderStorages.pop();
        if (!storage) {
            storage = new RenderGraphBuilderStorage();
            this.#builderStorages.push(storage);
        }
        return new RenderGraphBuilder(storage, this.#releaseBuilderStorage);
    }

    /** High-water build/compile workspace counters. The returned identity is stable. */
    get storageDiagnostics(): Readonly<RenderGraphStorageDiagnostics> {
        const diagnostics = this.#storageDiagnostics;
        diagnostics.builderStorageCapacity = this.#builderStorages.length;
        diagnostics.resourceNodeCapacity = 0;
        diagnostics.passNodeCapacity = 0;
        diagnostics.colorAttachmentCapacity = 0;
        diagnostics.builderStorageGrowths = 0;
        for (const storage of this.#builderStorages) {
            const storageDiagnostics = storage.diagnostics;
            diagnostics.resourceNodeCapacity += storageDiagnostics.resourceNodeCapacity;
            diagnostics.passNodeCapacity += storageDiagnostics.passNodeCapacity;
            diagnostics.colorAttachmentCapacity += storageDiagnostics.colorAttachmentCapacity;
            diagnostics.builderStorageGrowths += storageDiagnostics.growthCount;
        }
        const compiler = this.#compiler.storageDiagnostics;
        diagnostics.compilerResourceCapacity = compiler.resourceCapacity;
        diagnostics.compilerPassCapacity = compiler.passCapacity;
        diagnostics.compilerReaderSetCapacity = compiler.readerSetCapacity;
        diagnostics.compilerStorageGrowths = compiler.growthCount;
        const executor = this.#executor.storageDiagnostics;
        diagnostics.executorWorkspaceCapacity = executor.workspaceCapacity;
        diagnostics.executorResourceCapacity = executor.resourceCapacity;
        diagnostics.executorLookupCapacity = executor.lookupCapacity;
        diagnostics.executorStorageGrowths = executor.growthCount;
        return diagnostics;
    }

    destroy(): void {
        this.#executor.destroy();
    }

    compile(builder: RenderGraphBuilder, capabilities: RHICapabilities): CompiledRenderGraph {
        let finished = false;
        try {
            const snapshot = builder.finish();
            finished = true;
            return this.#compiler.compile(snapshot, capabilities);
        } finally {
            if (finished) builder.recycleAfterCompile();
        }
    }

    execute(
        graph: CompiledRenderGraph,
        device: RHIDevice,
        options?: RGExecutionOptions
    ): RGExecutionResult {
        return this.#executor.execute(graph, device, options);
    }
}

export interface RenderGraphStorageDiagnostics {
    /** Build stores needed by the historical maximum number of simultaneous builders. */
    readonly builderStorageCapacity: number;
    readonly resourceNodeCapacity: number;
    readonly passNodeCapacity: number;
    readonly colorAttachmentCapacity: number;
    readonly builderStorageGrowths: number;
    readonly compilerResourceCapacity: number;
    readonly compilerPassCapacity: number;
    readonly compilerReaderSetCapacity: number;
    readonly compilerStorageGrowths: number;
    readonly executorWorkspaceCapacity: number;
    readonly executorResourceCapacity: number;
    readonly executorLookupCapacity: number;
    readonly executorStorageGrowths: number;
}

type MutableRenderGraphStorageDiagnostics = {
    -readonly [Key in keyof RenderGraphStorageDiagnostics]: RenderGraphStorageDiagnostics[Key];
};
