import { beforeAll, describe, expect, it } from 'vitest';
import StorageGraphicsShader from '../../../src/render/compute/StorageGraphicsShader';
import {
    StorageGraphicsCompilationError,
    StorageGraphicsShaderCompiler,
    type CompiledStorageGraphicsShader
} from '../../../src/render/shader/StorageGraphicsShaderCompiler';

const vertexSource = `#version 310 es
precision highp float;
layout(std140) uniform CameraBlock {
    mat4 viewProjection;
};
// layout(std430) buffer IgnoredComment { vec4 values[]; } ignored;
layout(std430) readonly buffer ParticleData {
    vec4 positions[];
} particles;
out vec2 uv;
void main() {
    vec4 world = particles.positions[gl_VertexID];
    uv = world.xy * 0.5 + 0.5;
    gl_Position = viewProjection * world;
}`;

const fragmentSource = `#version 310 es
precision highp float;
in vec2 uv;
layout(std430) readonly buffer ForwardLightGrid {
    vec4 lights[];
} lightGrid;
uniform sampler2D albedo;
layout(location = 0) out vec4 color;
void main() {
    color = texture(albedo, uv) * lightGrid.lights[0];
}`;

function createShader(
    overrides: {
        readonly vertexSource?: string;
        readonly fragmentSource?: string;
        readonly storageName?: string;
        readonly sampleType?: 'float' | 'depth' | 'uint';
    } = {}
): StorageGraphicsShader {
    return new StorageGraphicsShader({
        label: 'forward-plus-particles',
        vertexSource: overrides.vertexSource ?? vertexSource,
        fragmentSource: overrides.fragmentSource ?? fragmentSource,
        bindings: [
            { name: 'CameraBlock', group: 0, binding: 0, kind: 'uniform-buffer' },
            {
                name: 'albedo',
                group: 1,
                binding: 4,
                kind: 'sampled-texture',
                sampleType: overrides.sampleType ?? 'float'
            },
            { name: 'albedo', group: 1, binding: 5, kind: 'sampler' },
            {
                name: overrides.storageName ?? 'particles',
                group: 2,
                binding: 3,
                kind: 'read-only-storage-buffer',
                minBindingSize: 16
            },
            {
                name: 'lightGrid',
                group: 3,
                binding: 1,
                kind: 'read-only-storage-buffer'
            }
        ]
    });
}

describe('StorageGraphicsShaderCompiler', () => {
    const compiler = new StorageGraphicsShaderCompiler();

    beforeAll(async () => {
        await compiler.initialize();
    });

    it('preprocesses GLSL ES 3.10, injects the ABI, and emits exact RHI reflection', () => {
        const shader = createShader();
        const compiled = compiler.compile(shader, 'webgpu');

        expect(compiled).toMatchObject({
            backend: 'webgpu',
            bindings: shader.bindings
        });
        expect(compiled.vertex.code).toContain('@group(2) @binding(3)');
        expect(compiled.vertex.code).toContain('var<storage> particles: ParticleData;');
        expect(compiled.fragment.code).toContain('@group(3) @binding(1)');
        expect(compiled.fragment.code).toContain('var<storage> lightGrid: ForwardLightGrid;');
        expect(compiled.fragment.code).toContain('@group(1) @binding(4)');
        expect(compiled.fragment.code).toContain('@group(1) @binding(5)');
        expect(compiled.vertex.reflection).toEqual({
            bindings: [
                {
                    name: 'CameraBlock',
                    group: 0,
                    binding: 0,
                    kind: 'uniform-buffer'
                },
                {
                    name: 'particles',
                    group: 2,
                    binding: 3,
                    kind: 'read-only-storage-buffer',
                    minBindingSize: 16
                }
            ],
            vertexInputs: []
        });
        expect(compiled.fragment.reflection).toEqual({
            bindings: [
                {
                    name: 'albedo',
                    group: 1,
                    binding: 4,
                    kind: 'sampled-texture',
                    sampleType: 'float',
                    viewDimension: '2d',
                    multisampled: false
                },
                {
                    name: 'albedo',
                    group: 1,
                    binding: 5,
                    kind: 'sampler'
                },
                {
                    name: 'lightGrid',
                    group: 3,
                    binding: 1,
                    kind: 'read-only-storage-buffer'
                }
            ],
            fragmentOutputs: [{ location: 0, name: 'color' }]
        });
        expect(compiled.metadata.storageBuffers).toEqual([
            {
                name: 'particles',
                blockName: 'ParticleData',
                group: 2,
                binding: 3,
                stages: ['vertex']
            },
            {
                name: 'lightGrid',
                blockName: 'ForwardLightGrid',
                group: 3,
                binding: 1,
                stages: ['fragment']
            }
        ]);
        expect(compiler.compile(shader, 'webgpu')).toBe(compiled);
        expect(Object.isFrozen(compiled)).toBe(true);
        expect(Object.isFrozen(compiled.vertex.reflection)).toBe(true);
    });

    it('fails closed for WebGL2 before initialization or native shader work', () => {
        const uninitialized = new StorageGraphicsShaderCompiler();
        expect(() => uninitialized.compile(createShader(), 'webgl2')).toThrow(
            /WebGPU-only; WebGL2 has no storage buffers/u
        );
    });

    it('requires GLSL ES 3.10 and a descriptor-exact readonly storage subset', () => {
        expect(() =>
            compiler.compile(
                createShader({ vertexSource: vertexSource.replace('310 es', '300 es') }),
                'webgpu'
            )
        ).toThrow(/vertex source must begin with #version 310 es/u);
        expect(() =>
            compiler.compile(
                createShader({
                    vertexSource: vertexSource.replace(
                        'layout(std430) readonly buffer',
                        'layout(std430) buffer'
                    )
                }),
                'webgpu'
            )
        ).toThrow(/must be explicitly readonly/u);
        expect(() =>
            compiler.compile(
                createShader({
                    vertexSource: vertexSource.replace(
                        'layout(std430) readonly buffer',
                        'layout(std430, binding = 3) readonly buffer'
                    )
                }),
                'webgpu'
            )
        ).toThrow(/set and binding come from the descriptor ABI/u);
        expect(() => compiler.compile(createShader({ storageName: 'renamed' }), 'webgpu')).toThrow(
            /read-only-storage-buffer ABI binding renamed is absent from GLSL source/u
        );
    });

    it('validates the explicit sampled binding ABI against GLSL', () => {
        expect(() => compiler.compile(createShader({ sampleType: 'uint' }), 'webgpu')).toThrow(
            /sampleType uint does not match GLSL sampler2D/u
        );
    });

    it('specializes ordinary GLSL numeric depth sampling into a WGSL depth texture', () => {
        const compiled = compiler.compile(createShader({ sampleType: 'depth' }), 'webgpu');
        expect(compiled.fragment.code).toContain('texture_depth_2d');
        expect(compiled.fragment.reflection.bindings).toContainEqual(
            expect.objectContaining({ name: 'albedo', sampleType: 'depth' })
        );
    });

    it('preserves comparison samplers that Naga already translates as WGSL depth textures', () => {
        const shader = new StorageGraphicsShader({
            label: 'shadow-comparison',
            vertexSource,
            fragmentSource: fragmentSource
                .replace('uniform sampler2D albedo;', 'uniform sampler2DShadow albedo;')
                .replace(
                    'color = texture(albedo, uv) * lightGrid.lights[0];',
                    'color = vec4(texture(albedo, vec3(uv, 0.5))) * lightGrid.lights[0];'
                ),
            bindings: [
                { name: 'CameraBlock', group: 0, binding: 0, kind: 'uniform-buffer' },
                {
                    name: 'albedo',
                    group: 1,
                    binding: 4,
                    kind: 'sampled-texture',
                    sampleType: 'depth'
                },
                { name: 'albedo', group: 1, binding: 5, kind: 'comparison-sampler' },
                {
                    name: 'particles',
                    group: 2,
                    binding: 3,
                    kind: 'read-only-storage-buffer',
                    minBindingSize: 16
                },
                {
                    name: 'lightGrid',
                    group: 3,
                    binding: 1,
                    kind: 'read-only-storage-buffer'
                }
            ]
        });

        const compiled = compiler.compile(shader, 'webgpu');
        expect(compiled.fragment.code).toContain('texture_depth_2d');
        expect(compiled.fragment.code).toContain('sampler_comparison');
        expect(compiled.fragment.code).toContain('textureSampleCompare');
    });

    it('preserves the primary Naga failure when shader-module cleanup also runs', () => {
        const source = vertexSource.replace(
            'vec4 world = particles.positions[gl_VertexID];',
            `int particleIndex = gl_VertexID / 6;
    vec4 world = particles.positions[particleIndex];`
        );
        let failure: unknown;
        try {
            compiler.compile(createShader({ vertexSource: source }), 'webgpu');
        } catch (error: unknown) {
            failure = error;
        }

        expect(failure).toBeInstanceOf(StorageGraphicsCompilationError);
        if (!(failure instanceof StorageGraphicsCompilationError)) {
            throw new TypeError('Expected a storage graphics compilation error');
        }
        expect(String(failure.cause)).toContain('RuntimeError: unreachable');
        expect(String(failure.cause)).not.toContain('borrowed');
        expect(failure.message).not.toContain('borrowed');
    });

    it('clear invalidates the identity cache without changing immutable source objects', () => {
        const localCompiler = new StorageGraphicsShaderCompiler();
        const shader = createShader();
        return localCompiler.initialize().then(() => {
            expect(localCompiler.cacheGeneration).toBe(0);
            const first = localCompiler.compile(shader, 'webgpu');
            localCompiler.clear();
            expect(localCompiler.cacheGeneration).toBe(1);
            const second: CompiledStorageGraphicsShader = localCompiler.compile(shader, 'webgpu');
            expect(second).not.toBe(first);
            expect(second.token).toBeGreaterThan(first.token);
        });
    });
});
