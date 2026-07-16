import {
    rhiTextureFormatHasDepth,
    rhiTextureFormatHasStencil,
    type RHICapabilities
} from '../rhi/core';
import type {
    RenderPipelineCapabilities,
    RenderPipelineCapabilityName,
    RenderPipelineLimits,
    RenderPipelineRequirements,
    RenderPipelineTextureRequirement,
    RenderPipelineTextureUse
} from './RenderPipeline';
import type {
    RenderTargetColorFormat,
    RenderTargetDepthStencilFormat,
    RenderTargetSampleCount
} from '../RenderTarget';

const SUPPORTED_PIPELINE_CAPABILITIES: ReadonlySet<RenderPipelineCapabilityName> = new Set();
const PIPELINE_CAPABILITY_NAMES: readonly RenderPipelineCapabilityName[] = Object.freeze([
    'storage-buffer',
    'storage-texture',
    'compute-pass'
]);
const PUBLIC_TEXTURE_FORMATS: readonly (
    RenderTargetColorFormat | RenderTargetDepthStencilFormat
)[] = Object.freeze([
    'rgba8unorm',
    'rgba8unorm-srgb',
    'rgba16float',
    'rgba32float',
    'depth16unorm',
    'depth24plus',
    'depth24plus-stencil8',
    'depth32float',
    'depth32float-stencil8'
]);
const PUBLIC_TEXTURE_USES: readonly RenderPipelineTextureUse[] = Object.freeze([
    'sampled',
    'filterable-sampled',
    'color-attachment',
    'depth-stencil-attachment',
    'copy-source',
    'copy-destination'
]);
const PUBLIC_SAMPLE_COUNTS: readonly RenderTargetSampleCount[] = Object.freeze([1, 4]);

interface PublicTextureFormatSnapshot {
    readonly supported: boolean;
    readonly sampled: boolean;
    readonly filterable: boolean;
    readonly renderable: boolean;
    readonly sampleCounts: readonly number[];
}

function publicPipelineLimit(
    limits: Readonly<RenderPipelineLimits>,
    name: string
): number | undefined {
    switch (name) {
        case 'maxTextureDimension2D':
            return limits.maxTextureDimension2D;
        case 'maxColorAttachments':
            return limits.maxColorAttachments;
        case 'maxSampledTexturesPerShaderStage':
            return limits.maxSampledTexturesPerShaderStage;
        default:
            return undefined;
    }
}

function isDepthStencilFormat(
    format: RenderTargetColorFormat | RenderTargetDepthStencilFormat
): boolean {
    return rhiTextureFormatHasDepth(format) || rhiTextureFormatHasStencil(format);
}

/** @internal Create one backend-neutral immutable SRP capability snapshot. */
export function createRenderPipelineCapabilities(
    capabilities: RHICapabilities
): RenderPipelineCapabilities {
    const limits: Readonly<RenderPipelineLimits> = Object.freeze({
        maxTextureDimension2D: capabilities.limits.maxTextureDimension2D,
        maxColorAttachments: capabilities.limits.maxColorAttachments,
        maxSampledTexturesPerShaderStage: capabilities.limits.maxSampledTexturesPerShaderStage
    });
    const formats = new Map<
        RenderTargetColorFormat | RenderTargetDepthStencilFormat,
        Readonly<PublicTextureFormatSnapshot>
    >();
    for (const format of PUBLIC_TEXTURE_FORMATS) {
        const source = capabilities.getTextureFormatCapabilities(format);
        formats.set(
            format,
            Object.freeze({
                supported:
                    source.sampled ||
                    source.renderable ||
                    source.storage ||
                    source.sampleCounts.length !== 0,
                sampled: source.sampled,
                filterable: source.filterable,
                renderable: source.renderable,
                sampleCounts: Object.freeze([...source.sampleCounts])
            })
        );
    }
    return Object.freeze({
        limits,
        supportsCapability(capability: RenderPipelineCapabilityName): boolean {
            return SUPPORTED_PIPELINE_CAPABILITIES.has(capability);
        },
        supportsTextureFormat(
            format: RenderTargetColorFormat | RenderTargetDepthStencilFormat,
            use: RenderPipelineTextureUse,
            sampleCount: RenderTargetSampleCount = 1
        ): boolean {
            const formatCapabilities = formats.get(format);
            if (formatCapabilities === undefined) return false;
            const depthStencil = isDepthStencilFormat(format);
            switch (use) {
                case 'sampled':
                    return sampleCount === 1 && formatCapabilities.sampled;
                case 'filterable-sampled':
                    return (
                        sampleCount === 1 &&
                        formatCapabilities.sampled &&
                        formatCapabilities.filterable
                    );
                case 'color-attachment':
                    return (
                        !depthStencil &&
                        formatCapabilities.renderable &&
                        formatCapabilities.sampleCounts.includes(sampleCount)
                    );
                case 'depth-stencil-attachment':
                    return (
                        depthStencil &&
                        formatCapabilities.renderable &&
                        formatCapabilities.sampleCounts.includes(sampleCount)
                    );
                case 'copy-source':
                case 'copy-destination':
                    return sampleCount === 1 && formatCapabilities.supported;
            }
        }
    });
}

/** @internal Reject a replacement device that narrows the creation-time public capability view. */
export function validateRenderPipelineCapabilitySuperset(
    minimum: RenderPipelineCapabilities,
    candidate: RenderPipelineCapabilities
): void {
    if (
        candidate.limits.maxTextureDimension2D < minimum.limits.maxTextureDimension2D ||
        candidate.limits.maxColorAttachments < minimum.limits.maxColorAttachments ||
        candidate.limits.maxSampledTexturesPerShaderStage <
            minimum.limits.maxSampledTexturesPerShaderStage
    ) {
        throw new Error('Replacement RHI device reduces render pipeline public limits');
    }
    for (const capability of PIPELINE_CAPABILITY_NAMES) {
        if (minimum.supportsCapability(capability) && !candidate.supportsCapability(capability)) {
            throw new Error(
                `Replacement RHI device removes render pipeline capability ${capability}`
            );
        }
    }
    for (const format of PUBLIC_TEXTURE_FORMATS) {
        for (const use of PUBLIC_TEXTURE_USES) {
            for (const sampleCount of PUBLIC_SAMPLE_COUNTS) {
                if (
                    minimum.supportsTextureFormat(format, use, sampleCount) &&
                    !candidate.supportsTextureFormat(format, use, sampleCount)
                ) {
                    throw new Error(
                        `Replacement RHI device removes render pipeline texture support: ${format} ${use} ${String(sampleCount)}x`
                    );
                }
            }
        }
    }
}

function validateTextureRequirement(
    capabilities: RenderPipelineCapabilities,
    requirement: Readonly<RenderPipelineTextureRequirement>,
    index: number
): void {
    if (
        !capabilities.supportsTextureFormat(
            requirement.format,
            requirement.use,
            requirement.sampleCount
        )
    ) {
        throw new Error(
            `Render pipeline texture requirement ${String(index)} is unsupported: ${requirement.format} ${requirement.use}`
        );
    }
}

/** @internal Validate a factory's frozen requirements against the selected device. */
export function validateRenderPipelineRequirements(
    requirements: Readonly<RenderPipelineRequirements>,
    capabilities: RenderPipelineCapabilities,
    deviceCapabilities: RHICapabilities
): void {
    for (const feature of requirements.requiredFeatures ?? []) {
        if (!deviceCapabilities.features.has(feature)) {
            throw new Error(`Render pipeline requires unsupported feature ${feature}`);
        }
    }
    for (const capability of requirements.requiredCapabilities ?? []) {
        if (!capabilities.supportsCapability(capability)) {
            throw new Error(`Render pipeline requires unsupported capability ${capability}`);
        }
    }
    for (const [name, required] of Object.entries(requirements.requiredLimits ?? {})) {
        const available = publicPipelineLimit(capabilities.limits, name);
        if (available === undefined) {
            throw new TypeError(`Render pipeline required limit ${name} is not public`);
        }
        if (!Number.isSafeInteger(required) || required < 0) {
            throw new RangeError(`Render pipeline required limit ${name} must be non-negative`);
        }
        if (available < required) {
            throw new Error(
                `Render pipeline requires ${name} ${String(required)}, but only ${String(available)} is available`
            );
        }
    }
    const textures = requirements.requiredTextureFormats ?? [];
    for (let index = 0; index < textures.length; index += 1) {
        const requirement = textures[index];
        if (requirement !== undefined) {
            validateTextureRequirement(capabilities, requirement, index);
        }
    }
}
