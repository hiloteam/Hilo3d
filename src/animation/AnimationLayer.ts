import { animationItem } from './animationArray';
import { AnimationClip } from './AnimationClip';
import type { AnimationMotion } from './AnimationBlendTree1D';
import type { PoseBinding } from './AnimationBinding';
import type { AnimationTrack } from './AnimationTrack';

/** Semantic events are emitted only by the transition destination, after pose writeback. */
export interface AnimationEvent {
    type: 'marker' | 'finished';
    layer: string;
    motion: string;
    name: string;
    /** Number of crossings coalesced into this event when a large delta spans multiple cycles. */
    count: number;
}

/** Layer configuration. Masks are exact track target identifiers; unspecified targets have zero weight. */
export interface AnimationLayerParameters {
    name: string;
    motions: readonly AnimationMotion[];
    weight?: number;
    mode?: 'override' | 'additive';
    mask?: Readonly<Record<string, number>>;
    onEvent?: (event: AnimationEvent) => void;
}
/** Transition duration is in seconds. Synchronize transfers the current normalized phase. */
export interface AnimationPlayOptions {
    fade?: number;
    synchronize?: boolean;
    loop?: boolean;
}
interface BoundTrack {
    track: AnimationTrack;
    binding: PoseBinding;
}
interface MotionState {
    motion: AnimationMotion;
    phase: number;
    loop: boolean;
    weight: number;
    from: number;
    to: number;
    elapsed: number;
    duration: number;
    finished: boolean;
}
/** Per-character layer handle, created by Animation.addLayer(). */
export interface AnimationLayer {
    /** Layer identifier. */
    readonly name: string;
    /** Composition rule. */
    readonly mode: 'override' | 'additive';
    /** Overall influence in [0, 1]. */
    weight: number;
    /** Nonnegative clock multiplier for this layer's motions. */
    playbackRate: number;
    /** Current transition destination. */
    readonly currentMotion: string | undefined;
    /** Unwrapped normalized destination clock. */
    readonly normalizedTime: number;
    /** Whether a one-shot is holding its terminal pose. */
    readonly finished: boolean;
    /** Select a motion, optionally fading from all current contributions. */
    play(name: string, options?: AnimationPlayOptions): this;
    /** Remove layer motion contributions over the given seconds. */
    stop(fade?: number): void;
    /** Seek without dispatching crossed events. */
    seek(phase: number): void;
}
/** @internal Layer implementation keeps pose storage out of public signatures. */
export class AnimationLayerRuntime implements AnimationLayer {
    readonly name: string;
    readonly mode: 'override' | 'additive';
    private readonly mask: Readonly<Record<string, number>> | undefined;
    private readonly states: MotionState[];
    private current: MotionState | undefined;
    private layerWeight: number;
    private speed = 1;
    private readonly events: AnimationEvent[] = [];
    private readonly onEvent: ((event: AnimationEvent) => void) | undefined;
    /** @internal Construct through Animation.addLayer(). */
    constructor(
        params: AnimationLayerParameters,
        private readonly clips: ReadonlyMap<AnimationClip, readonly BoundTrack[]>,
        private readonly bindings: readonly PoseBinding[],
        private readonly parameters: ReadonlyMap<string, number>
    ) {
        this.name = params.name;
        this.onEvent = params.onEvent;
        this.mode = params.mode ?? 'override';
        this.mask = params.mask ? Object.freeze({ ...params.mask }) : undefined;
        this.layerWeight = params.weight ?? 1;
        this.weight = this.layerWeight;
        if (this.mask) for (const value of Object.values(this.mask)) validateWeight(value);
        const names = new Set<string>();
        this.states = params.motions.map(motion => {
            if (names.has(motion.name))
                throw new RangeError(`Duplicate animation motion: ${motion.name}`);
            names.add(motion.name);
            return {
                motion,
                phase: 0,
                loop: true,
                weight: 0,
                from: 0,
                to: 0,
                elapsed: 0,
                duration: 0,
                finished: false
            };
        });
    }
    /** Overall layer influence in [0, 1]. */
    get weight(): number {
        return this.layerWeight;
    }
    set weight(value: number) {
        validateWeight(value);
        this.layerWeight = value;
    }
    /** Layer-local playback speed. Use for personality variations without changing unrelated layers. */
    get playbackRate(): number {
        return this.speed;
    }
    set playbackRate(value: number) {
        if (!Number.isFinite(value) || value < 0)
            throw new RangeError('Invalid animation playback rate.');
        this.speed = value;
    }
    /** True when a non-looping destination has reached its end and is holding its final pose. */
    get finished(): boolean {
        return this.current?.finished ?? false;
    }
    /** The transition destination, or undefined after stopping. */
    get currentMotion(): string | undefined {
        return this.current?.motion.name;
    }
    /** Current destination's unwrapped normalized time. */
    get normalizedTime(): number {
        return this.current?.phase ?? 0;
    }
    /** Select a motion; fade starts from every contributing state's current weight. */
    play(name: string, options: AnimationPlayOptions = {}): this {
        const target = this.states.find(state => state.motion.name === name);
        if (!target) throw new RangeError(`Unknown animation motion: ${name}`);
        const fade = options.fade ?? 0;
        if (!Number.isFinite(fade) || fade < 0)
            throw new RangeError('Fade duration must be finite and nonnegative.');
        if (target === this.current && target.to === 1 && !target.finished) return this;
        const phase = options.synchronize ? (this.current?.phase ?? 0) : 0;
        // A live target retains its clock when a transition reverses direction.
        if (target.weight === 0 || target.finished) target.phase = phase;
        target.loop = options.loop ?? true;
        target.finished = false;
        for (const state of this.states) {
            state.from = state.weight;
            state.to = state === target ? 1 : 0;
            state.elapsed = 0;
            state.duration = fade;
            if (fade === 0) state.weight = state.to;
        }
        this.current = target;
        return this;
    }
    /** Fade the layer back to the reference pose (or the lower layer for unanimated properties). */
    stop(fade = 0): void {
        if (!Number.isFinite(fade) || fade < 0) throw new RangeError('Invalid fade duration.');
        for (const state of this.states) {
            state.from = state.weight;
            state.to = 0;
            state.elapsed = 0;
            state.duration = fade;
            if (fade === 0) state.weight = 0;
        }
        this.current = undefined;
        this.events.length = 0;
    }
    /** Seek the destination in normalized cycles, preserving blend weights. */
    seek(phase: number): void {
        if (!Number.isFinite(phase) || phase < 0) throw new RangeError('Invalid animation phase.');
        if (this.current) {
            this.current.phase = phase;
            this.current.finished = false;
        }
    }
    /** @internal Copies playback only; assets and character bindings remain separate. */
    copyPlaybackFrom(source: AnimationLayerRuntime): void {
        this.speed = source.speed;
        this.layerWeight = source.layerWeight;
        for (let i = 0; i < this.states.length; i++) {
            const target = animationItem(this.states, i);
            const state = animationItem(source.states, i);
            Object.assign(target, state);
            if (state === source.current) this.current = target;
        }
    }
    /** @internal Advances clocks and composes into the reusable character pose. */
    evaluate(seconds: number): void {
        for (const binding of this.bindings) {
            binding.sum.fill(0);
            binding.total = 0;
        }
        for (const state of this.states) {
            if (state.weight === 0 && state.to === 0) continue;
            state.elapsed = Math.min(state.duration, state.elapsed + seconds);
            const t = state.duration === 0 ? 1 : state.elapsed / state.duration;
            // Linear envelopes preserve total weight and continuity under interruption.
            state.weight = state.from + (state.to - state.from) * t;
            const motion = state.motion;
            let first: AnimationClip;
            let second: AnimationClip;
            let mix = 0;
            if (motion instanceof AnimationClip) first = second = motion;
            else {
                const value = this.parameters.get(motion.parameter) ?? 0;
                let index = 0;
                while (
                    index < motion.samples.length - 2 &&
                    value > animationItem(motion.samples, index + 1).threshold
                )
                    index++;
                const a = animationItem(motion.samples, index);
                const b = animationItem(motion.samples, index + 1);
                mix = Math.max(0, Math.min(1, (value - a.threshold) / (b.threshold - a.threshold)));
                first = a.clip;
                second = b.clip;
            }
            const duration = first.duration * (1 - mix) + second.duration * mix;
            const previousPhase = state.phase;
            if (duration > 0) state.phase += (seconds * this.speed) / duration;
            else if (!state.loop) state.phase = 1;
            if (!Number.isFinite(state.phase)) throw new RangeError('Animation phase overflow.');
            if (!state.loop) state.phase = Math.min(1, state.phase);
            if (state === this.current) {
                if (this.onEvent && seconds > 0 && this.speed > 0)
                    this.collectMarkers(state, mix <= 0.5 ? first : second, previousPhase);
                if (!state.loop && state.phase >= 1 && !state.finished) {
                    state.finished = true;
                    if (this.onEvent)
                        this.events.push({
                            type: 'finished',
                            layer: this.name,
                            motion: state.motion.name,
                            name: state.motion.name,
                            count: 1
                        });
                }
            }
            const phase = state.loop ? state.phase % 1 : state.phase;
            if (this.layerWeight === 0 || state.weight === 0) continue;
            this.sample(first, phase, state.weight * (1 - mix));
            if (mix > 0) this.sample(second, phase, state.weight * mix);
        }
        for (const binding of this.bindings) {
            binding.blend(
                this.layerWeight *
                    (this.mask
                        ? (this.mask[binding.node.animationId] ?? this.mask[binding.node.name] ?? 0)
                        : 1),
                this.mode === 'additive'
            );
        }
    }
    /** @internal Dispatch after all layers have written their final pose. Event allocation is demand-driven. */
    dispatchEvents(): void {
        // Remove before calling application code so callbacks may stop or restart the layer safely.
        while (this.events.length) {
            const event = this.events.shift();
            if (event) this.onEvent?.(event);
        }
    }
    private collectMarkers(state: MotionState, clip: AnimationClip, previous: number): void {
        if (clip.duration === 0) return;
        for (const marker of clip.markers) {
            const phase = (marker.time - clip.start) / clip.duration;
            const count = state.loop
                ? Math.floor(state.phase - phase) - Math.floor(previous - phase)
                : previous < phase && state.phase >= phase
                  ? 1
                  : 0;
            if (count > 0)
                this.events.push({
                    type: 'marker',
                    layer: this.name,
                    motion: state.motion.name,
                    name: marker.name,
                    count
                });
        }
    }
    private sample(clip: AnimationClip, phase: number, weight: number): void {
        if (weight <= 0) return;
        const tracks = this.clips.get(clip);
        if (!tracks) throw new Error('Animation clip was not bound.');
        const time = clip.start + clip.duration * phase;
        for (const entry of tracks) {
            entry.track.sample(time, entry.binding.sample);
            entry.binding.accumulate(weight);
        }
    }
}
function validateWeight(value: number): void {
    if (!Number.isFinite(value) || value < 0 || value > 1)
        throw new RangeError('Animation weights must be in [0, 1].');
}
