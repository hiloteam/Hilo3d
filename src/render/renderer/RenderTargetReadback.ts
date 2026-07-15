import type {
    RenderTargetColorAttachmentReadback,
    RenderTargetColorFormat,
    RenderTargetReadColorAttachmentOptions
} from '../RenderTarget';
import { RenderFrame } from '../frame/RenderFrame';
import type { RenderFrameContext } from '../frame/RenderFrameContext';
import type { RGBufferHandle } from '../graph/RenderGraphResource';
import {
    RHIBufferUsage,
    getRHITextureFormatBlockInfo,
    type RHIBuffer,
    type RHITextureFormat
} from '../rhi/core';
import { RenderTargetGraphBridge } from './RenderTargetGraphBridge';
import type {
    RenderTargetResourceCache,
    RenderTargetResourceRecord
} from './RenderTargetResourceCache';
import type { SubmissionResourceTracker } from './SubmissionResourceTracker';

const PUBLIC_COLOR_FORMATS: ReadonlySet<RHITextureFormat> = new Set([
    'rgba8unorm',
    'rgba8unorm-srgb',
    'rgba16float',
    'rgba32float'
]);

function publicColorFormat(format: RHITextureFormat): RenderTargetColorFormat {
    if (!PUBLIC_COLOR_FORMATS.has(format)) {
        throw new TypeError(`Render-target format ${format} is not exposed by the public API`);
    }
    return format as RenderTargetColorFormat;
}

function tightlyPackRows(
    source: Uint8Array,
    width: number,
    height: number,
    bytesPerPixel: number,
    sourceBytesPerRow: number
): Uint8Array {
    const bytesPerRow = width * bytesPerPixel;
    if (!Number.isSafeInteger(bytesPerRow) || !Number.isSafeInteger(bytesPerRow * height)) {
        throw new RangeError('Render-target readback size exceeds the safe integer range');
    }
    const result = new Uint8Array(bytesPerRow * height);
    for (let row = 0; row < height; row += 1) {
        const sourceOffset = row * sourceBytesPerRow;
        result.set(source.subarray(sourceOffset, sourceOffset + bytesPerRow), row * bytesPerRow);
    }
    return result;
}

/** Shared graph copy + asynchronous map policy for public render-target readback. */
export class RenderTargetReadback {
    readonly frame = new RenderFrame();
    readonly bridge: RenderTargetGraphBridge;
    #destroyed = false;

    constructor(
        readonly resources: RenderTargetResourceCache,
        readonly submissions: SubmissionResourceTracker
    ) {
        if (resources.registry !== submissions.registry) {
            throw new Error('Render-target readback services must share one ResourceRegistry');
        }
        this.bridge = new RenderTargetGraphBridge(resources);
    }

    async read(
        context: RenderFrameContext,
        target: Readonly<RenderTargetResourceRecord>,
        options: Readonly<RenderTargetReadColorAttachmentOptions> = {}
    ): Promise<RenderTargetColorAttachmentReadback> {
        if (this.#destroyed) throw new Error('Render-target readback service is destroyed');
        const registry = this.resources.registry;
        if (
            context.rhi.id !== registry.deviceId ||
            context.rhi.backend !== registry.deviceBackend ||
            context.rhi.generation !== registry.deviceGeneration
        ) {
            throw new Error('Render-target readback context belongs to another RHI generation');
        }
        if (!registry.deviceCapabilities.features.has('buffer-mapping')) {
            throw new Error('Render-target readback requires RHI buffer mapping');
        }
        const attachmentIndex = options.attachmentIndex ?? 0;
        let staging: RHIBuffer | null = null;
        const planState: {
            extracted: RGBufferHandle | null;
            format: RHITextureFormat | null;
            width: number;
            height: number;
            bytesPerRow: number;
            byteLength: number;
        } = {
            extracted: null,
            format: null,
            width: 0,
            height: 0,
            bytesPerRow: 0,
            byteLength: 0
        };
        try {
            const execution = this.frame.execute(context, scope => {
                const imported = this.bridge.import(scope.graph, target);
                const plan = this.bridge.createColorAttachmentCopyPlan(
                    imported,
                    attachmentIndex,
                    options
                );
                const label = `${target.label} color ${String(attachmentIndex)} public readback`;
                planState.extracted = scope.graph.createBuffer(label, {
                    label,
                    size: plan.byteLength,
                    usage: RHIBufferUsage.COPY_DST | RHIBufferUsage.MAP_READ
                });
                scope.graph.extractBuffer(planState.extracted);
                this.bridge.addColorCopyPlanPass(scope.graph, plan, planState.extracted);
                planState.format = plan.format;
                planState.width = plan.copySize.width;
                planState.height = plan.copySize.height;
                planState.bytesPerRow = plan.destinationLayout.bytesPerRow;
                planState.byteLength = plan.byteLength;
            });
            if (planState.extracted === null || planState.format === null) {
                throw new Error('Render-target readback graph did not produce a copy plan');
            }
            staging = execution.getExtractedBuffer(planState.extracted);
            this.resources.markUsed(target, context.frameIndex);
            const tracking = this.submissions.track(context.frameIndex, execution.submission);
            await tracking;
            await staging.mapAsync('read', 0, planState.byteLength);
            const mapped = new Uint8Array(staging.getMappedRange(0, planState.byteLength));
            const block = getRHITextureFormatBlockInfo(planState.format);
            if (
                block.blockWidth !== 1 ||
                block.blockHeight !== 1 ||
                block.bytesPerBlock === undefined
            ) {
                throw new TypeError(
                    'Public render-target readback requires an uncompressed format'
                );
            }
            const data = tightlyPackRows(
                mapped,
                planState.width,
                planState.height,
                block.bytesPerBlock,
                planState.bytesPerRow
            );
            return Object.freeze({
                data,
                format: publicColorFormat(planState.format),
                width: planState.width,
                height: planState.height,
                bytesPerPixel: block.bytesPerBlock,
                bytesPerRow: planState.width * block.bytesPerBlock
            });
        } finally {
            if (staging?.mapState === 'mapped') staging.unmap();
            staging?.destroy();
        }
    }

    destroy(): void {
        if (this.#destroyed) return;
        if (this.frame.active) throw new Error('Cannot destroy an active readback frame');
        this.frame.destroy();
        this.#destroyed = true;
    }
}
