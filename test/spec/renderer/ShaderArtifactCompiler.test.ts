import { describe, expect, it } from 'vitest';
import { ShaderArtifactCompiler } from '../../../src/render/renderer/ShaderArtifactCompiler';
import Shader from '../../../src/shader/Shader';

const vertexSource = `#version 300 es
layout(std140) uniform CameraBlock {
    mat4 viewProjection;
};
in vec3 position;
in vec2 texCoord;
out vec2 uv;
void main() {
    uv = texCoord;
    gl_Position = viewProjection * vec4(position, 1.0);
}`;

const fragmentSource = `#version 300 es
precision highp float;
in vec2 uv;
layout(std140) uniform MaterialBlock {
    vec4 tint;
};
uniform sampler2D diffuseMap;
layout(location = 0) out vec4 color;
void main() {
    color = texture(diffuseMap, uv) * tint;
}`;

function createShader(): Shader {
    return new Shader({ vs: vertexSource, fs: fragmentSource });
}

describe('ShaderArtifactCompiler', () => {
    it('builds complete WebGL2 artifacts, reflection, and prepared bindings', () => {
        const compiler = new ShaderArtifactCompiler();
        const pair = compiler.compile(createShader(), 'webgl2');

        expect(pair.backend).toBe('webgl2');
        expect(pair.vertex).toMatchObject({
            backend: 'webgl2',
            stage: 'vertex',
            code: vertexSource,
            entryPoint: 'main',
            cacheKey: pair.token * 2
        });
        expect(pair.fragment).toMatchObject({
            backend: 'webgl2',
            stage: 'fragment',
            code: fragmentSource,
            entryPoint: 'main',
            cacheKey: pair.token * 2 + 1
        });
        expect(pair.metadata).toMatchObject({
            vertexInputs: [
                { name: 'position', type: 'vec3', location: 0, locationCount: 1 },
                { name: 'texCoord', type: 'vec2', location: 1, locationCount: 1 }
            ],
            fragmentOutputs: [{ name: 'color', type: 'vec4', location: 0 }],
            uniformBlocks: [
                {
                    name: 'CameraBlock',
                    group: 0,
                    binding: 1,
                    stages: ['vertex']
                },
                {
                    name: 'MaterialBlock',
                    group: 1,
                    binding: 0,
                    stages: ['fragment']
                }
            ],
            samplers: [
                {
                    name: 'diffuseMap',
                    arrayIndex: 0,
                    type: 'sampler2D',
                    group: 1,
                    textureBinding: 1,
                    samplerBinding: 2,
                    stages: ['fragment']
                }
            ]
        });
        expect(pair.vertex.reflection).toEqual({
            bindings: [
                {
                    group: 0,
                    binding: 1,
                    kind: 'uniform-buffer',
                    name: 'CameraBlock'
                }
            ],
            vertexInputs: [
                { location: 0, name: 'position' },
                { location: 1, name: 'texCoord' }
            ]
        });
        expect(pair.fragment.reflection).toEqual({
            bindings: [
                {
                    group: 1,
                    binding: 0,
                    kind: 'uniform-buffer',
                    name: 'MaterialBlock'
                },
                {
                    group: 1,
                    binding: 1,
                    kind: 'sampled-texture',
                    name: 'diffuseMap',
                    arrayIndex: 0,
                    sampleType: 'float',
                    viewDimension: '2d',
                    multisampled: false
                },
                {
                    group: 1,
                    binding: 2,
                    kind: 'sampler',
                    name: 'diffuseMap',
                    arrayIndex: 0
                }
            ],
            fragmentOutputs: [{ location: 0, name: 'color' }]
        });
        expect(pair.vertex.preparedBindings).toEqual({
            uniformBlocks: [{ name: 'CameraBlock', group: 0, binding: 1 }],
            combinedSamplers: []
        });
        expect(pair.fragment.preparedBindings).toEqual({
            uniformBlocks: [{ name: 'MaterialBlock', group: 1, binding: 0 }],
            combinedSamplers: [
                {
                    name: 'diffuseMap',
                    group: 1,
                    textureBinding: 1,
                    samplerBinding: 2,
                    arrayIndex: 0
                }
            ]
        });
        expect(Object.isFrozen(pair)).toBe(true);
        expect(Object.isFrozen(pair.vertex)).toBe(true);
        expect(Object.isFrozen(pair.vertex.reflection)).toBe(true);
        expect(Object.isFrozen(pair.vertex.preparedBindings)).toBe(true);
    });

    it('caches by shader identity and exact WebGL2 source, then invalidates either stage', () => {
        const compiler = new ShaderArtifactCompiler();
        const shader = createShader();
        const original = compiler.compile(shader, 'webgl2');

        expect(compiler.compile(shader, 'webgl2')).toBe(original);

        shader.vs = `${shader.vs}\n// vertex revision`;
        const vertexRevision = compiler.compile(shader, 'webgl2');
        expect(vertexRevision).not.toBe(original);
        expect(vertexRevision.token).toBeGreaterThan(original.token);
        expect(vertexRevision.vertex.code).toBe(shader.vs);
        expect(compiler.compile(shader, 'webgl2')).toBe(vertexRevision);

        shader.fs = `${shader.fs}\n// fragment revision`;
        const fragmentRevision = compiler.compile(shader, 'webgl2');
        expect(fragmentRevision).not.toBe(vertexRevision);
        expect(fragmentRevision.token).toBeGreaterThan(vertexRevision.token);
        expect(fragmentRevision.fragment.code).toBe(shader.fs);

        const sameSourceDifferentShader = new Shader({ vs: shader.vs, fs: shader.fs });
        const independent = compiler.compile(sameSourceDifferentShader, 'webgl2');
        expect(independent).not.toBe(fragmentRevision);
        expect(independent.token).toBeGreaterThan(fragmentRevision.token);
    });

    it('keeps an independent WebGL2 depth-only specialization with private color sinks', () => {
        const compiler = new ShaderArtifactCompiler();
        const shader = createShader();
        const color = compiler.compile(shader, 'webgl2');
        const depth = compiler.compile(shader, 'webgl2', { fragmentOutputs: 'depth-only' });

        expect(depth).not.toBe(color);
        expect(depth.fragmentOutputMode).toBe('depth-only');
        expect(depth.metadata.fragmentOutputs).toEqual([]);
        expect(depth.fragment.reflection).toMatchObject({ fragmentOutputs: [] });
        expect(depth.fragment.code).toContain('vec4 color;');
        expect(depth.fragment.code).not.toMatch(/\bout\s+vec4\s+color\b/u);
        expect(depth.fragment.code).toContain('color = texture(diffuseMap, uv) * tint;');
        expect(compiler.compile(shader, 'webgl2', { fragmentOutputs: 'depth-only' })).toBe(depth);
        expect(compiler.compile(shader, 'webgl2')).toBe(color);
    });

    it('reflects instanced matrix attributes on WebGL2 and InstanceBlock on WebGPU', async () => {
        const shader = new Shader({
            vs: `#version 300 es
#ifdef HILO_WEBGPU
layout(std140) uniform InstanceBlock {
    mat4 instanceModels[128];
    mat4 instanceNormals[128];
};
#define modelMatrix instanceModels[gl_InstanceIndex]
#else
in mat4 modelMatrix;
in mat3 normalMatrix;
#endif
in vec3 position;
void main() {
    gl_Position = modelMatrix * vec4(position, 1.0);
}`,
            fs: `#version 300 es
precision highp float;
layout(location = 0) out vec4 color;
void main() { color = vec4(1.0); }`
        });
        const compiler = new ShaderArtifactCompiler();
        const webgl = compiler.compile(shader, 'webgl2');

        expect(webgl.metadata.vertexInputs).toEqual([
            { name: 'modelMatrix', type: 'mat4', location: 0, locationCount: 4 },
            { name: 'normalMatrix', type: 'mat3', location: 4, locationCount: 3 },
            { name: 'position', type: 'vec3', location: 7, locationCount: 1 }
        ]);
        expect(webgl.metadata.uniformBlocks.some(block => block.name === 'InstanceBlock')).toBe(
            false
        );

        await compiler.initialize();
        const webgpu = compiler.compile(shader, 'webgpu');
        expect(webgpu.metadata.vertexInputs).toEqual([
            { name: 'position', type: 'vec3', location: 0, locationCount: 1 }
        ]);
        expect(webgpu.metadata.uniformBlocks).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'InstanceBlock', stages: ['vertex'] })
            ])
        );
    });

    it('requires initialization, translates WebGPU artifacts, and caches exact sources', async () => {
        const compiler = new ShaderArtifactCompiler();
        const shader = createShader();

        expect(compiler.initialized).toBe(false);
        expect(() => compiler.compile(shader, 'webgpu')).toThrow(
            'ShaderArtifactCompiler.initialize() is required for WebGPU'
        );
        await compiler.initialize();
        await compiler.initialize();
        expect(compiler.initialized).toBe(true);

        const translated = compiler.compile(shader, 'webgpu');
        expect(translated.backend).toBe('webgpu');
        expect(translated.vertex).toMatchObject({
            backend: 'webgpu',
            stage: 'vertex',
            entryPoint: 'main',
            cacheKey: translated.token * 2
        });
        expect(translated.fragment).toMatchObject({
            backend: 'webgpu',
            stage: 'fragment',
            entryPoint: 'main',
            cacheKey: translated.token * 2 + 1
        });
        expect(translated.vertex.code).toContain('@vertex');
        expect(translated.fragment.code).toContain('@fragment');
        expect(translated.vertex.code).not.toBe(vertexSource);
        expect(translated.fragment.code).not.toBe(fragmentSource);
        expect(translated.vertex.reflection).toEqual({
            bindings: [
                {
                    group: 0,
                    binding: 1,
                    kind: 'uniform-buffer',
                    name: 'CameraBlock'
                }
            ],
            vertexInputs: [
                { location: 0, name: 'position' },
                { location: 1, name: 'texCoord' }
            ]
        });
        expect(translated.fragment.reflection).toEqual({
            bindings: [
                {
                    group: 1,
                    binding: 0,
                    kind: 'uniform-buffer',
                    name: 'MaterialBlock'
                },
                {
                    group: 1,
                    binding: 1,
                    kind: 'sampled-texture',
                    name: 'diffuseMap',
                    arrayIndex: 0,
                    sampleType: 'float',
                    viewDimension: '2d',
                    multisampled: false
                },
                {
                    group: 1,
                    binding: 2,
                    kind: 'sampler',
                    name: 'diffuseMap',
                    arrayIndex: 0
                }
            ],
            fragmentOutputs: [{ location: 0, name: 'color' }]
        });
        expect(translated.vertex.preparedBindings).toBeUndefined();
        expect(translated.fragment.preparedBindings).toBeUndefined();
        expect(compiler.compile(shader, 'webgpu')).toBe(translated);

        shader.fs = `${shader.fs}\n// exact-source cache invalidation`;
        const invalidated = compiler.compile(shader, 'webgpu');
        expect(invalidated).not.toBe(translated);
        expect(invalidated.token).toBeGreaterThan(translated.token);
        expect(compiler.compile(shader, 'webgpu')).toBe(invalidated);
    });

    it('translates and independently caches a WebGPU depth-only specialization', async () => {
        const compiler = new ShaderArtifactCompiler();
        const shader = createShader();
        await compiler.initialize();
        const color = compiler.compile(shader, 'webgpu');
        const depth = compiler.compile(shader, 'webgpu', { fragmentOutputs: 'depth-only' });

        expect(depth).not.toBe(color);
        expect(depth.fragmentOutputMode).toBe('depth-only');
        expect(depth.metadata.fragmentOutputs).toEqual([]);
        expect(depth.fragment.reflection).toMatchObject({ fragmentOutputs: [] });
        expect(depth.fragment.code).toContain('@fragment');
        expect(depth.fragment.code).not.toMatch(/@location\(0\).*color/u);
        expect(compiler.compile(shader, 'webgpu', { fragmentOutputs: 'depth-only' })).toBe(depth);
        expect(compiler.compile(shader, 'webgpu')).toBe(color);
    });

    it('caches numeric-depth variants and specializes ordinary samplers on both backends', async () => {
        const compiler = new ShaderArtifactCompiler();
        const shader = createShader();
        const webglColor = compiler.compile(shader, 'webgl2');
        const webglDepth = compiler.compile(shader, 'webgl2', {
            numericDepthSamplerMask: 1
        });

        expect(webglDepth).not.toBe(webglColor);
        expect(webglDepth.numericDepthSamplerMask).toBe(1);
        expect(webglDepth.fragment.reflection.bindings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    name: 'diffuseMap',
                    kind: 'sampled-texture',
                    sampleType: 'depth'
                }),
                expect.objectContaining({ name: 'diffuseMap', kind: 'sampler' })
            ])
        );
        expect(compiler.compile(shader, 'webgl2', { numericDepthSamplerMask: 1 })).toBe(webglDepth);
        expect(compiler.compile(shader, 'webgl2')).toBe(webglColor);

        await compiler.initialize();
        const webgpuColor = compiler.compile(shader, 'webgpu');
        const webgpuDepth = compiler.compile(shader, 'webgpu', {
            numericDepthSamplerMask: 1
        });
        expect(webgpuDepth).not.toBe(webgpuColor);
        expect(webgpuDepth.fragment.code).toContain('texture_depth_2d');
        expect(webgpuDepth.fragment.reflection.bindings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    name: 'diffuseMap',
                    kind: 'sampled-texture',
                    sampleType: 'depth'
                }),
                expect.objectContaining({ name: 'diffuseMap', kind: 'sampler' })
            ])
        );
        expect(webgpuColor.fragment.code).not.toContain('texture_depth_2d');
        expect(() => compiler.compile(shader, 'webgl2', { numericDepthSamplerMask: 2 })).toThrow(
            'references a missing shader sampler'
        );
    });

    it('preserves sampler-array elements and specializes numeric depth by physical element', async () => {
        const shader = new Shader({
            vs: `#version 300 es
in vec2 position;
out vec2 uv;
void main() {
    uv = position * 0.5 + 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
}`,
            fs: `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D maps[2];
uniform highp sampler2DShadow shadowMaps[2];
layout(location = 0) out vec4 color;
void main() {
    float shadow = texture(shadowMaps[0], vec3(uv, 0.5))
        + texture(shadowMaps[1], vec3(uv, 0.5));
    color = texture(maps[0], uv) + texture(maps[1], uv) + vec4(shadow);
}`
        });
        const compiler = new ShaderArtifactCompiler();
        const webgl = compiler.compile(shader, 'webgl2', { numericDepthSamplerMask: 2 });
        const webglTextures = webgl.fragment.reflection.bindings.filter(
            binding => binding.kind === 'sampled-texture'
        );

        expect(webgl.metadata.samplers.map(binding => [binding.name, binding.arrayIndex])).toEqual([
            ['maps', 0],
            ['maps', 1],
            ['shadowMaps', 0],
            ['shadowMaps', 1]
        ]);
        expect(webglTextures).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    name: 'maps',
                    arrayIndex: 0,
                    sampleType: 'float'
                }),
                expect.objectContaining({
                    name: 'maps',
                    arrayIndex: 1,
                    sampleType: 'depth'
                }),
                expect.objectContaining({
                    name: 'shadowMaps',
                    arrayIndex: 0,
                    sampleType: 'depth'
                }),
                expect.objectContaining({
                    name: 'shadowMaps',
                    arrayIndex: 1,
                    sampleType: 'depth'
                })
            ])
        );
        expect(webgl.fragment.reflection.bindings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    name: 'shadowMaps',
                    arrayIndex: 0,
                    kind: 'comparison-sampler'
                }),
                expect.objectContaining({
                    name: 'shadowMaps',
                    arrayIndex: 1,
                    kind: 'comparison-sampler'
                })
            ])
        );
        expect(webgl.fragment.preparedBindings?.combinedSamplers).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'maps', arrayIndex: 0 }),
                expect.objectContaining({ name: 'maps', arrayIndex: 1 }),
                expect.objectContaining({ name: 'shadowMaps', arrayIndex: 0 }),
                expect.objectContaining({ name: 'shadowMaps', arrayIndex: 1 })
            ])
        );

        await compiler.initialize();
        const webgpu = compiler.compile(shader, 'webgpu', { numericDepthSamplerMask: 2 });
        expect(webgpu.fragment.reflection.bindings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    name: 'maps',
                    arrayIndex: 0,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                }),
                expect.objectContaining({
                    name: 'maps',
                    arrayIndex: 1,
                    kind: 'sampled-texture',
                    sampleType: 'depth'
                }),
                expect.objectContaining({
                    name: 'shadowMaps',
                    arrayIndex: 1,
                    kind: 'comparison-sampler'
                })
            ])
        );
    });

    it('clears records without reusing artifact tokens or cache keys', () => {
        const compiler = new ShaderArtifactCompiler();
        const shader = createShader();
        const beforeClear = compiler.compile(shader, 'webgl2');

        compiler.clear();
        const afterClear = compiler.compile(shader, 'webgl2');

        expect(afterClear).not.toBe(beforeClear);
        expect(afterClear.token).toBeGreaterThan(beforeClear.token);
        expect(afterClear.vertex.cacheKey).not.toBe(beforeClear.vertex.cacheKey);
        expect(afterClear.fragment.cacheKey).not.toBe(beforeClear.fragment.cacheKey);
        expect(compiler.compile(shader, 'webgl2')).toBe(afterClear);
    });
});
