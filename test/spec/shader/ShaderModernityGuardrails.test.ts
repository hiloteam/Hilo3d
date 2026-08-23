import { describe, expect, it } from 'vitest';
import { collectShaderModernityViolations } from '../../../scripts/shader-modernity';

function labels(path: string, source: string): readonly string[] {
    return collectShaderModernityViolations(path, source).map(violation => violation.label);
}

describe('shader source modernity guardrails', () => {
    it('allows Direct WGSL only through ComputeShader and controlled low-level fixtures', () => {
        expect(
            labels(
                'examples/compute_particles.ts',
                `const shader = new Hilo3d.ComputeShader({
                    source: \`@compute @workgroup_size(64) fn main() {}\`,
                    workgroupSize: [64],
                    bindings: []
                });`
            )
        ).toEqual([]);
        expect(
            labels(
                'test/spec/rhi/portable/WebGPUBackend.native.test.ts',
                `device.createShader({ artifact: {
                    stage: 'compute',
                    code: '@compute @workgroup_size(1) fn main() {}'
                }});`
            )
        ).toEqual([]);
        expect(
            labels(
                'test/spec/rhi/portable/WebGPUBackend.test.ts',
                `device.createShader({ artifact: {
                    stage: 'vertex',
                    code: '@vertex fn main() -> @builtin(position) vec4f { return vec4f(); }'
                }});`
            )
        ).toEqual([]);
    });

    it('allows readonly std430 GLSL ES 3.10 only through StorageGraphicsShader', () => {
        expect(
            labels(
                'examples/storage_particles.ts',
                `const shader = new Hilo3d.StorageGraphicsShader({
                    vertexSource: \`#version 310 es
                        layout(std430) readonly buffer Particles { vec4 positions[]; } particles;
                        void main() { gl_Position = particles.positions[gl_VertexID]; }\`,
                    fragmentSource: \`#version 310 es
                        precision highp float;
                        layout(location = 0) out vec4 color;
                        void main() { color = vec4(1.0); }\`,
                    bindings: []
                });`
            )
        ).toEqual([]);
    });

    it('rejects WGSL passed to ordinary Shader or Material descriptors', () => {
        expect(
            labels(
                'examples/bad_shader.ts',
                `new Hilo3d.Shader({
                    vs: '@vertex fn main() -> @builtin(position) vec4f { return vec4f(); }',
                    fs: '@fragment fn main() -> @location(0) vec4f { return vec4f(); }'
                });`
            )
        ).toContain('ordinary Shader or Material uses handwritten WGSL');
        expect(
            labels(
                'test/spec/material/BadMaterial.test.ts',
                `new Material({
                    shaderSource: '@fragment fn main() -> @location(0) vec4f { return vec4f(); }'
                });`
            )
        ).toContain('ordinary Shader or Material uses handwritten WGSL');
    });

    it('rejects graphics stages in ComputeShader and unowned Direct WGSL compute', () => {
        expect(
            labels(
                'examples/compute_bad.ts',
                `new ComputeShader({
                    source: '@compute @workgroup_size(1) fn main() {} @vertex fn graphics() {}',
                    workgroupSize: [1],
                    bindings: []
                });`
            )
        ).toContain('ComputeShader source declares a graphics WGSL entry point');
        expect(
            labels(
                'src/render/UnownedCompute.ts',
                `const source = '@compute @workgroup_size(1) fn main() {}';`
            )
        ).toContain('Direct WGSL compute source is outside ComputeShader or a controlled fixture');
    });

    it('rejects parallel WGSL files and GLSL compute dialects', () => {
        expect(labels('examples/shaders/particles.wgsl', '@compute fn main() {}')).toEqual([
            'parallel handwritten WGSL shader file'
        ]);
        expect(
            labels(
                'examples/glsl_compute.ts',
                `new ComputeShader({
                    source: \`#version 310 es
                        layout(local_size_x = 64) in;
                        void main() { uint i = gl_GlobalInvocationID.x; }\`,
                    workgroupSize: [64],
                    bindings: []
                });`
            )
        ).toContain('GLSL compute dialect');
    });

    it('does not mistake ordinary shared-renderer prose for a GLSL shared declaration', () => {
        expect(
            labels(
                'src/render/SharedRendererDescription.ts',
                `const description = 'The shared renderer owns backend-neutral resources';`
            )
        ).toEqual([]);
    });

    it('rejects ES 3.10 storage declarations in ordinary graphics paths', () => {
        expect(
            labels(
                'examples/bad_storage_shader.ts',
                `new Shader({
                    vs: \`#version 310 es
                        layout(std430) readonly buffer Data { vec4 values[]; } data;
                        void main() { gl_Position = data.values[gl_VertexID]; }\`,
                    fs: '#version 310 es\\nvoid main() {}'
                });`
            )
        ).toContain('ordinary Shader or Material uses GLSL ES 3.10 storage graphics');
        expect(
            labels(
                'examples/bad_storage_contract.ts',
                `new StorageGraphicsShader({
                    vertexSource: \`#version 310 es
                        layout(std430) buffer Data { vec4 values[]; } data;
                        void main() { gl_Position = data.values[gl_VertexID]; }\`,
                    fragmentSource: '#version 310 es\\nvoid main() {}',
                    bindings: []
                });`
            )
        ).toContain('StorageGraphicsShader storage block is not readonly std430');
        expect(
            labels(
                'examples/missing_std430.ts',
                `new StorageGraphicsShader({
                    vertexSource: \`#version 310 es
                        readonly buffer Data { vec4 values[]; } data;
                        void main() { gl_Position = data.values[gl_VertexID]; }\`,
                    fragmentSource: '#version 310 es\\nvoid main() {}',
                    bindings: []
                });`
            )
        ).toContain('StorageGraphicsShader storage block is not readonly std430');
    });

    it('allows the reviewed clustered storage chunk but keeps ordinary chunks closed', () => {
        const source = `#ifdef HILO_CLUSTERED_FORWARD
            layout(std430) readonly buffer Lights { vec4 values[]; } lights;
            #endif`;
        expect(labels('src/shader/chunk/clusteredForward.frag', source)).toEqual([]);
        expect(labels('src/shader/chunk/ordinary.frag', source)).toContain(
            'ordinary graphics shader declares storage buffer'
        );
    });
});
