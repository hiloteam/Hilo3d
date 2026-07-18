import type {
    RHIBindGroup,
    RHIBindGroupDescriptor,
    RHIBindGroupEntry,
    RHIBindGroupLayout,
    RHIBindGroupLayoutDescriptor,
    RHIComputePipeline,
    RHIComputePipelineDescriptor,
    RHIGraphicsPipeline,
    RHIGraphicsPipelineDescriptor,
    RHIPipelineLayout,
    RHIPipelineLayoutDescriptor,
    RHIVertexInputBindings
} from '../../core/RHIPipeline';
import type { RHIDeviceOwnedDestroyable } from '../../core/RHIResources';
import { RHIValidationError } from '../../core/RHIValidation';
import { WebGPUResource, assertNonNegativeSafeInteger } from './WebGPUBase';
import type { WebGPUDevice } from './WebGPUDevice';
import {
    WebGPUBuffer,
    WebGPUSampler,
    type WebGPUShader,
    WebGPUTextureView
} from './WebGPUResources';

export interface WebGPUDynamicBufferBinding {
    readonly binding: number;
    readonly buffer: WebGPUBuffer;
    readonly baseOffset: number;
    readonly size: number;
    readonly alignment: number;
}

export class WebGPUBindGroupLayout
    extends WebGPUResource<RHIBindGroupLayoutDescriptor>
    implements RHIBindGroupLayout
{
    readonly descriptor: Readonly<RHIBindGroupLayoutDescriptor>;
    readonly entries;
    readonly dynamicBindings: readonly number[];
    readonly #nativeHandle: GPUBindGroupLayout;

    constructor(
        owner: WebGPUDevice,
        nativeHandle: GPUBindGroupLayout,
        descriptor: Readonly<RHIBindGroupLayoutDescriptor>
    ) {
        super(
            owner,
            descriptor.label ?? '',
            descriptor.lifetime ?? 'persistent',
            'bindGroupLayout',
            'creation-only'
        );
        this.#nativeHandle = nativeHandle;
        this.descriptor = descriptor;
        this.entries = descriptor.entries;
        this.dynamicBindings = Object.freeze(
            descriptor.entries
                .filter(entry => entry.buffer?.hasDynamicOffset === true)
                .map(entry => entry.binding)
                .sort((left, right) => left - right)
        );
    }

    /** @internal */
    get nativeHandle(): GPUBindGroupLayout {
        return this.#nativeHandle;
    }
}

export class WebGPUPipelineLayout
    extends WebGPUResource<RHIPipelineLayoutDescriptor>
    implements RHIPipelineLayout
{
    readonly descriptor: Readonly<RHIPipelineLayoutDescriptor>;
    readonly bindGroupLayouts;
    readonly #nativeHandle: GPUPipelineLayout;

    constructor(
        owner: WebGPUDevice,
        nativeHandle: GPUPipelineLayout,
        descriptor: Readonly<RHIPipelineLayoutDescriptor>
    ) {
        super(
            owner,
            descriptor.label ?? '',
            descriptor.lifetime ?? 'persistent',
            'pipelineLayout',
            'creation-only'
        );
        this.#nativeHandle = nativeHandle;
        this.descriptor = descriptor;
        this.bindGroupLayouts = descriptor.bindGroupLayouts;
    }

    /** @internal */
    get nativeHandle(): GPUPipelineLayout {
        return this.#nativeHandle;
    }
}

export class WebGPUBindGroup
    extends WebGPUResource<RHIBindGroupDescriptor>
    implements RHIBindGroup
{
    readonly descriptor: Readonly<RHIBindGroupDescriptor>;
    readonly layout: WebGPUBindGroupLayout;
    readonly entries: readonly RHIBindGroupEntry[];
    readonly referencedResources: readonly RHIDeviceOwnedDestroyable[];
    readonly dynamicBufferBindings: readonly WebGPUDynamicBufferBinding[];
    readonly #nativeHandle: GPUBindGroup;

    constructor(
        owner: WebGPUDevice,
        nativeHandle: GPUBindGroup,
        descriptor: Readonly<RHIBindGroupDescriptor>,
        layout: WebGPUBindGroupLayout
    ) {
        super(
            owner,
            descriptor.label ?? '',
            descriptor.lifetime ?? 'persistent',
            'bindGroup',
            'creation-only'
        );
        this.#nativeHandle = nativeHandle;
        this.descriptor = descriptor;
        this.layout = layout;
        this.entries = descriptor.entries;

        const resources: RHIDeviceOwnedDestroyable[] = [];
        for (const entry of descriptor.entries) {
            if ('buffer' in entry.resource) {
                resources.push(entry.resource.buffer);
            } else {
                resources.push(entry.resource);
                if ('texture' in entry.resource) resources.push(entry.resource.texture);
            }
        }
        this.referencedResources = Object.freeze(resources);

        const dynamic: WebGPUDynamicBufferBinding[] = [];
        for (const binding of layout.dynamicBindings) {
            const layoutEntry = layout.entries.find(entry => entry.binding === binding);
            const bindGroupEntry = descriptor.entries.find(entry => entry.binding === binding);
            if (
                layoutEntry?.buffer === undefined ||
                bindGroupEntry === undefined ||
                !('buffer' in bindGroupEntry.resource) ||
                !(bindGroupEntry.resource.buffer instanceof WebGPUBuffer)
            ) {
                throw new RHIValidationError(
                    'incompatible-layout',
                    'dynamic binding has no WebGPU buffer',
                    `bindGroup.binding[${String(binding)}]`
                );
            }
            const bufferType = layoutEntry.buffer.type ?? 'uniform';
            const alignment =
                bufferType === 'uniform'
                    ? owner.capabilities.limits.minUniformBufferOffsetAlignment
                    : owner.capabilities.limits.minStorageBufferOffsetAlignment;
            if (alignment === undefined) {
                throw new RHIValidationError(
                    'unsupported-feature',
                    'dynamic storage buffer offsets are unsupported',
                    `bindGroup.binding[${String(binding)}]`
                );
            }
            const baseOffset = bindGroupEntry.resource.offset ?? 0;
            dynamic.push(
                Object.freeze({
                    binding,
                    buffer: bindGroupEntry.resource.buffer,
                    baseOffset,
                    size:
                        bindGroupEntry.resource.size ??
                        bindGroupEntry.resource.buffer.size - baseOffset,
                    alignment
                })
            );
        }
        this.dynamicBufferBindings = Object.freeze(dynamic);
    }

    /** @internal */
    get nativeHandle(): GPUBindGroup {
        return this.#nativeHandle;
    }
}

export class WebGPUGraphicsPipeline
    extends WebGPUResource<RHIGraphicsPipelineDescriptor>
    implements RHIGraphicsPipeline
{
    readonly descriptor: Readonly<RHIGraphicsPipelineDescriptor>;
    readonly requiredBindGroups: readonly boolean[];
    readonly requiredVertexBuffers: readonly boolean[];
    readonly #nativeHandle: GPURenderPipeline;

    constructor(
        owner: WebGPUDevice,
        nativeHandle: GPURenderPipeline,
        descriptor: Readonly<RHIGraphicsPipelineDescriptor>
    ) {
        super(
            owner,
            descriptor.label ?? '',
            descriptor.lifetime ?? 'persistent',
            'pipeline',
            'creation-only'
        );
        this.#nativeHandle = nativeHandle;
        this.descriptor = descriptor;

        const requiredBindGroups = new Array<boolean>(owner.capabilities.limits.maxBindGroups).fill(
            false
        );
        for (const binding of descriptor.vertex.shader.artifact.reflection.bindings) {
            requiredBindGroups[binding.group] = true;
        }
        for (const binding of descriptor.fragment?.shader.artifact.reflection.bindings ?? []) {
            requiredBindGroups[binding.group] = true;
        }
        this.requiredBindGroups = Object.freeze(requiredBindGroups);

        const usedLocations = new Set(
            (descriptor.vertex.shader.artifact.reflection.vertexInputs ?? []).map(
                input => input.location
            )
        );
        const buffers = descriptor.vertex.buffers ?? [];
        const requiredVertexBuffers = new Array<boolean>(buffers.length).fill(false);
        for (let slot = 0; slot < buffers.length; slot += 1) {
            const buffer = buffers[slot];
            requiredVertexBuffers[slot] =
                buffer?.attributes.some(attribute => usedLocations.has(attribute.shaderLocation)) ??
                false;
        }
        this.requiredVertexBuffers = Object.freeze(requiredVertexBuffers);
    }

    /** @internal */
    get nativeHandle(): GPURenderPipeline {
        return this.#nativeHandle;
    }

    getBindGroupLayout(index: number): RHIBindGroupLayout {
        assertNonNegativeSafeInteger(index, 'bindGroupLayout.index');
        const layout = this.descriptor.layout.bindGroupLayouts[index];
        if (layout === undefined) {
            throw new RHIValidationError(
                'out-of-bounds',
                'pipeline has no bind group layout at this index',
                'bindGroupLayout.index'
            );
        }
        return layout;
    }

    prepareVertexInput(bindings: Readonly<RHIVertexInputBindings>): void {
        // WebGPU pipelines encode vertex input directly; there is no native VAO to precompile.
        void bindings;
    }
}

export class WebGPUComputePipeline
    extends WebGPUResource<RHIComputePipelineDescriptor>
    implements RHIComputePipeline
{
    readonly descriptor: Readonly<RHIComputePipelineDescriptor>;
    readonly layout: WebGPUPipelineLayout;
    readonly requiredBindGroups: readonly boolean[];
    readonly #nativeHandle: GPUComputePipeline;

    constructor(
        owner: WebGPUDevice,
        nativeHandle: GPUComputePipeline,
        descriptor: Readonly<RHIComputePipelineDescriptor>,
        layout: WebGPUPipelineLayout
    ) {
        super(
            owner,
            descriptor.label ?? '',
            descriptor.lifetime ?? 'persistent',
            'pipeline',
            'creation-only'
        );
        this.#nativeHandle = nativeHandle;
        this.descriptor = descriptor;
        this.layout = layout;

        const requiredBindGroups = new Array<boolean>(owner.capabilities.limits.maxBindGroups).fill(
            false
        );
        for (const binding of descriptor.compute.shader.artifact.reflection.bindings) {
            requiredBindGroups[binding.group] = true;
        }
        this.requiredBindGroups = Object.freeze(requiredBindGroups);
    }

    /** @internal */
    get nativeHandle(): GPUComputePipeline {
        return this.#nativeHandle;
    }

    getBindGroupLayout(index: number): RHIBindGroupLayout {
        assertNonNegativeSafeInteger(index, 'bindGroupLayout.index');
        const layout = this.layout.bindGroupLayouts[index];
        if (layout === undefined) {
            throw new RHIValidationError(
                'out-of-bounds',
                'pipeline has no bind group layout at this index',
                'bindGroupLayout.index'
            );
        }
        return layout;
    }
}

export function nativeWebGPUBindGroupLayoutEntry(
    entry: RHIBindGroupLayoutDescriptor['entries'][number]
): GPUBindGroupLayoutEntry {
    return {
        binding: entry.binding,
        visibility: entry.visibility,
        ...(entry.buffer === undefined
            ? {}
            : {
                  buffer: {
                      ...(entry.buffer.type === undefined ? {} : { type: entry.buffer.type }),
                      ...(entry.buffer.hasDynamicOffset === undefined
                          ? {}
                          : { hasDynamicOffset: entry.buffer.hasDynamicOffset }),
                      ...(entry.buffer.minBindingSize === undefined
                          ? {}
                          : { minBindingSize: entry.buffer.minBindingSize })
                  }
              }),
        ...(entry.sampler === undefined
            ? {}
            : {
                  sampler: {
                      ...(entry.sampler.type === undefined ? {} : { type: entry.sampler.type })
                  }
              }),
        ...(entry.texture === undefined
            ? {}
            : {
                  texture: {
                      ...(entry.texture.sampleType === undefined
                          ? {}
                          : { sampleType: entry.texture.sampleType }),
                      ...(entry.texture.viewDimension === undefined
                          ? {}
                          : { viewDimension: entry.texture.viewDimension }),
                      ...(entry.texture.multisampled === undefined
                          ? {}
                          : { multisampled: entry.texture.multisampled })
                  }
              }),
        ...(entry.storageTexture === undefined
            ? {}
            : {
                  storageTexture: {
                      access: entry.storageTexture.access,
                      format: entry.storageTexture.format,
                      ...(entry.storageTexture.viewDimension === undefined
                          ? {}
                          : { viewDimension: entry.storageTexture.viewDimension })
                  }
              })
    };
}

export function nativeWebGPUBindGroupEntry(entry: RHIBindGroupEntry): GPUBindGroupEntry {
    if ('buffer' in entry.resource) {
        if (!(entry.resource.buffer instanceof WebGPUBuffer)) {
            throw new TypeError('Expected a WebGPU RHI buffer binding');
        }
        return {
            binding: entry.binding,
            resource: {
                buffer: entry.resource.buffer.nativeHandle,
                ...(entry.resource.offset === undefined ? {} : { offset: entry.resource.offset }),
                ...(entry.resource.size === undefined ? {} : { size: entry.resource.size })
            }
        };
    }
    if (entry.resource instanceof WebGPUSampler) {
        return { binding: entry.binding, resource: entry.resource.nativeHandle };
    }
    if (entry.resource instanceof WebGPUTextureView) {
        return { binding: entry.binding, resource: entry.resource.nativeHandle };
    }
    throw new TypeError('Expected a WebGPU RHI bind group resource');
}

function nativeWebGPUVertexBuffers(
    buffers: RHIGraphicsPipelineDescriptor['vertex']['buffers']
): (GPUVertexBufferLayout | null)[] | undefined {
    if (buffers === undefined) return undefined;
    return buffers.map(buffer =>
        buffer === null
            ? null
            : {
                  arrayStride: buffer.arrayStride,
                  ...(buffer.stepMode === undefined ? {} : { stepMode: buffer.stepMode }),
                  attributes: buffer.attributes.map(attribute => ({
                      format: attribute.format,
                      offset: attribute.offset,
                      shaderLocation: attribute.shaderLocation
                  }))
              }
    );
}

export function nativeWebGPUGraphicsPipelineDescriptor(
    descriptor: Readonly<RHIGraphicsPipelineDescriptor>,
    layout: WebGPUPipelineLayout,
    vertexShader: WebGPUShader,
    fragmentShader: WebGPUShader | undefined
): GPURenderPipelineDescriptor {
    const buffers = nativeWebGPUVertexBuffers(descriptor.vertex.buffers);
    return {
        ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
        layout: layout.nativeHandle,
        vertex: {
            module: vertexShader.nativeHandle,
            entryPoint: vertexShader.artifact.entryPoint,
            ...(buffers === undefined ? {} : { buffers })
        },
        primitive: {
            ...(descriptor.primitive.topology === undefined
                ? {}
                : { topology: descriptor.primitive.topology }),
            ...(descriptor.primitive.stripIndexFormat === undefined
                ? {}
                : { stripIndexFormat: descriptor.primitive.stripIndexFormat }),
            ...(descriptor.primitive.frontFace === undefined
                ? {}
                : { frontFace: descriptor.primitive.frontFace }),
            ...(descriptor.primitive.cullMode === undefined
                ? {}
                : { cullMode: descriptor.primitive.cullMode })
        },
        ...(descriptor.depthStencil === undefined
            ? {}
            : {
                  depthStencil: {
                      format: descriptor.depthStencil.format,
                      ...(descriptor.depthStencil.depthWriteEnabled === undefined
                          ? {}
                          : { depthWriteEnabled: descriptor.depthStencil.depthWriteEnabled }),
                      ...(descriptor.depthStencil.depthCompare === undefined
                          ? {}
                          : { depthCompare: descriptor.depthStencil.depthCompare }),
                      ...(descriptor.depthStencil.stencilFront === undefined
                          ? {}
                          : { stencilFront: { ...descriptor.depthStencil.stencilFront } }),
                      ...(descriptor.depthStencil.stencilBack === undefined
                          ? {}
                          : { stencilBack: { ...descriptor.depthStencil.stencilBack } }),
                      ...(descriptor.depthStencil.stencilReadMask === undefined
                          ? {}
                          : { stencilReadMask: descriptor.depthStencil.stencilReadMask }),
                      ...(descriptor.depthStencil.stencilWriteMask === undefined
                          ? {}
                          : { stencilWriteMask: descriptor.depthStencil.stencilWriteMask }),
                      ...(descriptor.depthStencil.depthBias === undefined
                          ? {}
                          : { depthBias: descriptor.depthStencil.depthBias }),
                      ...(descriptor.depthStencil.depthBiasSlopeScale === undefined
                          ? {}
                          : { depthBiasSlopeScale: descriptor.depthStencil.depthBiasSlopeScale }),
                      ...(descriptor.depthStencil.depthBiasClamp === undefined
                          ? {}
                          : { depthBiasClamp: descriptor.depthStencil.depthBiasClamp })
                  }
              }),
        ...(descriptor.multisample === undefined
            ? {}
            : { multisample: { ...descriptor.multisample } }),
        ...(descriptor.fragment === undefined || fragmentShader === undefined
            ? {}
            : {
                  fragment: {
                      module: fragmentShader.nativeHandle,
                      entryPoint: fragmentShader.artifact.entryPoint,
                      targets: descriptor.fragment.targets.map(target =>
                          target === null
                              ? null
                              : {
                                    format: target.format,
                                    ...(target.blend === undefined
                                        ? {}
                                        : {
                                              blend: {
                                                  color: { ...target.blend.color },
                                                  alpha: { ...target.blend.alpha }
                                              }
                                          }),
                                    ...(target.writeMask === undefined
                                        ? {}
                                        : { writeMask: target.writeMask })
                                }
                      )
                  }
              })
    };
}

export function nativeWebGPUComputePipelineDescriptor(
    descriptor: Readonly<RHIComputePipelineDescriptor>,
    layout: WebGPUPipelineLayout,
    shader: WebGPUShader
): GPUComputePipelineDescriptor {
    const constants = descriptor.compute.constants;
    const nativeConstants: Record<string, number> | undefined =
        constants === undefined
            ? undefined
            : Object.fromEntries(
                  Object.entries(constants).map(([name, value]) => [
                      name,
                      typeof value === 'boolean' ? Number(value) : value
                  ])
              );
    return {
        ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
        layout: layout.nativeHandle,
        compute: {
            module: shader.nativeHandle,
            entryPoint: shader.artifact.entryPoint,
            ...(nativeConstants === undefined ? {} : { constants: nativeConstants })
        }
    };
}
