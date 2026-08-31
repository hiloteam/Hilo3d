import type { Bounds } from 'hilo3d';
import type ParticleCurve from './ParticleCurve.js';
import type ParticleEmitterDefinition from './ParticleEmitterDefinition.js';
import type ParticleGradient from './ParticleGradient.js';
import type { ParticleStatelessModuleMetadata } from './ParticleStateless.js';
import type ParticleSystemDefinition from './ParticleSystemDefinition.js';

/** Typed particle attributes allocated only when a module or renderer consumes them. */
export type ParticleAttributeName =
    | 'stable-id'
    | 'generation'
    | 'alive'
    | 'age'
    | 'lifetime'
    | 'normalized-age'
    | 'position'
    | 'previous-position'
    | 'spawn-position'
    | 'velocity'
    | 'size'
    | 'base-size'
    | 'rotation'
    | 'base-rotation'
    | 'color'
    | 'base-color'
    | 'sprite-frame'
    | 'mass'
    | 'noise-offset'
    | 'collision-state'
    | 'mesh-index'
    | 'ribbon-id'
    | `custom:${string}`;

export interface ParticleAttributeLayout {
    readonly name: ParticleAttributeName;
    readonly storage: 'f32' | 'u32';
    readonly components: 1 | 2 | 3 | 4;
    /** Sixteen-byte-aligned byte offset in the generated WebGPU SoA storage buffer. */
    readonly byteOffset: number;
    readonly byteLength: number;
}

/** Baked scalar curve table retained by a compiled emitter. */
export interface ParticleCurveLUT {
    readonly curve: ParticleCurve;
    readonly values: Float32Array;
}

/** Baked linear-RGBA gradient table retained by a compiled emitter. */
export interface ParticleGradientLUT {
    readonly gradient: ParticleGradient;
    readonly values: Float32Array;
}

/** Backend-neutral compiled emitter plan. Shader/native objects remain renderer-internal. */
export interface ParticleCompiledEmitterPlan {
    readonly definition: ParticleEmitterDefinition;
    readonly emitterId: number;
    readonly kind: 'cpu-stateful' | 'gpu-stateful' | 'stateless';
    readonly attributes: readonly Readonly<ParticleAttributeLayout>[];
    readonly attributeByteLength: number;
    readonly layoutHash: string;
    readonly curveLUTs: readonly Readonly<ParticleCurveLUT>[];
    readonly gradientLUTs: readonly Readonly<ParticleGradientLUT>[];
    readonly bounds: Readonly<Bounds>;
    readonly statelessEligible: boolean;
    readonly statelessDiagnostics: readonly string[];
    /** Per-module reconstruction contract consumed by diagnostics and stateless generators. */
    readonly statelessModules: readonly Readonly<ParticleStatelessModuleMetadata>[];
    /** Cross-frame particle-state bytes. Stateless renderer input is intentionally excluded. */
    readonly persistentStateByteLength: number;
}

/** Immutable compilation result cached by definition hash and execution environment. */
export interface ParticleCompiledPlan {
    readonly definition: ParticleSystemDefinition;
    readonly hash: string;
    readonly emitters: readonly Readonly<ParticleCompiledEmitterPlan>[];
}
