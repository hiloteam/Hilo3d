import Material from '../../../src/material/Material';
import ComputeSampler from '../../../src/render/compute/ComputeSampler';
import StorageGraphicsShader from '../../../src/render/compute/StorageGraphicsShader';
import GPUDrivenRenderPass from '../../../src/render/pipeline/passes/GPUDrivenRenderPass';
import type {
    RenderGraphBufferHandle,
    RenderGraphTextureHandle,
    ScriptableRenderPassBuilder
} from '../../../src/render/pipeline/ScriptableRenderGraph';
import { describe, expect, it, vi } from 'vitest';

function bufferHandle(value: number): RenderGraphBufferHandle {
    return value as RenderGraphBufferHandle;
}

function textureHandle(value: number): RenderGraphTextureHandle {
    return value as RenderGraphTextureHandle;
}

function createBuilder() {
    return {
        readTexture: vi.fn(),
        writeStorageTexture: vi.fn(),
        copyTexture: vi.fn(),
        readBuffer: vi.fn(),
        writeBuffer: vi.fn(),
        readWriteBuffer: vi.fn(),
        copyBuffer: vi.fn(),
        clearBuffer: vi.fn(),
        useColorAttachment: vi.fn(),
        useDepthStencilAttachment: vi.fn(),
        useRendererList: vi.fn(),
        dependsOn: vi.fn(),
        markSideEffect: vi.fn()
    } satisfies ScriptableRenderPassBuilder;
}

function shader(): StorageGraphicsShader {
    return new StorageGraphicsShader({
        label: 'particles',
        vertexSource: `#version 310 es
precision highp float;
layout(std430) readonly buffer Particles { vec4 positions[]; } particles;
void main() { gl_Position = particles.positions[gl_VertexID]; }`,
        fragmentSource: `#version 310 es
precision highp float;
uniform sampler2D albedo;
layout(location = 0) out vec4 color;
void main() { color = texture(albedo, vec2(0.5)); }`,
        bindings: [
            {
                name: 'particles',
                group: 0,
                binding: 0,
                kind: 'read-only-storage-buffer'
            },
            {
                name: 'albedo',
                group: 1,
                binding: 0,
                kind: 'sampled-texture',
                sampleType: 'float'
            },
            { name: 'albedo', group: 1, binding: 1, kind: 'sampler' }
        ]
    });
}

function createPass(): GPUDrivenRenderPass {
    return new GPUDrivenRenderPass({
        shader: shader(),
        material: new Material({ depthTest: false, depthMask: false, cullFace: false })
    });
}

describe('GPUDrivenRenderPass', () => {
    it('derives storage, sampled, vertex, and indirect graph dependencies', () => {
        const pass = new GPUDrivenRenderPass({
            shader: shader(),
            material: new Material(),
            vertexLayouts: [
                {
                    arrayStride: 16,
                    attributes: [{ shaderLocation: 0, format: 'float32x4', byteOffset: 0 }]
                }
            ]
        });
        const builder = createBuilder();
        pass.setup(builder, {
            buffers: [{ buffer: bufferHandle(1) }],
            textures: [{ texture: textureHandle(2) }],
            samplers: [new ComputeSampler({ magFilter: 'linear' })],
            vertexBuffers: [{ buffer: bufferHandle(3) }],
            draw: { kind: 'draw-indirect', buffer: bufferHandle(4), byteOffset: 16 },
            colorAttachments: [
                {
                    texture: textureHandle(5),
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 }
                }
            ]
        });

        expect(builder.readBuffer).toHaveBeenNthCalledWith(1, bufferHandle(1), 'storage');
        expect(builder.readTexture).toHaveBeenCalledWith(textureHandle(2));
        expect(builder.readBuffer).toHaveBeenNthCalledWith(2, bufferHandle(3), 'vertex');
        expect(builder.readBuffer).toHaveBeenNthCalledWith(3, bufferHandle(4), 'indirect');
        expect(builder.useColorAttachment).toHaveBeenCalledTimes(1);
    });

    it('declares indexed and indirect inputs without inspecting argument contents', () => {
        const pass = new GPUDrivenRenderPass({
            shader: shader(),
            material: new Material(),
            indexFormat: 'uint32'
        });
        const builder = createBuilder();
        pass.setup(builder, {
            buffers: [{ buffer: bufferHandle(1) }],
            textures: [{ texture: textureHandle(2) }],
            samplers: [new ComputeSampler()],
            indexBuffer: { buffer: bufferHandle(6), byteOffset: 32, byteLength: 64 },
            draw: {
                kind: 'draw-indexed-indirect',
                buffer: bufferHandle(7),
                byteOffset: 20
            },
            colorAttachments: [{ texture: textureHandle(8), loadOp: 'load', storeOp: 'store' }]
        });

        expect(builder.readBuffer).toHaveBeenCalledWith(bufferHandle(6), 'index');
        expect(builder.readBuffer).toHaveBeenCalledWith(bufferHandle(7), 'indirect');
    });

    it('accepts non-zero direct firstInstance on its WebGPU-only path', () => {
        const pass = createPass();
        const parameters = {
            buffers: [{ buffer: bufferHandle(1) }],
            textures: [{ texture: textureHandle(2) }],
            samplers: [new ComputeSampler()],
            colorAttachments: [
                { texture: textureHandle(3), loadOp: 'load' as const, storeOp: 'store' as const }
            ]
        };
        expect(() => {
            pass.setup(createBuilder(), {
                ...parameters,
                draw: { kind: 'draw', vertexCount: 3, firstInstance: 7 }
            });
        }).not.toThrow();
        expect(() => {
            pass.setup(createBuilder(), {
                ...parameters,
                draw: { kind: 'draw', vertexCount: 3, firstInstance: 0 }
            });
        }).not.toThrow();
    });

    it('rejects non-2d graph textures before preparing a GPU-driven pipeline', () => {
        const non2dShader = new StorageGraphicsShader({
            vertexSource: `#version 310 es
precision highp float;
layout(std430) readonly buffer Particles { vec4 positions[]; } particles;
void main() { gl_Position = particles.positions[gl_VertexID]; }`,
            fragmentSource: `#version 310 es
precision highp float;
uniform samplerCube environmentMap;
layout(location = 0) out vec4 color;
void main() { color = texture(environmentMap, vec3(0.0, 0.0, 1.0)); }`,
            bindings: [
                {
                    name: 'particles',
                    group: 0,
                    binding: 0,
                    kind: 'read-only-storage-buffer'
                },
                {
                    name: 'environmentMap',
                    group: 1,
                    binding: 0,
                    kind: 'sampled-texture',
                    sampleType: 'float',
                    viewDimension: 'cube'
                },
                { name: 'environmentMap', group: 1, binding: 1, kind: 'sampler' }
            ]
        });

        expect(
            () =>
                new GPUDrivenRenderPass({
                    shader: non2dShader,
                    material: new Material()
                })
        ).toThrow(/complete 2d view/u);
    });

    it('rejects graph-inexpressible integer textures and filtering state', () => {
        const integerShader = new StorageGraphicsShader({
            vertexSource: `#version 310 es
precision highp float;
layout(std430) readonly buffer Particles { vec4 positions[]; } particles;
void main() { gl_Position = particles.positions[gl_VertexID]; }`,
            fragmentSource: `#version 310 es
precision highp float;
precision highp usampler2D;
uniform usampler2D integerTexture;
layout(location = 0) out vec4 color;
void main() { color = vec4(texture(integerTexture, vec2(0.5))); }`,
            bindings: [
                {
                    name: 'particles',
                    group: 0,
                    binding: 0,
                    kind: 'read-only-storage-buffer'
                },
                {
                    name: 'integerTexture',
                    group: 1,
                    binding: 0,
                    kind: 'sampled-texture',
                    sampleType: 'uint'
                },
                { name: 'integerTexture', group: 1, binding: 1, kind: 'sampler' }
            ]
        });
        expect(
            () =>
                new GPUDrivenRenderPass({
                    shader: integerShader,
                    material: new Material()
                })
        ).toThrow(/cannot use uint/u);

        const nonFilteringShader = shader();
        const pass = new GPUDrivenRenderPass({
            shader: new StorageGraphicsShader({
                vertexSource: nonFilteringShader.vertexSource,
                fragmentSource: nonFilteringShader.fragmentSource,
                bindings: nonFilteringShader.bindings.map(binding =>
                    binding.kind === 'sampled-texture'
                        ? { ...binding, sampleType: 'unfilterable-float' as const }
                        : binding
                )
            }),
            material: new Material()
        });
        expect(() => {
            pass.setup(createBuilder(), {
                buffers: [{ buffer: bufferHandle(1) }],
                textures: [{ texture: textureHandle(2) }],
                samplers: [new ComputeSampler({ magFilter: 'linear' })],
                draw: { kind: 'draw', vertexCount: 3 },
                colorAttachments: [{ texture: textureHandle(3), loadOp: 'load', storeOp: 'store' }]
            });
        }).toThrow(/requires nearest filters.*maxAnisotropy 1/u);
    });

    it('snapshots and validates portable vertex layouts', () => {
        const mutable = {
            arrayStride: 16,
            attributes: [{ shaderLocation: 2, format: 'float32x3' as const, byteOffset: 0 }]
        };
        const pass = new GPUDrivenRenderPass({
            shader: shader(),
            material: new Material(),
            vertexLayouts: [mutable]
        });
        mutable.attributes[0] = {
            shaderLocation: 3,
            format: 'float32x3',
            byteOffset: 0
        };
        expect(pass.vertexLayouts[0]?.attributes[0]?.shaderLocation).toBe(2);
        expect(Object.isFrozen(pass.vertexLayouts[0]?.attributes)).toBe(true);
        expect(
            () =>
                new GPUDrivenRenderPass({
                    shader: shader(),
                    material: new Material(),
                    vertexLayouts: [
                        {
                            arrayStride: 8,
                            attributes: [{ shaderLocation: 0, format: 'float32x4', byteOffset: 0 }]
                        }
                    ]
                })
        ).toThrow(/exceeds.*arrayStride/u);
    });
});
