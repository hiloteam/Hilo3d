import { describe, expect, it } from 'vitest';
import {
    RenderPipelineHost,
    type RenderPipelineHostLifecycle
} from '../../../src/render/internal/RenderPipelineHost';
import {
    createRenderPipelineCapabilities,
    validateRenderPipelineCapabilitySuperset
} from '../../../src/render/pipeline/RenderPipelineCapabilities';
import type {
    RenderPipeline,
    RenderPipelineFactory
} from '../../../src/render/pipeline/RenderPipeline';
import type {
    RHICapabilities,
    RHITextureFormat,
    RHITextureFormatCapabilities
} from '../../../src/render/rhi/core';
import { FakeWebGLRHIBackend, FakeWebGPURHIBackend } from '../rhi/portable/FakeRHIBackend';

function overrideFormat(
    source: RHICapabilities,
    format: RHITextureFormat,
    replacement: Readonly<RHITextureFormatCapabilities>
): RHICapabilities {
    return {
        features: source.features,
        limits: source.limits,
        getTextureFormatCapabilities(candidate: RHITextureFormat) {
            return candidate === format
                ? replacement
                : source.getTextureFormatCapabilities(candidate);
        }
    };
}

function formatCapabilities(
    source: RHICapabilities,
    format: RHITextureFormat,
    overrides: Partial<RHITextureFormatCapabilities>
): Readonly<RHITextureFormatCapabilities> {
    const current = source.getTextureFormatCapabilities(format);
    return Object.freeze({
        sampled: overrides.sampled ?? current.sampled,
        filterable: overrides.filterable ?? current.filterable,
        renderable: overrides.renderable ?? current.renderable,
        blendable: overrides.blendable ?? current.blendable,
        storage: overrides.storage ?? current.storage,
        sampleCounts: Object.freeze([...(overrides.sampleCounts ?? current.sampleCounts)])
    });
}

function runtimeFactory(): RenderPipelineFactory {
    return {
        name: 'capability-test',
        create(): RenderPipeline {
            return {
                name: 'capability-test-runtime',
                record(): void {
                    // This host test exercises replacement validation only.
                },
                destroy(): void {
                    // No renderer-local resources.
                }
            };
        }
    };
}

describe('RenderPipelineCapabilities', () => {
    it('advertises the released compute/storage bundle only for complete WebGPU devices', () => {
        const webgpu = new FakeWebGPURHIBackend();
        const source = webgpu.createDevice().capabilities;
        const released = createRenderPipelineCapabilities(source);

        expect(released.supportsCapability('storage-buffer')).toBe(true);
        expect(released.supportsCapability('storage-texture')).toBe(true);
        expect(released.supportsCapability('compute-pass')).toBe(true);
        expect(released.supportsCapability('indirect-draw')).toBe(true);
        expect(released.supportsFeature('shader-f16')).toBe(true);
        expect(released.supportsFeature('subgroups')).toBe(true);
        expect(released.supportsFeature('timestamp-query')).toBe(true);
        expect(released.limits.subgroupMinSize).toBe(4);
        expect(released.limits.subgroupMaxSize).toBe(32);

        const withoutCompute = new Set(source.features);
        withoutCompute.delete('compute-pipelines');
        const partial = createRenderPipelineCapabilities({
            features: withoutCompute,
            limits: source.limits,
            getTextureFormatCapabilities: format => source.getTextureFormatCapabilities(format)
        });
        expect(partial.supportsCapability('storage-buffer')).toBe(true);
        expect(partial.supportsCapability('compute-pass')).toBe(false);
        expect(partial.supportsCapability('storage-texture')).toBe(false);

        const webgl2 = new FakeWebGLRHIBackend();
        const fallback = createRenderPipelineCapabilities(webgl2.createDevice().capabilities);
        expect(fallback.supportsCapability('storage-buffer')).toBe(false);
        expect(fallback.supportsCapability('compute-pass')).toBe(false);
        expect(fallback.supportsCapability('indirect-draw')).toBe(false);
        expect(fallback.supportsFeature('subgroups')).toBe(false);

        webgpu.destroy();
        webgl2.destroy();
    });

    it('snapshots format support and distinguishes sampleable from filterable sampling', () => {
        const backend = new FakeWebGPURHIBackend();
        const source = backend.createDevice().capabilities;
        let rgba32 = formatCapabilities(source, 'rgba32float', {
            sampled: true,
            filterable: false
        });
        const mutable: RHICapabilities = {
            features: source.features,
            limits: source.limits,
            getTextureFormatCapabilities(format: RHITextureFormat) {
                return format === 'rgba32float'
                    ? rgba32
                    : source.getTextureFormatCapabilities(format);
            }
        };
        const snapshot = createRenderPipelineCapabilities(mutable);

        expect(snapshot.supportsTextureFormat('rgba32float', 'sampled')).toBe(true);
        expect(snapshot.supportsTextureFormat('rgba32float', 'filterable-sampled')).toBe(false);
        expect(snapshot.supportsTextureFormat('rgba32float', 'storage')).toBe(
            snapshot.supportsCapability('storage-texture') &&
                source.getTextureFormatCapabilities('rgba32float').storage
        );
        expect(snapshot.limits.maxComputeWorkgroupSizeX).toBe(
            source.limits.maxComputeWorkgroupSizeX
        );

        rgba32 = formatCapabilities(source, 'rgba32float', {
            sampled: false,
            filterable: false
        });
        expect(snapshot.supportsTextureFormat('rgba32float', 'sampled')).toBe(true);
        backend.destroy();
    });

    it('keeps per-format storage queries behind the public storage-texture capability', () => {
        const backend = new FakeWebGPURHIBackend();
        const source = backend.createDevice().capabilities;
        const capabilities = createRenderPipelineCapabilities(source);
        const withoutStorageTextures = new Set(source.features);
        withoutStorageTextures.delete('storage-textures');
        const unsupported = createRenderPipelineCapabilities({
            features: withoutStorageTextures,
            limits: source.limits,
            getTextureFormatCapabilities: format => source.getTextureFormatCapabilities(format)
        });

        expect(source.getTextureFormatCapabilities('rgba8unorm').storage).toBe(true);
        expect(capabilities.supportsTextureFormat('rgba8unorm', 'storage')).toBe(
            capabilities.supportsCapability('storage-texture')
        );
        expect(unsupported.supportsCapability('storage-texture')).toBe(false);
        expect(unsupported.supportsTextureFormat('rgba8unorm', 'storage')).toBe(false);

        backend.destroy();
    });

    it('does not advertise copy roles for an otherwise unsupported public format', () => {
        const backend = new FakeWebGPURHIBackend();
        const source = backend.createDevice().capabilities;
        const capabilities = createRenderPipelineCapabilities(
            overrideFormat(
                source,
                'depth32float-stencil8',
                formatCapabilities(source, 'depth32float-stencil8', {
                    sampled: false,
                    filterable: false,
                    renderable: false,
                    blendable: false,
                    storage: false,
                    sampleCounts: []
                })
            )
        );

        expect(capabilities.supportsTextureFormat('depth32float-stencil8', 'copy-source')).toBe(
            false
        );
        backend.destroy();
    });

    it('rejects any replacement that narrows initially visible texture support', () => {
        const backend = new FakeWebGPURHIBackend();
        const source = backend.createDevice().capabilities;
        const minimum = createRenderPipelineCapabilities(source);
        const reduced = createRenderPipelineCapabilities(
            overrideFormat(
                source,
                'rgba16float',
                formatCapabilities(source, 'rgba16float', { sampleCounts: [1] })
            )
        );

        expect(() => {
            validateRenderPipelineCapabilitySuperset(minimum, reduced);
        }).toThrow(/rgba16float color-attachment 4x/u);
        expect(() => {
            validateRenderPipelineCapabilitySuperset(reduced, minimum);
        }).not.toThrow();
        backend.destroy();
    });

    it('preserves storage-oriented graph texture formats across device replacement', () => {
        const backend = new FakeWebGPURHIBackend();
        const source = backend.createDevice().capabilities;
        const minimum = createRenderPipelineCapabilities(source);
        const reduced = createRenderPipelineCapabilities(
            overrideFormat(
                source,
                'r32float',
                formatCapabilities(source, 'r32float', {
                    sampled: false,
                    filterable: false,
                    storage: false
                })
            )
        );

        expect(minimum.supportsTextureFormat('r32float', 'sampled')).toBe(true);
        expect(() => {
            validateRenderPipelineCapabilitySuperset(minimum, reduced);
        }).toThrow(/r32float sampled/u);
        backend.destroy();
    });

    it('rejects replacement devices with narrower compute limits or stricter storage alignment', () => {
        const backend = new FakeWebGPURHIBackend();
        const source = backend.createDevice().capabilities;
        const minimum = createRenderPipelineCapabilities(source);
        const narrowerLimits = {
            ...source.limits,
            maxComputeWorkgroupsPerDimension:
                (source.limits.maxComputeWorkgroupsPerDimension ?? 1) - 1
        };
        const stricterAlignment = {
            ...source.limits,
            minStorageBufferOffsetAlignment:
                (source.limits.minStorageBufferOffsetAlignment ?? 1) * 2
        };

        expect(() => {
            validateRenderPipelineCapabilitySuperset(
                minimum,
                createRenderPipelineCapabilities({
                    features: source.features,
                    limits: narrowerLimits,
                    getTextureFormatCapabilities: format =>
                        source.getTextureFormatCapabilities(format)
                })
            );
        }).toThrow(/maxComputeWorkgroupsPerDimension/u);
        expect(() => {
            validateRenderPipelineCapabilitySuperset(
                minimum,
                createRenderPipelineCapabilities({
                    features: source.features,
                    limits: stricterAlignment,
                    getTextureFormatCapabilities: format =>
                        source.getTextureFormatCapabilities(format)
                })
            );
        }).toThrow(/minStorageBufferOffsetAlignment/u);
        backend.destroy();
    });

    it('wires full public capability-superset validation into device replacement', async () => {
        const backend = new FakeWebGPURHIBackend();
        const source = backend.createDevice().capabilities;
        const reduced = overrideFormat(
            source,
            'rgba16float',
            formatCapabilities(source, 'rgba16float', { sampleCounts: [1] })
        );
        const host = new RenderPipelineHost({
            createPipelineStorageBuffer() {
                throw new Error('Capability replacement test does not create storage buffers');
            }
        } as unknown as RenderPipelineHostLifecycle);
        await host.initialize(runtimeFactory(), source);

        expect(() => {
            host.validateReplacementDevice(reduced);
        }).toThrow(/rgba16float color-attachment 4x/u);

        host.destroy();
        backend.destroy();
    });
});
