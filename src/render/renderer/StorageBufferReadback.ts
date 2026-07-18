import type { RendererStorageBuffer, StorageBufferReadback } from '../StorageBuffer';
import { RenderGraphFrame } from '../frame/RenderGraphFrame';
import type { RenderGraphFrameContext } from '../frame/RenderGraphFrameContext';
import type { RGPassBuilder, RenderPassTemplate } from '../graph/RenderGraphBuilder';
import type { RGPassContext } from '../graph/RenderGraphExecutor';
import type { RGBufferHandle } from '../graph/RenderGraphResource';
import { RHIBufferUsage, type RHIBuffer } from '../rhi/core';
import type { StorageBufferResourceCache } from './StorageBufferResourceCache';
import type { SubmissionResourceTracker } from './SubmissionResourceTracker';

interface BufferReadbackPassParameters {
    source: RGBufferHandle | null;
    destination: RGBufferHandle | null;
    sourceOffset: number;
    byteLength: number;
}

function requireHandle(handle: RGBufferHandle | null, name: string): RGBufferHandle {
    if (handle === null) throw new Error(`Storage-buffer readback ${name} is unavailable`);
    return handle;
}

const READBACK_PASS: RenderPassTemplate<BufferReadbackPassParameters> = Object.freeze({
    name: 'Storage-buffer readback copy',
    setup(builder: RGPassBuilder, parameters: BufferReadbackPassParameters): void {
        builder.readBuffer(requireHandle(parameters.source, 'source'), 'copy-source');
        builder.writeBuffer(
            requireHandle(parameters.destination, 'destination'),
            'copy-destination'
        );
    },
    execute(context: RGPassContext, parameters: BufferReadbackPassParameters): void {
        context.commandContext.copyBufferToBuffer(
            context.getBuffer(requireHandle(parameters.source, 'source')),
            parameters.sourceOffset,
            context.getBuffer(requireHandle(parameters.destination, 'destination')),
            0,
            parameters.byteLength
        );
    }
});

/** Shared graph copy + asynchronous map policy for renderer-owned StorageBuffer readback. */
export class StorageBufferReadbackService {
    readonly frame = new RenderGraphFrame();
    readonly #parameters: BufferReadbackPassParameters = {
        source: null,
        destination: null,
        sourceOffset: 0,
        byteLength: 0
    };
    #readPending = false;
    #destroyed = false;

    constructor(
        readonly resources: StorageBufferResourceCache,
        readonly submissions: SubmissionResourceTracker
    ) {
        if (resources.registry !== submissions.registry) {
            throw new Error('Storage-buffer readback services must share one ResourceRegistry');
        }
    }

    async read(
        context: RenderGraphFrameContext,
        source: RendererStorageBuffer,
        byteOffset: number,
        byteLength: number
    ): Promise<StorageBufferReadback> {
        if (this.#destroyed) throw new Error('Storage-buffer readback service is destroyed');
        const registry = this.resources.registry;
        if (
            context.rhi.id !== registry.deviceId ||
            context.rhi.backend !== registry.deviceBackend ||
            context.rhi.generation !== registry.deviceGeneration
        ) {
            throw new Error('Storage-buffer readback context belongs to another RHI generation');
        }
        if (!registry.deviceCapabilities.features.has('buffer-mapping')) {
            throw new Error('Storage-buffer readback requires RHI buffer mapping');
        }
        if (this.#readPending) {
            throw new Error('Storage-buffer readback already has a pending request');
        }
        this.#readPending = true;

        let staging: RHIBuffer | null = null;
        const parameters = this.#parameters;
        parameters.source = null;
        parameters.destination = null;
        parameters.sourceOffset = byteOffset;
        parameters.byteLength = byteLength;
        try {
            const execution = this.frame.execute(context, scope => {
                this.resources.beginFrame(context.frameIndex, scope.uploads);
                const buffer = this.resources.prepare(source);
                if (!this.resources.isInitializedAtFrameStart(source)) {
                    throw new Error(
                        'StorageBuffer contents require a complete write after device recovery'
                    );
                }
                parameters.source = scope.graph.importBuffer(source.label, buffer, true);
                parameters.destination = scope.graph.createBuffer(`${source.label} readback`, {
                    label: `${source.label} readback`,
                    size: byteLength,
                    usage: RHIBufferUsage.COPY_DST | RHIBufferUsage.MAP_READ
                });
                scope.graph.extractBuffer(parameters.destination);
                scope.graph.addPass(READBACK_PASS, parameters);
            });
            staging = execution.getExtractedBuffer(
                requireHandle(parameters.destination, 'destination')
            );
            await this.submissions.track(context.frameIndex, execution.submission);
            await staging.mapAsync('read', 0, byteLength);
            const mapped = new Uint8Array(staging.getMappedRange(0, byteLength));
            return Object.freeze({
                data: mapped.slice(),
                byteOffset,
                byteLength
            });
        } finally {
            parameters.source = null;
            parameters.destination = null;
            if (staging?.mapState === 'mapped') staging.unmap();
            staging?.destroy();
            this.#readPending = false;
        }
    }

    destroy(): void {
        if (this.#destroyed) return;
        if (this.frame.active || this.#readPending) {
            throw new Error('Cannot destroy an active storage-buffer readback');
        }
        this.frame.destroy();
        this.#destroyed = true;
    }
}
