import {
    rhiTextureFormatHasDepth,
    rhiTextureFormatHasStencil,
    type RHICacheCounter,
    RHIValidationError,
    snapshotRHIRenderPassDescriptor
} from '../../core';
import type { RHIRenderPassDescriptor } from '../../core/RHICommands';
import type { WebGPUDevice } from './WebGPUDevice';
import { WebGPUTextureView } from './WebGPUResources';

interface WebGPUFramebufferCacheRecord {
    readonly descriptor: Readonly<RHIRenderPassDescriptor>;
    readonly native: GPURenderPassDescriptor;
    lastUsed: number;
}

function usesView(record: WebGPUFramebufferCacheRecord, viewId: number): boolean {
    if (record.descriptor.depthStencilAttachment?.view.id === viewId) return true;
    for (const attachment of record.descriptor.colorAttachments) {
        if (
            attachment !== null &&
            (attachment.view.id === viewId || attachment.resolveTarget?.id === viewId)
        ) {
            return true;
        }
    }
    return false;
}

const MAX_FRAMEBUFFER_RECORDS = 256;

function sameColor(
    first: RHIRenderPassDescriptor['colorAttachments'][number],
    second: RHIRenderPassDescriptor['colorAttachments'][number]
): boolean {
    if (first === null || second === null) return first === second;
    const firstClear = first.clearValue;
    const secondClear = second.clearValue;
    return (
        first.view.id === second.view.id &&
        (first.resolveTarget?.id ?? 0) === (second.resolveTarget?.id ?? 0) &&
        first.loadOp === second.loadOp &&
        first.storeOp === second.storeOp &&
        (firstClear === undefined || secondClear === undefined
            ? firstClear === secondClear
            : firstClear.r === secondClear.r &&
              firstClear.g === secondClear.g &&
              firstClear.b === secondClear.b &&
              firstClear.a === secondClear.a)
    );
}

function sameDepthStencil(
    first: RHIRenderPassDescriptor['depthStencilAttachment'],
    second: RHIRenderPassDescriptor['depthStencilAttachment']
): boolean {
    if (first === undefined || second === undefined) return first === second;
    return (
        first.view.id === second.view.id &&
        first.depthClearValue === second.depthClearValue &&
        first.depthLoadOp === second.depthLoadOp &&
        first.depthStoreOp === second.depthStoreOp &&
        first.depthReadOnly === second.depthReadOnly &&
        first.stencilClearValue === second.stencilClearValue &&
        first.stencilLoadOp === second.stencilLoadOp &&
        first.stencilStoreOp === second.stencilStoreOp &&
        first.stencilReadOnly === second.stencilReadOnly
    );
}

function sameRenderPassDescriptor(
    first: Readonly<RHIRenderPassDescriptor>,
    second: Readonly<RHIRenderPassDescriptor>
): boolean {
    if (
        first.label !== second.label ||
        first.colorAttachments.length !== second.colorAttachments.length ||
        !sameDepthStencil(first.depthStencilAttachment, second.depthStencilAttachment)
    ) {
        return false;
    }
    for (let index = 0; index < first.colorAttachments.length; index += 1) {
        if (
            !sameColor(
                first.colorAttachments[index] ?? null,
                second.colorAttachments[index] ?? null
            )
        ) {
            return false;
        }
    }
    return true;
}

function requireTextureView(device: WebGPUDevice, value: unknown, path: string): WebGPUTextureView {
    if (!(value instanceof WebGPUTextureView) || value.owner !== device) {
        throw new RHIValidationError('wrong-device', 'expected a WebGPU RHI texture view', path);
    }
    return value;
}

function depthAspectUnused(
    attachment: NonNullable<RHIRenderPassDescriptor['depthStencilAttachment']>
): boolean {
    return (
        attachment.depthClearValue === undefined &&
        attachment.depthLoadOp === undefined &&
        attachment.depthStoreOp === undefined &&
        attachment.depthReadOnly === undefined
    );
}

function stencilAspectUnused(
    attachment: NonNullable<RHIRenderPassDescriptor['depthStencilAttachment']>
): boolean {
    return (
        attachment.stencilClearValue === undefined &&
        attachment.stencilLoadOp === undefined &&
        attachment.stencilStoreOp === undefined &&
        attachment.stencilReadOnly === undefined
    );
}

function nativeRenderPassDescriptor(
    device: WebGPUDevice,
    descriptor: Readonly<RHIRenderPassDescriptor>
): GPURenderPassDescriptor {
    return {
        ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
        colorAttachments: descriptor.colorAttachments.map((attachment, index) => {
            if (attachment === null) return null;
            const view = requireTextureView(
                device,
                attachment.view,
                `renderPass.colorAttachments[${String(index)}].view`
            );
            const resolveTarget =
                attachment.resolveTarget === undefined
                    ? undefined
                    : requireTextureView(
                          device,
                          attachment.resolveTarget,
                          `renderPass.colorAttachments[${String(index)}].resolveTarget`
                      ).nativeHandle;
            return {
                view: view.nativeHandle,
                ...(resolveTarget === undefined ? {} : { resolveTarget }),
                ...(attachment.clearValue === undefined
                    ? {}
                    : { clearValue: attachment.clearValue }),
                loadOp: attachment.loadOp,
                storeOp: attachment.storeOp
            };
        }),
        ...(descriptor.depthStencilAttachment === undefined
            ? {}
            : {
                  depthStencilAttachment: (() => {
                      const attachment = descriptor.depthStencilAttachment;
                      const view = requireTextureView(
                          device,
                          attachment.view,
                          'renderPass.depthStencilAttachment.view'
                      );
                      const unusedDepth =
                          rhiTextureFormatHasDepth(view.format) && depthAspectUnused(attachment);
                      const unusedStencil =
                          rhiTextureFormatHasStencil(view.format) &&
                          stencilAspectUnused(attachment);
                      return {
                          view: view.nativeHandle,
                          ...(attachment.depthClearValue === undefined
                              ? {}
                              : { depthClearValue: attachment.depthClearValue }),
                          ...(attachment.depthLoadOp === undefined
                              ? {}
                              : { depthLoadOp: attachment.depthLoadOp }),
                          ...(attachment.depthStoreOp === undefined
                              ? {}
                              : { depthStoreOp: attachment.depthStoreOp }),
                          ...(unusedDepth
                              ? { depthReadOnly: true }
                              : attachment.depthReadOnly === undefined
                                ? {}
                                : { depthReadOnly: attachment.depthReadOnly }),
                          ...(attachment.stencilClearValue === undefined
                              ? {}
                              : { stencilClearValue: attachment.stencilClearValue }),
                          ...(attachment.stencilLoadOp === undefined
                              ? {}
                              : { stencilLoadOp: attachment.stencilLoadOp }),
                          ...(attachment.stencilStoreOp === undefined
                              ? {}
                              : { stencilStoreOp: attachment.stencilStoreOp }),
                          ...(unusedStencil
                              ? { stencilReadOnly: true }
                              : attachment.stencilReadOnly === undefined
                                ? {}
                                : { stencilReadOnly: attachment.stencilReadOnly })
                      };
                  })()
              })
    };
}

/** Exact native render-pass attachment descriptor cache for one device generation. */
export class WebGPUFramebufferCache {
    readonly #records: WebGPUFramebufferCacheRecord[] = [];
    #lastRecord: WebGPUFramebufferCacheRecord | null = null;
    #clock = 0;

    constructor(
        readonly device: WebGPUDevice,
        readonly metrics: RHICacheCounter
    ) {}

    lookup(descriptor: Readonly<RHIRenderPassDescriptor>): GPURenderPassDescriptor {
        let record = this.#lastRecord;
        if (record === null || !sameRenderPassDescriptor(record.descriptor, descriptor)) {
            record = null;
            let index = 0;
            while (index < this.#records.length) {
                const candidate = this.#records[index];
                index++;
                if (candidate === undefined) continue;
                if (sameRenderPassDescriptor(candidate.descriptor, descriptor)) {
                    record = candidate;
                    break;
                }
            }
        }
        if (record !== null) {
            record.lastUsed = ++this.#clock;
            this.#lastRecord = record;
            this.metrics.recordHit();
            return record.native;
        }

        // Cache records outlive the active pass backing, so retain an independent immutable key
        // only on misses. Hits compare directly against the caller-owned working snapshot.
        const retainedDescriptor = snapshotRHIRenderPassDescriptor(this.device, descriptor);
        const replacement: WebGPUFramebufferCacheRecord = {
            descriptor: retainedDescriptor,
            native: nativeRenderPassDescriptor(this.device, retainedDescriptor),
            lastUsed: ++this.#clock
        };
        if (this.#records.length === MAX_FRAMEBUFFER_RECORDS) {
            let oldestIndex = 0;
            for (let index = 1; index < this.#records.length; index += 1) {
                if (
                    (this.#records[index]?.lastUsed ?? Number.MAX_SAFE_INTEGER) <
                    (this.#records[oldestIndex]?.lastUsed ?? Number.MAX_SAFE_INTEGER)
                ) {
                    oldestIndex = index;
                }
            }
            this.#records[oldestIndex] = replacement;
            this.metrics.recordReplacement();
        } else {
            this.#records.push(replacement);
            this.metrics.recordInsertion();
        }
        this.#lastRecord = replacement;
        this.metrics.recordMiss();
        return replacement.native;
    }

    /** Drop cached descriptors as soon as a retained attachment view is released. */
    releaseView(viewId: number): void {
        let removed = 0;
        for (let index = this.#records.length - 1; index >= 0; index -= 1) {
            const record = this.#records[index];
            if (record === undefined || !usesView(record, viewId)) continue;
            if (this.#lastRecord === record) this.#lastRecord = null;
            this.#records.splice(index, 1);
            removed++;
        }
        if (removed > 0) this.metrics.recordRemoval(removed);
    }

    clear(): void {
        this.#records.length = 0;
        this.#lastRecord = null;
        this.metrics.clear();
    }
}
