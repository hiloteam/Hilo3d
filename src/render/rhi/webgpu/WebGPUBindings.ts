import type {
    RHIBindGroup,
    RHIBindGroupDescriptor,
    RHIBindGroupEntry,
    RHIBindGroupLayout,
    RHIBindGroupLayoutDescriptor,
    RHIBindGroupLayoutEntry,
    RHIBufferBinding,
    RHIPipelineLayout,
    RHIPipelineLayoutDescriptor,
    RHIRenderPipeline,
    RHIRenderPipelineDescriptor,
    RHIShaderModule
} from '../RHI';
import type { WebGPUDevice } from './WebGPUDevice';
import { WebGPUObject, assertOwner, labelOf, owners } from './WebGPUBase';
import {
    WebGPUBuffer,
    WebGPUSampler,
    WebGPUShaderModule,
    WebGPUTextureView
} from './WebGPUResources';

export function nativeBindGroupLayoutEntry(
    entry: RHIBindGroupLayoutEntry
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

const bindGroupLayoutSnapshots = new WeakSet();

export function snapshotBindGroupLayoutDescriptor(
    descriptor: RHIBindGroupLayoutDescriptor
): RHIBindGroupLayoutDescriptor {
    if (bindGroupLayoutSnapshots.has(descriptor)) return descriptor;
    const bindings = new Set<number>();
    const entries = descriptor.entries.map(entry => {
        if (bindings.has(entry.binding)) {
            throw new TypeError(`Duplicate bind group layout binding ${String(entry.binding)}`);
        }
        bindings.add(entry.binding);
        const kindCount =
            Number(entry.buffer !== undefined) +
            Number(entry.sampler !== undefined) +
            Number(entry.texture !== undefined) +
            Number(entry.storageTexture !== undefined);
        if (kindCount !== 1) {
            throw new TypeError(
                `Bind group layout binding ${String(entry.binding)} must declare exactly one resource kind`
            );
        }
        return Object.freeze({
            binding: entry.binding,
            visibility: entry.visibility,
            ...(entry.buffer === undefined ? {} : { buffer: Object.freeze({ ...entry.buffer }) }),
            ...(entry.sampler === undefined
                ? {}
                : { sampler: Object.freeze({ ...entry.sampler }) }),
            ...(entry.texture === undefined
                ? {}
                : { texture: Object.freeze({ ...entry.texture }) }),
            ...(entry.storageTexture === undefined
                ? {}
                : { storageTexture: Object.freeze({ ...entry.storageTexture }) })
        });
    });
    entries.sort((left, right) => left.binding - right.binding);
    const snapshot: RHIBindGroupLayoutDescriptor = Object.freeze({
        ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
        entries: Object.freeze(entries)
    });
    bindGroupLayoutSnapshots.add(snapshot);
    return snapshot;
}

export class WebGPUBindGroupLayout extends WebGPUObject implements RHIBindGroupLayout {
    readonly entries: readonly RHIBindGroupLayoutEntry[];
    readonly #nativeHandle: GPUBindGroupLayout;

    constructor(
        device: WebGPUDevice,
        nativeHandle: GPUBindGroupLayout,
        descriptor: RHIBindGroupLayoutDescriptor
    ) {
        super(labelOf(nativeHandle, descriptor.label));
        this.#nativeHandle = nativeHandle;
        this.entries = snapshotBindGroupLayoutDescriptor(descriptor).entries;
        owners.set(this, device);
    }

    /** @internal */
    get nativeHandle(): GPUBindGroupLayout {
        return this.#nativeHandle;
    }
}

const pipelineLayoutSnapshots = new WeakSet();

export function snapshotPipelineLayoutDescriptor(
    descriptor: RHIPipelineLayoutDescriptor
): RHIPipelineLayoutDescriptor {
    if (pipelineLayoutSnapshots.has(descriptor)) return descriptor;
    const snapshot: RHIPipelineLayoutDescriptor = Object.freeze({
        ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
        bindGroupLayouts: Object.freeze([...descriptor.bindGroupLayouts])
    });
    pipelineLayoutSnapshots.add(snapshot);
    return snapshot;
}

export class WebGPUPipelineLayout extends WebGPUObject implements RHIPipelineLayout {
    readonly bindGroupLayouts: readonly WebGPUBindGroupLayout[];
    readonly #nativeHandle: GPUPipelineLayout;

    constructor(
        device: WebGPUDevice,
        nativeHandle: GPUPipelineLayout,
        descriptor: RHIPipelineLayoutDescriptor
    ) {
        super(labelOf(nativeHandle, descriptor.label));
        this.#nativeHandle = nativeHandle;
        const snapshot = snapshotPipelineLayoutDescriptor(descriptor);
        this.bindGroupLayouts = Object.freeze(
            snapshot.bindGroupLayouts.map(layout => {
                if (!(layout instanceof WebGPUBindGroupLayout)) {
                    throw new TypeError('Expected a WebGPU bind group layout');
                }
                assertOwner(layout, device, 'Bind group layout');
                return layout;
            })
        );
        owners.set(this, device);
    }

    /** @internal */
    get nativeHandle(): GPUPipelineLayout {
        return this.#nativeHandle;
    }
}

export function nativeBindGroupEntry(
    entry: RHIBindGroupEntry,
    device: WebGPUDevice
): GPUBindGroupEntry {
    const resource = entry.resource;
    if (resource instanceof WebGPUSampler) {
        assertOwner(resource, device, 'Sampler');
        return { binding: entry.binding, resource: resource.nativeHandle };
    }
    if (resource instanceof WebGPUTextureView) {
        assertOwner(resource, device, 'Texture view');
        return { binding: entry.binding, resource: resource.nativeHandle };
    }
    const binding = resource as RHIBufferBinding;
    if (!(binding.buffer instanceof WebGPUBuffer)) {
        throw new TypeError('Expected a WebGPU sampler, texture view, or buffer binding');
    }
    assertOwner(binding.buffer, device, 'Buffer');
    if (binding.buffer.destroyed) throw new Error('WebGPU buffer is destroyed');
    return {
        binding: entry.binding,
        resource: {
            buffer: binding.buffer.nativeHandle,
            ...(binding.offset === undefined ? {} : { offset: binding.offset }),
            ...(binding.size === undefined ? {} : { size: binding.size })
        }
    };
}

const bindGroupSnapshots = new WeakSet();

export function snapshotBindGroupDescriptor(
    descriptor: RHIBindGroupDescriptor
): RHIBindGroupDescriptor {
    if (bindGroupSnapshots.has(descriptor)) return descriptor;
    const entries = descriptor.entries.map(entry => {
        let resource: RHIBindGroupEntry['resource'];
        if (
            entry.resource instanceof WebGPUSampler ||
            entry.resource instanceof WebGPUTextureView
        ) {
            resource = entry.resource;
        } else {
            const binding = entry.resource as RHIBufferBinding;
            resource = Object.freeze({
                buffer: binding.buffer,
                ...(binding.offset === undefined ? {} : { offset: binding.offset }),
                ...(binding.size === undefined ? {} : { size: binding.size })
            });
        }
        return Object.freeze({ binding: entry.binding, resource });
    });
    const snapshot: RHIBindGroupDescriptor = Object.freeze({
        ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
        layout: descriptor.layout,
        entries: Object.freeze(entries)
    });
    bindGroupSnapshots.add(snapshot);
    return snapshot;
}

export class WebGPUBindGroup extends WebGPUObject implements RHIBindGroup {
    readonly layout: WebGPUBindGroupLayout;
    readonly entries: readonly RHIBindGroupEntry[];
    readonly #nativeHandle: GPUBindGroup;

    constructor(
        device: WebGPUDevice,
        nativeHandle: GPUBindGroup,
        descriptor: RHIBindGroupDescriptor
    ) {
        super(labelOf(nativeHandle, descriptor.label));
        if (!(descriptor.layout instanceof WebGPUBindGroupLayout)) {
            throw new TypeError('Expected a WebGPU bind group layout');
        }
        const layout = descriptor.layout;
        assertOwner(layout, device, 'Bind group layout');
        const snapshot = snapshotBindGroupDescriptor(descriptor);
        this.#nativeHandle = nativeHandle;
        this.layout = layout;
        this.entries = snapshot.entries;
        owners.set(this, device);
    }

    /** @internal */
    get nativeHandle(): GPUBindGroup {
        return this.#nativeHandle;
    }
}

export function shaderModule(
    module: RHIShaderModule,
    device: WebGPUDevice,
    stage: 'Vertex' | 'Fragment'
): WebGPUShaderModule {
    if (!(module instanceof WebGPUShaderModule)) {
        throw new TypeError(`${stage} shader module is not a WebGPU shader module`);
    }
    assertOwner(module, device, 'Shader module');
    if (module.stage !== stage.toLowerCase()) {
        throw new TypeError(`${stage} pipeline stage received a ${module.stage} shader module`);
    }
    return module;
}

export function nativeRenderPipelineDescriptor(
    descriptor: RHIRenderPipelineDescriptor,
    device: WebGPUDevice
): GPURenderPipelineDescriptor {
    const vertexModule = shaderModule(descriptor.vertex.module, device, 'Vertex');
    if (!(descriptor.layout instanceof WebGPUPipelineLayout)) {
        throw new TypeError('Expected a WebGPU pipeline layout');
    }
    assertOwner(descriptor.layout, device, 'Pipeline layout');
    return {
        ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
        layout: descriptor.layout.nativeHandle,
        vertex: {
            module: vertexModule.nativeHandle,
            ...(descriptor.vertex.entryPoint === undefined
                ? {}
                : { entryPoint: descriptor.vertex.entryPoint }),
            ...(descriptor.vertex.buffers === undefined
                ? {}
                : {
                      buffers: descriptor.vertex.buffers.map(buffer =>
                          buffer === null
                              ? null
                              : {
                                    arrayStride: buffer.arrayStride,
                                    ...(buffer.stepMode === undefined
                                        ? {}
                                        : { stepMode: buffer.stepMode }),
                                    attributes: buffer.attributes.map(attribute => ({
                                        format: attribute.format,
                                        offset: attribute.offset,
                                        shaderLocation: attribute.shaderLocation
                                    }))
                                }
                      )
                  })
        },
        ...(descriptor.primitive === undefined
            ? {}
            : {
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
                  }
              }),
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
        ...(descriptor.fragment === undefined
            ? {}
            : {
                  fragment: {
                      module: shaderModule(descriptor.fragment.module, device, 'Fragment')
                          .nativeHandle,
                      ...(descriptor.fragment.entryPoint === undefined
                          ? {}
                          : { entryPoint: descriptor.fragment.entryPoint }),
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

const renderPipelineSnapshots = new WeakSet();

export function snapshotRenderPipelineDescriptor(
    descriptor: RHIRenderPipelineDescriptor
): RHIRenderPipelineDescriptor {
    if (renderPipelineSnapshots.has(descriptor)) return descriptor;
    const vertex = Object.freeze({
        module: descriptor.vertex.module,
        ...(descriptor.vertex.entryPoint === undefined
            ? {}
            : { entryPoint: descriptor.vertex.entryPoint }),
        ...(descriptor.vertex.buffers === undefined
            ? {}
            : {
                  buffers: Object.freeze(
                      descriptor.vertex.buffers.map(buffer =>
                          buffer === null
                              ? null
                              : Object.freeze({
                                    arrayStride: buffer.arrayStride,
                                    ...(buffer.stepMode === undefined
                                        ? {}
                                        : { stepMode: buffer.stepMode }),
                                    attributes: Object.freeze(
                                        buffer.attributes.map(attribute =>
                                            Object.freeze({ ...attribute })
                                        )
                                    )
                                })
                      )
                  )
              })
    });
    const depthStencil =
        descriptor.depthStencil === undefined
            ? undefined
            : Object.freeze({
                  ...descriptor.depthStencil,
                  ...(descriptor.depthStencil.stencilFront === undefined
                      ? {}
                      : {
                            stencilFront: Object.freeze({ ...descriptor.depthStencil.stencilFront })
                        }),
                  ...(descriptor.depthStencil.stencilBack === undefined
                      ? {}
                      : { stencilBack: Object.freeze({ ...descriptor.depthStencil.stencilBack }) })
              });
    const fragment =
        descriptor.fragment === undefined
            ? undefined
            : Object.freeze({
                  module: descriptor.fragment.module,
                  ...(descriptor.fragment.entryPoint === undefined
                      ? {}
                      : { entryPoint: descriptor.fragment.entryPoint }),
                  targets: Object.freeze(
                      descriptor.fragment.targets.map(target =>
                          target === null
                              ? null
                              : Object.freeze({
                                    format: target.format,
                                    ...(target.blend === undefined
                                        ? {}
                                        : {
                                              blend: Object.freeze({
                                                  color: Object.freeze({ ...target.blend.color }),
                                                  alpha: Object.freeze({ ...target.blend.alpha })
                                              })
                                          }),
                                    ...(target.writeMask === undefined
                                        ? {}
                                        : { writeMask: target.writeMask })
                                })
                      )
                  )
              });
    const snapshot: RHIRenderPipelineDescriptor = Object.freeze({
        ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
        layout: descriptor.layout,
        vertex,
        ...(descriptor.primitive === undefined
            ? {}
            : { primitive: Object.freeze({ ...descriptor.primitive }) }),
        ...(depthStencil === undefined ? {} : { depthStencil }),
        ...(descriptor.multisample === undefined
            ? {}
            : { multisample: Object.freeze({ ...descriptor.multisample }) }),
        ...(fragment === undefined ? {} : { fragment })
    });
    renderPipelineSnapshots.add(snapshot);
    return snapshot;
}

export class WebGPURenderPipeline extends WebGPUObject implements RHIRenderPipeline {
    readonly descriptor: RHIRenderPipelineDescriptor;
    readonly #nativeHandle: GPURenderPipeline;

    constructor(
        device: WebGPUDevice,
        nativeHandle: GPURenderPipeline,
        descriptor: RHIRenderPipelineDescriptor
    ) {
        super(labelOf(nativeHandle, descriptor.label));
        this.#nativeHandle = nativeHandle;
        this.descriptor = snapshotRenderPipelineDescriptor(descriptor);
        owners.set(this, device);
    }

    /** @internal */
    get nativeHandle(): GPURenderPipeline {
        return this.#nativeHandle;
    }

    getBindGroupLayout(index: number): WebGPUBindGroupLayout {
        const layout = this.descriptor.layout.bindGroupLayouts[index];
        if (!layout) throw new RangeError(`No bind group layout exists at index ${String(index)}`);
        if (!(layout instanceof WebGPUBindGroupLayout)) {
            throw new TypeError('Expected a WebGPU bind group layout');
        }
        return layout;
    }
}
