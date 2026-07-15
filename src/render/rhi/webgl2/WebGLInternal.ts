import type { RHIBufferSource, RHICreateOptions } from '../RHI';
import type { RHIDiagnosticsSink } from '../RHIDiagnosticsSink';

export interface WebGLRHICreateOptions extends RHICreateOptions {
    /** Enables counters used by diagnostics and contract tests. Disabled by default. */
    readonly diagnostics?: boolean;
    /** Backend-neutral renderer sink. Supplying it enables the local counters too. @internal */
    readonly diagnosticsSink?: RHIDiagnosticsSink;
    readonly depth?: boolean;
    readonly stencil?: boolean;
    readonly premultipliedAlpha?: boolean;
    readonly preserveDrawingBuffer?: boolean;
    readonly failIfMajorPerformanceCaveat?: boolean;
}

export interface WebGLRHIDiagnosticsSnapshot {
    readonly resourceCreations: number;
    readonly buffersCreated: number;
    readonly texturesCreated: number;
    readonly samplersCreated: number;
    readonly shaderModulesCreated: number;
    readonly pipelinesCreated: number;
    readonly bindGroupsCreated: number;
    readonly framebuffersCreated: number;
    readonly vertexArraysCreated: number;
    readonly stateChanges: number;
    readonly bufferUploads: number;
    readonly textureUploads: number;
    readonly drawCalls: number;
    readonly renderPasses: number;
    readonly commandEncoders: number;
    readonly commandBuffers: number;
    readonly submissions: number;
}

type DiagnosticResource =
    | 'buffer'
    | 'texture'
    | 'sampler'
    | 'shaderModule'
    | 'pipeline'
    | 'bindGroup'
    | 'framebuffer'
    | 'vertexArray';

/** Low-overhead optional counters. No GL query is performed when diagnostics are disabled. */
export class WebGLRHIDiagnostics {
    readonly enabled: boolean;
    private readonly sink: RHIDiagnosticsSink | null;
    resourceCreations = 0;
    buffersCreated = 0;
    texturesCreated = 0;
    samplersCreated = 0;
    shaderModulesCreated = 0;
    pipelinesCreated = 0;
    bindGroupsCreated = 0;
    framebuffersCreated = 0;
    vertexArraysCreated = 0;
    stateChanges = 0;
    bufferUploads = 0;
    textureUploads = 0;
    drawCalls = 0;
    renderPasses = 0;
    commandEncoders = 0;
    commandBuffers = 0;
    submissions = 0;

    constructor(enabled = false, sink: RHIDiagnosticsSink | null = null) {
        this.enabled = enabled;
        this.sink = sink;
        if (sink) {
            sink.markCacheUnavailable('buffer');
            sink.markCacheUnavailable('texture');
            sink.markCacheUnavailable('sampler');
            sink.markCacheUnavailable('program');
            sink.markCacheUnavailable('bindGroupLayout');
            sink.markCacheUnavailable('pipelineLayout');
        }
    }

    recordResource(kind: DiagnosticResource): void {
        if (!this.enabled) return;
        this.resourceCreations++;
        switch (kind) {
            case 'buffer':
                this.buffersCreated++;
                this.sink?.recordNativeObjectCreatedOnly('buffer');
                break;
            case 'texture':
                this.texturesCreated++;
                this.sink?.recordNativeObjectCreatedOnly('texture');
                break;
            case 'sampler':
                this.samplersCreated++;
                this.sink?.recordNativeObjectCreatedOnly('sampler');
                break;
            case 'shaderModule':
                this.shaderModulesCreated++;
                this.sink?.recordNativeObjectCreatedOnly('shaderModule');
                break;
            case 'pipeline':
                this.pipelinesCreated++;
                // WebGL has a native program, not a native pipeline object.
                this.sink?.recordNativeObjectCreatedOnly('program');
                break;
            case 'bindGroup':
                this.bindGroupsCreated++;
                break;
            case 'framebuffer':
                this.framebuffersCreated++;
                this.sink?.recordNativeObjectCreatedOnly('framebuffer');
                break;
            case 'vertexArray':
                this.vertexArraysCreated++;
                this.sink?.recordNativeObjectCreatedOnly('vertexArray');
                break;
        }
    }

    recordStateChange(): void {
        if (!this.enabled) return;
        this.stateChanges++;
        this.sink?.recordStateChange();
    }

    recordBufferUpload(): void {
        if (!this.enabled) return;
        this.bufferUploads++;
        this.sink?.recordUpload();
    }

    recordTextureUpload(): void {
        if (!this.enabled) return;
        this.textureUploads++;
        this.sink?.recordUpload();
    }

    recordDraw(): void {
        if (!this.enabled) return;
        this.drawCalls++;
        this.sink?.recordDraw();
    }

    recordRenderPass(): void {
        if (!this.enabled) return;
        this.renderPasses++;
        this.sink?.recordPass();
    }

    recordCommandEncoder(): void {
        if (!this.enabled) return;
        this.commandEncoders++;
    }

    recordCommandBuffer(): void {
        if (!this.enabled) return;
        this.commandBuffers++;
    }

    recordSubmission(): void {
        if (!this.enabled) return;
        this.submissions++;
        this.sink?.recordSubmission();
    }

    reset(): void {
        this.resourceCreations = 0;
        this.buffersCreated = 0;
        this.texturesCreated = 0;
        this.samplersCreated = 0;
        this.shaderModulesCreated = 0;
        this.pipelinesCreated = 0;
        this.bindGroupsCreated = 0;
        this.framebuffersCreated = 0;
        this.vertexArraysCreated = 0;
        this.stateChanges = 0;
        this.bufferUploads = 0;
        this.textureUploads = 0;
        this.drawCalls = 0;
        this.renderPasses = 0;
        this.commandEncoders = 0;
        this.commandBuffers = 0;
        this.submissions = 0;
    }

    snapshot(): WebGLRHIDiagnosticsSnapshot {
        return {
            resourceCreations: this.resourceCreations,
            buffersCreated: this.buffersCreated,
            texturesCreated: this.texturesCreated,
            samplersCreated: this.samplersCreated,
            shaderModulesCreated: this.shaderModulesCreated,
            pipelinesCreated: this.pipelinesCreated,
            bindGroupsCreated: this.bindGroupsCreated,
            framebuffersCreated: this.framebuffersCreated,
            vertexArraysCreated: this.vertexArraysCreated,
            stateChanges: this.stateChanges,
            bufferUploads: this.bufferUploads,
            textureUploads: this.textureUploads,
            drawCalls: this.drawCalls,
            renderPasses: this.renderPasses,
            commandEncoders: this.commandEncoders,
            commandBuffers: this.commandBuffers,
            submissions: this.submissions
        };
    }
}

let nextObjectId = 1;

function allocateObjectId(): number {
    return nextObjectId++;
}

export function labelOf(label: string | undefined): string {
    return label ?? '';
}

export function requireInteger(value: number, name: string, minimum = 0): void {
    if (!Number.isSafeInteger(value) || value < minimum) {
        throw new RangeError(
            `${name} must be a safe integer greater than or equal to ${String(minimum)}`
        );
    }
}

export function requirePositiveInteger(value: number, name: string): void {
    requireInteger(value, name, 1);
}

export function requireFinite(value: number, name: string): void {
    if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

export function requireRange(offset: number, size: number, total: number, name: string): void {
    requireInteger(offset, `${name} offset`);
    requireInteger(size, `${name} size`);
    if (offset + size > total) {
        throw new RangeError(`${name} range exceeds the resource size`);
    }
}

export function hasUsage(usage: number, required: number): boolean {
    return (usage & required) === required;
}

/** Creates a zero-copy byte view; writeBuffer-style element units are the default. */
export function sourceBytes(
    source: RHIBufferSource,
    offset = 0,
    size?: number,
    units: 'elements' | 'bytes' = 'elements'
): Uint8Array {
    const isView = ArrayBuffer.isView(source);
    const baseOffset = isView ? source.byteOffset : 0;
    const nativeElementSize: unknown = isView
        ? Reflect.get(source, 'BYTES_PER_ELEMENT')
        : undefined;
    const nativeLength: unknown = isView ? Reflect.get(source, 'length') : undefined;
    const typedArray = typeof nativeElementSize === 'number' && typeof nativeLength === 'number';
    const elementSize = typedArray && units === 'elements' ? nativeElementSize : 1;
    const sourceLength = typedArray && units === 'elements' ? nativeLength : source.byteLength;
    const length = size ?? sourceLength - offset;
    requireRange(offset, length, sourceLength, 'Data');
    const buffer = isView ? source.buffer : source;
    return new Uint8Array(buffer, baseOffset + offset * elementSize, length * elementSize);
}

export function cloneBytes(bytes: Uint8Array): Uint8Array {
    const clone = new Uint8Array(bytes.byteLength);
    clone.set(bytes);
    return clone;
}

export function glResource<T>(resource: T | null, description: string): T {
    if (resource === null) throw new Error(`WebGL 2 failed to create ${description}`);
    return resource;
}

export function glNumber(gl: WebGL2RenderingContext, pname: GLenum, fallback: number): number {
    const value: unknown = gl.getParameter(pname);
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export interface DisposableWebGLObject {
    dispose(contextLost?: boolean): void;
}

export class BoundedCache<T> {
    private readonly values = new Map<string, T>();

    constructor(
        private readonly capacity: number,
        private readonly onEvict?: (value: T) => void
    ) {}

    get(key: string): T | undefined {
        const value = this.values.get(key);
        if (value === undefined) return undefined;
        this.values.delete(key);
        this.values.set(key, value);
        return value;
    }

    set(key: string, value: T): void {
        this.values.delete(key);
        this.values.set(key, value);
        while (this.values.size > this.capacity) {
            const oldest = this.values.entries().next().value;
            if (!oldest) break;
            this.values.delete(oldest[0]);
            this.onEvict?.(oldest[1]);
        }
    }

    deleteIf(key: string, value: T): void {
        if (this.values.get(key) === value) this.values.delete(key);
    }

    clear(): void {
        if (this.onEvict) {
            for (const value of this.values.values()) this.onEvict(value);
        }
        this.values.clear();
    }

    discard(): void {
        this.values.clear();
    }
}

export abstract class WebGLObjectBase {
    readonly id = allocateObjectId();
    readonly backend = 'webgl2' as const;
    readonly label: string;

    protected constructor(label?: string) {
        this.label = labelOf(label);
    }
}

export abstract class WebGLDestroyableBase extends WebGLObjectBase {
    protected _destroyed = false;

    get destroyed(): boolean {
        return this._destroyed;
    }
}

const TEXTURE_TARGET_SLOT_COUNT = 4;

function textureTargetSlot(gl: WebGL2RenderingContext, target: GLenum): number {
    switch (target) {
        case gl.TEXTURE_2D:
            return 0;
        case gl.TEXTURE_CUBE_MAP:
            return 1;
        case gl.TEXTURE_3D:
            return 2;
        case gl.TEXTURE_2D_ARRAY:
            return 3;
        default:
            return -1;
    }
}

/** @internal Context-local state differential used by the WebGL RHI and migration adapters. */
export class WebGLRHIState {
    readonly gl: WebGL2RenderingContext;
    readonly scratchF32 = new Float32Array(4);
    readonly scratchI32 = new Int32Array(4);
    readonly scratchU32 = new Uint32Array(4);
    readonly scratchAttachments: GLenum[] = [];
    private readonly diagnostics: WebGLRHIDiagnostics | null;
    private program: WebGLProgram | null = null;
    private programValid = false;
    private vertexArray: WebGLVertexArrayObject | null = null;
    private vertexArrayValid = false;
    private arrayBuffer: WebGLBuffer | null = null;
    private arrayBufferValid = false;
    private copyReadBuffer: WebGLBuffer | null = null;
    private copyReadBufferValid = false;
    private copyWriteBuffer: WebGLBuffer | null = null;
    private copyWriteBufferValid = false;
    private pixelPackBuffer: WebGLBuffer | null = null;
    private pixelPackBufferValid = false;
    private pixelUnpackBuffer: WebGLBuffer | null = null;
    private pixelUnpackBufferValid = false;
    private drawFramebuffer: WebGLFramebuffer | null = null;
    private drawFramebufferValid = false;
    private readFramebuffer: WebGLFramebuffer | null = null;
    private readFramebufferValid = false;
    private previousDrawFramebuffer: WebGLFramebuffer | null = null;
    private renderbuffer: WebGLRenderbuffer | null = null;
    private renderbufferValid = false;
    private activeTextureUnit = -1;
    /** Flat [unit, target] table. The hot bind path performs no Map lookup or allocation. */
    private readonly textureObjects: (WebGLTexture | null | undefined)[];
    private readonly samplerUnits: (WebGLSampler | null | undefined)[] = [];
    private readonly uniformBufferObjects: (WebGLBuffer | undefined)[] = [];
    private readonly uniformBufferOffsets: (number | undefined)[] = [];
    private readonly uniformBufferSizes: (number | undefined)[] = [];
    private readonly capabilities = new Map<GLenum, boolean>();
    private readonly pixelStore = new Map<GLenum, number | boolean>();
    private readonly viewportState = new Float64Array(4);
    private viewportValid = false;
    private readonly scissorState = new Float64Array(4);
    private scissorValid = false;
    private readonly depthRangeState = new Float64Array(2);
    private depthRangeValid = false;
    private readonly colorMaskState = [false, false, false, false];
    private colorMaskValid = false;
    private depthMaskState: boolean | null = null;
    private depthFuncState: GLenum | null = null;
    private cullFaceState: GLenum | null = null;
    private frontFaceState: GLenum | null = null;
    private readonly blendEquationState = new Uint32Array(2);
    private blendEquationValid = false;
    private readonly blendFunctionState = new Uint32Array(4);
    private blendFunctionValid = false;
    private readonly blendColorState = new Float64Array(4);
    private blendColorValid = false;
    private readonly polygonOffsetState = new Float64Array(2);
    private polygonOffsetValid = false;
    private stencilReference = 0;
    private readonly stencilFrontFunction = new Float64Array(3);
    private stencilFrontFunctionValid = false;
    private readonly stencilBackFunction = new Float64Array(3);
    private stencilBackFunctionValid = false;
    private readonly stencilFrontOperation = new Uint32Array(3);
    private stencilFrontOperationValid = false;
    private readonly stencilBackOperation = new Uint32Array(3);
    private stencilBackOperationValid = false;
    private stencilFrontMask: number | null = null;
    private stencilBackMask: number | null = null;

    constructor(gl: WebGL2RenderingContext, diagnostics?: WebGLRHIDiagnostics) {
        this.gl = gl;
        this.diagnostics = diagnostics?.enabled === true ? diagnostics : null;
        const textureUnitCount = Math.max(1, glNumber(gl, gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS, 32));
        this.textureObjects = new Array<WebGLTexture | null | undefined>(
            textureUnitCount * TEXTURE_TARGET_SLOT_COUNT
        );
    }

    private changed(): void {
        this.diagnostics?.recordStateChange();
    }

    invalidate(): void {
        this.program = null;
        this.programValid = false;
        this.vertexArray = null;
        this.vertexArrayValid = false;
        this.arrayBuffer = null;
        this.arrayBufferValid = false;
        this.copyReadBuffer = null;
        this.copyReadBufferValid = false;
        this.copyWriteBuffer = null;
        this.copyWriteBufferValid = false;
        this.pixelPackBuffer = null;
        this.pixelPackBufferValid = false;
        this.pixelUnpackBuffer = null;
        this.pixelUnpackBufferValid = false;
        this.drawFramebuffer = null;
        this.drawFramebufferValid = false;
        this.readFramebuffer = null;
        this.readFramebufferValid = false;
        this.previousDrawFramebuffer = null;
        this.renderbuffer = null;
        this.renderbufferValid = false;
        this.activeTextureUnit = -1;
        this.textureObjects.fill(undefined);
        this.samplerUnits.length = 0;
        this.uniformBufferObjects.length = 0;
        this.uniformBufferOffsets.length = 0;
        this.uniformBufferSizes.length = 0;
        this.capabilities.clear();
        this.pixelStore.clear();
        this.viewportValid = false;
        this.scissorValid = false;
        this.depthRangeValid = false;
        this.colorMaskValid = false;
        this.depthMaskState = null;
        this.depthFuncState = null;
        this.cullFaceState = null;
        this.frontFaceState = null;
        this.blendEquationValid = false;
        this.blendFunctionValid = false;
        this.blendColorValid = false;
        this.polygonOffsetValid = false;
        this.stencilFrontFunctionValid = false;
        this.stencilBackFunctionValid = false;
        this.stencilFrontOperationValid = false;
        this.stencilBackOperationValid = false;
        this.stencilFrontMask = null;
        this.stencilBackMask = null;
    }

    useProgram(program: WebGLProgram | null): void {
        if (this.programValid && this.program === program) return;
        this.program = program;
        this.programValid = true;
        this.gl.useProgram(program);
        this.changed();
    }

    bindVertexArray(vertexArray: WebGLVertexArrayObject | null): void {
        if (this.vertexArrayValid && this.vertexArray === vertexArray) return;
        this.vertexArray = vertexArray;
        this.vertexArrayValid = true;
        this.gl.bindVertexArray(vertexArray);
        this.changed();
    }

    bindBuffer(target: GLenum, buffer: WebGLBuffer | null): void {
        let previous: WebGLBuffer | null;
        switch (target) {
            case this.gl.ARRAY_BUFFER:
                previous = this.arrayBuffer;
                if (this.arrayBufferValid && previous === buffer) return;
                this.arrayBuffer = buffer;
                this.arrayBufferValid = true;
                break;
            case this.gl.COPY_READ_BUFFER:
                previous = this.copyReadBuffer;
                if (this.copyReadBufferValid && previous === buffer) return;
                this.copyReadBuffer = buffer;
                this.copyReadBufferValid = true;
                break;
            case this.gl.COPY_WRITE_BUFFER:
                previous = this.copyWriteBuffer;
                if (this.copyWriteBufferValid && previous === buffer) return;
                this.copyWriteBuffer = buffer;
                this.copyWriteBufferValid = true;
                break;
            case this.gl.PIXEL_PACK_BUFFER:
                previous = this.pixelPackBuffer;
                if (this.pixelPackBufferValid && previous === buffer) return;
                this.pixelPackBuffer = buffer;
                this.pixelPackBufferValid = true;
                break;
            case this.gl.PIXEL_UNPACK_BUFFER:
                previous = this.pixelUnpackBuffer;
                if (this.pixelUnpackBufferValid && previous === buffer) return;
                this.pixelUnpackBuffer = buffer;
                this.pixelUnpackBufferValid = true;
                break;
            default:
                this.gl.bindBuffer(target, buffer);
                this.changed();
                return;
        }
        this.gl.bindBuffer(target, buffer);
        this.changed();
    }

    bindFramebuffer(target: GLenum, framebuffer: WebGLFramebuffer | null): void {
        const gl = this.gl;
        if (target === gl.FRAMEBUFFER) {
            if (
                this.drawFramebufferValid &&
                this.readFramebufferValid &&
                this.drawFramebuffer === framebuffer &&
                this.readFramebuffer === framebuffer
            )
                return;
            this.previousDrawFramebuffer = this.drawFramebufferValid ? this.drawFramebuffer : null;
            this.drawFramebuffer = framebuffer;
            this.readFramebuffer = framebuffer;
            this.drawFramebufferValid = true;
            this.readFramebufferValid = true;
        } else if (target === gl.DRAW_FRAMEBUFFER) {
            if (this.drawFramebufferValid && this.drawFramebuffer === framebuffer) return;
            this.previousDrawFramebuffer = this.drawFramebufferValid ? this.drawFramebuffer : null;
            this.drawFramebuffer = framebuffer;
            this.drawFramebufferValid = true;
        } else if (target === gl.READ_FRAMEBUFFER) {
            if (this.readFramebufferValid && this.readFramebuffer === framebuffer) return;
            this.readFramebuffer = framebuffer;
            this.readFramebufferValid = true;
        }
        gl.bindFramebuffer(target, framebuffer);
        this.changed();
    }

    get currentDrawFramebuffer(): WebGLFramebuffer | null {
        return this.drawFramebuffer;
    }

    get currentReadFramebuffer(): WebGLFramebuffer | null {
        return this.readFramebuffer;
    }

    get preFramebuffer(): WebGLFramebuffer | null {
        return this.previousDrawFramebuffer;
    }

    bindRenderbuffer(renderbuffer: WebGLRenderbuffer | null): void {
        if (this.renderbufferValid && this.renderbuffer === renderbuffer) return;
        this.renderbuffer = renderbuffer;
        this.renderbufferValid = true;
        this.gl.bindRenderbuffer(this.gl.RENDERBUFFER, renderbuffer);
        this.changed();
    }

    activeTexture(unit: number): void {
        if (this.activeTextureUnit === unit) return;
        this.activeTextureUnit = unit;
        this.gl.activeTexture(this.gl.TEXTURE0 + unit);
        this.changed();
    }

    get currentTextureUnit(): number {
        return this.activeTextureUnit < 0 ? 0 : this.activeTextureUnit;
    }

    getBoundTexture(unit: number, target: GLenum): WebGLTexture | null | undefined {
        const targetSlot = textureTargetSlot(this.gl, target);
        if (targetSlot < 0) return undefined;
        return this.textureObjects[unit * TEXTURE_TARGET_SLOT_COUNT + targetSlot];
    }

    bindTexture(unit: number, target: GLenum, texture: WebGLTexture | null): void {
        const targetSlot = textureTargetSlot(this.gl, target);
        const bindingIndex = unit * TEXTURE_TARGET_SLOT_COUNT + targetSlot;
        if (targetSlot >= 0 && this.textureObjects[bindingIndex] === texture) return;
        this.activeTexture(unit);
        this.gl.bindTexture(target, texture);
        if (targetSlot >= 0) this.textureObjects[bindingIndex] = texture;
        this.changed();
    }

    bindSampler(unit: number, sampler: WebGLSampler | null): void {
        if (this.samplerUnits[unit] === sampler) return;
        this.samplerUnits[unit] = sampler;
        this.gl.bindSampler(unit, sampler);
        this.changed();
    }

    bindUniformBuffer(index: number, buffer: WebGLBuffer, offset: number, size: number): void {
        if (
            this.uniformBufferObjects[index] === buffer &&
            this.uniformBufferOffsets[index] === offset &&
            this.uniformBufferSizes[index] === size
        )
            return;
        this.gl.bindBufferRange(this.gl.UNIFORM_BUFFER, index, buffer, offset, size);
        this.uniformBufferObjects[index] = buffer;
        this.uniformBufferOffsets[index] = offset;
        this.uniformBufferSizes[index] = size;
        this.changed();
    }

    enable(capability: GLenum, enabled: boolean): void {
        if (this.capabilities.get(capability) === enabled) return;
        this.capabilities.set(capability, enabled);
        if (enabled) this.gl.enable(capability);
        else this.gl.disable(capability);
        this.changed();
    }

    isEnabled(capability: GLenum): boolean {
        const cached = this.capabilities.get(capability);
        if (cached !== undefined || this.capabilities.has(capability)) return cached === true;
        const enabled = this.gl.isEnabled(capability);
        this.capabilities.set(capability, enabled);
        return enabled;
    }

    pixelStorei(pname: GLenum, param: number | boolean): void {
        if (this.pixelStore.get(pname) === param && this.pixelStore.has(pname)) return;
        this.pixelStore.set(pname, param);
        this.gl.pixelStorei(pname, param);
        this.changed();
    }

    viewport(x: number, y: number, width: number, height: number): void {
        const state = this.viewportState;
        if (
            this.viewportValid &&
            state[0] === x &&
            state[1] === y &&
            state[2] === width &&
            state[3] === height
        )
            return;
        state[0] = x;
        state[1] = y;
        state[2] = width;
        state[3] = height;
        this.viewportValid = true;
        this.gl.viewport(x, y, width, height);
        this.changed();
    }

    scissor(x: number, y: number, width: number, height: number): void {
        const state = this.scissorState;
        if (
            this.scissorValid &&
            state[0] === x &&
            state[1] === y &&
            state[2] === width &&
            state[3] === height
        )
            return;
        state[0] = x;
        state[1] = y;
        state[2] = width;
        state[3] = height;
        this.scissorValid = true;
        this.gl.scissor(x, y, width, height);
        this.changed();
    }

    depthRange(minimum: number, maximum: number): void {
        const state = this.depthRangeState;
        if (this.depthRangeValid && state[0] === minimum && state[1] === maximum) return;
        state[0] = minimum;
        state[1] = maximum;
        this.depthRangeValid = true;
        this.gl.depthRange(minimum, maximum);
        this.changed();
    }

    colorMask(red: boolean, green: boolean, blue: boolean, alpha: boolean): void {
        const state = this.colorMaskState;
        if (
            this.colorMaskValid &&
            state[0] === red &&
            state[1] === green &&
            state[2] === blue &&
            state[3] === alpha
        )
            return;
        state[0] = red;
        state[1] = green;
        state[2] = blue;
        state[3] = alpha;
        this.colorMaskValid = true;
        this.gl.colorMask(red, green, blue, alpha);
        this.changed();
    }

    depthMask(enabled: boolean): void {
        if (this.depthMaskState === enabled) return;
        this.depthMaskState = enabled;
        this.gl.depthMask(enabled);
        this.changed();
    }

    depthFunc(func: GLenum): void {
        if (this.depthFuncState === func) return;
        this.depthFuncState = func;
        this.gl.depthFunc(func);
        this.changed();
    }

    cullFace(mode: GLenum): void {
        if (this.cullFaceState === mode) return;
        this.cullFaceState = mode;
        this.gl.cullFace(mode);
        this.changed();
    }

    frontFace(mode: GLenum): void {
        if (this.frontFaceState === mode) return;
        this.frontFaceState = mode;
        this.gl.frontFace(mode);
        this.changed();
    }

    blendEquationSeparate(color: GLenum, alpha: GLenum): void {
        const state = this.blendEquationState;
        if (this.blendEquationValid && state[0] === color && state[1] === alpha) return;
        state[0] = color;
        state[1] = alpha;
        this.blendEquationValid = true;
        this.gl.blendEquationSeparate(color, alpha);
        this.changed();
    }

    blendFuncSeparate(
        srcColor: GLenum,
        dstColor: GLenum,
        srcAlpha: GLenum,
        dstAlpha: GLenum
    ): void {
        const state = this.blendFunctionState;
        if (
            this.blendFunctionValid &&
            state[0] === srcColor &&
            state[1] === dstColor &&
            state[2] === srcAlpha &&
            state[3] === dstAlpha
        )
            return;
        state[0] = srcColor;
        state[1] = dstColor;
        state[2] = srcAlpha;
        state[3] = dstAlpha;
        this.blendFunctionValid = true;
        this.gl.blendFuncSeparate(srcColor, dstColor, srcAlpha, dstAlpha);
        this.changed();
    }

    blendColor(red: number, green: number, blue: number, alpha: number): void {
        const state = this.blendColorState;
        if (
            this.blendColorValid &&
            state[0] === red &&
            state[1] === green &&
            state[2] === blue &&
            state[3] === alpha
        )
            return;
        state[0] = red;
        state[1] = green;
        state[2] = blue;
        state[3] = alpha;
        this.blendColorValid = true;
        this.gl.blendColor(red, green, blue, alpha);
        this.changed();
    }

    polygonOffset(factor: number, units: number): void {
        const state = this.polygonOffsetState;
        if (this.polygonOffsetValid && state[0] === factor && state[1] === units) return;
        state[0] = factor;
        state[1] = units;
        this.polygonOffsetValid = true;
        this.gl.polygonOffset(factor, units);
        this.changed();
    }

    setStencilReference(reference: number): void {
        this.stencilReference = reference;
    }

    stencilFunc(func: GLenum, reference: GLint, mask: GLuint): void {
        if (
            this.stencilFrontFunctionValid &&
            this.stencilBackFunctionValid &&
            this.stencilFrontFunction[0] === func &&
            this.stencilFrontFunction[1] === reference &&
            this.stencilFrontFunction[2] === mask &&
            this.stencilBackFunction[0] === func &&
            this.stencilBackFunction[1] === reference &&
            this.stencilBackFunction[2] === mask
        )
            return;
        this.stencilReference = reference;
        this.stencilFrontFunction[0] = func;
        this.stencilFrontFunction[1] = reference;
        this.stencilFrontFunction[2] = mask;
        this.stencilBackFunction.set(this.stencilFrontFunction);
        this.stencilFrontFunctionValid = true;
        this.stencilBackFunctionValid = true;
        this.gl.stencilFunc(func, reference, mask);
        this.changed();
    }

    stencilOp(fail: GLenum, depthFail: GLenum, pass: GLenum): void {
        if (
            this.stencilFrontOperationValid &&
            this.stencilBackOperationValid &&
            this.stencilFrontOperation[0] === fail &&
            this.stencilFrontOperation[1] === depthFail &&
            this.stencilFrontOperation[2] === pass &&
            this.stencilBackOperation[0] === fail &&
            this.stencilBackOperation[1] === depthFail &&
            this.stencilBackOperation[2] === pass
        )
            return;
        this.stencilFrontOperation[0] = fail;
        this.stencilFrontOperation[1] = depthFail;
        this.stencilFrontOperation[2] = pass;
        this.stencilBackOperation.set(this.stencilFrontOperation);
        this.stencilFrontOperationValid = true;
        this.stencilBackOperationValid = true;
        this.gl.stencilOp(fail, depthFail, pass);
        this.changed();
    }

    stencilMask(mask: GLuint): void {
        if (this.stencilFrontMask === mask && this.stencilBackMask === mask) return;
        this.stencilFrontMask = mask;
        this.stencilBackMask = mask;
        this.gl.stencilMask(mask);
        this.changed();
    }

    stencilFuncSeparate(face: GLenum, func: GLenum, mask: number): void {
        const reference = this.stencilReference;
        const previous =
            face === this.gl.FRONT ? this.stencilFrontFunction : this.stencilBackFunction;
        const valid =
            face === this.gl.FRONT ? this.stencilFrontFunctionValid : this.stencilBackFunctionValid;
        if (valid && previous[0] === func && previous[1] === reference && previous[2] === mask)
            return;
        previous[0] = func;
        previous[1] = reference;
        previous[2] = mask;
        if (face === this.gl.FRONT) this.stencilFrontFunctionValid = true;
        else this.stencilBackFunctionValid = true;
        this.gl.stencilFuncSeparate(face, func, reference, mask);
        this.changed();
    }

    stencilOpSeparate(face: GLenum, fail: GLenum, depthFail: GLenum, pass: GLenum): void {
        const previous =
            face === this.gl.FRONT ? this.stencilFrontOperation : this.stencilBackOperation;
        const valid =
            face === this.gl.FRONT
                ? this.stencilFrontOperationValid
                : this.stencilBackOperationValid;
        if (valid && previous[0] === fail && previous[1] === depthFail && previous[2] === pass)
            return;
        previous[0] = fail;
        previous[1] = depthFail;
        previous[2] = pass;
        if (face === this.gl.FRONT) this.stencilFrontOperationValid = true;
        else this.stencilBackOperationValid = true;
        this.gl.stencilOpSeparate(face, fail, depthFail, pass);
        this.changed();
    }

    stencilMaskSeparate(face: GLenum, mask: number): void {
        if (face === this.gl.FRONT) {
            if (this.stencilFrontMask === mask) return;
            this.stencilFrontMask = mask;
        } else {
            if (this.stencilBackMask === mask) return;
            this.stencilBackMask = mask;
        }
        this.gl.stencilMaskSeparate(face, mask);
        this.changed();
    }

    /** @internal Compatibility inspection; not used by render hot paths. */
    getCachedState(name: string): unknown {
        if (name.startsWith('capability:')) {
            const capability = Number(name.slice('capability:'.length));
            return this.capabilities.has(capability)
                ? this.capabilities.get(capability)
                : undefined;
        }
        switch (name) {
            case 'useProgram':
                return this.programValid ? this.program : undefined;
            case 'depthFunc':
                return this.depthFuncState ?? undefined;
            case 'depthMask':
                return this.depthMaskState ?? undefined;
            case 'stencilMask':
                return this.stencilFrontMask === this.stencilBackMask
                    ? (this.stencilFrontMask ?? undefined)
                    : undefined;
            case 'cullFace':
                return this.cullFaceState ?? undefined;
            case 'frontFace':
                return this.frontFaceState ?? undefined;
            case 'depthRange':
                return this.depthRangeValid ? Array.from(this.depthRangeState) : undefined;
            case 'blendEquationSeparate':
                return this.blendEquationValid ? Array.from(this.blendEquationState) : undefined;
            case 'stencilFunc':
                return this.stencilFrontFunctionValid &&
                    this.stencilBackFunctionValid &&
                    this.stencilFrontFunction.every(
                        (value, index) => value === this.stencilBackFunction[index]
                    )
                    ? Array.from(this.stencilFrontFunction)
                    : undefined;
            case 'stencilOp':
                return this.stencilFrontOperationValid &&
                    this.stencilBackOperationValid &&
                    this.stencilFrontOperation.every(
                        (value, index) => value === this.stencilBackOperation[index]
                    )
                    ? Array.from(this.stencilFrontOperation)
                    : undefined;
            case 'colorMask':
                return this.colorMaskValid ? [...this.colorMaskState] : undefined;
            case 'blendFuncSeparate':
                return this.blendFunctionValid ? Array.from(this.blendFunctionState) : undefined;
            case 'viewport':
                return this.viewportValid ? Array.from(this.viewportState) : undefined;
            default:
                return undefined;
        }
    }
}
