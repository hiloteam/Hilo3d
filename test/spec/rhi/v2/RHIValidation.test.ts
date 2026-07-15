import { afterEach, describe, expect, it } from 'vitest';
import {
    RHIBufferUsage,
    RHIObjectIdAllocator,
    RHIShaderStage,
    RHITextureUsage,
    RHIValidationError,
    allocateRHIDeviceId,
    createRHIObjectIdAllocator,
    type RHIBackend,
    type RHIBindGroupLayoutEntry,
    type RHIShader,
    type RHIShaderArtifact,
    type RHIShaderArtifactInput,
    type RHIShaderReflection,
    type RHIShaderStageName,
    type RHIValidationErrorCode,
    type RHIWebGL2ShaderArtifact,
    type RHIWebGPUShaderArtifact
} from '../../../../src/render/rhi/core';
import {
    type FakeRHIBackend,
    type FakeRHIDevice,
    FakeWebGLRHIBackend,
    FakeWebGPURHIBackend
} from './FakeRHIBackend';

function expectValidation(
    action: () => unknown,
    code: RHIValidationErrorCode,
    path?: string
): RHIValidationError {
    let caught: unknown;
    try {
        action();
    } catch (error) {
        caught = error;
    }
    expect(caught).toBeInstanceOf(RHIValidationError);
    const validation = caught as RHIValidationError;
    expect(validation.code).toBe(code);
    if (path !== undefined) expect(validation.path).toBe(path);
    return validation;
}

function createShader(
    device: FakeRHIDevice,
    stage: RHIShaderStageName,
    reflection: RHIShaderReflection = { bindings: [] }
): RHIShader {
    return device.createShader({
        artifact: {
            backend: device.backend,
            stage,
            code: `valid ${stage} shader artifact`,
            entryPoint: 'main',
            reflection,
            cacheKey: stage === 'vertex' ? 1 : 2
        }
    });
}

describe('RHI v2 validation', () => {
    const backends: FakeRHIBackend[] = [];

    function createDevice(backend: RHIBackend): FakeRHIDevice {
        const instance =
            backend === 'webgl2' ? new FakeWebGLRHIBackend() : new FakeWebGPURHIBackend();
        backends.push(instance);
        return instance.createDevice();
    }

    afterEach(() => {
        for (const backend of backends) backend.destroy();
        backends.length = 0;
    });

    it('allocates global device identities and bounded device-local object identities', () => {
        const webGLDeviceId = allocateRHIDeviceId();
        const webGPUDeviceId = allocateRHIDeviceId();
        expect(webGPUDeviceId).toBe(webGLDeviceId + 1);

        const webGLObjects = createRHIObjectIdAllocator(webGLDeviceId);
        const webGPUObjects = createRHIObjectIdAllocator(webGPUDeviceId);
        expect([webGLObjects.allocate(), webGLObjects.allocate()]).toEqual([1, 2]);
        expect(webGPUObjects.allocate()).toBe(1);
        expect(webGLObjects.deviceId).toBe(webGLDeviceId);
        expect(webGPUObjects.deviceId).toBe(webGPUDeviceId);

        expect(() => new RHIObjectIdAllocator(0)).toThrow(/positive safe integer/u);
        const exhausted = new RHIObjectIdAllocator(webGLDeviceId, Number.MAX_SAFE_INTEGER);
        expect(exhausted.allocate()).toBe(Number.MAX_SAFE_INTEGER);
        expect(() => exhausted.allocate()).toThrow(/ID space is exhausted/u);
    });

    it('omits unsupported optional limits instead of representing them with zero', () => {
        const webgl = createDevice('webgl2').capabilities;
        const webgpu = createDevice('webgpu').capabilities;

        expect(webgl.limits).not.toHaveProperty('maxTextureDimension1D');
        expect(webgl.limits).not.toHaveProperty('maxStorageBuffersPerShaderStage');
        expect(webgl.limits).not.toHaveProperty('maxStorageTexturesPerShaderStage');
        expect(webgpu.limits.maxTextureDimension1D).toBeGreaterThan(0);
        expect(webgpu.limits.maxStorageBuffersPerShaderStage).toBeGreaterThan(0);
        expect(webgpu.limits.maxStorageTexturesPerShaderStage).toBeGreaterThan(0);

        for (const capabilities of [webgl, webgpu]) {
            expect(Object.values(capabilities.limits).every(limit => limit !== 0)).toBe(true);
        }
    });

    it('gates optional buffer usages and enforces allocation and initialization sizes', () => {
        const webgl = createDevice('webgl2');
        const webgpu = createDevice('webgpu');

        expectValidation(
            () => webgl.createBuffer({ size: 0, usage: RHIBufferUsage.COPY_SRC }),
            'invalid-descriptor',
            'buffer.size'
        );
        expectValidation(
            () =>
                webgl.createBuffer({
                    size: webgl.capabilities.limits.maxBufferSize + 1,
                    usage: RHIBufferUsage.COPY_SRC
                }),
            'out-of-bounds',
            'buffer.size'
        );
        expectValidation(
            () =>
                webgl.createBuffer({
                    size: 4,
                    usage: RHIBufferUsage.COPY_SRC,
                    initialData: new Uint8Array(5)
                }),
            'out-of-bounds',
            'buffer.initialData'
        );
        expect(webgl.capabilities.features.has('buffer-mapping')).toBe(true);
        webgl.createBuffer({ size: 16, usage: RHIBufferUsage.MAP_READ }).destroy();
        expectValidation(
            () => webgl.createBuffer({ size: 16, usage: RHIBufferUsage.STORAGE }),
            'unsupported-feature',
            'buffer.usage'
        );
        expectValidation(
            () =>
                webgpu.createBuffer({
                    size: 6,
                    usage: RHIBufferUsage.COPY_DST,
                    mappedAtCreation: true
                }),
            'invalid-descriptor',
            'buffer.size'
        );
        expectValidation(
            () =>
                webgpu.createBuffer({
                    size: 16,
                    usage: RHIBufferUsage.MAP_READ | RHIBufferUsage.COPY_SRC
                }),
            'invalid-descriptor',
            'buffer.usage'
        );
        expectValidation(
            () =>
                webgpu.createBuffer({
                    size: 16,
                    usage: RHIBufferUsage.MAP_WRITE | RHIBufferUsage.COPY_DST
                }),
            'invalid-descriptor',
            'buffer.usage'
        );
        expectValidation(
            () =>
                webgpu.createBuffer({
                    size: 16,
                    usage: RHIBufferUsage.MAP_READ | RHIBufferUsage.MAP_WRITE
                }),
            'invalid-descriptor',
            'buffer.usage'
        );

        expect(webgpu.createBuffer({ size: 16, usage: RHIBufferUsage.STORAGE }).usage).toBe(
            RHIBufferUsage.STORAGE
        );
        expect(
            webgpu.createBuffer({
                size: 16,
                usage: RHIBufferUsage.MAP_READ | RHIBufferUsage.COPY_DST
            }).usage
        ).toBe(RHIBufferUsage.MAP_READ | RHIBufferUsage.COPY_DST);
    });

    it('uses one aligned active range for buffer mapping and mapped views', async () => {
        const device = createDevice('webgpu');
        const buffer = device.createBuffer({
            size: 16,
            usage: RHIBufferUsage.MAP_READ | RHIBufferUsage.COPY_DST,
            initialData: new Uint8Array(16).map((_value, index) => index)
        });

        await expect(buffer.mapAsync('read', 4, 4)).rejects.toMatchObject({
            code: 'invalid-descriptor',
            path: 'buffer.map.offset'
        });
        await expect(buffer.mapAsync('read', 8, 6)).rejects.toMatchObject({
            code: 'invalid-descriptor',
            path: 'buffer.map.size'
        });
        await buffer.mapAsync('read', 8, 8);
        expect(() => buffer.getMappedRange()).toThrow(
            expect.objectContaining({ code: 'out-of-bounds' })
        );
        expect([...new Uint8Array(buffer.getMappedRange(8, 8))]).toEqual([
            8, 9, 10, 11, 12, 13, 14, 15
        ]);
        expect(() => buffer.getMappedRange(8, 6)).toThrow(
            expect.objectContaining({ code: 'invalid-descriptor' })
        );
        buffer.unmap();
    });

    it('gates 1D and storage textures by feature, dimensions, and format support', () => {
        const webgl = createDevice('webgl2');
        const webgpu = createDevice('webgpu');

        expectValidation(
            () =>
                webgl.createTexture({
                    size: { width: 16 },
                    dimension: '1d',
                    format: 'rgba8unorm',
                    usage: RHITextureUsage.TEXTURE_BINDING
                }),
            'unsupported-feature',
            'texture.dimension'
        );
        expectValidation(
            () =>
                webgl.createTexture({
                    size: { width: 4, height: 4 },
                    format: 'rgba8unorm',
                    usage: RHITextureUsage.STORAGE_BINDING
                }),
            'unsupported-feature',
            'texture.usage'
        );
        expectValidation(
            () =>
                webgpu.createTexture({
                    size: { width: 16, height: 2 },
                    dimension: '1d',
                    format: 'rgba8unorm',
                    usage: RHITextureUsage.TEXTURE_BINDING
                }),
            'invalid-descriptor',
            'texture.size'
        );
        expectValidation(
            () =>
                webgpu.createTexture({
                    size: { width: 4, height: 4 },
                    format: 'bc1-rgba-unorm',
                    usage: RHITextureUsage.STORAGE_BINDING
                }),
            'unsupported-format',
            'texture.format'
        );

        expect(
            webgpu.createTexture({
                size: { width: 16 },
                dimension: '1d',
                format: 'rgba8unorm',
                usage: RHITextureUsage.TEXTURE_BINDING
            }).dimension
        ).toBe('1d');
        expect(
            webgpu.createTexture({
                size: { width: 4, height: 4 },
                format: 'rgba8unorm',
                usage: RHITextureUsage.STORAGE_BINDING
            }).usage
        ).toBe(RHITextureUsage.STORAGE_BINDING);
    });

    it('validates texture sample counts and view ranges', () => {
        const device = createDevice('webgpu');

        expectValidation(
            () =>
                device.createTexture({
                    size: { width: 8, height: 8 },
                    sampleCount: 2,
                    format: 'rgba8unorm',
                    usage: RHITextureUsage.RENDER_ATTACHMENT
                }),
            'unsupported-format',
            'texture.sampleCount'
        );
        expectValidation(
            () =>
                device.createTexture({
                    size: { width: 8, height: 8 },
                    mipLevelCount: 2,
                    sampleCount: 4,
                    format: 'rgba8unorm',
                    usage: RHITextureUsage.RENDER_ATTACHMENT
                }),
            'invalid-descriptor',
            'texture.mipLevelCount'
        );
        expectValidation(
            () =>
                device.createTexture({
                    size: { width: 8, height: 8 },
                    sampleCount: 4,
                    format: 'rgba8unorm',
                    usage: RHITextureUsage.TEXTURE_BINDING
                }),
            'invalid-descriptor',
            'texture.usage'
        );

        const texture = device.createTexture({
            size: { width: 8, height: 8, depthOrArrayLayers: 6 },
            mipLevelCount: 3,
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        expectValidation(
            () => texture.createView({ baseMipLevel: 2, mipLevelCount: 2 }),
            'out-of-bounds',
            'textureView.mipLevelCount'
        );
        expectValidation(
            () => texture.createView({ baseArrayLayer: 5, arrayLayerCount: 2 }),
            'out-of-bounds',
            'textureView.arrayLayerCount'
        );
        expect(texture.descriptor.viewDimension).toBe('2d-array');
        expect(
            texture.createView({ baseArrayLayer: 2, arrayLayerCount: 1 }).descriptor
        ).toMatchObject({
            dimension: '2d-array',
            baseArrayLayer: 2,
            arrayLayerCount: 1
        });
    });

    it('fixes cube dimensions at creation and gates cube-map arrays', () => {
        const webgl = createDevice('webgl2');
        const webgpu = createDevice('webgpu');
        expect(webgl.capabilities.features.has('cube-map-arrays')).toBe(false);
        expect(webgpu.capabilities.features.has('cube-map-arrays')).toBe(true);

        const cube = webgl.createTexture({
            size: { width: 16, height: 16, depthOrArrayLayers: 6 },
            mipLevelCount: 3,
            viewDimension: 'cube',
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING | RHITextureUsage.RENDER_ATTACHMENT
        });
        expect(cube.descriptor.viewDimension).toBe('cube');
        expect(Object.isFrozen(cube.descriptor)).toBe(true);
        expect(Object.isFrozen(cube.descriptor.size)).toBe(true);
        expect(cube.createView({ baseMipLevel: 1, mipLevelCount: 1 }).descriptor).toMatchObject({
            dimension: 'cube',
            baseMipLevel: 1,
            mipLevelCount: 1,
            arrayLayerCount: 6
        });
        const cubeFace = cube.createView({
            dimension: '2d',
            baseArrayLayer: 3,
            arrayLayerCount: 1
        });
        expect(cubeFace.descriptor).toMatchObject({
            dimension: '2d',
            baseArrayLayer: 3,
            arrayLayerCount: 1
        });
        const faceContext = webgl.graphicsQueue.beginFrame();
        const facePass = faceContext.beginRenderPass({
            colorAttachments: [{ view: cubeFace, loadOp: 'load', storeOp: 'store' }]
        });
        facePass.end();
        webgl.graphicsQueue.abortFrame(faceContext);

        const cubeArrayTexture = webgpu.createTexture({
            size: { width: 16, height: 16, depthOrArrayLayers: 12 },
            viewDimension: 'cube-array',
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        expect(
            cubeArrayTexture.createView({ baseArrayLayer: 6, arrayLayerCount: 6 }).descriptor
        ).toMatchObject({
            dimension: 'cube-array',
            baseArrayLayer: 6,
            arrayLayerCount: 6
        });
        expect(
            cubeArrayTexture.createView({
                dimension: 'cube',
                baseArrayLayer: 6,
                arrayLayerCount: 6
            }).dimension
        ).toBe('cube');
        expect(
            cubeArrayTexture.createView({
                dimension: '2d',
                baseArrayLayer: 7,
                arrayLayerCount: 1
            }).dimension
        ).toBe('2d');
        expect(
            cubeArrayTexture.createView({
                dimension: '2d-array',
                baseArrayLayer: 5,
                arrayLayerCount: 3
            }).dimension
        ).toBe('2d-array');
        expectValidation(
            () =>
                cubeArrayTexture.createView({
                    dimension: 'cube',
                    baseArrayLayer: 1,
                    arrayLayerCount: 6
                }),
            'invalid-descriptor',
            'textureView.baseArrayLayer'
        );

        expectValidation(
            () =>
                webgl.createTexture({
                    size: { width: 16, height: 16, depthOrArrayLayers: 12 },
                    viewDimension: 'cube-array',
                    format: 'rgba8unorm',
                    usage: RHITextureUsage.TEXTURE_BINDING
                }),
            'unsupported-feature',
            'texture.viewDimension'
        );
        expectValidation(
            () =>
                webgpu.createTexture({
                    size: { width: 16, height: 8, depthOrArrayLayers: 6 },
                    viewDimension: 'cube',
                    format: 'rgba8unorm',
                    usage: RHITextureUsage.TEXTURE_BINDING
                }),
            'invalid-descriptor',
            'texture.size'
        );
        expectValidation(
            () =>
                webgpu.createTexture({
                    size: { width: 16, height: 16, depthOrArrayLayers: 12 },
                    viewDimension: 'cube',
                    format: 'rgba8unorm',
                    usage: RHITextureUsage.TEXTURE_BINDING
                }),
            'invalid-descriptor',
            'texture.size.depthOrArrayLayers'
        );
        expectValidation(
            () =>
                webgpu.createTexture({
                    size: { width: 16, height: 16, depthOrArrayLayers: 7 },
                    viewDimension: 'cube-array',
                    format: 'rgba8unorm',
                    usage: RHITextureUsage.TEXTURE_BINDING
                }),
            'invalid-descriptor',
            'texture.size.depthOrArrayLayers'
        );
        expectValidation(
            () =>
                webgpu.createTexture({
                    size: { width: 8, height: 8, depthOrArrayLayers: 6 },
                    dimension: '3d',
                    viewDimension: 'cube',
                    format: 'rgba8unorm',
                    usage: RHITextureUsage.TEXTURE_BINDING
                }),
            'invalid-descriptor',
            'texture.viewDimension'
        );

        const ordinaryArray = webgpu.createTexture({
            size: { width: 8, height: 8, depthOrArrayLayers: 6 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        expectValidation(
            () => ordinaryArray.createView({ dimension: 'cube' }),
            'invalid-descriptor',
            'textureView.dimension'
        );
        expectValidation(
            () => cube.createView({ dimension: '2d-array' }),
            'invalid-descriptor',
            'textureView.dimension'
        );
    });

    it('enforces view-format compatibility and strict texture-view dimensions', () => {
        const device = createDevice('webgpu');
        const textureDescriptor = {
            size: { width: 8, height: 8 },
            format: 'rgba8unorm' as const,
            usage: RHITextureUsage.TEXTURE_BINDING
        };

        for (const viewFormat of ['depth24plus', 'rgba8uint', 'rgba16float'] as const) {
            expectValidation(
                () => device.createTexture({ ...textureDescriptor, viewFormats: [viewFormat] }),
                'invalid-descriptor',
                'texture.viewFormats[0]'
            );
        }
        const srgbTexture = device.createTexture({
            ...textureDescriptor,
            viewFormats: ['rgba8unorm-srgb']
        });
        expect(srgbTexture.createView({ format: 'rgba8unorm-srgb' }).format).toBe(
            'rgba8unorm-srgb'
        );

        const arrayTexture = device.createTexture({
            ...textureDescriptor,
            size: { width: 8, height: 8, depthOrArrayLayers: 2 }
        });
        expect(arrayTexture.descriptor.viewDimension).toBe('2d-array');
        expectValidation(
            () => arrayTexture.createView({ dimension: '2d', arrayLayerCount: 2 }),
            'invalid-descriptor',
            'textureView'
        );
        expect(
            arrayTexture.createView({
                dimension: '2d',
                baseArrayLayer: 1,
                arrayLayerCount: 1
            }).dimension
        ).toBe('2d');

        const oneDimensional = device.createTexture({
            size: { width: 8 },
            dimension: '1d',
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        expect(oneDimensional.descriptor.viewDimension).toBe('1d');
        expectValidation(
            () => oneDimensional.createView({ dimension: '2d' }),
            'invalid-descriptor',
            'textureView.dimension'
        );

        const threeDimensional = device.createTexture({
            size: { width: 8, height: 8, depthOrArrayLayers: 4 },
            dimension: '3d',
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        expect(threeDimensional.descriptor.viewDimension).toBe('3d');
        expect(threeDimensional.createView().descriptor.arrayLayerCount).toBe(1);
        expectValidation(
            () =>
                threeDimensional.createView({
                    baseArrayLayer: 1,
                    arrayLayerCount: 1
                }),
            'invalid-descriptor',
            'textureView'
        );

        expectValidation(
            () =>
                device.createTexture({
                    size: { width: 8, height: 8, depthOrArrayLayers: 2 },
                    sampleCount: 4,
                    format: 'rgba8unorm',
                    usage: RHITextureUsage.RENDER_ATTACHMENT
                }),
            'invalid-descriptor',
            'texture.size.depthOrArrayLayers'
        );
        const multisampled = device.createTexture({
            size: { width: 8, height: 8 },
            sampleCount: 4,
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        expectValidation(
            () => multisampled.createView({ dimension: '2d-array' }),
            'invalid-descriptor',
            'textureView.dimension'
        );
    });

    it('rejects foreign shader artifacts and normalizes WGSL code to string', () => {
        const webgl = createDevice('webgl2');
        const foreignArtifact: RHIShaderArtifact = {
            backend: 'webgpu',
            stage: 'vertex',
            code: 'valid shader artifact',
            entryPoint: 'main',
            reflection: { bindings: [] },
            cacheKey: 1
        };
        expectValidation(
            () => webgl.createShader({ artifact: foreignArtifact }),
            'invalid-descriptor',
            'shader.artifact.backend'
        );

        const webgpu = createDevice('webgpu');
        const code = 'original WGSL shader artifact';
        const reflectedBinding = {
            group: 0,
            binding: 1,
            kind: 'uniform-buffer' as const,
            name: 'original'
        };
        const bindings = [reflectedBinding];
        const vertexInput = { location: 2, name: 'position' };
        const vertexInputs = [vertexInput];
        const artifact = {
            backend: 'webgpu',
            stage: 'vertex',
            code,
            entryPoint: 'main',
            reflection: { bindings, vertexInputs },
            cacheKey: 2
        } satisfies RHIWebGPUShaderArtifact;
        const shader = webgpu.createShader({ artifact });

        reflectedBinding.name = 'mutated';
        bindings.push({
            group: 0,
            binding: 2,
            kind: 'uniform-buffer',
            name: 'late'
        });
        vertexInput.location = 7;

        if (shader.artifact.backend !== 'webgpu') {
            throw new Error('expected a normalized WebGPU shader artifact');
        }
        const normalizedCode: string = shader.artifact.code;
        expect(normalizedCode).toBe('original WGSL shader artifact');
        expect(shader.artifact.reflection.bindings).toEqual([
            { group: 0, binding: 1, kind: 'uniform-buffer', name: 'original' }
        ]);
        expect(shader.artifact.reflection.vertexInputs).toEqual([
            { location: 2, name: 'position' }
        ]);
        expect(Object.isFrozen(shader.artifact)).toBe(true);
        expect(Object.isFrozen(shader.artifact.reflection.bindings[0])).toBe(true);
    });

    it('snapshots and deeply freezes WebGL2 prepared uniform and combined-sampler mappings', () => {
        const device = createDevice('webgl2');
        const uniformBlock = { name: 'CameraBlock', group: 0, binding: 0 };
        const combinedSampler = {
            name: 'baseColorTexture',
            group: 1,
            textureBinding: 2,
            samplerBinding: 3,
            arrayIndex: 0
        };
        const uniformBlocks = [uniformBlock];
        const combinedSamplers = [combinedSampler];
        const artifact: RHIWebGL2ShaderArtifact = {
            backend: 'webgl2',
            stage: 'fragment',
            code: '#version 300 es\nvoid main() {}',
            entryPoint: 'main',
            reflection: {
                bindings: [
                    { group: 0, binding: 0, kind: 'uniform-buffer' },
                    { group: 1, binding: 2, kind: 'sampled-texture' },
                    { group: 1, binding: 3, kind: 'sampler' }
                ]
            },
            preparedBindings: { uniformBlocks, combinedSamplers },
            cacheKey: 3
        };
        const shader = device.createShader({ artifact });

        uniformBlock.name = 'mutatedBlock';
        combinedSampler.arrayIndex = 7;
        uniformBlocks.push({ name: 'LateBlock', group: 2, binding: 0 });
        combinedSamplers.push({
            name: 'lateSampler',
            group: 2,
            textureBinding: 1,
            samplerBinding: 2,
            arrayIndex: 0
        });

        if (shader.artifact.backend !== 'webgl2') {
            throw new Error('expected a normalized WebGL2 shader artifact');
        }
        expect(shader.artifact.preparedBindings).toEqual({
            uniformBlocks: [{ name: 'CameraBlock', group: 0, binding: 0 }],
            combinedSamplers: [
                {
                    name: 'baseColorTexture',
                    group: 1,
                    textureBinding: 2,
                    samplerBinding: 3,
                    arrayIndex: 0
                }
            ]
        });
        const prepared = shader.artifact.preparedBindings;
        expect(Object.isFrozen(prepared)).toBe(true);
        expect(Object.isFrozen(prepared?.uniformBlocks)).toBe(true);
        expect(Object.isFrozen(prepared?.uniformBlocks?.[0])).toBe(true);
        expect(Object.isFrozen(prepared?.combinedSamplers)).toBe(true);
        expect(Object.isFrozen(prepared?.combinedSamplers?.[0])).toBe(true);
    });

    it('validates reflected sampler-array indices and prepared element consistency', () => {
        const webgpu = createDevice('webgpu');
        expectValidation(
            () =>
                createShader(webgpu, 'fragment', {
                    bindings: [
                        {
                            group: 0,
                            binding: 0,
                            kind: 'sampled-texture',
                            name: 'maps',
                            arrayIndex: -1
                        }
                    ]
                }),
            'invalid-descriptor',
            'shader.artifact.reflection.bindings[0].arrayIndex'
        );
        expectValidation(
            () =>
                createShader(webgpu, 'vertex', {
                    bindings: [
                        {
                            group: 0,
                            binding: 0,
                            kind: 'uniform-buffer',
                            name: 'CameraBlock',
                            arrayIndex: 0
                        }
                    ]
                }),
            'invalid-descriptor',
            'shader.artifact.reflection.bindings[0].arrayIndex'
        );

        const webgl = createDevice('webgl2');
        const artifact = (
            textureArrayIndex: number,
            samplerArrayIndex: number,
            preparedArrayIndex: number
        ): RHIWebGL2ShaderArtifact => ({
            backend: 'webgl2',
            stage: 'fragment',
            code: 'valid GLSL artifact',
            entryPoint: 'main',
            reflection: {
                bindings: [
                    {
                        group: 0,
                        binding: 0,
                        kind: 'sampled-texture',
                        name: 'maps',
                        arrayIndex: textureArrayIndex
                    },
                    {
                        group: 0,
                        binding: 1,
                        kind: 'sampler',
                        name: 'maps',
                        arrayIndex: samplerArrayIndex
                    }
                ]
            },
            preparedBindings: {
                combinedSamplers: [
                    {
                        name: 'maps',
                        group: 0,
                        textureBinding: 0,
                        samplerBinding: 1,
                        arrayIndex: preparedArrayIndex
                    }
                ]
            },
            cacheKey: 4
        });

        const indexed = webgl.createShader({ artifact: artifact(1, 1, 1) });
        expect(indexed.artifact.reflection.bindings.map(binding => binding.arrayIndex)).toEqual([
            1, 1
        ]);
        expectValidation(
            () => webgl.createShader({ artifact: artifact(1, 0, 0) }),
            'invalid-descriptor',
            'shader.artifact.preparedBindings.combinedSamplers[0].arrayIndex'
        );
        expectValidation(
            () => webgl.createShader({ artifact: artifact(0, 1, 0) }),
            'invalid-descriptor',
            'shader.artifact.preparedBindings.combinedSamplers[0].arrayIndex'
        );
    });

    it('rejects backend-incompatible, duplicate, and dangling prepared shader mappings', () => {
        const webgpu = createDevice('webgpu');
        const binaryWebGPUInput: RHIShaderArtifactInput = {
            backend: 'webgpu',
            stage: 'vertex',
            code: new Uint32Array([1]),
            entryPoint: 'main',
            reflection: { bindings: [] },
            cacheKey: 1
        };
        expectValidation(
            () => webgpu.createShader({ artifact: binaryWebGPUInput }),
            'invalid-descriptor',
            'shader.artifact.code'
        );
        expectValidation(
            () =>
                webgpu.createShader({
                    artifact: {
                        backend: 'webgpu',
                        stage: 'vertex',
                        code: 'valid WGSL artifact',
                        entryPoint: 'main',
                        reflection: { bindings: [] },
                        preparedBindings: {},
                        cacheKey: 1
                    }
                }),
            'invalid-descriptor',
            'shader.artifact.preparedBindings'
        );

        const webgl = createDevice('webgl2');
        expectValidation(
            () =>
                webgl.createShader({
                    artifact: {
                        backend: 'webgl2',
                        stage: 'vertex',
                        code: new Uint32Array([1]),
                        entryPoint: 'main',
                        reflection: { bindings: [] },
                        cacheKey: 1
                    }
                }),
            'invalid-descriptor',
            'shader.artifact.code'
        );

        const reflection: RHIShaderReflection = {
            bindings: [
                { group: 0, binding: 0, kind: 'uniform-buffer' },
                { group: 0, binding: 1, kind: 'sampled-texture' },
                { group: 0, binding: 2, kind: 'sampler' }
            ]
        };
        const createPreparedShader = (
            preparedBindings: NonNullable<RHIWebGL2ShaderArtifact['preparedBindings']>
        ): RHIShader =>
            webgl.createShader({
                artifact: {
                    backend: 'webgl2',
                    stage: 'fragment',
                    code: 'valid GLSL artifact',
                    entryPoint: 'main',
                    reflection,
                    preparedBindings,
                    cacheKey: 2
                }
            });

        expectValidation(
            () =>
                createPreparedShader({
                    uniformBlocks: [{ name: '  ', group: 0, binding: 0 }]
                }),
            'invalid-descriptor',
            'shader.artifact.preparedBindings.uniformBlocks[0].name'
        );
        expectValidation(
            () =>
                createPreparedShader({
                    uniformBlocks: [
                        { name: 'CameraBlock', group: 0, binding: 0 },
                        { name: 'CameraBlock', group: 1, binding: 0 }
                    ]
                }),
            'invalid-descriptor',
            'shader.artifact.preparedBindings.uniformBlocks[1].name'
        );
        expectValidation(
            () =>
                createPreparedShader({
                    uniformBlocks: [
                        { name: 'CameraBlock', group: 0, binding: 0 },
                        { name: 'CameraAlias', group: 0, binding: 0 }
                    ]
                }),
            'invalid-descriptor',
            'shader.artifact.preparedBindings.uniformBlocks[1].binding'
        );
        expectValidation(
            () =>
                createPreparedShader({
                    uniformBlocks: [{ name: 'WrongKind', group: 0, binding: 1 }]
                }),
            'invalid-descriptor',
            'shader.artifact.preparedBindings.uniformBlocks[0]'
        );
        expectValidation(
            () =>
                createPreparedShader({
                    combinedSamplers: [
                        {
                            name: 'sameBinding',
                            group: 0,
                            textureBinding: 1,
                            samplerBinding: 1,
                            arrayIndex: 0
                        }
                    ]
                }),
            'invalid-descriptor',
            'shader.artifact.preparedBindings.combinedSamplers[0].samplerBinding'
        );
        expectValidation(
            () =>
                createPreparedShader({
                    combinedSamplers: [
                        {
                            name: 'wrongTexture',
                            group: 0,
                            textureBinding: 0,
                            samplerBinding: 2,
                            arrayIndex: 0
                        }
                    ]
                }),
            'invalid-descriptor',
            'shader.artifact.preparedBindings.combinedSamplers[0].textureBinding'
        );
        expectValidation(
            () =>
                createPreparedShader({
                    combinedSamplers: [
                        {
                            name: 'missingSampler',
                            group: 0,
                            textureBinding: 1,
                            samplerBinding: 9,
                            arrayIndex: 0
                        }
                    ]
                }),
            'invalid-descriptor',
            'shader.artifact.preparedBindings.combinedSamplers[0].samplerBinding'
        );
        expectValidation(
            () =>
                createPreparedShader({
                    combinedSamplers: [
                        {
                            name: 'duplicate',
                            group: 0,
                            textureBinding: 1,
                            samplerBinding: 2,
                            arrayIndex: 0
                        },
                        {
                            name: 'duplicate',
                            group: 0,
                            textureBinding: 1,
                            samplerBinding: 2,
                            arrayIndex: 0
                        }
                    ]
                }),
            'invalid-descriptor',
            'shader.artifact.preparedBindings.combinedSamplers[1]'
        );
        expectValidation(
            () =>
                createPreparedShader({
                    combinedSamplers: [
                        {
                            name: 'unsafeIndex',
                            group: 0,
                            textureBinding: 1,
                            samplerBinding: 2,
                            arrayIndex: Number.MAX_SAFE_INTEGER + 1
                        }
                    ]
                }),
            'invalid-descriptor',
            'shader.artifact.preparedBindings.combinedSamplers[0].arrayIndex'
        );
    });

    it('validates reflected minimum binding sizes before snapshotting shaders', () => {
        const device = createDevice('webgpu');
        const path = 'shader.artifact.reflection.bindings[0].minBindingSize';

        for (const minBindingSize of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
            expectValidation(
                () =>
                    createShader(device, 'vertex', {
                        bindings: [
                            {
                                group: 0,
                                binding: 0,
                                kind: 'uniform-buffer',
                                minBindingSize
                            }
                        ]
                    }),
                'invalid-descriptor',
                path
            );
        }

        expectValidation(
            () =>
                createShader(device, 'vertex', {
                    bindings: [
                        {
                            group: 0,
                            binding: 0,
                            kind: 'sampled-texture',
                            minBindingSize: 0
                        }
                    ]
                }),
            'invalid-descriptor',
            path
        );
    });

    it('requires one layout resource kind and unique binding numbers', () => {
        const device = createDevice('webgpu');

        expectValidation(
            () =>
                device.createBindGroupLayout({
                    entries: [{ binding: 0, visibility: RHIShaderStage.VERTEX }]
                }),
            'invalid-descriptor',
            'bindGroupLayout.entries[0]'
        );
        expectValidation(
            () =>
                device.createBindGroupLayout({
                    entries: [
                        {
                            binding: 0,
                            visibility: RHIShaderStage.VERTEX,
                            buffer: {},
                            sampler: {}
                        }
                    ]
                }),
            'invalid-descriptor',
            'bindGroupLayout.entries[0]'
        );
        expectValidation(
            () =>
                device.createBindGroupLayout({
                    entries: [
                        { binding: 1, visibility: RHIShaderStage.VERTEX, buffer: {} },
                        { binding: 1, visibility: RHIShaderStage.FRAGMENT, sampler: {} }
                    ]
                }),
            'invalid-descriptor',
            'bindGroupLayout.entries[1].binding'
        );
    });

    it('matches bind-group resource kind, usage, and minimum buffer size to its layout', () => {
        const device = createDevice('webgpu');
        const layout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: RHIShaderStage.VERTEX,
                    buffer: { type: 'uniform', minBindingSize: 32 }
                }
            ]
        });

        expectValidation(
            () =>
                device.createBindGroup({
                    layout,
                    entries: [{ binding: 0, resource: device.createSampler() }]
                }),
            'incompatible-layout',
            'bindGroup.entries[0].resource'
        );
        const wrongUsage = device.createBuffer({
            size: 64,
            usage: RHIBufferUsage.COPY_DST
        });
        expectValidation(
            () =>
                device.createBindGroup({
                    layout,
                    entries: [{ binding: 0, resource: { buffer: wrongUsage } }]
                }),
            'incompatible-layout',
            'bindGroup.entries[0].resource.buffer'
        );
        const tooSmall = device.createBuffer({
            size: 64,
            usage: RHIBufferUsage.UNIFORM
        });
        expectValidation(
            () =>
                device.createBindGroup({
                    layout,
                    entries: [{ binding: 0, resource: { buffer: tooSmall, size: 16 } }]
                }),
            'incompatible-layout',
            'bindGroup.entries[0].resource.size'
        );
    });

    it('matches texture sample types and sampler filtering capability to bindings', () => {
        const device = createDevice('webgpu');
        const uintLayout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: RHIShaderStage.FRAGMENT,
                    texture: { sampleType: 'uint' }
                }
            ]
        });
        const normalizedTexture = device.createTexture({
            size: { width: 4, height: 4 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        expectValidation(
            () =>
                device.createBindGroup({
                    layout: uintLayout,
                    entries: [{ binding: 0, resource: normalizedTexture.createView() }]
                }),
            'incompatible-layout',
            'bindGroup.entries[0].resource'
        );

        const uintTexture = device.createTexture({
            size: { width: 4, height: 4 },
            format: 'rgba8uint',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        expect(
            device.createBindGroup({
                layout: uintLayout,
                entries: [{ binding: 0, resource: uintTexture.createView() }]
            }).entries
        ).toHaveLength(1);

        const nonFilteringLayout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: RHIShaderStage.FRAGMENT,
                    sampler: { type: 'non-filtering' }
                }
            ]
        });
        expectValidation(
            () =>
                device.createBindGroup({
                    layout: nonFilteringLayout,
                    entries: [
                        {
                            binding: 0,
                            resource: device.createSampler({ minFilter: 'linear' })
                        }
                    ]
                }),
            'incompatible-layout',
            'bindGroup.entries[0].resource'
        );
        expect(
            device.createBindGroup({
                layout: nonFilteringLayout,
                entries: [{ binding: 0, resource: device.createSampler() }]
            }).entries
        ).toHaveLength(1);
    });

    it('applies typed binding limits independently to vertex and fragment stages', () => {
        const device = createDevice('webgpu');
        const limits = device.capabilities.limits;
        const cases: readonly {
            limit: number;
            entry(binding: number): RHIBindGroupLayoutEntry;
        }[] = [
            {
                limit: limits.maxSampledTexturesPerShaderStage,
                entry: binding => ({
                    binding,
                    visibility: RHIShaderStage.VERTEX,
                    texture: {}
                })
            },
            {
                limit: limits.maxSamplersPerShaderStage,
                entry: binding => ({
                    binding,
                    visibility: RHIShaderStage.VERTEX,
                    sampler: {}
                })
            },
            {
                limit: limits.maxUniformBuffersPerShaderStage,
                entry: binding => ({
                    binding,
                    visibility: RHIShaderStage.VERTEX,
                    buffer: {}
                })
            },
            {
                limit: limits.maxStorageBuffersPerShaderStage ?? 0,
                entry: binding => ({
                    binding,
                    visibility: RHIShaderStage.VERTEX,
                    buffer: { type: 'storage' }
                })
            },
            {
                limit: limits.maxStorageTexturesPerShaderStage ?? 0,
                entry: binding => ({
                    binding,
                    visibility: RHIShaderStage.VERTEX,
                    storageTexture: {
                        access: 'write-only',
                        format: 'rgba8unorm'
                    }
                })
            }
        ];

        for (const testCase of cases) {
            const layout = device.createBindGroupLayout({
                entries: Array.from({ length: testCase.limit + 1 }, (_, binding) =>
                    testCase.entry(binding)
                )
            });
            expectValidation(
                () => device.createPipelineLayout({ bindGroupLayouts: [layout] }),
                'out-of-bounds',
                'pipelineLayout.bindGroupLayouts'
            );
        }

        const sampledLimit = limits.maxSampledTexturesPerShaderStage;
        const splitStages = device.createBindGroupLayout({
            entries: Array.from({ length: sampledLimit * 2 }, (_, binding) => ({
                binding,
                visibility:
                    binding < sampledLimit ? RHIShaderStage.VERTEX : RHIShaderStage.FRAGMENT,
                texture: {}
            }))
        });
        expect(
            device.createPipelineLayout({ bindGroupLayouts: [splitStages] }).bindGroupLayouts
        ).toHaveLength(1);
    });

    it('matches pipeline shader reflection and gates color target formats', () => {
        const device = createDevice('webgpu');
        const wrongKind = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: RHIShaderStage.VERTEX,
                    sampler: {}
                }
            ]
        });
        const wrongVisibility = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: RHIShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' }
                }
            ]
        });
        const shader = createShader(device, 'vertex', {
            bindings: [{ group: 0, binding: 0, kind: 'uniform-buffer' }]
        });

        expectValidation(
            () =>
                device.createGraphicsPipeline({
                    layout: device.createPipelineLayout({ bindGroupLayouts: [wrongKind] }),
                    vertex: { shader },
                    primitive: {}
                }),
            'incompatible-layout',
            'graphicsPipeline.vertex.shader.artifact.reflection.bindings[0]'
        );
        expectValidation(
            () =>
                device.createGraphicsPipeline({
                    layout: device.createPipelineLayout({ bindGroupLayouts: [wrongVisibility] }),
                    vertex: { shader },
                    primitive: {}
                }),
            'incompatible-layout',
            'graphicsPipeline.vertex.shader.artifact.reflection.bindings[0]'
        );
        const layout = device.createPipelineLayout({ bindGroupLayouts: [] });
        const vertexShader = createShader(device, 'vertex');
        const fragmentShader = createShader(device, 'fragment');

        expectValidation(
            () =>
                device.createGraphicsPipeline({
                    layout,
                    vertex: { shader: vertexShader },
                    fragment: {
                        shader: fragmentShader,
                        targets: [{ format: 'bc1-rgba-unorm' }]
                    },
                    primitive: {}
                }),
            'unsupported-format',
            'graphicsPipeline.fragment.targets[0].format'
        );
    });

    it('requires pipeline layouts to cover reflected buffer binding sizes', () => {
        const device = createDevice('webgpu');
        const shader = createShader(device, 'vertex', {
            bindings: [
                {
                    group: 0,
                    binding: 0,
                    kind: 'uniform-buffer',
                    minBindingSize: 64
                }
            ]
        });
        const reflectedPath = 'graphicsPipeline.vertex.shader.artifact.reflection.bindings[0]';
        const tooSmallLayout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: RHIShaderStage.VERTEX,
                    buffer: { type: 'uniform', minBindingSize: 32 }
                }
            ]
        });

        expectValidation(
            () =>
                device.createGraphicsPipeline({
                    layout: device.createPipelineLayout({
                        bindGroupLayouts: [tooSmallLayout]
                    }),
                    vertex: { shader },
                    primitive: {}
                }),
            'incompatible-layout',
            reflectedPath
        );

        const compatibleLayout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: RHIShaderStage.VERTEX,
                    buffer: { type: 'uniform', minBindingSize: 64 }
                }
            ]
        });
        expect(
            device
                .createGraphicsPipeline({
                    layout: device.createPipelineLayout({ bindGroupLayouts: [compatibleLayout] }),
                    vertex: { shader },
                    primitive: {}
                })
                .getBindGroupLayout(0)
        ).toBe(compatibleLayout);

        const buffer = device.createBuffer({
            size: 64,
            usage: RHIBufferUsage.UNIFORM
        });
        expectValidation(
            () =>
                device.createBindGroup({
                    layout: compatibleLayout,
                    entries: [{ binding: 0, resource: { buffer, size: 32 } }]
                }),
            'incompatible-layout',
            'bindGroup.entries[0].resource.size'
        );
    });

    it('rejects invalid render-pass resolve sources, formats, and extents', () => {
        const device = createDevice('webgpu');
        const singleSampled = device.createTexture({
            size: { width: 8, height: 8 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const multisampled = device.createTexture({
            size: { width: 8, height: 8 },
            sampleCount: 4,
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const validResolve = device.createTexture({
            size: { width: 8, height: 8 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const wrongFormat = device.createTexture({
            size: { width: 8, height: 8 },
            format: 'bgra8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const wrongExtent = device.createTexture({
            size: { width: 4, height: 8 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const context = device.graphicsQueue.beginFrame();

        expectValidation(
            () =>
                context.beginRenderPass({
                    colorAttachments: [
                        {
                            view: singleSampled.createView(),
                            resolveTarget: validResolve.createView(),
                            loadOp: 'load',
                            storeOp: 'store'
                        }
                    ]
                }),
            'invalid-descriptor',
            'renderPass.colorAttachments[0].resolveTarget'
        );
        expectValidation(
            () =>
                context.beginRenderPass({
                    colorAttachments: [
                        {
                            view: multisampled.createView(),
                            resolveTarget: wrongFormat.createView(),
                            loadOp: 'load',
                            storeOp: 'store'
                        }
                    ]
                }),
            'invalid-descriptor',
            'renderPass.colorAttachments[0].resolveTarget'
        );
        expectValidation(
            () =>
                context.beginRenderPass({
                    colorAttachments: [
                        {
                            view: multisampled.createView(),
                            resolveTarget: wrongExtent.createView(),
                            loadOp: 'load',
                            storeOp: 'store'
                        }
                    ]
                }),
            'invalid-descriptor',
            'renderPass.colorAttachments[0].resolveTarget'
        );

        device.graphicsQueue.abortFrame(context);
    });

    it('rejects incompatible attachment extents, formats, views, and clear operations', () => {
        const device = createDevice('webgpu');
        const color = device.createTexture({
            size: { width: 8, height: 8 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const smallerColor = device.createTexture({
            size: { width: 4, height: 8 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const colorArray = device.createTexture({
            size: { width: 8, height: 8, depthOrArrayLayers: 2 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const depth = device.createTexture({
            size: { width: 8, height: 8 },
            format: 'depth24plus',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const context = device.graphicsQueue.beginFrame();

        expectValidation(
            () =>
                context.beginRenderPass({
                    colorAttachments: [
                        { view: color.createView(), loadOp: 'load', storeOp: 'store' },
                        { view: smallerColor.createView(), loadOp: 'load', storeOp: 'store' }
                    ]
                }),
            'invalid-descriptor',
            'renderPass'
        );
        expectValidation(
            () =>
                context.beginRenderPass({
                    colorAttachments: [
                        {
                            view: colorArray.createView({
                                dimension: '2d-array',
                                arrayLayerCount: 1
                            }),
                            loadOp: 'load',
                            storeOp: 'store'
                        }
                    ]
                }),
            'invalid-descriptor',
            'renderPass.colorAttachments[0].view'
        );
        expectValidation(
            () =>
                context.beginRenderPass({
                    colorAttachments: [
                        { view: color.createView(), loadOp: 'clear', storeOp: 'store' }
                    ]
                }),
            'invalid-descriptor',
            'renderPass.colorAttachments[0].clearValue'
        );
        expectValidation(
            () =>
                context.beginRenderPass({
                    colorAttachments: [
                        { view: depth.createView(), loadOp: 'load', storeOp: 'store' }
                    ]
                }),
            'invalid-descriptor',
            'renderPass.colorAttachments[0].view.format'
        );

        device.graphicsQueue.abortFrame(context);
    });
});
