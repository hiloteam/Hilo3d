/* global GPUShaderStage, GPUTextureUsage */

import Class from '../../core/Class';
import Node from '../../core/Node';
import Color from '../../math/Color';
import Vector3 from '../../math/Vector3';
import EventMixin from '../../core/EventMixin';
import RenderInfo from '../RenderInfo';
import RenderList from '../RenderList';
import WebGPUState from './WebGPUState';
import WebGPUResourceManager from './WebGPUResourceManager';
import WebGPUShaderManager from './WebGPUShaderManager';
import WebGPUBufferHelper from './WebGPUBufferHelper';
import WebGPUMaterialHelper from './WebGPUMaterialHelper';
import WebGPUUniformHelper from './WebGPUUniformHelper';
import WebGPUShadowHelper from './WebGPUShadowHelper';
import LightManager from '../../light/LightManager';
import semantic from '../../material/semantic';

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
     * 是否启用阴影
     * @type {Boolean}
     * @default false
     */
    enableShadows: false,

    /**
     * 阴影贴图大小
     * @type {Number}
     * @default 2048
     */
    shadowMapSize: 2048,

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

        /**
         * 光源方向
         * @type {Vector3}
         * @default new Vector3(-0.5, -1, -0.5)
         */
        this.lightDirection = new Vector3(-0.5, -1, -0.5);

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

        /**
         * shader管理器，初始化后生成。
         * @type {WebGPUShaderManager}
         * @default null
         */
        this.shaderManager = new WebGPUShaderManager(this.device);

        /**
         * buffer管理器，初始化后生成。
         * @type {WebGPUBufferHelper}
         * @default null
         */
        this.bufferHelper = new WebGPUBufferHelper(this.device, this.resourceManager);

        /**
         * material管理器，初始化后生成。
         * @type {WebGPUMaterialHelper}
         * @default null
         */
        this.materialHelper = new WebGPUMaterialHelper(this.device);

        /**
         * uniform管理器，初始化后生成。
         * @type {WebGPUUniformHelper}
         * @default null
         */
        this.uniformHelper = new WebGPUUniformHelper(this.device);

        // 初始化阴影helper（如果启用）
        if (this.enableShadows) {
            /**
             * 阴影helper，初始化后生成。
             * @type {WebGPUShadowHelper}
             * @default null
             */
            this.shadowHelper = new WebGPUShadowHelper(this.device, this.shadowMapSize);
            this.shadowHelper.createShadowMap();
            this._initShadowPipeline();
        }

        // 监听设备丢失
        this.device.lost.then((info) => {
            this._onContextLost(info);
        });
    },

    /**
     * 初始化阴影渲染管线
     * @private
     */
    _initShadowPipeline() {
        const shadowShader = this.shaderManager.getShadowDepthShaderModule();

        // 创建阴影深度渲染的bind group layout
        this.shadowBindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: 'uniform' }
                }
            ]
        });

        // 创建阴影深度渲染管线
        this.shadowPipeline = this.device.createRenderPipeline({
            layout: this.device.createPipelineLayout({
                bindGroupLayouts: [this.shadowBindGroupLayout]
            }),
            vertex: {
                module: shadowShader,
                entryPoint: 'vertexMain',
                buffers: [
                    {
                        arrayStride: 12, // 3 floats for position
                        attributes: [{
                            shaderLocation: 0,
                            offset: 0,
                            format: 'float32x3',
                        }],
                    }
                ],
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'back',
            },
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: 'less',
                format: 'depth24plus',
            },
        });
    },

    _onContextLost(info) {
        // eslint-disable-next-line no-console
        console.error('WebGPU device lost:', info.message);
        this.fire('contextLost', info);
    },

    /**
     * 设置光源方向
     * @param {Vector3} direction 光源方向向量
     */
    setLightDirection(direction) {
        this.lightDirection.copy(direction);
        if (this.shadowHelper) {
            this.shadowHelper.setLightDirection({
                x: direction.x,
                y: direction.y,
                z: direction.z
            });
        }
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
     * 获取或创建渲染管线
     * @private
     * @param {Geometry} geometry
     * @param {Material} material
     * @param {GPUBindGroupLayout} bindGroupLayout
     * @param {Boolean} hasTexture 是否有纹理
     * @return {GPURenderPipeline}
     */
    _getPipeline(geometry, material, bindGroupLayout, hasTexture = false) {
        const pipelineKey = `pipeline_${geometry.id}_${material.id}_${hasTexture ? 'tex' : 'notex'}`;
        let pipeline = this.resourceManager.getPipeline(pipelineKey);

        if (!pipeline) {
            const shader = this.shaderManager.getShaderModule(hasTexture);

            // 创建深度纹理格式
            const depthFormat = 'depth24plus';

            const vertexBuffers = [
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
            ];

            // 如果有纹理，添加UV缓冲区
            if (hasTexture) {
                vertexBuffers.push({
                    arrayStride: 8, // 2 floats for UV
                    attributes: [{
                        shaderLocation: 2,
                        offset: 0,
                        format: 'float32x2',
                    }],
                });
            }

            pipeline = this.device.createRenderPipeline({
                layout: this.device.createPipelineLayout({
                    bindGroupLayouts: [bindGroupLayout]
                }),
                vertex: {
                    module: shader,
                    entryPoint: 'vertexMain',
                    buffers: vertexBuffers,
                },
                fragment: {
                    module: shader,
                    entryPoint: 'fragmentMain',
                    targets: [{
                        format: this.format,
                        blend: this.materialHelper.getBlendMode(material),
                    }],
                },
                primitive: {
                    topology: 'triangle-list',
                    cullMode: this.materialHelper.getCullMode(material),
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

        // 验证几何体数据
        if (!geometry.vertices || !geometry.vertices.data
            || !geometry.normals || !geometry.normals.data
            || !geometry.indices || !geometry.indices.data) {
            return;
        }

        // 检查材质和纹理
        const hasTextureObject = this.materialHelper.hasTexture(material);
        const hasUV = hasTextureObject && geometry.uvs && geometry.uvs.data;
        const textureReady = this.materialHelper.isTextureReady(material);
        const useTexture = hasUV && textureReady;

        // 使用buffer helper获取或创建缓冲区
        const vertexBuffer = this.bufferHelper.getOrCreateVertexBuffer(geometry);
        const normalBuffer = this.bufferHelper.getOrCreateNormalBuffer(geometry);
        const uvBuffer = useTexture ? this.bufferHelper.getOrCreateUVBuffer(geometry) : null;
        const { buffer: indexBuffer, count: indexCount } = this.bufferHelper.getOrCreateIndexBuffer(geometry);

        if (!vertexBuffer || !normalBuffer || !indexBuffer || indexCount === 0) {
            return;
        }

        // 使用uniform helper创建uniform数据
        const mvpUniformData = this.uniformHelper.createMVPUniformData(mesh, camera);
        const uniformBuffer = this.bufferHelper.createUniformBuffer(
            this.uniformHelper.getMVPUniformSize(),
            mvpUniformData
        );

        // 使用material helper创建材质uniform数据
        const materialData = this.materialHelper.createMaterialUniformData(material, useTexture);
        const materialBuffer = this.bufferHelper.createUniformBuffer(
            this.uniformHelper.getMaterialUniformSize(),
            materialData
        );

        // 创建纹理和采样器（如果需要）
        let gpuTexture = null;
        let sampler = null;

        if (useTexture) {
            const diffuse = material.diffuse;
            const textureKey = `tex_${diffuse.id}`;
            gpuTexture = this.resourceManager.getTexture(textureKey);

            if (!gpuTexture) {
                // 创建纹理
                const textureSize = [diffuse.image.width, diffuse.image.height, 1];
                gpuTexture = this.device.createTexture({
                    size: textureSize,
                    format: 'rgba8unorm',
                    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
                });

                // 上传纹理数据
                this.device.queue.copyExternalImageToTexture(
                    { source: diffuse.image },
                    { texture: gpuTexture },
                    textureSize
                );

                this.resourceManager.setTexture(textureKey, gpuTexture);
            }

            // 创建采样器
            const samplerKey = 'default_sampler';
            sampler = this.resourceManager.getTexture(samplerKey);
            if (!sampler) {
                sampler = this.device.createSampler({
                    magFilter: 'linear',
                    minFilter: 'linear',
                    mipmapFilter: 'linear',
                    addressModeU: 'repeat',
                    addressModeV: 'repeat',
                });
                this.resourceManager.setTexture(samplerKey, sampler);
            }
        }

        // 创建bind group layout
        const bindGroupLayoutEntries = [
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
        ];

        if (useTexture && gpuTexture) {
            bindGroupLayoutEntries.push(
                {
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {}
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: {}
                }
            );
        }

        const bindGroupLayout = this.device.createBindGroupLayout({
            entries: bindGroupLayoutEntries
        });

        // 创建bind group
        const bindGroupEntries = [
            {
                binding: 0,
                resource: { buffer: uniformBuffer }
            },
            {
                binding: 1,
                resource: { buffer: materialBuffer }
            }
        ];

        if (useTexture && gpuTexture) {
            bindGroupEntries.push(
                {
                    binding: 2,
                    resource: gpuTexture.createView()
                },
                {
                    binding: 3,
                    resource: sampler
                }
            );
        }

        const bindGroup = this.device.createBindGroup({
            layout: bindGroupLayout,
            entries: bindGroupEntries
        });

        // 获取渲染管线
        const pipeline = this._getPipeline(geometry, material, bindGroupLayout, useTexture && gpuTexture !== null);

        // 渲染
        passEncoder.setPipeline(pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.setVertexBuffer(0, vertexBuffer);
        passEncoder.setVertexBuffer(1, normalBuffer);
        if (useTexture && uvBuffer) {
            passEncoder.setVertexBuffer(2, uvBuffer);
        }
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

        // 如果启用阴影，先渲染阴影pass
        if (this.enableShadows && this.shadowHelper) {
            this._renderShadowPass(commandEncoder, meshes);
        }

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
            if (this.enableShadows && this.shadowHelper) {
                this._renderMeshWithShadow(mesh, camera, passEncoder);
            } else {
                this.renderMesh(mesh, camera, passEncoder);
            }
        }

        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);

        if (fireEvent) {
            this.fire('afterRender');
        }

        return this;
    },

    /**
     * 渲染阴影pass
     * @private
     * @param {GPUCommandEncoder} commandEncoder
     * @param {Array<Mesh>} meshes
     */
    _renderShadowPass(commandEncoder, meshes) {
        const shadowMapView = this.shadowHelper.getShadowMapView();
        const lightSpaceMatrix = this.shadowHelper.calculateLightSpaceMatrix();

        const shadowPassDescriptor = {
            colorAttachments: [],
            depthStencilAttachment: {
                view: shadowMapView,
                depthClearValue: 1.0,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
            }
        };

        const shadowPass = commandEncoder.beginRenderPass(shadowPassDescriptor);

        for (const mesh of meshes) {
            this._renderMeshShadowDepth(mesh, lightSpaceMatrix, shadowPass);
        }

        shadowPass.end();
    },

    /**
     * 渲染mesh到阴影深度贴图
     * @private
     * @param {Mesh} mesh
     * @param {Float32Array} lightSpaceMatrix
     * @param {GPURenderPassEncoder} passEncoder
     */
    _renderMeshShadowDepth(mesh, lightSpaceMatrix, passEncoder) {
        const geometry = mesh.geometry;

        if (!geometry || !geometry.vertices || !geometry.vertices.data
            || !geometry.indices || !geometry.indices.data) {
            return;
        }

        const vertexBuffer = this.bufferHelper.getOrCreateVertexBuffer(geometry);
        const { buffer: indexBuffer, count: indexCount } = this.bufferHelper.getOrCreateIndexBuffer(geometry);

        if (!vertexBuffer || !indexBuffer || indexCount === 0) {
            return;
        }

        // 创建阴影uniform数据：lightSpaceMatrix + modelMatrix
        const uniformData = new Float32Array(32);
        uniformData.set(lightSpaceMatrix, 0);
        uniformData.set(mesh.worldMatrix.elements, 16);

        const uniformBuffer = this.bufferHelper.createUniformBuffer(128, uniformData);

        const bindGroup = this.device.createBindGroup({
            layout: this.shadowBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: uniformBuffer }
                }
            ]
        });

        passEncoder.setPipeline(this.shadowPipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.setVertexBuffer(0, vertexBuffer);
        passEncoder.setIndexBuffer(indexBuffer, 'uint16');
        passEncoder.drawIndexed(indexCount, 1, 0, 0, 0);
    },

    /**
     * 渲染带阴影的mesh
     * @private
     * @param {Mesh} mesh
     * @param {Camera} camera
     * @param {GPURenderPassEncoder} passEncoder
     */
    _renderMeshWithShadow(mesh, camera, passEncoder) {
        const geometry = mesh.geometry;
        const material = mesh.material;

        if (!geometry || !material) {
            return;
        }

        if (!geometry.vertices || !geometry.vertices.data
            || !geometry.normals || !geometry.normals.data
            || !geometry.indices || !geometry.indices.data) {
            return;
        }

        const hasTextureObject = this.materialHelper.hasTexture(material);
        const hasUV = hasTextureObject && geometry.uvs && geometry.uvs.data;
        const textureReady = this.materialHelper.isTextureReady(material);
        const useTexture = hasUV && textureReady;

        const vertexBuffer = this.bufferHelper.getOrCreateVertexBuffer(geometry);
        const normalBuffer = this.bufferHelper.getOrCreateNormalBuffer(geometry);
        const uvBuffer = useTexture ? this.bufferHelper.getOrCreateUVBuffer(geometry) : null;
        const { buffer: indexBuffer, count: indexCount } = this.bufferHelper.getOrCreateIndexBuffer(geometry);

        if (!vertexBuffer || !normalBuffer || !indexBuffer || indexCount === 0) {
            return;
        }

        // MVP uniform
        const mvpUniformData = this.uniformHelper.createMVPUniformData(mesh, camera);
        const uniformBuffer = this.bufferHelper.createUniformBuffer(
            this.uniformHelper.getMVPUniformSize(),
            mvpUniformData
        );

        // Material uniform
        const materialData = this.materialHelper.createMaterialUniformData(material, useTexture);
        const materialBuffer = this.bufferHelper.createUniformBuffer(
            this.uniformHelper.getMaterialUniformSize(),
            materialData
        );

        // Shadow uniform
        const lightSpaceMatrix = this.shadowHelper.calculateLightSpaceMatrix();
        const shadowData = new Float32Array(24);
        shadowData.set(lightSpaceMatrix, 0);
        shadowData[16] = this.lightDirection.x;
        shadowData[17] = this.lightDirection.y;
        shadowData[18] = this.lightDirection.z;
        shadowData[19] = 0;
        shadowData[20] = this.shadowHelper.getShadowBias();
        shadowData[21] = this.shadowMapSize;
        shadowData[22] = 0;
        shadowData[23] = 0;
        const shadowBuffer = this.bufferHelper.createUniformBuffer(96, shadowData);

        // 创建纹理和采样器（如果需要）
        let gpuTexture = null;
        let textureSampler = null;

        if (useTexture) {
            const diffuse = material.diffuse;
            const textureKey = `tex_${diffuse.id}`;
            gpuTexture = this.resourceManager.getTexture(textureKey);

            if (!gpuTexture) {
                const textureSize = [diffuse.image.width, diffuse.image.height, 1];
                gpuTexture = this.device.createTexture({
                    size: textureSize,
                    format: 'rgba8unorm',
                    usage: GPUTextureUsage.TEXTURE_BINDING
                        | GPUTextureUsage.COPY_DST
                        | GPUTextureUsage.RENDER_ATTACHMENT,
                });

                this.device.queue.copyExternalImageToTexture(
                    { source: diffuse.image },
                    { texture: gpuTexture },
                    textureSize
                );

                this.resourceManager.setTexture(textureKey, gpuTexture);
            }

            const samplerKey = 'default_sampler';
            textureSampler = this.resourceManager.getTexture(samplerKey);
            if (!textureSampler) {
                textureSampler = this.device.createSampler({
                    magFilter: 'linear',
                    minFilter: 'linear',
                    mipmapFilter: 'linear',
                    addressModeU: 'repeat',
                    addressModeV: 'repeat',
                });
                this.resourceManager.setTexture(samplerKey, textureSampler);
            }
        }

        // 创建bind group layout for shadow shader
        const bindGroupLayoutEntries = [
            {
                binding: 0,
                visibility: GPUShaderStage.VERTEX,
                buffer: { type: 'uniform' }
            },
            {
                binding: 1,
                visibility: GPUShaderStage.FRAGMENT,
                buffer: { type: 'uniform' }
            },
            {
                binding: 2,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                buffer: { type: 'uniform' }
            },
            {
                binding: 3,
                visibility: GPUShaderStage.FRAGMENT,
                texture: { sampleType: 'depth' }
            },
            {
                binding: 4,
                visibility: GPUShaderStage.FRAGMENT,
                sampler: { type: 'comparison' }
            }
        ];

        if (useTexture && gpuTexture) {
            bindGroupLayoutEntries.push(
                {
                    binding: 5,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {}
                },
                {
                    binding: 6,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: {}
                }
            );
        }

        const bindGroupLayout = this.device.createBindGroupLayout({
            entries: bindGroupLayoutEntries
        });

        // 创建bind group entries
        const bindGroupEntries = [
            {
                binding: 0,
                resource: { buffer: uniformBuffer }
            },
            {
                binding: 1,
                resource: { buffer: materialBuffer }
            },
            {
                binding: 2,
                resource: { buffer: shadowBuffer }
            },
            {
                binding: 3,
                resource: this.shadowHelper.getShadowMapView()
            },
            {
                binding: 4,
                resource: this.shadowHelper.getShadowSampler()
            }
        ];

        if (useTexture && gpuTexture) {
            bindGroupEntries.push(
                {
                    binding: 5,
                    resource: gpuTexture.createView()
                },
                {
                    binding: 6,
                    resource: textureSampler
                }
            );
        }

        const bindGroup = this.device.createBindGroup({
            layout: bindGroupLayout,
            entries: bindGroupEntries
        });

        // 获取带阴影的渲染管线
        const pipeline = this._getShadowPipeline(
            geometry,
            material,
            bindGroupLayout,
            useTexture && gpuTexture !== null
        );

        passEncoder.setPipeline(pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.setVertexBuffer(0, vertexBuffer);
        passEncoder.setVertexBuffer(1, normalBuffer);
        if (useTexture && uvBuffer) {
            passEncoder.setVertexBuffer(2, uvBuffer);
        }
        passEncoder.setIndexBuffer(indexBuffer, 'uint16');
        passEncoder.drawIndexed(indexCount, 1, 0, 0, 0);

        this.renderInfo.addFaceCount(indexCount / 3);
        this.renderInfo.addDrawCount(1);
    },

    /**
     * 获取或创建带阴影的渲染管线
     * @private
     * @param {Geometry} geometry
     * @param {Material} material
     * @param {GPUBindGroupLayout} bindGroupLayout
     * @param {Boolean} hasTexture
     * @return {GPURenderPipeline}
     */
    _getShadowPipeline(geometry, material, bindGroupLayout, hasTexture = false) {
        const pipelineKey = `shadow_pipeline_${geometry.id}_${material.id}_${hasTexture ? 'tex' : 'notex'}`;
        let pipeline = this.resourceManager.getPipeline(pipelineKey);

        if (!pipeline) {
            const shader = this.shaderManager.getShaderModule(hasTexture, true);

            const depthFormat = 'depth24plus';

            const vertexBuffers = [
                {
                    arrayStride: 12,
                    attributes: [{
                        shaderLocation: 0,
                        offset: 0,
                        format: 'float32x3',
                    }],
                },
                {
                    arrayStride: 12,
                    attributes: [{
                        shaderLocation: 1,
                        offset: 0,
                        format: 'float32x3',
                    }],
                }
            ];

            if (hasTexture) {
                vertexBuffers.push({
                    arrayStride: 8,
                    attributes: [{
                        shaderLocation: 2,
                        offset: 0,
                        format: 'float32x2',
                    }],
                });
            }

            pipeline = this.device.createRenderPipeline({
                layout: this.device.createPipelineLayout({
                    bindGroupLayouts: [bindGroupLayout]
                }),
                vertex: {
                    module: shader,
                    entryPoint: 'vertexMain',
                    buffers: vertexBuffers,
                },
                fragment: {
                    module: shader,
                    entryPoint: 'fragmentMain',
                    targets: [{
                        format: this.format,
                        blend: this.materialHelper.getBlendMode(material),
                    }],
                },
                primitive: {
                    topology: 'triangle-list',
                    cullMode: this.materialHelper.getCullMode(material),
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
     * 销毁
     */
    destroy() {
        if (this.shadowHelper) {
            this.shadowHelper.destroy();
            this.shadowHelper = null;
        }
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
