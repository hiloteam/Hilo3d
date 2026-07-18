import { describe, expect, it, vi } from 'vitest';
import ComputeKernel from '../../../src/render/compute/ComputeKernel';
import ComputeShader from '../../../src/render/compute/ComputeShader';
import ComputeSampler from '../../../src/render/compute/ComputeSampler';
import ComputeRenderPass from '../../../src/render/pipeline/passes/ComputeRenderPass';
import type {
    RenderGraphBufferHandle,
    RenderGraphTextureHandle,
    ScriptableRenderPassBuilder
} from '../../../src/render/pipeline/ScriptableRenderGraph';

function bufferHandle(value: number): RenderGraphBufferHandle {
    return value as RenderGraphBufferHandle;
}

function textureHandle(value: number): RenderGraphTextureHandle {
    return value as RenderGraphTextureHandle;
}

interface BuilderFixture {
    readonly builder: ScriptableRenderPassBuilder;
    readonly readTexture: ReturnType<typeof vi.fn>;
    readonly writeStorageTexture: ReturnType<typeof vi.fn>;
    readonly readBuffer: ReturnType<typeof vi.fn>;
    readonly readWriteBuffer: ReturnType<typeof vi.fn>;
}

function createBuilder(): BuilderFixture {
    const readTexture = vi.fn();
    const writeStorageTexture = vi.fn();
    const readBuffer = vi.fn();
    const readWriteBuffer = vi.fn();
    return {
        readTexture,
        writeStorageTexture,
        readBuffer,
        readWriteBuffer,
        builder: {
            readTexture,
            writeStorageTexture,
            copyTexture: vi.fn(),
            readBuffer,
            writeBuffer: vi.fn(),
            readWriteBuffer,
            copyBuffer: vi.fn(),
            clearBuffer: vi.fn(),
            useColorAttachment: vi.fn(),
            useDepthStencilAttachment: vi.fn(),
            useRendererList: vi.fn(),
            dependsOn: vi.fn(),
            markSideEffect: vi.fn()
        }
    };
}

const shader = new ComputeShader({
    source: `
@group(0) @binding(0) var<storage, read> source: array<u32>;
@group(0) @binding(1) var<storage, read_write> scratch: array<u32>;
@group(1) @binding(0) var sampled: texture_2d<f32>;
@group(1) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@compute @workgroup_size(8, 1, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    scratch[id.x] = source[id.x];
    textureStore(outputTexture, vec2<i32>(id.xy), textureLoad(sampled, vec2<i32>(id.xy), 0));
}`,
    workgroupSize: [8],
    bindings: [
        { name: 'source', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
        {
            name: 'scratch',
            group: 0,
            binding: 1,
            kind: 'storage-buffer',
            access: 'read-write'
        },
        {
            name: 'sampled',
            group: 1,
            binding: 0,
            kind: 'sampled-texture',
            sampleType: 'float'
        },
        {
            name: 'outputTexture',
            group: 1,
            binding: 1,
            kind: 'storage-texture',
            access: 'write-only',
            format: 'rgba8unorm'
        }
    ]
});

describe('ComputeRenderPass', () => {
    it('validates the kernel before resolving the default pass name', () => {
        expect(() => new ComputeRenderPass(null as never)).toThrow(/requires a ComputeKernel/u);
    });

    it('derives graph access and indirect dependency from the immutable shader ABI', () => {
        const pass = new ComputeRenderPass(new ComputeKernel({ shader }));
        const fixture = createBuilder();
        pass.setup(fixture.builder, {
            buffers: [{ buffer: bufferHandle(1) }, { buffer: bufferHandle(2) }],
            textures: [{ texture: textureHandle(3) }, { texture: textureHandle(4) }],
            dispatch: { indirectBuffer: bufferHandle(5), indirectOffset: 12 }
        });

        expect(fixture.readBuffer).toHaveBeenNthCalledWith(1, bufferHandle(1), 'storage');
        expect(fixture.readWriteBuffer).toHaveBeenCalledWith(bufferHandle(2));
        expect(fixture.readTexture).toHaveBeenCalledWith(textureHandle(3));
        expect(fixture.writeStorageTexture).toHaveBeenCalledWith(textureHandle(4));
        expect(fixture.readBuffer).toHaveBeenNthCalledWith(2, bufferHandle(5), 'indirect');
    });

    it('requires exact positional resource counts', () => {
        const pass = new ComputeRenderPass(new ComputeKernel({ shader }));
        expect(() => {
            pass.setup(createBuilder().builder, {
                buffers: [{ buffer: bufferHandle(1) }],
                textures: [{ texture: textureHandle(2) }, { texture: textureHandle(3) }],
                dispatch: { x: 1 }
            });
        }).toThrow(/missing|expected/u);
    });

    it('validates direct and indirect dispatch parameters before graph compilation', () => {
        const empty = new ComputeRenderPass(
            new ComputeKernel({
                shader: new ComputeShader({
                    source: '@compute @workgroup_size(1) fn main() {}',
                    workgroupSize: [1],
                    bindings: []
                })
            })
        );
        expect(() => {
            empty.setup(createBuilder().builder, {
                buffers: [],
                textures: [],
                dispatch: { x: 0 }
            });
        }).toThrow(/positive/u);
        expect(() => {
            empty.setup(createBuilder().builder, {
                buffers: [],
                textures: [],
                dispatch: { indirectBuffer: bufferHandle(1), indirectOffset: 2 }
            });
        }).toThrow(/4-byte-aligned/u);
    });

    it('requires sampler resources in sampler ABI order', () => {
        const samplerShader = new ComputeShader({
            source: `
@group(0) @binding(0) var imageSampler: sampler;
@compute @workgroup_size(1) fn main() {}`,
            workgroupSize: [1],
            bindings: [
                {
                    name: 'imageSampler',
                    group: 0,
                    binding: 0,
                    kind: 'non-filtering-sampler'
                }
            ]
        });
        const pass = new ComputeRenderPass(new ComputeKernel({ shader: samplerShader }));
        expect(() => {
            pass.setup(createBuilder().builder, {
                buffers: [],
                textures: [],
                dispatch: { x: 1 }
            });
        }).toThrow(/missing sampler/u);
        expect(() => {
            pass.setup(createBuilder().builder, {
                buffers: [],
                textures: [],
                samplers: [new ComputeSampler()],
                dispatch: { x: 1 }
            });
        }).not.toThrow();
    });
});
