import {
    RHIColorWrite,
    type RHIBlendComponent,
    type RHIFragmentState,
    type RHIIndexFormat,
    type RHIPreparedSamplerBinding,
    type RHIPreparedUniformBlockBinding,
    type RHIRenderPipeline,
    type RHIRenderPipelineDescriptor,
    type RHISamplerBindingType,
    type RHIStencilFaceState,
    type RHITextureSampleType
} from '../RHI';
import {
    WebGLObjectBase,
    glNumber,
    glResource,
    requireInteger,
    requireRange,
    type DisposableWebGLObject
} from './WebGLInternal';
import {
    blendFactor,
    blendOperation,
    compareFunction,
    primitiveTopology,
    stencilOperation,
    vertexFormatInfo
} from './WebGLFormats';
import {
    isBufferBinding,
    type WebGLRHIBindGroup,
    type WebGLRHIBindGroupLayout,
    type WebGLRHIBuffer,
    type WebGLRHIPipelineLayout,
    type WebGLRHIShaderModule
} from './WebGLResources';
import type { WebGLRHIDevice } from './WebGLDevice';

interface ReflectedUniformBlock {
    readonly index: number;
    readonly name: string;
}

interface ReflectedSampler {
    readonly name: string;
    readonly location: WebGLUniformLocation;
    readonly size: number;
}

interface ProgramReflection {
    readonly uniformBlocks: readonly ReflectedUniformBlock[];
    readonly samplers: readonly ReflectedSampler[];
}

function isSamplerUniformType(gl: WebGL2RenderingContext, type: GLenum): boolean {
    switch (type) {
        case gl.SAMPLER_2D:
        case gl.SAMPLER_3D:
        case gl.SAMPLER_CUBE:
        case gl.SAMPLER_2D_SHADOW:
        case gl.SAMPLER_2D_ARRAY:
        case gl.SAMPLER_2D_ARRAY_SHADOW:
        case gl.SAMPLER_CUBE_SHADOW:
        case gl.INT_SAMPLER_2D:
        case gl.INT_SAMPLER_3D:
        case gl.INT_SAMPLER_CUBE:
        case gl.INT_SAMPLER_2D_ARRAY:
        case gl.UNSIGNED_INT_SAMPLER_2D:
        case gl.UNSIGNED_INT_SAMPLER_3D:
        case gl.UNSIGNED_INT_SAMPLER_CUBE:
        case gl.UNSIGNED_INT_SAMPLER_2D_ARRAY:
            return true;
        default:
            return false;
    }
}

function reflectProgram(gl: WebGL2RenderingContext, program: WebGLProgram): ProgramReflection {
    const uniformBlockCount =
        Number(gl.getProgramParameter(program, gl.ACTIVE_UNIFORM_BLOCKS)) || 0;
    const uniformCount = Number(gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS)) || 0;
    const uniformBlocks: ReflectedUniformBlock[] = [];
    for (let index = 0; index < uniformBlockCount; index++) {
        const name = gl.getActiveUniformBlockName(program, index);
        if (!name) throw new Error(`WebGL did not report uniform block ${String(index)} by name`);
        uniformBlocks.push({ index, name });
    }
    const samplers: ReflectedSampler[] = [];
    for (let index = 0; index < uniformCount; index++) {
        const uniform = gl.getActiveUniform(program, index);
        if (!uniform || !isSamplerUniformType(gl, uniform.type)) continue;
        const name = uniform.name.endsWith('[0]') ? uniform.name.slice(0, -3) : uniform.name;
        const location = gl.getUniformLocation(program, name);
        if (location !== null) samplers.push({ name, location, size: uniform.size });
    }
    return { uniformBlocks, samplers };
}

interface PreparedBindingLookup {
    readonly uniformBlocks: ReadonlyMap<string, RHIPreparedUniformBlockBinding>;
    readonly samplers: ReadonlyMap<string, RHIPreparedSamplerBinding>;
}

function samplerElementKey(name: string, arrayIndex: number): string {
    return `${name}[${String(arrayIndex)}]`;
}

function mergePreparedBindings(
    vertex: WebGLRHIShaderModule,
    fragment: WebGLRHIShaderModule | null
): PreparedBindingLookup {
    const uniformBlocks = new Map<string, RHIPreparedUniformBlockBinding>();
    const uniformSlots = new Map<string, string>();
    const samplers = new Map<string, RHIPreparedSamplerBinding>();
    const textureSlots = new Map<string, string>();
    const samplerSlots = new Map<string, string>();
    for (const module of fragment ? [vertex, fragment] : [vertex]) {
        for (const binding of module.preparedBindings?.uniformBlocks ?? []) {
            const existing = uniformBlocks.get(binding.name);
            if (
                existing &&
                (existing.group !== binding.group || existing.binding !== binding.binding)
            ) {
                throw new Error(`Prepared uniform block ${binding.name} has conflicting bindings`);
            }
            const slot = `${String(binding.group)}:${String(binding.binding)}`;
            const owner = uniformSlots.get(slot);
            if (owner && owner !== binding.name) {
                throw new Error(
                    `Prepared uniform blocks ${owner} and ${binding.name} share binding ${slot}`
                );
            }
            uniformBlocks.set(binding.name, binding);
            uniformSlots.set(slot, binding.name);
        }
        for (const binding of module.preparedBindings?.samplers ?? []) {
            const key = samplerElementKey(binding.name, binding.arrayIndex);
            const existing = samplers.get(key);
            if (
                existing &&
                (existing.group !== binding.group ||
                    existing.textureBinding !== binding.textureBinding ||
                    existing.samplerBinding !== binding.samplerBinding)
            ) {
                throw new Error(`Prepared sampler ${key} has conflicting bindings`);
            }
            const textureSlot = `${String(binding.group)}:${String(binding.textureBinding)}`;
            const samplerSlot = `${String(binding.group)}:${String(binding.samplerBinding)}`;
            const textureOwner = textureSlots.get(textureSlot);
            const samplerOwner = samplerSlots.get(samplerSlot);
            if (textureOwner && textureOwner !== key) {
                throw new Error(
                    `Prepared samplers ${textureOwner} and ${key} share texture binding ${textureSlot}`
                );
            }
            if (samplerOwner && samplerOwner !== key) {
                throw new Error(
                    `Prepared samplers ${samplerOwner} and ${key} share sampler binding ${samplerSlot}`
                );
            }
            samplers.set(key, binding);
            textureSlots.set(textureSlot, key);
            samplerSlots.set(samplerSlot, key);
        }
    }
    return { uniformBlocks, samplers };
}

function createSamplerUnitArrays(
    samplers: readonly ReflectedSampler[],
    samplerUnits: readonly number[]
): readonly (Int32Array | null)[] {
    const arrays: (Int32Array | null)[] = [];
    let unitOffset = 0;
    for (const sampler of samplers) {
        if (sampler.size === 1) {
            arrays.push(null);
        } else {
            const units = new Int32Array(sampler.size);
            for (let index = 0; index < sampler.size; index++) {
                units[index] = samplerUnits[unitOffset + index] ?? unitOffset + index;
            }
            arrays.push(units);
        }
        unitOffset += sampler.size;
    }
    return Object.freeze(arrays);
}

type PipelineBindingKind = 'buffer' | 'texture' | 'sampler';

interface PipelineBindingPlan {
    readonly binding: number;
    readonly kind: PipelineBindingKind;
    readonly slot: number;
    readonly dynamicOffsetIndex: number;
}

interface PipelineGroupPlan {
    readonly layout: WebGLRHIBindGroupLayout;
    readonly bindings: readonly PipelineBindingPlan[];
    readonly dynamicOffsetCount: number;
}

export interface BoundGroupState {
    group: WebGLRHIBindGroup | null;
    readonly dynamicOffsets: number[];
}

export interface VertexBufferBindingState {
    buffer: WebGLRHIBuffer;
    offset: number;
    size: number;
}

export interface IndexBufferBindingState {
    buffer: WebGLRHIBuffer;
    format: RHIIndexFormat;
    offset: number;
    size: number;
}

interface VertexArrayCacheRecord {
    readonly native: WebGLVertexArrayObject;
    readonly bufferIds: readonly (number | undefined)[];
    readonly offsets: readonly (number | undefined)[];
    readonly sizes: readonly (number | undefined)[];
    readonly indexBufferId: number;
    readonly indexFormat: RHIIndexFormat | null;
    readonly indexOffset: number;
    readonly indexSize: number;
    lastUsed: number;
}

const MAX_CACHED_VERTEX_ARRAYS = 256;

function blendComponentKey(component: RHIBlendComponent): string {
    return `${component.operation ?? 'add'}:${component.srcFactor ?? 'one'}:${component.dstFactor ?? 'zero'}`;
}

function targetStateKey(target: NonNullable<RHIFragmentState['targets'][number]>): string {
    return `${target.format}|${String(target.writeMask ?? RHIColorWrite.ALL)}|${
        target.blend
            ? `${blendComponentKey(target.blend.color)}/${blendComponentKey(target.blend.alpha)}`
            : '-'
    }`;
}

function mixHash(hash: number, value: number): number {
    return Math.imul(hash ^ value, 0x01000193);
}

function defaultStencilFace(): Required<RHIStencilFaceState> {
    return { compare: 'always', failOp: 'keep', depthFailOp: 'keep', passOp: 'keep' };
}

function normalizeStencilFace(
    face: RHIStencilFaceState | undefined
): Required<RHIStencilFaceState> {
    const fallback = defaultStencilFace();
    return {
        compare: face?.compare ?? fallback.compare,
        failOp: face?.failOp ?? fallback.failOp,
        depthFailOp: face?.depthFailOp ?? fallback.depthFailOp,
        passOp: face?.passOp ?? fallback.passOp
    };
}

/** Linked WebGL program plus immutable pipeline state and its VAO cache. */
export class WebGLRHIRenderPipeline
    extends WebGLObjectBase
    implements RHIRenderPipeline, DisposableWebGLObject
{
    readonly device: WebGLRHIDevice;
    readonly descriptor: RHIRenderPipelineDescriptor;
    readonly native: WebGLProgram;
    readonly layout: WebGLRHIPipelineLayout;
    readonly topology: GLenum;
    readonly groupPlans: readonly PipelineGroupPlan[];
    readonly cacheKey: string;
    private readonly samplerUniforms: readonly ReflectedSampler[];
    private readonly samplerUnits: readonly number[];
    private readonly samplerUnitArrays: readonly (Int32Array | null)[];
    private readonly owned: boolean;
    private readonly vertexArrayBuckets = new Map<number, VertexArrayCacheRecord[]>();
    private vertexArrayCount = 0;
    private vertexArrayClock = 0;
    private samplerUniformsInitialized = false;
    private disposed = false;

    constructor(
        device: WebGLRHIDevice,
        descriptor: RHIRenderPipelineDescriptor,
        cacheKey: string,
        native?: WebGLProgram,
        owned = true,
        link = true
    ) {
        super(descriptor.label);
        this.device = device;
        this.descriptor = descriptor;
        this.cacheKey = cacheKey;
        const vertexModule = device.requireShaderModule(descriptor.vertex.module);
        if (vertexModule.stage !== 'vertex')
            throw new Error('Pipeline vertex module has the wrong stage');
        if ((descriptor.vertex.entryPoint ?? 'main') !== 'main') {
            throw new Error('GLSL pipelines only support the main entry point');
        }
        let fragmentModule: WebGLRHIShaderModule | null = null;
        if (descriptor.fragment) {
            fragmentModule = device.requireShaderModule(descriptor.fragment.module);
            if (fragmentModule.stage !== 'fragment')
                throw new Error('Pipeline fragment module has the wrong stage');
            if ((descriptor.fragment.entryPoint ?? 'main') !== 'main') {
                throw new Error('GLSL pipelines only support the main entry point');
            }
        }
        if ((descriptor.depthStencil?.depthBiasClamp ?? 0) !== 0) {
            throw new Error('WebGL 2 RHI does not support depthBiasClamp');
        }
        const sampleCount = descriptor.multisample?.count ?? 1;
        if (sampleCount !== 1 && sampleCount > glNumber(device.gl, device.gl.MAX_SAMPLES, 4)) {
            throw new RangeError('Pipeline multisample count exceeds the device limit');
        }
        if ((descriptor.multisample?.mask ?? 0xffffffff) !== 0xffffffff) {
            throw new Error('WebGL 2 RHI does not support non-default pipeline sample masks');
        }
        for (const [slot, layout] of (descriptor.vertex.buffers ?? []).entries()) {
            if (!layout) continue;
            if (
                !Number.isSafeInteger(layout.arrayStride) ||
                layout.arrayStride <= 0 ||
                layout.arrayStride % 4 !== 0 ||
                layout.arrayStride > device.limits.maxVertexBufferArrayStride
            ) {
                throw new RangeError(
                    `Vertex buffer ${String(slot)} arrayStride must be a positive multiple of 4 no greater than ${String(device.limits.maxVertexBufferArrayStride)}`
                );
            }
        }
        const targets = descriptor.fragment?.targets.filter(target => target !== null) ?? [];
        if (targets.length > device.limits.maxColorAttachments) {
            throw new RangeError('Pipeline has too many color targets');
        }
        if (targets.length > 1) {
            const firstTarget = targets[0];
            if (!firstTarget) throw new Error('Pipeline target list is invalid');
            const firstKey = targetStateKey(firstTarget);
            for (let index = 1; index < targets.length; index++) {
                const target = targets[index];
                if (target && targetStateKey(target) !== firstKey) {
                    throw new Error(
                        'WebGL 2 portable RHI requires identical blend and write-mask state for all color targets'
                    );
                }
            }
        }
        const gl = device.gl;
        const program = native ?? glResource(gl.createProgram(), 'a program');
        this.native = program;
        this.owned = owned;
        try {
            if (link) {
                gl.attachShader(program, vertexModule.native);
                if (fragmentModule) gl.attachShader(program, fragmentModule.native);
                gl.linkProgram(program);
                if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
                    const message = gl.getProgramInfoLog(program) ?? 'Unknown WebGL linker error';
                    throw new Error(`WebGL program link failed: ${message}`);
                }
            }
            const reflection = reflectProgram(gl, program);
            this.layout = device.requirePipelineLayout(descriptor.layout);
            const plans = this.createBindingPlans(
                reflection,
                mergePreparedBindings(vertexModule, fragmentModule)
            );
            this.groupPlans = plans.groups;
            this.samplerUniforms = reflection.samplers;
            this.samplerUnits = plans.samplerUnits;
            this.samplerUnitArrays = createSamplerUnitArrays(
                reflection.samplers,
                plans.samplerUnits
            );
            this.topology = primitiveTopology(
                gl,
                descriptor.primitive?.topology ?? 'triangle-list'
            );
            device.registerDisposable(this);
            device.registerPipelineIdentity(program, this);
            device.diagnostics?.recordResource('pipeline');
        } catch (error) {
            if (owned) gl.deleteProgram(program);
            throw error;
        }
    }

    getBindGroupLayout(index: number): WebGLRHIBindGroupLayout {
        this.assertUsable();
        requireInteger(index, 'Bind group layout index');
        const layout = this.layout.bindGroupLayouts[index];
        if (!layout) throw new RangeError('Bind group layout index is out of range');
        return layout;
    }

    /** @internal Cache cardinality exposed for deterministic bounded-cache regression tests. */
    get vertexArrayCacheSize(): number {
        return this.vertexArrayCount;
    }

    /** @internal Cache bucket count exposed for deterministic bounded-cache regression tests. */
    get vertexArrayCacheBucketCount(): number {
        return this.vertexArrayBuckets.size;
    }

    applyPipelineState(stencilReference: number): void {
        this.assertUsable();
        const { device, descriptor } = this;
        const { gl, state } = device;
        state.useProgram(this.native);
        if (!this.samplerUniformsInitialized) {
            let unitOffset = 0;
            for (let samplerIndex = 0; samplerIndex < this.samplerUniforms.length; samplerIndex++) {
                const sampler = this.samplerUniforms[samplerIndex];
                if (!sampler) continue;
                if (sampler.size === 1) {
                    gl.uniform1i(sampler.location, this.samplerUnits[unitOffset] ?? unitOffset);
                } else {
                    const units = this.samplerUnitArrays[samplerIndex];
                    if (!units) throw new Error('Sampler array texture units were not prepared');
                    gl.uniform1iv(sampler.location, units);
                }
                unitOffset += sampler.size;
            }
            this.samplerUniformsInitialized = true;
        }
        const primitive = descriptor.primitive;
        const cullMode = primitive?.cullMode ?? 'none';
        state.enable(gl.CULL_FACE, cullMode !== 'none');
        if (cullMode !== 'none') state.cullFace(cullMode === 'front' ? gl.FRONT : gl.BACK);
        state.frontFace((primitive?.frontFace ?? 'ccw') === 'ccw' ? gl.CCW : gl.CW);

        const depthStencil = descriptor.depthStencil;
        state.enable(gl.DEPTH_TEST, depthStencil !== undefined);
        state.depthMask(depthStencil?.depthWriteEnabled ?? false);
        if (depthStencil)
            state.depthFunc(compareFunction(gl, depthStencil.depthCompare ?? 'always'));
        const hasStencil =
            depthStencil?.format.includes('stencil') === true ||
            depthStencil?.format === 'stencil8';
        state.enable(gl.STENCIL_TEST, hasStencil);
        state.setStencilReference(stencilReference);
        if (hasStencil) {
            const front = normalizeStencilFace(depthStencil.stencilFront);
            const back = normalizeStencilFace(depthStencil.stencilBack);
            const readMask = depthStencil.stencilReadMask ?? 0xffffffff;
            const writeMask = depthStencil.stencilWriteMask ?? 0xffffffff;
            state.stencilFuncSeparate(gl.FRONT, compareFunction(gl, front.compare), readMask);
            state.stencilFuncSeparate(gl.BACK, compareFunction(gl, back.compare), readMask);
            state.stencilOpSeparate(
                gl.FRONT,
                stencilOperation(gl, front.failOp),
                stencilOperation(gl, front.depthFailOp),
                stencilOperation(gl, front.passOp)
            );
            state.stencilOpSeparate(
                gl.BACK,
                stencilOperation(gl, back.failOp),
                stencilOperation(gl, back.depthFailOp),
                stencilOperation(gl, back.passOp)
            );
            state.stencilMaskSeparate(gl.FRONT, writeMask);
            state.stencilMaskSeparate(gl.BACK, writeMask);
        }
        const depthBias = depthStencil?.depthBias ?? 0;
        const slope = depthStencil?.depthBiasSlopeScale ?? 0;
        state.enable(gl.POLYGON_OFFSET_FILL, depthBias !== 0 || slope !== 0);
        if (depthBias !== 0 || slope !== 0) state.polygonOffset(slope, depthBias);

        let target: NonNullable<RHIFragmentState['targets'][number]> | null = null;
        for (const candidate of descriptor.fragment?.targets ?? []) {
            if (candidate) {
                target = candidate;
                break;
            }
        }
        state.enable(gl.BLEND, target?.blend !== undefined);
        if (target?.blend) {
            const color = target.blend.color;
            const alpha = target.blend.alpha;
            state.blendEquationSeparate(
                blendOperation(gl, color.operation ?? 'add'),
                blendOperation(gl, alpha.operation ?? 'add')
            );
            state.blendFuncSeparate(
                blendFactor(gl, color.srcFactor ?? 'one'),
                blendFactor(gl, color.dstFactor ?? 'zero'),
                blendFactor(gl, alpha.srcFactor ?? 'one'),
                blendFactor(gl, alpha.dstFactor ?? 'zero')
            );
        }
        const writeMask = target?.writeMask ?? (target ? RHIColorWrite.ALL : 0);
        state.colorMask(
            (writeMask & RHIColorWrite.RED) !== 0,
            (writeMask & RHIColorWrite.GREEN) !== 0,
            (writeMask & RHIColorWrite.BLUE) !== 0,
            (writeMask & RHIColorWrite.ALPHA) !== 0
        );
        state.enable(
            gl.SAMPLE_ALPHA_TO_COVERAGE,
            descriptor.multisample?.alphaToCoverageEnabled ?? false
        );
    }

    applyBindings(groups: readonly (BoundGroupState | undefined)[]): void {
        const { device } = this;
        for (let groupIndex = 0; groupIndex < this.groupPlans.length; groupIndex++) {
            const plan = this.groupPlans[groupIndex];
            if (!plan || plan.bindings.length === 0) continue;
            const bound = groups[groupIndex];
            if (!bound?.group) throw new Error(`Bind group ${String(groupIndex)} is not set`);
            bound.group.assertUsable();
            if (bound.group.layout !== plan.layout) {
                throw new Error(
                    `Bind group ${String(groupIndex)} layout is incompatible with the pipeline`
                );
            }
            if (bound.dynamicOffsets.length !== plan.dynamicOffsetCount) {
                throw new Error(
                    `Bind group ${String(groupIndex)} dynamic offset count is incorrect`
                );
            }
            for (const bindingPlan of plan.bindings) {
                const entry = bound.group.entriesByBinding.get(bindingPlan.binding);
                if (!entry)
                    throw new Error(`Bind group is missing binding ${String(bindingPlan.binding)}`);
                if (bindingPlan.kind === 'buffer') {
                    if (!isBufferBinding(entry.resource))
                        throw new TypeError('Expected a buffer binding');
                    const buffer = device.requireBuffer(entry.resource.buffer);
                    buffer.assertUsable();
                    const baseOffset = entry.resource.offset ?? 0;
                    const dynamicOffset =
                        bindingPlan.dynamicOffsetIndex < 0
                            ? 0
                            : (bound.dynamicOffsets[bindingPlan.dynamicOffsetIndex] ?? 0);
                    requireInteger(dynamicOffset, 'Dynamic uniform buffer offset');
                    const offset = baseOffset + dynamicOffset;
                    const size = entry.resource.size ?? buffer.size - baseOffset;
                    requireRange(offset, size, buffer.size, 'Uniform buffer binding');
                    if (offset % device.limits.minUniformBufferOffsetAlignment !== 0) {
                        throw new RangeError(
                            'Uniform buffer offset does not satisfy device alignment'
                        );
                    }
                    device.state.bindUniformBuffer(bindingPlan.slot, buffer.native, offset, size);
                } else if (bindingPlan.kind === 'texture') {
                    const view = device.requireTextureView(entry.resource);
                    view.texture.assertUsable();
                    if (!view.texture.nativeTexture)
                        throw new Error('A renderbuffer texture cannot be sampled');
                    device.state.bindTexture(
                        bindingPlan.slot,
                        view.texture.target,
                        view.texture.nativeTexture
                    );
                } else {
                    const sampler = device.requireSampler(entry.resource);
                    sampler.assertUsable();
                    device.state.bindSampler(bindingPlan.slot, sampler.native);
                }
            }
        }
    }

    vertexArrayFor(
        vertexBuffers: readonly (VertexBufferBindingState | undefined)[],
        indexBuffer: IndexBufferBindingState | null
    ): WebGLVertexArrayObject {
        this.assertUsable();
        const layouts = this.descriptor.vertex.buffers ?? [];
        let hash = 0x811c9dc5;
        if (indexBuffer) {
            hash = mixHash(hash, indexBuffer.buffer.id);
            hash = mixHash(hash, indexBuffer.offset);
            hash = mixHash(hash, indexBuffer.size);
            hash = mixHash(hash, indexBuffer.format === 'uint16' ? 16 : 32);
        }
        for (let slot = 0; slot < layouts.length; slot++) {
            const layout = layouts[slot];
            if (!layout) continue;
            const binding = vertexBuffers[slot];
            if (!binding) throw new Error(`Vertex buffer slot ${String(slot)} is not set`);
            hash = mixHash(hash, slot);
            hash = mixHash(hash, binding.buffer.id);
            hash = mixHash(hash, binding.offset);
            hash = mixHash(hash, binding.size);
        }
        const bucket = this.vertexArrayBuckets.get(hash);
        if (bucket) {
            for (const record of bucket) {
                if (this.vertexArrayRecordMatches(record, layouts, vertexBuffers, indexBuffer)) {
                    record.lastUsed = ++this.vertexArrayClock;
                    return record.native;
                }
            }
        }
        const { gl, state } = this.device;
        const vertexArray = glResource(gl.createVertexArray(), 'a vertex array');
        state.bindVertexArray(vertexArray);
        for (let slot = 0; slot < layouts.length; slot++) {
            const layout = layouts[slot];
            if (!layout) continue;
            const binding = vertexBuffers[slot];
            if (!binding) throw new Error(`Vertex buffer slot ${String(slot)} is not set`);
            binding.buffer.assertUsable();
            state.bindBuffer(gl.ARRAY_BUFFER, binding.buffer.native);
            for (const attribute of layout.attributes) {
                const info = vertexFormatInfo(gl, attribute.format);
                if (attribute.offset + info.bytes > layout.arrayStride) {
                    throw new RangeError(
                        `Vertex attribute ${String(attribute.shaderLocation)} exceeds its array stride`
                    );
                }
                const offset = binding.offset + attribute.offset;
                gl.enableVertexAttribArray(attribute.shaderLocation);
                if (info.integer) {
                    gl.vertexAttribIPointer(
                        attribute.shaderLocation,
                        info.components,
                        info.type,
                        layout.arrayStride,
                        offset
                    );
                } else {
                    gl.vertexAttribPointer(
                        attribute.shaderLocation,
                        info.components,
                        info.type,
                        info.normalized,
                        layout.arrayStride,
                        offset
                    );
                }
                gl.vertexAttribDivisor(
                    attribute.shaderLocation,
                    layout.stepMode === 'instance' ? 1 : 0
                );
            }
        }
        if (indexBuffer) {
            indexBuffer.buffer.assertUsable();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer.buffer.native);
        }
        const bufferIds: (number | undefined)[] = [];
        const offsets: (number | undefined)[] = [];
        const sizes: (number | undefined)[] = [];
        for (let slot = 0; slot < layouts.length; slot++) {
            if (!layouts[slot]) continue;
            const binding = vertexBuffers[slot];
            if (!binding) continue;
            bufferIds[slot] = binding.buffer.id;
            offsets[slot] = binding.offset;
            sizes[slot] = binding.size;
        }
        const record: VertexArrayCacheRecord = {
            native: vertexArray,
            bufferIds,
            offsets,
            sizes,
            indexBufferId: indexBuffer?.buffer.id ?? 0,
            indexFormat: indexBuffer?.format ?? null,
            indexOffset: indexBuffer?.offset ?? 0,
            indexSize: indexBuffer?.size ?? 0,
            lastUsed: ++this.vertexArrayClock
        };
        if (bucket) bucket.push(record);
        else this.vertexArrayBuckets.set(hash, [record]);
        this.vertexArrayCount++;
        this.evictOldestVertexArray();
        this.device.diagnostics?.recordResource('vertexArray');
        return vertexArray;
    }

    dispose(contextLost = false): void {
        if (this.disposed) return;
        this.disposed = true;
        if (!contextLost) {
            if (this.owned) this.device.gl.deleteProgram(this.native);
        }
        this.releaseVertexArrays(!contextLost);
        this.device.unregisterDisposable(this);
        this.device.unregisterPipelineIdentity(this.native, this);
        this.device.removePipelineCacheEntry(this.cacheKey, this);
    }

    assertUsable(): void {
        this.device.assertAlive();
        if (this.disposed) throw new Error('Render pipeline is no longer valid');
    }

    private vertexArrayRecordMatches(
        record: VertexArrayCacheRecord,
        layouts: readonly NonNullable<RHIRenderPipelineDescriptor['vertex']['buffers']>[number][],
        vertexBuffers: readonly (VertexBufferBindingState | undefined)[],
        indexBuffer: IndexBufferBindingState | null
    ): boolean {
        if (
            record.indexBufferId !== (indexBuffer?.buffer.id ?? 0) ||
            record.indexFormat !== (indexBuffer?.format ?? null) ||
            record.indexOffset !== (indexBuffer?.offset ?? 0) ||
            record.indexSize !== (indexBuffer?.size ?? 0)
        )
            return false;
        for (let slot = 0; slot < layouts.length; slot++) {
            if (!layouts[slot]) continue;
            const binding = vertexBuffers[slot];
            if (
                !binding ||
                record.bufferIds[slot] !== binding.buffer.id ||
                record.offsets[slot] !== binding.offset ||
                record.sizes[slot] !== binding.size
            )
                return false;
        }
        return true;
    }

    private evictOldestVertexArray(): void {
        if (this.vertexArrayCount <= MAX_CACHED_VERTEX_ARRAYS) return;
        let oldestHash: number | undefined;
        let oldestBucket: VertexArrayCacheRecord[] | null = null;
        let oldestIndex = -1;
        let oldestUse = Number.POSITIVE_INFINITY;
        for (const [hash, bucket] of this.vertexArrayBuckets) {
            for (let index = 0; index < bucket.length; index++) {
                const record = bucket[index];
                if (record && record.lastUsed < oldestUse) {
                    oldestUse = record.lastUsed;
                    oldestHash = hash;
                    oldestBucket = bucket;
                    oldestIndex = index;
                }
            }
        }
        if (!oldestBucket || oldestIndex < 0) return;
        const removed = oldestBucket.splice(oldestIndex, 1)[0];
        if (removed) this.device.gl.deleteVertexArray(removed.native);
        if (oldestBucket.length === 0 && oldestHash !== undefined) {
            this.vertexArrayBuckets.delete(oldestHash);
        }
        this.vertexArrayCount--;
    }

    private releaseVertexArrays(deleteNative: boolean): void {
        if (deleteNative) {
            for (const bucket of this.vertexArrayBuckets.values()) {
                for (const record of bucket) this.device.gl.deleteVertexArray(record.native);
            }
        }
        this.vertexArrayBuckets.clear();
        this.vertexArrayCount = 0;
    }

    private createBindingPlans(
        reflection: ProgramReflection,
        prepared: PreparedBindingLookup
    ): {
        readonly groups: readonly PipelineGroupPlan[];
        readonly samplerUnits: readonly number[];
    } {
        interface LayoutBinding {
            readonly group: number;
            readonly binding: number;
            readonly kind: PipelineBindingKind;
            readonly dynamicOffsetIndex: number;
            readonly samplerType?: RHISamplerBindingType;
            readonly textureSampleType?: RHITextureSampleType;
        }
        interface MutableGroupPlan {
            readonly layout: WebGLRHIBindGroupLayout;
            readonly bindings: PipelineBindingPlan[];
            readonly dynamicOffsetCount: number;
        }
        const groups: MutableGroupPlan[] = [];
        const layoutBindings = new Map<string, LayoutBinding>();
        for (let groupIndex = 0; groupIndex < this.layout.bindGroupLayouts.length; groupIndex++) {
            const layout = this.layout.bindGroupLayouts[groupIndex];
            if (!layout) continue;
            let dynamicOffsetIndex = 0;
            for (const entry of layout.entries) {
                const key = `${String(groupIndex)}:${String(entry.binding)}`;
                if (entry.buffer) {
                    const dynamicIndex =
                        entry.buffer.hasDynamicOffset === true ? dynamicOffsetIndex++ : -1;
                    layoutBindings.set(key, {
                        group: groupIndex,
                        binding: entry.binding,
                        kind: 'buffer',
                        dynamicOffsetIndex: dynamicIndex
                    });
                } else if (entry.texture) {
                    layoutBindings.set(key, {
                        group: groupIndex,
                        binding: entry.binding,
                        kind: 'texture' as const,
                        dynamicOffsetIndex: -1,
                        textureSampleType: entry.texture.sampleType ?? 'float'
                    });
                } else if (entry.sampler) {
                    layoutBindings.set(key, {
                        group: groupIndex,
                        binding: entry.binding,
                        kind: 'sampler' as const,
                        dynamicOffsetIndex: -1,
                        samplerType: entry.sampler.type ?? 'filtering'
                    });
                }
            }
            groups.push({ layout, bindings: [], dynamicOffsetCount: dynamicOffsetIndex });
        }

        const requireLayoutBinding = (
            group: number,
            binding: number,
            kind: PipelineBindingKind,
            resourceName: string
        ): LayoutBinding => {
            const layoutBinding = layoutBindings.get(`${String(group)}:${String(binding)}`);
            if (layoutBinding?.kind !== kind) {
                throw new Error(
                    `Prepared GLSL resource ${resourceName} does not match a ${kind} binding at group ${String(group)}, binding ${String(binding)}`
                );
            }
            return layoutBinding;
        };
        const addPlan = (binding: LayoutBinding, slot: number): void => {
            const group = groups[binding.group];
            if (!group) throw new Error('Prepared GLSL binding references a missing bind group');
            group.bindings.push({
                binding: binding.binding,
                kind: binding.kind,
                slot,
                dynamicOffsetIndex: binding.dynamicOffsetIndex
            });
        };
        const validateSamplerPair = (
            texture: LayoutBinding,
            sampler: LayoutBinding,
            resourceName: string
        ): void => {
            const sampleType = texture.textureSampleType;
            const samplerType = sampler.samplerType;
            if (!sampleType || !samplerType) {
                throw new Error(`Prepared GLSL sampler ${resourceName} has an invalid layout pair`);
            }
            if (samplerType === 'comparison') {
                if (sampleType !== 'depth') {
                    throw new Error(
                        `Prepared GLSL sampler ${resourceName} pairs a comparison sampler with ${sampleType} texture sample type`
                    );
                }
                return;
            }
            if (samplerType === 'filtering' && sampleType !== 'float') {
                throw new Error(
                    `Prepared GLSL sampler ${resourceName} pairs a filtering sampler with ${sampleType} texture sample type`
                );
            }
        };

        const activeBlocks = reflection.uniformBlocks.map(block => {
            const binding = prepared.uniformBlocks.get(block.name);
            if (!binding) {
                throw new Error(
                    `Prepared GLSL binding metadata is missing uniform block ${block.name}`
                );
            }
            return {
                reflection: block,
                binding,
                layout: requireLayoutBinding(binding.group, binding.binding, 'buffer', block.name)
            };
        });
        activeBlocks.sort(
            (left, right) =>
                left.binding.group - right.binding.group ||
                left.binding.binding - right.binding.binding
        );
        if (activeBlocks.length > this.device.limits.maxUniformBuffersPerShaderStage) {
            throw new RangeError('Pipeline layout exceeds the WebGL uniform-buffer binding limit');
        }
        for (let slot = 0; slot < activeBlocks.length; slot++) {
            const active = activeBlocks[slot];
            if (!active) continue;
            addPlan(active.layout, slot);
            this.device.gl.uniformBlockBinding(this.native, active.reflection.index, slot);
        }

        const activeSamplers: {
            readonly key: string;
            readonly binding: RHIPreparedSamplerBinding;
            readonly texture: LayoutBinding;
            readonly sampler: LayoutBinding;
        }[] = [];
        for (const sampler of reflection.samplers) {
            for (let arrayIndex = 0; arrayIndex < sampler.size; arrayIndex++) {
                const key = samplerElementKey(sampler.name, arrayIndex);
                const binding = prepared.samplers.get(key);
                if (!binding) {
                    throw new Error(`Prepared GLSL binding metadata is missing sampler ${key}`);
                }
                const texture = requireLayoutBinding(
                    binding.group,
                    binding.textureBinding,
                    'texture',
                    key
                );
                const samplerLayout = requireLayoutBinding(
                    binding.group,
                    binding.samplerBinding,
                    'sampler',
                    key
                );
                validateSamplerPair(texture, samplerLayout, key);
                activeSamplers.push({
                    key,
                    binding,
                    texture,
                    sampler: samplerLayout
                });
            }
        }
        activeSamplers.sort(
            (left, right) =>
                left.binding.group - right.binding.group ||
                left.binding.textureBinding - right.binding.textureBinding ||
                left.binding.samplerBinding - right.binding.samplerBinding ||
                left.key.localeCompare(right.key)
        );
        if (activeSamplers.length > this.device.limits.maxSampledTexturesPerShaderStage) {
            throw new RangeError('Pipeline layout exceeds the WebGL texture-unit limit');
        }
        if (activeSamplers.length > this.device.limits.maxSamplersPerShaderStage) {
            throw new RangeError('Pipeline layout exceeds the WebGL sampler limit');
        }
        const unitBySampler = new Map<string, number>();
        for (let unit = 0; unit < activeSamplers.length; unit++) {
            const active = activeSamplers[unit];
            if (!active) continue;
            addPlan(active.texture, unit);
            addPlan(active.sampler, unit);
            unitBySampler.set(active.key, unit);
        }
        const samplerUnits: number[] = [];
        for (const sampler of reflection.samplers) {
            for (let arrayIndex = 0; arrayIndex < sampler.size; arrayIndex++) {
                const key = samplerElementKey(sampler.name, arrayIndex);
                const unit = unitBySampler.get(key);
                if (unit === undefined)
                    throw new Error(`Prepared GLSL sampler ${key} was not assigned a texture unit`);
                samplerUnits.push(unit);
            }
        }
        return {
            groups: Object.freeze(
                groups.map(group =>
                    Object.freeze({ ...group, bindings: Object.freeze(group.bindings) })
                )
            ),
            samplerUnits: Object.freeze(samplerUnits)
        };
    }
}

export function snapshotPipelineDescriptor(
    descriptor: RHIRenderPipelineDescriptor
): RHIRenderPipelineDescriptor {
    const buffers = descriptor.vertex.buffers?.map(layout => {
        if (!layout) return null;
        const attributes = layout.attributes.map(attribute => Object.freeze({ ...attribute }));
        return Object.freeze({ ...layout, attributes: Object.freeze(attributes) });
    });
    const vertex = Object.freeze({
        ...descriptor.vertex,
        ...(buffers ? { buffers: Object.freeze(buffers) } : {})
    });
    const primitive = descriptor.primitive ? Object.freeze({ ...descriptor.primitive }) : undefined;
    const depthStencil = descriptor.depthStencil
        ? Object.freeze({
              ...descriptor.depthStencil,
              ...(descriptor.depthStencil.stencilFront
                  ? { stencilFront: Object.freeze({ ...descriptor.depthStencil.stencilFront }) }
                  : {}),
              ...(descriptor.depthStencil.stencilBack
                  ? { stencilBack: Object.freeze({ ...descriptor.depthStencil.stencilBack }) }
                  : {})
          })
        : undefined;
    const multisample = descriptor.multisample
        ? Object.freeze({ ...descriptor.multisample })
        : undefined;
    const fragment = descriptor.fragment
        ? Object.freeze({
              ...descriptor.fragment,
              targets: Object.freeze(
                  descriptor.fragment.targets.map(target => {
                      if (!target) return null;
                      const blend = target.blend
                          ? Object.freeze({
                                color: Object.freeze({ ...target.blend.color }),
                                alpha: Object.freeze({ ...target.blend.alpha })
                            })
                          : undefined;
                      return Object.freeze({ ...target, ...(blend ? { blend } : {}) });
                  })
              )
          })
        : undefined;
    return Object.freeze({
        ...descriptor,
        vertex,
        ...(primitive ? { primitive } : {}),
        ...(depthStencil ? { depthStencil } : {}),
        ...(multisample ? { multisample } : {}),
        ...(fragment ? { fragment } : {})
    });
}

function appendStencilFaceKey(key: string, face: RHIStencilFaceState | undefined): string {
    return `${key}${face?.compare ?? 'always'},${face?.failOp ?? 'keep'},${face?.depthFailOp ?? 'keep'},${face?.passOp ?? 'keep'};`;
}

export function renderPipelineKey(descriptor: RHIRenderPipelineDescriptor): string {
    const vertexModule = descriptor.vertex.module;
    let key = `l${String(descriptor.layout.id)}`;
    key += `|v${String(vertexModule.id)},${descriptor.vertex.entryPoint ?? 'main'}`;
    const buffers = descriptor.vertex.buffers ?? [];
    for (let slot = 0; slot < buffers.length; slot++) {
        const buffer = buffers[slot];
        if (!buffer) {
            key += `|vb${String(slot)}:-`;
            continue;
        }
        key += `|vb${String(slot)}:${String(buffer.arrayStride)},${buffer.stepMode ?? 'vertex'}`;
        for (const attribute of buffer.attributes) {
            key += `,a${String(attribute.shaderLocation)},${attribute.format},${String(attribute.offset)}`;
        }
    }
    const primitive = descriptor.primitive;
    key += `|p${primitive?.topology ?? 'triangle-list'},${primitive?.stripIndexFormat ?? '-'},${primitive?.frontFace ?? 'ccw'},${primitive?.cullMode ?? 'none'}`;
    const depth = descriptor.depthStencil;
    if (depth) {
        key += `|d${depth.format},${depth.depthWriteEnabled === true ? '1' : '0'},${depth.depthCompare ?? 'always'},${String(depth.stencilReadMask ?? 0xffffffff)},${String(depth.stencilWriteMask ?? 0xffffffff)},${String(depth.depthBias ?? 0)},${String(depth.depthBiasSlopeScale ?? 0)},${String(depth.depthBiasClamp ?? 0)};`;
        key = appendStencilFaceKey(key, depth.stencilFront);
        key = appendStencilFaceKey(key, depth.stencilBack);
    } else {
        key += '|d-';
    }
    const multisample = descriptor.multisample;
    key += `|m${String(multisample?.count ?? 1)},${String(multisample?.mask ?? 0xffffffff)},${multisample?.alphaToCoverageEnabled === true ? '1' : '0'}`;
    const fragment = descriptor.fragment;
    if (!fragment) return `${key}|f-`;
    key += `|f${String(fragment.module.id)},${fragment.entryPoint ?? 'main'}`;
    for (let index = 0; index < fragment.targets.length; index++) {
        const target = fragment.targets[index];
        key += target ? `|ft${String(index)}:${targetStateKey(target)}` : `|ft${String(index)}:-`;
    }
    return key;
}
