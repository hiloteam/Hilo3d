/**
 * WebGPU着色器管理器
 * 负责WGSL shader的创建、编译和缓存
 * @class
 */
class WebGPUShaderManager {
    /**
     * @constructs
     * @param {GPUDevice} device - WebGPU设备
     */
    constructor(device) {
        this.device = device;
        this.shaderCache = new Map();
    }

    /**
     * 获取或创建shader模块
     * @param {Boolean} hasTexture - 是否包含纹理
     * @return {GPUShaderModule}
     */
    getShaderModule(hasTexture = false) {
        const cacheKey = hasTexture ? 'shader_with_texture' : 'simple_shader';

        if (this.shaderCache.has(cacheKey)) {
            return this.shaderCache.get(cacheKey);
        }

        const shaderCode = hasTexture
            ? WebGPUShaderManager._generateTextureShaderCode()
            : WebGPUShaderManager._generateBasicShaderCode();
        const shaderModule = this.device.createShaderModule({ code: shaderCode });

        this.shaderCache.set(cacheKey, shaderModule);
        return shaderModule;
    }

    /**
     * 生成带纹理的shader代码
     * @private
     * @static
     * @return {String}
     */
    static _generateTextureShaderCode() {
        return `
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
            @binding(2) @group(0) var diffuseTexture: texture_2d<f32>;
            @binding(3) @group(0) var diffuseSampler: sampler;

            struct VertexInput {
                @location(0) position: vec3<f32>,
                @location(1) normal: vec3<f32>,
                @location(2) uv: vec2<f32>,
            }

            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
                @location(0) worldPos: vec3<f32>,
                @location(1) normal: vec3<f32>,
                @location(2) uv: vec2<f32>,
            }

            @vertex
            fn vertexMain(input: VertexInput) -> VertexOutput {
                var output: VertexOutput;
                output.position = uniforms.mvpMatrix * vec4<f32>(input.position, 1.0);
                output.worldPos = (uniforms.modelMatrix * vec4<f32>(input.position, 1.0)).xyz;
                output.normal = normalize((uniforms.normalMatrix * vec4<f32>(input.normal, 0.0)).xyz);
                output.uv = input.uv;
                return output;
            }

            @fragment
            fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
                // 采样纹理
                let texColor = textureSample(diffuseTexture, diffuseSampler, input.uv);
                
                // 简单的光照计算
                let lightDir = normalize(vec3<f32>(1.0, 1.0, 1.0));
                let normal = normalize(input.normal);
                let diffuse = max(dot(normal, lightDir), 0.0);
                
                let ambient = 0.3;
                let lighting = ambient + diffuse * 0.7;
                
                var color = texColor.rgb * material.diffuseColor.rgb * lighting;
                
                // 添加自发光
                color = color + material.emissionColor.rgb;
                
                return vec4<f32>(color, texColor.a * material.diffuseColor.a * material.opacity);
            }
        `;
    }

    /**
     * 生成基础shader代码(无纹理)
     * @private
     * @static
     * @return {String}
     */
    static _generateBasicShaderCode() {
        return `
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
    }

    /**
     * 清空shader缓存
     */
    clearCache() {
        this.shaderCache.clear();
    }
}

export default WebGPUShaderManager;
