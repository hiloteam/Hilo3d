import type { RHIFrameDiagnostics, RHIRect, RHIViewport } from '../../core';

/** Immutable native scalar state compiled once with a WebGL2 graphics pipeline. */
export interface WebGL2PipelineStatePlan {
    readonly program: WebGLProgram;
    readonly cullEnabled: boolean;
    readonly cullMode: GLenum;
    readonly frontFace: GLenum;
    readonly blendEnabled: boolean;
    readonly blendEquationColor: GLenum;
    readonly blendEquationAlpha: GLenum;
    readonly blendSourceColor: GLenum;
    readonly blendDestinationColor: GLenum;
    readonly blendSourceAlpha: GLenum;
    readonly blendDestinationAlpha: GLenum;
    readonly colorWriteMask: number;
    readonly depthEnabled: boolean;
    readonly depthCompare: GLenum;
    readonly depthWrite: boolean;
    readonly stencilEnabled: boolean;
    readonly stencilReadMask: number;
    readonly stencilWriteMask: number;
    readonly stencilFrontCompare: GLenum;
    readonly stencilFrontFail: GLenum;
    readonly stencilFrontDepthFail: GLenum;
    readonly stencilFrontPass: GLenum;
    readonly stencilBackCompare: GLenum;
    readonly stencilBackFail: GLenum;
    readonly stencilBackDepthFail: GLenum;
    readonly stencilBackPass: GLenum;
    readonly polygonOffsetEnabled: boolean;
    readonly polygonOffsetFactor: number;
    readonly polygonOffsetUnits: number;
    readonly alphaToCoverageEnabled: boolean;
}

/** The one canonical native-state cache for a WebGL2 device generation. */
export class WebGL2StateTracker {
    #program: WebGLProgram | null | undefined;
    #vertexArray: WebGLVertexArrayObject | null | undefined;
    #drawFramebuffer: WebGLFramebuffer | null | undefined;
    #readFramebuffer: WebGLFramebuffer | null | undefined;
    #renderbuffer: WebGLRenderbuffer | null = null;
    #activeTexture = -1;
    readonly #buffers = new Map<GLenum, WebGLBuffer | null>();
    readonly #textures = new Map<number, WebGLTexture | null>();
    readonly #samplers = new Map<number, WebGLSampler | null>();
    readonly #capabilities = new Map<GLenum, boolean>();
    readonly #uniformBuffers: (WebGLBuffer | null)[];
    readonly #uniformOffsets: number[];
    readonly #uniformSizes: number[];
    #cullMode = -1;
    #frontFace = -1;
    #blendEquationColor = -1;
    #blendEquationAlpha = -1;
    #blendSourceColor = -1;
    #blendDestinationColor = -1;
    #blendSourceAlpha = -1;
    #blendDestinationAlpha = -1;
    #colorMask = -1;
    #depthFunction = -1;
    #depthWrite: boolean | null = null;
    #polygonFactor = Number.NaN;
    #polygonUnits = Number.NaN;
    #stencilWriteMask = -1;
    #stencilFrontCompare = -1;
    #stencilFrontReference = -1;
    #stencilFrontReadMask = -1;
    #stencilFrontFail = -1;
    #stencilFrontDepthFail = -1;
    #stencilFrontPass = -1;
    #stencilBackCompare = -1;
    #stencilBackReference = -1;
    #stencilBackReadMask = -1;
    #stencilBackFail = -1;
    #stencilBackDepthFail = -1;
    #stencilBackPass = -1;
    #viewportX = Number.NaN;
    #viewportY = Number.NaN;
    #viewportWidth = Number.NaN;
    #viewportHeight = Number.NaN;
    #scissorX = Number.NaN;
    #scissorY = Number.NaN;
    #scissorWidth = Number.NaN;
    #scissorHeight = Number.NaN;
    #blendRed = Number.NaN;
    #blendGreen = Number.NaN;
    #blendBlue = Number.NaN;
    #blendAlpha = Number.NaN;
    #depthRangeMinimum = Number.NaN;
    #depthRangeMaximum = Number.NaN;
    readonly #pixelStore = new Map<GLenum, number>();

    constructor(
        readonly gl: WebGL2RenderingContext,
        private diagnostics: RHIFrameDiagnostics | null = null
    ) {
        const uniformBindingCount = Number(gl.getParameter(gl.MAX_UNIFORM_BUFFER_BINDINGS)) || 12;
        this.#uniformBuffers = Array.from({ length: uniformBindingCount }, () => null);
        this.#uniformOffsets = Array.from({ length: uniformBindingCount }, () => -1);
        this.#uniformSizes = Array.from({ length: uniformBindingCount }, () => -1);
    }

    setDiagnostics(diagnostics: RHIFrameDiagnostics | null): void {
        this.diagnostics = diagnostics;
    }

    /** Apply one constructor-compiled pipeline plan without descriptor walks or helper dispatch. */
    applyPipelineState(plan: Readonly<WebGL2PipelineStatePlan>, stencilReference: number): void {
        const gl = this.gl;
        const capabilities = this.#capabilities;

        if (this.#program !== plan.program) {
            gl.useProgram(plan.program);
            this.#program = plan.program;
            this.record();
        }

        if (capabilities.get(gl.CULL_FACE) !== plan.cullEnabled) {
            if (plan.cullEnabled) gl.enable(gl.CULL_FACE);
            else gl.disable(gl.CULL_FACE);
            capabilities.set(gl.CULL_FACE, plan.cullEnabled);
            this.record();
        }
        if (plan.cullEnabled && this.#cullMode !== plan.cullMode) {
            gl.cullFace(plan.cullMode);
            this.#cullMode = plan.cullMode;
            this.record();
        }
        if (this.#frontFace !== plan.frontFace) {
            gl.frontFace(plan.frontFace);
            this.#frontFace = plan.frontFace;
            this.record();
        }

        if (capabilities.get(gl.BLEND) !== plan.blendEnabled) {
            if (plan.blendEnabled) gl.enable(gl.BLEND);
            else gl.disable(gl.BLEND);
            capabilities.set(gl.BLEND, plan.blendEnabled);
            this.record();
        }
        if (plan.blendEnabled) {
            if (
                this.#blendEquationColor !== plan.blendEquationColor ||
                this.#blendEquationAlpha !== plan.blendEquationAlpha
            ) {
                gl.blendEquationSeparate(plan.blendEquationColor, plan.blendEquationAlpha);
                this.#blendEquationColor = plan.blendEquationColor;
                this.#blendEquationAlpha = plan.blendEquationAlpha;
                this.record();
            }
            if (
                this.#blendSourceColor !== plan.blendSourceColor ||
                this.#blendDestinationColor !== plan.blendDestinationColor ||
                this.#blendSourceAlpha !== plan.blendSourceAlpha ||
                this.#blendDestinationAlpha !== plan.blendDestinationAlpha
            ) {
                gl.blendFuncSeparate(
                    plan.blendSourceColor,
                    plan.blendDestinationColor,
                    plan.blendSourceAlpha,
                    plan.blendDestinationAlpha
                );
                this.#blendSourceColor = plan.blendSourceColor;
                this.#blendDestinationColor = plan.blendDestinationColor;
                this.#blendSourceAlpha = plan.blendSourceAlpha;
                this.#blendDestinationAlpha = plan.blendDestinationAlpha;
                this.record();
            }
        }
        if (this.#colorMask !== plan.colorWriteMask) {
            const mask = plan.colorWriteMask;
            gl.colorMask((mask & 1) !== 0, (mask & 2) !== 0, (mask & 4) !== 0, (mask & 8) !== 0);
            this.#colorMask = mask;
            this.record();
        }

        if (capabilities.get(gl.DEPTH_TEST) !== plan.depthEnabled) {
            if (plan.depthEnabled) gl.enable(gl.DEPTH_TEST);
            else gl.disable(gl.DEPTH_TEST);
            capabilities.set(gl.DEPTH_TEST, plan.depthEnabled);
            this.record();
        }
        if (plan.depthEnabled && this.#depthFunction !== plan.depthCompare) {
            gl.depthFunc(plan.depthCompare);
            this.#depthFunction = plan.depthCompare;
            this.record();
        }
        if (this.#depthWrite !== plan.depthWrite) {
            gl.depthMask(plan.depthWrite);
            this.#depthWrite = plan.depthWrite;
            this.record();
        }

        if (capabilities.get(gl.STENCIL_TEST) !== plan.stencilEnabled) {
            if (plan.stencilEnabled) gl.enable(gl.STENCIL_TEST);
            else gl.disable(gl.STENCIL_TEST);
            capabilities.set(gl.STENCIL_TEST, plan.stencilEnabled);
            this.record();
        }
        if (plan.stencilEnabled) {
            if (
                this.#stencilFrontCompare !== plan.stencilFrontCompare ||
                this.#stencilFrontReference !== stencilReference ||
                this.#stencilFrontReadMask !== plan.stencilReadMask
            ) {
                gl.stencilFuncSeparate(
                    gl.FRONT,
                    plan.stencilFrontCompare,
                    stencilReference,
                    plan.stencilReadMask
                );
                this.#stencilFrontCompare = plan.stencilFrontCompare;
                this.#stencilFrontReference = stencilReference;
                this.#stencilFrontReadMask = plan.stencilReadMask;
                this.record();
            }
            if (
                this.#stencilFrontFail !== plan.stencilFrontFail ||
                this.#stencilFrontDepthFail !== plan.stencilFrontDepthFail ||
                this.#stencilFrontPass !== plan.stencilFrontPass
            ) {
                gl.stencilOpSeparate(
                    gl.FRONT,
                    plan.stencilFrontFail,
                    plan.stencilFrontDepthFail,
                    plan.stencilFrontPass
                );
                this.#stencilFrontFail = plan.stencilFrontFail;
                this.#stencilFrontDepthFail = plan.stencilFrontDepthFail;
                this.#stencilFrontPass = plan.stencilFrontPass;
                this.record();
            }
            if (
                this.#stencilBackCompare !== plan.stencilBackCompare ||
                this.#stencilBackReference !== stencilReference ||
                this.#stencilBackReadMask !== plan.stencilReadMask
            ) {
                gl.stencilFuncSeparate(
                    gl.BACK,
                    plan.stencilBackCompare,
                    stencilReference,
                    plan.stencilReadMask
                );
                this.#stencilBackCompare = plan.stencilBackCompare;
                this.#stencilBackReference = stencilReference;
                this.#stencilBackReadMask = plan.stencilReadMask;
                this.record();
            }
            if (
                this.#stencilBackFail !== plan.stencilBackFail ||
                this.#stencilBackDepthFail !== plan.stencilBackDepthFail ||
                this.#stencilBackPass !== plan.stencilBackPass
            ) {
                gl.stencilOpSeparate(
                    gl.BACK,
                    plan.stencilBackFail,
                    plan.stencilBackDepthFail,
                    plan.stencilBackPass
                );
                this.#stencilBackFail = plan.stencilBackFail;
                this.#stencilBackDepthFail = plan.stencilBackDepthFail;
                this.#stencilBackPass = plan.stencilBackPass;
                this.record();
            }
            if (this.#stencilWriteMask !== plan.stencilWriteMask) {
                gl.stencilMask(plan.stencilWriteMask);
                this.#stencilWriteMask = plan.stencilWriteMask;
                this.record();
            }
        }

        if (capabilities.get(gl.POLYGON_OFFSET_FILL) !== plan.polygonOffsetEnabled) {
            if (plan.polygonOffsetEnabled) gl.enable(gl.POLYGON_OFFSET_FILL);
            else gl.disable(gl.POLYGON_OFFSET_FILL);
            capabilities.set(gl.POLYGON_OFFSET_FILL, plan.polygonOffsetEnabled);
            this.record();
        }
        if (
            plan.polygonOffsetEnabled &&
            (this.#polygonFactor !== plan.polygonOffsetFactor ||
                this.#polygonUnits !== plan.polygonOffsetUnits)
        ) {
            gl.polygonOffset(plan.polygonOffsetFactor, plan.polygonOffsetUnits);
            this.#polygonFactor = plan.polygonOffsetFactor;
            this.#polygonUnits = plan.polygonOffsetUnits;
            this.record();
        }

        if (capabilities.get(gl.SAMPLE_ALPHA_TO_COVERAGE) !== plan.alphaToCoverageEnabled) {
            if (plan.alphaToCoverageEnabled) gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
            else gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
            capabilities.set(gl.SAMPLE_ALPHA_TO_COVERAGE, plan.alphaToCoverageEnabled);
            this.record();
        }
    }

    reset(): void {
        this.#program = undefined;
        this.#vertexArray = undefined;
        this.#drawFramebuffer = undefined;
        this.#readFramebuffer = undefined;
        this.#renderbuffer = null;
        this.#activeTexture = -1;
        this.#buffers.clear();
        this.#textures.clear();
        this.#samplers.clear();
        this.#capabilities.clear();
        this.#uniformBuffers.fill(null);
        this.#uniformOffsets.fill(-1);
        this.#uniformSizes.fill(-1);
        this.#cullMode = -1;
        this.#frontFace = -1;
        this.#blendEquationColor = -1;
        this.#blendEquationAlpha = -1;
        this.#blendSourceColor = -1;
        this.#blendDestinationColor = -1;
        this.#blendSourceAlpha = -1;
        this.#blendDestinationAlpha = -1;
        this.#colorMask = -1;
        this.#depthFunction = -1;
        this.#depthWrite = null;
        this.#polygonFactor = Number.NaN;
        this.#polygonUnits = Number.NaN;
        this.#stencilWriteMask = -1;
        this.#stencilFrontCompare = -1;
        this.#stencilFrontReference = -1;
        this.#stencilFrontReadMask = -1;
        this.#stencilFrontFail = -1;
        this.#stencilFrontDepthFail = -1;
        this.#stencilFrontPass = -1;
        this.#stencilBackCompare = -1;
        this.#stencilBackReference = -1;
        this.#stencilBackReadMask = -1;
        this.#stencilBackFail = -1;
        this.#stencilBackDepthFail = -1;
        this.#stencilBackPass = -1;
        this.#viewportX = Number.NaN;
        this.#viewportY = Number.NaN;
        this.#viewportWidth = Number.NaN;
        this.#viewportHeight = Number.NaN;
        this.#scissorX = Number.NaN;
        this.#scissorY = Number.NaN;
        this.#scissorWidth = Number.NaN;
        this.#scissorHeight = Number.NaN;
        this.#blendRed = Number.NaN;
        this.#blendGreen = Number.NaN;
        this.#blendBlue = Number.NaN;
        this.#blendAlpha = Number.NaN;
        this.#depthRangeMinimum = Number.NaN;
        this.#depthRangeMaximum = Number.NaN;
        this.#pixelStore.clear();
    }

    useProgram(value: WebGLProgram | null): void {
        if (this.#program === value) return;
        this.gl.useProgram(value);
        this.#program = value;
        this.record();
    }

    bindVertexArray(value: WebGLVertexArrayObject | null): void {
        if (this.#vertexArray === value) return;
        this.gl.bindVertexArray(value);
        this.#vertexArray = value;
        // ELEMENT_ARRAY_BUFFER is VAO state, never a device-global binding.
        this.#buffers.delete(this.gl.ELEMENT_ARRAY_BUFFER);
        this.record();
    }

    bindBuffer(target: GLenum, value: WebGLBuffer | null): void {
        if (this.#buffers.get(target) === value) return;
        this.gl.bindBuffer(target, value);
        this.#buffers.set(target, value);
        this.record();
    }

    /** @internal Snapshot helpers used to restore state around synchronous external uploads. */
    get activeTextureUnit(): number {
        if (this.#activeTexture >= 0) return this.#activeTexture;
        const active = Number(this.gl.getParameter(this.gl.ACTIVE_TEXTURE)) - this.gl.TEXTURE0;
        this.#activeTexture = Number.isSafeInteger(active) && active >= 0 ? active : 0;
        this.record();
        return this.#activeTexture;
    }

    /** @internal */
    boundBuffer(target: GLenum): WebGLBuffer | null {
        if (this.#buffers.has(target)) return this.#buffers.get(target) ?? null;
        const binding =
            target === this.gl.PIXEL_UNPACK_BUFFER
                ? this.gl.PIXEL_UNPACK_BUFFER_BINDING
                : target === this.gl.PIXEL_PACK_BUFFER
                  ? this.gl.PIXEL_PACK_BUFFER_BINDING
                  : null;
        if (binding === null) return null;
        const value = this.gl.getParameter(binding) as WebGLBuffer | null;
        this.#buffers.set(target, value);
        this.record();
        return value;
    }

    /** @internal */
    boundTexture(unit: number, target: GLenum): WebGLTexture | null {
        const key = unit * 8 + this.textureTargetSlot(target);
        if (this.#textures.has(key)) return this.#textures.get(key) ?? null;
        const previousUnit = this.activeTextureUnit;
        this.activeTexture(unit);
        const binding =
            target === this.gl.TEXTURE_2D
                ? this.gl.TEXTURE_BINDING_2D
                : target === this.gl.TEXTURE_2D_ARRAY
                  ? this.gl.TEXTURE_BINDING_2D_ARRAY
                  : target === this.gl.TEXTURE_3D
                    ? this.gl.TEXTURE_BINDING_3D
                    : this.gl.TEXTURE_BINDING_CUBE_MAP;
        const value = this.gl.getParameter(binding) as WebGLTexture | null;
        this.#textures.set(key, value);
        this.record();
        this.activeTexture(previousUnit);
        return value;
    }

    bindFramebuffer(target: GLenum, value: WebGLFramebuffer | null): void {
        if (target === this.gl.FRAMEBUFFER) {
            if (this.#drawFramebuffer === value && this.#readFramebuffer === value) return;
            this.gl.bindFramebuffer(target, value);
            this.#drawFramebuffer = value;
            this.#readFramebuffer = value;
        } else if (target === this.gl.DRAW_FRAMEBUFFER) {
            if (this.#drawFramebuffer === value) return;
            this.gl.bindFramebuffer(target, value);
            this.#drawFramebuffer = value;
        } else {
            if (this.#readFramebuffer === value) return;
            this.gl.bindFramebuffer(target, value);
            this.#readFramebuffer = value;
        }
        this.record();
    }

    bindRenderbuffer(value: WebGLRenderbuffer | null): void {
        if (this.#renderbuffer === value) return;
        this.gl.bindRenderbuffer(this.gl.RENDERBUFFER, value);
        this.#renderbuffer = value;
        this.record();
    }

    activeTexture(unit: number): void {
        if (this.#activeTexture === unit) return;
        this.gl.activeTexture(this.gl.TEXTURE0 + unit);
        this.#activeTexture = unit;
        this.record();
    }

    bindTexture(unit: number, target: GLenum, value: WebGLTexture | null): boolean {
        const key = unit * 8 + this.textureTargetSlot(target);
        if (this.#textures.get(key) === value) return false;
        this.activeTexture(unit);
        this.gl.bindTexture(target, value);
        this.#textures.set(key, value);
        this.record();
        return true;
    }

    /** Bind a texture and leave its unit active for a following target-based native command. */
    activateTextureBinding(unit: number, target: GLenum, value: WebGLTexture | null): void {
        if (!this.bindTexture(unit, target, value)) this.activeTexture(unit);
    }

    bindSampler(unit: number, value: WebGLSampler | null): void {
        if (this.#samplers.get(unit) === value) return;
        this.gl.bindSampler(unit, value);
        this.#samplers.set(unit, value);
        this.record();
    }

    setTextureMipRange(target: GLenum, baseMipLevel: number, maximumMipLevel: number): void {
        this.gl.texParameteri(target, this.gl.TEXTURE_BASE_LEVEL, baseMipLevel);
        this.gl.texParameteri(target, this.gl.TEXTURE_MAX_LEVEL, maximumMipLevel);
        this.record();
        this.record();
    }

    setCapability(capability: GLenum, enabled: boolean): void {
        if (this.#capabilities.get(capability) === enabled) return;
        if (enabled) this.gl.enable(capability);
        else this.gl.disable(capability);
        this.#capabilities.set(capability, enabled);
        this.record();
    }

    setCull(mode: GLenum, frontFace: GLenum): void {
        const enabled = mode !== this.gl.NONE;
        this.setCapability(this.gl.CULL_FACE, enabled);
        if (enabled && this.#cullMode !== mode) {
            this.gl.cullFace(mode);
            this.#cullMode = mode;
            this.record();
        }
        if (this.#frontFace !== frontFace) {
            this.gl.frontFace(frontFace);
            this.#frontFace = frontFace;
            this.record();
        }
    }

    setBlend(
        enabled: boolean,
        equationColor: GLenum,
        equationAlpha: GLenum,
        sourceColor: GLenum,
        destinationColor: GLenum,
        sourceAlpha: GLenum,
        destinationAlpha: GLenum
    ): void {
        this.setCapability(this.gl.BLEND, enabled);
        if (!enabled) return;
        if (
            this.#blendEquationColor !== equationColor ||
            this.#blendEquationAlpha !== equationAlpha
        ) {
            this.gl.blendEquationSeparate(equationColor, equationAlpha);
            this.#blendEquationColor = equationColor;
            this.#blendEquationAlpha = equationAlpha;
            this.record();
        }
        if (
            this.#blendSourceColor !== sourceColor ||
            this.#blendDestinationColor !== destinationColor ||
            this.#blendSourceAlpha !== sourceAlpha ||
            this.#blendDestinationAlpha !== destinationAlpha
        ) {
            this.gl.blendFuncSeparate(sourceColor, destinationColor, sourceAlpha, destinationAlpha);
            this.#blendSourceColor = sourceColor;
            this.#blendDestinationColor = destinationColor;
            this.#blendSourceAlpha = sourceAlpha;
            this.#blendDestinationAlpha = destinationAlpha;
            this.record();
        }
    }

    setColorMask(mask: number): void {
        if (this.#colorMask === mask) return;
        this.gl.colorMask((mask & 1) !== 0, (mask & 2) !== 0, (mask & 4) !== 0, (mask & 8) !== 0);
        this.#colorMask = mask;
        this.record();
    }

    setDepth(enabled: boolean, compare: GLenum, write: boolean): void {
        this.setCapability(this.gl.DEPTH_TEST, enabled);
        if (enabled && this.#depthFunction !== compare) {
            this.gl.depthFunc(compare);
            this.#depthFunction = compare;
            this.record();
        }
        if (this.#depthWrite !== write) {
            this.gl.depthMask(write);
            this.#depthWrite = write;
            this.record();
        }
    }

    setStencilFace(
        face: GLenum,
        compare: GLenum,
        reference: number,
        readMask: number,
        fail: GLenum,
        depthFail: GLenum,
        pass: GLenum
    ): void {
        if (face === this.gl.FRONT) {
            if (
                this.#stencilFrontCompare !== compare ||
                this.#stencilFrontReference !== reference ||
                this.#stencilFrontReadMask !== readMask
            ) {
                this.gl.stencilFuncSeparate(face, compare, reference, readMask);
                this.#stencilFrontCompare = compare;
                this.#stencilFrontReference = reference;
                this.#stencilFrontReadMask = readMask;
                this.record();
            }
            if (
                this.#stencilFrontFail !== fail ||
                this.#stencilFrontDepthFail !== depthFail ||
                this.#stencilFrontPass !== pass
            ) {
                this.gl.stencilOpSeparate(face, fail, depthFail, pass);
                this.#stencilFrontFail = fail;
                this.#stencilFrontDepthFail = depthFail;
                this.#stencilFrontPass = pass;
                this.record();
            }
            return;
        }
        if (
            this.#stencilBackCompare !== compare ||
            this.#stencilBackReference !== reference ||
            this.#stencilBackReadMask !== readMask
        ) {
            this.gl.stencilFuncSeparate(face, compare, reference, readMask);
            this.#stencilBackCompare = compare;
            this.#stencilBackReference = reference;
            this.#stencilBackReadMask = readMask;
            this.record();
        }
        if (
            this.#stencilBackFail !== fail ||
            this.#stencilBackDepthFail !== depthFail ||
            this.#stencilBackPass !== pass
        ) {
            this.gl.stencilOpSeparate(face, fail, depthFail, pass);
            this.#stencilBackFail = fail;
            this.#stencilBackDepthFail = depthFail;
            this.#stencilBackPass = pass;
            this.record();
        }
    }

    setStencilWriteMask(mask: number): void {
        if (this.#stencilWriteMask === mask) return;
        this.gl.stencilMask(mask);
        this.#stencilWriteMask = mask;
        this.record();
    }

    setPolygonOffset(enabled: boolean, factor: number, units: number): void {
        this.setCapability(this.gl.POLYGON_OFFSET_FILL, enabled);
        if (enabled && (this.#polygonFactor !== factor || this.#polygonUnits !== units)) {
            this.gl.polygonOffset(factor, units);
            this.#polygonFactor = factor;
            this.#polygonUnits = units;
            this.record();
        }
    }

    setViewport(x: number, y: number, width: number, height: number): void {
        if (
            this.#viewportX === x &&
            this.#viewportY === y &&
            this.#viewportWidth === width &&
            this.#viewportHeight === height
        )
            return;
        this.gl.viewport(x, y, width, height);
        this.#viewportX = x;
        this.#viewportY = y;
        this.#viewportWidth = width;
        this.#viewportHeight = height;
        this.record();
    }

    setViewportRecord(viewport: Readonly<RHIViewport>): void {
        const x = viewport.x;
        const y = viewport.y;
        const width = viewport.width;
        const height = viewport.height;
        const minimum = viewport.minDepth;
        const maximum = viewport.maxDepth;
        if (
            this.#viewportX !== x ||
            this.#viewportY !== y ||
            this.#viewportWidth !== width ||
            this.#viewportHeight !== height
        ) {
            this.gl.viewport(x, y, width, height);
            this.#viewportX = x;
            this.#viewportY = y;
            this.#viewportWidth = width;
            this.#viewportHeight = height;
            this.record();
        }
        if (this.#depthRangeMinimum !== minimum || this.#depthRangeMaximum !== maximum) {
            this.gl.depthRange(minimum, maximum);
            this.#depthRangeMinimum = minimum;
            this.#depthRangeMaximum = maximum;
            this.record();
        }
    }

    setScissor(x: number, y: number, width: number, height: number): void {
        this.setCapability(this.gl.SCISSOR_TEST, true);
        if (
            this.#scissorX === x &&
            this.#scissorY === y &&
            this.#scissorWidth === width &&
            this.#scissorHeight === height
        )
            return;
        this.gl.scissor(x, y, width, height);
        this.#scissorX = x;
        this.#scissorY = y;
        this.#scissorWidth = width;
        this.#scissorHeight = height;
        this.record();
    }

    setScissorRectRecord(rect: Readonly<RHIRect>): void {
        this.setCapability(this.gl.SCISSOR_TEST, true);
        const x = rect.x;
        const y = rect.y;
        const width = rect.width;
        const height = rect.height;
        if (
            this.#scissorX === x &&
            this.#scissorY === y &&
            this.#scissorWidth === width &&
            this.#scissorHeight === height
        )
            return;
        this.gl.scissor(x, y, width, height);
        this.#scissorX = x;
        this.#scissorY = y;
        this.#scissorWidth = width;
        this.#scissorHeight = height;
        this.record();
    }

    setDepthRange(minimum: number, maximum: number): void {
        if (this.#depthRangeMinimum === minimum && this.#depthRangeMaximum === maximum) return;
        this.gl.depthRange(minimum, maximum);
        this.#depthRangeMinimum = minimum;
        this.#depthRangeMaximum = maximum;
        this.record();
    }

    setBlendColor(red: number, green: number, blue: number, alpha: number): void {
        if (
            this.#blendRed === red &&
            this.#blendGreen === green &&
            this.#blendBlue === blue &&
            this.#blendAlpha === alpha
        )
            return;
        this.gl.blendColor(red, green, blue, alpha);
        this.#blendRed = red;
        this.#blendGreen = green;
        this.#blendBlue = blue;
        this.#blendAlpha = alpha;
        this.record();
    }

    bindUniformBufferRange(point: number, buffer: WebGLBuffer, offset: number, size: number): void {
        if (
            this.#uniformBuffers[point] === buffer &&
            this.#uniformOffsets[point] === offset &&
            this.#uniformSizes[point] === size
        )
            return;
        this.gl.bindBufferRange(this.gl.UNIFORM_BUFFER, point, buffer, offset, size);
        // WebGL2 bindBufferRange also changes the generic UNIFORM_BUFFER binding. Keep that
        // cache coherent so a later upload cannot skip the bind and overwrite this draw buffer.
        this.#buffers.set(this.gl.UNIFORM_BUFFER, buffer);
        this.#uniformBuffers[point] = buffer;
        this.#uniformOffsets[point] = offset;
        this.#uniformSizes[point] = size;
        this.record();
    }

    setPixelStore(parameter: GLenum, value: number): void {
        if (this.#pixelStore.get(parameter) === value) return;
        this.gl.pixelStorei(parameter, value);
        this.#pixelStore.set(parameter, value);
        this.record();
    }

    /** @internal */
    pixelStore(parameter: GLenum, defaultValue: number): number {
        const known = this.#pixelStore.get(parameter);
        if (known !== undefined) return known;
        const native = this.gl.getParameter(parameter) as unknown;
        const value =
            typeof native === 'boolean'
                ? native
                    ? 1
                    : 0
                : typeof native === 'number' && Number.isFinite(native)
                  ? native
                  : defaultValue;
        this.#pixelStore.set(parameter, value);
        this.record();
        return value;
    }

    private textureTargetSlot(target: GLenum): number {
        if (target === this.gl.TEXTURE_2D) return 0;
        if (target === this.gl.TEXTURE_2D_ARRAY) return 1;
        if (target === this.gl.TEXTURE_3D) return 2;
        if (target === this.gl.TEXTURE_CUBE_MAP) return 3;
        return 4;
    }

    private record(): void {
        if (this.diagnostics) this.diagnostics.nativeStateCalls++;
    }
}
