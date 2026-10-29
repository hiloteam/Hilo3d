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

    it('checks the DDGI raster chunk retains the constrained readonly ABI', () => {
        const path = 'src/shader/chunk/dynamicGlobalIllumination.frag';
        expect(
            labels(path, 'layout(std430) readonly buffer DDGI { vec4 values[]; } probes;')
        ).toEqual([]);
        expect(labels(path, 'layout(std430) buffer DDGI { vec4 values[]; } probes;')).toContain(
            'StorageGraphicsShader storage block is not readonly std430'
        );
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

    it('distinguishes inherited complete shaders from owned replace and replaceAll fragments', () => {
        expect(
            labels(
                'src/render/DerivedStorage.ts',
                `
            function adapt(source: StorageGraphicsShader) {
                const chunk = 'layout(std430) readonly buffer Data { uint values[]; } data;';
                const vertexSource = source.vertexSource
                    .replace('layout(location=0) in vec3 position;', chunk)
                    .replaceAll('position', 'readPosition()');
                const descriptor = { vertexSource, fragmentSource: source.fragmentSource };
                return new StorageGraphicsShader({ ...descriptor, bindings: [] });
            }
        `
            )
        ).toEqual([]);
    });

    it('requires complete base sources and every conditional branch to retain an ES 3.10 header', () => {
        for (const base of ['void main() {}', '#version 300 es\nvoid main() {}']) {
            expect(
                labels(
                    'examples/BadDerivedStorage.ts',
                    `
                const base = ${JSON.stringify(base)};
                const aliased = base;
                new StorageGraphicsShader({
                    vertexSource: aliased.replace('position', 'readPosition()'),
                    fragmentSource: '#version 310 es\\nvoid main() {}'
                });
            `
                )
            ).toContain('StorageGraphicsShader source is not GLSL ES 3.10');
        }
        expect(
            labels(
                'examples/BadDerivedStorage.ts',
                `
            new StorageGraphicsShader({
                vertexSource: enabled ? '#version 310 es\\nvoid main() {}' : 'void main() {}',
                fragmentSource: '#version 310 es\\nvoid main() {}'
            });
        `
            )
        ).toContain('StorageGraphicsShader source is not GLSL ES 3.10');
    });

    it('retains readonly std430 validation for injected chunks and template interpolations', () => {
        for (const chunk of [
            'layout(std430) buffer Data { uint values[]; } data;',
            'readonly buffer Data { uint values[]; } data;',
            'layout(std140) readonly buffer Data { uint values[]; } data;'
        ]) {
            expect(
                labels(
                    'src/render/BadStorageChunk.ts',
                    `
                const chunk = ${JSON.stringify(chunk)};
                new StorageGraphicsShader({ vertexSource: source.vertexSource.replace('TOKEN', chunk) });
            `
                )
            ).toContain('StorageGraphicsShader storage block is not readonly std430');
        }
        expect(
            labels(
                'src/render/StorageTemplate.ts',
                `
            const chunk = 'layout(std430) readonly buffer Data { uint values[]; } data;';
            new StorageGraphicsShader({vertexSource: \`#version 310 es\n\${chunk}\nvoid main() {}\`});
        `
            )
        ).toEqual([]);
    });

    it('checks literal transformation results so qualifier removals cannot create writable storage', () => {
        for (const replacement of [
            `.replace('readonly ', '')`,
            `.replaceAll(/readonly /gu, '')`,
            `.replace('std430', 'std140')`
        ]) {
            expect(
                labels(
                    'src/render/MutatedStorage.ts',
                    `
                const base = '#version 310 es\\nlayout(std430) readonly buffer Data { uint values[]; } data;\\nvoid main() {}';
                new StorageGraphicsShader({ vertexSource: base${replacement} });
            `
                )
            ).toContain('StorageGraphicsShader storage block is not readonly std430');
        }
    });

    it('does not grant a fragment exemption when the same literal is also a complete shader', () => {
        expect(
            labels(
                'src/render/ReusedStorageChunk.ts',
                `
            const chunk = 'layout(std430) readonly buffer Data { uint values[]; } data;';
            new StorageGraphicsShader({ vertexSource: source.vertexSource.replace('TOKEN', chunk) });
            new StorageGraphicsShader({ vertexSource: chunk });
        `
            )
        ).toContain('StorageGraphicsShader source is not GLSL ES 3.10');
        expect(
            labels(
                'src/render/UnownedStorageChunk.ts',
                `
            const chunk = 'layout(std430) readonly buffer Data { uint values[]; } data;';
        `
            )
        ).toContain('storage graphics source is outside StorageGraphicsShader');
    });

    it('rejects version changes in replacement chunks and inherited-header edits', () => {
        expect(
            labels(
                'src/render/BadStorageVersion.ts',
                `
            new StorageGraphicsShader({vertexSource: source.vertexSource.replace('TOKEN', '#version 300 es')});
        `
            )
        ).toContain('StorageGraphicsShader source is not GLSL ES 3.10');
        for (const replacement of [
            `.replace('#version 310 es', '')`,
            `.replace(/#version[^\\n]*/u, '')`,
            `.replaceAll('310', '300')`,
            `.replace('310', () => nextVersion)`
        ]) {
            expect(
                labels(
                    'src/render/BadStorageVersion.ts',
                    `
                new StorageGraphicsShader({vertexSource: source.vertexSource${replacement}});
            `
                )
            ).toContain('StorageGraphicsShader transformation changes the GLSL ES 3.10 version');
        }
        expect(
            labels(
                'src/render/PreservedStorageVersion.ts',
                `
            new StorageGraphicsShader({vertexSource: source.vertexSource.replace('#version 310 es', '#version 310 es')});
        `
            )
        ).toEqual([]);
    });

    it('retains compute and handwritten graphics rejection inside transformed shader fragments', () => {
        for (const [chunk, expected] of [
            [
                '@compute @workgroup_size(1) fn main() {}',
                'Direct WGSL compute source is outside ComputeShader or a controlled fixture'
            ],
            ['@vertex fn main() {}', 'handwritten graphics WGSL source'],
            ['@fragment fn main() {}', 'handwritten graphics WGSL source'],
            ['layout(local_size_x=1) in;', 'GLSL compute dialect']
        ]) {
            expect(
                labels(
                    'src/render/BadStorageFragment.ts',
                    `
                new StorageGraphicsShader({vertexSource: source.vertexSource.replace('TOKEN', ${JSON.stringify(chunk)})});
            `
                )
            ).toContain(expected);
        }
        expect(
            labels(
                'src/render/OrdinaryWithStorageFragment.ts',
                `
            const chunk = 'layout(std430) readonly buffer Data { uint values[]; } data;';
            new Shader({vs: source.replace('TOKEN', chunk)});
            new StorageGraphicsShader({vertexSource: storage.vertexSource.replace('TOKEN', chunk)});
        `
            )
        ).toContain('ordinary Shader or Material uses GLSL ES 3.10 storage graphics');
    });

    it('preserves full-source regex context for no-op header matches while rejecting actual deletion', () => {
        const declaration = `const base = '#version 310 es\\nvoid main() {}\\n';`;
        for (const replacement of [
            `.replace(/#version[^\\n]*$/u, '')`,
            `.replaceAll(/#version[^\\n]*$/gu, '')`,
            `.replace(/^#version 310 es(?=\\n$)/u, '')`
        ]) {
            expect(
                labels(
                    'src/render/ContextualStorageHeader.ts',
                    `${declaration}\nnew StorageGraphicsShader({ vertexSource: base${replacement} });`
                )
            ).toEqual([]);
        }
        const removed = labels(
            'src/render/RemovedStorageHeader.ts',
            `${declaration}\nnew StorageGraphicsShader({ vertexSource: base.replace(/^#version[^\\n]*\\n/u, '') });`
        );
        expect(removed).toContain('StorageGraphicsShader source is not GLSL ES 3.10');
        expect(removed).toContain(
            'StorageGraphicsShader transformation changes the GLSL ES 3.10 version'
        );
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
