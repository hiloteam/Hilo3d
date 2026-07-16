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
import { FakeWebGPURHIBackend } from '../rhi/portable/FakeRHIBackend';

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

        rgba32 = formatCapabilities(source, 'rgba32float', {
            sampled: false,
            filterable: false
        });
        expect(snapshot.supportsTextureFormat('rgba32float', 'sampled')).toBe(true);
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

    it('wires full public capability-superset validation into device replacement', async () => {
        const backend = new FakeWebGPURHIBackend();
        const source = backend.createDevice().capabilities;
        const reduced = overrideFormat(
            source,
            'rgba16float',
            formatCapabilities(source, 'rgba16float', { sampleCounts: [1] })
        );
        const host = new RenderPipelineHost({} as RenderPipelineHostLifecycle);
        await host.initialize(runtimeFactory(), source);

        expect(() => {
            host.validateReplacementDevice(reduced);
        }).toThrow(/rgba16float color-attachment 4x/u);

        host.destroy();
        backend.destroy();
    });
});
