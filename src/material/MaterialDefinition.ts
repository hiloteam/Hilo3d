import type Matrix3 from '../math/Matrix3';
import type Texture from '../texture/Texture';

/** Semantic material pass requested by a render pipeline. */
export type MaterialPassRole =
    | 'forward'
    | 'depth-only'
    | 'shadow-caster'
    | 'motion-vector'
    | 'material-attributes'
    | 'picking'
    | `user:${string}`;

/** High-level surface family. It selects a surface evaluator, not a render pass. */
export type MaterialFamily = 'basic' | 'pbr' | 'geometry' | 'sprite' | 'custom';

/** Domain in which a material definition can be evaluated. */
export type MaterialSurfaceDomain = 'surface' | 'unlit' | 'post-process';

/** Portable profile supported by a material definition. */
export type MaterialRenderingProfile = 'portable' | 'webgpu-high-end';

/** How a missing semantic role is handled before an RHI frame begins. */
export type MaterialPassFallback = 'required' | 'safe-fallback' | 'skip';

/** Stable fragment-output contract selected by a semantic pass. */
export type MaterialFragmentOutput =
    'color' | 'depth-only' | 'motion-vector' | 'material-attributes' | 'picking';

/** Backend-neutral fixed-function state names. */
export type MaterialFrontFace = 'ccw' | 'cw';
export type MaterialCullMode = 'none' | 'front' | 'back';
export type MaterialCompareFunction =
    | 'never'
    | 'less'
    | 'equal'
    | 'less-equal'
    | 'greater'
    | 'not-equal'
    | 'greater-equal'
    | 'always';
export type MaterialStencilOperation =
    | 'keep'
    | 'zero'
    | 'replace'
    | 'invert'
    | 'increment-clamp'
    | 'decrement-clamp'
    | 'increment-wrap'
    | 'decrement-wrap';
export type MaterialBlendOperation = 'add' | 'subtract' | 'reverse-subtract' | 'min' | 'max';
export type MaterialBlendFactor =
    | 'zero'
    | 'one'
    | 'src'
    | 'one-minus-src'
    | 'src-alpha'
    | 'one-minus-src-alpha'
    | 'dst'
    | 'one-minus-dst'
    | 'dst-alpha'
    | 'one-minus-dst-alpha'
    | 'src-alpha-saturated'
    | 'constant'
    | 'one-minus-constant';

export interface MaterialBlendComponent {
    readonly operation: MaterialBlendOperation;
    readonly srcFactor: MaterialBlendFactor;
    readonly dstFactor: MaterialBlendFactor;
}

export interface MaterialBlendState {
    readonly color: Readonly<MaterialBlendComponent>;
    readonly alpha: Readonly<MaterialBlendComponent>;
}

export interface MaterialStencilFaceState {
    readonly compare: MaterialCompareFunction;
    readonly failOp: MaterialStencilOperation;
    readonly depthFailOp: MaterialStencilOperation;
    readonly passOp: MaterialStencilOperation;
}

export interface MaterialStencilState {
    readonly front: Readonly<MaterialStencilFaceState>;
    readonly back: Readonly<MaterialStencilFaceState>;
    readonly readMask: number;
    readonly writeMask: number;
    readonly reference: number;
}

/** Immutable pipeline state owned by one semantic material pass. */
export interface MaterialPipelineState {
    /** Line-list rasterization request. Geometry normalization remains a renderer concern. */
    readonly wireframe: boolean;
    readonly frontFace: MaterialFrontFace;
    readonly cullMode: MaterialCullMode;
    readonly depthTest: boolean;
    readonly depthWrite: boolean;
    readonly depthCompare: MaterialCompareFunction;
    readonly depthRange: readonly [number, number];
    readonly blend?: Readonly<MaterialBlendState>;
    readonly stencil?: Readonly<MaterialStencilState>;
    readonly alphaToCoverage: boolean;
}

/** Coverage controls whether a surface exists; it is independent of transmission and blending. */
export type MaterialCoverage =
    | Readonly<{ mode: 'opaque' }>
    | Readonly<{ mode: 'mask'; cutoff: number }>
    | Readonly<{ mode: 'alpha-to-coverage'; cutoff: number }>;

/** Compositing controls how a shaded result combines with the existing color target. */
export type MaterialCompositing =
    | Readonly<{ mode: 'opaque' }>
    | Readonly<{ mode: 'alpha-blend'; premultiplied: boolean }>
    | Readonly<{ mode: 'additive'; premultiplied: boolean }>
    | Readonly<{ mode: 'custom'; blend: Readonly<MaterialBlendState>; depthWrite: boolean }>;

/** Encoding applied to a sampled texture before it enters the surface evaluator. */
export type MaterialTextureEncoding = 'linear' | 'srgb' | 'data';

/** Stable four-channel source mapping. */
export type MaterialTextureChannel = 'r' | 'g' | 'b' | 'a' | 'zero' | 'one';

export interface MaterialTextureSlotDefinition {
    readonly name: string;
    readonly index: number;
    readonly encoding: MaterialTextureEncoding;
    readonly channels: readonly [
        MaterialTextureChannel,
        MaterialTextureChannel,
        MaterialTextureChannel,
        MaterialTextureChannel
    ];
    readonly sampleType: 'float' | 'depth' | 'sint' | 'uint';
    readonly viewDimension: '2d' | 'cube' | '3d' | '2d-array';
    readonly presence: 'static' | 'fallback';
    /** UV sets for which this definition compiled vertex inputs. */
    readonly uvSets: readonly (0 | 1)[];
}

/** Per-instance texture binding. Transform and UV selection belong to the slot, not the material. */
export interface MaterialTextureSlotBinding {
    readonly texture: Texture<unknown>;
    readonly uvSet: 0 | 1;
    readonly transform: Matrix3 | null;
    readonly encoding: MaterialTextureEncoding;
    readonly channels: MaterialTextureSlotDefinition['channels'];
}

export interface MaterialTextureSlotInput {
    readonly texture: Texture<unknown>;
    readonly uvSet?: 0 | 1;
    readonly transform?: Matrix3 | null;
    readonly encoding?: MaterialTextureEncoding;
    readonly channels?: MaterialTextureSlotDefinition['channels'];
}

/** Shader source recipe retained across device loss; it never contains a native pipeline. */
export type MaterialShaderModule =
    | Readonly<{ kind: 'builtin'; family: Exclude<MaterialFamily, 'custom'> }>
    | Readonly<{
          kind: 'glsl';
          vertexSource: string;
          fragmentSource: string;
          sourceRevision: string;
      }>;

export interface MaterialPassDefinition {
    readonly role: MaterialPassRole;
    readonly shader: MaterialShaderModule;
    readonly fragmentOutput: MaterialFragmentOutput;
    readonly state: Readonly<MaterialPipelineState>;
    readonly fallback: MaterialPassFallback;
}

export interface MaterialDefinitionParameters {
    readonly id: string;
    readonly family: MaterialFamily;
    readonly domain?: MaterialSurfaceDomain;
    readonly shaderRevision?: string;
    readonly staticFeatures?: Readonly<Record<string, number>>;
    readonly coverage?: MaterialCoverage;
    readonly compositing?: MaterialCompositing;
    readonly instanceOverrides?: Readonly<{
        coverage?: boolean;
        compositing?: boolean;
    }>;
    readonly textureSlots?: readonly Readonly<MaterialTextureSlotDefinition>[];
    readonly passes: readonly Readonly<MaterialPassDefinition>[];
    readonly profiles?: readonly MaterialRenderingProfile[];
}

const DEFAULT_CHANNELS = Object.freeze([
    'r',
    'g',
    'b',
    'a'
] as const satisfies MaterialTextureSlotDefinition['channels']);

const DEFAULT_PIPELINE_STATE: Readonly<MaterialPipelineState> = Object.freeze({
    wireframe: false,
    frontFace: 'ccw',
    cullMode: 'back',
    depthTest: true,
    depthWrite: true,
    depthCompare: 'less-equal',
    depthRange: Object.freeze([0, 1] as const),
    alphaToCoverage: false
});

function requireUInt32(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
        throw new RangeError(`${name} must be an unsigned 32-bit integer`);
    }
    return value;
}

function snapshotBlendComponent(
    component: Readonly<MaterialBlendComponent>
): Readonly<MaterialBlendComponent> {
    return Object.freeze({
        operation: component.operation,
        srcFactor: component.srcFactor,
        dstFactor: component.dstFactor
    });
}

export function snapshotMaterialBlendState(
    blend: Readonly<MaterialBlendState>
): Readonly<MaterialBlendState> {
    return Object.freeze({
        color: snapshotBlendComponent(blend.color),
        alpha: snapshotBlendComponent(blend.alpha)
    });
}

function snapshotStencilFace(
    face: Readonly<MaterialStencilFaceState>
): Readonly<MaterialStencilFaceState> {
    return Object.freeze({
        compare: face.compare,
        failOp: face.failOp,
        depthFailOp: face.depthFailOp,
        passOp: face.passOp
    });
}

export function snapshotMaterialPipelineState(
    state: Readonly<MaterialPipelineState>
): Readonly<MaterialPipelineState> {
    const minDepth = state.depthRange[0];
    const maxDepth = state.depthRange[1];
    if (
        !Number.isFinite(minDepth) ||
        !Number.isFinite(maxDepth) ||
        minDepth < 0 ||
        maxDepth > 1 ||
        minDepth > maxDepth
    ) {
        throw new RangeError('Material depthRange must satisfy 0 <= min <= max <= 1');
    }
    const stencil = state.stencil;
    return Object.freeze({
        wireframe: state.wireframe,
        frontFace: state.frontFace,
        cullMode: state.cullMode,
        depthTest: state.depthTest,
        depthWrite: state.depthWrite,
        depthCompare: state.depthCompare,
        depthRange: Object.freeze([minDepth, maxDepth] as const),
        ...(state.blend === undefined ? {} : { blend: snapshotMaterialBlendState(state.blend) }),
        ...(stencil === undefined
            ? {}
            : {
                  stencil: Object.freeze({
                      front: snapshotStencilFace(stencil.front),
                      back: snapshotStencilFace(stencil.back),
                      readMask: requireUInt32(stencil.readMask, 'Material stencil readMask'),
                      writeMask: requireUInt32(stencil.writeMask, 'Material stencil writeMask'),
                      reference: requireUInt32(stencil.reference, 'Material stencil reference')
                  })
              }),
        alphaToCoverage: state.alphaToCoverage
    });
}

function snapshotShaderModule(module: MaterialShaderModule): MaterialShaderModule {
    if (module.kind === 'builtin') {
        return Object.freeze({ kind: 'builtin', family: module.family });
    }
    if (module.vertexSource.length === 0 || module.fragmentSource.length === 0) {
        throw new TypeError('GLSL material modules require non-empty vertex and fragment source');
    }
    if (module.sourceRevision.length === 0) {
        throw new TypeError('GLSL material modules require a stable sourceRevision');
    }
    return Object.freeze({
        kind: 'glsl',
        vertexSource: module.vertexSource,
        fragmentSource: module.fragmentSource,
        sourceRevision: module.sourceRevision
    });
}

function snapshotTextureSlot(
    slot: Readonly<MaterialTextureSlotDefinition>
): Readonly<MaterialTextureSlotDefinition> {
    if (slot.name.length === 0) throw new TypeError('Material texture slot name must be non-empty');
    if (!Number.isSafeInteger(slot.index) || slot.index < 0) {
        throw new RangeError('Material texture slot index must be a non-negative safe integer');
    }
    const uvSets: (0 | 1)[] = [];
    for (const uvSet of slot.uvSets.length === 0 ? ([0] as const) : slot.uvSets) {
        if (uvSets.includes(uvSet)) {
            throw new TypeError(`Material texture slot ${slot.name} has invalid UV sets`);
        }
        uvSets.push(uvSet);
    }
    const channels: MaterialTextureSlotDefinition['channels'] = [
        slot.channels[0],
        slot.channels[1],
        slot.channels[2],
        slot.channels[3]
    ];
    return Object.freeze({
        name: slot.name,
        index: slot.index,
        encoding: slot.encoding,
        channels: Object.freeze(channels),
        sampleType: slot.sampleType,
        viewDimension: slot.viewDimension,
        presence: slot.presence,
        uvSets: Object.freeze(uvSets)
    });
}

/**
 * Immutable material structure shared by any number of instances.
 *
 * Definitions own shader topology, texture layout, supported pass roles and pass state. Runtime
 * parameters and texture identities deliberately live in {@link MaterialInstance}.
 */
export class MaterialDefinition {
    readonly id: string;
    readonly family: MaterialFamily;
    readonly domain: MaterialSurfaceDomain;
    readonly shaderRevision: string;
    readonly staticFeatures: Readonly<Record<string, number>>;
    readonly coverage: MaterialCoverage;
    readonly compositing: MaterialCompositing;
    readonly instanceOverrides: Readonly<{ coverage: boolean; compositing: boolean }>;
    readonly textureSlots: readonly Readonly<MaterialTextureSlotDefinition>[];
    readonly profiles: readonly MaterialRenderingProfile[];
    readonly passes: readonly Readonly<MaterialPassDefinition>[];
    readonly #slotsByName = new Map<string, Readonly<MaterialTextureSlotDefinition>>();
    readonly #passesByRole = new Map<MaterialPassRole, Readonly<MaterialPassDefinition>>();

    constructor(parameters: Readonly<MaterialDefinitionParameters>) {
        if (parameters.id.trim().length === 0) {
            throw new TypeError('Material definition id must be non-empty');
        }
        if (parameters.passes.length === 0) {
            throw new RangeError('Material definition requires at least one semantic pass');
        }
        this.id = parameters.id;
        this.family = parameters.family;
        this.domain = parameters.domain ?? 'surface';
        this.shaderRevision = parameters.shaderRevision ?? '1';
        const coverage = parameters.coverage;
        if (coverage === undefined || coverage.mode === 'opaque') {
            this.coverage = Object.freeze({ mode: 'opaque' });
        } else {
            if (!Number.isFinite(coverage.cutoff) || coverage.cutoff < 0 || coverage.cutoff > 1) {
                throw new RangeError(
                    'Material definition coverage cutoff must be between zero and one'
                );
            }
            this.coverage = Object.freeze({ mode: coverage.mode, cutoff: coverage.cutoff });
        }
        const compositing = parameters.compositing;
        if (compositing === undefined || compositing.mode === 'opaque') {
            this.compositing = Object.freeze({ mode: 'opaque' });
        } else if (compositing.mode === 'alpha-blend') {
            this.compositing = Object.freeze({
                mode: 'alpha-blend',
                premultiplied: compositing.premultiplied
            });
        } else if (compositing.mode === 'additive') {
            this.compositing = Object.freeze({
                mode: 'additive',
                premultiplied: compositing.premultiplied
            });
        } else {
            this.compositing = Object.freeze({
                mode: 'custom',
                blend: snapshotMaterialBlendState(compositing.blend),
                depthWrite: compositing.depthWrite
            });
        }
        this.instanceOverrides = Object.freeze({
            coverage: parameters.instanceOverrides?.coverage ?? false,
            compositing: parameters.instanceOverrides?.compositing ?? false
        });
        const staticFeatures: Record<string, number> = {};
        for (const [name, value] of Object.entries(parameters.staticFeatures ?? {})) {
            if (name.length === 0 || !Number.isFinite(value)) {
                throw new TypeError(
                    'Material static features require non-empty names and finite values'
                );
            }
            staticFeatures[name] = value;
        }
        this.staticFeatures = Object.freeze(staticFeatures);

        const slots = (parameters.textureSlots ?? []).map(snapshotTextureSlot);
        const slotIndices = new Set<number>();
        for (const slot of slots) {
            if (this.#slotsByName.has(slot.name) || slotIndices.has(slot.index)) {
                throw new TypeError(`Material definition ${this.id} has a duplicate texture slot`);
            }
            this.#slotsByName.set(slot.name, slot);
            slotIndices.add(slot.index);
        }
        this.textureSlots = Object.freeze(slots);

        const passes = parameters.passes.map(pass => {
            if (this.#passesByRole.has(pass.role)) {
                throw new TypeError(
                    `Material definition ${this.id} declares duplicate role ${pass.role}`
                );
            }
            if (pass.fragmentOutput === 'depth-only' && pass.state.blend !== undefined) {
                throw new TypeError(`Depth-only material role ${pass.role} cannot enable blending`);
            }
            const snapshot = Object.freeze({
                role: pass.role,
                shader: snapshotShaderModule(pass.shader),
                fragmentOutput: pass.fragmentOutput,
                state: snapshotMaterialPipelineState(pass.state),
                fallback: pass.fallback
            });
            this.#passesByRole.set(pass.role, snapshot);
            return snapshot;
        });
        this.passes = Object.freeze(passes);
        if (!this.#passesByRole.has('forward') && this.domain === 'surface') {
            throw new TypeError(`Surface material definition ${this.id} requires a forward role`);
        }
        this.profiles = Object.freeze([...(parameters.profiles ?? ['portable'])]);
        Object.freeze(this);
    }

    getPass(role: MaterialPassRole): Readonly<MaterialPassDefinition> | null {
        return this.#passesByRole.get(role) ?? null;
    }

    getTextureSlot(name: string): Readonly<MaterialTextureSlotDefinition> | null {
        return this.#slotsByName.get(name) ?? null;
    }
}

export const DEFAULT_MATERIAL_PIPELINE_STATE = DEFAULT_PIPELINE_STATE;
export const DEFAULT_MATERIAL_TEXTURE_CHANNELS = DEFAULT_CHANNELS;
