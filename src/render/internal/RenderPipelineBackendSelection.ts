import type {
    RenderPipelineCapabilityName,
    RenderPipelineRequirements
} from '../pipeline/RenderPipeline';
import type { RendererFeatureName } from '../RendererOptions';

const WEBGPU_ONLY_CAPABILITIES: ReadonlySet<RenderPipelineCapabilityName> = new Set([
    'storage-buffer',
    'storage-texture',
    'compute-pass',
    'indirect-draw'
]);

const WEBGPU_ONLY_PUBLIC_LIMITS: ReadonlySet<string> = new Set([
    'maxStorageBuffersPerShaderStage',
    'maxStorageTexturesPerShaderStage',
    'maxStorageBufferBindingSize',
    'minStorageBufferOffsetAlignment',
    'maxDynamicStorageBuffersPerPipelineLayout',
    'maxComputeWorkgroupStorageSize',
    'maxComputeInvocationsPerWorkgroup',
    'maxComputeWorkgroupSizeX',
    'maxComputeWorkgroupSizeY',
    'maxComputeWorkgroupSizeZ',
    'maxComputeWorkgroupsPerDimension'
]);

interface BackendSelectionOptions {
    readonly alpha?: boolean;
    readonly premultipliedAlpha?: boolean;
    readonly preserveDrawingBuffer?: boolean;
}

/** @internal Describe the first renderer feature that WebGL2 cannot satisfy. */
export function describeWebGPUOnlyRendererFeature(
    features: readonly RendererFeatureName[] | undefined
): string | null {
    return features?.includes('shader-f16') === true ? 'renderer feature shader-f16' : null;
}

/** @internal Describe the first pipeline constraint that WebGL2 cannot satisfy. */
export function describeWebGPUOnlyPipelineRequirement(
    requirements: Readonly<RenderPipelineRequirements> | undefined
): string | null {
    if (requirements === undefined) return null;
    for (const capability of requirements.requiredCapabilities ?? []) {
        if (WEBGPU_ONLY_CAPABILITIES.has(capability)) {
            return `render pipeline capability ${capability}`;
        }
    }
    for (const requirement of requirements.requiredTextureFormats ?? []) {
        if (requirement.use === 'storage') {
            return `render pipeline storage texture format ${requirement.format}`;
        }
    }
    for (const name of Object.keys(requirements.requiredLimits ?? {})) {
        if (WEBGPU_ONLY_PUBLIC_LIMITS.has(name)) {
            return `render pipeline limit ${name}`;
        }
    }
    return null;
}

/** @internal Describe an option combination that requires WebGL2 canvas semantics. */
export function describeWebGL2OnlyRendererOption(options: BackendSelectionOptions): string | null {
    if (Object.prototype.hasOwnProperty.call(options, 'preserveDrawingBuffer')) {
        return 'preserveDrawingBuffer is WebGL2-only';
    }
    if (options.alpha === true && options.premultipliedAlpha === false) {
        return 'alpha: true with premultipliedAlpha: false is WebGL2-only';
    }
    return null;
}
