import {
    RHIShaderStage,
    type RHIBindGroupLayoutDescriptor,
    type RHIBindGroupLayoutEntry,
    type RHIShaderBindingReflection,
    type RHIShaderReflection,
    type RHIShaderStageFlags,
    type RHITextureSampleType,
    type RHITextureViewDimension
} from '../rhi/core';
import type { CompiledShaderArtifactPair } from './ShaderArtifactCompiler';

type GraphicsShaderStageName = 'vertex' | 'fragment';

export interface ShaderStageReflectionPair {
    readonly vertex: Readonly<RHIShaderReflection>;
    readonly fragment: Readonly<RHIShaderReflection>;
}

/** A compiled pair is accepted directly; reflection-only pairs keep unit-level callers lightweight. */
export type ShaderBindingLayoutSource =
    Pick<CompiledShaderArtifactPair, 'vertex' | 'fragment'> | ShaderStageReflectionPair;

export interface ShaderUniformBlockBindingPlan {
    readonly name: string;
    readonly group: number;
    readonly binding: number;
    readonly visibility: RHIShaderStageFlags;
    readonly minBindingSize?: number;
}

/** One readonly storage-buffer resource reflected by a storage-aware graphics shader. */
export interface ShaderStorageBufferBindingPlan {
    readonly name: string;
    readonly group: number;
    readonly binding: number;
    readonly visibility: RHIShaderStageFlags;
    readonly minBindingSize?: number;
}

/** One GLSL sampler element represented by separate portable texture and sampler bindings. */
export interface ShaderSampledBindingPlan {
    readonly name: string;
    readonly arrayIndex: number;
    readonly group: number;
    readonly textureBinding: number;
    readonly samplerBinding: number;
    readonly samplerKind: 'sampler' | 'comparison-sampler';
    readonly visibility: RHIShaderStageFlags;
}

export interface ShaderBindingLayoutPlan {
    /** Continuous group-index order from zero through the highest active group. */
    readonly bindGroupLayoutDescriptors: readonly Readonly<RHIBindGroupLayoutDescriptor>[];
    readonly activeGroupIndices: readonly number[];
    /** Stable group/binding order for binding resource collection. */
    readonly uniformBlocks: readonly Readonly<ShaderUniformBlockBindingPlan>[];
    /** Stable group/texture/sampler/name order for sampled resource collection. */
    readonly sampledBindings: readonly Readonly<ShaderSampledBindingPlan>[];
    /** Stable group/binding/name order for readonly storage resources. */
    readonly storageBuffers: readonly Readonly<ShaderStorageBufferBindingPlan>[];
    /** Returns the exact frozen record stored in `uniformBlocks`. */
    getUniformBlockBinding(name: string): Readonly<ShaderUniformBlockBindingPlan> | undefined;
    /** Returns the exact frozen record stored in `sampledBindings`. */
    getSampledBinding(
        name: string,
        arrayIndex?: number
    ): Readonly<ShaderSampledBindingPlan> | undefined;
    /** Returns the exact frozen record stored in `storageBuffers`. */
    getStorageBufferBinding(name: string): Readonly<ShaderStorageBufferBindingPlan> | undefined;
}

type SupportedBindingKind =
    | 'uniform-buffer'
    | 'read-only-storage-buffer'
    | 'sampled-texture'
    | 'sampler'
    | 'comparison-sampler';

interface MutableMergedBinding {
    readonly group: number;
    readonly binding: number;
    readonly kind: SupportedBindingKind;
    readonly name: string;
    readonly arrayIndex: number;
    readonly minBindingSize: number | undefined;
    readonly sampleType: RHITextureSampleType | undefined;
    readonly viewDimension: RHITextureViewDimension | undefined;
    readonly multisampled: boolean | undefined;
    visibility: RHIShaderStageFlags;
}

interface MutableStageSampledBinding {
    readonly name: string;
    readonly arrayIndex: number;
    readonly group: number;
    texture: MutableMergedBinding | undefined;
    sampler: MutableMergedBinding | undefined;
}

interface MutableSampledBinding {
    readonly name: string;
    readonly arrayIndex: number;
    readonly group: number;
    readonly textureBinding: number;
    readonly samplerBinding: number;
    readonly samplerKind: 'sampler' | 'comparison-sampler';
    readonly sampleType: RHITextureSampleType;
    readonly viewDimension: RHITextureViewDimension;
    readonly multisampled: boolean;
    readonly samplerType: 'filtering' | 'non-filtering' | 'comparison';
    visibility: RHIShaderStageFlags;
}

function requireNonNegativeSafeInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name} must be a non-negative safe integer`);
    }
}

function bindingKey(group: number, binding: number): string {
    return `${String(group)}:${String(binding)}`;
}

function sampledElementKey(name: string, arrayIndex: number): string {
    return `${name}:${String(arrayIndex)}`;
}

function reflectionForStage(
    source: ShaderBindingLayoutSource,
    stage: GraphicsShaderStageName
): Readonly<RHIShaderReflection> {
    const stageSource = source[stage];
    if ('reflection' in stageSource) {
        if (stageSource.stage !== stage) {
            throw new TypeError(
                `Shader binding-layout ${stage} input contains a ${stageSource.stage} artifact`
            );
        }
        return stageSource.reflection;
    }
    return stageSource;
}

function requireBindingName(
    binding: RHIShaderBindingReflection,
    stage: GraphicsShaderStageName,
    index: number
): string {
    if (typeof binding.name !== 'string' || binding.name.length === 0) {
        const resource = binding.kind === 'uniform-buffer' ? 'block' : 'resource';
        throw new TypeError(
            `${stage} ${binding.kind} binding ${String(index)} requires a non-empty ${resource} name`
        );
    }
    return binding.name;
}

function requireSupportedKind(
    binding: RHIShaderBindingReflection,
    stage: GraphicsShaderStageName
): SupportedBindingKind {
    switch (binding.kind) {
        case 'uniform-buffer':
        case 'read-only-storage-buffer':
        case 'sampled-texture':
        case 'sampler':
        case 'comparison-sampler':
            return binding.kind;
        case 'storage-buffer':
        case 'storage-texture':
            throw new TypeError(
                `Shader binding ${bindingKey(binding.group, binding.binding)} uses unsupported ${binding.kind}; storage resources are outside the current mesh-draw slice (${stage})`
            );
    }
}

function assertBindingCompatible(
    existing: MutableMergedBinding,
    binding: RHIShaderBindingReflection,
    name: string,
    stage: GraphicsShaderStageName
): void {
    if (
        existing.kind !== binding.kind ||
        existing.name !== name ||
        existing.arrayIndex !== (binding.arrayIndex ?? 0) ||
        existing.minBindingSize !== binding.minBindingSize ||
        (existing.sampleType ?? 'float') !== (binding.sampleType ?? 'float') ||
        (existing.viewDimension ?? '2d') !== (binding.viewDimension ?? '2d') ||
        (existing.multisampled ?? false) !== (binding.multisampled ?? false)
    ) {
        throw new TypeError(
            `Shader binding ${bindingKey(binding.group, binding.binding)} conflicts between stages; kind, name, arrayIndex, and minBindingSize must match exactly (${stage})`
        );
    }
}

function addStageSampledPart(
    stage: GraphicsShaderStageName,
    binding: MutableMergedBinding,
    sampledByElement: Map<string, MutableStageSampledBinding>
): void {
    const elementKey = sampledElementKey(binding.name, binding.arrayIndex);
    let sampled = sampledByElement.get(elementKey);
    if (sampled === undefined) {
        sampled = {
            name: binding.name,
            arrayIndex: binding.arrayIndex,
            group: binding.group,
            texture: undefined,
            sampler: undefined
        };
        sampledByElement.set(elementKey, sampled);
    } else if (sampled.group !== binding.group) {
        throw new TypeError(
            `${stage} sampled binding ${binding.name}[${String(binding.arrayIndex)}] assigns its texture and sampler to different groups ${String(sampled.group)} and ${String(binding.group)}`
        );
    }

    if (binding.kind === 'sampled-texture') {
        if (sampled.texture !== undefined) {
            throw new TypeError(
                `${stage} sampled binding ${binding.name}[${String(binding.arrayIndex)}] declares more than one sampled-texture location`
            );
        }
        sampled.texture = binding;
        return;
    }
    if (sampled.sampler !== undefined) {
        throw new TypeError(
            `${stage} sampled binding ${binding.name}[${String(binding.arrayIndex)}] declares more than one sampler location`
        );
    }
    sampled.sampler = binding;
}

function collectStageBindings(
    stage: GraphicsShaderStageName,
    reflection: Readonly<RHIShaderReflection>,
    stageFlag: RHIShaderStageFlags,
    maxBindGroups: number,
    mergedByLocation: Map<string, MutableMergedBinding>,
    uniformLocationByName: Map<string, string>,
    storageLocationByName: Map<string, string>
): Map<string, MutableStageSampledBinding> {
    const seenInStage = new Set<string>();
    const sampledByElement = new Map<string, MutableStageSampledBinding>();
    for (let index = 0; index < reflection.bindings.length; index += 1) {
        const binding = reflection.bindings[index];
        if (binding === undefined) continue;
        requireNonNegativeSafeInteger(binding.group, `${stage} binding group`);
        requireNonNegativeSafeInteger(binding.binding, `${stage} binding index`);
        if (binding.group >= maxBindGroups) {
            throw new RangeError(
                `${stage} binding group ${String(binding.group)} exceeds maxBindGroups ${String(maxBindGroups)}`
            );
        }
        if (binding.minBindingSize !== undefined) {
            requireNonNegativeSafeInteger(binding.minBindingSize, `${stage} minBindingSize`);
        }

        const kind = requireSupportedKind(binding, stage);
        const arrayIndex = binding.arrayIndex ?? 0;
        requireNonNegativeSafeInteger(arrayIndex, `${stage} binding arrayIndex`);
        if (
            (kind === 'uniform-buffer' || kind === 'read-only-storage-buffer') &&
            binding.arrayIndex !== undefined
        ) {
            throw new TypeError(`${stage} ${kind} binding cannot declare arrayIndex`);
        }
        if (
            kind !== 'uniform-buffer' &&
            kind !== 'read-only-storage-buffer' &&
            binding.minBindingSize !== undefined
        ) {
            throw new TypeError(
                `${stage} ${kind} binding ${bindingKey(binding.group, binding.binding)} cannot declare minBindingSize`
            );
        }
        if (
            kind !== 'sampled-texture' &&
            (binding.sampleType !== undefined ||
                binding.viewDimension !== undefined ||
                binding.multisampled !== undefined)
        ) {
            throw new TypeError(
                `${stage} ${kind} binding ${bindingKey(binding.group, binding.binding)} cannot declare sampled-texture metadata`
            );
        }
        const name = requireBindingName(binding, stage, index);
        const key = bindingKey(binding.group, binding.binding);
        if (seenInStage.has(key)) {
            throw new TypeError(`${stage} reflection contains duplicate shader binding ${key}`);
        }
        seenInStage.add(key);

        let merged = mergedByLocation.get(key);
        if (merged !== undefined) {
            assertBindingCompatible(merged, binding, name, stage);
            merged.visibility |= stageFlag;
        } else {
            merged = {
                group: binding.group,
                binding: binding.binding,
                kind,
                name,
                arrayIndex,
                minBindingSize: binding.minBindingSize,
                sampleType: binding.sampleType,
                viewDimension: binding.viewDimension,
                multisampled: binding.multisampled,
                visibility: stageFlag
            };
            mergedByLocation.set(key, merged);
        }

        if (kind === 'uniform-buffer') {
            const existingLocation = uniformLocationByName.get(name);
            if (existingLocation !== undefined && existingLocation !== key) {
                throw new TypeError(
                    `Uniform block ${name} is assigned to conflicting bindings ${existingLocation} and ${key}`
                );
            }
            if (storageLocationByName.has(name)) {
                throw new TypeError(
                    `Shader resource name ${name} is used by both a uniform block and a readonly storage buffer`
                );
            }
            uniformLocationByName.set(name, key);
        } else if (kind === 'read-only-storage-buffer') {
            const existingLocation = storageLocationByName.get(name);
            if (existingLocation !== undefined && existingLocation !== key) {
                throw new TypeError(
                    `Readonly storage buffer ${name} is assigned to conflicting bindings ${existingLocation} and ${key}`
                );
            }
            if (uniformLocationByName.has(name)) {
                throw new TypeError(
                    `Shader resource name ${name} is used by both a uniform block and a readonly storage buffer`
                );
            }
            storageLocationByName.set(name, key);
        } else {
            addStageSampledPart(stage, merged, sampledByElement);
        }
    }
    return sampledByElement;
}

function mergeStageSampledBindings(
    stage: GraphicsShaderStageName,
    stageFlag: RHIShaderStageFlags,
    stageBindings: Map<string, MutableStageSampledBinding>,
    mergedByElement: Map<string, MutableSampledBinding>,
    uniformLocationByName: ReadonlyMap<string, string>,
    storageLocationByName: ReadonlyMap<string, string>
): void {
    for (const sampled of stageBindings.values()) {
        const texture = sampled.texture;
        const sampler = sampled.sampler;
        if (texture === undefined || sampler === undefined) {
            const missing = texture === undefined ? 'sampled-texture' : 'sampler';
            throw new TypeError(
                `${stage} sampled binding ${sampled.name}[${String(sampled.arrayIndex)}] is incomplete; missing matching ${missing}`
            );
        }
        if (uniformLocationByName.has(sampled.name)) {
            throw new TypeError(
                `Shader resource name ${sampled.name} is used by both a uniform block and a sampled binding`
            );
        }
        if (storageLocationByName.has(sampled.name)) {
            throw new TypeError(
                `Shader resource name ${sampled.name} is used by both a readonly storage buffer and a sampled binding`
            );
        }
        const samplerKind = sampler.kind;
        if (samplerKind !== 'sampler' && samplerKind !== 'comparison-sampler') {
            throw new TypeError(
                `${stage} sampled binding ${sampled.name}[${String(sampled.arrayIndex)}] has invalid sampler kind`
            );
        }
        const sampleType =
            texture.sampleType ?? (samplerKind === 'comparison-sampler' ? 'depth' : 'float');
        if (samplerKind === 'comparison-sampler' && sampleType !== 'depth') {
            throw new TypeError(
                `${stage} sampled binding ${sampled.name}[${String(sampled.arrayIndex)}] requires a depth texture for its comparison sampler`
            );
        }
        const viewDimension = texture.viewDimension ?? '2d';
        const multisampled = texture.multisampled ?? false;
        const samplerType =
            samplerKind === 'comparison-sampler'
                ? 'comparison'
                : sampleType === 'float'
                  ? 'filtering'
                  : 'non-filtering';

        const elementKey = sampledElementKey(sampled.name, sampled.arrayIndex);
        const existing = mergedByElement.get(elementKey);
        if (existing === undefined) {
            mergedByElement.set(elementKey, {
                name: sampled.name,
                arrayIndex: sampled.arrayIndex,
                group: sampled.group,
                textureBinding: texture.binding,
                samplerBinding: sampler.binding,
                samplerKind,
                sampleType,
                viewDimension,
                multisampled,
                samplerType,
                visibility: stageFlag
            });
            continue;
        }
        if (
            existing.group !== sampled.group ||
            existing.textureBinding !== texture.binding ||
            existing.samplerBinding !== sampler.binding ||
            existing.samplerKind !== samplerKind ||
            existing.sampleType !== sampleType ||
            existing.viewDimension !== viewDimension ||
            existing.multisampled !== multisampled ||
            existing.samplerType !== samplerType
        ) {
            throw new TypeError(
                `Sampled binding ${sampled.name}[${String(sampled.arrayIndex)}] conflicts between stages; group, textureBinding, samplerBinding, and sampler kind must match exactly (${stage})`
            );
        }
        existing.visibility |= stageFlag;
    }
}

function compareBindings(left: MutableMergedBinding, right: MutableMergedBinding): number {
    return left.group - right.group || left.binding - right.binding;
}

function compareSampledBindings(left: MutableSampledBinding, right: MutableSampledBinding): number {
    return (
        left.group - right.group ||
        left.textureBinding - right.textureBinding ||
        left.samplerBinding - right.samplerBinding ||
        left.arrayIndex - right.arrayIndex ||
        (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    );
}

function uniformBlockPlan(binding: MutableMergedBinding): Readonly<ShaderUniformBlockBindingPlan> {
    return Object.freeze({
        name: binding.name,
        group: binding.group,
        binding: binding.binding,
        visibility: binding.visibility,
        ...(binding.minBindingSize === undefined ? {} : { minBindingSize: binding.minBindingSize })
    });
}

function storageBufferPlan(
    binding: MutableMergedBinding
): Readonly<ShaderStorageBufferBindingPlan> {
    return Object.freeze({
        name: binding.name,
        group: binding.group,
        binding: binding.binding,
        visibility: binding.visibility,
        ...(binding.minBindingSize === undefined ? {} : { minBindingSize: binding.minBindingSize })
    });
}

function sampledBindingPlan(binding: MutableSampledBinding): Readonly<ShaderSampledBindingPlan> {
    return Object.freeze({
        name: binding.name,
        arrayIndex: binding.arrayIndex,
        group: binding.group,
        textureBinding: binding.textureBinding,
        samplerBinding: binding.samplerBinding,
        samplerKind: binding.samplerKind,
        visibility: binding.visibility
    });
}

/** Map one flattened sampled element to its exact portable texture or sampler layout entry. */
function layoutEntry(
    binding: MutableMergedBinding,
    sampledByElement: ReadonlyMap<string, MutableSampledBinding>
): Readonly<RHIBindGroupLayoutEntry> {
    if (binding.kind === 'uniform-buffer') {
        return Object.freeze({
            binding: binding.binding,
            visibility: binding.visibility,
            buffer: Object.freeze({
                type: 'uniform',
                ...(binding.minBindingSize === undefined
                    ? {}
                    : { minBindingSize: binding.minBindingSize })
            })
        });
    }
    if (binding.kind === 'read-only-storage-buffer') {
        return Object.freeze({
            binding: binding.binding,
            visibility: binding.visibility,
            buffer: Object.freeze({
                type: 'read-only-storage',
                ...(binding.minBindingSize === undefined
                    ? {}
                    : { minBindingSize: binding.minBindingSize })
            })
        });
    }

    const sampled = sampledByElement.get(sampledElementKey(binding.name, binding.arrayIndex));
    if (sampled === undefined) {
        throw new Error(`Shader sampled binding ${binding.name} has no compiled pair`);
    }
    if (binding.kind === 'sampled-texture') {
        return Object.freeze({
            binding: binding.binding,
            visibility: binding.visibility,
            texture: Object.freeze({
                sampleType: sampled.sampleType,
                ...(sampled.viewDimension === '2d' ? {} : { viewDimension: sampled.viewDimension }),
                ...(sampled.multisampled ? { multisampled: true } : {})
            })
        });
    }
    return Object.freeze({
        binding: binding.binding,
        visibility: binding.visibility,
        sampler: Object.freeze({
            type: sampled.samplerType
        })
    });
}

/** Compile portable shader reflection into immutable bind-group layout and resource plans. */
export function compileShaderBindingLayout(
    source: ShaderBindingLayoutSource,
    maxBindGroups: number
): Readonly<ShaderBindingLayoutPlan> {
    if (!Number.isSafeInteger(maxBindGroups) || maxBindGroups < 1) {
        throw new RangeError('maxBindGroups must be a positive safe integer');
    }

    const mergedByLocation = new Map<string, MutableMergedBinding>();
    const uniformLocationByName = new Map<string, string>();
    const storageLocationByName = new Map<string, string>();
    const vertexSampled = collectStageBindings(
        'vertex',
        reflectionForStage(source, 'vertex'),
        RHIShaderStage.VERTEX,
        maxBindGroups,
        mergedByLocation,
        uniformLocationByName,
        storageLocationByName
    );
    const fragmentSampled = collectStageBindings(
        'fragment',
        reflectionForStage(source, 'fragment'),
        RHIShaderStage.FRAGMENT,
        maxBindGroups,
        mergedByLocation,
        uniformLocationByName,
        storageLocationByName
    );

    const sampledByElement = new Map<string, MutableSampledBinding>();
    mergeStageSampledBindings(
        'vertex',
        RHIShaderStage.VERTEX,
        vertexSampled,
        sampledByElement,
        uniformLocationByName,
        storageLocationByName
    );
    mergeStageSampledBindings(
        'fragment',
        RHIShaderStage.FRAGMENT,
        fragmentSampled,
        sampledByElement,
        uniformLocationByName,
        storageLocationByName
    );

    const merged = [...mergedByLocation.values()].sort(compareBindings);
    const highestActiveGroup = merged.at(-1)?.group ?? -1;
    const entriesByGroup = Array.from(
        { length: highestActiveGroup + 1 },
        () => [] as Readonly<RHIBindGroupLayoutEntry>[]
    );
    for (const binding of merged) {
        entriesByGroup[binding.group]?.push(layoutEntry(binding, sampledByElement));
    }

    const bindGroupLayoutDescriptors = Object.freeze(
        entriesByGroup.map(entries =>
            Object.freeze({
                entries: Object.freeze(entries)
            })
        )
    );
    const activeGroupIndices = Object.freeze(
        entriesByGroup.flatMap((entries, group) => (entries.length === 0 ? [] : [group]))
    );
    const uniformBlocks = Object.freeze(
        merged.filter(binding => binding.kind === 'uniform-buffer').map(uniformBlockPlan)
    );
    const uniformBlocksByName = new Map(uniformBlocks.map(block => [block.name, block] as const));
    const storageBuffers = Object.freeze(
        merged.filter(binding => binding.kind === 'read-only-storage-buffer').map(storageBufferPlan)
    );
    const storageBuffersByName = new Map(
        storageBuffers.map(buffer => [buffer.name, buffer] as const)
    );
    const sampledBindings = Object.freeze(
        [...sampledByElement.values()].sort(compareSampledBindings).map(sampledBindingPlan)
    );
    const sampledBindingsByElement = new Map(
        sampledBindings.map(
            binding => [sampledElementKey(binding.name, binding.arrayIndex), binding] as const
        )
    );

    return Object.freeze({
        bindGroupLayoutDescriptors,
        activeGroupIndices,
        uniformBlocks,
        sampledBindings,
        storageBuffers,
        getUniformBlockBinding(name: string): Readonly<ShaderUniformBlockBindingPlan> | undefined {
            return uniformBlocksByName.get(name);
        },
        getSampledBinding(
            name: string,
            arrayIndex = 0
        ): Readonly<ShaderSampledBindingPlan> | undefined {
            requireNonNegativeSafeInteger(arrayIndex, 'Sampled binding arrayIndex');
            return sampledBindingsByElement.get(sampledElementKey(name, arrayIndex));
        },
        getStorageBufferBinding(
            name: string
        ): Readonly<ShaderStorageBufferBindingPlan> | undefined {
            return storageBuffersByName.get(name);
        }
    });
}
