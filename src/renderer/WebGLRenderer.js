// HILO_DEBUG_START
import WebGLDebugUtils from 'webgl-debug';
// HILO_DEBUG_END

import Class from '../core/Class';
import Node from '../core/Node';
import semantic from '../material/semantic';
import Color from '../math/Color';
import Shader from '../shader/Shader';
import Program from './Program';
import RenderInfo from './RenderInfo';
import RenderList from './RenderList';
import VertexArrayObject from './VertexArrayObject';
import Buffer from './Buffer';
import Framebuffer from './Framebuffer';
import extensions from './extensions';
import capabilities from './capabilities';
import glType from './glType';
import WebGLState from './WebGLState';
import WebGLResourceManager from './WebGLResourceManager';
import LightManager from '../light/LightManager';
import EventMixin from '../core/EventMixin';
import Texture from '../texture/Texture';

import constants from '../constants';

const {
    DEPTH_TEST,
    STENCIL_TEST,
    SAMPLE_ALPHA_TO_COVERAGE,
    CULL_FACE,
    FRONT_AND_BACK,
    BLEND,
    LINES,
    STATIC_DRAW,
    DYNAMIC_DRAW
} = constants;


/**
 * WebGL渲染器
 * @class
 * @fires init 初始化事件
 * @fires beforeRender 渲染前事件
 * @fires beforeRenderScene 渲染场景前事件
 * @fires afterRender 渲染后事件
 * @fires initFailed 初始化失败事件
 * @fires webglContextLost webglContextLost 事件
 * @fires webglContextRestored webglContextRestored 事件
 * @mixes EventMixin
 */
const WebGLRenderer = Class.create(/** @lends WebGLRenderer.prototype */ {
    Mixes: EventMixin,

    /**
     * @default WebGLRenderer
     * @type {String}
     */
    className: 'WebGLRenderer',

    /**
     * @default true
     * @type {Boolean}
     */
    isWebGLRenderer: true,

    /**
     * gl
     * @default null
     * @type {WebGLRenderingContext}
     */
    gl: null,

    /**
     * 宽
     * @type {Number}
     * @default 0
     */
    width: 0,

    /**
     * 高
     * @type {Number}
     * @default 0
     */
    height: 0,

    /**
     * 像素密度
     * @type {Number}
     * @default 1
     */
    pixelRatio: 1,

    /**
     * dom元素
     * @type {HTMLCanvasElement}
     * @default null
     */
    domElement: null,

    /**
     * 是否使用instanced
     * @type {Boolean}
     * @default false
     */
    useInstanced: false,

    /**
     * 是否使用VAO
     * @type {Boolean}
     * @default true
     */
    useVao: true,

    /**
     * 是否开启透明背景
     * @type {Boolean}
     * @default false
     */
    alpha: false,

    /**
     * @type {Boolean}
     * @default true
     */
    depth: true,

    /**
     * @type {Boolean}
     * @default false
     */
    stencil: false,

    /**
     * 是否开启抗锯齿
     * @type {Boolean}
     * @default true
     */
    antialias: true,

    /**
     * Boolean that indicates that the page compositor will assume the drawing buffer contains colors with pre-multiplied alpha.
     * @type {Boolean}
     * @default true
     */
    premultipliedAlpha: true,

    /**
     * If the value is true the buffers will not be cleared and will preserve their values until cleared or overwritten by the author.
     * @type {Boolean}
     * @default false
     */
    preserveDrawingBuffer: false,

    /**
     * Boolean that indicates if a context will be created if the system performance is low.
     * @type {Boolean}
     * @default false
     */
    failIfMajorPerformanceCaveat: false,

    /**
     * 游戏模式, UC浏览器专用
     * @default false
     * @type {Boolean}
     */
    gameMode: false,

    /**
     * 是否使用framebuffer
     * @type {Boolean}
     * @default false
     */
    useFramebuffer: false,

    /**
     * framebuffer配置
     * @type {Object}
     * @default {}
     */
    framebufferOption: {},

    /**
     * 是否使用对数深度
     * @type {Boolean}
     * @default false
     */
    useLogDepth: false,

    /**
     * 顶点着色器精度, 可以是以下值：highp, mediump, lowp
     * @type {String}
     * @default highp
     */
    vertexPrecision: 'highp',

    /**
     * 片段着色器精度, 可以是以下值：highp, mediump, lowp
     * @type {String}
     * @default mediump
     */
    fragmentPrecision: 'highp',

    /**
     * 雾
     * @type {Fog}
     * @default null
     */
    fog: null,

    /**
     * 偏移值
     * @type {Number}
     * @default 0
     */
    offsetX: 0,

    /**
     * 偏移值
     * @type {Number}
     * @default 0
     */
    offsetY: 0,

    /**
     * 强制渲染时使用的材质
     * @type {Material}
     * @default null
     */
    forceMaterial: null,

    /**
     * 是否初始化失败
     * @default false
     * @type {Boolean}
     */
    isInitFailed: false,

    /**
     * 是否初始化
     * @type {Boolean}
     * @default false
     * @private
     */
    _isInit: false,

    /**
     * 是否lost context
     * @type {Boolean}
     * @default false
     * @private
     */
    _isContextLost: false,

    /**
     * 是否是 WebGL2
     * @type {Boolean}
     * @default false
     */
    isWebGL2: false,

    /**
     * 是否优先使用 WebGL2
     * @type {Boolean}
     * @default false
     */
    preferWebGL2: false,

    /**
     * @constructs
     * @param  {Object} [params] 初始化参数，所有params都会复制到实例上
     */
    constructor(params) {
        /**
         * 背景色
         * @type {Color}
         * @default new Color(1, 1, 1, 1)
         */
        this.clearColor = new Color(1, 1, 1);

        Object.assign(this, params);

        /**
         * 渲染信息
         * @type {RenderInfo}
         * @default new RenderInfo
         */
        this.renderInfo = new RenderInfo();

        /**
         * 渲染列表
         * @type {RenderList}
         * @default new RenderList
         */
        this.renderList = new RenderList();

        /**
         * 灯光管理器
         * @type {ILightManager}
         * @default new LightManager
         */
        this.lightManager = new LightManager();

        /**
         * 资源管理器
         * @type {WebGLResourceManager}
         * @default new WebGLResourceManager
         */
        this.resourceManager = new WebGLResourceManager();
    },
    /**
     * 改变大小
     * @param  {Number} width  宽
     * @param  {Number} height  高
     * @param  {Boolean} [force=false] 是否强制刷新
     */
    resize(width, height, force) {
        if (force || this.width !== width || this.height !== height) {
            const canvas = this.domElement;
            this.width = width;
            this.height = height;
            canvas.width = width;
            canvas.height = height;

            if (this.framebuffer) {
                this.framebuffer.resize(this.width, this.height, force);
            }
            this.viewport();
        }
    },
    /**
     * 设置viewport偏移值
     * @param {Number} x x
     * @param {Number} y y
     */
    setOffset(x, y) {
        if (this.offsetX !== x || this.offsetY !== y) {
            this.offsetX = x;
            this.offsetY = y;
            this.viewport();
        }
    },
    /**
     * 设置viewport
     * @param  {Number} [x=this.offsetX]  x
     * @param  {Number} [y=this.offsetY] y
     * @param  {Number} [width=this.gl.drawingBufferWidth]  width
     * @param  {Number} [height=this.gl.drawingBufferHeight]  height
     */
    viewport(x, y, width, height) {
        const {
            state,
            gl
        } = this;

        if (state) {
            if (x === undefined) {
                x = this.offsetX;
            } else {
                this.offsetX = x;
            }

            if (y === undefined) {
                y = this.offsetY;
            } else {
                this.offsetY = y;
            }

            if (width === undefined) {
                width = gl.drawingBufferWidth;
            }

            if (height === undefined) {
                height = gl.drawingBufferHeight;
            }

            state.viewport(x, y, width, height);
        }
    },
    /**
     * 是否初始化
     * @type {Boolean}
     * @default false
     * @readOnly
     */
    isInit: {
        get() {
            return this._isInit && !this.isInitFailed;
        }
    },
    /**
     * 初始化回调
     * @return {WebGLRenderer} this
     */
    onInit(callback) {
        if (this._isInit) {
            callback(this);
        } else {
            this.on('init', () => {
                callback(this);
            }, true);
        }
    },
    /**
     * 初始化 context
     */
    initContext() {
        if (!this._isInit) {
            this._isInit = true;
            try {
                this._initContext();
                this.fire('init');
            } catch (e) {
                this.isInitFailed = true;
                this.fire('initFailed', e);
            }
        }
    },
    _initContext() {
        const contextAttributes = {
            alpha: this.alpha,
            depth: this.depth,
            stencil: this.stencil,
            antialias: this.antialias,
            premultipliedAlpha: this.premultipliedAlpha,
            failIfMajorPerformanceCaveat: this.failIfMajorPerformanceCaveat
        };

        // fix ios bug...
        if (this.preserveDrawingBuffer === true) {
            contextAttributes.preserveDrawingBuffer = true;
        }

        if (this.gameMode === true) {
            contextAttributes.gameMode = true;
        }

        if (this.preferWebGL2) {
            try {
                this.gl = this.domElement.getContext('webgl2', contextAttributes);
                this.isWebGL2 = true;
            } catch (e) {
                this.isWebGL2 = false;
                this.gl = null;
            }
        }

        if (!this.gl) {
            this.gl = this.domElement.getContext('webgl', contextAttributes);
            this.isWebGL2 = false;
        }

        let gl = this.gl;

        // HILO_DEBUG_START
        gl = this.gl = WebGLDebugUtils.makeDebugContext(gl, (err, funcName) => {
            throw new Error(`${WebGLDebugUtils.GLenumToString(err)} called by ${funcName}`);
        });
        // HILO_DEBUG_END

        gl.viewport(0, 0, this.width, this.height);
        glType.init(gl);
        extensions.init(gl);
        capabilities.init(gl);
        Shader.init(this);

        /**
         * state，初始化后生成。
         * @type {WebGLState}
         * @default null
         */
        this.state = new WebGLState(gl);

        if (!extensions.instanced) {
            this.useInstanced = false;
        }

        this.renderList.useInstanced = this.useInstanced;

        if (this.useFramebuffer) {
            /**
             * framebuffer，只在 useFramebuffer 为 true 时初始化后生成
             * @type {Framebuffer}
             * @default null
             */
            this.framebuffer = new Framebuffer(this, Object.assign({
                useVao: this.useVao,
                width: this.width,
                height: this.height
            }, this.framebufferOption));
        }

        this.domElement.addEventListener('webglcontextlost', (e) => {
            this._onContextLost(e);
        }, false);

        this.domElement.addEventListener('webglcontextrestored', (e) => {
            this._onContextRestore(e);
        }, false);
    },
    _onContextLost(e) {
        const gl = this.gl;
        this._isContextLost = true;

        e.preventDefault();

        Program.reset(gl);
        Shader.reset(gl);
        Texture.reset(gl);
        Buffer.reset(gl);
        VertexArrayObject.reset(gl);
        this.state.reset(gl);

        this._lastMaterial = null;
        this._lastProgram = null;

        this.fire('webglContextLost');
    },
    _onContextRestore(e) { // eslint-disable-line no-unused-vars
        const gl = this.gl;
        this._isContextLost = false;
        extensions.reset(gl);
        Framebuffer.reset(gl);

        this.fire('webglContextRestored');
    },
    /**
     * 设置深度检测
     * @param  {Material} material
     */
    setupDepthTest(material) {
        const state = this.state;
        if (material.depthTest) {
            state.enable(DEPTH_TEST);
            state.depthFunc(material.depthFunc);
            state.depthMask(material.depthMask);
            state.depthRange(material.depthRange[0], material.depthRange[1]);
        } else {
            state.disable(DEPTH_TEST);
        }
    },
    /**
     * 设置alphaToCoverage
     * @param  {Material} material
     */
    setupSampleAlphaToCoverage(material) {
        const state = this.state;
        if (material.sampleAlphaToCoverage) {
            state.enable(SAMPLE_ALPHA_TO_COVERAGE);
        } else {
            state.disable(SAMPLE_ALPHA_TO_COVERAGE);
        }
    },
    /**
     * 设置背面剔除
     * @param  {Material} material
     */
    setupCullFace(material) {
        const state = this.state;
        state.frontFace(material.frontFace);
        if (material.cullFace && material.cullFaceType !== FRONT_AND_BACK) {
            state.enable(CULL_FACE);
            state.cullFace(material.cullFaceType);
        } else {
            state.disable(CULL_FACE);
        }
    },
    /**
     * 设置混合
     * @param  {Material} material
     */
    setupBlend(material) {
        const state = this.state;
        if (material.blend) {
            state.enable(BLEND);
            state.blendFuncSeparate(
                material.blendSrc,
                material.blendDst,
                material.blendSrcAlpha,
                material.blendDstAlpha
            );
            state.blendEquationSeparate(
                material.blendEquation,
                material.blendEquationAlpha
            );
        } else {
            state.disable(BLEND);
        }
    },

    /**
     * 设置模板
     * @param  {Material} material
     */
    setupStencil(material) {
        if (!this.stencil) {
            return;
        }

        const state = this.state;
        if (material.stencilTest) {
            state.enable(STENCIL_TEST);
            state.stencilMask(material.stencilMask);
            state.stencilFunc(material.stencilFunc, material.stencilFuncRef, material.stencilFuncMask);
            state.stencilOp(material.stencilOpFail, material.stencilOpZFail, material.stencilOpZPass);
        } else {
            state.disable(STENCIL_TEST);
        }
    },

    /**
     * 设置通用的 uniform
     * @param  {Program} program
     * @param  {Mesh} mesh
     * @param  {Boolean} [force=false] 是否强制更新
     */
    setupUniforms(program, mesh, useInstanced, force) {
        const material = this.forceMaterial || mesh.material;

        if (this.isWebGL2) {
            const uniformBlocks = material.uniformBlocks;
            for (let name in program.uniformBlocks) {
                const uniformBlock = uniformBlocks[name];
                if (uniformBlock) {
                    program[name] = uniformBlock;
                }
            }
        }

        for (let name in program.uniforms) {
            const uniformInfo = material.getUniformInfo(name);
            const programUniformInfo = program.uniforms[name];
            if (!uniformInfo.isBlankInfo) {
                if (force || (uniformInfo.isDependMesh && !useInstanced)) {
                    const uniformData = uniformInfo.get(mesh, material, programUniformInfo);
                    if (uniformData !== undefined && uniformData !== null) {
                        program[name] = uniformData;
                    }
                }
            }
        }
    },
    /**
     * 设置vao
     * @param  {VertexArrayObject} vao
     * @param  {Program} program
     * @param  {Mesh} mesh
     */
    setupVao(vao, program, mesh) {
        const geometry = mesh.geometry;
        const isStatic = geometry.isStatic;

        if (vao.isDirty || !isStatic || geometry.isDirty) {
            vao.isDirty = false;
            const material = this.forceMaterial || mesh.material;
            const materialAttributes = material.attributes;
            const usage = isStatic ? STATIC_DRAW : DYNAMIC_DRAW;
            for (let name in materialAttributes) {
                const programAttribute = program.attributes[name];
                if (programAttribute) {
                    const data = material.getAttributeData(name, mesh, programAttribute);
                    if (data !== undefined && data !== null) {
                        vao.addAttribute(data, programAttribute, usage);
                    }
                }
            }
            if (geometry.indices) {
                vao.addIndexBuffer(geometry.indices, usage);
            }

            geometry.isDirty = false;
        }

        if (geometry.vertexCount) {
            vao.vertexCount = geometry.vertexCount;
        }
    },
    /**
     * 设置材质
     * @param  {Program} program
     * @param  {Mesh} mesh
     */
    setupMaterial(program, mesh, useInstanced, needForceUpdateUniforms = false) {
        const material = this.forceMaterial || mesh.material;
        if (material.isDirty || this._lastMaterial !== material) {
            this.setupDepthTest(material);
            this.setupSampleAlphaToCoverage(material);
            this.setupCullFace(material);
            this.setupBlend(material);
            this.setupStencil(material);
            needForceUpdateUniforms = true;
        }

        this.setupUniforms(program, mesh, useInstanced, needForceUpdateUniforms);
        material.isDirty = false;
        this._lastMaterial = material;
    },
    /**
     * 设置mesh
     * @param  {Mesh} mesh
     * @param  {Boolean} useInstanced
     * @return {Object} res
     * @return {VertexArrayObject} res.vao
     * @return {Program} res.program
     * @return {Geometry} res.geometry
     */
    setupMesh(mesh, useInstanced) {
        const gl = this.gl;
        const state = this.state;
        const lightManager = this.lightManager;
        const resourceManager = this.resourceManager;
        const geometry = mesh.geometry;
        const material = this.forceMaterial || mesh.material;
        const shader = Shader.getShader(mesh, material, useInstanced, lightManager, this.fog, this.useLogDepth);
        const program = Program.getProgram(shader, state);

        program.useProgram();
        this.setupMaterial(program, mesh, useInstanced, this._lastProgram !== program);
        this._lastProgram = program;

        if (mesh.material.wireframe && geometry.mode !== LINES) {
            geometry.convertToLinesMode();
        }

        const vaoId = geometry.id + program.id;
        const vao = VertexArrayObject.getVao(gl, vaoId, {
            useInstanced,
            useVao: this.useVao,
            mode: geometry.mode
        });

        this.setupVao(vao, program, mesh);

        resourceManager.addMeshResources(mesh, [vao, shader, program]);

        return {
            vao,
            program,
            geometry
        };
    },
    /**
     * 增加渲染信息
     * @param {Number} faceCount 面数量
     * @param {Number} drawCount 绘图数量
     */
    addRenderInfo(faceCount, drawCount) {
        const renderInfo = this.renderInfo;
        renderInfo.addFaceCount(faceCount);
        renderInfo.addDrawCount(drawCount);
    },

    /**
     * 渲染
     * @param  {Stage|Node} stage
     * @param  {Camera} camera
     * @param  {Boolean} [fireEvent=false] 是否发送事件
     */
    render(stage, camera, fireEvent = false) {
        this.initContext();
        if (this.isInitFailed || this._isContextLost) {
            return;
        }

        const {
            renderList,
            renderInfo,
            lightManager,
            resourceManager,
            state
        } = this;

        this.fog = stage.fog;
        lightManager.reset();
        renderInfo.reset();
        renderList.reset();

        semantic.init(this, state, camera, lightManager, this.fog);
        stage.updateMatrixWorld();
        camera.updateViewProjectionMatrix();

        const lights = [];
        stage.traverse((node) => {
            if (!node.visible) {
                return Node.TRAVERSE_STOP_CHILDREN;
            }

            if (node.isMesh) {
                renderList.addMesh(node, camera);
            } else if (node.isLight) {
                lights.push(node);
            }

            return Node.TRAVERSE_STOP_NONE;
        });

        renderList.sort();
        lightManager.update(this, camera, lights);

        if (fireEvent) {
            this.fire('beforeRender');
        }

        if (this.useFramebuffer) {
            this.framebuffer.bind();
        }

        this.clear();

        if (fireEvent) {
            this.fire('beforeRenderScene');
        }

        this.renderScene();

        if (this.useFramebuffer) {
            this.renderToScreen(this.framebuffer);
        }

        if (fireEvent) {
            this.fire('afterRender');
        }

        resourceManager.destroyUnusedResource(stage);
    },
    /**
     * 渲染场景
     */
    renderScene() {
        const renderList = this.renderList;
        renderList.traverse((mesh) => {
            this.renderMesh(mesh);
        }, (instancedMeshes) => {
            this.renderInstancedMeshes(instancedMeshes);
        });
        this._gameModeSumbit();
    },
    _gameModeSumbit() {
        const gl = this.gl;
        if (this.gameMode && gl && gl.submit) {
            gl.submit();
        }
    },
    /**
     * 清除背景
     * @param  {Color} [clearColor=this.clearColor]
     */
    clear(clearColor) {
        const {
            gl,
            state
        } = this;

        clearColor = clearColor || this.clearColor;

        this._lastMaterial = null;
        this._lastProgram = null;
        gl.clearColor(clearColor.r, clearColor.g, clearColor.b, clearColor.a);

        state.depthMask(true);
        let clearMask = gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT;
        if (this.stencil) {
            state.stencilMask(0xff);
            clearMask |= gl.STENCIL_BUFFER_BIT;
        }
        gl.clear(clearMask);
    },
    /**
     * 清除深度
     */
    clearDepth() {
        const {
            gl,
            state
        } = this;
        state.depthMask(true);
        gl.clear(gl.DEPTH_BUFFER_BIT);
    },
    /**
     * 清除模板
     */
    clearStencil() {
        const {
            gl,
            state
        } = this;
        state.stencilMask(0xff);
        gl.clear(gl.STENCIL_BUFFER_BIT);
    },
    /**
     * 将framebuffer渲染到屏幕
     * @param  {Framebuffer} framebuffer
     */
    renderToScreen(framebuffer) {
        this.state.bindSystemFramebuffer();
        framebuffer.render(0, 0, 1, 1, this.clearColor);
    },
    /**
     * 渲染一个mesh
     * @param  {Mesh} mesh
     */
    renderMesh(mesh) {
        const vao = this.setupMesh(mesh, false).vao;
        vao.draw();
        this.addRenderInfo(vao.vertexCount / 3, 1);
    },
    /**
     * 渲染一组 instanced mesh
     * @param  {Mesh[]} meshes
     */
    renderInstancedMeshes(meshes) {
        const mesh = meshes[0];
        if (!mesh) {
            return;
        }
        const material = this.forceMaterial || mesh.material;
        const {
            vao,
            program
        } = this.setupMesh(mesh, true);

        const instancedUniforms = material.getInstancedUniforms();
        instancedUniforms.forEach((uniformObj) => {
            const name = uniformObj.name;
            const info = uniformObj.info;
            const attribute = program.attributes[name];
            if (attribute) {
                vao.addInstancedAttribute(attribute, meshes, (mesh) => {
                    return info.get(mesh);
                });
            }
        });
        vao.drawInstance(meshes.length);
        this.addRenderInfo(vao.vertexCount / 3 * meshes.length, 1);
    },
    /**
     * 渲染一组普通mesh
     * @param  {Mesh[]} meshes
     */
    renderMultipleMeshes(meshes) {
        meshes.forEach((mesh) => {
            this.renderMesh(mesh);
        });
    },
    /**
     * 销毁 WebGL 资源
     */
    releaseGLResource() {
        const gl = this.gl;
        if (gl) {
            Program.reset(gl);
            Shader.reset(gl);
            Buffer.reset(gl);
            VertexArrayObject.reset(gl);
            this.state.reset(gl);
            Texture.reset(gl);
            Framebuffer.destroy(gl);
        }
    }
});

export default WebGLRenderer;
