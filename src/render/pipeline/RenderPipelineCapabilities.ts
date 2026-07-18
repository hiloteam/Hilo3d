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

// Atomic release gate: flip only after public passes, graph access, RHI, both backend policies,
// recovery, and browser coverage are all present. Per-device predicates below remain fail-closed.
const ENABLED_PUBLIC_CAPABILITY_RELEASES: ReadonlySet<string> = new Set(['compute-storage']);
const PIPELINE_CAPABILITY_NAMES: readonly RenderPipelineCapabilityName[] = Object.freeze([
    'storage-buffer',
    'storage-texture',
    'compute-pass',
    'indirect-draw'
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
    'storage',
    'copy-source',
    'copy-destination'
]);
const PUBLIC_SAMPLE_COUNTS: readonly RenderTargetSampleCount[] = Object.freeze([1, 4]);

interface PublicTextureFormatSnapshot {
    readonly supported: boolean;
    readonly sampled: boolean;
    readonly filterable: boolean;
    readonly renderable: boolean;
    readonly storage: boolean;
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
        case 'maxBindGroups':
            return limits.maxBindGroups;
        case 'maxBindingsPerBindGroup':
            return limits.maxBindingsPerBindGroup;
        case 'maxBufferSize':
            return limits.maxBufferSize;
        case 'maxStorageBuffersPerShaderStage':
            return limits.maxStorageBuffersPerShaderStage;
        case 'maxStorageTexturesPerShaderStage':
            return limits.maxStorageTexturesPerShaderStage;
        case 'maxStorageBufferBindingSize':
            return limits.maxStorageBufferBindingSize;
        case 'minStorageBufferOffsetAlignment':
            return limits.minStorageBufferOffsetAlignment;
        case 'maxDynamicStorageBuffersPerPipelineLayout':
            return limits.maxDynamicStorageBuffersPerPipelineLayout;
        case 'maxComputeWorkgroupStorageSize':
            return limits.maxComputeWorkgroupStorageSize;
        case 'maxComputeInvocationsPerWorkgroup':
            return limits.maxComputeInvocationsPerWorkgroup;
        case 'maxComputeWorkgroupSizeX':
            return limits.maxComputeWorkgroupSizeX;
        case 'maxComputeWorkgroupSizeY':
            return limits.maxComputeWorkgroupSizeY;
        case 'maxComputeWorkgroupSizeZ':
            return limits.maxComputeWorkgroupSizeZ;
        case 'maxComputeWorkgroupsPerDimension':
            return limits.maxComputeWorkgroupsPerDimension;
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
        maxSampledTexturesPerShaderStage: capabilities.limits.maxSampledTexturesPerShaderStage,
        maxBindGroups: capabilities.limits.maxBindGroups,
        maxBindingsPerBindGroup: capabilities.limits.maxBindingsPerBindGroup,
        maxBufferSize: capabilities.limits.maxBufferSize,
        ...(capabilities.limits.maxStorageBuffersPerShaderStage === undefined
            ? {}
            : {
                  maxStorageBuffersPerShaderStage:
                      capabilities.limits.maxStorageBuffersPerShaderStage
              }),
        ...(capabilities.limits.maxStorageTexturesPerShaderStage === undefined
            ? {}
            : {
                  maxStorageTexturesPerShaderStage:
                      capabilities.limits.maxStorageTexturesPerShaderStage
              }),
        ...(capabilities.limits.maxStorageBufferBindingSize === undefined
            ? {}
            : {
                  maxStorageBufferBindingSize: capabilities.limits.maxStorageBufferBindingSize
              }),
        ...(capabilities.limits.minStorageBufferOffsetAlignment === undefined
            ? {}
            : {
                  minStorageBufferOffsetAlignment:
                      capabilities.limits.minStorageBufferOffsetAlignment
              }),
        ...(capabilities.limits.maxDynamicStorageBuffersPerPipelineLayout === undefined
            ? {}
            : {
                  maxDynamicStorageBuffersPerPipelineLayout:
                      capabilities.limits.maxDynamicStorageBuffersPerPipelineLayout
              }),
        ...(capabilities.limits.maxComputeWorkgroupStorageSize === undefined
            ? {}
            : {
                  maxComputeWorkgroupStorageSize: capabilities.limits.maxComputeWorkgroupStorageSize
              }),
        ...(capabilities.limits.maxComputeInvocationsPerWorkgroup === undefined
            ? {}
            : {
                  maxComputeInvocationsPerWorkgroup:
                      capabilities.limits.maxComputeInvocationsPerWorkgroup
              }),
        ...(capabilities.limits.maxComputeWorkgroupSizeX === undefined
            ? {}
            : { maxComputeWorkgroupSizeX: capabilities.limits.maxComputeWorkgroupSizeX }),
        ...(capabilities.limits.maxComputeWorkgroupSizeY === undefined
            ? {}
            : { maxComputeWorkgroupSizeY: capabilities.limits.maxComputeWorkgroupSizeY }),
        ...(capabilities.limits.maxComputeWorkgroupSizeZ === undefined
            ? {}
            : { maxComputeWorkgroupSizeZ: capabilities.limits.maxComputeWorkgroupSizeZ }),
        ...(capabilities.limits.maxComputeWorkgroupsPerDimension === undefined
            ? {}
            : {
                  maxComputeWorkgroupsPerDimension:
                      capabilities.limits.maxComputeWorkgroupsPerDimension
              })
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
                storage: source.storage,
                sampleCounts: Object.freeze([...source.sampleCounts])
            })
        );
    }
    const storageBufferSupport =
        ENABLED_PUBLIC_CAPABILITY_RELEASES.has('compute-storage') &&
        capabilities.features.has('storage-buffers') &&
        (limits.maxStorageBuffersPerShaderStage ?? 0) > 0 &&
        (limits.maxStorageBufferBindingSize ?? 0) > 0 &&
        limits.minStorageBufferOffsetAlignment !== undefined;
    const computeSupport =
        storageBufferSupport &&
        capabilities.features.has('compute-pipelines') &&
        (limits.maxComputeWorkgroupStorageSize ?? 0) > 0 &&
        (limits.maxComputeInvocationsPerWorkgroup ?? 0) > 0 &&
        (limits.maxComputeWorkgroupSizeX ?? 0) > 0 &&
        (limits.maxComputeWorkgroupSizeY ?? 0) > 0 &&
        (limits.maxComputeWorkgroupSizeZ ?? 0) > 0 &&
        (limits.maxComputeWorkgroupsPerDimension ?? 0) > 0;
    const storageTextureSupport =
        computeSupport &&
        capabilities.features.has('storage-textures') &&
        (limits.maxStorageTexturesPerShaderStage ?? 0) > 0 &&
        [...formats.values()].some(format => format.storage);
    const indirectDrawSupport = storageBufferSupport && capabilities.features.has('indirect-draw');
    const supportedCapabilities: Readonly<Record<RenderPipelineCapabilityName, boolean>> =
        Object.freeze({
            'storage-buffer': storageBufferSupport,
            'storage-texture': storageTextureSupport,
            'compute-pass': computeSupport,
            'indirect-draw': indirectDrawSupport
        });
    return Object.freeze({
        limits,
        supportsCapability(capability: RenderPipelineCapabilityName): boolean {
            return supportedCapabilities[capability];
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
                case 'storage':
                    return (
                        storageTextureSupport &&
                        sampleCount === 1 &&
                        !depthStencil &&
                        formatCapabilities.storage
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
            minimum.limits.maxSampledTexturesPerShaderStage ||
        candidate.limits.maxBindGroups < minimum.limits.maxBindGroups ||
        candidate.limits.maxBindingsPerBindGroup < minimum.limits.maxBindingsPerBindGroup ||
        candidate.limits.maxBufferSize < minimum.limits.maxBufferSize
    ) {
        throw new Error('Replacement RHI device reduces render pipeline public limits');
    }
    for (const name of [
        'maxStorageBuffersPerShaderStage',
        'maxStorageTexturesPerShaderStage',
        'maxStorageBufferBindingSize',
        'maxDynamicStorageBuffersPerPipelineLayout',
        'maxComputeWorkgroupStorageSize',
        'maxComputeInvocationsPerWorkgroup',
        'maxComputeWorkgroupSizeX',
        'maxComputeWorkgroupSizeY',
        'maxComputeWorkgroupSizeZ',
        'maxComputeWorkgroupsPerDimension'
    ] as const) {
        const required = minimum.limits[name];
        if (required !== undefined && (candidate.limits[name] ?? -1) < required) {
            throw new Error(`Replacement RHI device reduces render pipeline limit ${name}`);
        }
    }
    const minimumAlignment = minimum.limits.minStorageBufferOffsetAlignment;
    const candidateAlignment = candidate.limits.minStorageBufferOffsetAlignment;
    if (
        minimumAlignment !== undefined &&
        (candidateAlignment === undefined || candidateAlignment > minimumAlignment)
    ) {
        throw new Error(
            'Replacement RHI device reduces render pipeline limit minStorageBufferOffsetAlignment'
        );
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
