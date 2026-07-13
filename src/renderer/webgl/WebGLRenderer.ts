import type Mesh from '../../core/Mesh';
import { EventDispatcher } from '../../core/EventDispatcher';
import semantic from '../../material/semantic';
import Color from '../../math/Color';
import Shader from '../../shader/Shader';
import Program from './Program';
import RenderInfo from '../common/RenderInfo';
import RenderList from '../common/RenderList';
import VertexArrayObject from './VertexArrayObject';
import Buffer from './Buffer';
import Framebuffer from './Framebuffer';
import { WebGLExtensions } from './extensions';
import { WebGLCapabilities } from './capabilities';
import glType from './glType';
import WebGLState, {
    bindWebGLSampler,
    destroyWebGLSamplers,
    destroyWebGLUniformBuffers,
    destroyWebGLTextures,
    getWebGLTexture,
    releaseWebGLUniformBuffer
} from './WebGLState';
import GraphicsResourceManager, { type ManagedResource } from '../common/GraphicsResourceManager';
import BuiltInUniformBlockManager from '../common/BuiltInUniformBlockManager';
import type UniformBuffer from '../common/UniformBuffer';
import { BUILTIN_UNIFORM_BLOCK_BINDING_COUNT } from '../common/ubo/UniformBlockBindings';
import { BUILT_IN_UNIFORM_BLOCK_LAYOUTS } from '../common/ubo/BuiltInUniformBlocks';
import LightManager, { setLightShadowBindingProvider } from '../../light/LightManager';
import Texture, { type TextureBinding } from '../../texture/Texture';
import GeometryData from '../../geometry/GeometryData';
import {
    BLEND,
    CULL_FACE,
    DEPTH_COMPONENT,
    DEPTH_STENCIL,
    DEPTH_TEST,
    DYNAMIC_DRAW,
    FRONT_AND_BACK,
    LINES,
    SAMPLE_ALPHA_TO_COVERAGE,
    STATIC_DRAW,
    STENCIL_TEST
} from '../../constants/webgl';
import {
    SAMPLER_2D_ARRAY_SHADOW,
    SAMPLER_2D_SHADOW,
    SAMPLER_CUBE_SHADOW
} from '../../constants/webgl2';
import { getWebGLTextureCompareFunction } from './WebGLSamplerManager';
import type Camera from '../../camera/Camera';
import type Fog from '../../core/Fog';
import type Geometry from '../../geometry/Geometry';
import type Material from '../../material/Material';
import type { ShaderPrecision } from '../common/types';
import type { GLContext } from './WebGLTypes';
import {
    createRendererFrame,
    invokeRendererFrameCallback,
    type RendererFrameCallback,
    type RendererScene,
    type RendererViewport,
    type TextureCompressionFormat
} from '../common/Renderer';
import { RenderFramePlanner } from '../common/RenderFramePlan';
import {
    renderTargetFormatHasStencil,
    type RenderTarget,
    type RenderTargetParameters,
    type RenderTargetSelectionOptions
} from '../common/RenderTarget';
import WebGLRenderTarget from './WebGLRenderTarget';
import {
    registerWebGLCanvasPresenter,
    releaseWebGLCanvasPresenter,
    unregisterWebGLCanvasPresenter
} from './WebGLCanvasPresenter';
import {
    getWebGLLightShadowBinding,
    releaseWebGLShadowMaps,
    renderWebGLShadowMaps
} from './WebGLShadowMapManager';

export interface WebGLRendererParameters {
    width?: number;
    height?: number;
    pixelRatio?: number;
    domElement?: HTMLCanvasElement | null;
    useInstanced?: boolean;
    alpha?: boolean;
    depth?: boolean;
    stencil?: boolean;
    antialias?: boolean;
    premultipliedAlpha?: boolean;
    preserveDrawingBuffer?: boolean;
    failIfMajorPerformanceCaveat?: boolean;
    powerPreference?: WebGLPowerPreference;
    useLogDepth?: boolean;
    vertexPrecision?: ShaderPrecision;
    fragmentPrecision?: ShaderPrecision;
    fog?: Fog | null;
    offsetX?: number;
    offsetY?: number;
    forceMaterial?: Material | null;
    clearColor?: Color;
}

export type WebGLRendererScene = RendererScene;

export interface MeshSetup {
    vao: VertexArrayObject;
    program: Program;
    geometry: Geometry;
}

function materialFor(mesh: Mesh, forceMaterial: Material | null): Material {
    const material = forceMaterial ?? mesh.material;
    if (!material) throw new Error(`Mesh ${mesh.id} cannot render without a material`);
    return material;
}

function geometryFor(mesh: Mesh): Geometry {
    if (!mesh.geometry) throw new Error(`Mesh ${mesh.id} cannot render without geometry`);
    return mesh.geometry;
}

function isNumericArrayLike(value: unknown): value is ArrayLike<number> {
    if (typeof value !== 'object' || value === null || !('length' in value)) return false;
    const length: unknown = value.length;
    if (typeof length !== 'number' || !Number.isInteger(length) || length < 0) return false;
    for (let index = 0; index < length; index++) {
        if (typeof Reflect.get(value, index) !== 'number') return false;
    }
    return true;
}

function isTextureBinding(value: unknown): value is TextureBinding {
    return value instanceof Texture;
}

/** WebGL renderer with explicit state, resource and event lifecycles. */
class WebGLRenderer extends EventDispatcher {
    readonly backend = 'webgl2' as const;
    readonly className = 'WebGLRenderer';
    readonly isWebGLRenderer = true;
    readonly renderInfo: RenderInfo;
    readonly renderList: RenderList;
    readonly lightManager: LightManager;
    readonly resourceManager: GraphicsResourceManager;
    private readonly framePlanner = new RenderFramePlanner();
    readonly extensions = new WebGLExtensions();
    readonly capabilities = new WebGLCapabilities(this.extensions);

    width = 0;
    height = 0;
    pixelRatio = 1;
    domElement: HTMLCanvasElement | null = null;
    private _useInstanced = false;
    alpha = false;
    depth = true;
    stencil = false;
    antialias = true;
    premultipliedAlpha = true;
    preserveDrawingBuffer = false;
    failIfMajorPerformanceCaveat = false;
    powerPreference: WebGLPowerPreference = 'default';
    useLogDepth = false;
    vertexPrecision: ShaderPrecision = 'highp';
    fragmentPrecision: ShaderPrecision = 'highp';
    fog: Fog | null = null;
    offsetX = 0;
    offsetY = 0;
    forceMaterial: Material | null = null;
    isInitFailed = false;
    clearColor: Color;
    renderTarget: WebGLRenderTarget | null = null;

    private _gl: GLContext | null = null;
    private _state: WebGLState | null = null;
    private _isInit = false;
    private _isContextLost = false;
    private _isDestroyed = false;
    private _initError: Error | null = null;
    private _lastMaterial: Material | null = null;
    private _lastProgram: Program | null = null;
    private readonly materialRevisions = new WeakMap<Material, number>();
    private readonly vaoGeometryRevisions = new WeakMap<VertexArrayObject, number>();
    private readonly uniformBlockManager: BuiltInUniformBlockManager;
    private readonly uniformResources = new WeakMap<UniformBuffer, ManagedResource>();
    private nextUniformResourceId = 1;
    private readonly renderTargets = new Set<WebGLRenderTarget>();
    private ownsRenderTarget = false;
    private autoPresentRenderTarget = false;
    private activeViewport: RendererViewport | null = null;
    private frameRecording = false;
    private readonly beginCameraPass = (
        camera: Camera,
        viewport: RendererViewport = this.getDefaultViewport()
    ): void => {
        this.activeViewport = viewport;
        semantic.setCamera(camera);
        semantic.setViewport(viewport);
        this.uniformBlockManager.beginPass(camera, viewport);
    };
    readonly ready: Promise<void>;
    private resolveReady: (() => void) | null = null;
    private rejectReady: ((reason: unknown) => void) | null = null;

    private readonly handleContextLost = (event: Event): void => {
        this.onContextLost(event);
    };

    private readonly handleContextRestored = (event: Event): void => {
        this.onContextRestored(event);
    };

    get gl(): GLContext {
        if (!this._gl) throw new Error('WebGLRenderer has not initialized a WebGL context');
        return this._gl;
    }

    get state(): WebGLState {
        if (!this._state) throw new Error('WebGLRenderer has not initialized WebGL state');
        return this._state;
    }

    get isInit(): boolean {
        return this._isInit && !this.isInitFailed && this._gl !== null && this._state !== null;
    }

    get isReady(): boolean {
        return !this._isDestroyed && !this._isContextLost && this.isInit;
    }

    get useInstanced(): boolean {
        return this._useInstanced;
    }

    set useInstanced(value: boolean) {
        this._useInstanced = value;
        this.renderList.useInstanced = value;
    }

    constructor(params: WebGLRendererParameters = {}) {
        super();
        this.clearColor = new Color(1, 1, 1);
        this.renderInfo = new RenderInfo();
        this.renderList = new RenderList();
        this.renderList.useInstanced = this._useInstanced;
        this.lightManager = new LightManager();
        setLightShadowBindingProvider(this.lightManager, light =>
            getWebGLLightShadowBinding(this.lightManager, light)
        );
        this.resourceManager = new GraphicsResourceManager();
        Object.assign(this, params);
        this.uniformBlockManager = new BuiltInUniformBlockManager(this);
        registerWebGLCanvasPresenter(this, () => {
            this.invalidateDrawState();
        });
        this.ready = new Promise<void>((resolve, reject) => {
            this.resolveReady = resolve;
            this.rejectReady = reject;
        });
        if (this.domElement) {
            queueMicrotask(() => {
                if (this._isInit || this._isDestroyed) return;
                try {
                    this.initContext();
                } catch {
                    // `initContext` publishes the same failure through `ready`.
                }
            });
        }
    }

    private invalidateDrawState(): void {
        this._lastMaterial = null;
        this._lastProgram = null;
    }

    private activeSurfaceHasStencil(): boolean {
        const format = this.renderTarget?.depthStencilFormat;
        return format === null || format === undefined
            ? this.renderTarget === null && this.stencil
            : renderTargetFormatHasStencil(format);
    }

    resize(width: number, height: number, force = false): void {
        if (!force && this.width === width && this.height === height) return;
        this.width = width;
        this.height = height;
        if (this.domElement) {
            this.domElement.width = width;
            this.domElement.height = height;
        }
        this.viewport();
    }

    private getDefaultViewport(): RendererViewport {
        const target = this.renderTarget;
        if (target) return [0, 0, target.width, target.height];
        const gl = this._gl;
        const canvas = this.domElement;
        return [
            this.offsetX,
            this.offsetY,
            gl?.drawingBufferWidth ??
                (this.width > 0 ? this.width : Math.max(1, canvas?.width ?? 0)),
            gl?.drawingBufferHeight ??
                (this.height > 0 ? this.height : Math.max(1, canvas?.height ?? 0))
        ];
    }

    /** Return the physical-pixel viewport used by the active render pass. */
    getViewport(): RendererViewport {
        return this.activeViewport ?? this.getDefaultViewport();
    }

    /** Create a render target owned by this renderer's WebGL2 context. */
    createRenderTarget(parameters: RenderTargetParameters): WebGLRenderTarget {
        this.initContext();
        const target = new WebGLRenderTarget(this, parameters, destroyedTarget => {
            this.resourceManager.releasePass(destroyedTarget).destroyUnusedResource();
            this.renderTargets.delete(destroyedTarget);
            if (this.renderTarget === destroyedTarget) {
                this.renderTarget = null;
                this.ownsRenderTarget = false;
                this.autoPresentRenderTarget = false;
                if (this._state) {
                    this._state.bindSystemFramebuffer();
                    this.viewport();
                }
            }
        });
        this.renderTargets.add(target);
        return target;
    }

    supportsTextureCompression(format: TextureCompressionFormat): boolean {
        this.initContext();
        switch (format) {
            case 'bc':
                return this.extensions.get('WEBGL_compressed_texture_s3tc') !== null;
            case 'etc1':
                return this.extensions.get('WEBGL_compressed_texture_etc1') !== null;
            case 'etc2':
                return this.extensions.get('WEBGL_compressed_texture_etc') !== null;
            case 'astc-4x4':
                return this.extensions.get('WEBGL_compressed_texture_astc') !== null;
            case 'pvrtc':
                return this.extensions.get('WEBGL_compressed_texture_pvrtc') !== null;
        }
    }

    /** Select a target for subsequent render calls; null restores canvas rendering. */
    setRenderTarget(target: RenderTarget | null, options: RenderTargetSelectionOptions = {}): this {
        let resolved: WebGLRenderTarget | null = null;
        if (target !== null) {
            if (!(target instanceof WebGLRenderTarget)) {
                throw new TypeError('WebGLRenderer requires a WebGL2 render target');
            }
            if (!this.renderTargets.has(target)) {
                throw new TypeError('WebGL render target belongs to a different renderer');
            }
            if (target.isDestroyed) throw new Error('Cannot select a destroyed render target');
            resolved = target;
        }
        const previous = this.renderTarget;
        const destroyPrevious = this.ownsRenderTarget && previous !== null && previous !== resolved;
        this.renderTarget = resolved;
        this.invalidateDrawState();
        this.activeViewport = null;
        this.ownsRenderTarget = resolved !== null && options.takeOwnership === true;
        this.autoPresentRenderTarget = resolved !== null && options.present === true;
        if (destroyPrevious) previous.destroy();
        if (resolved === null && this._state) {
            this._state.bindSystemFramebuffer();
            this.viewport();
        }
        return this;
    }

    /** Present the first color attachment of a renderer-owned target to the canvas. */
    present(target: RenderTarget = this.requireRenderTarget()): void {
        if (!(target instanceof WebGLRenderTarget)) {
            throw new TypeError('WebGLRenderer requires a WebGL2 render target');
        }
        if (!this.renderTargets.has(target)) {
            throw new TypeError('WebGL render target belongs to a different renderer');
        }
        if (target.isDestroyed) throw new Error('Cannot present a destroyed render target');
        target.presentToCanvas();
    }

    /** Render one scoped pass without changing the caller's persistent target selection. */
    renderToTarget(
        target: RenderTarget,
        stage: RendererScene,
        camera: Camera,
        fireEvent = false
    ): void {
        if (!(target instanceof WebGLRenderTarget)) {
            throw new TypeError('WebGLRenderer requires a WebGL2 render target');
        }
        if (!this.renderTargets.has(target)) {
            throw new TypeError('WebGL render target belongs to a different renderer');
        }
        if (target.isDestroyed) throw new Error('Cannot render to a destroyed render target');
        const previousTarget = this.renderTarget;
        const previousOwnership = this.ownsRenderTarget;
        const previousPresentation = this.autoPresentRenderTarget;
        this.renderTarget = target;
        this.invalidateDrawState();
        this.activeViewport = null;
        this.ownsRenderTarget = false;
        this.autoPresentRenderTarget = false;
        try {
            this.render(stage, camera, fireEvent);
        } finally {
            this.renderTarget = previousTarget?.isDestroyed === false ? previousTarget : null;
            this.invalidateDrawState();
            this.activeViewport = null;
            this.ownsRenderTarget = this.renderTarget !== null && previousOwnership;
            this.autoPresentRenderTarget = this.renderTarget !== null && previousPresentation;
            if (this._state) {
                this._state.bindSystemFramebuffer();
                this.viewport();
            }
        }
    }

    private requireRenderTarget(): WebGLRenderTarget {
        if (!this.renderTarget) throw new Error('No WebGL render target is selected');
        return this.renderTarget;
    }

    setOffset(x: number, y: number): void {
        if (this.offsetX === x && this.offsetY === y) return;
        this.offsetX = x;
        this.offsetY = y;
        this.viewport();
    }

    viewport(x?: number, y?: number, width?: number, height?: number): void {
        const state = this._state;
        const gl = this._gl;
        if (!state || !gl) return;
        const viewportX = x ?? this.offsetX;
        const viewportY = y ?? this.offsetY;
        const viewportWidth = width ?? gl.drawingBufferWidth;
        const viewportHeight = height ?? gl.drawingBufferHeight;
        if (x !== undefined) this.offsetX = x;
        if (y !== undefined) this.offsetY = y;
        state.viewport(viewportX, viewportY, viewportWidth, viewportHeight);
        const viewport: RendererViewport = [viewportX, viewportY, viewportWidth, viewportHeight];
        this.activeViewport = viewport;
        this.uniformBlockManager.setViewport(viewport);
        if (semantic.renderer === this) semantic.setViewport(viewport);
    }

    onInit(callback: (renderer: WebGLRenderer) => void): void {
        if (this.isInit) {
            callback(this);
            return;
        }
        this.on(
            'init',
            () => {
                callback(this);
            },
            true
        );
    }

    initContext(): void {
        if (this._isDestroyed) throw new Error('Cannot initialize a destroyed WebGLRenderer');
        if (this._isInit) {
            if (this._initError) throw this._initError;
            return;
        }
        this._isInit = true;
        try {
            this.createContext();
            this.fire('init');
            this.resolveReady?.();
            this.resolveReady = null;
            this.rejectReady = null;
        } catch (error: unknown) {
            const failure = error instanceof Error ? error : new Error(String(error));
            this.isInitFailed = true;
            this._initError = failure;
            this.rejectReady?.(failure);
            this.resolveReady = null;
            this.rejectReady = null;
            this.fire('initFailed', failure);
            throw failure;
        }
    }

    private createContext(): void {
        const canvas = this.domElement;
        if (!canvas) throw new Error('WebGLRenderer requires a canvas before initialization');
        const contextAttributes: WebGLContextAttributes = {
            alpha: this.alpha,
            depth: this.depth,
            stencil: this.stencil,
            antialias: this.antialias,
            premultipliedAlpha: this.premultipliedAlpha,
            preserveDrawingBuffer: this.preserveDrawingBuffer,
            failIfMajorPerformanceCaveat: this.failIfMajorPerformanceCaveat,
            powerPreference: this.powerPreference
        };

        const gl = canvas.getContext('webgl2', contextAttributes);
        if (!gl) throw new Error('This browser or device could not create a WebGL 2 context');

        this._gl = gl;
        gl.viewport(0, 0, this.width, this.height);
        glType.init(gl);
        this.extensions.init(gl);
        this.capabilities.init(gl);
        const largestBuiltInBlock = Math.max(
            ...Object.values(BUILT_IN_UNIFORM_BLOCK_LAYOUTS).map(layout => layout.byteLength)
        );
        if (this.capabilities.MAX_UNIFORM_BUFFER_BINDINGS < BUILTIN_UNIFORM_BLOCK_BINDING_COUNT) {
            throw new Error(
                `WebGL2 exposes ${String(this.capabilities.MAX_UNIFORM_BUFFER_BINDINGS)} UBO bindings; Hilo3d requires ${String(BUILTIN_UNIFORM_BLOCK_BINDING_COUNT)}`
            );
        }
        if (this.capabilities.MAX_UNIFORM_BLOCK_SIZE < largestBuiltInBlock) {
            throw new Error(
                `WebGL2 exposes ${String(this.capabilities.MAX_UNIFORM_BLOCK_SIZE)} bytes per UBO; Hilo3d requires ${String(largestBuiltInBlock)}`
            );
        }
        Shader.init(this);
        this._state = new WebGLState(gl, this.capabilities, this.extensions);
        this.renderList.useInstanced = this.useInstanced;

        canvas.addEventListener('webglcontextlost', this.handleContextLost, false);
        canvas.addEventListener('webglcontextrestored', this.handleContextRestored, false);
    }

    private onContextLost(event: Event): void {
        event.preventDefault();
        const gl = this._gl;
        const state = this._state;
        if (!gl || !state) return;
        this._isContextLost = true;
        releaseWebGLCanvasPresenter(this, true);
        Program.reset(gl);
        destroyWebGLTextures(state);
        destroyWebGLSamplers(state);
        Buffer.reset(gl);
        VertexArrayObject.reset(gl);
        destroyWebGLUniformBuffers(state);
        this.resourceManager.clear();
        state.reset();
        this._lastMaterial = null;
        this._lastProgram = null;
        this.fire('webglContextLost');
    }

    private onContextRestored(_event: Event): void {
        const gl = this._gl;
        const state = this._state;
        if (!gl || !state) throw new Error('WebGL context restored before renderer initialization');
        try {
            this.extensions.reset(gl);
            this.capabilities.init(gl);
            glType.init(gl);
            Shader.init(this);
            state.reset();
            Framebuffer.reset(gl);
            this.renderTargets.forEach(target => {
                target.handleContextRestored();
            });
        } catch (error) {
            this._isContextLost = true;
            this._lastMaterial = null;
            this._lastProgram = null;
            throw error;
        }
        this._isContextLost = false;
        this.fire('webglContextRestored');
    }

    setupDepthTest(material: Material): void {
        const state = this.state;
        if (material.depthTest) {
            state.enable(DEPTH_TEST);
            state.depthFunc(material.depthFunc);
            state.depthMask(material.depthMask);
            state.depthRange(material.depthRange[0], material.depthRange[1]);
        } else {
            state.disable(DEPTH_TEST);
        }
    }

    setupSampleAlphaToCoverage(material: Material): void {
        if (material.sampleAlphaToCoverage) this.state.enable(SAMPLE_ALPHA_TO_COVERAGE);
        else this.state.disable(SAMPLE_ALPHA_TO_COVERAGE);
    }

    setupCullFace(material: Material): void {
        const state = this.state;
        state.frontFace(material.frontFace);
        if (material.cullFace && material.cullFaceType !== FRONT_AND_BACK) {
            state.enable(CULL_FACE);
            state.cullFace(material.cullFaceType);
        } else {
            state.disable(CULL_FACE);
        }
    }

    setupBlend(material: Material): void {
        const state = this.state;
        if (material.blend) {
            state.enable(BLEND);
            state.blendFuncSeparate(
                material.blendSrc,
                material.blendDst,
                material.blendSrcAlpha,
                material.blendDstAlpha
            );
            state.blendEquationSeparate(material.blendEquation, material.blendEquationAlpha);
        } else {
            state.disable(BLEND);
        }
    }

    setupStencil(material: Material): void {
        const state = this.state;
        if (!this.activeSurfaceHasStencil()) {
            state.disable(STENCIL_TEST);
            return;
        }
        if (material.stencilTest) {
            state.enable(STENCIL_TEST);
            state.stencilMask(material.stencilMask);
            state.stencilFunc(
                material.stencilFunc,
                material.stencilFuncRef,
                material.stencilFuncMask
            );
            state.stencilOp(
                material.stencilOpFail,
                material.stencilOpZFail,
                material.stencilOpZPass
            );
        } else {
            state.disable(STENCIL_TEST);
        }
    }

    setupShaderBindings(
        program: Program,
        mesh: Mesh,
        useInstanced: boolean,
        force = false
    ): readonly UniformBuffer[] {
        const material = materialFor(mesh, this.forceMaterial);
        const uniformBlocks = this.uniformBlockManager.bind(
            program,
            mesh,
            material,
            force,
            semantic.camera
        );
        for (const [name, programUniform] of Object.entries(program.uniforms)) {
            const uniformInfo = material.getUniformInfo(name);
            if (uniformInfo.isBlankInfo) continue;
            if (!force && (!uniformInfo.isDependMesh || useInstanced)) continue;
            const uniformData = uniformInfo.get(mesh, material, programUniform);
            if (uniformData !== undefined && uniformData !== null) {
                const firstTextureIndex = programUniform.textureIndex ?? 0;
                if (isTextureBinding(uniformData)) {
                    this.bindTexture(uniformData, firstTextureIndex, programUniform.type);
                    program.setUniform(name, firstTextureIndex);
                } else if (Array.isArray(uniformData) && uniformData.every(isTextureBinding)) {
                    const textureIndices = uniformData.map((texture, index) => {
                        const textureIndex = firstTextureIndex + index;
                        this.bindTexture(texture, textureIndex, programUniform.type);
                        return textureIndex;
                    });
                    program.setUniform(name, textureIndices);
                } else {
                    throw new TypeError(
                        `Sampler ${name} must resolve to a Texture or Texture array`
                    );
                }
            }
        }
        return Object.values(uniformBlocks);
    }

    private bindTexture(texture: TextureBinding, textureIndex: number, samplerType: GLenum): void {
        const { gl, state } = this;
        // Texture creation and incremental uploads use the renderer's reserved upload unit.
        // Resolve them first, then select the sampler unit so the final native binding cannot
        // accidentally remain on the upload unit.
        const glTexture = getWebGLTexture(state, texture);
        state.activeTexture(gl.TEXTURE0 + textureIndex);
        state.bindTexture(texture.target, glTexture);
        const comparison =
            texture instanceof Texture &&
            (texture.format === DEPTH_COMPONENT || texture.format === DEPTH_STENCIL) &&
            (samplerType === SAMPLER_2D_SHADOW ||
                samplerType === SAMPLER_2D_ARRAY_SHADOW ||
                samplerType === SAMPLER_CUBE_SHADOW);
        bindWebGLSampler(
            state,
            texture,
            textureIndex,
            comparison,
            getWebGLTextureCompareFunction(texture)
        );
    }

    setupVao(vao: VertexArrayObject, program: Program, mesh: Mesh): void {
        const geometry = geometryFor(mesh);
        const isStatic = geometry.isStatic;
        if (
            vao.isDirty ||
            !isStatic ||
            geometry.isDirty ||
            this.vaoGeometryRevisions.get(vao) !== geometry.revision ||
            vao.hasPendingGeometryDataUpdates()
        ) {
            vao.isDirty = false;
            const material = materialFor(mesh, this.forceMaterial);
            const usage = isStatic ? STATIC_DRAW : DYNAMIC_DRAW;
            for (const name of Object.keys(material.attributes)) {
                const programAttribute = program.attributes[name];
                if (!programAttribute) continue;
                const data = material.getAttributeData(name, mesh, programAttribute);
                if (data === undefined || data === null) continue;
                if (!(data instanceof GeometryData)) {
                    throw new TypeError(`Material attribute ${name} must resolve to GeometryData`);
                }
                vao.addAttribute(data, programAttribute, usage);
            }
            if (geometry.indices) vao.addIndexBuffer(geometry.indices, usage);
            else vao.removeIndexBuffer();
            this.vaoGeometryRevisions.set(vao, geometry.revision);
            geometry.isDirty = false;
        }
    }

    setupMaterial(
        program: Program,
        mesh: Mesh,
        useInstanced: boolean,
        needForceUpdateUniforms = false
    ): readonly UniformBuffer[] {
        const material = materialFor(mesh, this.forceMaterial);
        const materialRevision = material.revision;
        if (
            this.materialRevisions.get(material) !== materialRevision ||
            this._lastMaterial !== material
        ) {
            this.setupDepthTest(material);
            this.setupSampleAlphaToCoverage(material);
            this.setupCullFace(material);
            this.setupBlend(material);
            this.setupStencil(material);
            needForceUpdateUniforms = true;
        }
        const uniformBuffers = this.setupShaderBindings(
            program,
            mesh,
            useInstanced,
            needForceUpdateUniforms
        );
        this.materialRevisions.set(material, materialRevision);
        material.isDirty = false;
        this._lastMaterial = material;
        return uniformBuffers;
    }

    setupMesh(mesh: Mesh, useInstanced: boolean): MeshSetup {
        const geometry = geometryFor(mesh);
        geometry.normalizePrimitiveTopology();
        const material = materialFor(mesh, this.forceMaterial);
        const shader = Shader.getShader(
            mesh,
            material,
            useInstanced,
            this.lightManager,
            this.fog,
            this.useLogDepth,
            this
        );
        if (!shader)
            throw new Error(`Material ${material.className} does not provide a renderable shader`);
        const program = Program.getProgram(shader, this.state);
        program.useProgram();
        const uniformBuffers = this.setupMaterial(
            program,
            mesh,
            useInstanced,
            this._lastProgram !== program
        );
        this._lastProgram = program;
        if (material.wireframe && geometry.mode !== LINES) geometry.convertToLinesMode();

        const vao = VertexArrayObject.getVao(this.gl, geometry.id + program.id, {
            useInstanced,
            mode: geometry.mode
        });
        this.setupVao(vao, program, mesh);
        this.resourceManager.addMeshResources(
            mesh,
            [vao, program, ...uniformBuffers.map(buffer => this.getUniformResource(buffer))],
            {
                key: `${material.id}:${shader.id}:${useInstanced ? 'instanced' : 'direct'}`,
                pass: this.renderTarget ?? this
            }
        );
        return { vao, program, geometry };
    }

    private getUniformResource(buffer: UniformBuffer): ManagedResource {
        const cached = this.uniformResources.get(buffer);
        if (cached) return cached;
        const resource: ManagedResource = {
            id: `WebGLUniform:${String(this.nextUniformResourceId++)}`,
            destroy: () => {
                if (this._state) releaseWebGLUniformBuffer(this._state, buffer);
                this.uniformBlockManager.releaseBuffer(buffer);
                this.uniformResources.delete(buffer);
            }
        };
        this.uniformResources.set(buffer, resource);
        return resource;
    }

    addRenderInfo(faceCount: number, drawCount: number): void {
        this.renderInfo.addFaceCount(faceCount);
        this.renderInfo.addDrawCount(drawCount);
    }

    render(stage: WebGLRendererScene, camera: Camera, fireEvent = false): void {
        this.initContext();
        if (this._isContextLost) throw new Error('Cannot render while the WebGL context is lost');
        this.resourceManager.beginFrame();
        try {
            this.fog = stage.fog ?? null;
            this.renderInfo.reset();
            semantic.init(this, camera, this.lightManager, this.fog);
            stage.updateMatrixWorld();
            camera.updateViewProjectionMatrix();
            const viewport = this.getDefaultViewport();
            this.activeViewport = viewport;
            semantic.setViewport(viewport);
            if (this.frameRecording) this.uniformBlockManager.beginPass(camera, viewport);
            else this.uniformBlockManager.beginFrame(camera, viewport);

            this.framePlanner.build(stage, camera, this.renderList, this.lightManager);
            renderWebGLShadowMaps(this.lightManager, this, camera, this.beginCameraPass);
            this.lightManager.updateInfo(camera);
            this.beginCameraPass(camera);
            if (fireEvent) this.fire('beforeRender');
            const target = this.renderTarget;
            if (target) {
                let completed = false;
                this.invalidateDrawState();
                try {
                    target.beginRenderPass();
                    if (fireEvent) this.fire('beforeRenderScene');
                    this.renderScene();
                    completed = true;
                } finally {
                    try {
                        target.endRenderPass(completed);
                    } finally {
                        this.invalidateDrawState();
                    }
                }
                if (this.autoPresentRenderTarget) target.presentToCanvas();
            } else {
                this.clear();
                if (fireEvent) this.fire('beforeRenderScene');
                this.renderScene();
            }
            this.resourceManager.endFrame();
        } catch (error: unknown) {
            this.resourceManager.abortFrame();
            this.resourceManager.destroyUnusedResource(stage);
            throw error;
        }
        if (fireEvent) this.fire('afterRender');
        this.resourceManager.destroyUnusedResource(stage);
    }

    /** Execute the shared frame API immediately while preserving one logical frame boundary. */
    renderFrame(callback: RendererFrameCallback): void {
        if (this.frameRecording) throw new Error('Nested renderer frames are not supported');
        this.frameRecording = true;
        let facadeActive = true;
        try {
            this.uniformBlockManager.beginApplicationFrame();
            invokeRendererFrameCallback(
                callback,
                createRendererFrame(this, () => facadeActive && this.frameRecording)
            );
        } finally {
            facadeActive = false;
            this.frameRecording = false;
        }
    }

    renderScene(): void {
        this.renderList.traverse(
            mesh => {
                this.renderMesh(mesh);
            },
            meshes => {
                this.renderInstancedMeshes(meshes);
            }
        );
    }

    clear(clearColor: Color = this.clearColor): void {
        const { gl, state } = this;
        this.invalidateDrawState();
        gl.clearColor(clearColor.r, clearColor.g, clearColor.b, clearColor.a);
        state.depthMask(true);
        let clearMask = gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT;
        if (this.stencil) {
            state.stencilMask(0xff);
            clearMask |= gl.STENCIL_BUFFER_BIT;
        }
        state.clear(clearMask);
    }

    clearDepth(): void {
        this.state.depthMask(true);
        this.state.clear(this.gl.DEPTH_BUFFER_BIT);
    }

    clearStencil(): void {
        this.state.stencilMask(0xff);
        this.state.clear(this.gl.STENCIL_BUFFER_BIT);
    }

    renderMesh(mesh: Mesh, silent = false): void {
        if (!silent) mesh.fire('beforeRender', mesh);
        const vao = this.setupMesh(mesh, false).vao;
        vao.draw();
        this.addRenderInfo(vao.getVertexCount() / 3, 1);
        if (!silent) mesh.fire('afterRender', mesh);
    }

    renderInstancedMeshes(meshes: readonly Mesh[], silent = false): void {
        const mesh = meshes[0];
        if (!mesh) return;
        if (!silent) meshes.forEach(item => item.fire('beforeRender', mesh));
        const material = materialFor(mesh, this.forceMaterial);
        const { vao, program } = this.setupMesh(mesh, true);
        for (const uniform of material.getInstancedUniforms()) {
            const attribute = program.attributes[uniform.name];
            if (!attribute) continue;
            vao.addInstancedAttribute(attribute, meshes, instance => {
                const value = uniform.info.get(instance, material, attribute);
                if (value === undefined) return undefined;
                if (!isNumericArrayLike(value)) {
                    throw new TypeError(
                        `Instanced attribute ${uniform.name} must resolve to numeric array data`
                    );
                }
                return value;
            });
        }
        vao.drawInstance(meshes.length);
        this.addRenderInfo((vao.getVertexCount() / 3) * meshes.length, 1);
        if (!silent) meshes.forEach(item => item.fire('afterRender', mesh));
    }

    renderMultipleMeshes(meshes: readonly Mesh[]): void {
        meshes.forEach(mesh => {
            this.renderMesh(mesh);
        });
    }

    releaseGPUResources(): void {
        const gl = this._gl;
        if (!gl) return;
        releaseWebGLShadowMaps(this.lightManager);
        this.renderTargets.forEach(target => {
            target.destroy();
        });
        this.renderTargets.clear();
        this.renderTarget = null;
        this.ownsRenderTarget = false;
        this.autoPresentRenderTarget = false;
        releaseWebGLCanvasPresenter(this);
        Program.reset(gl);
        Buffer.reset(gl);
        VertexArrayObject.reset(gl);
        this._state?.reset();
        if (this._state) destroyWebGLTextures(this._state);
        if (this._state) destroyWebGLSamplers(this._state);
        Framebuffer.destroy(gl);
        if (this._state) destroyWebGLUniformBuffers(this._state);
        this.resourceManager.clear();
    }

    destroy(): void {
        if (this._isDestroyed) return;
        this.releaseGPUResources();
        unregisterWebGLCanvasPresenter(this);
        this.domElement?.removeEventListener('webglcontextlost', this.handleContextLost, false);
        this.domElement?.removeEventListener(
            'webglcontextrestored',
            this.handleContextRestored,
            false
        );
        this.off();
        this._state = null;
        this._gl = null;
        this._isDestroyed = true;
    }
}

export default WebGLRenderer;
