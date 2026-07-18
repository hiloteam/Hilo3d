import type { RHIComputePassEncoder, RHIComputePassState } from '../../core/RHICommands';
import {
    validateRHIDispatchWorkgroups,
    validateRHIDispatchWorkgroupsIndirect
} from '../../core/RHICommandValidation';
import type { RHIBindGroup, RHIComputePipeline } from '../../core/RHIPipeline';
import type { RHIBuffer } from '../../core/RHIResources';
import type { RHIUInt32View } from '../../core/RHITypes';
import { RHIValidationError } from '../../core/RHIValidation';
import { WebGPUObject, assertNonNegativeSafeInteger } from './WebGPUBase';
import type { WebGPUCommandContext } from './WebGPUCommands';
import type { WebGPUDevice } from './WebGPUDevice';
import { WebGPUBindGroup, WebGPUComputePipeline } from './WebGPUPipeline';
import { WebGPUBuffer } from './WebGPUResources';

function validationFailure(
    code: ConstructorParameters<typeof RHIValidationError>[0],
    message: string,
    path: string
): never {
    throw new RHIValidationError(code, message, path);
}

function webGPUBuffer(device: WebGPUDevice, buffer: RHIBuffer, path: string): WebGPUBuffer {
    device.assertUsable(buffer, path);
    if (!(buffer instanceof WebGPUBuffer) || buffer.owner !== device) {
        return validationFailure('wrong-device', 'expected a WebGPU RHI buffer', path);
    }
    return buffer;
}

/** Queue-owned compute-pass backing reused at the pass high-water mark. */
export class WebGPUComputePassStorage {
    readonly boundBindGroups: (WebGPUBindGroup | null)[];
    readonly nativeDescriptor: GPUComputePassDescriptor = { label: '' };

    constructor(readonly owner: WebGPUDevice) {
        this.boundBindGroups = new Array<WebGPUBindGroup | null>(
            owner.capabilities.limits.maxBindGroups
        ).fill(null);
    }

    prepare(label: string): GPUComputePassDescriptor {
        this.boundBindGroups.fill(null);
        this.nativeDescriptor.label = label;
        return this.nativeDescriptor;
    }

    release(): void {
        this.boundBindGroups.fill(null);
        this.nativeDescriptor.label = '';
    }
}

export class WebGPUComputePass extends WebGPUObject implements RHIComputePassEncoder {
    readonly contextId: number;
    readonly #storage: WebGPUComputePassStorage;
    readonly #nativePass: GPUComputePassEncoder;
    readonly #boundBindGroups: (WebGPUBindGroup | null)[];
    #passState: RHIComputePassState = 'open';
    #pipeline: WebGPUComputePipeline | null = null;

    constructor(
        readonly context: WebGPUCommandContext,
        nativePass: GPUComputePassEncoder,
        storage: WebGPUComputePassStorage,
        label: string
    ) {
        super(context.owner, label || 'WebGPU compute pass');
        this.contextId = context.id;
        this.#nativePass = nativePass;
        this.#storage = storage;
        this.#boundBindGroups = storage.boundBindGroups;
    }

    get state(): RHIComputePassState {
        return this.#passState;
    }

    setPipeline(pipeline: RHIComputePipeline): void {
        this.assertOpen();
        this.context.owner.assertUsable(pipeline, 'pipeline');
        if (!(pipeline instanceof WebGPUComputePipeline) || pipeline.owner !== this.owner) {
            validationFailure('wrong-device', 'expected a WebGPU compute pipeline', 'pipeline');
        }
        this.context.retain(pipeline);
        this.context.diagnostics.commandCount += 1;
        if (this.#pipeline === pipeline) return;
        this.#nativePass.setPipeline(pipeline.nativeHandle);
        this.#pipeline = pipeline;
        this.context.diagnostics.pipelineSwitches += 1;
        this.context.diagnostics.computePipelineSwitches += 1;
        this.context.diagnostics.nativeStateCalls += 1;
    }

    setBindGroup(index: number, bindGroup: RHIBindGroup, dynamicOffsets?: RHIUInt32View): void {
        this.assertOpen();
        assertNonNegativeSafeInteger(index, 'bindGroup.index');
        if (index >= this.#boundBindGroups.length) {
            validationFailure('out-of-bounds', 'bind group index exceeds device limit', 'index');
        }
        this.context.owner.assertUsable(bindGroup, 'bindGroup');
        if (!(bindGroup instanceof WebGPUBindGroup) || bindGroup.owner !== this.owner) {
            validationFailure('wrong-device', 'expected a WebGPU RHI bind group', 'bindGroup');
        }
        if (this.#pipeline !== null) {
            this.validateBindGroupLayout(index, bindGroup, this.#pipeline);
        }
        this.validateDynamicOffsets(bindGroup, dynamicOffsets);
        this.context.retain(bindGroup);
        let resourceIndex = 0;
        while (resourceIndex < bindGroup.referencedResources.length) {
            const resource = bindGroup.referencedResources[resourceIndex];
            resourceIndex += 1;
            if (resource !== undefined) this.context.retain(resource);
        }
        this.context.diagnostics.commandCount += 1;
        if (dynamicOffsets === undefined && this.#boundBindGroups[index] === bindGroup) return;
        if (dynamicOffsets === undefined) {
            this.#nativePass.setBindGroup(index, bindGroup.nativeHandle);
        } else {
            this.#nativePass.setBindGroup(index, bindGroup.nativeHandle, dynamicOffsets);
        }
        this.#boundBindGroups[index] = bindGroup;
        this.context.diagnostics.bindGroupSwitches += 1;
        this.context.diagnostics.computeBindGroupSwitches += 1;
        this.context.diagnostics.nativeStateCalls += 1;
    }

    dispatchWorkgroups(x: number, y = 1, z = 1): void {
        this.assertOpen();
        this.assertPipelineAndBindings();
        validateRHIDispatchWorkgroups(this.owner, x, y, z);
        this.#nativePass.dispatchWorkgroups(x, y, z);
        this.context.diagnostics.commandCount += 1;
        this.context.diagnostics.dispatchCount += 1;
        this.context.diagnostics.dispatchedWorkgroupCount += x * y * z;
        this.context.diagnostics.nativeStateCalls += 1;
    }

    dispatchWorkgroupsIndirect(buffer: RHIBuffer, offset = 0): void {
        this.assertOpen();
        this.assertPipelineAndBindings();
        validateRHIDispatchWorkgroupsIndirect(this.owner, buffer, offset);
        const nativeBuffer = webGPUBuffer(this.owner, buffer, 'dispatchWorkgroupsIndirect.buffer');
        this.context.retain(nativeBuffer);
        this.#nativePass.dispatchWorkgroupsIndirect(nativeBuffer.nativeHandle, offset);
        this.context.diagnostics.commandCount += 1;
        this.context.diagnostics.dispatchCount += 1;
        this.context.diagnostics.nativeStateCalls += 1;
    }

    end(): void {
        this.assertOpen();
        this.#nativePass.end();
        this.context.diagnostics.commandCount += 1;
        this.context.diagnostics.nativeStateCalls += 1;
        this.#passState = 'ended';
        this.#pipeline = null;
        this.context.closeComputePass(this, this.#storage);
    }

    /** @internal */
    abort(): void {
        if (this.#passState !== 'open') return;
        this.#passState = 'aborted';
        this.#pipeline = null;
        this.context.abortComputePass(this, this.#storage);
    }

    private assertOpen(): void {
        this.context.owner.assertUsable(this, 'computePass');
        if (this.#passState !== 'open' || this.context.state !== 'compute-pass') {
            validationFailure('invalid-state', `compute pass is ${this.#passState}`, 'computePass');
        }
    }

    private validateBindGroupLayout(
        index: number,
        bindGroup: WebGPUBindGroup,
        pipeline: WebGPUComputePipeline
    ): void {
        if (pipeline.layout.bindGroupLayouts[index] !== bindGroup.layout) {
            validationFailure(
                'incompatible-layout',
                'bind group layout does not match pipeline',
                `bindGroup[${String(index)}]`
            );
        }
    }

    private validateDynamicOffsets(
        bindGroup: WebGPUBindGroup,
        dynamicOffsets: RHIUInt32View | undefined
    ): void {
        const bindings = bindGroup.dynamicBufferBindings;
        const count = dynamicOffsets?.length ?? 0;
        if (count !== bindings.length) {
            validationFailure(
                'incompatible-layout',
                'dynamic offset count does not match bind group layout',
                'dynamicOffsets'
            );
        }
        for (let index = 0; index < bindings.length; index += 1) {
            const binding = bindings[index];
            const offset = dynamicOffsets?.[index];
            if (binding === undefined || offset === undefined) continue;
            if (offset % binding.alignment !== 0) {
                validationFailure(
                    'invalid-descriptor',
                    'dynamic offset does not meet device alignment',
                    `dynamicOffsets[${String(index)}]`
                );
            }
            if (
                binding.baseOffset > binding.buffer.size ||
                offset > binding.buffer.size - binding.baseOffset ||
                binding.size > binding.buffer.size - binding.baseOffset - offset
            ) {
                validationFailure(
                    'out-of-bounds',
                    'dynamic buffer binding exceeds buffer size',
                    `dynamicOffsets[${String(index)}]`
                );
            }
        }
    }

    private assertPipelineAndBindings(): WebGPUComputePipeline {
        const pipeline = this.#pipeline;
        if (pipeline === null) {
            return validationFailure(
                'invalid-state',
                'dispatch requires a compute pipeline',
                'pipeline'
            );
        }
        for (let index = 0; index < pipeline.requiredBindGroups.length; index += 1) {
            if (pipeline.requiredBindGroups[index] !== true) continue;
            const bindGroup = this.#boundBindGroups[index];
            if (bindGroup === null || bindGroup === undefined) {
                validationFailure(
                    'invalid-state',
                    'dispatch requires all pipeline bind groups',
                    `bindGroup[${String(index)}]`
                );
            }
            this.validateBindGroupLayout(index, bindGroup, pipeline);
        }
        return pipeline;
    }
}
