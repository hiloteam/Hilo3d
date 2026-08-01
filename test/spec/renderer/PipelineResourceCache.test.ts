import { describe, expect, it, vi } from 'vitest';
import { TRIANGLES, TRIANGLE_STRIP } from '../../../src/constants/webgl';
import Material from '../../../src/material/Material';
import type { RHITextureFormat, RHIVertexBufferLayout } from '../../../src/render/rhi/core';
import { PipelineResourceCache } from '../../../src/render/renderer/PipelineResourceCache';
import type { RHIMeshDrawTargetDescriptor } from '../../../src/render/renderer/RHIDescriptorMapping';
import { ResourceRegistry } from '../../../src/render/renderer/ResourceRegistry';
import { ShaderArtifactCompiler } from '../../../src/render/renderer/ShaderArtifactCompiler';
import { ShaderResourceCache } from '../../../src/render/renderer/ShaderResourceCache';
import Shader from '../../../src/shader/Shader';
import { FakeWebGLRHIBackend, type FakeRHIDevice } from '../rhi/portable/FakeRHIBackend';

const pipelineCacheSources = import.meta.glob<string>(
    '../../../src/render/renderer/PipelineResourceCache.ts',
    { eager: true, query: '?raw', import: 'default' }
);

const vertexSource = `#version 300 es
in vec3 position;
void main() {
    gl_Position = vec4(position, 1.0);
}`;

const fragmentSource = `#version 300 es
precision highp float;
layout(location = 0) out vec4 color;
void main() {
    color = vec4(1.0);
}`;

const uniformFragmentSource = `#version 300 es
precision highp float;
layout(std140) uniform MaterialBlock {
    vec4 tint;
};
layout(location = 0) out vec4 color;
void main() {
    color = tint;
}`;

const sampledFragmentSource = `#version 300 es
precision highp float;
uniform sampler2D sourceMap;
layout(location = 0) out vec4 color;
void main() {
    color = texture(sourceMap, vec2(0.5));
}`;

const sceneTextureFragmentSource = `#version 300 es
precision highp float;
uniform sampler2D u_opaqueTexture;
layout(location = 0) out vec4 color;
void main() {
    color = texture(u_opaqueTexture, vec2(0.5));
}`;

const layeredSceneTextureFragmentSource = `#version 300 es
precision highp float;
uniform sampler2D detailMap;
uniform sampler2D u_opaqueTexture;
layout(location = 0) out vec4 color;
void main() {
    color = texture(u_opaqueTexture, vec2(0.5)) * texture(detailMap, vec2(0.5));
}`;

interface CacheFixture {
    readonly backend: FakeWebGLRHIBackend;
    readonly device: FakeRHIDevice;
    readonly registry: ResourceRegistry;
    readonly compiler: ShaderArtifactCompiler;
    readonly shaders: ShaderResourceCache;
    readonly pipelines: PipelineResourceCache;
}

function createFixture(): CacheFixture {
    const backend = new FakeWebGLRHIBackend();
    const device = backend.createDevice();
    const registry = new ResourceRegistry(device);
    const compiler = new ShaderArtifactCompiler();
    const shaders = new ShaderResourceCache(registry, compiler);
    const pipelines = new PipelineResourceCache(registry, shaders, compiler);
    return { backend, device, registry, compiler, shaders, pipelines };
}

function shader(fragment = fragmentSource): Shader {
    return new Shader({ vs: vertexSource, fs: fragment });
}

function vertexLayout(arrayStride = 12): RHIVertexBufferLayout {
    return {
        arrayStride,
        stepMode: 'vertex',
        attributes: [{ format: 'float32x3', offset: 0, shaderLocation: 0 }]
    };
}

function target(colorFormat: RHITextureFormat = 'rgba8unorm'): RHIMeshDrawTargetDescriptor {
    return {
        colorFormats: [colorFormat],
        depthStencilFormat: 'depth24plus',
        sampleCount: 1
    };
}

describe('PipelineResourceCache', () => {
    it('keys otherwise identical pipelines by depth convention', () => {
        const fixture = createFixture();
        const source = shader(fragmentSource);
        const layout = vertexLayout();
        const material = new Material();
        const drawTarget = target();
        const standard = fixture.pipelines.prepare(source, layout, material, drawTarget);
        const reversed = fixture.pipelines.prepare(
            source,
            layout,
            material,
            drawTarget,
            'color',
            TRIANGLES,
            undefined,
            0,
            'reversed'
        );
        expect(reversed).not.toBe(standard);
        expect(
            fixture.pipelines.resolve(reversed).pipeline.descriptor.depthStencil?.depthCompare
        ).toBe('greater-equal');
        fixture.pipelines.destroy();
        fixture.shaders.destroy();
        fixture.registry.collect(0);
        fixture.registry.destroy();
        fixture.backend.destroy();
    });

    it('shares the pass-global opaque texture layout across material shader variants', () => {
        const fixture = createFixture();
        const first = fixture.pipelines.prepare(
            shader(sceneTextureFragmentSource),
            vertexLayout(),
            new Material(),
            target()
        );
        const second = fixture.pipelines.prepare(
            shader(layeredSceneTextureFragmentSource),
            vertexLayout(),
            new Material(),
            target()
        );

        expect(first.bindingPlan.getSampledBinding('u_opaqueTexture')).toMatchObject({
            group: 3,
            textureBinding: 0,
            samplerBinding: 1
        });
        expect(second.bindingPlan.getSampledBinding('u_opaqueTexture')).toMatchObject({
            group: 3,
            textureBinding: 0,
            samplerBinding: 1
        });
        expect(first.bindGroupLayouts[3]).toBe(second.bindGroupLayouts[3]);
        expect(fixture.pipelines.resolve(first).bindGroupLayouts[3]).toBe(
            fixture.pipelines.resolve(second).bindGroupLayouts[3]
        );

        fixture.pipelines.destroy();
        fixture.shaders.destroy();
        fixture.registry.collect(0);
        fixture.registry.destroy();
        fixture.backend.destroy();
    });

    it('keeps ordinary-color and numeric-depth sampler pipeline buckets independent', () => {
        const fixture = createFixture();
        const source = shader(sampledFragmentSource);
        const material = new Material();
        const layout = vertexLayout();
        const renderTarget = target();

        const color = fixture.pipelines.prepare(source, layout, material, renderTarget);
        const numericDepth = fixture.pipelines.prepare(
            source,
            layout,
            material,
            renderTarget,
            'color',
            TRIANGLES,
            undefined,
            1
        );

        expect(numericDepth).not.toBe(color);
        expect(numericDepth.bindingLayoutToken).not.toBe(color.bindingLayoutToken);
        expect(numericDepth.bindingPlan.bindGroupLayoutDescriptors[1]?.entries).toEqual([
            {
                binding: 1,
                visibility: 2,
                texture: { sampleType: 'depth' }
            },
            {
                binding: 2,
                visibility: 2,
                sampler: { type: 'non-filtering' }
            }
        ]);
        expect(
            fixture.pipelines.prepare(
                source,
                layout,
                material,
                renderTarget,
                'color',
                TRIANGLES,
                undefined,
                1
            )
        ).toBe(numericDepth);
        expect(fixture.pipelines.prepare(source, layout, material, renderTarget)).toBe(color);

        fixture.pipelines.destroy();
        fixture.shaders.destroy();
        fixture.registry.destroy();
        fixture.backend.destroy();
    });

    it('supports an empty binding plan and shares an exact equivalent pipeline', () => {
        const fixture = createFixture();
        const createBindGroupLayout = vi.spyOn(fixture.device, 'createBindGroupLayout');
        const createPipelineLayout = vi.spyOn(fixture.device, 'createPipelineLayout');
        const createGraphicsPipeline = vi.spyOn(fixture.device, 'createGraphicsPipeline');
        const source = shader();

        const record = fixture.pipelines.prepare(source, vertexLayout(), new Material(), target());
        const resolved = fixture.pipelines.resolve(record);

        expect(Object.isFrozen(record)).toBe(true);
        expect(record).toMatchObject({
            bindingLayoutToken: 1,
            shaderToken: 1,
            bindGroupLayouts: []
        });
        expect(record.bindingPlan.bindGroupLayoutDescriptors).toEqual([]);
        expect(record.bindingPlan.uniformBlocks).toEqual([]);
        expect(resolved.bindGroupLayouts).toEqual([]);
        expect(resolved.pipelineLayout.bindGroupLayouts).toEqual([]);
        expect(resolved.pipeline.descriptor.layout).toBe(resolved.pipelineLayout);
        expect(resolved.pipeline.descriptor.vertex.shader.stage).toBe('vertex');
        expect(resolved.pipeline.descriptor.fragment?.shader.stage).toBe('fragment');
        expect(createBindGroupLayout).not.toHaveBeenCalled();
        expect(createPipelineLayout).toHaveBeenCalledTimes(1);
        expect(createGraphicsPipeline).toHaveBeenCalledTimes(1);

        const equivalent = fixture.pipelines.prepare(source, vertexLayout(), new Material(), {
            colorFormats: ['rgba8unorm'],
            depthStencilFormat: 'depth24plus',
            sampleCount: 1
        });
        expect(equivalent).toBe(record);
        expect(createPipelineLayout).toHaveBeenCalledTimes(1);
        expect(createGraphicsPipeline).toHaveBeenCalledTimes(1);
        expect(fixture.pipelines.metrics).toMatchObject({
            hits: 1,
            misses: 1,
            evictions: 0,
            size: 1,
            highWater: 1
        });

        fixture.pipelines.destroy();
        expect(fixture.pipelines.metrics).toMatchObject({ evictions: 1, size: 0, highWater: 1 });
        fixture.shaders.destroy();
        expect(fixture.registry.collect(0)).toBe(4);
        fixture.registry.destroy();
        fixture.backend.destroy();
    });

    it('returns the exact last material request before descriptor snapshots and capability work', () => {
        const fixture = createFixture();
        const source = shader();
        const layout = vertexLayout();
        const material = new Material();
        const renderTarget = target();
        const getFormatCapabilities = vi.spyOn(
            fixture.device.capabilities,
            'getTextureFormatCapabilities'
        );
        const record = fixture.pipelines.prepare(source, layout, material, renderTarget);
        getFormatCapabilities.mockClear();

        expect(fixture.pipelines.prepare(source, layout, material, renderTarget)).toBe(record);
        expect(getFormatCapabilities).not.toHaveBeenCalled();

        material.cullFace = false;
        expect(fixture.pipelines.prepare(source, layout, material, renderTarget)).not.toBe(record);
        expect(getFormatCapabilities).toHaveBeenCalled();

        fixture.pipelines.destroy();
        fixture.shaders.destroy();
        fixture.registry.collect(0);
        fixture.registry.destroy();
        fixture.backend.destroy();
    });

    it('retains a direct request fast path for every stable vertex-layout identity per material', () => {
        const fixture = createFixture();
        const source = shader();
        const firstLayout = vertexLayout();
        const secondLayout = vertexLayout();
        const material = new Material();
        const renderTarget = target();
        const getFormatCapabilities = vi.spyOn(
            fixture.device.capabilities,
            'getTextureFormatCapabilities'
        );

        const first = fixture.pipelines.prepare(source, firstLayout, material, renderTarget);
        const second = fixture.pipelines.prepare(source, secondLayout, material, renderTarget);
        expect(second).toBe(first);
        getFormatCapabilities.mockClear();

        expect(fixture.pipelines.prepare(source, firstLayout, material, renderTarget)).toBe(first);
        expect(fixture.pipelines.prepare(source, secondLayout, material, renderTarget)).toBe(first);
        expect(getFormatCapabilities).not.toHaveBeenCalled();

        material.cullFace = false;
        expect(fixture.pipelines.prepare(source, firstLayout, material, renderTarget)).not.toBe(
            first
        );
        expect(getFormatCapabilities).toHaveBeenCalled();

        fixture.pipelines.destroy();
        fixture.shaders.destroy();
        fixture.registry.collect(0);
        fixture.registry.destroy();
        fixture.backend.destroy();
    });

    it('detects in-place mutable vertex-layout changes and reuses prior layout records', () => {
        const fixture = createFixture();
        const source = shader();
        const layout = vertexLayout();
        const material = new Material();
        const renderTarget = target();
        const getFormatCapabilities = vi.spyOn(
            fixture.device.capabilities,
            'getTextureFormatCapabilities'
        );
        const first = fixture.pipelines.prepare(source, layout, material, renderTarget);
        const attribute = layout.attributes[0];
        if (attribute === undefined) throw new Error('Expected the test vertex attribute');
        getFormatCapabilities.mockClear();

        Reflect.set(layout, 'arrayStride', 16);
        const strideVariant = fixture.pipelines.prepare(source, layout, material, renderTarget);
        expect(strideVariant).not.toBe(first);

        Reflect.set(attribute, 'offset', 4);
        const attributeVariant = fixture.pipelines.prepare(source, layout, material, renderTarget);
        expect(attributeVariant).not.toBe(strideVariant);

        Reflect.set(layout, 'arrayStride', 12);
        Reflect.set(attribute, 'offset', 0);
        getFormatCapabilities.mockClear();
        expect(fixture.pipelines.prepare(source, layout, material, renderTarget)).toBe(first);
        expect(getFormatCapabilities).not.toHaveBeenCalled();

        fixture.pipelines.destroy();
        fixture.shaders.destroy();
        fixture.registry.collect(0);
        fixture.registry.destroy();
        fixture.backend.destroy();
    });

    it('reuses material state and target variants when requests return from B to A', () => {
        const fixture = createFixture();
        const source = shader();
        const layout = vertexLayout();
        const material = new Material();
        const renderTarget = target();
        const getFormatCapabilities = vi.spyOn(
            fixture.device.capabilities,
            'getTextureFormatCapabilities'
        );
        const base = fixture.pipelines.prepare(source, layout, material, renderTarget);

        material.cullFace = false;
        const stateVariant = fixture.pipelines.prepare(source, layout, material, renderTarget);
        expect(stateVariant).not.toBe(base);
        material.cullFace = true;
        getFormatCapabilities.mockClear();
        expect(fixture.pipelines.prepare(source, layout, material, renderTarget)).toBe(base);
        expect(getFormatCapabilities).not.toHaveBeenCalled();

        Reflect.set(renderTarget.colorFormats, 0, 'bgra8unorm');
        const targetVariant = fixture.pipelines.prepare(source, layout, material, renderTarget);
        expect(targetVariant).not.toBe(base);
        Reflect.set(renderTarget.colorFormats, 0, 'rgba8unorm');
        getFormatCapabilities.mockClear();
        expect(fixture.pipelines.prepare(source, layout, material, renderTarget)).toBe(base);
        expect(getFormatCapabilities).not.toHaveBeenCalled();

        fixture.pipelines.destroy();
        fixture.shaders.destroy();
        fixture.registry.collect(0);
        fixture.registry.destroy();
        fixture.backend.destroy();
    });

    it('shares one state variant across 10k deep-frozen vertex-layout identities', () => {
        const fixture = createFixture();
        const source = shader();
        const material = new Material();
        const renderTarget = target();
        const getFormatCapabilities = vi.spyOn(
            fixture.device.capabilities,
            'getTextureFormatCapabilities'
        );
        const firstLayout = Object.freeze({
            arrayStride: 12,
            stepMode: 'vertex' as const,
            attributes: Object.freeze([
                Object.freeze({ format: 'float32x3' as const, offset: 0, shaderLocation: 0 })
            ])
        });
        const record = fixture.pipelines.prepare(source, firstLayout, material, renderTarget);
        getFormatCapabilities.mockClear();

        const retainedLayouts = new Array<RHIVertexBufferLayout>(10_000);
        for (let index = 0; index < retainedLayouts.length; index += 1) {
            const layout = Object.freeze({
                arrayStride: 12,
                stepMode: 'vertex' as const,
                attributes: Object.freeze([
                    Object.freeze({
                        format: 'float32x3' as const,
                        offset: 0,
                        shaderLocation: 0
                    })
                ])
            });
            retainedLayouts[index] = layout;
            expect(fixture.pipelines.prepare(source, layout, material, renderTarget)).toBe(record);
        }

        expect(getFormatCapabilities).not.toHaveBeenCalled();
        expect(fixture.pipelines.metrics).toMatchObject({
            hits: 10_000,
            misses: 1,
            size: 1,
            highWater: 1
        });

        fixture.pipelines.destroy();
        fixture.shaders.destroy();
        fixture.registry.collect(0);
        fixture.registry.destroy();
        fixture.backend.destroy();
    });

    it('retains independent color and depth-only pipelines for one Shader identity', () => {
        const fixture = createFixture();
        const source = shader();
        const layout = vertexLayout();
        const material = new Material();
        const createGraphicsPipeline = vi.spyOn(fixture.device, 'createGraphicsPipeline');

        const colorRecord = fixture.pipelines.prepare(source, layout, material, target());
        const color = fixture.pipelines.resolve(colorRecord);
        const depthRecord = fixture.pipelines.prepare(
            source,
            layout,
            material,
            { colorFormats: [], depthStencilFormat: 'depth24plus', sampleCount: 1 },
            'depth-only'
        );
        const depth = fixture.pipelines.resolve(depthRecord);

        expect(depthRecord).not.toBe(colorRecord);
        expect(depthRecord.fragmentOutputMode).toBe('depth-only');
        expect(depth.pipeline.descriptor.fragment?.targets).toEqual([]);
        expect(
            depth.pipeline.descriptor.fragment?.shader.artifact.reflection.fragmentOutputs
        ).toEqual([]);
        expect(depth.pipeline.descriptor.depthStencil).toMatchObject({
            format: 'depth24plus',
            depthWriteEnabled: true
        });
        expect(fixture.pipelines.prepare(source, layout, material, target())).toBe(colorRecord);
        expect(fixture.pipelines.resolve(colorRecord).pipeline).toBe(color.pipeline);
        expect(
            fixture.pipelines.prepare(
                source,
                layout,
                material,
                { colorFormats: [], depthStencilFormat: 'depth24plus', sampleCount: 1 },
                'depth-only'
            )
        ).toBe(depthRecord);
        expect(createGraphicsPipeline).toHaveBeenCalledTimes(2);

        fixture.pipelines.destroy();
        fixture.shaders.destroy();
        fixture.registry.collect(0);
        fixture.registry.destroy();
        fixture.backend.destroy();
    });

    it('maps compiled fragment reflection onto sparse MRT write masks', () => {
        const fixture = createFixture();
        const record = fixture.pipelines.prepare(shader(), vertexLayout(), new Material(), {
            colorFormats: ['rgba8unorm', 'rgba16float'],
            depthStencilFormat: 'depth24plus',
            sampleCount: 1
        });

        expect(fixture.pipelines.resolve(record).pipeline.descriptor.fragment?.targets).toEqual([
            { format: 'rgba8unorm', writeMask: 0xf },
            { format: 'rgba16float', writeMask: 0 }
        ]);

        fixture.pipelines.destroy();
        fixture.shaders.destroy();
        fixture.registry.collect(0);
        fixture.registry.destroy();
        fixture.backend.destroy();
    });

    it('preserves multiple vertex-buffer slots and reuses an exact layout plan', () => {
        const fixture = createFixture();
        const source = shader();
        const material = new Material();
        const renderTarget = target();
        const layouts = Object.freeze([
            vertexLayout(),
            Object.freeze({
                arrayStride: 8,
                stepMode: 'vertex' as const,
                attributes: Object.freeze([
                    Object.freeze({
                        format: 'float32x2' as const,
                        offset: 0,
                        shaderLocation: 1
                    })
                ])
            })
        ]);
        const createGraphicsPipeline = vi.spyOn(fixture.device, 'createGraphicsPipeline');

        const record = fixture.pipelines.prepare(source, layouts, material, renderTarget);
        expect(fixture.pipelines.prepare(source, layouts, material, renderTarget)).toBe(record);
        expect(fixture.pipelines.resolve(record).pipeline.descriptor.vertex.buffers).toEqual(
            layouts
        );
        expect(fixture.pipelines.resolve(record).pipeline.descriptor.vertex.buffers).not.toBe(
            layouts
        );
        expect(createGraphicsPipeline).toHaveBeenCalledTimes(1);

        fixture.pipelines.destroy();
        fixture.shaders.destroy();
        fixture.registry.collect(0);
        fixture.registry.destroy();
        fixture.backend.destroy();
    });

    it('keys portable primitive topology and indexed-strip format independently', () => {
        const fixture = createFixture();
        const source = shader();
        const layout = vertexLayout();
        const material = new Material();
        const renderTarget = target();
        const triangle = fixture.pipelines.prepare(source, layout, material, renderTarget);
        const strip = fixture.pipelines.prepare(
            source,
            layout,
            material,
            renderTarget,
            'color',
            TRIANGLE_STRIP,
            'uint16'
        );

        expect(strip).not.toBe(triangle);
        expect(fixture.pipelines.resolve(strip).pipeline.descriptor.primitive).toMatchObject({
            topology: 'triangle-strip',
            stripIndexFormat: 'uint16'
        });
        expect(
            fixture.pipelines.prepare(
                source,
                layout,
                material,
                renderTarget,
                'color',
                TRIANGLE_STRIP,
                'uint16'
            )
        ).toBe(strip);

        fixture.pipelines.destroy();
        fixture.shaders.destroy();
        fixture.registry.collect(0);
        fixture.registry.destroy();
        fixture.backend.destroy();
    });

    it('creates continuous uniform layouts without creating bind groups', () => {
        const fixture = createFixture();
        const createBindGroup = vi.spyOn(fixture.device, 'createBindGroup');
        const source = shader(uniformFragmentSource);

        const record = fixture.pipelines.prepare(source, vertexLayout(), new Material(), target());
        const resolved = fixture.pipelines.resolve(record);

        expect(record.bindingPlan.activeGroupIndices).toEqual([1]);
        expect(record.bindingPlan.uniformBlocks).toEqual([
            {
                name: 'MaterialBlock',
                group: 1,
                binding: 0,
                visibility: 2
            }
        ]);
        expect(record.bindGroupLayouts).toHaveLength(2);
        expect(resolved.bindGroupLayouts[0]?.entries).toEqual([]);
        expect(resolved.bindGroupLayouts[1]?.entries).toEqual([
            {
                binding: 0,
                visibility: 2,
                buffer: { type: 'uniform' }
            }
        ]);
        expect(resolved.pipelineLayout.bindGroupLayouts).toEqual(resolved.bindGroupLayouts);
        expect(createBindGroup).not.toHaveBeenCalled();

        fixture.pipelines.destroy();
        fixture.shaders.destroy();
        expect(fixture.registry.collect(0)).toBe(6);
        fixture.registry.destroy();
        fixture.backend.destroy();
    });

    it('misses independently for exact vertex layout, mapped state, and target changes', () => {
        const fixture = createFixture();
        const createPipelineLayout = vi.spyOn(fixture.device, 'createPipelineLayout');
        const createGraphicsPipeline = vi.spyOn(fixture.device, 'createGraphicsPipeline');
        const source = shader();
        const base = fixture.pipelines.prepare(source, vertexLayout(), new Material(), target());

        const layoutMiss = fixture.pipelines.prepare(
            source,
            vertexLayout(16),
            new Material(),
            target()
        );
        const stateMiss = fixture.pipelines.prepare(
            source,
            vertexLayout(),
            new Material({ cullFace: false }),
            target()
        );
        const targetMiss = fixture.pipelines.prepare(
            source,
            vertexLayout(),
            new Material(),
            target('bgra8unorm')
        );

        expect(layoutMiss).not.toBe(base);
        expect(stateMiss).not.toBe(base);
        expect(targetMiss).not.toBe(base);
        expect(
            new Set([base.pipeline, layoutMiss.pipeline, stateMiss.pipeline, targetMiss.pipeline])
                .size
        ).toBe(4);
        expect(layoutMiss.pipelineLayout).toBe(base.pipelineLayout);
        expect(stateMiss.pipelineLayout).toBe(base.pipelineLayout);
        expect(targetMiss.pipelineLayout).toBe(base.pipelineLayout);
        expect(layoutMiss.bindingLayoutToken).toBe(base.bindingLayoutToken);
        expect(createPipelineLayout).toHaveBeenCalledTimes(1);
        expect(createGraphicsPipeline).toHaveBeenCalledTimes(4);

        fixture.pipelines.destroy();
        fixture.shaders.destroy();
        expect(fixture.registry.collect(0)).toBe(7);
        fixture.registry.destroy();
        fixture.backend.destroy();
    });

    it('invalidates every old shader bucket when the artifact token changes', () => {
        const fixture = createFixture();
        const source = shader();
        const layout = vertexLayout();
        const material = new Material();
        const renderTarget = target();
        const firstRecord = fixture.pipelines.prepare(source, layout, material, renderTarget);
        const first = fixture.pipelines.resolve(firstRecord);
        const stateVariantRecord = fixture.pipelines.prepare(
            source,
            vertexLayout(),
            new Material({ cullFace: false }),
            target()
        );
        const stateVariant = fixture.pipelines.resolve(stateVariantRecord);
        const firstVertexShader = first.pipeline.descriptor.vertex.shader;
        const firstFragmentShader = first.pipeline.descriptor.fragment?.shader;
        source.fs = `${source.fs}\n// artifact revision`;

        const replacementRecord = fixture.pipelines.prepare(source, layout, material, renderTarget);
        const replacement = fixture.pipelines.resolve(replacementRecord);

        expect(replacementRecord.shaderToken).toBeGreaterThan(firstRecord.shaderToken);
        expect(replacementRecord.bindingLayoutToken).toBeGreaterThan(
            firstRecord.bindingLayoutToken
        );
        expect(replacementRecord.pipeline).not.toBe(firstRecord.pipeline);
        expect(() => fixture.pipelines.resolve(firstRecord)).toThrow(
            'Pipeline resource record is stale or belongs to another cache'
        );
        expect(() => fixture.pipelines.resolve(stateVariantRecord)).toThrow(
            'Pipeline resource record is stale or belongs to another cache'
        );
        expect(fixture.registry.collect(0)).toBe(5);
        expect(first.pipeline.destroyed).toBe(true);
        expect(stateVariant.pipeline.destroyed).toBe(true);
        expect(first.pipelineLayout.destroyed).toBe(true);
        expect(firstVertexShader.destroyed).toBe(true);
        expect(firstFragmentShader?.destroyed).toBe(true);
        expect(replacement.pipeline.destroyed).toBe(false);

        fixture.pipelines.destroy();
        fixture.shaders.destroy();
        expect(fixture.registry.collect(0)).toBe(4);
        fixture.registry.destroy();
        fixture.backend.destroy();
    });

    it('rebuilds the full logical dependency chain through registry recipes', () => {
        const fixture = createFixture();
        const source = shader(uniformFragmentSource);
        const record = fixture.pipelines.prepare(source, vertexLayout(), new Material(), target());
        const first = fixture.pipelines.resolve(record);
        const secondDevice = fixture.backend.createDevice();
        const createBindGroupLayout = vi.spyOn(secondDevice, 'createBindGroupLayout');
        const createPipelineLayout = vi.spyOn(secondDevice, 'createPipelineLayout');
        const createGraphicsPipeline = vi.spyOn(secondDevice, 'createGraphicsPipeline');

        fixture.registry.recover(secondDevice);
        const recovered = fixture.pipelines.resolve(record);

        expect(recovered.pipeline).not.toBe(first.pipeline);
        expect(recovered.pipelineLayout).not.toBe(first.pipelineLayout);
        expect(recovered.bindGroupLayouts[0]).not.toBe(first.bindGroupLayouts[0]);
        expect(recovered.pipeline.deviceId).toBe(secondDevice.id);
        expect(recovered.pipelineLayout.deviceId).toBe(secondDevice.id);
        expect(recovered.pipeline.descriptor.layout).toBe(recovered.pipelineLayout);
        expect(recovered.pipeline.descriptor.vertex.shader.deviceId).toBe(secondDevice.id);
        expect(recovered.pipeline.descriptor.fragment?.shader.deviceId).toBe(secondDevice.id);
        expect(recovered.pipelineLayout.bindGroupLayouts).toEqual(recovered.bindGroupLayouts);
        expect(createBindGroupLayout).toHaveBeenCalledTimes(2);
        expect(createPipelineLayout).toHaveBeenCalledTimes(1);
        expect(createGraphicsPipeline).toHaveBeenCalledTimes(1);
        expect(first.pipeline.destroyed).toBe(true);
        expect(first.pipelineLayout.destroyed).toBe(true);
        expect(fixture.pipelines.metrics).toMatchObject({
            hits: 0,
            misses: 1,
            evictions: 0,
            size: 1,
            highWater: 1
        });

        fixture.pipelines.destroy();
        fixture.shaders.destroy();
        expect(fixture.registry.collect(0)).toBe(6);
        fixture.registry.destroy();
        fixture.backend.destroy();
    });

    it('marks use, detaches shader buckets, and releases remaining pipelines on destroy', () => {
        const fixture = createFixture();
        const detachedShader = shader();
        const detachedRecord = fixture.pipelines.prepare(
            detachedShader,
            vertexLayout(),
            new Material(),
            target()
        );
        const detached = fixture.pipelines.resolve(detachedRecord);

        fixture.pipelines.markUsed(detachedRecord, 5);
        expect(fixture.pipelines.detachShader(detachedShader)).toBe(true);
        expect(fixture.pipelines.detachShader(detachedShader)).toBe(false);
        expect(() => fixture.pipelines.resolve(detachedRecord)).toThrow(
            'Pipeline resource record is stale or belongs to another cache'
        );
        expect(fixture.registry.collect(4)).toBe(0);
        expect(detached.pipeline.destroyed).toBe(false);
        expect(detached.pipelineLayout.destroyed).toBe(false);
        expect(fixture.registry.collect(5)).toBe(2);
        expect(detached.pipeline.destroyed).toBe(true);
        expect(detached.pipelineLayout.destroyed).toBe(true);

        const remainingShader = shader();
        fixture.pipelines.prepare(remainingShader, vertexLayout(), new Material(), target());
        fixture.pipelines.destroy();
        fixture.pipelines.destroy();
        expect(() => {
            fixture.pipelines.prepare(remainingShader, vertexLayout(), new Material(), target());
        }).toThrow('Pipeline resource cache is destroyed');
        expect(fixture.registry.collect(0)).toBe(2);

        fixture.shaders.destroy();
        expect(fixture.registry.collect(5)).toBe(4);
        fixture.registry.destroy();
        fixture.backend.destroy();
    });

    it('uses explicit signatures instead of JSON serialization', () => {
        const source = Object.values(pipelineCacheSources)[0];
        expect(source).toBeDefined();
        expect(source).not.toContain('JSON.stringify');
        expect(source).not.toContain('PipelineRequestSnapshot');
        expect(source).toContain(
            'requestVariantsByMaterial: WeakMap<object, PipelineRequestVariant[]>'
        );
        expect(source).toContain('recordsByVertexLayouts: WeakMap<object, VertexLayoutsMemo>');
        expect(source).toContain('vertexLayoutSignature');
        expect(source).toContain('pipelineStateSignature');
    });
});
