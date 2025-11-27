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
     * @param {Boolean} hasShadow - 是否包含阴影
     * @return {GPUShaderModule}
     */
    getShaderModule(hasTexture = false, hasShadow = false) {
        const texSuffix = hasTexture ? '_tex' : '';
        const shadowSuffix = hasShadow ? '_shadow' : '';
        const cacheKey = `shader${texSuffix}${shadowSuffix}`;

        if (this.shaderCache.has(cacheKey)) {
            return this.shaderCache.get(cacheKey);
        }

        let shaderCode;
        if (hasShadow) {
            shaderCode = hasTexture
                ? WebGPUShaderManager._generateTextureShadowShaderCode()
                : WebGPUShaderManager._generateShadowShaderCode();
        } else {
            shaderCode = hasTexture
                ? WebGPUShaderManager._generateTextureShaderCode()
                : WebGPUShaderManager._generateBasicShaderCode();
        }
        const shaderModule = this.device.createShaderModule({ code: shaderCode });

        this.shaderCache.set(cacheKey, shaderModule);
        return shaderModule;
    }

    /**
     * 获取或创建阴影深度shader模块
     * @return {GPUShaderModule}
     */
    getShadowDepthShaderModule() {
        const cacheKey = 'shadow_depth_shader';

        if (this.shaderCache.has(cacheKey)) {
            return this.shaderCache.get(cacheKey);
        }

        const shaderCode = WebGPUShaderManager._generateShadowDepthShaderCode();
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
     * 生成阴影深度shader代码
     * @private
     * @static
     * @return {String}
     */
    static _generateShadowDepthShaderCode() {
        return `
            struct Uniforms {
                lightSpaceMatrix: mat4x4<f32>,
                modelMatrix: mat4x4<f32>,
            }

            @binding(0) @group(0) var<uniform> uniforms: Uniforms;

            struct VertexInput {
                @location(0) position: vec3<f32>,
            }

            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
            }

            @vertex
            fn vertexMain(input: VertexInput) -> VertexOutput {
                var output: VertexOutput;
                let worldPos = uniforms.modelMatrix * vec4<f32>(input.position, 1.0);
                output.position = uniforms.lightSpaceMatrix * worldPos;
                return output;
            }

            @fragment
            fn fragmentMain() {
                // Depth is written automatically
            }
        `;
    }

    /**
     * 生成带阴影的shader代码(无纹理)
     * @private
     * @static
     * @return {String}
     */
    static _generateShadowShaderCode() {
        return `
            struct Uniforms {
                mvpMatrix: mat4x4<f32>,
                modelMatrix: mat4x4<f32>,
                normalMatrix: mat4x4<f32>,
            }

            struct ShadowUniforms {
                lightSpaceMatrix: mat4x4<f32>,
                lightDirection: vec4<f32>,
                shadowBias: f32,
                shadowMapSize: f32,
                _padding1: f32,
                _padding2: f32,
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
            @binding(2) @group(0) var<uniform> shadow: ShadowUniforms;
            @binding(3) @group(0) var shadowMap: texture_depth_2d;
            @binding(4) @group(0) var shadowSampler: sampler_comparison;

            struct VertexInput {
                @location(0) position: vec3<f32>,
                @location(1) normal: vec3<f32>,
            }

            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
                @location(0) worldPos: vec3<f32>,
                @location(1) normal: vec3<f32>,
                @location(2) shadowCoord: vec4<f32>,
            }

            @vertex
            fn vertexMain(input: VertexInput) -> VertexOutput {
                var output: VertexOutput;
                output.position = uniforms.mvpMatrix * vec4<f32>(input.position, 1.0);
                let worldPos = uniforms.modelMatrix * vec4<f32>(input.position, 1.0);
                output.worldPos = worldPos.xyz;
                output.normal = normalize((uniforms.normalMatrix * vec4<f32>(input.normal, 0.0)).xyz);
                output.shadowCoord = shadow.lightSpaceMatrix * worldPos;
                return output;
            }

            fn calculateShadow(shadowCoord: vec4<f32>, bias: f32) -> f32 {
                // Transform to shadow map space [0, 1]
                var projCoords = shadowCoord.xyz / shadowCoord.w;
                projCoords.x = projCoords.x * 0.5 + 0.5;
                projCoords.y = projCoords.y * -0.5 + 0.5;

                // Check if outside shadow map
                if (projCoords.x < 0.0 || projCoords.x > 1.0 ||
                    projCoords.y < 0.0 || projCoords.y > 1.0 ||
                    projCoords.z < 0.0 || projCoords.z > 1.0) {
                    return 1.0;
                }

                // PCF filtering
                var shadowValue: f32 = 0.0;
                let texelSize = 1.0 / shadow.shadowMapSize;

                for (var x: i32 = -1; x <= 1; x++) {
                    for (var y: i32 = -1; y <= 1; y++) {
                        let offset = vec2<f32>(f32(x), f32(y)) * texelSize;
                        shadowValue += textureSampleCompare(
                            shadowMap,
                            shadowSampler,
                            projCoords.xy + offset,
                            projCoords.z - bias
                        );
                    }
                }

                return shadowValue / 9.0;
            }

            @fragment
            fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
                let normal = normalize(input.normal);
                let lightDir = normalize(-shadow.lightDirection.xyz);
                let diffuseStrength = max(dot(normal, lightDir), 0.0);

                // Calculate shadow
                let shadowValue = calculateShadow(input.shadowCoord, shadow.shadowBias);

                let ambient = 0.3;
                let lighting = ambient + diffuseStrength * 0.7 * shadowValue;

                var color = material.diffuseColor.rgb * lighting;
                color = color + material.emissionColor.rgb;

                return vec4<f32>(color, material.diffuseColor.a * material.opacity);
            }
        `;
    }

    /**
     * 生成带阴影和纹理的shader代码
     * @private
     * @static
     * @return {String}
     */
    static _generateTextureShadowShaderCode() {
        return `
            struct Uniforms {
                mvpMatrix: mat4x4<f32>,
                modelMatrix: mat4x4<f32>,
                normalMatrix: mat4x4<f32>,
            }

            struct ShadowUniforms {
                lightSpaceMatrix: mat4x4<f32>,
                lightDirection: vec4<f32>,
                shadowBias: f32,
                shadowMapSize: f32,
                _padding1: f32,
                _padding2: f32,
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
            @binding(2) @group(0) var<uniform> shadow: ShadowUniforms;
            @binding(3) @group(0) var shadowMap: texture_depth_2d;
            @binding(4) @group(0) var shadowSampler: sampler_comparison;
            @binding(5) @group(0) var diffuseTexture: texture_2d<f32>;
            @binding(6) @group(0) var diffuseSampler: sampler;

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
                @location(3) shadowCoord: vec4<f32>,
            }

            @vertex
            fn vertexMain(input: VertexInput) -> VertexOutput {
                var output: VertexOutput;
                output.position = uniforms.mvpMatrix * vec4<f32>(input.position, 1.0);
                let worldPos = uniforms.modelMatrix * vec4<f32>(input.position, 1.0);
                output.worldPos = worldPos.xyz;
                output.normal = normalize((uniforms.normalMatrix * vec4<f32>(input.normal, 0.0)).xyz);
                output.uv = input.uv;
                output.shadowCoord = shadow.lightSpaceMatrix * worldPos;
                return output;
            }

            fn calculateShadow(shadowCoord: vec4<f32>, bias: f32) -> f32 {
                var projCoords = shadowCoord.xyz / shadowCoord.w;
                projCoords.x = projCoords.x * 0.5 + 0.5;
                projCoords.y = projCoords.y * -0.5 + 0.5;

                if (projCoords.x < 0.0 || projCoords.x > 1.0 ||
                    projCoords.y < 0.0 || projCoords.y > 1.0 ||
                    projCoords.z < 0.0 || projCoords.z > 1.0) {
                    return 1.0;
                }

                var shadowValue: f32 = 0.0;
                let texelSize = 1.0 / shadow.shadowMapSize;

                for (var x: i32 = -1; x <= 1; x++) {
                    for (var y: i32 = -1; y <= 1; y++) {
                        let offset = vec2<f32>(f32(x), f32(y)) * texelSize;
                        shadowValue += textureSampleCompare(
                            shadowMap,
                            shadowSampler,
                            projCoords.xy + offset,
                            projCoords.z - bias
                        );
                    }
                }

                return shadowValue / 9.0;
            }

            @fragment
            fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
                let texColor = textureSample(diffuseTexture, diffuseSampler, input.uv);
                let normal = normalize(input.normal);
                let lightDir = normalize(-shadow.lightDirection.xyz);
                let diffuseStrength = max(dot(normal, lightDir), 0.0);

                let shadowValue = calculateShadow(input.shadowCoord, shadow.shadowBias);

                let ambient = 0.3;
                let lighting = ambient + diffuseStrength * 0.7 * shadowValue;

                var color = texColor.rgb * material.diffuseColor.rgb * lighting;
                color = color + material.emissionColor.rgb;

                return vec4<f32>(color, texColor.a * material.diffuseColor.a * material.opacity);
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
