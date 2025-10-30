/* global GPUBufferUsage, GPUShaderStage, GPUTextureUsage */

import Class from '../core/Class';
import Node from '../core/Node';
import Color from '../math/Color';
import EventMixin from '../core/EventMixin';
import RenderInfo from './RenderInfo';
import RenderList from './RenderList';
import WebGPUState from './WebGPUState';
import WebGPUResourceManager from './WebGPUResourceManager';
import LightManager from '../light/LightManager';
import semantic from '../material/semantic';

/**
 * WebGPU渲染器
 * @class
 * @fires init 初始化事件
 * @fires beforeRender 渲染前事件
 * @fires beforeRenderScene 渲染场景前事件
 * @fires afterRender 渲染后事件
 * @fires initFailed 初始化失败事件
 * @fires contextLost 上下文丢失事件
 * @fires contextRestored 上下文恢复事件
 * @mixes EventMixin
 */
const WebGPURenderer = Class.create(/** @lends WebGPURenderer.prototype */ {
    Mixes: EventMixin,

    /**
     * @default WebGPURenderer
     * @type {String}
     */
    className: 'WebGPURenderer',

    /**
     * @default true
     * @type {Boolean}
     */
    isWebGPURenderer: true,

    /**
     * GPU设备
     * @default null
     * @type {GPUDevice}
     */
    device: null,

    /**
     * GPU适配器
     * @default null
     * @type {GPUAdapter}
     */
    adapter: null,

    /**
     * canvas上下文
     * @default null
     * @type {GPUCanvasContext}
     */
    context: null,

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
     * 是否开启透明背景
     * @type {Boolean}
     * @default false
     */
    alpha: false,

    /**
     * 纹理格式
     * @type {String}
     * @default 'bgra8unorm'
     */
    format: 'bgra8unorm',

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
         * @type {LightManager}
         * @default new LightManager
         */
        this.lightManager = new LightManager();

        /**
         * 资源管理器
         * @type {WebGPUResourceManager}
         * @default new WebGPUResourceManager
         */
        this.resourceManager = new WebGPUResourceManager();
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

            this.viewport();
        }
    },

    /**
     * 设置viewport
     * @param  {Number} [x=0]  x
     * @param  {Number} [y=0] y
     * @param  {Number} [width=this.width]  width
     * @param  {Number} [height=this.height]  height
     */
    viewport(x, y, width, height) {
        if (this.state) {
            if (x === undefined) {
                x = 0;
            }
            if (y === undefined) {
                y = 0;
            }
            if (width === undefined) {
                width = this.width;
            }
            if (height === undefined) {
                height = this.height;
            }
            this.state.viewport(x, y, width, height);
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
     * @return {WebGPURenderer} this
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
    async initContext() {
        if (!this._isInit) {
            this._isInit = true;
            try {
                await this._initContext();
                this.fire('init');
            } catch (e) {
                this.isInitFailed = true;
                this.fire('initFailed', e);
                throw e;
            }
        }
    },

    async _initContext() {
        // 检查WebGPU支持
        if (!navigator.gpu) {
            throw new Error('WebGPU is not supported in this browser');
        }

        // 请求适配器
        this.adapter = await navigator.gpu.requestAdapter({
            powerPreference: 'high-performance'
        });

        if (!this.adapter) {
            throw new Error('Failed to get WebGPU adapter');
        }

        // 请求设备
        this.device = await this.adapter.requestDevice();

        if (!this.device) {
            throw new Error('Failed to get WebGPU device');
        }

        // 获取canvas上下文
        this.context = this.domElement.getContext('webgpu');

        if (!this.context) {
            throw new Error('Failed to get WebGPU context');
        }

        // 配置context
        const preferredFormat = navigator.gpu.getPreferredCanvasFormat();
        this.format = this.alpha ? 'rgba8unorm' : preferredFormat;

        this.context.configure({
            device: this.device,
            format: this.format,
            alphaMode: this.alpha ? 'premultiplied' : 'opaque'
        });

        /**
         * state，初始化后生成。
         * @type {WebGPUState}
         * @default null
         */
        this.state = new WebGPUState(this.device);

        // 监听设备丢失
        this.device.lost.then((info) => {
            this._onContextLost(info);
        });
    },

    _onContextLost(info) {
        // eslint-disable-next-line no-console
        console.error('WebGPU device lost:', info.message);
        this.fire('contextLost', info);
    },

    /**
     * 清空画布
     * @param  {Color} [clearColor] 清空颜色
     */
    clear(clearColor) {
        clearColor = clearColor || this.clearColor;

        const commandEncoder = this.device.createCommandEncoder();
        const textureView = this.context.getCurrentTexture().createView();

        const renderPassDescriptor = {
            colorAttachments: [{
                view: textureView,
                clearValue: {
                    r: clearColor.r,
                    g: clearColor.g,
                    b: clearColor.b,
                    a: clearColor.a
                },
                loadOp: 'clear',
                storeOp: 'store'
            }]
        };

        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        passEncoder.end();

        this.device.queue.submit([commandEncoder.finish()]);
    },

    /**
     * 获取或创建简单的WebGPU shader
     * @private
     * @return {GPUShaderModule}
     */
    _getSimpleShader() {
        // 简化的WGSL shader，支持基本材质
        const shaderCode = `
            struct Uniforms {
                mvpMatrix: mat4x4<f32>,
                modelMatrix: mat4x4<f32>,
                normalMatrix: mat4x4<f32>,
            }
            
            struct MaterialUniforms {
                diffuseColor: vec4<f32>,
                specularColor: vec4<f32>,
                emissionColor: vec4<f32>,
                shininess: f32,
                opacity: f32,
                _padding1: f32,
                _padding2: f32,
            }
            
            @binding(0) @group(0) var<uniform> uniforms: Uniforms;
            @binding(1) @group(0) var<uniform> material: MaterialUniforms;

            struct VertexInput {
                @location(0) position: vec3<f32>,
                @location(1) normal: vec3<f32>,
            }

            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
                @location(0) worldPos: vec3<f32>,
                @location(1) normal: vec3<f32>,
            }

            @vertex
            fn vertexMain(input: VertexInput) -> VertexOutput {
                var output: VertexOutput;
                output.position = uniforms.mvpMatrix * vec4<f32>(input.position, 1.0);
                output.worldPos = (uniforms.modelMatrix * vec4<f32>(input.position, 1.0)).xyz;
                output.normal = normalize((uniforms.normalMatrix * vec4<f32>(input.normal, 0.0)).xyz);
                return output;
            }

            @fragment
            fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
                // 简单的光照计算
                let lightDir = normalize(vec3<f32>(1.0, 1.0, 1.0));
                let normal = normalize(input.normal);
                let diffuse = max(dot(normal, lightDir), 0.0);
                
                let ambient = 0.3;
                let lighting = ambient + diffuse * 0.7;
                
                var color = material.diffuseColor.rgb * lighting;
                
                // 添加自发光
                color = color + material.emissionColor.rgb;
                
                return vec4<f32>(color, material.diffuseColor.a * material.opacity);
            }
        `;

        const cacheKey = 'simple_shader';
        let shader = this.resourceManager.getPipeline(cacheKey);
        if (!shader) {
            shader = this.device.createShaderModule({ code: shaderCode });
            this.resourceManager.setPipeline(cacheKey, shader);
        }
        return shader;
    },

    /**
     * 获取或创建渲染管线
     * @private
     * @param {Geometry} geometry
     * @param {Material} material
     * @param {GPUBindGroupLayout} bindGroupLayout
     * @return {GPURenderPipeline}
     */
    _getPipeline(geometry, material, bindGroupLayout) {
        const pipelineKey = `pipeline_${geometry.id}_${material.id}`;
        let pipeline = this.resourceManager.getPipeline(pipelineKey);

        if (!pipeline) {
            const shader = this._getSimpleShader();

            // 创建深度纹理格式
            const depthFormat = 'depth24plus';

            pipeline = this.device.createRenderPipeline({
                layout: this.device.createPipelineLayout({
                    bindGroupLayouts: [bindGroupLayout]
                }),
                vertex: {
                    module: shader,
                    entryPoint: 'vertexMain',
                    buffers: [
                        {
                            arrayStride: 12, // 3 floats for position
                            attributes: [{
                                shaderLocation: 0,
                                offset: 0,
                                format: 'float32x3',
                            }],
                        },
                        {
                            arrayStride: 12, // 3 floats for normal
                            attributes: [{
                                shaderLocation: 1,
                                offset: 0,
                                format: 'float32x3',
                            }],
                        }
                    ],
                },
                fragment: {
                    module: shader,
                    entryPoint: 'fragmentMain',
                    targets: [{
                        format: this.format,
                        blend: material.transparent ? {
                            color: {
                                srcFactor: 'src-alpha',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add',
                            },
                            alpha: {
                                srcFactor: 'one',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add',
                            },
                        } : undefined,
                    }],
                },
                primitive: {
                    topology: 'triangle-list',
                    cullMode: (() => {
                        if (material.side === 2) return 'none';
                        if (material.side === 0) return 'back';
                        return 'front';
                    })(),
                },
                depthStencil: {
                    depthWriteEnabled: material.depthMask,
                    depthCompare: material.depthTest ? 'less' : 'always',
                    format: depthFormat,
                },
            });

            this.resourceManager.setPipeline(pipelineKey, pipeline);
        }

        return pipeline;
    },

    /**
     * 渲染一个mesh
     * @param {Mesh} mesh
     * @param {Camera} camera
     * @param {GPURenderPassEncoder} passEncoder
     */
    renderMesh(mesh, camera, passEncoder) {
        const geometry = mesh.geometry;
        const material = mesh.material;

        if (!geometry || !material) {
            return;
        }

        // 获取或创建顶点缓冲区
        const vertexBufferKey = `vb_${geometry.id}`;
        let vertexBuffer = this.resourceManager.getBuffer(vertexBufferKey);
        if (!vertexBuffer && geometry.vertices && geometry.vertices.data) {
            vertexBuffer = this.device.createBuffer({
                size: geometry.vertices.data.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            });
            this.device.queue.writeBuffer(vertexBuffer, 0, geometry.vertices.data);
            this.resourceManager.setBuffer(vertexBufferKey, vertexBuffer);
        }

        // 获取或创建法线缓冲区
        const normalBufferKey = `nb_${geometry.id}`;
        let normalBuffer = this.resourceManager.getBuffer(normalBufferKey);
        if (!normalBuffer && geometry.normals && geometry.normals.data) {
            normalBuffer = this.device.createBuffer({
                size: geometry.normals.data.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            });
            this.device.queue.writeBuffer(normalBuffer, 0, geometry.normals.data);
            this.resourceManager.setBuffer(normalBufferKey, normalBuffer);
        }

        // 获取或创建索引缓冲区
        const indexBufferKey = `ib_${geometry.id}`;
        let indexBuffer = this.resourceManager.getBuffer(indexBufferKey);
        let indexCount = 0;
        if (!indexBuffer && geometry.indices && geometry.indices.data) {
            indexBuffer = this.device.createBuffer({
                size: geometry.indices.data.byteLength,
                usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
            });
            this.device.queue.writeBuffer(indexBuffer, 0, geometry.indices.data);
            this.resourceManager.setBuffer(indexBufferKey, indexBuffer);
            indexCount = geometry.indices.data.length;
        }

        if (!vertexBuffer || !normalBuffer || !indexBuffer) {
            return;
        }

        // 创建uniform缓冲区
        const uniformBufferSize = 192; // 3 * mat4x4 (64 bytes each)
        const uniformBuffer = this.device.createBuffer({
            size: uniformBufferSize,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // 计算MVP矩阵
        mesh.updateMatrixWorld();
        camera.updateViewProjectionMatrix();

        const mvpMatrix = new Float32Array(16);
        const modelMatrix = mesh.worldMatrix.elements;
        const viewProjectionMatrix = camera.viewProjectionMatrix.elements;

        // MVP = VP * M
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                mvpMatrix[i * 4 + j] = 0;
                for (let k = 0; k < 4; k++) {
                    mvpMatrix[i * 4 + j] += viewProjectionMatrix[i * 4 + k] * modelMatrix[k * 4 + j];
                }
            }
        }

        // 计算法线矩阵（模型矩阵的逆转置）
        const normalMatrix = new Float32Array(16);
        const modelMat = mesh.worldMatrix.elements;
        // 简化：直接使用模型矩阵（对于均匀缩放有效）
        for (let i = 0; i < 16; i++) {
            normalMatrix[i] = modelMat[i];
        }

        // 上传矩阵uniform
        const uniformData = new Float32Array(48); // 3 matrices * 16 floats
        uniformData.set(mvpMatrix, 0);
        uniformData.set(modelMatrix, 16);
        uniformData.set(normalMatrix, 32);
        this.device.queue.writeBuffer(uniformBuffer, 0, uniformData);

        // 创建材质uniform缓冲区
        const materialBufferSize = 64; // vec4 * 4 = 64 bytes
        const materialBuffer = this.device.createBuffer({
            size: materialBufferSize,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // 提取材质属性
        const diffuse = material.diffuse || new Color(0.5, 0.5, 0.5);
        const specular = material.specular || new Color(1, 1, 1);
        const emission = material.emission || new Color(0, 0, 0);
        const shininess = material.shininess || 32;
        const opacity = material.transparency !== undefined ? material.transparency : 1;

        const materialData = new Float32Array(16);
        // diffuseColor (vec4)
        materialData[0] = diffuse.r || diffuse._r || 0.5;
        materialData[1] = diffuse.g || diffuse._g || 0.5;
        materialData[2] = diffuse.b || diffuse._b || 0.5;
        materialData[3] = diffuse.a || diffuse._a || 1;
        // specularColor (vec4)
        materialData[4] = specular.r || specular._r || 1;
        materialData[5] = specular.g || specular._g || 1;
        materialData[6] = specular.b || specular._b || 1;
        materialData[7] = 1;
        // emissionColor (vec4)
        materialData[8] = emission.r || emission._r || 0;
        materialData[9] = emission.g || emission._g || 0;
        materialData[10] = emission.b || emission._b || 0;
        materialData[11] = 1;
        // shininess, opacity, padding
        materialData[12] = shininess;
        materialData[13] = opacity;
        materialData[14] = 0;
        materialData[15] = 0;

        this.device.queue.writeBuffer(materialBuffer, 0, materialData);

        // 创建bind group layout
        const bindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: 'uniform' }
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' }
                }
            ]
        });

        // 创建bind group
        const bindGroup = this.device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: uniformBuffer }
                },
                {
                    binding: 1,
                    resource: { buffer: materialBuffer }
                }
            ]
        });

        // 获取渲染管线
        const pipeline = this._getPipeline(geometry, material, bindGroupLayout);

        // 渲染
        passEncoder.setPipeline(pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.setVertexBuffer(0, vertexBuffer);
        passEncoder.setVertexBuffer(1, normalBuffer);
        passEncoder.setIndexBuffer(indexBuffer, 'uint16');
        passEncoder.drawIndexed(indexCount, 1, 0, 0, 0);

        this.renderInfo.addFaceCount(indexCount / 3);
        this.renderInfo.addDrawCount(1);
    },

    /**
     * 渲染
     * @param  {Stage} stage 舞台
     * @param  {Camera} camera 相机
     * @param  {Boolean} [fireEvent=true] 是否触发事件
     */
    render(stage, camera, fireEvent = true) {
        if (!this.isInit) {
            return this;
        }

        if (fireEvent) {
            this.fire('beforeRender');
        }

        this.renderInfo.reset();
        this.lightManager.reset();

        // 初始化semantic
        semantic.init(this, this.state, camera, this.lightManager, stage.fog);

        // 更新场景矩阵
        stage.updateMatrixWorld();
        camera.updateViewProjectionMatrix();

        // 收集可渲染对象
        const meshes = [];
        stage.traverse((node) => {
            if (!node.visible) {
                return Node.TRAVERSE_STOP_CHILDREN;
            }

            if (node.isMesh && node.geometry && node.material) {
                meshes.push(node);
            }

            return Node.TRAVERSE_STOP_NONE;
        });

        // 创建深度纹理（如果需要）
        const depthTextureKey = `depth_${this.width}_${this.height}`;
        let depthTexture = this.resourceManager.getTexture(depthTextureKey);
        if (!depthTexture) {
            depthTexture = this.device.createTexture({
                size: [this.width, this.height],
                format: 'depth24plus',
                usage: GPUTextureUsage.RENDER_ATTACHMENT,
            });
            this.resourceManager.setTexture(depthTextureKey, depthTexture);
        }

        // 开始渲染
        const commandEncoder = this.device.createCommandEncoder();
        const textureView = this.context.getCurrentTexture().createView();

        const renderPassDescriptor = {
            colorAttachments: [{
                view: textureView,
                clearValue: {
                    r: this.clearColor.r,
                    g: this.clearColor.g,
                    b: this.clearColor.b,
                    a: this.clearColor.a
                },
                loadOp: 'clear',
                storeOp: 'store',
            }],
            depthStencilAttachment: {
                view: depthTexture.createView(),
                depthClearValue: 1.0,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
            }
        };

        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);

        // 渲染所有mesh
        for (const mesh of meshes) {
            this.renderMesh(mesh, camera, passEncoder);
        }

        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);

        if (fireEvent) {
            this.fire('afterRender');
        }

        return this;
    },

    /**
     * 销毁
     */
    destroy() {
        if (this.device) {
            this.device.destroy();
            this.device = null;
        }
        this.context = null;
        this.adapter = null;
        this._isInit = false;
    }
});

export default WebGPURenderer;
