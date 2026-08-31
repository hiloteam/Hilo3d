import type { Geometry, Texture } from 'hilo3d';
import type ParticleCurve from './ParticleCurve.js';
import type ParticleGradient from './ParticleGradient.js';
import type { ParticleParameter } from './ParticleParameter.js';

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

/** Runtime-bindable scalar source used only where plan topology remains unchanged. */
export type ParticleScalarSource = ParticleScalarValue | ParticleParameter<number>;

/** Runtime-bindable vector source used only by spawn-time data evaluated on the CPU. */
export type ParticleVector3Source = ParticleVector3Value | ParticleParameter<ParticleVector3>;

/** Runtime-bindable color source used only by spawn-time data evaluated on the CPU. */
export type ParticleColorSource = ParticleColorValue | ParticleParameter<ParticleColor>;

/** Requested emitter execution policy. `auto` remains portable and capability driven. */
export type ParticleExecutionMode = 'auto' | 'cpu' | 'gpu' | 'stateless';

/** Simulation coordinate system. */
export type ParticleSimulationSpace = 'local' | 'world';

/** Reaction used when an emitter is culled by a renderer. */
export type ParticleCullingReaction = 'render-only' | 'pause' | 'pause-and-catch-up' | 'stop';

/** Capacity overflow behavior. */
export type ParticleOverflowPolicy = 'drop-new' | 'replace-oldest';

/** Overflow behavior for bounded particle event and data-channel buffers. */
export type ParticleEventOverflowPolicy = 'drop-new' | 'drop-oldest';

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
    readonly rateOverTime?: ParticleScalarSource;
    readonly rateOverDistance?: ParticleScalarSource;
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
    readonly lifetime?: ParticleScalarSource;
    readonly position?: ParticleVector3Source;
    readonly direction?: ParticleVector3Source;
    readonly speed?: ParticleScalarSource;
    readonly color?: ParticleColorSource;
    readonly size?: ParticleScalarSource;
    /** Rotation in radians. */
    readonly rotation?: ParticleScalarSource;
    readonly mass?: ParticleScalarSource;
    /** Integer mesh bucket selected at spawn. Omit to distribute by stable particle id. */
    readonly meshIndex?: ParticleScalarSource;
    /** Integer ribbon group selected at spawn. Particles only link inside the same group. */
    readonly ribbonId?: ParticleScalarSource;
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

/** Infinite plane used by analytic particle collision and trigger modules. */
export interface ParticlePlaneCollider {
    readonly type: 'plane';
    readonly normal: ParticleVector3;
    readonly offset?: number;
}

/** Solid sphere used by analytic particle collision and trigger modules. */
export interface ParticleSphereCollider {
    readonly type: 'sphere';
    readonly center?: ParticleVector3;
    readonly radius: number;
}

/** Axis-aligned solid box used by analytic particle collision and trigger modules. */
export interface ParticleBoxCollider {
    readonly type: 'box';
    readonly center?: ParticleVector3;
    readonly size: ParticleVector3;
}

/** Line-swept solid sphere used by analytic particle collision and trigger modules. */
export interface ParticleCapsuleCollider {
    readonly type: 'capsule';
    readonly start: ParticleVector3;
    readonly end: ParticleVector3;
    readonly radius: number;
}

/** Backend-neutral analytic collision primitive. */
export type ParticleAnalyticCollider =
    ParticlePlaneCollider | ParticleSphereCollider | ParticleBoxCollider | ParticleCapsuleCollider;

/** Resolve particles against a fixed list of analytic primitives. */
export interface ParticleCollisionModule {
    readonly type: 'collision';
    readonly colliders: readonly ParticleAnalyticCollider[];
    readonly bounce?: number;
    readonly friction?: number;
    readonly radiusScale?: number;
    readonly lifetimeLoss?: number;
    readonly event?: string;
}

/** Emit batched inside/enter/exit events for analytic trigger volumes. */
export interface ParticleTriggerModule {
    readonly type: 'trigger';
    readonly volumes: readonly ParticleAnalyticCollider[];
    readonly events?: Readonly<{
        inside?: string;
        enter?: string;
        exit?: string;
    }>;
}

/** WebGPU-only collision against the sampled opaque scene depth. */
export interface ParticleSceneDepthCollisionModule {
    readonly type: 'scene-depth-collision';
    readonly thickness?: number;
    readonly bounce?: number;
    readonly friction?: number;
    readonly event?: string;
}

/** Route a batched source event into another emitter without a CPU per-event callback. */
export interface ParticleSubEmitterModule {
    readonly type: 'sub-emitter';
    readonly event: string;
    readonly emitter: string;
    readonly count?: number;
    readonly inheritVelocity?: boolean;
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
    | ParticleVectorFieldModule
    | ParticleCollisionModule
    | ParticleTriggerModule
    | ParticleSceneDepthCollisionModule
    | ParticleSubEmitterModule;

/** Sprite-facing mode evaluated per camera by the portable particle shader. */
export type ParticleSpriteAlignment = 'view' | 'world-up' | 'stretched' | 'velocity';

/** Particle-level sort mode. */
export type ParticleSortMode = 'none' | 'distance' | 'youngest' | 'oldest';

/** Surface coverage used to place particle output in the shared render queues. */
export type ParticleSurfaceCoverage = 'opaque' | 'masked' | 'transparent';

/** Deliberately small scene-light subset supported by mesh and ribbon particles. */
export type ParticleLightingMode = 'unlit' | 'lambert';

/** Particle composition behavior relative to temporal and bloom stages. */
export type ParticleCompositionMode = 'scene';

/** Shared controls for non-sprite particle surfaces. */
export interface ParticleAdvancedSurfaceDefinition {
    readonly texture?: Texture<unknown> | null;
    readonly coverage?: ParticleSurfaceCoverage;
    readonly alphaCutoff?: number;
    readonly blend?: 'alpha' | 'premultiplied-alpha' | 'additive';
    readonly lighting?: ParticleLightingMode;
    readonly depthTest?: boolean;
    readonly depthWrite?: boolean;
    readonly sort?: ParticleSortMode;
    readonly renderOrder?: number;
    /** P5 renders into linear scene color before Bloom; other policies fail at compile time. */
    readonly composition?: ParticleCompositionMode;
}

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
    /** Relative elongation per world-space velocity unit for stretched alignment. */
    readonly stretchScale?: number;
    /** WebGPU storage-raster depth fade. Depth write must remain disabled. */
    readonly softParticle?: Readonly<{
        readonly distance: number;
        readonly contrast?: number;
    }>;
}

/** One immutable geometry bucket consumed by a mesh particle renderer. */
export interface ParticleMeshAsset {
    readonly geometry: Geometry;
    readonly texture?: Texture<unknown> | null;
}

/** Instanced mesh output. One draw is emitted per non-empty mesh bucket, never per particle. */
export interface ParticleMeshRendererDefinition extends ParticleAdvancedSurfaceDefinition {
    readonly type: 'mesh';
    readonly meshes: readonly ParticleMeshAsset[];
    readonly orientation?: 'rotation' | 'velocity';
    /** Available only for opaque/masked portable CPU mesh output. */
    readonly motionVectors?: boolean;
}

/** Ribbon and trail output compacting adjacent members of each ribbon into dense segments. */
export interface ParticleRibbonRendererDefinition extends ParticleAdvancedSurfaceDefinition {
    readonly type: 'ribbon' | 'trail';
    readonly facing?: 'view' | 'world-up';
    readonly widthScale?: number;
    readonly uvMode?: 'stretch' | 'repeat';
    readonly tilesPerUnit?: number;
    /** Optional WebGPU scene-depth fade. Depth write must remain disabled. */
    readonly softParticle?: Readonly<{
        readonly distance: number;
        readonly contrast?: number;
    }>;
}

/** Renderer definitions remain separate from simulation modules. */
export type ParticleRendererDefinition =
    | ParticleSpriteRendererDefinition
    | ParticleMeshRendererDefinition
    | ParticleRibbonRendererDefinition;

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
    readonly eventCapacity?: number;
    readonly eventOverflow?: ParticleEventOverflowPolicy;
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
