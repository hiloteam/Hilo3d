import type Texture from '../texture/Texture';
import type ParticleCurve from './ParticleCurve';
import type ParticleGradient from './ParticleGradient';

/** Current serialized particle-definition schema version. */
export const PARTICLE_DEFINITION_VERSION = 1 as const;

/** Two-component serializable particle value. */
export type ParticleVector2 = readonly [number, number];

/** Three-component serializable particle value. */
export type ParticleVector3 = readonly [number, number, number];

/** Four-component serializable particle value. */
export type ParticleVector4 = readonly [number, number, number, number];

/** Linear RGBA particle color. */
export type ParticleColor = ParticleVector4;

/** Constant or deterministic random range evaluated from a particle counter key. */
export type ParticleRange<T> = Readonly<{ min: T; max: T }>;

/** Scalar authoring value accepted by fixed particle modules. */
export type ParticleScalarValue = number | ParticleRange<number>;

/** Vector authoring value accepted by fixed particle modules. */
export type ParticleVector3Value = ParticleVector3 | ParticleRange<ParticleVector3>;

/** Color authoring value accepted by fixed particle modules. */
export type ParticleColorValue = ParticleColor | ParticleRange<ParticleColor>;

/** Requested emitter execution policy. `auto` remains portable and capability driven. */
export type ParticleExecutionMode = 'auto' | 'cpu' | 'gpu' | 'stateless';

/** Simulation coordinate system. */
export type ParticleSimulationSpace = 'local' | 'world';

/** Reaction used when an emitter is culled by a renderer. */
export type ParticleCullingReaction = 'render-only' | 'pause' | 'pause-and-catch-up' | 'stop';

/** Capacity overflow behavior. */
export type ParticleOverflowPolicy = 'drop-new' | 'replace-oldest';

/** Manual local-space bounds. */
export interface ParticleManualBounds {
    readonly mode: 'manual';
    readonly min: ParticleVector3;
    readonly max: ParticleVector3;
}

/** Compiler-derived conservative bounds. */
export interface ParticleAutomaticBounds {
    readonly mode: 'automatic';
}

/** Exact CPU bounds recomputed from the dense alive range. */
export interface ParticleDynamicBounds {
    readonly mode: 'dynamic';
}

/** Public emitter bounds policy. */
export type ParticleBoundsDefinition =
    ParticleManualBounds | ParticleAutomaticBounds | ParticleDynamicBounds;

/** One deterministic time-based burst. */
export interface ParticleBurstDefinition {
    readonly time: number;
    readonly count: number;
    readonly cycles?: number;
    readonly interval?: number;
}

/** Fixed emission sources evaluated before initialize modules. */
export interface ParticleEmissionDefinition {
    readonly rateOverTime?: ParticleScalarValue;
    readonly rateOverDistance?: ParticleScalarValue;
    readonly bursts?: readonly ParticleBurstDefinition[];
}

/** Common distribution controls shared by analytic particle shapes. */
export interface ParticleShapeBase {
    readonly distribution?: 'surface' | 'volume';
    readonly arc?: number;
    readonly thickness?: number;
}

/** Point emitter shape. */
export interface ParticlePointShape extends ParticleShapeBase {
    readonly type: 'point';
}

/** Line-segment or edge emitter shape. */
export interface ParticleLineShape extends ParticleShapeBase {
    readonly type: 'line' | 'edge';
    readonly start: ParticleVector3;
    readonly end: ParticleVector3;
}

/** Axis-aligned box emitter shape. */
export interface ParticleBoxShape extends ParticleShapeBase {
    readonly type: 'box';
    readonly size: ParticleVector3;
}

/** Circle or filled-disc emitter shape. */
export interface ParticleCircleShape extends ParticleShapeBase {
    readonly type: 'circle' | 'disc';
    readonly radius: number;
}

/** Sphere or hemisphere emitter shape. */
export interface ParticleSphereShape extends ParticleShapeBase {
    readonly type: 'sphere' | 'hemisphere';
    readonly radius: number;
}

/** Cone emitter shape with a degree-based half-angle. */
export interface ParticleConeShape extends ParticleShapeBase {
    readonly type: 'cone';
    readonly radius: number;
    /** Cone half-angle in degrees. */
    readonly angle: number;
    readonly length?: number;
}

/** Torus or donut emitter shape. */
export interface ParticleTorusShape extends ParticleShapeBase {
    readonly type: 'torus' | 'donut';
    readonly radius: number;
    readonly tubeRadius: number;
}

/** Analytic shape sampled without allocating per-particle objects. */
export type ParticleShapeDefinition =
    | ParticlePointShape
    | ParticleLineShape
    | ParticleBoxShape
    | ParticleCircleShape
    | ParticleSphereShape
    | ParticleConeShape
    | ParticleTorusShape;

/** Initial attributes evaluated once for every spawn. */
export interface ParticleInitializeDefinition {
    readonly lifetime?: ParticleScalarValue;
    readonly position?: ParticleVector3Value;
    readonly direction?: ParticleVector3Value;
    readonly speed?: ParticleScalarValue;
    readonly color?: ParticleColorValue;
    readonly size?: ParticleScalarValue;
    /** Rotation in radians. */
    readonly rotation?: ParticleScalarValue;
    readonly mass?: ParticleScalarValue;
}

/** Constant velocity added before integration. */
export interface ParticleVelocityModule {
    readonly type: 'velocity-over-lifetime';
    readonly velocity: ParticleVector3Value;
    readonly space?: ParticleSimulationSpace;
}

/** Acceleration or force applied every fixed step. */
export interface ParticleForceModule {
    readonly type: 'force-over-lifetime' | 'gravity' | 'wind';
    readonly force: ParticleVector3Value;
    readonly space?: ParticleSimulationSpace;
}

/** Exponential velocity damping. */
export interface ParticleDragModule {
    readonly type: 'drag';
    readonly coefficient: number;
}

/** Clamp particle speed and optionally damp the removed component. */
export interface ParticleLimitVelocityModule {
    readonly type: 'limit-velocity';
    readonly limit: ParticleScalarValue;
    readonly dampen?: number;
}

/** Add the emitter velocity observed at spawn. */
export interface ParticleInheritVelocityModule {
    readonly type: 'inherit-emitter-velocity';
    readonly multiplier?: number;
}

/** Deterministic lattice noise shared by CPU and generated WebGPU kernels. */
export interface ParticleNoiseModule {
    readonly type: 'noise';
    readonly mode: 'position-offset' | 'force';
    readonly field: 'vector' | 'curl';
    readonly strength: ParticleVector3Value;
    readonly frequency: number;
    readonly octaves: 1 | 2 | 3 | 4;
    readonly lacunarity?: number;
    readonly persistence?: number;
    readonly scrollVelocity?: ParticleVector3;
    readonly damping?: number;
    readonly space?: ParticleSimulationSpace;
    readonly seedOffset?: number;
}

/** Scalar curve applied over normalized lifetime. */
export interface ParticleScalarOverLifetimeModule {
    readonly type:
        | 'alpha-over-lifetime'
        | 'size-over-lifetime'
        | 'rotation-over-lifetime'
        | 'frame-over-lifetime';
    readonly curve: ParticleCurve;
    readonly cycles?: number;
}

/** Gradient applied over normalized lifetime. */
export interface ParticleColorOverLifetimeModule {
    readonly type: 'color-over-lifetime';
    readonly gradient: ParticleGradient;
}

/** Scalar speed-driven attribute modifier. */
export interface ParticleScalarBySpeedModule {
    readonly type: 'size-by-speed' | 'rotation-by-speed';
    readonly speedRange: readonly [number, number];
    readonly curve: ParticleCurve;
}

/** Gradient speed-driven color modifier. */
export interface ParticleColorBySpeedModule {
    readonly type: 'color-by-speed';
    readonly speedRange: readonly [number, number];
    readonly gradient: ParticleGradient;
}

/** First portable speed-driven attribute modifiers. */
export type ParticleBySpeedModule = ParticleScalarBySpeedModule | ParticleColorBySpeedModule;

/** Texture-sheet frame selection. */
export interface ParticleTextureSheetModule {
    readonly type: 'texture-sheet';
    readonly mode: 'lifetime' | 'speed' | 'fps';
    readonly rows: number;
    readonly columns: number;
    readonly cycles?: number;
    readonly fps?: number;
    readonly speedRange?: readonly [number, number];
}

/** Advanced P2 force families. */
export interface ParticleRadialForceModule {
    readonly type: 'radial-force' | 'orbital-force' | 'vortex-force';
    readonly center?: ParticleVector3;
    readonly strength: ParticleScalarValue;
    readonly axis?: ParticleVector3;
}

/** Point or closest-point-on-line attraction force. */
export interface ParticleAttractionModule {
    readonly type: 'point-attraction' | 'line-attraction';
    readonly point?: ParticleVector3;
    readonly lineStart?: ParticleVector3;
    readonly lineEnd?: ParticleVector3;
    readonly strength: ParticleScalarValue;
}

/** Tangential motion around an authored point and axis. */
export interface ParticleRotateAroundPointModule {
    readonly type: 'rotate-around-point';
    readonly center?: ParticleVector3;
    readonly axis?: ParticleVector3;
    readonly angularSpeed: ParticleScalarValue;
}

/** Force particles toward an analytic sphere surface. */
export interface ParticleConformSphereModule {
    readonly type: 'conform-sphere';
    readonly center?: ParticleVector3;
    readonly radius: number;
    readonly strength: number;
}

/** Remap initial lifetime from the emitter's spawn-time speed. */
export interface ParticleLifetimeByEmitterSpeedModule {
    readonly type: 'lifetime-by-emitter-speed';
    readonly speedRange: readonly [number, number];
    readonly lifetimeRange: readonly [number, number];
}

/** Kill particles outside an allowed speed or distance range. */
export interface ParticleKillModule {
    readonly type: 'kill-speed' | 'kill-distance';
    readonly range: readonly [number, number];
}

/** Kill particles inside or outside an analytic volume. */
export interface ParticleKillVolumeModule {
    readonly type: 'kill-plane' | 'kill-box' | 'kill-sphere';
    readonly center?: ParticleVector3;
    readonly size?: ParticleVector3;
    readonly radius?: number;
    readonly normal?: ParticleVector3;
    readonly offset?: number;
    readonly mode?: 'inside' | 'outside';
}

/** Per-view camera offset, fade, or screen-space size modifier. */
export interface ParticleCameraModule {
    readonly type: 'camera-offset' | 'camera-fade' | 'screen-space-size';
    readonly range?: readonly [number, number];
    readonly scale?: number;
}

/** Typed fixed value allocated as a custom particle attribute. */
export interface ParticleCustomChannelModule {
    readonly type: 'custom-channel';
    readonly name: string;
    readonly valueType: 'float' | 'vec2' | 'vec3' | 'vec4' | 'color';
    readonly value: number | ParticleVector2 | ParticleVector3 | ParticleVector4;
}

/** Texture-driven vector field force. */
export interface ParticleVectorFieldModule {
    readonly type: 'vector-field';
    readonly texture: Texture<unknown>;
    readonly strength: number;
}

/** Closed fixed-module union. Arbitrary code and per-particle callbacks are intentionally absent. */
export type ParticleModule =
    | ParticleVelocityModule
    | ParticleForceModule
    | ParticleDragModule
    | ParticleLimitVelocityModule
    | ParticleInheritVelocityModule
    | ParticleNoiseModule
    | ParticleScalarOverLifetimeModule
    | ParticleColorOverLifetimeModule
    | ParticleBySpeedModule
    | ParticleTextureSheetModule
    | ParticleRadialForceModule
    | ParticleAttractionModule
    | ParticleRotateAroundPointModule
    | ParticleConformSphereModule
    | ParticleLifetimeByEmitterSpeedModule
    | ParticleKillModule
    | ParticleKillVolumeModule
    | ParticleCameraModule
    | ParticleCustomChannelModule
    | ParticleVectorFieldModule;

/** Sprite-facing mode evaluated per camera by the portable particle shader. */
export type ParticleSpriteAlignment = 'view' | 'world-up' | 'stretched' | 'velocity';

/** Particle-level sort mode. */
export type ParticleSortMode = 'none' | 'distance' | 'youngest' | 'oldest';

/** Portable sprite output consumed by CPU and WebGPU plans. */
export interface ParticleSpriteRendererDefinition {
    readonly type: 'sprite';
    readonly texture?: Texture<unknown> | null;
    readonly alignment?: ParticleSpriteAlignment;
    readonly blend?: 'alpha' | 'premultiplied-alpha' | 'additive';
    readonly depthTest?: boolean;
    readonly depthWrite?: boolean;
    readonly sort?: ParticleSortMode;
    readonly renderOrder?: number;
    readonly pivot?: ParticleVector2;
    readonly stretchScale?: number;
}

/** Renderer definitions remain separate from simulation modules. */
export type ParticleRendererDefinition = ParticleSpriteRendererDefinition;

/** Immutable emitter authoring input. */
export interface ParticleEmitterDefinitionInput {
    readonly name: string;
    readonly capacity: number;
    readonly execution?: ParticleExecutionMode;
    readonly duration?: number;
    readonly looping?: boolean;
    readonly startDelay?: number;
    readonly prewarm?: boolean;
    readonly fixedStep?: number;
    readonly maxCatchUpSteps?: number;
    readonly simulationSpace?: ParticleSimulationSpace;
    readonly overflow?: ParticleOverflowPolicy;
    readonly culling?: ParticleCullingReaction;
    readonly bounds?: ParticleBoundsDefinition;
    readonly emission?: ParticleEmissionDefinition;
    readonly shape?: ParticleShapeDefinition;
    readonly initialize?: ParticleInitializeDefinition;
    readonly modules?: readonly ParticleModule[];
    readonly renderers: readonly ParticleRendererDefinition[];
}

/** Versioned immutable particle-system authoring input. */
export interface ParticleSystemDefinitionInput {
    readonly version?: typeof PARTICLE_DEFINITION_VERSION;
    readonly emitters: readonly ParticleEmitterDefinitionInput[];
}
