import { describe, expect, it } from 'vitest';
import ComputeShader, {
    type ComputeShaderBinding,
    type ComputeShaderDescriptor
} from '../../../src/render/compute/ComputeShader';

const minimalSource = `
@compute @workgroup_size(8)
fn main() {}
`;

describe('ComputeShader', () => {
    it('snapshots, sorts, normalizes, and freezes its complete binding ABI', () => {
        const bindings: ComputeShaderBinding[] = [
            {
                name: 'outputData',
                group: 1,
                binding: 2,
                kind: 'storage-buffer',
                access: 'write-discard',
                minBindingSize: 64,
                dynamicOffset: false
            },
            {
                name: 'params',
                group: 0,
                binding: 0,
                kind: 'uniform-buffer',
                minBindingSize: 16
            }
        ];
        const descriptor: ComputeShaderDescriptor = {
            label: 'compact-particles',
            source: minimalSource,
            entryPoint: 'main',
            workgroupSize: [8],
            bindings
        };

        const shader = new ComputeShader(descriptor);
        bindings.reverse();
        descriptor.workgroupSize[0] satisfies number;

        expect(shader).toMatchObject({
            label: 'compact-particles',
            source: minimalSource,
            entryPoint: 'main',
            workgroupSize: [8, 1, 1]
        });
        expect(shader.bindings.map(binding => binding.name)).toEqual(['params', 'outputData']);
        expect(shader.bindings[1]).toMatchObject({
            kind: 'storage-buffer',
            access: 'write-discard',
            dynamicOffset: false
        });
        expect(Object.isFrozen(shader)).toBe(true);
        expect(Object.isFrozen(shader.workgroupSize)).toBe(true);
        expect(Object.isFrozen(shader.bindings)).toBe(true);
        expect(Object.isFrozen(shader.bindings[0])).toBe(true);
    });

    it('requires strict structural values and explicit writable-buffer graph access', () => {
        const valid = {
            source: minimalSource,
            workgroupSize: [8] as const,
            bindings: []
        };

        expect(
            () =>
                new ComputeShader({
                    ...valid,
                    bindings: [
                        {
                            name: 'data',
                            group: 0,
                            binding: 0,
                            kind: 'storage-buffer'
                        } as unknown as ComputeShaderBinding
                    ]
                })
        ).toThrow(/access has an unsupported value/u);
        expect(
            () =>
                new ComputeShader({
                    ...valid,
                    bindings: [
                        {
                            name: 'data',
                            group: 0,
                            binding: 0,
                            kind: 'storage-buffer',
                            access: 'read-only'
                        } as unknown as ComputeShaderBinding
                    ]
                })
        ).toThrow(/access has an unsupported value read-only/u);
        expect(
            () =>
                new ComputeShader({
                    ...valid,
                    workgroupSize: [0]
                })
        ).toThrow(/positive 32-bit integer/u);
        expect(
            () =>
                new ComputeShader({
                    ...valid,
                    entryPoint: 'not-an-identifier'
                })
        ).toThrow(/WGSL identifier/u);
    });

    it('rejects duplicate names and locations plus unsupported storage texture formats', () => {
        const r32Storage = new ComputeShader({
            source: minimalSource,
            workgroupSize: [8],
            bindings: [
                {
                    name: 'hiZ',
                    group: 0,
                    binding: 0,
                    kind: 'storage-texture',
                    access: 'write-only',
                    format: 'r32float'
                }
            ]
        });
        expect(r32Storage.bindings[0]?.kind).toBe('storage-texture');
        expect(
            () =>
                new ComputeShader({
                    source: minimalSource,
                    workgroupSize: [8],
                    bindings: [
                        {
                            name: 'first',
                            group: 0,
                            binding: 0,
                            kind: 'sampler'
                        },
                        {
                            name: 'second',
                            group: 0,
                            binding: 0,
                            kind: 'sampler'
                        }
                    ]
                })
        ).toThrow(/duplicate binding location 0:0/u);
        expect(
            () =>
                new ComputeShader({
                    source: minimalSource,
                    workgroupSize: [8],
                    bindings: [
                        {
                            name: 'same',
                            group: 0,
                            binding: 0,
                            kind: 'sampler'
                        },
                        {
                            name: 'same',
                            group: 0,
                            binding: 1,
                            kind: 'comparison-sampler'
                        }
                    ]
                })
        ).toThrow(/duplicate binding name same/u);
        expect(
            () =>
                new ComputeShader({
                    source: minimalSource,
                    workgroupSize: [8],
                    bindings: [
                        {
                            name: 'target',
                            group: 0,
                            binding: 0,
                            kind: 'storage-texture',
                            access: 'write-only',
                            format: 'rgba8unorm-srgb'
                        } as unknown as ComputeShaderBinding
                    ]
                })
        ).toThrow(/format has an unsupported value rgba8unorm-srgb/u);
    });

    it('keeps the compute graph texture ABI honest and snapshots non-filtering samplers', () => {
        const shader = new ComputeShader({
            source: minimalSource,
            workgroupSize: [8],
            bindings: [
                {
                    name: 'depth',
                    group: 0,
                    binding: 0,
                    kind: 'sampled-texture',
                    sampleType: 'unfilterable-float',
                    viewDimension: '2d'
                },
                {
                    name: 'nearestSampler',
                    group: 0,
                    binding: 1,
                    kind: 'non-filtering-sampler'
                }
            ]
        });

        expect(shader.bindings[1]?.kind).toBe('non-filtering-sampler');
        expect(
            () =>
                new ComputeShader({
                    source: minimalSource,
                    workgroupSize: [8],
                    bindings: [
                        {
                            name: 'unsupportedArray',
                            group: 0,
                            binding: 0,
                            kind: 'sampled-texture',
                            sampleType: 'float',
                            viewDimension: '2d-array'
                        } as unknown as ComputeShaderBinding
                    ]
                })
        ).toThrow(/viewDimension has an unsupported value 2d-array/u);
        expect(
            () =>
                new ComputeShader({
                    source: minimalSource,
                    workgroupSize: [8],
                    bindings: [
                        {
                            name: 'unsupportedInteger',
                            group: 0,
                            binding: 0,
                            kind: 'sampled-texture',
                            sampleType: 'uint'
                        } as unknown as ComputeShaderBinding
                    ]
                })
        ).toThrow(/sampleType has an unsupported value uint/u);
    });
});
