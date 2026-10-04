import { type AudioClip, releaseClip, retainClip } from './AudioClip.js';
import type { AudioEngine } from './AudioEngine.js';
import type { AudioBus } from './AudioMixer.js';
import type { VoiceSlot } from './VoiceSlot.js';
import { finite, integer, pose, Ramp, validatePose, vector } from './internal.js';
import type {
    AudioEndReason,
    AudioPlayOptions,
    AudioPose,
    AudioRolloffPoint,
    AudioSpatialOptions,
    AudioTransform,
    AudioVector3,
    AudioVoiceState
} from './types.js';

export interface SpatialState {
    readonly pose: AudioPose;
    readonly velocity: { x: number; y: number; z: number };
    readonly transform: AudioTransform | undefined;
    readonly model: 'linear' | 'inverse' | 'exponential';
    readonly panningModel: PanningModelType;
    readonly ref: number;
    readonly max: number;
    readonly rolloff: number;
    readonly curve: readonly AudioRolloffPoint[] | undefined;
    readonly inner: number;
    readonly outer: number;
    readonly outerGain: number;
    readonly doppler: number;
    readonly occlusion: boolean;
    obstruction: number;
    nextQuery: number;
}

export interface VoiceData {
    readonly complete: (reason: AudioEndReason) => void;
    readonly engine: AudioEngine;
    readonly clip: AudioClip;
    readonly id: number;
    readonly bus: AudioBus;
    readonly spatial: SpatialState | undefined;
    readonly group: string | undefined;
    readonly owner: object | undefined;
    readonly volume: Ramp;
    readonly loop: boolean;
    readonly loopStart: number;
    readonly loopEnd: number;
    priority: number;
    anchorTime: number;
    anchorOffset: number;
    rate: number;
    effectiveRate: number;
    pauseDelay: number;
    paused: boolean;
    reason: AudioEndReason | undefined;
    stopAt: number;
    slot: VoiceSlot | undefined;
    attenuation: number;
    distanceGain: number;
    lowpass: number;
    audibility: number;
    selected: number;
}
const dataByVoice = new WeakMap<AudioVoice, VoiceData>();
export function voiceData(voice: AudioVoice): VoiceData {
    const data = dataByVoice.get(voice);
    if (!data) throw new Error('Unknown audio voice.');
    return data;
}

function spatialState(options: AudioSpatialOptions): SpatialState {
    const value = pose();
    if (options.position) {
        vector(options.position, 'position');
        Object.assign(value, options.position);
    }
    if (options.forward) {
        vector(options.forward, 'forward');
        value.forwardX = options.forward.x;
        value.forwardY = options.forward.y;
        value.forwardZ = options.forward.z;
        // Source cones only need a forward axis. Choose a nonparallel auxiliary up axis.
        if (
            Math.abs(value.forwardY) >
            0.99 * Math.hypot(value.forwardX, value.forwardY, value.forwardZ)
        ) {
            value.upY = 0;
            value.upZ = 1;
        }
    }
    options.transform?.readAudioPose(value);
    validatePose(value);
    const ref = finite(options.refDistance ?? 1, 'refDistance', 1e-6);
    const max = finite(options.maxDistance ?? 100, 'maxDistance', ref + 1e-6);
    const inner = finite(options.coneInnerAngle ?? 360, 'coneInnerAngle', 0, 360);
    const outer = finite(options.coneOuterAngle ?? 360, 'coneOuterAngle', inner, 360);
    const curve = options.rolloffCurve?.map(point => ({
        distance: finite(point.distance, 'curve distance', 0, 1),
        gain: finite(point.gain, 'curve gain', 0, 1)
    }));
    if (curve) {
        if (
            curve.length < 2 ||
            curve.length > 128 ||
            curve[0]?.distance !== 0 ||
            curve.at(-1)?.distance !== 1
        )
            throw new RangeError('Rolloff curve needs 2–128 points spanning [0,1].');
        for (let i = 1; i < curve.length; i++) {
            const previous = curve[i - 1];
            const current = curve[i];
            if (
                previous &&
                current &&
                (current.distance <= previous.distance || current.gain > previous.gain)
            )
                throw new RangeError(
                    'Rolloff curve must increase in distance and never increase in gain.'
                );
        }
    }
    const model = options.distanceModel ?? 'inverse';
    if (!['linear', 'inverse', 'exponential'].includes(model))
        throw new RangeError('Invalid distance model.');
    const panningModel = options.panningModel ?? 'HRTF';
    if (!['HRTF', 'equalpower'].includes(panningModel))
        throw new RangeError('Invalid panning model.');
    const velocity = { x: 0, y: 0, z: 0 };
    if (options.velocity) {
        vector(options.velocity, 'velocity');
        Object.assign(velocity, options.velocity);
    }
    return {
        pose: value,
        velocity,
        transform: options.transform,
        model,
        panningModel,
        ref,
        max,
        curve,
        inner,
        outer,
        rolloff: finite(options.rolloffFactor ?? 1, 'rolloffFactor', 0, 10),
        outerGain: finite(options.coneOuterGain ?? 0, 'coneOuterGain', 0, 1),
        doppler: finite(options.dopplerFactor ?? 0, 'dopplerFactor', 0, 10),
        occlusion: options.occlusion ?? false,
        obstruction: 0,
        nextQuery: -Infinity
    };
}

export function playbackPosition(data: VoiceData, now: number): number {
    const offset =
        data.anchorOffset +
        (data.paused ? 0 : Math.max(0, now - data.anchorTime) * data.effectiveRate);
    if (data.loop && offset >= data.loopEnd)
        return data.loopStart + ((offset - data.loopStart) % (data.loopEnd - data.loopStart));
    return Math.min(offset, data.clip.duration);
}

export function endVoice(voice: AudioVoice, reason: AudioEndReason): void {
    const data = voiceData(voice);
    if (data.reason) return;
    data.anchorOffset = playbackPosition(data, data.engine.context.currentTime);
    data.reason = reason;
    releaseClip(data.clip);
    data.complete(reason);
}

/** Stable per-play handle. Completed handles never get recycled into unrelated sounds. */
export class AudioVoice {
    /** Resolves exactly once for natural completion, stop, stealing, teardown or native failure. */
    readonly finished: Promise<AudioEndReason>;
    /** @internal Create voices through AudioEngine.play(). */
    constructor(engine: AudioEngine, clip: AudioClip, options: AudioPlayOptions, id: number) {
        const loopStart = finite(options.loopStart ?? 0, 'loopStart', 0, clip.duration);
        const loopEnd = finite(
            options.loopEnd ?? clip.duration,
            'loopEnd',
            loopStart,
            clip.duration
        );
        if (loopEnd <= loopStart) throw new RangeError('loopEnd must be greater than loopStart.');
        const offset = finite(options.offset ?? 0, 'offset', 0, clip.duration);
        if (offset === clip.duration)
            throw new RangeError('offset must be before the end of the clip.');
        const when = Math.max(
            engine.context.currentTime,
            finite(options.when ?? engine.context.currentTime, 'when', 0)
        );
        const gain = finite(options.volume ?? 1, 'volume', 0, 16);
        const fadeIn = finite(options.fadeIn ?? 0, 'fadeIn', 0);
        const rate = finite(options.playbackRate ?? 1, 'playbackRate', 0.01, 16);
        const volume = new Ramp(fadeIn > 0 ? 0 : gain);
        if (fadeIn > 0) volume.set(gain, fadeIn, when);
        let complete: (reason: AudioEndReason) => void = () => {
            throw new Error('Audio completion is uninitialized.');
        };
        this.finished = new Promise(resolve => {
            complete = resolve;
        });
        const data: VoiceData = {
            complete,
            engine,
            clip,
            id,
            bus: options.bus ?? engine.mixer.master,
            spatial: options.spatial ? spatialState(options.spatial) : undefined,
            group: options.concurrency,
            owner: options.owner,
            volume,
            loop: options.loop ?? false,
            loopStart,
            loopEnd,
            priority: integer(options.priority ?? 128, 'priority', 0, 255),
            anchorTime: when,
            anchorOffset: offset,
            rate,
            effectiveRate: rate,
            pauseDelay: 0,
            paused: false,
            reason: undefined,
            stopAt: Infinity,
            slot: undefined,
            attenuation: 1,
            distanceGain: 1,
            lowpass: engine.context.sampleRate / 2,
            audibility: gain,
            selected: 0
        };
        engine.mixer.assertBus(data.bus);
        dataByVoice.set(this, data);
        retainClip(clip);
    }

    get id(): number {
        return voiceData(this).id;
    }
    get clip(): AudioClip {
        return voiceData(this).clip;
    }
    get bus(): AudioBus {
        return voiceData(this).bus;
    }
    get endReason(): AudioEndReason | undefined {
        return voiceData(this).reason;
    }
    get priority(): number {
        return voiceData(this).priority;
    }
    get volume(): number {
        return voiceData(this).volume.target;
    }
    get playbackRate(): number {
        return voiceData(this).rate;
    }
    get position(): number {
        const data = voiceData(this);
        return data.reason
            ? data.anchorOffset
            : playbackPosition(data, data.engine.context.currentTime);
    }
    get state(): AudioVoiceState {
        const data = voiceData(this);
        if (data.reason) return 'ended';
        if (data.stopAt !== Infinity) return 'stopping';
        if (data.paused) return 'paused';
        if (data.anchorTime > data.engine.context.currentTime) return 'scheduled';
        return data.slot ? 'playing' : 'virtual';
    }

    setVolume(value: number, seconds = 0.02): void {
        finite(value, 'volume', 0, 16);
        finite(seconds, 'fade seconds', 0);
        const data = this.live();
        data.volume.set(value, seconds, data.engine.context.currentTime, data.slot?.envelope.gain);
        data.engine.update();
    }

    setPriority(value: number): void {
        integer(value, 'priority', 0, 255);
        const data = this.live();
        data.priority = value;
        data.engine.update();
    }

    /** Pitch and duration change together, including while virtual or paused. */
    setPlaybackRate(value: number): void {
        finite(value, 'playbackRate', 0.01, 16);
        const data = this.live();
        const now = data.engine.context.currentTime;
        data.anchorOffset = playbackPosition(data, now);
        data.anchorTime = Math.max(now, data.anchorTime);
        data.effectiveRate *= value / data.rate;
        data.rate = value;
        data.slot?.source?.playbackRate.setValueAtTime(data.effectiveRate, now);
        data.engine.update();
    }

    setPosition(value: AudioVector3): void {
        vector(value, 'position');
        const data = this.live();
        if (!data.spatial || data.spatial.transform)
            throw new Error('setPosition requires a spatial voice without a transform provider.');
        data.spatial.pose.x = value.x;
        data.spatial.pose.y = value.y;
        data.spatial.pose.z = value.z;
    }

    setVelocity(value: AudioVector3): void {
        vector(value, 'velocity');
        const data = this.live();
        if (!data.spatial) throw new Error('Velocity requires a spatial voice.');
        Object.assign(data.spatial.velocity, value);
    }

    /** Pause retains the cursor, future-start delay and concurrency membership. */
    pause(): void {
        const data = this.live();
        if (data.paused) return;
        const now = data.engine.context.currentTime;
        data.anchorOffset = playbackPosition(data, now);
        data.pauseDelay = Math.max(0, data.anchorTime - now);
        data.paused = true;
        data.engine.releaseVoiceSlot(this, 0);
    }

    resume(): void {
        const data = this.live();
        if (!data.paused) return;
        data.paused = false;
        data.anchorTime = data.engine.context.currentTime + data.pauseDelay;
        data.engine.update();
    }

    seek(seconds: number): void {
        const data = this.live();
        finite(seconds, 'seek seconds', 0, data.clip.duration);
        if (seconds === data.clip.duration) throw new RangeError('Seek must be before clip end.');
        data.engine.releaseVoiceSlot(this, 0);
        data.anchorOffset = seconds;
        data.anchorTime = Math.max(data.engine.context.currentTime, data.anchorTime);
        data.engine.update();
    }

    /** Stop is idempotent. A real voice uses an audio-clock fade; virtual voices stop immediately. */
    stop(seconds = 0.01): void {
        finite(seconds, 'stop seconds', 0);
        const data = voiceData(this);
        if (data.reason) return;
        if (!data.slot || seconds === 0 || data.paused) {
            data.engine.finishVoice(this, 'stopped');
            return;
        }
        const now = data.engine.context.currentTime;
        data.stopAt = now + seconds;
        data.volume.set(0, seconds, now, data.slot.envelope.gain);
        data.slot.source?.stop(data.stopAt);
    }

    private live(): VoiceData {
        const data = voiceData(this);
        if (data.reason) throw new Error(`Audio voice has ended (${data.reason}).`);
        return data;
    }
}
