import type {
    RenderPipelineCreateContext,
    RenderPipelineFactory,
    RenderPipelineRequirements,
    RenderPipelineTextureRequirement
} from './RenderPipeline';

function snapshotTextureRequirement(
    requirement: Readonly<RenderPipelineTextureRequirement>
): Readonly<RenderPipelineTextureRequirement> {
    return Object.freeze({
        format: requirement.format,
        use: requirement.use,
        ...(requirement.sampleCount === undefined ? {} : { sampleCount: requirement.sampleCount })
    });
}

function snapshotUniqueStrings<T extends string>(values: readonly T[]): readonly T[] {
    return Object.freeze([...new Set(values)]);
}

function snapshotTextureRequirements(
    requirements: readonly Readonly<RenderPipelineTextureRequirement>[]
): readonly Readonly<RenderPipelineTextureRequirement>[] {
    const snapshots: Readonly<RenderPipelineTextureRequirement>[] = [];
    const keys = new Set<string>();
    for (const requirement of requirements) {
        const snapshot = snapshotTextureRequirement(requirement);
        const key = `${snapshot.format}:${snapshot.use}:${String(snapshot.sampleCount ?? 1)}`;
        if (keys.has(key)) continue;
        keys.add(key);
        snapshots.push(snapshot);
    }
    return Object.freeze(snapshots);
}

/** @internal Snapshot mutable requirement containers before asynchronous backend selection. */
export function snapshotRenderPipelineRequirements(
    requirements: Readonly<RenderPipelineRequirements> = {}
): Readonly<RenderPipelineRequirements> {
    return Object.freeze({
        ...(requirements.requiredFeatures === undefined
            ? {}
            : { requiredFeatures: snapshotUniqueStrings(requirements.requiredFeatures) }),
        ...(requirements.requiredCapabilities === undefined
            ? {}
            : {
                  requiredCapabilities: snapshotUniqueStrings(requirements.requiredCapabilities)
              }),
        ...(requirements.requiredLimits === undefined
            ? {}
            : { requiredLimits: Object.freeze({ ...requirements.requiredLimits }) }),
        ...(requirements.requiredTextureFormats === undefined
            ? {}
            : {
                  requiredTextureFormats: snapshotTextureRequirements(
                      requirements.requiredTextureFormats
                  )
              })
    });
}

/** @internal Preserve factory identity while freezing all selection-time metadata. */
export function snapshotRenderPipelineFactory(
    factory: RenderPipelineFactory
): RenderPipelineFactory {
    const candidate: unknown = factory;
    if ((typeof candidate !== 'object' && typeof candidate !== 'function') || candidate === null) {
        throw new TypeError('Renderer renderPipeline must be a factory object');
    }
    if (typeof factory.name !== 'string' || factory.name.length === 0) {
        throw new TypeError('Render pipeline factory name must be non-empty');
    }
    if (typeof factory.create !== 'function') {
        throw new TypeError('Render pipeline factory create must be a function');
    }
    const create = factory.create.bind(factory);
    const requirements = snapshotRenderPipelineRequirements(factory.requirements);
    return Object.freeze({
        name: factory.name,
        requirements,
        create(context: RenderPipelineCreateContext) {
            return create(context);
        }
    });
}
