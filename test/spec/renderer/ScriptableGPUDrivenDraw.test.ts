import Material from '../../../src/material/Material';
import StorageGraphicsShader from '../../../src/render/compute/StorageGraphicsShader';
import type { RGBufferHandle } from '../../../src/render/graph/RenderGraphResource';
import type { RGPrepareContext } from '../../../src/render/graph/RenderGraphExecutor';
import GPUDrivenRenderPass from '../../../src/render/pipeline/passes/GPUDrivenRenderPass';
import type { RenderGraphBufferHandle } from '../../../src/render/pipeline/ScriptableRenderGraph';
import { BufferResourceCache } from '../../../src/render/renderer/BufferResourceCache';
import { ComputeSamplerResourceCache } from '../../../src/render/renderer/ComputeSamplerResourceCache';
import { GPUDrivenPipelineResourceCache } from '../../../src/render/renderer/GPUDrivenPipelineResourceCache';
import { ResourceRegistry } from '../../../src/render/renderer/ResourceRegistry';
import {
    ScriptableGPUDrivenDraw,
    type ScriptableGPUDrivenDrawServices,
    type ScriptableGPUDrivenGraphResolver
} from '../../../src/render/renderer/ScriptableGPUDrivenDraw';
import {
    RHIBufferUsage,
    type RHIBindGroup,
    type RHIBuffer,
    type RHIRenderPassEncoder
} from '../../../src/render/rhi/core';
import { StorageGraphicsShaderCompiler } from '../../../src/render/shader/StorageGraphicsShaderCompiler';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeWebGPURHIBackend } from '../rhi/portable/FakeRHIBackend';

const STORAGE_PUBLIC = 1 as RenderGraphBufferHandle;
const INDEX_PUBLIC = 2 as RenderGraphBufferHandle;
const INDIRECT_PUBLIC = 3 as RenderGraphBufferHandle;
const STORAGE_INTERNAL = 11 as RGBufferHandle;
const INDEX_INTERNAL = 12 as RGBufferHandle;
const INDIRECT_INTERNAL = 13 as RGBufferHandle;

function shader(): StorageGraphicsShader {
    return new StorageGraphicsShader({
        label: 'runtime vertex pulling',
        vertexSource: `#version 310 es
precision highp float;
layout(std430) readonly buffer ParticleData { vec4 positions[]; } particles;
void main() { gl_Position = particles.positions[gl_VertexID]; }`,
        fragmentSource: `#version 310 es
precision highp float;
layout(location = 0) out vec4 color;
void main() { color = vec4(1.0); }`,
        bindings: [
            {
                name: 'particles',
                group: 0,
                binding: 0,
                kind: 'read-only-storage-buffer',
                minBindingSize: 16
            }
        ]
    });
}

function renderEncoder() {
    const drawRecord = vi.fn();
    const drawIndirect = vi.fn();
    const drawIndexedIndirect = vi.fn();
    const setBindGroup = vi.fn();
    const setIndexBufferRecord = vi.fn();
    return {
        drawRecord,
        drawIndirect,
        drawIndexedIndirect,
        setBindGroup,
        setIndexBufferRecord,
        pass: {
            setPipeline: vi.fn(),
            setBindGroup,
            setVertexBuffer: vi.fn(),
            setVertexBufferRecord: vi.fn(),
            setIndexBuffer: vi.fn(),
            setIndexBufferRecord,
            setViewport: vi.fn(),
            setViewportRecord: vi.fn(),
            setScissorRect: vi.fn(),
            setScissorRectRecord: vi.fn(),
            setBlendConstant: vi.fn(),
            setStencilReference: vi.fn(),
            draw: vi.fn(),
            drawRecord,
            drawIndexed: vi.fn(),
            drawIndexedRecord: vi.fn(),
            drawIndirect,
            drawIndexedIndirect,
            end: vi.fn()
        } as unknown as RHIRenderPassEncoder
    };
}

describe('ScriptableGPUDrivenDraw', () => {
    const compiler = new StorageGraphicsShaderCompiler();

    beforeAll(async () => {
        await compiler.initialize();
    });

    it('prepares a readonly storage bind group and seals a direct draw packet', () => {
        const fixture = createFixture(compiler);
        const pass = new GPUDrivenRenderPass({
            shader: shader(),
            material: new Material({ depthTest: false, depthMask: false, cullFace: false })
        });
        const draw = new ScriptableGPUDrivenDraw();
        draw.configure(
            pass,
            {
                buffers: [{ buffer: STORAGE_PUBLIC }],
                draw: { kind: 'draw', vertexCount: 6 },
                colorAttachments: []
            },
            fixture.resolver,
            fixture.services,
            { colorFormats: ['rgba8unorm'], sampleCount: 1 },
            7
        );
        draw.prepare(fixture.prepareContext);
        draw.draw.prepareVertexInput();
        const encoder = renderEncoder();
        draw.draw.execute(encoder.pass);

        expect(encoder.setBindGroup).toHaveBeenCalledTimes(1);
        expect(encoder.drawRecord).toHaveBeenCalledWith(
            expect.objectContaining({ elementCount: 6, firstInstance: 0 })
        );
        expect(fixture.frameBindGroups.size).toBe(1);
        draw.cleanup(fixture.services.frameBindGroups);
        expect(fixture.frameBindGroups.size).toBe(0);
        fixture.destroy();
    });

    it('binds index input and forwards indexed indirect arguments without CPU inspection', () => {
        const fixture = createFixture(compiler);
        const pass = new GPUDrivenRenderPass({
            shader: shader(),
            material: new Material({ depthTest: false, depthMask: false, cullFace: false }),
            indexFormat: 'uint32'
        });
        const draw = new ScriptableGPUDrivenDraw();
        draw.configure(
            pass,
            {
                buffers: [{ buffer: STORAGE_PUBLIC }],
                indexBuffer: { buffer: INDEX_PUBLIC, byteOffset: 0, byteLength: 64 },
                draw: {
                    kind: 'draw-indexed-indirect',
                    buffer: INDIRECT_PUBLIC,
                    byteOffset: 20
                },
                colorAttachments: []
            },
            fixture.resolver,
            fixture.services,
            { colorFormats: ['rgba8unorm'], sampleCount: 1 },
            9
        );
        draw.prepare(fixture.prepareContext);
        const encoder = renderEncoder();
        draw.draw.execute(encoder.pass);

        expect(encoder.setIndexBufferRecord).toHaveBeenCalledWith(
            expect.objectContaining({ buffer: fixture.index, format: 'uint32' })
        );
        expect(encoder.drawIndexedIndirect).toHaveBeenCalledWith(fixture.indirect, 20);
        draw.cleanup(fixture.services.frameBindGroups);
        fixture.destroy();
    });
});

function createFixture(compiler: StorageGraphicsShaderCompiler): {
    readonly storage: RHIBuffer;
    readonly index: RHIBuffer;
    readonly indirect: RHIBuffer;
    readonly resolver: ScriptableGPUDrivenGraphResolver;
    readonly services: ScriptableGPUDrivenDrawServices;
    readonly prepareContext: RGPrepareContext;
    readonly frameBindGroups: Set<RHIBindGroup>;
    destroy(): void;
} {
    const backend = new FakeWebGPURHIBackend();
    const device = backend.createDevice();
    const registry = new ResourceRegistry(device);
    const storage = device.createBuffer({ size: 256, usage: RHIBufferUsage.STORAGE });
    const index = device.createBuffer({ size: 64, usage: RHIBufferUsage.INDEX });
    const indirect = device.createBuffer({ size: 64, usage: RHIBufferUsage.INDIRECT });
    const buffers = new Map<RGBufferHandle, RHIBuffer>([
        [STORAGE_INTERNAL, storage],
        [INDEX_INTERNAL, index],
        [INDIRECT_INTERNAL, indirect]
    ]);
    const frameBindGroups = new Set<RHIBindGroup>();
    const pipelines = new GPUDrivenPipelineResourceCache(registry, compiler);
    const services: ScriptableGPUDrivenDrawServices = {
        pipelines,
        samplers: new ComputeSamplerResourceCache(registry),
        uniformBuffers: new BufferResourceCache(registry),
        resourceUses: {
            use: vi.fn()
        } as unknown as ScriptableGPUDrivenDrawServices['resourceUses'],
        frameBindGroups: {
            trackFrameBindGroup(bindGroup): void {
                frameBindGroups.add(bindGroup);
            },
            releaseFrameBindGroup(bindGroup): void {
                frameBindGroups.delete(bindGroup);
                bindGroup.destroy();
            }
        }
    };
    const resolveInternal = (handle: RenderGraphBufferHandle): RGBufferHandle => {
        if (handle === STORAGE_PUBLIC) return STORAGE_INTERNAL;
        if (handle === INDEX_PUBLIC) return INDEX_INTERNAL;
        if (handle === INDIRECT_PUBLIC) return INDIRECT_INTERNAL;
        throw new Error('Unknown public buffer handle');
    };
    return {
        storage,
        index,
        indirect,
        resolver: {
            resolveBuffer(handle): RGBufferHandle {
                return resolveInternal(handle);
            },
            bufferByteLength(handle): number {
                return buffers.get(resolveInternal(handle))?.size ?? 0;
            },
            resolveTexture(): never {
                throw new Error('Fixture has no graph textures');
            }
        },
        services,
        prepareContext: {
            getBuffer(handle: RGBufferHandle): RHIBuffer {
                const buffer = buffers.get(handle);
                if (buffer === undefined) throw new Error('Unknown internal buffer handle');
                return buffer;
            }
        } as unknown as RGPrepareContext,
        frameBindGroups,
        destroy(): void {
            services.samplers.destroy();
            pipelines.destroy();
            registry.destroy();
            backend.destroy();
        }
    };
}
