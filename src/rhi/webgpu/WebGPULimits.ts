export type WebGPUStorageResource = 'buffer' | 'texture';

export interface WebGPURenderStageStorageLimit {
    readonly aggregateName: 'maxStorageBuffersPerShaderStage' | 'maxStorageTexturesPerShaderStage';
    readonly vertexName: 'maxStorageBuffersInVertexStage' | 'maxStorageTexturesInVertexStage';
    readonly fragmentName: 'maxStorageBuffersInFragmentStage' | 'maxStorageTexturesInFragmentStage';
    readonly value: number;
    /** True when at least one modern stage-specific field is exposed. */
    readonly usesStageSpecificLimits: boolean;
}

function optionalNativeLimit(limits: GPUSupportedLimits, name: string): number | null {
    const value: unknown = Reflect.get(limits, name);
    return typeof value === 'number' ? value : null;
}

/**
 * Resolves the common storage capacity of the vertex and fragment stages exposed by this RHI.
 * Modern aggregate WebGPU limits may be raised by compute, so they are only a legacy fallback.
 */
export function renderStageStorageLimit(
    limits: GPUSupportedLimits,
    resource: WebGPUStorageResource
): WebGPURenderStageStorageLimit {
    const aggregateName =
        resource === 'buffer'
            ? ('maxStorageBuffersPerShaderStage' as const)
            : ('maxStorageTexturesPerShaderStage' as const);
    const vertexName =
        resource === 'buffer'
            ? ('maxStorageBuffersInVertexStage' as const)
            : ('maxStorageTexturesInVertexStage' as const);
    const fragmentName =
        resource === 'buffer'
            ? ('maxStorageBuffersInFragmentStage' as const)
            : ('maxStorageTexturesInFragmentStage' as const);
    const vertex = optionalNativeLimit(limits, vertexName);
    const fragment = optionalNativeLimit(limits, fragmentName);
    const usesStageSpecificLimits = vertex !== null || fragment !== null;
    return {
        aggregateName,
        vertexName,
        fragmentName,
        value: usesStageSpecificLimits
            ? Math.min(vertex ?? 0, fragment ?? 0)
            : (optionalNativeLimit(limits, aggregateName) ?? 0),
        usesStageSpecificLimits
    };
}
