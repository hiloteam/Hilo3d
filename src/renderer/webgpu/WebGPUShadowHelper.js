/* global GPUTextureUsage, GPUTextureFormat */

/**
 * WebGPU阴影助手类 - 管理阴影贴图和阴影相关资源
 * @class
 */
const WebGPUShadowHelper = {
    /**
     * 创建阴影贴图纹理
     * @param {GPUDevice} device - GPU设备
     * @param {Number} size - 阴影贴图尺寸
     * @returns {GPUTexture} 阴影贴图纹理
     */
    createShadowTexture(device, size = 2048) {
        return device.createTexture({
            size: [size, size, 1],
            format: 'depth32float',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
    },

    /**
     * 创建阴影采样器
     * @param {GPUDevice} device - GPU设备
     * @returns {GPUSampler} 阴影采样器
     */
    createShadowSampler(device) {
        return device.createSampler({
            compare: 'less',
            magFilter: 'linear',
            minFilter: 'linear'
        });
    },

    /**
     * 计算光源空间矩阵
     * @param {Object} light - 光源对象
     * @param {Object} camera - 相机对象
     * @returns {Float32Array} 光源空间矩阵
     */
    calculateLightSpaceMatrix(light, camera) {
        const Matrix4 = require('../../math/Matrix4');
        const lightProjectionMatrix = new Matrix4();
        const lightViewMatrix = new Matrix4();
        
        // 使用正交投影用于方向光阴影
        lightProjectionMatrix.ortho(-10, 10, -10, 10, 0.1, 50);
        
        // 设置光源视图矩阵
        const lightPos = light.worldMatrix ? light.worldMatrix.getTranslation() : [0, 10, 0];
        const target = [0, 0, 0];
        const up = [0, 1, 0];
        lightViewMatrix.lookAt(lightPos, target, up);
        
        // 计算光源空间矩阵 (projection * view)
        const lightSpaceMatrix = new Matrix4();
        lightSpaceMatrix.multiply(lightProjectionMatrix, lightViewMatrix);
        
        return new Float32Array(lightSpaceMatrix.elements);
    },

    /**
     * 创建阴影uniform缓冲区
     * @param {GPUDevice} device - GPU设备
     * @param {Float32Array} lightSpaceMatrix - 光源空间矩阵
     * @returns {GPUBuffer} uniform缓冲区
     */
    createShadowUniformBuffer(device, lightSpaceMatrix) {
        const buffer = device.createBuffer({
            size: 64, // 4x4 matrix = 16 floats * 4 bytes
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        
        device.queue.writeBuffer(buffer, 0, lightSpaceMatrix);
        return buffer;
    },

    /**
     * 更新阴影uniform缓冲区
     * @param {GPUDevice} device - GPU设备
     * @param {GPUBuffer} buffer - uniform缓冲区
     * @param {Float32Array} lightSpaceMatrix - 光源空间矩阵
     */
    updateShadowUniformBuffer(device, buffer, lightSpaceMatrix) {
        device.queue.writeBuffer(buffer, 0, lightSpaceMatrix);
    },

    /**
     * 创建阴影渲染通道描述符
     * @param {GPUTextureView} shadowTextureView - 阴影纹理视图
     * @returns {Object} 渲染通道描述符
     */
    createShadowPassDescriptor(shadowTextureView) {
        return {
            colorAttachments: [],
            depthStencilAttachment: {
                view: shadowTextureView,
                depthClearValue: 1.0,
                depthLoadOp: 'clear',
                depthStoreOp: 'store'
            }
        };
    },

    /**
     * 获取阴影WGSL着色器代码
     * @returns {String} 阴影着色器代码
     */
    getShadowShaderCode() {
        return `
            struct Uniforms {
                lightSpaceMatrix: mat4x4<f32>,
            }
            
            struct VertexInput {
                @location(0) position: vec3<f32>,
            }
            
            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
            }
            
            @group(0) @binding(0) var<uniform> uniforms: Uniforms;
            
            @vertex
            fn vertexMain(input: VertexInput) -> VertexOutput {
                var output: VertexOutput;
                output.position = uniforms.lightSpaceMatrix * vec4<f32>(input.position, 1.0);
                return output;
            }
            
            @fragment
            fn fragmentMain() -> @builtin(frag_depth) f32 {
                return 0.0;
            }
        `;
    },

    /**
     * 创建阴影渲染管线
     * @param {GPUDevice} device - GPU设备
     * @param {GPUShaderModule} shaderModule - 着色器模块
     * @param {GPUBindGroupLayout} bindGroupLayout - 绑定组布局
     * @returns {GPURenderPipeline} 渲染管线
     */
    createShadowPipeline(device, shaderModule, bindGroupLayout) {
        const pipelineLayout = device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout]
        });
        
        return device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vertexMain',
                buffers: [{
                    arrayStride: 12, // 3 floats * 4 bytes
                    attributes: [{
                        shaderLocation: 0,
                        offset: 0,
                        format: 'float32x3'
                    }]
                }]
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fragmentMain',
                targets: []
            },
            depthStencil: {
                format: 'depth32float',
                depthWriteEnabled: true,
                depthCompare: 'less'
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'back'
            }
        });
    }
};

export default WebGPUShadowHelper;
