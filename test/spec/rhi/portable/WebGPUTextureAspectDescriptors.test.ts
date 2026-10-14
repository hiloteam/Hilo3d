import { describe, expect, it } from 'vitest';
import { nativeWebGPUTextureViewDescriptor } from '../../../../src/render/rhi/backends/webgpu/WebGPUDescriptors';
import type { RHINormalizedTextureViewDescriptor } from '../../../../src/render/rhi/core/RHIResources';

describe('native combined depth/stencil aspect descriptors', () => {
    it.each([
        ['depth24plus-stencil8', 'depth-only', 'depth24plus'],
        ['depth32float-stencil8', 'depth-only', 'depth32float'],
        ['depth24plus-stencil8', 'stencil-only', 'stencil8'],
        ['depth32float-stencil8', 'stencil-only', 'stencil8'],
        ['depth24plus-stencil8', 'all', 'depth24plus-stencil8'],
        ['depth32float-stencil8', 'all', 'depth32float-stencil8'],
        ['rgba8unorm', 'all', 'rgba8unorm']
    ] as const)(
        'converts %s %s to native %s without changing the portable recipe',
        (format, aspect, expected) => {
            const portable: RHINormalizedTextureViewDescriptor = Object.freeze({
                label: 'aspect regression',
                format,
                aspect,
                dimension: '2d',
                baseMipLevel: 0,
                mipLevelCount: 1,
                baseArrayLayer: 0,
                arrayLayerCount: 1
            });
            expect(nativeWebGPUTextureViewDescriptor(portable)).toMatchObject({
                format: expected,
                aspect
            });
            expect(portable.format).toBe(format);
        }
    );
});
