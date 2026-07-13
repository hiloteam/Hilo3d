import Node from '../core/Node';
import Mesh from '../core/Mesh';
import { EventDispatcher } from '../core/EventDispatcher';
import semantic from '../material/semantic';
import Color from '../math/Color';
import Shader from '../shader/Shader';
import Program from './Program';
import RenderInfo from './RenderInfo';
import RenderList from './RenderList';
import VertexArrayObject from './VertexArrayObject';
import Buffer from './Buffer';
import Framebuffer, { type FramebufferParameters } from './Framebuffer';
import extensions from './extensions';
import capabilities from './capabilities';
import glType from './glType';
import WebGLState from './WebGLState';
import GraphicsResourceManager, { type ManagedResource } from './GraphicsResourceManager';
import BuiltInUniformBlockManager from './BuiltInUniformBlockManager';
import type UniformBuffer from './UniformBuffer';
import { BUILTIN_UNIFORM_BLOCK_BINDING_COUNT } from './ubo/UniformBlockBindings';
import { BUILT_IN_UNIFORM_BLOCK_LAYOUTS } from './ubo/BuiltInUniformBlocks';
import LightManager from '../light/LightManager';
import Light from '../light/Light';
import Texture, { type TextureBinding } from '../texture/Texture';
import GeometryData from '../geometry/GeometryData';
import {
    BLEND,
    CULL_FACE,
    DEPTH_TEST,
    DYNAMIC_DRAW,
    FRONT_AND_BACK,
    LINES,
    SAMPLE_ALPHA_TO_COVERAGE,
    STATIC_DRAW,
    STENCIL_TEST
} from '../constants/webgl';
import type Camera from '../camera/Camera';
import type Fog from '../core/Fog';
import type Geometry from '../geometry/Geometry';
import type Material from '../material/Material';
import type { GLContext, ShaderPrecision } from './types';
import type { RendererScene } from './Renderer';

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
    useFramebuffer?: boolean;
    framebufferOption?: FramebufferParameters;
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
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof Reflect.get(value, 'target') === 'number' &&
        typeof Reflect.get(value, 'getGLTexture') === 'function'
    );
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

    width = 0;
    height = 0;
    pixelRatio = 1;
    domElement: HTMLCanvasElement | null = null;
    useInstanced = false;
    alpha = false;
    depth = true;
    stencil = false;
    antialias = true;
    premultipliedAlpha = true;
    preserveDrawingBuffer = false;
    failIfMajorPerformanceCaveat = false;
    powerPreference: WebGLPowerPreference = 'default';
    useFramebuffer = false;
    framebufferOption: FramebufferParameters = {};
    useLogDepth = false;
    vertexPrecision: ShaderPrecision = 'highp';
    fragmentPrecision: ShaderPrecision = 'highp';
    fog: Fog | null = null;
    offsetX = 0;
    offsetY = 0;
    forceMaterial: Material | null = null;
    isInitFailed = false;
    clearColor: Color;
    framebuffer: Framebuffer | null = null;

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
    readonly ready: Promise<void>;

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
        return !this._isDestroyed && !this.isInitFailed;
    }

    constructor(params: WebGLRendererParameters = {}) {
        super();
        this.clearColor = new Color(1, 1, 1);
        Object.assign(this, params);
        this.framebufferOption = { ...(params.framebufferOption ?? {}) };
        this.renderInfo = new RenderInfo();
        this.renderList = new RenderList();
        this.lightManager = new LightManager();
        this.resourceManager = new GraphicsResourceManager();
        this.uniformBlockManager = new BuiltInUniformBlockManager(this);
        this.ready = Promise.resolve();
    }

    resize(width: number, height: number, force = false): void {
        if (!force && this.width === width && this.height === height) return;
        this.width = width;
        this.height = height;
        if (this.domElement) {
            this.domElement.width = width;
            this.domElement.height = height;
        }
        this.framebuffer?.resize(width, height, force);
        this.viewport();
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
        if (x !== undefined) this.offsetX = x;
        if (y !== undefined) this.offsetY = y;
        state.viewport(
            viewportX,
            viewportY,
            width ?? gl.drawingBufferWidth,
            height ?? gl.drawingBufferHeight
        );
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
        } catch (error: unknown) {
            const failure = error instanceof Error ? error : new Error(String(error));
            this.isInitFailed = true;
            this._initError = failure;
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
        extensions.init(gl);
        capabilities.init(gl);
        const largestBuiltInBlock = Math.max(
            ...Object.values(BUILT_IN_UNIFORM_BLOCK_LAYOUTS).map(layout => layout.byteLength)
        );
        if (capabilities.MAX_UNIFORM_BUFFER_BINDINGS < BUILTIN_UNIFORM_BLOCK_BINDING_COUNT) {
            throw new Error(
                `WebGL2 exposes ${String(capabilities.MAX_UNIFORM_BUFFER_BINDINGS)} UBO bindings; Hilo3d requires ${String(BUILTIN_UNIFORM_BLOCK_BINDING_COUNT)}`
            );
        }
        if (capabilities.MAX_UNIFORM_BLOCK_SIZE < largestBuiltInBlock) {
            throw new Error(
                `WebGL2 exposes ${String(capabilities.MAX_UNIFORM_BLOCK_SIZE)} bytes per UBO; Hilo3d requires ${String(largestBuiltInBlock)}`
            );
        }
        Shader.init(this);
        this._state = new WebGLState(gl);
        this.renderList.useInstanced = this.useInstanced;

        if (this.useFramebuffer) {
            this.framebuffer = new Framebuffer(this, {
                ...this.framebufferOption,
                width: this.framebufferOption.width ?? this.width,
                height: this.framebufferOption.height ?? this.height
            });
        }
        canvas.addEventListener('webglcontextlost', this.handleContextLost, false);
        canvas.addEventListener('webglcontextrestored', this.handleContextRestored, false);
    }

    private onContextLost(event: Event): void {
        event.preventDefault();
        const gl = this._gl;
        const state = this._state;
        if (!gl || !state) return;
        this._isContextLost = true;
        Program.reset(gl);
        Shader.reset(gl);
        Texture.reset(gl);
        Buffer.reset(gl);
        VertexArrayObject.reset(gl);
        this.uniformBlockManager.destroy(gl);
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
        this._isContextLost = false;
        extensions.reset(gl);
        capabilities.init(gl);
        glType.init(gl);
        Shader.init(this);
        state.reset();
        Framebuffer.reset(gl);
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
        if (!this.stencil) return;
        const state = this.state;
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
                    this.bindTexture(uniformData, firstTextureIndex);
                    program.setUniform(name, firstTextureIndex);
                } else if (Array.isArray(uniformData) && uniformData.every(isTextureBinding)) {
                    const textureIndices = uniformData.map((texture, index) => {
                        const textureIndex = firstTextureIndex + index;
                        this.bindTexture(texture, textureIndex);
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

    private bindTexture(texture: TextureBinding, textureIndex: number): void {
        const { gl, state } = this;
        state.activeTexture(gl.TEXTURE0 + textureIndex);
        state.bindTexture(texture.target, texture.getGLTexture(state));
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
        this.resourceManager.addMeshResources(mesh, [
            vao,
            shader,
            program,
            ...uniformBuffers.map(buffer => this.getUniformResource(buffer))
        ]);
        return { vao, program, geometry };
    }

    private getUniformResource(buffer: UniformBuffer): ManagedResource {
        const cached = this.uniformResources.get(buffer);
        if (cached) return cached;
        const resource: ManagedResource = {
            id: `WebGLUniform:${String(this.nextUniformResourceId++)}`,
            destroy: () => {
                const gl = this._gl;
                if (gl) {
                    if (!this.uniformBlockManager.releaseBuffer(buffer, gl)) buffer.destroy(gl);
                } else {
                    this.uniformBlockManager.releaseBuffer(buffer);
                }
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
            this.lightManager.reset();
            this.renderInfo.reset();
            this.renderList.reset();
            semantic.init(this, camera, this.lightManager, this.fog);
            stage.updateMatrixWorld();
            camera.updateViewProjectionMatrix();
            this.uniformBlockManager.beginFrame(camera);

            const lights: Light[] = [];
            stage.traverse(node => {
                if (!node.visible) return Node.TRAVERSE_STOP_CHILDREN;
                if (node instanceof Mesh) this.renderList.addMesh(node, camera);
                else if (node instanceof Light) lights.push(node);
                return Node.TRAVERSE_STOP_NONE;
            });
            this.renderList.sort();
            this.lightManager.update(this, camera, lights);
            this.uniformBlockManager.beginPass(camera);
            if (fireEvent) this.fire('beforeRender');
            if (this.useFramebuffer) this.framebuffer?.bind();
            this.clear();
            if (fireEvent) this.fire('beforeRenderScene');
            this.renderScene();
            if (this.useFramebuffer && this.framebuffer) this.renderToScreen(this.framebuffer);
            this.resourceManager.endFrame();
        } catch (error: unknown) {
            this.resourceManager.abortFrame();
            this.resourceManager.destroyUnusedResource(stage);
            throw error;
        }
        if (fireEvent) this.fire('afterRender');
        this.resourceManager.destroyUnusedResource(stage);
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
        this._lastMaterial = null;
        this._lastProgram = null;
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

    renderToScreen(framebuffer: Framebuffer): void {
        this.state.bindSystemFramebuffer();
        framebuffer.render(0, 0, 1, 1, this.clearColor);
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
        Program.reset(gl);
        Shader.reset(gl);
        Buffer.reset(gl);
        VertexArrayObject.reset(gl);
        this._state?.reset();
        Texture.reset(gl);
        Framebuffer.destroy(gl);
        this.uniformBlockManager.destroy(gl);
        this.resourceManager.clear();
        this.framebuffer = null;
    }

    destroy(): void {
        if (this._isDestroyed) return;
        this.releaseGPUResources();
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
