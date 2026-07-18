import {
    RHIBufferUsage,
    RHIColorWrite,
    RHIValidationError,
    snapshotRHIBindGroupDescriptor,
    snapshotRHIBindGroupLayoutDescriptor,
    snapshotRHIGraphicsPipelineDescriptor,
    snapshotRHIPipelineLayoutDescriptor,
    type RHIBindGroup,
    type RHIBindGroupDescriptor,
    type RHIBindGroupEntry,
    type RHIBindGroupLayout,
    type RHIBindGroupLayoutDescriptor,
    type RHIGraphicsPipeline,
    type RHIGraphicsPipelineDescriptor,
    type RHIPipelineLayout,
    type RHIPipelineLayoutDescriptor,
    type RHIUInt32View,
    type RHIVertexInputBindings
} from '../../core';
import type { WebGL2RHIDevice } from './WebGL2Device';
import {
    webGL2BlendFactor,
    webGL2BlendOperation,
    webGL2Compare,
    webGL2StencilOp,
    webGL2Topology,
    webGL2VertexFormatInfo
} from './WebGL2Formats';
import {
    WEBGL2_BIND_GROUP_OBJECT_KIND,
    WEBGL2_GRAPHICS_PIPELINE_OBJECT_KIND,
    WebGL2ResourceBase,
    requireNative,
    type WebGL2DestroyableBase,
    type WebGL2DestroyObserver
} from './WebGL2Internal';
import type {
    WebGL2Buffer,
    WebGL2Sampler,
    WebGL2Shader,
    WebGL2TextureView
} from './WebGL2Resources';
import type { WebGL2PipelineStatePlan } from './WebGL2State';

interface WebGL2PreparedBufferBinding {
    readonly kind: 'buffer';
    readonly buffer: WebGL2Buffer;
    readonly offset: number;
    readonly size: number;
}

interface WebGL2PreparedTextureBinding {
    readonly kind: 'texture';
    readonly view: WebGL2TextureView;
}

interface WebGL2PreparedSamplerBinding {
    readonly kind: 'sampler';
    readonly sampler: WebGL2Sampler;
}

type WebGL2PreparedBinding =
    WebGL2PreparedBufferBinding | WebGL2PreparedTextureBinding | WebGL2PreparedSamplerBinding;

interface WebGL2PreparedBindGroupData {
    readonly entries: readonly WebGL2PreparedBinding[];
    readonly dynamicBindings: readonly WebGL2PreparedBufferBinding[];
}

function prepareWebGL2BindGroup(
    owner: WebGL2RHIDevice,
    descriptor: Readonly<RHIBindGroupDescriptor>
): WebGL2PreparedBindGroupData {
    const entriesByBinding = new Map<number, RHIBindGroupEntry>();
    for (const entry of descriptor.entries) entriesByBinding.set(entry.binding, entry);
    const preparedEntries = new Array<WebGL2PreparedBinding>(descriptor.layout.entries.length);
    const dynamicEntryIndices: { readonly binding: number; readonly entryIndex: number }[] = [];
    for (let entryIndex = 0; entryIndex < descriptor.layout.entries.length; entryIndex += 1) {
        const layoutEntry = descriptor.layout.entries[entryIndex];
        if (layoutEntry === undefined) throw new Error('bind group layout entry is unavailable');
        const entry = entriesByBinding.get(layoutEntry.binding);
        if (entry === undefined)
            throw new Error(`bind group is missing binding ${String(layoutEntry.binding)}`);
        const resource = entry.resource;
        let prepared: WebGL2PreparedBinding;
        if ('buffer' in resource) {
            const buffer = owner.requireBuffer(resource.buffer);
            const offset = resource.offset ?? 0;
            prepared = Object.freeze({
                kind: 'buffer',
                buffer,
                offset,
                size: resource.size ?? buffer.size - offset
            });
            if (layoutEntry.buffer?.hasDynamicOffset === true) {
                dynamicEntryIndices.push({ binding: layoutEntry.binding, entryIndex });
            }
        } else if ('texture' in resource) {
            const view = owner.requireTextureView(resource);
            view.texture.validateSamplingView(view);
            prepared = Object.freeze({ kind: 'texture', view });
        } else {
            prepared = Object.freeze({ kind: 'sampler', sampler: owner.requireSampler(resource) });
        }
        preparedEntries[entryIndex] = prepared;
    }
    dynamicEntryIndices.sort((first, second) => first.binding - second.binding);
    const dynamicBindings = new Array<WebGL2PreparedBufferBinding>(dynamicEntryIndices.length);
    for (let index = 0; index < dynamicEntryIndices.length; index += 1) {
        const dynamicEntry = dynamicEntryIndices[index];
        const prepared =
            dynamicEntry === undefined ? undefined : preparedEntries[dynamicEntry.entryIndex];
        if (prepared?.kind !== 'buffer') {
            throw new Error('dynamic bind group entry is not a prepared buffer');
        }
        dynamicBindings[index] = prepared;
    }
    return {
        entries: Object.freeze(preparedEntries),
        dynamicBindings: Object.freeze(dynamicBindings)
    };
}

function assertPreparedObjectUsable(
    owner: WebGL2RHIDevice,
    object: WebGL2DestroyableBase,
    path: string
): void {
    if (owner.destroyed) {
        throw new RHIValidationError('destroyed-object', 'owner device is destroyed', path);
    }
    if (object.deviceId !== owner.id) {
        throw new RHIValidationError(
            'wrong-device',
            `belongs to device ${String(object.deviceId)}`,
            path
        );
    }
    if (object.deviceGeneration !== owner.generationValue) {
        throw new RHIValidationError(
            'stale-generation',
            `belongs to generation ${String(object.deviceGeneration)}, current generation is ${String(owner.generationValue)}`,
            path
        );
    }
    if (object.destroyed) {
        throw new RHIValidationError('destroyed-object', 'has been destroyed', path);
    }
}

export class WebGL2BindGroupLayout extends WebGL2ResourceBase implements RHIBindGroupLayout {
    readonly descriptor: Readonly<RHIBindGroupLayoutDescriptor>;
    readonly entries;

    constructor(owner: WebGL2RHIDevice, descriptor: RHIBindGroupLayoutDescriptor) {
        const normalized = snapshotRHIBindGroupLayoutDescriptor(descriptor, owner.capabilities);
        super(owner, normalized.label ?? '', normalized.lifetime ?? 'persistent');
        this.descriptor = normalized;
        this.entries = normalized.entries;
    }

    protected releaseNative(contextLost: boolean): void {
        void contextLost;
    }
}

export class WebGL2PipelineLayout extends WebGL2ResourceBase implements RHIPipelineLayout {
    readonly descriptor: Readonly<RHIPipelineLayoutDescriptor>;
    readonly bindGroupLayouts;

    constructor(owner: WebGL2RHIDevice, descriptor: RHIPipelineLayoutDescriptor) {
        const normalized = snapshotRHIPipelineLayoutDescriptor(owner, descriptor);
        super(owner, normalized.label ?? '', normalized.lifetime ?? 'persistent');
        this.descriptor = normalized;
        this.bindGroupLayouts = normalized.bindGroupLayouts;
    }

    protected releaseNative(contextLost: boolean): void {
        void contextLost;
    }
}

export class WebGL2BindGroup
    extends WebGL2ResourceBase
    implements RHIBindGroup, WebGL2DestroyObserver
{
    readonly descriptor: Readonly<RHIBindGroupDescriptor>;
    readonly layout;
    readonly entries;
    readonly dynamicOffsetCount: number;
    readonly #preparedEntries: readonly WebGL2PreparedBinding[];
    readonly #preparedEntryCount: number;
    readonly #dynamicBindings: readonly WebGL2PreparedBufferBinding[];
    /** @internal Observer-maintained fast-path bit; false falls back to an exact resource scan. */
    preparedResourcesValid = true;

    constructor(owner: WebGL2RHIDevice, descriptor: RHIBindGroupDescriptor) {
        const normalized = snapshotRHIBindGroupDescriptor(owner, descriptor);
        const prepared = prepareWebGL2BindGroup(owner, normalized);
        super(
            owner,
            normalized.label ?? '',
            normalized.lifetime ?? 'persistent',
            WEBGL2_BIND_GROUP_OBJECT_KIND
        );
        this.descriptor = normalized;
        this.layout = normalized.layout;
        this.entries = normalized.entries;
        this.#preparedEntries = prepared.entries;
        this.#preparedEntryCount = prepared.entries.length;
        this.#dynamicBindings = prepared.dynamicBindings;
        this.dynamicOffsetCount = prepared.dynamicBindings.length;
        this.subscribePreparedResources();
    }

    preparedBuffer(entryIndex: number): WebGL2PreparedBufferBinding {
        const entry = this.#preparedEntries[entryIndex];
        if (entry?.kind !== 'buffer') throw new Error('prepared binding is not a buffer');
        return entry;
    }

    preparedTextureView(entryIndex: number): WebGL2TextureView {
        const entry = this.#preparedEntries[entryIndex];
        if (entry?.kind !== 'texture') throw new Error('prepared binding is not a texture view');
        return entry.view;
    }

    preparedSampler(entryIndex: number): WebGL2Sampler {
        const entry = this.#preparedEntries[entryIndex];
        if (entry?.kind !== 'sampler') throw new Error('prepared binding is not a sampler');
        return entry.sampler;
    }

    dynamicBuffer(index: number): WebGL2PreparedBufferBinding {
        const binding = this.#dynamicBindings[index];
        if (binding === undefined) throw new Error('dynamic binding plan is unavailable');
        return binding;
    }

    assertPreparedResourcesUsable(): void {
        assertPreparedObjectUsable(this.owner, this, 'bindGroup');
        if (this.preparedResourcesValid) return;
        let index = 0;
        while (index < this.#preparedEntryCount) {
            const entry = this.#preparedEntries[index++];
            if (entry === undefined) throw new Error('prepared bind group entry is unavailable');
            switch (entry.kind) {
                case 'buffer':
                    assertPreparedObjectUsable(this.owner, entry.buffer, 'buffer');
                    break;
                case 'texture':
                    assertPreparedObjectUsable(this.owner, entry.view, 'textureView');
                    assertPreparedObjectUsable(
                        this.owner,
                        entry.view.texture,
                        'textureView.texture'
                    );
                    break;
                case 'sampler':
                    assertPreparedObjectUsable(this.owner, entry.sampler, 'sampler');
                    break;
            }
        }
        this.preparedResourcesValid = true;
    }

    onWebGL2ObjectInvalidated(_object: WebGL2DestroyableBase): void {
        this.preparedResourcesValid = false;
    }

    protected releaseNative(contextLost: boolean): void {
        void contextLost;
        this.unsubscribePreparedResources();
    }

    private subscribePreparedResources(): void {
        let index = 0;
        while (index < this.#preparedEntryCount) {
            const entry = this.#preparedEntries[index++];
            if (entry === undefined) continue;
            switch (entry.kind) {
                case 'buffer':
                    entry.buffer.addDestroyObserver(this);
                    break;
                case 'texture':
                    entry.view.addDestroyObserver(this);
                    entry.view.texture.addDestroyObserver(this);
                    break;
                case 'sampler':
                    entry.sampler.addDestroyObserver(this);
                    break;
            }
        }
    }

    private unsubscribePreparedResources(): void {
        let index = 0;
        while (index < this.#preparedEntryCount) {
            const entry = this.#preparedEntries[index++];
            if (entry === undefined) continue;
            switch (entry.kind) {
                case 'buffer':
                    entry.buffer.removeDestroyObserver(this);
                    break;
                case 'texture':
                    entry.view.removeDestroyObserver(this);
                    entry.view.texture.removeDestroyObserver(this);
                    break;
                case 'sampler':
                    entry.sampler.removeDestroyObserver(this);
                    break;
            }
        }
    }
}

interface UniformBlockPlan {
    readonly group: number;
    readonly entryIndex: number;
    readonly point: number;
    readonly dynamicOffsetIndex: number;
}

interface CombinedSamplerPlan {
    readonly group: number;
    readonly textureEntryIndex: number;
    readonly samplerEntryIndex: number;
    readonly unit: number;
}

export interface WebGL2VertexBufferBinding {
    buffer: WebGL2Buffer | null;
    offset: number;
    size: number;
}

export interface WebGL2IndexBufferBinding {
    buffer: WebGL2Buffer | null;
    format: 'uint16' | 'uint32';
    offset: number;
    size: number;
}

export interface WebGL2BoundGroup {
    group: WebGL2BindGroup | null;
    readonly dynamicOffsets: RHIUInt32View;
    dynamicOffsetCount: number;
}

interface VertexArrayRecord {
    readonly native: WebGLVertexArrayObject;
    readonly buffers: (WebGL2Buffer | null)[];
    readonly offsets: number[];
    readonly sizes: number[];
    indexBuffer: WebGL2Buffer | null;
    indexFormat: 'uint16' | 'uint32';
    indexOffset: number;
    lastUsed: number;
    requestRecorded: boolean;
}

type WebGL2ColorTargetState = NonNullable<
    NonNullable<RHIGraphicsPipelineDescriptor['fragment']>['targets'][number]
>;

const MAX_VERTEX_ARRAY_RECORDS = 256;
const UNPREPARED_VERTEX_INPUT_ERROR = new RHIValidationError(
    'invalid-state',
    'vertex input was not prepared before draw execution',
    'renderPass.vertexInput'
);

function vertexArrayRecordHasDestroyedBuffer(record: VertexArrayRecord): boolean {
    if (record.indexBuffer?.destroyed === true) return true;
    let slot = 0;
    while (slot < record.buffers.length) {
        const buffer = record.buffers[slot++];
        if (buffer?.destroyed === true) return true;
    }
    return false;
}

function sameTargetState(
    first: NonNullable<RHIGraphicsPipelineDescriptor['fragment']>['targets'][number],
    second: NonNullable<RHIGraphicsPipelineDescriptor['fragment']>['targets'][number]
): boolean {
    if (first === null || second === null) return first === second;
    const firstBlend = first.blend;
    const secondBlend = second.blend;
    if ((first.writeMask ?? RHIColorWrite.ALL) !== (second.writeMask ?? RHIColorWrite.ALL))
        return false;
    if (firstBlend === undefined || secondBlend === undefined) return firstBlend === secondBlend;
    return (
        (firstBlend.color.operation ?? 'add') === (secondBlend.color.operation ?? 'add') &&
        (firstBlend.color.srcFactor ?? 'one') === (secondBlend.color.srcFactor ?? 'one') &&
        (firstBlend.color.dstFactor ?? 'zero') === (secondBlend.color.dstFactor ?? 'zero') &&
        (firstBlend.alpha.operation ?? 'add') === (secondBlend.alpha.operation ?? 'add') &&
        (firstBlend.alpha.srcFactor ?? 'one') === (secondBlend.alpha.srcFactor ?? 'one') &&
        (firstBlend.alpha.dstFactor ?? 'zero') === (secondBlend.alpha.dstFactor ?? 'zero')
    );
}

function reflectedColorTargets(
    fragment: WebGL2Shader | null,
    targets: NonNullable<RHIGraphicsPipelineDescriptor['fragment']>['targets']
): readonly WebGL2ColorTargetState[] {
    const outputs = fragment?.artifact.reflection.fragmentOutputs;
    if (outputs === undefined) {
        return targets.filter((target): target is WebGL2ColorTargetState => target !== null);
    }
    return outputs.flatMap(output => {
        const target = targets[output.location];
        return target === undefined || target === null ? [] : [target];
    });
}

function createWebGL2PipelineStatePlan(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    descriptor: Readonly<RHIGraphicsPipelineDescriptor>,
    colorTarget: WebGL2ColorTargetState | undefined
): Readonly<WebGL2PipelineStatePlan> {
    const primitive = descriptor.primitive;
    const cull = primitive.cullMode ?? 'none';
    const blend = colorTarget?.blend;
    const depthStencil = descriptor.depthStencil;
    const stencilFront = depthStencil?.stencilFront;
    const stencilBack = depthStencil?.stencilBack;
    const stencilEnabled =
        depthStencil?.format.includes('stencil') === true || depthStencil?.format === 'stencil8';
    const polygonOffsetUnits = depthStencil?.depthBias ?? 0;
    const polygonOffsetFactor = depthStencil?.depthBiasSlopeScale ?? 0;
    return Object.freeze({
        program,
        cullEnabled: cull !== 'none',
        cullMode: cull === 'none' ? gl.NONE : cull === 'front' ? gl.FRONT : gl.BACK,
        frontFace: (primitive.frontFace ?? 'ccw') === 'ccw' ? gl.CCW : gl.CW,
        blendEnabled: blend !== undefined,
        blendEquationColor: webGL2BlendOperation(gl, blend?.color.operation ?? 'add'),
        blendEquationAlpha: webGL2BlendOperation(gl, blend?.alpha.operation ?? 'add'),
        blendSourceColor: webGL2BlendFactor(gl, blend?.color.srcFactor ?? 'one'),
        blendDestinationColor: webGL2BlendFactor(gl, blend?.color.dstFactor ?? 'zero'),
        blendSourceAlpha: webGL2BlendFactor(gl, blend?.alpha.srcFactor ?? 'one'),
        blendDestinationAlpha: webGL2BlendFactor(gl, blend?.alpha.dstFactor ?? 'zero'),
        colorWriteMask: colorTarget?.writeMask ?? RHIColorWrite.ALL,
        depthEnabled: depthStencil !== undefined && depthStencil.format !== 'stencil8',
        depthCompare: webGL2Compare(gl, depthStencil?.depthCompare ?? 'always'),
        depthWrite: depthStencil?.depthWriteEnabled ?? false,
        stencilEnabled,
        stencilReadMask: depthStencil?.stencilReadMask ?? 0xffffffff,
        stencilWriteMask: depthStencil?.stencilWriteMask ?? 0xffffffff,
        stencilFrontCompare: webGL2Compare(gl, stencilFront?.compare ?? 'always'),
        stencilFrontFail: webGL2StencilOp(gl, stencilFront?.failOp ?? 'keep'),
        stencilFrontDepthFail: webGL2StencilOp(gl, stencilFront?.depthFailOp ?? 'keep'),
        stencilFrontPass: webGL2StencilOp(gl, stencilFront?.passOp ?? 'keep'),
        stencilBackCompare: webGL2Compare(gl, stencilBack?.compare ?? 'always'),
        stencilBackFail: webGL2StencilOp(gl, stencilBack?.failOp ?? 'keep'),
        stencilBackDepthFail: webGL2StencilOp(gl, stencilBack?.depthFailOp ?? 'keep'),
        stencilBackPass: webGL2StencilOp(gl, stencilBack?.passOp ?? 'keep'),
        polygonOffsetEnabled: polygonOffsetUnits !== 0 || polygonOffsetFactor !== 0,
        polygonOffsetFactor,
        polygonOffsetUnits,
        alphaToCoverageEnabled: descriptor.multisample?.alphaToCoverageEnabled ?? false
    });
}

export class WebGL2GraphicsPipeline extends WebGL2ResourceBase implements RHIGraphicsPipeline {
    readonly descriptor: Readonly<RHIGraphicsPipelineDescriptor>;
    readonly native: WebGLProgram;
    readonly topology: GLenum;
    readonly uniformBlocks: readonly UniformBlockPlan[];
    readonly combinedSamplers: readonly CombinedSamplerPlan[];
    /** Bit `n` identifies a bound draw buffer written by reflected fragment output `n`. */
    readonly colorOutputMask: number;
    readonly #requiredBindGroups: boolean[];
    readonly #statePlan: Readonly<WebGL2PipelineStatePlan>;
    readonly #vertexInputScratch: WebGL2VertexBufferBinding[];
    readonly #indexInputScratch: WebGL2IndexBufferBinding = {
        buffer: null,
        format: 'uint16',
        offset: 0,
        size: 0
    };
    readonly #vertexArrays: VertexArrayRecord[] = [];
    #lastVertexArray: VertexArrayRecord | null = null;
    #vertexArrayClock = 0;

    constructor(owner: WebGL2RHIDevice, descriptor: RHIGraphicsPipelineDescriptor) {
        const normalized = snapshotRHIGraphicsPipelineDescriptor(owner, descriptor);
        super(
            owner,
            normalized.label ?? '',
            normalized.lifetime ?? 'persistent',
            WEBGL2_GRAPHICS_PIPELINE_OBJECT_KIND
        );
        this.descriptor = normalized;
        const vertexLayouts = normalized.vertex.buffers ?? [];
        this.#vertexInputScratch = new Array<WebGL2VertexBufferBinding>(vertexLayouts.length);
        for (let slot = 0; slot < vertexLayouts.length; slot += 1) {
            this.#vertexInputScratch[slot] = { buffer: null, offset: 0, size: 0 };
        }
        const gl = owner.gl;
        const vertex = owner.requireShader(normalized.vertex.shader);
        const fragment =
            normalized.fragment === undefined
                ? null
                : owner.requireShader(normalized.fragment.shader);
        if ((normalized.multisample?.mask ?? 0xffffffff) !== 0xffffffff) {
            throw new RHIValidationError(
                'unsupported-feature',
                'WebGL2 has no portable per-pipeline sample mask',
                'graphicsPipeline.multisample.mask'
            );
        }
        if ((normalized.depthStencil?.depthBiasClamp ?? 0) !== 0) {
            throw new RHIValidationError(
                'unsupported-feature',
                'WebGL2 does not support depthBiasClamp',
                'graphicsPipeline.depthStencil.depthBiasClamp'
            );
        }
        const targets = normalized.fragment?.targets ?? [];
        const fragmentOutputs = fragment?.artifact.reflection.fragmentOutputs;
        let colorOutputMask = 0;
        for (let index = 0; index < targets.length; index += 1) {
            if (targets[index] === null) continue;
            if (
                fragmentOutputs !== undefined &&
                !fragmentOutputs.some(output => output.location === index)
            ) {
                continue;
            }
            colorOutputMask |= 2 ** index;
        }
        this.colorOutputMask = colorOutputMask;
        const activeTargets = reflectedColorTargets(fragment, targets);
        const firstTarget = activeTargets[0];
        const colorTarget = firstTarget ?? targets.find(target => target !== null);
        if (firstTarget !== undefined) {
            for (const target of activeTargets) {
                if (!sameTargetState(firstTarget, target)) {
                    throw new RHIValidationError(
                        'unsupported-feature',
                        'WebGL2 requires identical blend and write-mask state for all color targets',
                        'graphicsPipeline.fragment.targets'
                    );
                }
            }
        }

        const native = requireNative(gl.createProgram(), 'program');
        this.native = native;
        gl.attachShader(native, vertex.native);
        if (fragment) gl.attachShader(native, fragment.native);
        for (const input of vertex.artifact.reflection.vertexInputs ?? []) {
            if (input.name !== undefined) {
                gl.bindAttribLocation(native, input.location, input.name);
            }
        }
        gl.linkProgram(native);
        if (gl.getProgramParameter(native, gl.LINK_STATUS) !== true) {
            const message = gl.getProgramInfoLog(native) ?? 'unknown GLSL link error';
            gl.deleteProgram(native);
            throw new Error(`WebGL2 program link failed: ${message}`);
        }
        this.#statePlan = createWebGL2PipelineStatePlan(gl, native, normalized, colorTarget);
        this.topology = webGL2Topology(gl, normalized.primitive.topology ?? 'triangle-list');
        const plans = this.createBindingPlans(vertex, fragment);
        this.uniformBlocks = plans.uniformBlocks;
        this.combinedSamplers = plans.combinedSamplers;
        this.#requiredBindGroups = new Array<boolean>(owner.capabilities.limits.maxBindGroups).fill(
            false
        );
        for (const shader of fragment ? [vertex, fragment] : [vertex]) {
            for (const binding of shader.artifact.reflection.bindings) {
                this.#requiredBindGroups[binding.group] = true;
                const key = `${String(binding.group)}:${String(binding.binding)}`;
                if (binding.kind === 'uniform-buffer' && !plans.coveredUniformBuffers.has(key)) {
                    throw new RHIValidationError(
                        'incompatible-layout',
                        'GLSL uniform buffer is missing a prepared uniform-block mapping',
                        'graphicsPipeline.shader.preparedBindings'
                    );
                }
                if (binding.kind === 'sampled-texture' && !plans.coveredTextures.has(key)) {
                    throw new RHIValidationError(
                        'incompatible-layout',
                        'GLSL sampled texture is missing a prepared combined-sampler mapping',
                        'graphicsPipeline.shader.preparedBindings'
                    );
                }
                if (
                    (binding.kind === 'sampler' || binding.kind === 'comparison-sampler') &&
                    !plans.coveredSamplers.has(key)
                ) {
                    throw new RHIValidationError(
                        'incompatible-layout',
                        'GLSL sampler is missing a prepared combined-sampler mapping',
                        'graphicsPipeline.shader.preparedBindings'
                    );
                }
            }
        }
        owner.assertNoNativeError('createGraphicsPipeline');
        let hasVertexLayout = false;
        for (const vertexLayout of vertexLayouts) {
            if (vertexLayout !== null) {
                hasVertexLayout = true;
                break;
            }
        }
        // Preserve the direct-RHI empty draw contract without creating its VAO in draw execution.
        if (!hasVertexLayout) this.ensureVertexArray(this.#vertexInputScratch, null);
        this.trackNativeObject('program');
    }

    getBindGroupLayout(index: number): RHIBindGroupLayout {
        this.assertUsable('graphicsPipeline');
        const layout = this.descriptor.layout.bindGroupLayouts[index];
        if (layout === undefined)
            throw new RangeError(`bind group layout ${String(index)} does not exist`);
        return layout;
    }

    requiresBindGroup(index: number): boolean {
        return this.#requiredBindGroups[index] === true;
    }

    assertPreparedUsable(): void {
        assertPreparedObjectUsable(this.owner, this, 'graphicsPipeline');
    }

    applyState(stencilReference: number): void {
        this.owner.state.applyPipelineState(this.#statePlan, stencilReference);
    }

    bindGroups(groups: readonly (WebGL2BoundGroup | null)[]): void {
        let planIndex = 0;
        while (planIndex < this.uniformBlocks.length) {
            const plan = this.uniformBlocks[planIndex++];
            if (plan === undefined) continue;
            const bound = groups[plan.group];
            if (bound?.group === undefined || bound.group === null)
                throw new RHIValidationError(
                    'invalid-state',
                    `bind group ${String(plan.group)} is not set`,
                    'renderPass'
                );
            const entry = bound.group.preparedBuffer(plan.entryIndex);
            const dynamic =
                plan.dynamicOffsetIndex < 0
                    ? 0
                    : (bound.dynamicOffsets[plan.dynamicOffsetIndex] ?? 0);
            this.owner.state.bindUniformBufferRange(
                plan.point,
                entry.buffer.native,
                entry.offset + dynamic,
                entry.size
            );
        }
        planIndex = 0;
        while (planIndex < this.combinedSamplers.length) {
            const plan = this.combinedSamplers[planIndex++];
            if (plan === undefined) continue;
            const bound = groups[plan.group];
            if (bound?.group === undefined || bound.group === null)
                throw new RHIValidationError(
                    'invalid-state',
                    `bind group ${String(plan.group)} is not set`,
                    'renderPass'
                );
            const view = bound.group.preparedTextureView(plan.textureEntryIndex);
            const sampler = bound.group.preparedSampler(plan.samplerEntryIndex);
            const texture = view.texture;
            for (let previousIndex = 0; previousIndex < plan.unit; previousIndex += 1) {
                const previousPlan = this.combinedSamplers[previousIndex];
                if (previousPlan === undefined) continue;
                const previousBound = groups[previousPlan.group];
                if (previousBound?.group === undefined || previousBound.group === null) continue;
                const previousView = previousBound.group.preparedTextureView(
                    previousPlan.textureEntryIndex
                );
                if (
                    previousView.texture === texture &&
                    (previousView.descriptor.baseMipLevel !== view.descriptor.baseMipLevel ||
                        previousView.descriptor.mipLevelCount !== view.descriptor.mipLevelCount)
                ) {
                    throw new RHIValidationError(
                        'unsupported-feature',
                        'WebGL2 cannot bind two mip views of one texture simultaneously',
                        'bindGroup.textureView'
                    );
                }
            }
            texture.bindPreparedForSampling(plan.unit, view);
            this.owner.state.bindSampler(plan.unit, sampler.native);
        }
    }

    prepareVertexInput(bindings: Readonly<RHIVertexInputBindings>): void {
        this.assertUsable('graphicsPipeline');
        const layouts = this.descriptor.vertex.buffers ?? [];
        for (let slot = 0; slot < layouts.length; slot += 1) {
            const target = this.#vertexInputScratch[slot];
            if (target === undefined)
                throw new Error('Vertex-input scratch storage is unavailable');
            const layout = layouts[slot];
            if (layout === null || layout === undefined) {
                target.buffer = null;
                target.offset = 0;
                target.size = 0;
                continue;
            }
            const source = bindings.vertexBuffers[slot];
            if (source?.buffer === undefined || source.buffer === null) {
                throw new RHIValidationError(
                    'invalid-state',
                    `vertex buffer ${String(slot)} is not set`,
                    'vertexInput'
                );
            }
            const buffer = this.owner.requireBuffer(source.buffer);
            if ((buffer.usage & RHIBufferUsage.VERTEX) === 0) {
                throw new RHIValidationError(
                    'invalid-descriptor',
                    'buffer lacks VERTEX usage',
                    'vertexInput.vertexBuffer'
                );
            }
            const size = source.size ?? buffer.size - source.offset;
            if (
                !Number.isSafeInteger(source.offset) ||
                !Number.isSafeInteger(size) ||
                source.offset < 0 ||
                size <= 0 ||
                source.offset + size > buffer.size
            ) {
                throw new RHIValidationError(
                    'out-of-bounds',
                    'vertex buffer range exceeds buffer',
                    'vertexInput.vertexBuffer'
                );
            }
            target.buffer = buffer;
            target.offset = source.offset;
            target.size = size;
        }

        const sourceIndex = bindings.indexBuffer;
        let indexBuffer: WebGL2IndexBufferBinding | null = null;
        if (sourceIndex !== null) {
            if (sourceIndex.buffer === null) {
                throw new RHIValidationError(
                    'invalid-state',
                    'index buffer is not set',
                    'vertexInput.indexBuffer'
                );
            }
            const buffer = this.owner.requireBuffer(sourceIndex.buffer);
            if ((buffer.usage & RHIBufferUsage.INDEX) === 0) {
                throw new RHIValidationError(
                    'invalid-descriptor',
                    'buffer lacks INDEX usage',
                    'vertexInput.indexBuffer'
                );
            }
            const size = sourceIndex.size ?? buffer.size - sourceIndex.offset;
            const alignment = sourceIndex.format === 'uint16' ? 2 : 4;
            if (
                !Number.isSafeInteger(sourceIndex.offset) ||
                !Number.isSafeInteger(size) ||
                sourceIndex.offset < 0 ||
                sourceIndex.offset % alignment !== 0 ||
                size <= 0 ||
                sourceIndex.offset + size > buffer.size
            ) {
                throw new RHIValidationError(
                    'out-of-bounds',
                    'index buffer range is invalid',
                    'vertexInput.indexBuffer'
                );
            }
            const target = this.#indexInputScratch;
            target.buffer = buffer;
            target.format = sourceIndex.format;
            target.offset = sourceIndex.offset;
            target.size = size;
            indexBuffer = target;
        }
        this.ensureVertexArray(this.#vertexInputScratch, indexBuffer);
    }

    /** Bind an already prepared VAO. A miss here is a renderer preparation bug, never a fallback. */
    bindVertexArray(
        vertexBuffers: readonly WebGL2VertexBufferBinding[],
        indexBuffer: WebGL2IndexBufferBinding | null
    ): void {
        const record = this.findVertexArray(vertexBuffers, indexBuffer);
        if (record === null) throw UNPREPARED_VERTEX_INPUT_ERROR;
        record.lastUsed = ++this.#vertexArrayClock;
        if (record.requestRecorded) {
            this.owner.vertexInputCacheMetrics.recordHit();
            this.owner.currentDiagnostics.cacheHits++;
        } else {
            record.requestRecorded = true;
            this.owner.vertexInputCacheMetrics.recordMiss();
            this.owner.currentDiagnostics.cacheMisses++;
        }
        this.owner.state.bindVertexArray(record.native);
        this.#lastVertexArray = record;
    }

    private ensureVertexArray(
        vertexBuffers: readonly WebGL2VertexBufferBinding[],
        indexBuffer: WebGL2IndexBufferBinding | null
    ): void {
        let record = this.#lastVertexArray;
        let reusable: VertexArrayRecord | null = null;
        if (!this.vertexArrayMatches(record, vertexBuffers, indexBuffer)) {
            record = null;
            let candidateIndex = 0;
            while (candidateIndex < this.#vertexArrays.length) {
                const candidate = this.#vertexArrays[candidateIndex++];
                if (candidate === undefined) continue;
                if (this.vertexArrayMatches(candidate, vertexBuffers, indexBuffer)) {
                    record = candidate;
                    break;
                }
                if (reusable === null && vertexArrayRecordHasDestroyedBuffer(candidate)) {
                    reusable = candidate;
                }
            }
        }
        if (record !== null) {
            record.lastUsed = ++this.#vertexArrayClock;
            this.#lastVertexArray = record;
            return;
        }
        {
            const gl = this.owner.gl;
            const layouts = this.descriptor.vertex.buffers ?? [];
            for (let slot = 0; slot < layouts.length; slot += 1) {
                if (
                    layouts[slot] !== null &&
                    layouts[slot] !== undefined &&
                    (vertexBuffers[slot]?.buffer === undefined ||
                        vertexBuffers[slot]?.buffer === null)
                ) {
                    throw new RHIValidationError(
                        'invalid-state',
                        `vertex buffer ${String(slot)} is not set`,
                        'renderPass'
                    );
                }
            }
            const reused = reusable !== null;
            if (reusable === null) {
                const vao = requireNative(gl.createVertexArray(), 'vertex array');
                this.owner.recordNativeObjectCreated('vertexArray');
                record = {
                    native: vao,
                    buffers: new Array<WebGL2Buffer | null>(layouts.length).fill(null),
                    offsets: new Array<number>(layouts.length).fill(0),
                    sizes: new Array<number>(layouts.length).fill(0),
                    indexBuffer: null,
                    indexFormat: 'uint16',
                    indexOffset: 0,
                    lastUsed: 0,
                    requestRecorded: false
                };
            } else {
                record = reusable;
                record.buffers.fill(null);
                record.offsets.fill(0);
                record.sizes.fill(0);
                record.requestRecorded = false;
            }
            this.owner.state.bindVertexArray(record.native);
            for (let slot = 0; slot < layouts.length; slot += 1) {
                const layout = layouts[slot];
                if (layout === null || layout === undefined) continue;
                const binding = vertexBuffers[slot];
                if (binding?.buffer === undefined || binding.buffer === null) continue;
                record.buffers[slot] = binding.buffer;
                record.offsets[slot] = binding.offset;
                record.sizes[slot] = binding.size;
                this.owner.state.bindBuffer(gl.ARRAY_BUFFER, binding.buffer.native);
                let attributeIndex = 0;
                while (attributeIndex < layout.attributes.length) {
                    const attribute = layout.attributes[attributeIndex++];
                    if (attribute === undefined) continue;
                    const info = webGL2VertexFormatInfo(gl, attribute.format);
                    gl.enableVertexAttribArray(attribute.shaderLocation);
                    const offset = binding.offset + attribute.offset;
                    if (info.integer)
                        gl.vertexAttribIPointer(
                            attribute.shaderLocation,
                            info.components,
                            info.type,
                            layout.arrayStride,
                            offset
                        );
                    else
                        gl.vertexAttribPointer(
                            attribute.shaderLocation,
                            info.components,
                            info.type,
                            info.normalized,
                            layout.arrayStride,
                            offset
                        );
                    gl.vertexAttribDivisor(
                        attribute.shaderLocation,
                        (layout.stepMode ?? 'vertex') === 'instance' ? 1 : 0
                    );
                }
            }
            record.indexBuffer = indexBuffer?.buffer ?? null;
            record.indexFormat = indexBuffer?.format ?? 'uint16';
            record.indexOffset = indexBuffer?.offset ?? 0;
            record.lastUsed = ++this.#vertexArrayClock;
            this.owner.state.bindBuffer(
                gl.ELEMENT_ARRAY_BUFFER,
                record.indexBuffer?.native ?? null
            );
            if (reused) {
                this.owner.vertexInputCacheMetrics.recordReplacement();
            } else if (this.#vertexArrays.length === MAX_VERTEX_ARRAY_RECORDS) {
                let oldestIndex = 0;
                for (let index = 1; index < this.#vertexArrays.length; index += 1) {
                    if (
                        (this.#vertexArrays[index]?.lastUsed ?? Number.MAX_SAFE_INTEGER) <
                        (this.#vertexArrays[oldestIndex]?.lastUsed ?? Number.MAX_SAFE_INTEGER)
                    ) {
                        oldestIndex = index;
                    }
                }
                const evicted = this.#vertexArrays[oldestIndex];
                if (evicted) {
                    this.owner.gl.deleteVertexArray(evicted.native);
                    this.owner.recordNativeObjectDestroyed('vertexArray');
                    if (this.#lastVertexArray === evicted) this.#lastVertexArray = null;
                }
                this.#vertexArrays[oldestIndex] = record;
                this.owner.vertexInputCacheMetrics.recordReplacement();
            } else {
                this.#vertexArrays.push(record);
                this.owner.vertexInputCacheMetrics.recordInsertion();
            }
        }
        this.#lastVertexArray = record;
    }

    private findVertexArray(
        vertexBuffers: readonly WebGL2VertexBufferBinding[],
        indexBuffer: WebGL2IndexBufferBinding | null
    ): VertexArrayRecord | null {
        let record = this.#lastVertexArray;
        if (this.vertexArrayMatches(record, vertexBuffers, indexBuffer)) return record;
        record = null;
        let candidateIndex = 0;
        while (candidateIndex < this.#vertexArrays.length) {
            const candidate = this.#vertexArrays[candidateIndex++];
            if (
                candidate !== undefined &&
                this.vertexArrayMatches(candidate, vertexBuffers, indexBuffer)
            ) {
                record = candidate;
                break;
            }
        }
        return record;
    }

    private vertexArrayMatches(
        record: VertexArrayRecord | null,
        vertexBuffers: readonly WebGL2VertexBufferBinding[],
        indexBuffer: WebGL2IndexBufferBinding | null
    ): boolean {
        if (
            record?.indexBuffer !== (indexBuffer?.buffer ?? null) ||
            record.indexFormat !== (indexBuffer?.format ?? 'uint16') ||
            record.indexOffset !== (indexBuffer?.offset ?? 0)
        ) {
            return false;
        }
        const layouts = this.descriptor.vertex.buffers ?? [];
        for (let slot = 0; slot < layouts.length; slot += 1) {
            if (layouts[slot] === null || layouts[slot] === undefined) continue;
            const binding = vertexBuffers[slot];
            if (
                binding === undefined ||
                record.buffers[slot] !== binding.buffer ||
                record.offsets[slot] !== binding.offset ||
                record.sizes[slot] !== binding.size
            ) {
                return false;
            }
        }
        return true;
    }

    private createBindingPlans(
        vertex: WebGL2Shader,
        fragment: WebGL2Shader | null
    ): {
        uniformBlocks: readonly UniformBlockPlan[];
        combinedSamplers: readonly CombinedSamplerPlan[];
        coveredUniformBuffers: ReadonlySet<string>;
        coveredTextures: ReadonlySet<string>;
        coveredSamplers: ReadonlySet<string>;
    } {
        const gl = this.owner.gl;
        const uniformBlocks: UniformBlockPlan[] = [];
        const combinedSamplers: CombinedSamplerPlan[] = [];
        const uniformNames = new Set<string>();
        const samplerElements = new Set<string>();
        const coveredUniformBuffers = new Set<string>();
        const coveredTextures = new Set<string>();
        const coveredSamplers = new Set<string>();
        let point = 0;
        let unit = 0;
        for (const shader of fragment ? [vertex, fragment] : [vertex]) {
            if (shader.artifact.backend !== 'webgl2') continue;
            for (const mapping of shader.artifact.preparedBindings?.uniformBlocks ?? []) {
                coveredUniformBuffers.add(`${String(mapping.group)}:${String(mapping.binding)}`);
                if (uniformNames.has(mapping.name)) continue;
                uniformNames.add(mapping.name);
                const blockIndex = gl.getUniformBlockIndex(this.native, mapping.name);
                if (blockIndex === gl.INVALID_INDEX) continue;
                gl.uniformBlockBinding(this.native, blockIndex, point);
                const layout = this.descriptor.layout.bindGroupLayouts[mapping.group];
                const bindingLayout = layout?.entries.find(
                    entry => entry.binding === mapping.binding
                );
                const dynamicOffsetIndex =
                    bindingLayout?.buffer?.hasDynamicOffset === true
                        ? (layout?.entries.filter(
                              entry =>
                                  entry.binding < mapping.binding &&
                                  entry.buffer?.hasDynamicOffset === true
                          ).length ?? 0)
                        : -1;
                uniformBlocks.push({
                    group: mapping.group,
                    entryIndex: this.bindingEntryIndex(mapping.group, mapping.binding),
                    point,
                    dynamicOffsetIndex
                });
                point++;
            }
            for (const mapping of shader.artifact.preparedBindings?.combinedSamplers ?? []) {
                coveredTextures.add(`${String(mapping.group)}:${String(mapping.textureBinding)}`);
                coveredSamplers.add(`${String(mapping.group)}:${String(mapping.samplerBinding)}`);
                const element = `${mapping.name}:${String(mapping.arrayIndex)}`;
                if (samplerElements.has(element)) continue;
                samplerElements.add(element);
                const location = gl.getUniformLocation(
                    this.native,
                    mapping.arrayIndex === 0
                        ? mapping.name
                        : `${mapping.name}[${String(mapping.arrayIndex)}]`
                );
                if (location === null) continue;
                this.owner.state.useProgram(this.native);
                gl.uniform1i(location, unit);
                combinedSamplers.push({
                    group: mapping.group,
                    textureEntryIndex: this.bindingEntryIndex(
                        mapping.group,
                        mapping.textureBinding
                    ),
                    samplerEntryIndex: this.bindingEntryIndex(
                        mapping.group,
                        mapping.samplerBinding
                    ),
                    unit
                });
                unit++;
            }
        }
        return {
            uniformBlocks: Object.freeze(uniformBlocks),
            combinedSamplers: Object.freeze(combinedSamplers),
            coveredUniformBuffers,
            coveredTextures,
            coveredSamplers
        };
    }

    private bindingEntryIndex(group: number, binding: number): number {
        const layout = this.descriptor.layout.bindGroupLayouts[group];
        if (layout === undefined) {
            throw new RHIValidationError(
                'incompatible-layout',
                `prepared binding group ${String(group)} is absent from the pipeline layout`,
                'graphicsPipeline.shader.preparedBindings'
            );
        }
        for (let index = 0; index < layout.entries.length; index += 1) {
            if (layout.entries[index]?.binding === binding) return index;
        }
        throw new RHIValidationError(
            'incompatible-layout',
            `prepared binding ${String(binding)} is absent from group ${String(group)}`,
            'graphicsPipeline.shader.preparedBindings'
        );
    }

    protected releaseNative(contextLost: boolean): void {
        const vertexArrayCount = this.#vertexArrays.length;
        if (!contextLost) {
            for (const record of this.#vertexArrays) this.owner.gl.deleteVertexArray(record.native);
            this.owner.gl.deleteProgram(this.native);
        }
        this.#vertexArrays.length = 0;
        this.#lastVertexArray = null;
        if (vertexArrayCount > 0) {
            this.owner.recordNativeObjectDestroyed('vertexArray', vertexArrayCount);
            this.owner.vertexInputCacheMetrics.recordRemoval(vertexArrayCount);
        }
    }
}
