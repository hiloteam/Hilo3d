import { describe, expect, it } from 'vitest';
import {
    RHIBufferUsage,
    RHIColorWrite,
    RHIShaderStage,
    RHITextureUsage,
    type RHIBindGroupLayoutDescriptor,
    type RHIPipelineLayout,
    type RHIRenderPipelineDescriptor,
    type RHITextureDescriptor
} from '../../../src/rhi/RHI';

function expectIndependentFlags(flags: Readonly<Record<string, number>>): void {
    const values = Object.values(flags);
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) {
        expect(value).toBeGreaterThan(0);
        expect((value & (value - 1)) === 0).toBe(true);
    }
}

describe('RHI descriptors', () => {
    it('uses frozen, composable usage and shader-stage flags', () => {
        expect(Object.isFrozen(RHIBufferUsage)).toBe(true);
        expect(Object.isFrozen(RHITextureUsage)).toBe(true);
        expect(Object.isFrozen(RHIShaderStage)).toBe(true);
        expect(Object.isFrozen(RHIColorWrite)).toBe(true);

        expectIndependentFlags(RHIBufferUsage);
        expectIndependentFlags(RHITextureUsage);
        expectIndependentFlags(RHIShaderStage);
        expectIndependentFlags({
            RED: RHIColorWrite.RED,
            GREEN: RHIColorWrite.GREEN,
            BLUE: RHIColorWrite.BLUE,
            ALPHA: RHIColorWrite.ALPHA
        });
        expect(
            RHIColorWrite.RED | RHIColorWrite.GREEN | RHIColorWrite.BLUE | RHIColorWrite.ALPHA
        ).toBe(RHIColorWrite.ALL);
    });

    it('keeps the portable descriptor vocabulary WebGPU-shaped', () => {
        const texture = {
            label: 'portable color',
            size: { width: 64, height: 32, depthOrArrayLayers: 1 },
            mipLevelCount: 4,
            sampleCount: 1,
            dimension: '2d',
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING | RHITextureUsage.RENDER_ATTACHMENT
        } satisfies RHITextureDescriptor;
        const bindGroupLayout = {
            label: 'portable material layout',
            entries: [
                {
                    binding: 0,
                    visibility: RHIShaderStage.VERTEX | RHIShaderStage.FRAGMENT,
                    buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 64 }
                },
                {
                    binding: 1,
                    visibility: RHIShaderStage.FRAGMENT,
                    texture: { sampleType: 'float', viewDimension: '2d' }
                },
                {
                    binding: 2,
                    visibility: RHIShaderStage.FRAGMENT,
                    sampler: { type: 'filtering' }
                }
            ]
        } satisfies RHIBindGroupLayoutDescriptor;
        const pipelineLayout = {
            id: 2,
            backend: 'webgpu',
            label: 'pipeline layout',
            bindGroupLayouts: []
        } satisfies RHIPipelineLayout;
        const pipeline = {
            label: 'portable pipeline',
            layout: pipelineLayout,
            vertex: {
                module: {
                    id: 1,
                    backend: 'webgpu',
                    label: 'vertex module',
                    language: 'wgsl',
                    stage: 'vertex'
                },
                entryPoint: 'main',
                buffers: [
                    {
                        arrayStride: 20,
                        stepMode: 'vertex',
                        attributes: [
                            { shaderLocation: 0, offset: 0, format: 'float32x3' },
                            { shaderLocation: 1, offset: 12, format: 'float32x2' }
                        ]
                    }
                ]
            },
            primitive: { topology: 'triangle-list', frontFace: 'ccw', cullMode: 'back' },
            multisample: { count: 1, mask: 0xffffffff, alphaToCoverageEnabled: false }
        } satisfies RHIRenderPipelineDescriptor;

        expect(texture.format).toBe('rgba8unorm');
        expect(bindGroupLayout.entries.map(entry => entry.binding)).toEqual([0, 1, 2]);
        expect(pipeline.vertex.buffers[0]?.attributes).toHaveLength(2);
        expect(pipeline.primitive.topology).toBe('triangle-list');
    });
});
