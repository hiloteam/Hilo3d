import math from '../math/math';
import type Color from '../math/Color';
import Matrix3 from '../math/Matrix3';
import semantic, { resolveSemanticBinding } from './semantic';
import Texture from '../texture/Texture';
import type Mesh from '../core/Mesh';
import type UniformBuffer from '../render/UniformBuffer';
import type { ShaderOptions } from '../render/types';
import type { SemanticFrameState } from '../render/frame/SemanticFrameState';
import {
    DEFAULT_MATERIAL_TEXTURE_CHANNELS,
    type MaterialCompositing,
    type MaterialCoverage,
    type MaterialTextureSlotBinding,
    type MaterialTextureSlotInput,
    MaterialDefinition
} from './MaterialDefinition';
import {
    MaterialAttributeSemantic,
    MaterialTextureSemantic,
    MaterialUniformSemantic,
    type MaterialSemanticName,
    type MaterialTextureSemanticName
} from './MaterialSemantics';

export interface ProgramBindingInfo {
    textureIndex?: number;
    name?: string;
}

/** @internal Explicit pass/frame semantic source used only by the shared renderer. */
export interface SemanticProgramBindingInfo extends ProgramBindingInfo {
    semanticFrame?: SemanticFrameState;
}

export interface MaterialBindingInfo {
    readonly isBlankInfo?: boolean;
    readonly isDependMesh?: boolean;
    readonly notSupportInstanced?: boolean;
    get(mesh: Mesh, material: MaterialInstance, programInfo: ProgramBindingInfo): unknown;
}

export type MaterialBinding = MaterialSemanticName | MaterialBindingInfo;
export type MaterialBindingMap = Record<string, MaterialBinding>;
export type MaterialTexture = Texture<unknown>;
export type MaterialTextureValue = MaterialTexture | Color | null;

export interface MaterialInstanceParameters {
    readonly name?: string | null;
    readonly userData?: unknown;
    readonly coverage?: MaterialCoverage;
    readonly compositing?: MaterialCompositing;
    readonly opacity?: number;
    readonly opacityMap?: Texture<unknown> | MaterialTextureSlotInput | null;
    readonly normalMap?: Texture<unknown> | MaterialTextureSlotInput | null;
    readonly normalScale?: number;
    readonly parallaxMap?: Texture<unknown> | MaterialTextureSlotInput | null;
    /** Registered std140 blocks keyed by their globally stable GLSL block name. */
    readonly uniformBlocks?: Readonly<Record<string, UniformBuffer>>;
}

export interface InstancedUniform {
    readonly name: string;
    readonly info: MaterialBindingInfo;
}

const MAX_MATERIAL_ID = 0xffffffff;
let nextMaterialId = 1;

function isBindingInfo(value: unknown): value is MaterialBindingInfo {
    return (
        typeof value === 'object' &&
        value !== null &&
        'get' in value &&
        typeof value.get === 'function'
    );
}

function isMaterialTexture(value: unknown): value is MaterialTexture {
    return value instanceof Texture;
}

function snapshotCoverage(value: MaterialCoverage | undefined): MaterialCoverage {
    if (value === undefined || value.mode === 'opaque') return Object.freeze({ mode: 'opaque' });
    if (!Number.isFinite(value.cutoff) || value.cutoff < 0 || value.cutoff > 1) {
        throw new RangeError('Material coverage cutoff must be between zero and one');
    }
    return Object.freeze({ mode: value.mode, cutoff: value.cutoff });
}

function snapshotCompositing(value: MaterialCompositing | undefined): MaterialCompositing {
    if (value === undefined || value.mode === 'opaque') {
        return Object.freeze({ mode: 'opaque' });
    }
    if (value.mode === 'alpha-blend') {
        return Object.freeze({ mode: 'alpha-blend', premultiplied: value.premultiplied });
    }
    if (value.mode === 'additive') {
        return Object.freeze({ mode: 'additive', premultiplied: value.premultiplied });
    }
    return Object.freeze({
        mode: 'custom',
        blend: Object.freeze({
            color: Object.freeze({ ...value.blend.color }),
            alpha: Object.freeze({ ...value.blend.alpha })
        }),
        depthWrite: value.depthWrite
    });
}

function coverageEqual(left: MaterialCoverage, right: MaterialCoverage): boolean {
    return (
        left.mode === right.mode &&
        (left.mode === 'opaque' || (right.mode !== 'opaque' && left.cutoff === right.cutoff))
    );
}

function compositingEqual(left: MaterialCompositing, right: MaterialCompositing): boolean {
    if (left.mode !== right.mode) return false;
    if (left.mode === 'opaque' || left.mode === 'additive') return true;
    if (left.mode === 'alpha-blend') {
        return right.mode === 'alpha-blend' && left.premultiplied === right.premultiplied;
    }
    return (
        right.mode === 'custom' &&
        left.depthWrite === right.depthWrite &&
        left.blend.color.operation === right.blend.color.operation &&
        left.blend.color.srcFactor === right.blend.color.srcFactor &&
        left.blend.color.dstFactor === right.blend.color.dstFactor &&
        left.blend.alpha.operation === right.blend.alpha.operation &&
        left.blend.alpha.srcFactor === right.blend.alpha.srcFactor &&
        left.blend.alpha.dstFactor === right.blend.alpha.dstFactor
    );
}

function normalizeTextureSlotInput(
    input: Texture<unknown> | MaterialTextureSlotInput
): MaterialTextureSlotInput {
    return input instanceof Texture ? { texture: input } : input;
}

/**
 * Mutable material data bound to one immutable {@link MaterialDefinition}.
 *
 * Ordinary parameter and texture changes advance `revision` but never alter the definition,
 * resource layout, supported pass roles or shader topology. A topology change requires a new
 * instance created with another definition.
 */
export class MaterialInstance {
    readonly isMaterialInstance = true;
    readonly className: string = 'MaterialInstance';
    readonly id: string;
    readonly materialId: number;
    readonly definition: MaterialDefinition;
    readonly coverage: MaterialCoverage;
    readonly compositing: MaterialCompositing;
    name: string | null;
    userData: unknown;
    readonly uniforms: MaterialBindingMap = {};
    readonly attributes: MaterialBindingMap = {};
    readonly uniformBlocks: Record<string, UniformBuffer> = {};
    readonly #textureSlots = new Map<string, MaterialTextureSlotBinding>();
    readonly #textureSlotByIndex: (MaterialTextureSlotBinding | null)[];
    readonly #dirtyTextureSlots = new Set<number>();
    #revision = 0;
    #opacity = 1;
    #normalScale = 1;
    #instancedUniforms: InstancedUniform[] | null = null;
    #bindingsInitialized = false;

    constructor(
        definition: MaterialDefinition,
        parameters: Readonly<MaterialInstanceParameters> = {},
        initializeBindings = true
    ) {
        if (!(definition instanceof MaterialDefinition)) {
            throw new TypeError('MaterialInstance requires an immutable MaterialDefinition');
        }
        if (nextMaterialId > MAX_MATERIAL_ID) {
            throw new RangeError('Material instance identity space is exhausted');
        }
        this.definition = definition;
        this.materialId = nextMaterialId++;
        this.id = math.generateUUID('MaterialInstance');
        this.name = parameters.name ?? null;
        this.userData = parameters.userData ?? null;
        this.coverage = snapshotCoverage(parameters.coverage ?? definition.coverage);
        this.compositing = snapshotCompositing(parameters.compositing ?? definition.compositing);
        if (
            !definition.instanceOverrides.coverage &&
            !coverageEqual(this.coverage, definition.coverage)
        ) {
            throw new TypeError(
                `Material definition ${definition.id} does not allow coverage overrides`
            );
        }
        if (
            !definition.instanceOverrides.compositing &&
            !compositingEqual(this.compositing, definition.compositing)
        ) {
            throw new TypeError(
                `Material definition ${definition.id} does not allow compositing overrides`
            );
        }
        this.#textureSlotByIndex = new Array<MaterialTextureSlotBinding | null>(
            definition.textureSlots.reduce((maximum, slot) => Math.max(maximum, slot.index + 1), 0)
        ).fill(null);
        if (parameters.opacity !== undefined) this.opacity = parameters.opacity;
        if (parameters.normalScale !== undefined) this.normalScale = parameters.normalScale;
        if (parameters.opacityMap) this.setTextureSlot('opacity', parameters.opacityMap);
        if (parameters.normalMap) this.setTextureSlot('normal', parameters.normalMap);
        if (parameters.parallaxMap) this.setTextureSlot('parallax', parameters.parallaxMap);
        if (parameters.uniformBlocks !== undefined) {
            Object.assign(this.uniformBlocks, parameters.uniformBlocks);
        }
        if (initializeBindings) this.initializeBindings();
    }

    /** Monotonic instance-data revision observed independently by each renderer. */
    get revision(): number {
        return this.#revision;
    }

    get opacity(): number {
        return this.#opacity;
    }

    set opacity(value: number) {
        if (!Number.isFinite(value) || value < 0 || value > 1) {
            throw new RangeError('Material opacity must be between zero and one');
        }
        if (this.#opacity === value) return;
        this.#opacity = value;
        this.markDataChanged();
    }

    get normalScale(): number {
        return this.#normalScale;
    }

    set normalScale(value: number) {
        if (!Number.isFinite(value) || value < 0) {
            throw new RangeError('Material normal scale must be finite and non-negative');
        }
        if (this.#normalScale === value) return;
        this.#normalScale = value;
        this.markDataChanged();
    }

    /** Whether the forward pass composites this surface with an existing color attachment. */
    get isTransparent(): boolean {
        return this.compositing.mode !== 'opaque';
    }

    /** Whether the forward shader samples the opaque scene-color copy. */
    get requiresOpaqueSceneTexture(): boolean {
        return this.definition.staticFeatures['HAS_TRANSMISSION'] === 1;
    }

    /**
     * Forward renderer queue selected from compositing and pass resource dependencies.
     *
     * An unblended transmission surface remains compositionally opaque, but it must execute after
     * the opaque scene copy exists and therefore belongs to the transparent/after-opaque queue.
     */
    get forwardQueue(): 'opaque' | 'transparent' {
        return this.isTransparent || this.requiresOpaqueSceneTexture ? 'transparent' : 'opaque';
    }

    get lightType(): string {
        const feature = this.definition.staticFeatures['LIGHT_MODEL'];
        switch (feature) {
            case 1:
                return 'LAMBERT';
            case 2:
                return 'PHONG';
            case 3:
                return 'BLINN-PHONG';
            case 4:
                return 'PBR';
            default:
                return 'NONE';
        }
    }

    /** Bind data to a slot already declared by the immutable definition. */
    setTextureSlot(name: string, value: Texture<unknown> | MaterialTextureSlotInput | null): void {
        const slot = this.definition.getTextureSlot(name);
        if (slot === null) {
            throw new TypeError(
                `Material definition ${this.definition.id} does not declare texture slot ${name}`
            );
        }
        if (value === null) {
            if (slot.presence === 'static') {
                throw new TypeError(`Static material texture slot ${name} cannot be cleared`);
            }
            if (this.#textureSlots.delete(name)) {
                this.#textureSlotByIndex[slot.index] = null;
                this.#dirtyTextureSlots.add(slot.index);
                this.markDataChanged();
            }
            return;
        }
        const input = normalizeTextureSlotInput(value);
        if (!(input.texture instanceof Texture)) {
            throw new TypeError(`Material texture slot ${name} requires a Texture`);
        }
        const uvSet = input.uvSet ?? input.texture.uv;
        if (!slot.uvSets.includes(uvSet)) {
            throw new TypeError(
                `Material definition ${this.definition.id} did not compile slot ${name} for UV set ${String(uvSet)}`
            );
        }
        const binding = Object.freeze({
            texture: input.texture,
            uvSet,
            transform: input.transform ?? null,
            encoding: input.encoding ?? slot.encoding,
            channels: input.channels ?? slot.channels
        });
        const previous = this.#textureSlots.get(name);
        if (
            previous?.texture === binding.texture &&
            previous.uvSet === binding.uvSet &&
            previous.transform === binding.transform &&
            previous.encoding === binding.encoding &&
            previous.channels === binding.channels
        ) {
            return;
        }
        this.#textureSlots.set(name, binding);
        this.#textureSlotByIndex[slot.index] = binding;
        this.#dirtyTextureSlots.add(slot.index);
        this.markDataChanged();
    }

    getTextureSlot(name: string): MaterialTextureSlotBinding | null {
        return this.#textureSlots.get(name) ?? null;
    }

    /** @internal Fixed-index lookup used by UBO packing without map iteration. */
    getTextureSlotByIndex(index: number): MaterialTextureSlotBinding | null {
        return this.#textureSlotByIndex[index] ?? null;
    }

    /** @internal Snapshot dirty slot indices for a submission-aware material database. */
    getDirtyTextureSlots(): readonly number[] {
        return Object.freeze([...this.#dirtyTextureSlots].sort((left, right) => left - right));
    }

    /** @internal Clear dirty slots only after a valid submission commits their revision. */
    commitTextureSlotRevision(revision: number): void {
        if (revision === this.#revision) this.#dirtyTextureSlots.clear();
    }

    /**
     * Advance the data revision after mutating a referenced vector, color, matrix, or custom
     * binding value. Texture-slot and built-in scalar accessors call this automatically.
     */
    invalidateData(): void {
        if (this.#revision >= Number.MAX_SAFE_INTEGER) {
            throw new RangeError('Material instance revision space is exhausted');
        }
        this.#revision++;
    }

    protected markDataChanged(): void {
        this.invalidateData();
    }

    protected initializeBindings(): void {
        if (this.#bindingsInitialized) return;
        this.#bindingsInitialized = true;
        this.addBasicAttributes();
        this.addBasicUniforms();
    }

    protected addBasicAttributes(): void {
        this.copyBindings(this.attributes, {
            a_position: MaterialAttributeSemantic.POSITION,
            a_normal: MaterialAttributeSemantic.NORMAL,
            a_tangent: MaterialAttributeSemantic.TANGENT,
            a_texcoord0: MaterialAttributeSemantic.TEXCOORD_0,
            a_texcoord1: MaterialAttributeSemantic.TEXCOORD_1,
            a_color: MaterialAttributeSemantic.COLOR_0,
            a_skinIndices: MaterialAttributeSemantic.SKIN_INDICES,
            a_skinWeights: MaterialAttributeSemantic.SKIN_WEIGHTS
        });
        for (const name of [
            MaterialAttributeSemantic.POSITION,
            MaterialAttributeSemantic.NORMAL,
            MaterialAttributeSemantic.TANGENT
        ]) {
            const camelName = name.slice(0, 1) + name.slice(1).toLowerCase();
            for (let index = 0; index < 8; index += 1) {
                this.attributes[`a_morph${camelName}${String(index)}`] ??=
                    `MORPH${name}${String(index)}` as MaterialSemanticName;
            }
        }
    }

    protected addBasicUniforms(): void {
        this.copyBindings(this.uniforms, {
            u_modelMatrix: MaterialUniformSemantic.MODEL,
            u_objectIdColor: MaterialUniformSemantic.OBJECT_ID_COLOR,
            u_viewMatrix: MaterialUniformSemantic.VIEW,
            u_projectionMatrix: MaterialUniformSemantic.PROJECTION,
            u_modelViewMatrix: MaterialUniformSemantic.MODEL_VIEW,
            u_modelViewProjectionMatrix: MaterialUniformSemantic.MODEL_VIEW_PROJECTION,
            u_viewInverseNormalMatrix: MaterialUniformSemantic.VIEW_INVERSE_NORMAL,
            u_normalMatrix: MaterialUniformSemantic.MODEL_VIEW_NORMAL,
            u_normalWorldMatrix: MaterialUniformSemantic.MODEL_NORMAL,
            u_cameraPosition: MaterialUniformSemantic.CAMERA_POSITION,
            u_rendererSize: MaterialUniformSemantic.RENDERER_SIZE,
            u_logDepth: MaterialUniformSemantic.LOG_DEPTH,
            u_ambientLightsColor: MaterialUniformSemantic.AMBIENT_LIGHTS_COLOR,
            u_directionalLightsColor: MaterialUniformSemantic.DIRECTIONAL_LIGHTS_COLOR,
            u_directionalLightsInfo: MaterialUniformSemantic.DIRECTIONAL_LIGHTS_INFO,
            u_directionalLightsShadowMap: MaterialTextureSemantic.DIRECTIONAL_LIGHTS_SHADOW_MAP,
            u_directionalLightsShadowMapSize:
                MaterialUniformSemantic.DIRECTIONAL_LIGHTS_SHADOW_MAP_SIZE,
            u_directionalLightsShadowBias: MaterialUniformSemantic.DIRECTIONAL_LIGHTS_SHADOW_BIAS,
            u_directionalLightSpaceMatrix: MaterialUniformSemantic.DIRECTIONAL_LIGHT_SPACE_MATRIX,
            u_directionalCascadeSplits: MaterialUniformSemantic.DIRECTIONAL_CASCADE_SPLITS,
            u_directionalCascadeParams: MaterialUniformSemantic.DIRECTIONAL_CASCADE_PARAMS,
            u_directionalCascadeMatrices: MaterialUniformSemantic.DIRECTIONAL_CASCADE_MATRICES,
            u_pointLightsPos: MaterialUniformSemantic.POINT_LIGHTS_POSITION,
            u_pointLightsColor: MaterialUniformSemantic.POINT_LIGHTS_COLOR,
            u_pointLightsInfo: MaterialUniformSemantic.POINT_LIGHTS_INFO,
            u_pointLightsRange: MaterialUniformSemantic.POINT_LIGHTS_RANGE,
            u_pointLightsShadowBias: MaterialUniformSemantic.POINT_LIGHTS_SHADOW_BIAS,
            u_pointLightsShadowMap: MaterialTextureSemantic.POINT_LIGHTS_SHADOW_MAP,
            u_pointLightSpaceMatrix: MaterialUniformSemantic.POINT_LIGHT_SPACE_MATRIX,
            u_pointLightCamera: MaterialUniformSemantic.POINT_LIGHT_CAMERA,
            u_shadowAtlasSize: MaterialUniformSemantic.SHADOW_ATLAS_SIZE,
            u_shadowAtlasRects: MaterialUniformSemantic.SHADOW_ATLAS_RECTS,
            u_pointShadowMatrices: MaterialUniformSemantic.POINT_SHADOW_MATRICES,
            u_spotLightsPos: MaterialUniformSemantic.SPOT_LIGHTS_POSITION,
            u_spotLightsDir: MaterialUniformSemantic.SPOT_LIGHTS_DIRECTION,
            u_spotLightsColor: MaterialUniformSemantic.SPOT_LIGHTS_COLOR,
            u_spotLightsCutoffs: MaterialUniformSemantic.SPOT_LIGHTS_CUTOFFS,
            u_spotLightsInfo: MaterialUniformSemantic.SPOT_LIGHTS_INFO,
            u_spotLightsRange: MaterialUniformSemantic.SPOT_LIGHTS_RANGE,
            u_spotLightsShadowMap: MaterialTextureSemantic.SPOT_LIGHTS_SHADOW_MAP,
            u_spotLightsShadowMapSize: MaterialUniformSemantic.SPOT_LIGHTS_SHADOW_MAP_SIZE,
            u_spotLightsShadowBias: MaterialUniformSemantic.SPOT_LIGHTS_SHADOW_BIAS,
            u_spotLightSpaceMatrix: MaterialUniformSemantic.SPOT_LIGHT_SPACE_MATRIX,
            u_areaLightsPos: MaterialUniformSemantic.AREA_LIGHTS_POSITION,
            u_areaLightsColor: MaterialUniformSemantic.AREA_LIGHTS_COLOR,
            u_areaLightsWidth: MaterialUniformSemantic.AREA_LIGHTS_WIDTH,
            u_areaLightsHeight: MaterialUniformSemantic.AREA_LIGHTS_HEIGHT,
            u_areaLightsLtcTexture1: MaterialTextureSemantic.AREA_LIGHTS_LTC_TEXTURE_1,
            u_areaLightsLtcTexture2: MaterialTextureSemantic.AREA_LIGHTS_LTC_TEXTURE_2,
            u_jointMat: MaterialUniformSemantic.JOINT_MATRIX,
            u_positionDecodeMat: MaterialUniformSemantic.POSITION_DECODE_MATRIX,
            u_normalDecodeMat: MaterialUniformSemantic.NORMAL_DECODE_MATRIX,
            u_uvDecodeMat: MaterialUniformSemantic.UV_DECODE_MATRIX,
            u_uv1DecodeMat: MaterialUniformSemantic.UV1_DECODE_MATRIX,
            u_morphWeights: MaterialUniformSemantic.MORPH_WEIGHTS,
            u_normalMapScale: MaterialUniformSemantic.NORMAL_MAP_SCALE,
            u_emissionColor: MaterialUniformSemantic.EMISSION_COLOR,
            u_transparencyFactor: MaterialUniformSemantic.OPACITY,
            u_fogColor: MaterialUniformSemantic.FOG_COLOR,
            u_fogInfo: MaterialUniformSemantic.FOG_INFO,
            u_alphaCutoff: MaterialUniformSemantic.ALPHA_CUTOFF,
            u_materialTextureTransforms: MaterialUniformSemantic.MATERIAL_TEXTURE_TRANSFORMS,
            u_materialTextureInfo: MaterialUniformSemantic.MATERIAL_TEXTURE_INFO,
            u_materialTextureChannels: MaterialUniformSemantic.MATERIAL_TEXTURE_CHANNELS
        });
        this.addTextureUniforms({
            u_normalMap: MaterialTextureSemantic.NORMAL_MAP,
            u_parallaxMap: MaterialTextureSemantic.PARALLAX_MAP,
            u_transparency: MaterialTextureSemantic.OPACITY
        });
        this.uniforms['u_shadowAtlas'] ??= MaterialTextureSemantic.SHADOW_ATLAS;
    }

    protected addTextureUniforms(
        textureUniforms: Readonly<Record<string, MaterialTextureSemanticName>>
    ): void {
        const uniforms: MaterialBindingMap = {};
        for (const [uniformName, semanticName] of Object.entries(textureUniforms)) {
            uniforms[uniformName] = semanticName;
            uniforms[`${uniformName}.texture`] = semanticName;
            uniforms[`${uniformName}.uv`] = `${semanticName}UV` as MaterialSemanticName;
        }
        this.copyBindings(this.uniforms, uniforms);
    }

    getRenderOption(option: ShaderOptions = {}): ShaderOptions {
        for (const [name, value] of Object.entries(this.definition.staticFeatures)) {
            if (name === 'LIGHT_MODEL') continue;
            option[name] = value;
        }
        switch (this.lightType) {
            case 'LAMBERT':
                option['LIGHT_TYPE_LAMBERT'] = 1;
                break;
            case 'PHONG':
                option['LIGHT_TYPE_PHONG'] = 1;
                break;
            case 'BLINN-PHONG':
                option['LIGHT_TYPE_BLINN_PHONG'] = 1;
                break;
            case 'PBR':
                option['LIGHT_TYPE_PBR'] = 1;
                break;
            default:
                option['LIGHT_TYPE_NONE'] = 1;
                break;
        }
        if (this.lightType !== 'NONE') option['HAS_LIGHT'] = 1;
        const forwardState = this.definition.getPass('forward')?.state;
        if (forwardState?.cullMode === 'none') option['DOUBLE_SIDED'] = 1;
        else if (forwardState?.cullMode === 'front') option['BACK_FACING'] = 1;
        if (this.compositing.mode === 'alpha-blend' && this.compositing.premultiplied) {
            option['PREMULTIPLY_ALPHA'] = 1;
        }
        if (this.coverage.mode !== 'opaque') option['ALPHA_CUTOFF'] = 1;
        for (const slot of this.definition.textureSlots) {
            for (const uvSet of slot.uvSets) option[`HAS_TEXCOORD${String(uvSet)}`] = 1;
        }
        return option;
    }

    getInstancedUniforms(): readonly InstancedUniform[] {
        if (this.#instancedUniforms === null) {
            const values: InstancedUniform[] = [];
            for (const name in this.uniforms) {
                const info = this.getUniformInfo(name);
                if (info.isDependMesh && !info.notSupportInstanced) values.push({ name, info });
            }
            this.#instancedUniforms = values;
        }
        return this.#instancedUniforms;
    }

    getUniformData(name: string, mesh: Mesh, programInfo: ProgramBindingInfo): unknown {
        return this.getUniformInfo(name).get(mesh, this, programInfo);
    }

    getAttributeData(name: string, mesh: Mesh, programInfo: ProgramBindingInfo): unknown {
        return this.getAttributeInfo(name).get(mesh, this, programInfo);
    }

    getUniformInfo(name: string): MaterialBindingInfo {
        return this.getInfo('uniforms', name);
    }

    getAttributeInfo(name: string): MaterialBindingInfo {
        return this.getInfo('attributes', name);
    }

    getTextures(): readonly MaterialTexture[] {
        const textures = new Set<MaterialTexture>();
        for (const binding of this.#textureSlots.values()) textures.add(binding.texture);
        for (const value of Object.values(this)) {
            if (isMaterialTexture(value)) textures.add(value);
        }
        return Object.freeze([...textures]);
    }

    destroyTextures(): void {
        for (const texture of this.getTextures()) texture.destroy();
    }

    protected copyBindings(origin: MaterialBindingMap, data: Readonly<MaterialBindingMap>): void {
        for (const [key, value] of Object.entries(data)) origin[key] ??= value;
        this.#instancedUniforms = null;
    }

    private getInfo(dataType: 'uniforms' | 'attributes', name: string): MaterialBindingInfo {
        let info = this[dataType][name];
        if (typeof info === 'string') {
            const semanticInfo: unknown = Reflect.get(semantic, info);
            if (!isBindingInfo(semanticInfo)) {
                throw new Error(
                    `Material ${dataType} binding ${name} references unknown semantic ${info}`
                );
            }
            info =
                semanticInfo.get.length === 0
                    ? resolveSemanticBinding(info, semanticInfo)
                    : semanticInfo;
        }
        if (!isBindingInfo(info)) {
            throw new Error(`Material instance has no ${dataType} binding named ${name}`);
        }
        return info;
    }
}

/** @internal Shared identity transform for absent slot transforms. */
export const MATERIAL_TEXTURE_IDENTITY = new Matrix3();
export const MATERIAL_TEXTURE_DEFAULT_CHANNELS = DEFAULT_MATERIAL_TEXTURE_CHANNELS;

export default MaterialInstance;
