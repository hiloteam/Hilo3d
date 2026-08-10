import type MaterialInstance from './MaterialInstance';
import type {
    MaterialBlendState,
    MaterialFragmentOutput,
    MaterialPassDefinition,
    MaterialPassRole,
    MaterialPipelineState,
    MaterialRenderingProfile,
    MaterialShaderModule
} from './MaterialDefinition';
import type { RendererBackend } from '../render/RendererCore';
import { CollisionSafeVariantKeyRegistry } from '../shader/VariantHash';

export interface MaterialTargetSignature {
    readonly colorFormats: readonly (string | null)[];
    readonly depthStencilFormat: string | null;
    readonly sampleCount: number;
}

export interface MaterialCompileRequest {
    readonly instance: MaterialInstance;
    readonly role: MaterialPassRole;
    readonly target: Readonly<MaterialTargetSignature>;
    readonly vertexLayoutClass: string;
    readonly renderingProfile: MaterialRenderingProfile;
    readonly backend: RendererBackend;
}

export interface PreparedMaterialVariant {
    readonly definitionId: string;
    readonly materialId: number;
    readonly role: MaterialPassRole;
    readonly shader: MaterialShaderModule;
    readonly fragmentOutput: MaterialFragmentOutput;
    readonly state: Readonly<MaterialPipelineState>;
    readonly key: string;
}

const variantKeys = new CollisionSafeVariantKeyRegistry();

const PREMULTIPLIED_ALPHA_BLEND: Readonly<MaterialBlendState> = Object.freeze({
    color: Object.freeze({
        operation: 'add',
        srcFactor: 'one',
        dstFactor: 'one-minus-src-alpha'
    }),
    alpha: Object.freeze({
        operation: 'add',
        srcFactor: 'one',
        dstFactor: 'one-minus-src-alpha'
    })
});

const STRAIGHT_ALPHA_BLEND: Readonly<MaterialBlendState> = Object.freeze({
    color: Object.freeze({
        operation: 'add',
        srcFactor: 'src-alpha',
        dstFactor: 'one-minus-src-alpha'
    }),
    alpha: Object.freeze({
        operation: 'add',
        srcFactor: 'one',
        dstFactor: 'one-minus-src-alpha'
    })
});

const PREMULTIPLIED_ADDITIVE_BLEND: Readonly<MaterialBlendState> = Object.freeze({
    color: Object.freeze({ operation: 'add', srcFactor: 'one', dstFactor: 'one' }),
    alpha: Object.freeze({ operation: 'add', srcFactor: 'one', dstFactor: 'one' })
});

const STRAIGHT_ALPHA_ADDITIVE_BLEND: Readonly<MaterialBlendState> = Object.freeze({
    color: Object.freeze({ operation: 'add', srcFactor: 'src-alpha', dstFactor: 'one' }),
    alpha: Object.freeze({ operation: 'add', srcFactor: 'one', dstFactor: 'one' })
});

/** Canonical immutable blend equations shared by materials and low-level render passes. */
export const MaterialBlendPreset = Object.freeze({
    PREMULTIPLIED_ALPHA: PREMULTIPLIED_ALPHA_BLEND,
    STRAIGHT_ALPHA: STRAIGHT_ALPHA_BLEND,
    PREMULTIPLIED_ADDITIVE: PREMULTIPLIED_ADDITIVE_BLEND,
    STRAIGHT_ALPHA_ADDITIVE: STRAIGHT_ALPHA_ADDITIVE_BLEND
});

function resolveForwardState(
    instance: MaterialInstance,
    pass: Readonly<MaterialPassDefinition>
): Readonly<MaterialPipelineState> {
    const state = pass.state;
    switch (instance.compositing.mode) {
        case 'opaque':
            return state;
        case 'alpha-blend':
            return Object.freeze({
                ...state,
                depthWrite: false,
                blend: instance.compositing.premultiplied
                    ? PREMULTIPLIED_ALPHA_BLEND
                    : STRAIGHT_ALPHA_BLEND
            });
        case 'additive':
            return Object.freeze({
                ...state,
                depthWrite: false,
                blend: instance.compositing.premultiplied
                    ? PREMULTIPLIED_ADDITIVE_BLEND
                    : STRAIGHT_ALPHA_ADDITIVE_BLEND
            });
        case 'custom':
            return Object.freeze({
                ...state,
                depthWrite: instance.compositing.depthWrite,
                blend: instance.compositing.blend
            });
    }
}

/** Resolve the backend-neutral state for a material role before RHI descriptor mapping. */
export function resolveMaterialPassState(
    instance: MaterialInstance,
    role: MaterialPassRole
): Readonly<MaterialPipelineState> | null {
    const pass = resolveMaterialPassDefinition(instance, role);
    if (pass === null) return null;
    return role === 'forward' ? resolveForwardState(instance, pass) : pass.state;
}

/** Resolve a declared semantic pass or an explicitly safe depth/shadow fallback. */
export function resolveMaterialPassDefinition(
    instance: MaterialInstance,
    role: MaterialPassRole
): MaterialPassDefinition | null {
    const direct = instance.definition.getPass(role);
    if (direct !== null) return direct;
    const forward = instance.definition.getPass('forward');
    if (forward?.fallback !== 'safe-fallback') return null;
    if (role !== 'depth-only' && role !== 'shadow-caster') return null;
    const unblendedState: Readonly<MaterialPipelineState> = Object.freeze({
        wireframe: forward.state.wireframe,
        frontFace: forward.state.frontFace,
        cullMode: forward.state.cullMode,
        depthTest: forward.state.depthTest,
        depthWrite: forward.state.depthWrite,
        depthCompare: forward.state.depthCompare,
        depthRange: forward.state.depthRange,
        ...(forward.state.stencil === undefined ? {} : { stencil: forward.state.stencil }),
        alphaToCoverage: forward.state.alphaToCoverage
    });
    return Object.freeze({
        role,
        shader: forward.shader,
        fragmentOutput: 'depth-only',
        state: Object.freeze({
            ...unblendedState,
            depthTest: true,
            depthWrite: true,
            alphaToCoverage: false
        }),
        fallback: 'safe-fallback'
    });
}

function targetKey(target: Readonly<MaterialTargetSignature>): string {
    return `${target.colorFormats.map(format => format ?? '~').join(',')}|${target.depthStencilFormat ?? '~'}|${String(target.sampleCount)}`;
}

/** Compiles immutable definition structure and one semantic role into a stable draw variant. */
export class MaterialCompiler {
    compile(request: Readonly<MaterialCompileRequest>): PreparedMaterialVariant | null {
        const { instance, role } = request;
        if (!instance.definition.profiles.includes(request.renderingProfile)) {
            throw new TypeError(
                `Material definition ${instance.definition.id} does not support ${request.renderingProfile}`
            );
        }
        const pass = resolveMaterialPassDefinition(instance, role);
        if (pass === null) {
            const declared = instance.definition.passes.find(candidate => candidate.role === role);
            if (declared?.fallback === 'skip') return null;
            throw new TypeError(
                `Material definition ${instance.definition.id} cannot compile required role ${role}`
            );
        }
        if (pass.fragmentOutput === 'depth-only' && request.target.colorFormats.length !== 0) {
            throw new TypeError(`Material role ${role} requires a depth-only target`);
        }
        if (pass.fragmentOutput !== 'depth-only' && request.target.colorFormats.length === 0) {
            throw new TypeError(`Material role ${role} requires at least one color target`);
        }
        if (
            pass.fragmentOutput === 'motion-vector' &&
            (request.target.colorFormats.length !== 1 ||
                request.target.colorFormats[0] !== 'rgba16float' ||
                request.target.sampleCount !== 1)
        ) {
            throw new TypeError(
                'Material motion-vector role requires one single-sample rgba16float color target'
            );
        }
        const state = role === 'forward' ? resolveForwardState(instance, pass) : pass.state;
        const sourceRevision =
            pass.shader.kind === 'glsl'
                ? pass.shader.sourceRevision
                : instance.definition.shaderRevision;
        const key = variantKeys.resolve('m', [
            instance.definition.id,
            role,
            request.vertexLayoutClass,
            targetKey(request.target),
            request.renderingProfile,
            request.backend,
            sourceRevision,
            instance.compositing.mode,
            instance.compositing.mode === 'alpha-blend' ? instance.compositing.premultiplied : false
        ]);
        return Object.freeze({
            definitionId: instance.definition.id,
            materialId: instance.materialId,
            role,
            shader: pass.shader,
            fragmentOutput: pass.fragmentOutput,
            state,
            key
        });
    }
}

export default MaterialCompiler;
