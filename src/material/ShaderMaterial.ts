import MaterialInstance, {
    type MaterialBindingMap,
    type MaterialInstanceParameters
} from './MaterialInstance';
import {
    DEFAULT_MATERIAL_PIPELINE_STATE,
    MaterialDefinition,
    type MaterialCullMode,
    type MaterialFragmentOutput,
    type MaterialFrontFace,
    type MaterialPassFallback,
    type MaterialPassDefinition,
    type MaterialPassRole,
    type MaterialPipelineState,
    type MaterialTextureSlotDefinition,
    type MaterialTextureSlotInput
} from './MaterialDefinition';
import { hashVariantValues } from '../shader/VariantHash';

export interface ShaderMaterialRoleSource {
    readonly role: MaterialPassRole;
    readonly vertexSource: string;
    readonly fragmentSource: string;
    readonly fragmentOutput: MaterialFragmentOutput;
    readonly fallback?: MaterialPassFallback;
}

export interface ShaderMaterialTextureSlot {
    readonly definition: Readonly<MaterialTextureSlotDefinition>;
    readonly binding: MaterialTextureSlotInput;
}

export interface ShaderMaterialParameters extends MaterialInstanceParameters {
    readonly vs: string;
    readonly fs: string;
    readonly sourceRevision?: string;
    readonly defines?: Readonly<Record<string, number>>;
    readonly roles?: readonly Readonly<ShaderMaterialRoleSource>[];
    readonly textureSlots?: readonly Readonly<ShaderMaterialTextureSlot>[];
    readonly attributes?: Readonly<MaterialBindingMap>;
    readonly uniforms?: Readonly<MaterialBindingMap>;
    readonly frontFace?: MaterialFrontFace;
    readonly cullMode?: MaterialCullMode;
    readonly state?: Partial<Readonly<MaterialPipelineState>>;
}

function createDefinition(parameters: Readonly<ShaderMaterialParameters>): MaterialDefinition {
    if (parameters.vs.length === 0 || parameters.fs.length === 0) {
        throw new TypeError(
            'ShaderMaterial requires explicit GLSL ES 3.00 vertex and fragment source'
        );
    }
    const sourceRevision =
        parameters.sourceRevision ?? hashVariantValues([parameters.vs, parameters.fs]);
    const state = Object.freeze({
        ...DEFAULT_MATERIAL_PIPELINE_STATE,
        ...parameters.state,
        frontFace:
            parameters.frontFace ??
            parameters.state?.frontFace ??
            DEFAULT_MATERIAL_PIPELINE_STATE.frontFace,
        cullMode:
            parameters.cullMode ??
            parameters.state?.cullMode ??
            DEFAULT_MATERIAL_PIPELINE_STATE.cullMode
    });
    const roleSources = [
        {
            role: 'forward' as const,
            vertexSource: parameters.vs,
            fragmentSource: parameters.fs,
            fragmentOutput: 'color' as const,
            fallback: 'required' as const
        },
        ...(parameters.roles ?? [])
    ];
    const seenRoles = new Set<MaterialPassRole>();
    const passes: readonly Readonly<MaterialPassDefinition>[] = roleSources.map(source => {
        if (seenRoles.has(source.role)) {
            throw new TypeError(`ShaderMaterial declares duplicate role ${source.role}`);
        }
        seenRoles.add(source.role);
        return {
            role: source.role,
            shader: {
                kind: 'glsl' as const,
                vertexSource: source.vertexSource,
                fragmentSource: source.fragmentSource,
                sourceRevision: `${sourceRevision}:${source.role}`
            },
            fragmentOutput: source.fragmentOutput,
            state:
                source.fragmentOutput === 'depth-only'
                    ? Object.freeze({
                          wireframe: state.wireframe,
                          frontFace: state.frontFace,
                          cullMode: state.cullMode,
                          depthTest: true,
                          depthWrite: true,
                          depthCompare: state.depthCompare,
                          depthRange: state.depthRange,
                          ...(state.stencil === undefined ? {} : { stencil: state.stencil }),
                          alphaToCoverage: false
                      })
                    : state,
            fallback: source.fallback ?? 'required'
        };
    });
    const id = `custom:${hashVariantValues([
        sourceRevision,
        ...Object.entries(parameters.defines ?? {}).flatMap(([name, value]) => [name, value]),
        ...roleSources.flatMap(source => [
            source.role,
            source.vertexSource,
            source.fragmentSource,
            source.fragmentOutput
        ])
    ])}`;
    const staticFeatures = Object.fromEntries(
        Object.entries(parameters.defines ?? {}).map(([name, value]) => [
            `HILO_CUSTOM_OPTION_${name}`,
            value
        ])
    );
    return new MaterialDefinition({
        id,
        family: 'custom',
        shaderRevision: sourceRevision,
        ...(parameters.defines === undefined ? {} : { staticFeatures }),
        ...(parameters.coverage === undefined ? {} : { coverage: parameters.coverage }),
        ...(parameters.compositing === undefined ? {} : { compositing: parameters.compositing }),
        ...(parameters.textureSlots === undefined
            ? {}
            : { textureSlots: parameters.textureSlots.map(slot => slot.definition) }),
        passes
    });
}

/** Typed GLSL material whose source, roles and layout are immutable after construction. */
class ShaderMaterial extends MaterialInstance {
    readonly isShaderMaterial = true;
    override readonly className: string = 'ShaderMaterial';

    constructor(params: Readonly<ShaderMaterialParameters>) {
        super(createDefinition(params), params, false);
        this.initializeBindings();
        Object.assign(this.attributes, params.attributes);
        Object.assign(this.uniforms, params.uniforms);
        for (const slot of params.textureSlots ?? []) {
            this.setTextureSlot(slot.definition.name, slot.binding);
        }
    }
}

export default ShaderMaterial;
