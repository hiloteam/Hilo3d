import {
    DEFAULT_MATERIAL_PIPELINE_STATE,
    DEFAULT_MATERIAL_TEXTURE_CHANNELS,
    MaterialDefinition,
    type MaterialCompositing,
    type MaterialCoverage,
    type MaterialCullMode,
    type MaterialFamily,
    type MaterialFrontFace,
    type MaterialPassDefinition,
    type MaterialPipelineState,
    type MaterialRenderingProfile,
    type MaterialTextureEncoding,
    type MaterialTextureSlotDefinition,
    type MaterialTextureSlotInput
} from './MaterialDefinition';
import type Texture from '../texture/Texture';

export interface BuiltInTextureSlotRequest {
    readonly name: string;
    readonly index: number;
    readonly value: Texture<unknown> | MaterialTextureSlotInput | null | undefined;
    readonly encoding?: MaterialTextureEncoding;
    readonly channels?: MaterialTextureSlotDefinition['channels'];
    readonly presence?: MaterialTextureSlotDefinition['presence'];
}

export interface BuiltInMaterialDefinitionRequest {
    readonly family: Exclude<MaterialFamily, 'custom'>;
    readonly lightModel: 0 | 1 | 2 | 3 | 4;
    readonly textureSlots?: readonly Readonly<BuiltInTextureSlotRequest>[];
    readonly staticFeatures?: Readonly<Record<string, number>>;
    readonly coverage?: MaterialCoverage;
    readonly compositing?: MaterialCompositing;
    readonly frontFace?: MaterialFrontFace;
    readonly cullMode?: MaterialCullMode;
    readonly depthTest?: boolean;
    readonly depthWrite?: boolean;
    readonly depthCompare?: MaterialPipelineState['depthCompare'];
    readonly wireframe?: boolean;
    readonly state?: Partial<Readonly<MaterialPipelineState>>;
    readonly profiles?: readonly MaterialRenderingProfile[];
}

const definitions = new Map<string, MaterialDefinition>();

function textureInput(value: BuiltInTextureSlotRequest['value']): MaterialTextureSlotInput | null {
    if (value === null || value === undefined) return null;
    return 'texture' in value ? value : { texture: value };
}

function stateSignature(state: Readonly<MaterialPipelineState>): string {
    return [
        state.frontFace,
        state.wireframe ? 1 : 0,
        state.cullMode,
        state.depthTest ? 1 : 0,
        state.depthWrite ? 1 : 0,
        state.depthCompare,
        state.depthRange[0],
        state.depthRange[1],
        state.alphaToCoverage ? 1 : 0
    ].join(',');
}

function policySignature(coverage: MaterialCoverage, compositing: MaterialCompositing): string {
    const coverageKey =
        coverage.mode === 'opaque' ? 'opaque' : `${coverage.mode}:${String(coverage.cutoff)}`;
    switch (compositing.mode) {
        case 'opaque':
            return `${coverageKey}|${compositing.mode}`;
        case 'additive':
            return `${coverageKey}|additive:${compositing.premultiplied ? 'premultiplied' : 'straight'}`;
        case 'alpha-blend':
            return `${coverageKey}|alpha:${compositing.premultiplied ? 'premultiplied' : 'straight'}`;
        case 'custom':
            return `${coverageKey}|custom:${compositing.depthWrite ? 'write' : 'read'}`;
    }
}

function buildPasses(
    family: Exclude<MaterialFamily, 'custom'>,
    forwardState: Readonly<MaterialPipelineState>
): readonly Readonly<MaterialPassDefinition>[] {
    const module = Object.freeze({ kind: 'builtin' as const, family });
    const unblendedState: Readonly<MaterialPipelineState> = Object.freeze({
        wireframe: forwardState.wireframe,
        frontFace: forwardState.frontFace,
        cullMode: forwardState.cullMode,
        depthTest: forwardState.depthTest,
        depthWrite: forwardState.depthWrite,
        depthCompare: forwardState.depthCompare,
        depthRange: forwardState.depthRange,
        ...(forwardState.stencil === undefined ? {} : { stencil: forwardState.stencil }),
        alphaToCoverage: forwardState.alphaToCoverage
    });
    const depthState: Readonly<MaterialPipelineState> = Object.freeze({
        ...unblendedState,
        depthTest: true,
        depthWrite: true,
        alphaToCoverage: false
    });
    const outputState: Readonly<MaterialPipelineState> = Object.freeze({ ...unblendedState });
    return Object.freeze([
        Object.freeze({
            role: 'forward' as const,
            shader: module,
            fragmentOutput: 'color' as const,
            state: forwardState,
            fallback: 'required' as const
        }),
        Object.freeze({
            role: 'depth-only' as const,
            shader: module,
            fragmentOutput: 'depth-only' as const,
            state: depthState,
            fallback: 'required' as const
        }),
        Object.freeze({
            role: 'shadow-caster' as const,
            shader: module,
            fragmentOutput: 'depth-only' as const,
            state: depthState,
            fallback: 'required' as const
        }),
        Object.freeze({
            role: 'picking' as const,
            shader: module,
            fragmentOutput: 'picking' as const,
            state: outputState,
            fallback: 'required' as const
        })
    ]);
}

/** Return one process-canonical immutable definition for a built-in material topology. */
export function getBuiltInMaterialDefinition(
    request: Readonly<BuiltInMaterialDefinitionRequest>
): MaterialDefinition {
    const coverage = request.coverage ?? ({ mode: 'opaque' } as const);
    const compositing = request.compositing ?? ({ mode: 'opaque' } as const);
    const slots: MaterialTextureSlotDefinition[] = [];
    for (const requested of request.textureSlots ?? []) {
        const input = textureInput(requested.value);
        if (input === null && requested.presence !== 'fallback') continue;
        const uvSet = input?.uvSet ?? input?.texture.uv ?? 0;
        slots.push({
            name: requested.name,
            index: requested.index,
            encoding: input?.encoding ?? requested.encoding ?? 'data',
            channels: input?.channels ?? requested.channels ?? DEFAULT_MATERIAL_TEXTURE_CHANNELS,
            sampleType: 'float',
            viewDimension:
                Reflect.get(input?.texture ?? {}, 'isCubeTexture') === true ? 'cube' : '2d',
            presence: requested.presence ?? 'static',
            uvSets: [uvSet]
        });
    }
    slots.sort((left, right) => left.index - right.index);
    const state: Readonly<MaterialPipelineState> = Object.freeze({
        ...DEFAULT_MATERIAL_PIPELINE_STATE,
        ...request.state,
        wireframe:
            request.wireframe ??
            request.state?.wireframe ??
            DEFAULT_MATERIAL_PIPELINE_STATE.wireframe,
        frontFace:
            request.frontFace ??
            request.state?.frontFace ??
            DEFAULT_MATERIAL_PIPELINE_STATE.frontFace,
        cullMode:
            request.cullMode ?? request.state?.cullMode ?? DEFAULT_MATERIAL_PIPELINE_STATE.cullMode,
        depthTest:
            request.depthTest ??
            request.state?.depthTest ??
            DEFAULT_MATERIAL_PIPELINE_STATE.depthTest,
        depthWrite:
            request.depthWrite ??
            request.state?.depthWrite ??
            DEFAULT_MATERIAL_PIPELINE_STATE.depthWrite,
        depthCompare:
            request.depthCompare ??
            request.state?.depthCompare ??
            DEFAULT_MATERIAL_PIPELINE_STATE.depthCompare,
        alphaToCoverage: coverage.mode === 'alpha-to-coverage'
    });
    const features: Record<string, number> = {
        LIGHT_MODEL: request.lightModel,
        ...(request.staticFeatures ?? {})
    };
    const featureKey = Object.entries(features)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, value]) => `${name}=${String(value)}`)
        .join(',');
    const slotKey = slots
        .map(
            slot =>
                `${String(slot.index)}:${slot.name}:${slot.encoding}:${slot.channels.join('.')}:${slot.uvSets.join('.')}`
        )
        .join(',');
    const profiles = request.profiles ?? (['portable'] as const);
    const id = `builtin:${request.family}|${featureKey}|${slotKey}|${policySignature(coverage, compositing)}|${stateSignature(state)}|${profiles.join(',')}`;
    let definition = definitions.get(id);
    if (definition !== undefined) return definition;
    definition = new MaterialDefinition({
        id,
        family: request.family,
        staticFeatures: features,
        coverage,
        compositing,
        textureSlots: slots,
        passes: buildPasses(request.family, state),
        profiles
    });
    definitions.set(id, definition);
    return definition;
}

/** @internal Test/reset hook; runtime code keeps definitions process-canonical. */
export function resetBuiltInMaterialDefinitions(): void {
    definitions.clear();
}
