interface WebGPUBindGroupCommandState {
    readonly bindGroup: GPUBindGroup | null;
    readonly dynamicOffsets: readonly number[];
}

interface WebGPUVertexBufferCommandState {
    readonly buffer: GPUBuffer | null;
    readonly offset: number;
    readonly size: number | undefined;
}

interface WebGPUIndexBufferCommandState {
    readonly buffer: GPUBuffer;
    readonly format: GPUIndexFormat;
    readonly offset: number;
    readonly size: number | undefined;
}

type WebGPUViewportCommandState = readonly [
    x: number,
    y: number,
    width: number,
    height: number,
    minDepth: number,
    maxDepth: number
];

const EMPTY_DYNAMIC_OFFSETS: readonly number[] = Object.freeze([]);

function equalNumbers(left: readonly number[], right: readonly number[]): boolean {
    return (
        left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
    );
}

function selectedDynamicOffsets(
    data: Uint32Array,
    start: number,
    length: number
): readonly number[] {
    if (!Number.isSafeInteger(start) || start < 0) {
        throw new RangeError(
            'WebGPU dynamic offset data start must be a non-negative safe integer'
        );
    }
    if (!Number.isSafeInteger(length) || length < 0 || start + length > data.length) {
        throw new RangeError('WebGPU dynamic offset data length is outside the supplied array');
    }
    return Array.from(data.subarray(start, start + length));
}

/**
 * Deduplicates render commands whose state is already active in one GPURenderPassEncoder.
 *
 * A command is cached only after it is forwarded to the native encoder. `beginPass` always
 * clears the cache, including when a test double happens to reuse the same encoder object for
 * multiple logical passes.
 */
export default class WebGPUCommandState {
    private pass: GPURenderPassEncoder | null = null;
    private pipeline: GPURenderPipeline | null = null;
    private readonly bindGroups = new Map<number, WebGPUBindGroupCommandState>();
    private readonly vertexBuffers = new Map<number, WebGPUVertexBufferCommandState>();
    private indexBuffer: WebGPUIndexBufferCommandState | null = null;
    private viewport: WebGPUViewportCommandState | null = null;
    private stencilReference: number | null = null;

    /** Start a logical render pass and discard every command cached for the previous pass. */
    beginPass(pass: GPURenderPassEncoder): void {
        this.pass = pass;
        this.reset();
    }

    /** End the current logical render pass and release its encoder reference. */
    endPass(): void {
        this.pass = null;
        this.reset();
    }

    setPipeline(pipeline: GPURenderPipeline): void {
        if (this.pipeline === pipeline) return;
        this.requirePass().setPipeline(pipeline);
        this.pipeline = pipeline;
    }

    setBindGroup(
        index: number,
        bindGroup: GPUBindGroup | null,
        dynamicOffsets?: Iterable<number>
    ): void;
    setBindGroup(
        index: number,
        bindGroup: GPUBindGroup | null,
        dynamicOffsetsData: Uint32Array,
        dynamicOffsetsDataStart: number,
        dynamicOffsetsDataLength: number
    ): void;
    setBindGroup(
        index: number,
        bindGroup: GPUBindGroup | null,
        dynamicOffsets?: Iterable<number>,
        dynamicOffsetsDataStart?: number,
        dynamicOffsetsDataLength?: number
    ): void {
        let offsets = EMPTY_DYNAMIC_OFFSETS;
        let offsetDataRange: {
            readonly data: Uint32Array;
            readonly start: number;
            readonly length: number;
        } | null = null;
        const usesDataRange =
            dynamicOffsetsDataStart !== undefined || dynamicOffsetsDataLength !== undefined;
        if (usesDataRange) {
            if (
                !(dynamicOffsets instanceof Uint32Array) ||
                dynamicOffsetsDataStart === undefined ||
                dynamicOffsetsDataLength === undefined
            ) {
                throw new TypeError(
                    'WebGPU dynamic offset data ranges require a Uint32Array, start, and length'
                );
            }
            offsets = selectedDynamicOffsets(
                dynamicOffsets,
                dynamicOffsetsDataStart,
                dynamicOffsetsDataLength
            );
            offsetDataRange = {
                data: dynamicOffsets,
                start: dynamicOffsetsDataStart,
                length: dynamicOffsetsDataLength
            };
        } else if (dynamicOffsets !== undefined) {
            offsets = Array.from(dynamicOffsets);
        }

        const cached = this.bindGroups.get(index);
        if (cached?.bindGroup === bindGroup && equalNumbers(cached.dynamicOffsets, offsets)) {
            return;
        }

        const pass = this.requirePass();
        if (offsetDataRange) {
            pass.setBindGroup(
                index,
                bindGroup,
                offsetDataRange.data,
                offsetDataRange.start,
                offsetDataRange.length
            );
        } else if (dynamicOffsets === undefined) {
            pass.setBindGroup(index, bindGroup);
        } else {
            pass.setBindGroup(index, bindGroup, [...offsets]);
        }
        this.bindGroups.set(index, { bindGroup, dynamicOffsets: offsets });
    }

    setVertexBuffer(slot: number, buffer: GPUBuffer | null, offset?: number, size?: number): void {
        const resolvedOffset = offset ?? 0;
        const cached = this.vertexBuffers.get(slot);
        if (
            cached?.buffer === buffer &&
            Object.is(cached.offset, resolvedOffset) &&
            Object.is(cached.size, size)
        ) {
            return;
        }

        const pass = this.requirePass();
        if (size !== undefined) pass.setVertexBuffer(slot, buffer, resolvedOffset, size);
        else if (offset !== undefined) pass.setVertexBuffer(slot, buffer, offset);
        else pass.setVertexBuffer(slot, buffer);
        this.vertexBuffers.set(slot, { buffer, offset: resolvedOffset, size });
    }

    setIndexBuffer(
        buffer: GPUBuffer,
        format: GPUIndexFormat,
        offset?: number,
        size?: number
    ): void {
        const resolvedOffset = offset ?? 0;
        const cached = this.indexBuffer;
        if (
            cached?.buffer === buffer &&
            cached.format === format &&
            Object.is(cached.offset, resolvedOffset) &&
            Object.is(cached.size, size)
        ) {
            return;
        }

        const pass = this.requirePass();
        if (size !== undefined) pass.setIndexBuffer(buffer, format, resolvedOffset, size);
        else if (offset !== undefined) pass.setIndexBuffer(buffer, format, offset);
        else pass.setIndexBuffer(buffer, format);
        this.indexBuffer = { buffer, format, offset: resolvedOffset, size };
    }

    setViewport(
        x: number,
        y: number,
        width: number,
        height: number,
        minDepth: number,
        maxDepth: number
    ): void {
        const cached = this.viewport;
        if (
            cached &&
            Object.is(cached[0], x) &&
            Object.is(cached[1], y) &&
            Object.is(cached[2], width) &&
            Object.is(cached[3], height) &&
            Object.is(cached[4], minDepth) &&
            Object.is(cached[5], maxDepth)
        ) {
            return;
        }
        this.requirePass().setViewport(x, y, width, height, minDepth, maxDepth);
        this.viewport = [x, y, width, height, minDepth, maxDepth];
    }

    setStencilReference(reference: number): void {
        if (Object.is(this.stencilReference, reference)) return;
        this.requirePass().setStencilReference(reference);
        this.stencilReference = reference;
    }

    private reset(): void {
        this.pipeline = null;
        this.bindGroups.clear();
        this.vertexBuffers.clear();
        this.indexBuffer = null;
        this.viewport = null;
        this.stencilReference = null;
    }

    private requirePass(): GPURenderPassEncoder {
        if (!this.pass) {
            throw new Error('WebGPU command state requires an active render pass');
        }
        return this.pass;
    }
}
