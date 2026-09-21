import type { Live2DAssets } from '../Live2DAssets.js';
import type { Live2DSource } from '../Live2DSource.js';

/** Parameter operation applied by a runtime or procedural animation hook. */
export type Live2DParameterBlend = 'overwrite' | 'add' | 'multiply';

/** Named playback policy; force replaces a running motion without exposing SDK priority numbers. */
export type Live2DMotionPriority = 'background' | 'normal' | 'force';

/** Public parameter metadata, independent of SDK identifier classes. */
export interface Live2DParameterInfo {
    /** Model-local parameter name. */
    readonly id: string;
    /** Parameter index in the source model. */
    readonly index: number;
    /** Inclusive parameter minimum. */
    readonly min: number;
    /** Inclusive parameter maximum. */
    readonly max: number;
    /** Model's default parameter value. */
    readonly defaultValue: number;
}

/** Parameter access passed to procedural update hooks. Unknown names fail clearly. */
export interface Live2DParameterAccess {
    /** Read the current value. */
    get(id: string): number;
    /** Set a value with an optional interpolation weight in [0, 1]. */
    set(id: string, value: number, weight?: number): void;
    /** Add a weighted value. */
    add(id: string, value: number, weight?: number): void;
    /** Multiply by a weighted factor. */
    multiply(id: string, value: number, weight?: number): void;
}

/** One procedural hook in the runtime's ordered animation update. */
export type Live2DParameterUpdate = (
    parameters: Live2DParameterAccess,
    deltaSeconds: number
) => void;

/** Controls the effects and procedural hooks for one model update. */
export interface Live2DUpdateOptions {
    /** Non-negative playback scale for motions; other effects use the supplied frame delta. */
    readonly motionTimeScale?: number;
    /** Enable automatic blinking when no motion updates the model. Defaults to true. */
    readonly automaticEyeBlink?: boolean;
    /** Evaluate the model's physics rig. Defaults to true. */
    readonly physicsEnabled?: boolean;
    /** Optional normalized lip-sync value added to declared LipSync parameters. */
    readonly lipSync?: number | null;
    /** Procedural animation after motion baseline capture and before expressions. */
    readonly beforeExpressions?: Live2DParameterUpdate;
    /** Procedural animation after expression evaluation. */
    readonly afterExpressions?: Live2DParameterUpdate;
    /** Final parameter overrides after blinking, physics, pose and lip sync. */
    readonly afterEffects?: Live2DParameterUpdate;
}

/** Motion playback controls, independent of the SDK's motion classes. */
export interface Live2DMotionOptions {
    /** Zero-based entry within a motion group. Defaults to zero. */
    readonly index?: number;
    /** Override the motion's loop setting. */
    readonly loop?: boolean;
    /** Playback policy. Defaults to force; background/normal can be rejected by active priority. */
    readonly priority?: Live2DMotionPriority;
    /** Override the motion fade-in duration, in seconds. */
    readonly fadeInSeconds?: number;
    /** Override the motion fade-out duration, in seconds. */
    readonly fadeOutSeconds?: number;
}

/** Expression playback fade overrides. */
export interface Live2DExpressionOptions {
    /** Override expression fade-in duration, in seconds. */
    readonly fadeInSeconds?: number;
    /** Override expression fade-out duration, in seconds. */
    readonly fadeOutSeconds?: number;
}

/** Cancellation while a runtime constructs a model and loads animation resources. */
export interface Live2DRuntimeCreateOptions {
    /** Abort loading and release every session resource already created. */
    readonly signal?: AbortSignal;
}

/** One independent animation and model session, owned by a high-level Live2D model. */
export interface Live2DModelRuntime {
    /** Drawable data synchronized after each runtime update. */
    readonly source: Live2DSource;
    /** Stable public parameter metadata. */
    readonly parameters: readonly Live2DParameterInfo[];
    /** Read a parameter by its model-local name. */
    getParameter(id: string): number;
    /** Change a parameter through the selected weighted operation. */
    setParameter(id: string, value: number, weight?: number, blend?: Live2DParameterBlend): void;
    /** Advance this session by a finite non-negative delta in seconds. */
    update(deltaSeconds: number, options: Live2DUpdateOptions): void;
    /** Start an eagerly loaded motion; returns false when priority prevents playback. */
    playMotion(group: string, options?: Live2DMotionOptions): boolean;
    /** Whether a base motion is still playing, including a looping motion. */
    isMotionPlaying(): boolean;
    /** Stop and release all active motions immediately. */
    stopMotions(): void;
    /** Start a named eagerly loaded expression. */
    setExpression(name: string, options?: Live2DExpressionOptions): void;
    /** Stop and release every active expression. */
    clearExpression(): void;
    /** Current model-wide opacity from the animation runtime. */
    getOpacity(): number;
    /** Release all session resources. Asset textures remain owned by the caller. */
    destroy(): void;
}

/** Versioned CPU animation provider consumed by the high-level addon API. */
export interface Live2DRuntime {
    /** Protocol version understood by this addon. */
    readonly apiVersion: 1;
    /** Create an independent session without transferring input asset ownership. */
    createModel(
        assets: Live2DAssets,
        options: Live2DRuntimeCreateOptions
    ): Promise<Live2DModelRuntime>;
}
