import { describe, expect, it } from 'vitest';
import {
    RHIShaderStage,
    type RHIShaderArtifactInput,
    type RHIShaderBindingKind,
    type RHIShaderBindingReflection,
    type RHIShaderReflection,
    type RHIShaderStageName
} from '../../../src/render/rhi/core';
import {
    compileShaderBindingLayout,
    type ShaderStageReflectionPair
} from '../../../src/render/renderer/ShaderBindingLayoutCompiler';

function uniformBlock(
    name: string,
    group: number,
    bindingIndex: number,
    minBindingSize?: number
): RHIShaderBindingReflection {
    return {
        group,
        binding: bindingIndex,
        kind: 'uniform-buffer',
        name,
        ...(minBindingSize === undefined ? {} : { minBindingSize })
    };
}

function binding(
    kind: RHIShaderBindingKind,
    name: string,
    group = 0,
    bindingIndex = 0
): RHIShaderBindingReflection {
    return { group, binding: bindingIndex, kind, name };
}

function sampledBinding(
    name: string,
    group: number,
    textureBinding: number,
    samplerBinding: number,
    samplerKind: 'sampler' | 'comparison-sampler' = 'sampler',
    arrayIndex?: number
): readonly RHIShaderBindingReflection[] {
    return [
        {
            ...binding('sampled-texture', name, group, textureBinding),
            ...(arrayIndex === undefined ? {} : { arrayIndex })
        },
        {
            ...binding(samplerKind, name, group, samplerBinding),
            ...(arrayIndex === undefined ? {} : { arrayIndex })
        }
    ];
}

function reflection(bindings: readonly RHIShaderBindingReflection[]): RHIShaderReflection {
    return { bindings };
}

function reflectionPair(
    vertex: readonly RHIShaderBindingReflection[] = [],
    fragment: readonly RHIShaderBindingReflection[] = []
): ShaderStageReflectionPair {
    return {
        vertex: reflection(vertex),
        fragment: reflection(fragment)
    };
}

function artifact(
    stage: RHIShaderStageName,
    bindings: readonly RHIShaderBindingReflection[]
): Readonly<RHIShaderArtifactInput> {
    return {
        backend: 'webgl2',
        stage,
        code: 'void main() {}',
        entryPoint: 'main',
        reflection: reflection(bindings),
        cacheKey: stage === 'vertex' ? 1 : 2
    };
}

describe('ShaderBindingLayoutCompiler', () => {
    it('pairs numeric depth textures with ordinary non-filtering samplers', () => {
        const plan = compileShaderBindingLayout(
            reflectionPair(
                [],
                [
                    {
                        group: 1,
                        binding: 0,
                        kind: 'sampled-texture',
                        name: 'depthMap',
                        sampleType: 'depth',
                        viewDimension: '2d'
                    },
                    {
                        group: 1,
                        binding: 1,
                        kind: 'sampler',
                        name: 'depthMap'
                    }
                ]
            ),
            4
        );

        expect(plan.bindGroupLayoutDescriptors[1]?.entries).toEqual([
            {
                binding: 0,
                visibility: RHIShaderStage.FRAGMENT,
                texture: { sampleType: 'depth' }
            },
            {
                binding: 1,
                visibility: RHIShaderStage.FRAGMENT,
                sampler: { type: 'non-filtering' }
            }
        ]);
        expect(plan.sampledBindings).toEqual([
            {
                name: 'depthMap',
                arrayIndex: 0,
                group: 1,
                textureBinding: 0,
                samplerBinding: 1,
                samplerKind: 'sampler',
                visibility: RHIShaderStage.FRAGMENT
            }
        ]);
    });

    it('merges cross-stage uniform blocks and emits stable sorted layout plans', () => {
        const pair = {
            vertex: artifact('vertex', [
                uniformBlock('ModelBlock', 2, 0),
                uniformBlock('CameraBlock', 0, 1, 64)
            ]),
            fragment: artifact('fragment', [
                uniformBlock('MaterialBlock', 1, 0),
                uniformBlock('CameraBlock', 0, 1, 64)
            ])
        };

        const plan = compileShaderBindingLayout(pair, 4);

        expect(plan.bindGroupLayoutDescriptors).toEqual([
            {
                entries: [
                    {
                        binding: 1,
                        visibility: RHIShaderStage.VERTEX | RHIShaderStage.FRAGMENT,
                        buffer: { type: 'uniform', minBindingSize: 64 }
                    }
                ]
            },
            {
                entries: [
                    {
                        binding: 0,
                        visibility: RHIShaderStage.FRAGMENT,
                        buffer: { type: 'uniform' }
                    }
                ]
            },
            {
                entries: [
                    {
                        binding: 0,
                        visibility: RHIShaderStage.VERTEX,
                        buffer: { type: 'uniform' }
                    }
                ]
            }
        ]);
        expect(plan.activeGroupIndices).toEqual([0, 1, 2]);
        expect(plan.uniformBlocks).toEqual([
            {
                name: 'CameraBlock',
                group: 0,
                binding: 1,
                visibility: RHIShaderStage.VERTEX | RHIShaderStage.FRAGMENT,
                minBindingSize: 64
            },
            {
                name: 'MaterialBlock',
                group: 1,
                binding: 0,
                visibility: RHIShaderStage.FRAGMENT
            },
            {
                name: 'ModelBlock',
                group: 2,
                binding: 0,
                visibility: RHIShaderStage.VERTEX
            }
        ]);
        expect(plan.getUniformBlockBinding('CameraBlock')).toBe(plan.uniformBlocks[0]);
        expect(plan.getUniformBlockBinding('MaterialBlock')).toBe(plan.uniformBlocks[1]);
        expect(plan.getUniformBlockBinding('MissingBlock')).toBeUndefined();
        expect(plan.sampledBindings).toEqual([]);
        expect(plan.getSampledBinding('MissingSampler')).toBeUndefined();

        expect(Object.isFrozen(plan)).toBe(true);
        expect(Object.isFrozen(plan.bindGroupLayoutDescriptors)).toBe(true);
        expect(Object.isFrozen(plan.bindGroupLayoutDescriptors[0])).toBe(true);
        expect(Object.isFrozen(plan.bindGroupLayoutDescriptors[0]?.entries)).toBe(true);
        expect(Object.isFrozen(plan.bindGroupLayoutDescriptors[0]?.entries[0])).toBe(true);
        expect(Object.isFrozen(plan.bindGroupLayoutDescriptors[0]?.entries[0]?.buffer)).toBe(true);
        expect(Object.isFrozen(plan.activeGroupIndices)).toBe(true);
        expect(Object.isFrozen(plan.uniformBlocks)).toBe(true);
        expect(Object.isFrozen(plan.uniformBlocks[0])).toBe(true);
        expect(Object.isFrozen(plan.sampledBindings)).toBe(true);
    });

    it('maps each logical sampler to paired texture/sampler entries with exact visibility', () => {
        const plan = compileShaderBindingLayout(
            reflectionPair(
                [...sampledBinding('vertexMap', 2, 5, 6), ...sampledBinding('sharedMap', 1, 3, 4)],
                [
                    ...sampledBinding('shadowMap', 3, 1, 2, 'comparison-sampler'),
                    ...sampledBinding('sharedMap', 1, 3, 4)
                ]
            ),
            4
        );

        expect(plan.bindGroupLayoutDescriptors).toEqual([
            { entries: [] },
            {
                entries: [
                    {
                        binding: 3,
                        visibility: RHIShaderStage.VERTEX | RHIShaderStage.FRAGMENT,
                        texture: { sampleType: 'float' }
                    },
                    {
                        binding: 4,
                        visibility: RHIShaderStage.VERTEX | RHIShaderStage.FRAGMENT,
                        sampler: { type: 'filtering' }
                    }
                ]
            },
            {
                entries: [
                    {
                        binding: 5,
                        visibility: RHIShaderStage.VERTEX,
                        texture: { sampleType: 'float' }
                    },
                    {
                        binding: 6,
                        visibility: RHIShaderStage.VERTEX,
                        sampler: { type: 'filtering' }
                    }
                ]
            },
            {
                entries: [
                    {
                        binding: 1,
                        visibility: RHIShaderStage.FRAGMENT,
                        texture: { sampleType: 'depth' }
                    },
                    {
                        binding: 2,
                        visibility: RHIShaderStage.FRAGMENT,
                        sampler: { type: 'comparison' }
                    }
                ]
            }
        ]);
        expect(plan.activeGroupIndices).toEqual([1, 2, 3]);
        expect(plan.sampledBindings).toEqual([
            {
                name: 'sharedMap',
                arrayIndex: 0,
                group: 1,
                textureBinding: 3,
                samplerBinding: 4,
                samplerKind: 'sampler',
                visibility: RHIShaderStage.VERTEX | RHIShaderStage.FRAGMENT
            },
            {
                name: 'vertexMap',
                arrayIndex: 0,
                group: 2,
                textureBinding: 5,
                samplerBinding: 6,
                samplerKind: 'sampler',
                visibility: RHIShaderStage.VERTEX
            },
            {
                name: 'shadowMap',
                arrayIndex: 0,
                group: 3,
                textureBinding: 1,
                samplerBinding: 2,
                samplerKind: 'comparison-sampler',
                visibility: RHIShaderStage.FRAGMENT
            }
        ]);
        expect(plan.getSampledBinding('sharedMap')).toBe(plan.sampledBindings[0]);
        expect(plan.getSampledBinding('shadowMap')).toBe(plan.sampledBindings[2]);
        expect(plan.getSampledBinding('missing')).toBeUndefined();
        expect(Object.isFrozen(plan.sampledBindings)).toBe(true);
        expect(Object.isFrozen(plan.sampledBindings[0])).toBe(true);
        expect(Object.isFrozen(plan.bindGroupLayoutDescriptors[1]?.entries[0]?.texture)).toBe(true);
        expect(Object.isFrozen(plan.bindGroupLayoutDescriptors[1]?.entries[1]?.sampler)).toBe(true);
    });

    it('preserves sparse empty groups through the highest active group', () => {
        const plan = compileShaderBindingLayout(
            reflectionPair([], [uniformBlock('CustomBlock', 3, 2, 16)]),
            4
        );

        expect(plan.bindGroupLayoutDescriptors).toHaveLength(4);
        expect(plan.bindGroupLayoutDescriptors.slice(0, 3)).toEqual([
            { entries: [] },
            { entries: [] },
            { entries: [] }
        ]);
        expect(plan.bindGroupLayoutDescriptors[3]).toEqual({
            entries: [
                {
                    binding: 2,
                    visibility: RHIShaderStage.FRAGMENT,
                    buffer: { type: 'uniform', minBindingSize: 16 }
                }
            ]
        });
        expect(plan.activeGroupIndices).toEqual([3]);
        expect(Object.isFrozen(plan.bindGroupLayoutDescriptors[1]?.entries)).toBe(true);
    });

    it('returns an empty frozen plan when neither stage declares bindings', () => {
        const plan = compileShaderBindingLayout(reflectionPair(), 4);

        expect(plan.bindGroupLayoutDescriptors).toEqual([]);
        expect(plan.activeGroupIndices).toEqual([]);
        expect(plan.uniformBlocks).toEqual([]);
        expect(plan.sampledBindings).toEqual([]);
        expect(plan.getUniformBlockBinding('Anything')).toBeUndefined();
        expect(plan.getSampledBinding('Anything')).toBeUndefined();
        expect(Object.isFrozen(plan.bindGroupLayoutDescriptors)).toBe(true);
    });

    it('rejects duplicate bindings within one stage', () => {
        expect(() =>
            compileShaderBindingLayout(
                reflectionPair([
                    uniformBlock('CameraBlock', 0, 0),
                    uniformBlock('CameraBlock', 0, 0)
                ]),
                4
            )
        ).toThrow(/duplicate shader binding 0:0/);
    });

    it('rejects cross-stage location, name, size, and kind conflicts', () => {
        expect(() =>
            compileShaderBindingLayout(
                reflectionPair(
                    [uniformBlock('CameraBlock', 0, 0)],
                    [uniformBlock('OtherBlock', 0, 0)]
                ),
                4
            )
        ).toThrow(/conflicts between stages/);
        expect(() =>
            compileShaderBindingLayout(
                reflectionPair(
                    [uniformBlock('CameraBlock', 0, 0)],
                    [uniformBlock('CameraBlock', 1, 0)]
                ),
                4
            )
        ).toThrow(/assigned to conflicting bindings/);
        expect(() =>
            compileShaderBindingLayout(
                reflectionPair(
                    [uniformBlock('CameraBlock', 0, 0, 64)],
                    [uniformBlock('CameraBlock', 0, 0, 32)]
                ),
                4
            )
        ).toThrow(/minBindingSize must match exactly/);
        expect(() =>
            compileShaderBindingLayout(
                reflectionPair(
                    [uniformBlock('CameraBlock', 0, 0)],
                    [binding('sampled-texture', 'CameraBlock', 0, 0)]
                ),
                4
            )
        ).toThrow(/kind, name, arrayIndex, and minBindingSize must match exactly/);
    });

    it.each(['storage-buffer', 'read-only-storage-buffer', 'storage-texture'] as const)(
        'rejects unsupported %s bindings',
        kind => {
            expect(() =>
                compileShaderBindingLayout(reflectionPair([binding(kind, 'Unsupported')]), 4)
            ).toThrow(new RegExp(`unsupported ${kind}`));
        }
    );

    it('rejects incomplete, duplicate, cross-group, and cross-stage sampled pairs', () => {
        expect(() =>
            compileShaderBindingLayout(
                reflectionPair([binding('sampled-texture', 'incomplete', 0, 0)]),
                4
            )
        ).toThrow(/incomplete; missing matching sampler/);
        expect(() =>
            compileShaderBindingLayout(reflectionPair([binding('sampler', 'incomplete', 0, 0)]), 4)
        ).toThrow(/incomplete; missing matching sampled-texture/);
        expect(() =>
            compileShaderBindingLayout(
                reflectionPair([
                    ...sampledBinding('duplicated', 0, 0, 2),
                    binding('sampled-texture', 'duplicated', 0, 1)
                ]),
                4
            )
        ).toThrow(/declares more than one sampled-texture location/);
        expect(() =>
            compileShaderBindingLayout(
                reflectionPair([
                    binding('sampled-texture', 'splitGroup', 0, 0),
                    binding('sampler', 'splitGroup', 1, 0)
                ]),
                4
            )
        ).toThrow(/different groups 0 and 1/);
        expect(() =>
            compileShaderBindingLayout(
                reflectionPair(
                    sampledBinding('stageConflict', 0, 0, 1),
                    sampledBinding('stageConflict', 0, 0, 2)
                ),
                4
            )
        ).toThrow(/samplerBinding.*must match exactly/);
        expect(() =>
            compileShaderBindingLayout(
                reflectionPair(
                    sampledBinding('kindConflict', 0, 0, 1),
                    sampledBinding('kindConflict', 0, 0, 1, 'comparison-sampler')
                ),
                4
            )
        ).toThrow(/kind, name, arrayIndex, and minBindingSize must match exactly/);
    });

    it('pairs flattened sampler-array elements independently and preserves indexed lookup', () => {
        const plan = compileShaderBindingLayout(
            reflectionPair([
                ...sampledBinding('arraySampler', 0, 0, 1, 'sampler', 0),
                ...sampledBinding('arraySampler', 0, 2, 3, 'sampler', 1)
            ]),
            4
        );

        expect(plan.sampledBindings).toEqual([
            {
                name: 'arraySampler',
                arrayIndex: 0,
                group: 0,
                textureBinding: 0,
                samplerBinding: 1,
                samplerKind: 'sampler',
                visibility: RHIShaderStage.VERTEX
            },
            {
                name: 'arraySampler',
                arrayIndex: 1,
                group: 0,
                textureBinding: 2,
                samplerBinding: 3,
                samplerKind: 'sampler',
                visibility: RHIShaderStage.VERTEX
            }
        ]);
        expect(plan.getSampledBinding('arraySampler')).toBe(plan.sampledBindings[0]);
        expect(plan.getSampledBinding('arraySampler', 1)).toBe(plan.sampledBindings[1]);
        expect(plan.getSampledBinding('arraySampler', 2)).toBeUndefined();
        expect(() => plan.getSampledBinding('arraySampler', -1)).toThrow(/non-negative/);
    });

    it('rejects texture and sampler metadata assigned to different array elements', () => {
        expect(() =>
            compileShaderBindingLayout(
                reflectionPair([
                    {
                        ...binding('sampled-texture', 'arraySampler', 0, 0),
                        arrayIndex: 0
                    },
                    { ...binding('sampler', 'arraySampler', 0, 1), arrayIndex: 1 }
                ]),
                4
            )
        ).toThrow(/arraySampler\[0\].*missing matching sampler/);
    });

    it('rejects sampled-resource name collisions and buffer-only size metadata', () => {
        expect(() =>
            compileShaderBindingLayout(
                reflectionPair(
                    [uniformBlock('sameName', 0, 0)],
                    sampledBinding('sameName', 1, 0, 1)
                ),
                4
            )
        ).toThrow(/used by both a uniform block and a sampled binding/);
        expect(() =>
            compileShaderBindingLayout(
                reflectionPair([
                    {
                        group: 0,
                        binding: 0,
                        kind: 'sampled-texture',
                        name: 'badSize',
                        minBindingSize: 16
                    },
                    binding('sampler', 'badSize', 0, 1)
                ]),
                4
            )
        ).toThrow(/sampled-texture.*cannot declare minBindingSize/);
    });

    it('validates group, binding, block name, min size, and maxBindGroups', () => {
        expect(() => compileShaderBindingLayout(reflectionPair(), 0)).toThrow(
            /maxBindGroups must be a positive safe integer/
        );
        expect(() => compileShaderBindingLayout(reflectionPair(), 1.5)).toThrow(
            /maxBindGroups must be a positive safe integer/
        );
        expect(() =>
            compileShaderBindingLayout(reflectionPair([uniformBlock('OutOfRange', 4, 0)]), 4)
        ).toThrow(/exceeds maxBindGroups 4/);
        expect(() =>
            compileShaderBindingLayout(reflectionPair([uniformBlock('NegativeGroup', -1, 0)]), 4)
        ).toThrow(/binding group must be a non-negative safe integer/);
        expect(() =>
            compileShaderBindingLayout(reflectionPair([uniformBlock('FractionalGroup', 0.5, 0)]), 4)
        ).toThrow(/binding group must be a non-negative safe integer/);
        expect(() =>
            compileShaderBindingLayout(reflectionPair([uniformBlock('NegativeBinding', 0, -1)]), 4)
        ).toThrow(/binding index must be a non-negative safe integer/);
        expect(() =>
            compileShaderBindingLayout(
                reflectionPair([uniformBlock('FractionalBinding', 0, 0.5)]),
                4
            )
        ).toThrow(/binding index must be a non-negative safe integer/);
        expect(() =>
            compileShaderBindingLayout(reflectionPair([uniformBlock('BadSize', 0, 0, -1)]), 4)
        ).toThrow(/minBindingSize must be a non-negative safe integer/);
        expect(() =>
            compileShaderBindingLayout(
                reflectionPair([{ group: 0, binding: 0, kind: 'uniform-buffer' }]),
                4
            )
        ).toThrow(/requires a non-empty block name/);
        expect(() =>
            compileShaderBindingLayout(reflectionPair([uniformBlock('', 0, 0)]), 4)
        ).toThrow(/requires a non-empty block name/);
    });

    it('rejects artifact pairs whose stage slots are swapped', () => {
        expect(() =>
            compileShaderBindingLayout(
                {
                    vertex: artifact('fragment', []),
                    fragment: artifact('vertex', [])
                },
                4
            )
        ).toThrow(/vertex input contains a fragment artifact/);
    });
});
