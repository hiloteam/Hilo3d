import { describe, expect, it } from 'vitest';
import type { ShaderReadBinding } from '../../../src/render/compute/ComputeShader';
import StorageGraphicsShader, {
    createStorageGraphicsShaderFromPortable
} from '../../../src/render/compute/StorageGraphicsShader';

const vertexSource = `#version 310 es
precision highp float;
layout(std430) readonly buffer ParticleData {
    vec4 positions[];
} particles;
void main() {
    gl_Position = particles.positions[gl_VertexID];
}`;

const fragmentSource = `#version 310 es
precision highp float;
layout(location = 0) out vec4 color;
void main() {
    color = vec4(1.0);
}`;

describe('StorageGraphicsShader', () => {
    it('snapshots, sorts, and freezes an explicit readonly graphics ABI', () => {
        const bindings: ShaderReadBinding[] = [
            {
                name: 'particles',
                group: 2,
                binding: 3,
                kind: 'read-only-storage-buffer',
                minBindingSize: 64,
                dynamicOffset: false
            },
            {
                name: 'CameraBlock',
                group: 0,
                binding: 1,
                kind: 'uniform-buffer'
            }
        ];
        const shader = new StorageGraphicsShader({
            label: 'vertex-pulling',
            vertexSource,
            fragmentSource,
            bindings
        });
        bindings.reverse();

        expect(shader).toMatchObject({
            label: 'vertex-pulling',
            vertexSource,
            fragmentSource
        });
        expect(shader.bindings.map(binding => binding.name)).toEqual(['CameraBlock', 'particles']);
        expect(shader.bindings[1]).toMatchObject({
            minBindingSize: 64,
            dynamicOffset: false
        });
        expect(Object.isFrozen(shader)).toBe(true);
        expect(Object.isFrozen(shader.bindings)).toBe(true);
        expect(Object.isFrozen(shader.bindings[0])).toBe(true);
    });

    it('allows one same-name texture/sampler pair for GLSL combined samplers', () => {
        const shader = new StorageGraphicsShader({
            vertexSource,
            fragmentSource,
            bindings: [
                {
                    name: 'particles',
                    group: 2,
                    binding: 3,
                    kind: 'read-only-storage-buffer'
                },
                {
                    name: 'albedo',
                    group: 1,
                    binding: 4,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                },
                { name: 'albedo', group: 1, binding: 5, kind: 'sampler' }
            ]
        });

        expect(shader.bindings.filter(binding => binding.name === 'albedo')).toHaveLength(2);
    });

    it('promotes preprocessed portable source at the storage-graphics boundary', () => {
        const shader = createStorageGraphicsShaderFromPortable({
            portableVertexSource: vertexSource.replace('#version 310 es', '#version 300 es'),
            portableFragmentSource: fragmentSource.replace('#version 310 es', '#version 300 es'),
            bindings: [
                {
                    name: 'particles',
                    group: 2,
                    binding: 3,
                    kind: 'read-only-storage-buffer'
                }
            ]
        });

        expect(shader.vertexSource).toMatch(/^#version 310 es/u);
        expect(shader.fragmentSource).toMatch(/^#version 310 es/u);
        expect(() =>
            createStorageGraphicsShaderFromPortable({
                portableVertexSource: vertexSource,
                portableFragmentSource: fragmentSource,
                bindings: shader.bindings
            })
        ).toThrow(/must use GLSL ES 3\.00/u);
    });

    it('rejects writable bindings, duplicate locations, and shaders without storage', () => {
        expect(
            () =>
                new StorageGraphicsShader({
                    vertexSource,
                    fragmentSource,
                    bindings: [
                        {
                            name: 'particles',
                            group: 0,
                            binding: 0,
                            kind: 'storage-buffer'
                        } as unknown as ShaderReadBinding
                    ]
                })
        ).toThrow(/read-only graphics binding/u);
        expect(
            () =>
                new StorageGraphicsShader({
                    vertexSource,
                    fragmentSource,
                    bindings: [
                        {
                            name: 'particles',
                            group: 0,
                            binding: 0,
                            kind: 'read-only-storage-buffer'
                        },
                        { name: 'other', group: 0, binding: 0, kind: 'uniform-buffer' }
                    ]
                })
        ).toThrow(/duplicate binding location 0:0/u);
        expect(
            () =>
                new StorageGraphicsShader({
                    vertexSource,
                    fragmentSource,
                    bindings: [
                        { name: 'CameraBlock', group: 0, binding: 0, kind: 'uniform-buffer' }
                    ]
                })
        ).toThrow(/requires at least one read-only-storage-buffer/u);
    });
});
