import type { AudioClip } from './AudioClip.js';
import { AudioClipCache } from './AudioClipCache.js';
import type { AudioCue } from './AudioCue.js';
import { AudioMixer } from './AudioMixer.js';
import { AudioStream, type AudioStreamOptions } from './AudioStream.js';
import { AudioVoice, endVoice, playbackPosition, voiceData, type VoiceData } from './AudioVoice.js';
import { VoiceSlot } from './VoiceSlot.js';
import { finite, integer, pose, validatePose, vector } from './internal.js';
import type {
    AudioConcurrencyOptions,
    AudioDiagnostics,
    AudioEndReason,
    AudioEngineOptions,
    AudioPlayOptions,
    AudioPose,
    AudioTransform,
    AudioVector3
} from './types.js';

/** Listener control. A provider replaces manual pose updates; velocities remain explicit. */
export interface AudioListenerOptions {
    readonly position?: AudioVector3;
    readonly forward?: AudioVector3;
    readonly up?: AudioVector3;
    readonly velocity?: AudioVector3;
    readonly transform?: AudioTransform | null;
}

interface Group {
    readonly maxCount: number;
    readonly resolution: 'reject' | 'oldest' | 'quietest' | 'lowest-priority';
    readonly perOwner: boolean;
    readonly retrigger: number;
    readonly ownerTimes: WeakMap<object, number>;
    lastTime: number;
}

const contexts = new WeakSet<BaseAudioContext>();

function better(a: AudioVoice, b: AudioVoice): boolean {
    const left = voiceData(a);
    const right = voiceData(b);
    return (
        left.priority < right.priority ||
        (left.priority === right.priority &&
            (left.audibility > right.audibility ||
                (left.audibility === right.audibility && left.id < right.id)))
    );
}

/** Renderer-independent game audio runtime. Call update each frame, or install its Stage System. */
export class AudioEngine {
    /** Authoritative playback clock and DSP context. */
    readonly context: BaseAudioContext;
    /** Engine-owned mixer; dispose through the engine. */
    readonly mixer: AudioMixer;
    /** Engine-owned PCM cache; release application leases when no longer needed. */
    readonly clips: AudioClipCache;
    private readonly realtime: AudioContext | undefined;
    private readonly owned: boolean;
    private readonly voices: AudioVoice[] = [];
    private readonly slots: VoiceSlot[] = [];
    private readonly heap: AudioVoice[] = [];
    private readonly streams = new Set<AudioStream>();
    private readonly groups = new Map<string, Group>();
    private readonly listener = pose();
    private readonly appliedListener: AudioPose = {
        x: NaN,
        y: NaN,
        z: NaN,
        forwardX: NaN,
        forwardY: NaN,
        forwardZ: NaN,
        upX: NaN,
        upY: NaN,
        upZ: NaN
    };
    private readonly listenerVelocity = { x: 0, y: 0, z: 0 };
    private listenerTransform: AudioTransform | undefined;
    private readonly maxReal: number;
    private readonly maxVoices: number;
    private readonly maxStreams: number;
    private readonly minAudibility: number;
    private readonly scheduleAhead: number;
    private readonly rampSeconds: number;
    private readonly metersPerUnit: number;
    private readonly soundSpeed: number;
    private readonly occludedGain: number;
    private readonly occludedLowpass: number;
    private readonly maxQueries: number;
    private readonly queryInterval: number;
    private readonly query: AudioEngineOptions['queryOcclusion'];
    private readonly random: () => number;
    private queryCursor = 0;
    private serial = 0;
    private epoch = 0;
    private sourceNodes = 0;
    private rejected = 0;
    private stolen = 0;
    private queries = 0;
    private destroyed = false;
    private updating = false;
    private closing: Promise<void> = Promise.resolve();

    constructor(options: AudioEngineOptions = {}) {
        this.maxReal = integer(options.maxRealVoices ?? 32, 'maxRealVoices', 1, 1024);
        this.maxVoices = integer(options.maxVoices ?? 256, 'maxVoices', this.maxReal, 65536);
        this.maxStreams = integer(options.maxStreams ?? 4, 'maxStreams', 0, 128);
        this.minAudibility = finite(options.minAudibility ?? 0.0001, 'minAudibility', 0, 1);
        this.scheduleAhead = finite(
            options.scheduleAheadSeconds ?? 0.1,
            'scheduleAheadSeconds',
            0,
            60
        );
        this.rampSeconds = finite(
            options.parameterRampSeconds ?? 0.02,
            'parameterRampSeconds',
            0,
            1
        );
        this.metersPerUnit = finite(options.metersPerUnit ?? 1, 'metersPerUnit', 1e-6, 1e6);
        this.soundSpeed = finite(options.speedOfSound ?? 343, 'speedOfSound', 1, 100000);
        this.occludedGain = finite(options.occludedGain ?? 0.25, 'occludedGain', 0, 1);
        this.maxQueries = integer(
            options.maxOcclusionQueriesPerUpdate ?? 8,
            'maxOcclusionQueriesPerUpdate',
            0,
            4096
        );
        this.queryInterval = finite(
            options.occlusionIntervalSeconds ?? 0.1,
            'occlusionIntervalSeconds',
            0,
            60
        );
        this.query = options.queryOcclusion;
        this.random = options.random ?? Math.random;
        this.owned = options.context === undefined;
        if (!options.context && typeof globalThis.AudioContext === 'undefined')
            throw new Error(
                'Web Audio is unavailable. Supply an AudioContext or OfflineAudioContext.'
            );
        this.context =
            options.context ??
            new AudioContext({ latencyHint: options.latencyHint ?? 'interactive' });
        this.realtime =
            typeof globalThis.AudioContext !== 'undefined' && this.context instanceof AudioContext
                ? this.context
                : undefined;
        if (contexts.has(this.context))
            throw new Error('Only one AudioEngine can own the listener of a given context.');
        if (this.context.state === 'closed') throw new Error('Audio context is closed.');
        let mixer: AudioMixer | undefined;
        try {
            this.occludedLowpass = finite(
                options.occludedLowpassHz ?? 1000,
                'occludedLowpassHz',
                10,
                this.context.sampleRate / 2
            );
            mixer = new AudioMixer(this.context, options);
            this.clips = new AudioClipCache(this.context, options.cache);
            this.mixer = mixer;
            contexts.add(this.context);
        } catch (error) {
            mixer?.destroy();
            if (this.owned && this.realtime)
                void this.realtime.close().catch(() => {
                    /* Construction error remains authoritative. */
                });
            throw error;
        }
    }

    /** Call directly from a user gesture. Browser autoplay failures are returned, never swallowed. */
    async resume(): Promise<void> {
        this.assertAlive();
        if (!this.realtime)
            throw new Error('Offline contexts are advanced by startRendering(), not resume().');
        await this.realtime.resume();
        this.assertAlive();
    }

    /** Suspend a realtime context. This explicitly affects all users of a borrowed context. */
    async suspend(): Promise<void> {
        this.assertAlive();
        if (!this.realtime) throw new Error('Offline contexts use suspend(time).');
        for (const stream of this.streams) if (stream.playing) stream.pause();
        await this.realtime.suspend();
    }

    /** Update manual listener pose/velocity or install a transform provider. Partial options preserve other fields. */
    setListener(options: AudioListenerOptions): void {
        this.assertAlive();
        const next = { ...this.listener };
        if (options.position) {
            vector(options.position, 'listener position');
            Object.assign(next, options.position);
        }
        if (options.forward) {
            vector(options.forward, 'listener forward');
            next.forwardX = options.forward.x;
            next.forwardY = options.forward.y;
            next.forwardZ = options.forward.z;
        }
        if (options.up) {
            vector(options.up, 'listener up');
            next.upX = options.up.x;
            next.upY = options.up.y;
            next.upZ = options.up.z;
        }
        if (options.velocity) vector(options.velocity, 'listener velocity');
        validatePose(next);
        Object.assign(this.listener, next);
        if (options.velocity) Object.assign(this.listenerVelocity, options.velocity);
        if (options.transform !== undefined)
            this.listenerTransform = options.transform ?? undefined;
    }

    /** Define a named concurrency policy. Redefinition is rejected while group voices exist. */
    defineConcurrency(name: string, options: AudioConcurrencyOptions): void {
        this.assertAlive();
        if (!name.trim()) throw new TypeError('Concurrency name must not be empty.');
        if (!this.groups.has(name) && this.groups.size >= 256)
            throw new Error('Concurrency group budget exhausted.');
        for (const voice of this.voices)
            if (voiceData(voice).group === name)
                throw new Error('Cannot redefine an active concurrency group.');
        const resolution = options.resolution ?? 'reject';
        if (!['reject', 'oldest', 'quietest', 'lowest-priority'].includes(resolution))
            throw new RangeError('Invalid concurrency resolution.');
        this.groups.set(name, {
            maxCount: integer(options.maxCount, 'maxCount', 1, this.maxVoices),
            resolution,
            perOwner: options.perOwner ?? false,
            retrigger: finite(options.retriggerSeconds ?? 0, 'retriggerSeconds', 0),
            ownerTimes: new WeakMap(),
            lastTime: -Infinity
        });
    }

    /** Returns null on concurrency/global admission rejection; invalid requests throw before stealing. */
    play(clip: AudioClip, options: AudioPlayOptions = {}): AudioVoice | null {
        this.assertAlive();
        if (this.context.state === 'closed') throw new Error('Audio context is closed.');
        const group =
            options.concurrency === undefined ? undefined : this.groups.get(options.concurrency);
        if (options.concurrency !== undefined && !group)
            throw new Error(`Unknown audio concurrency group: ${options.concurrency}`);
        if (group?.perOwner && !options.owner)
            throw new Error('Owner-scoped concurrency requires an owner identity.');
        const voice = new AudioVoice(this, clip, options, ++this.serial);
        const data = voiceData(voice);
        const now = this.context.currentTime;
        let victim: AudioVoice | undefined;
        try {
            this.mixer.refreshSelectionGains();
            this.updateListener(now);
            this.measure(data, now);
            if (group) {
                const last =
                    group.perOwner && options.owner
                        ? (group.ownerTimes.get(options.owner) ?? -Infinity)
                        : group.lastTime;
                if (now - last < group.retrigger) return this.reject(voice);
                let count = 0;
                for (const active of this.voices) {
                    const candidate = voiceData(active);
                    if (
                        candidate.group !== options.concurrency ||
                        (group.perOwner && candidate.owner !== options.owner)
                    )
                        continue;
                    count++;
                    if (!victim || this.preferVictim(active, victim, group.resolution))
                        victim = active;
                }
                if (count < group.maxCount) victim = undefined;
                else if (
                    group.resolution === 'reject' ||
                    (group.resolution === 'lowest-priority' &&
                        victim &&
                        data.priority > victim.priority)
                )
                    return this.reject(voice);
            }
            if (this.voices.length >= this.maxVoices && !victim) return this.reject(voice);
            if (victim) {
                this.finishVoice(victim, 'stolen', 0.005);
                this.stolen++;
            }
            this.voices.push(voice);
            if (group) {
                if (group.perOwner && options.owner) group.ownerTimes.set(options.owner, now);
                else group.lastTime = now;
            }
            this.update();
            return voice;
        } catch (error) {
            this.finishVoice(voice, 'error');
            throw error;
        }
    }

    /** Trigger a weighted cue; request volume/rate multiply the cue's random modulation. */
    playCue(cue: AudioCue, options: AudioPlayOptions = {}): AudioVoice | null {
        this.assertAlive();
        const selection = cue.select(this.random);
        const group = options.concurrency ?? cue.concurrency;
        return this.play(selection.clip, {
            ...options,
            ...(group === undefined ? {} : { concurrency: group }),
            volume: (options.volume ?? 1) * selection.volume,
            playbackRate: (options.playbackRate ?? 1) * selection.playbackRate
        });
    }

    /** Allocate a bounded 2D media stream without starting playback. */
    createStream(url: string, options: AudioStreamOptions = {}): AudioStream {
        this.assertAlive();
        if (!this.realtime) throw new Error('Media streaming requires a realtime AudioContext.');
        if (this.streams.size >= this.maxStreams) throw new Error('Audio stream budget exhausted.');
        const stream = new AudioStream(this, this.realtime, url, options);
        this.streams.add(stream);
        return stream;
    }

    /** O(N log K) selection with a reused K-entry heap and no per-voice frame allocations. */
    update(): void {
        if (this.destroyed || this.updating) return;
        this.updating = true;
        try {
            const now = this.context.currentTime;
            for (const slot of this.slots) if (slot.retiringUntil <= now) slot.clear();
            if (this.context.state === 'closed') {
                while (this.voices.length) {
                    const voice = this.voices[0];
                    if (voice) this.finishVoice(voice, 'error');
                }
                return;
            }
            this.updateListener(now);
            this.mixer.refreshSelectionGains();
            this.heap.length = 0;
            this.epoch++;
            for (let i = 0; i < this.voices.length;) {
                const voice = this.voices[i];
                if (!voice) break;
                const data = voiceData(voice);
                if (
                    data.stopAt <= now ||
                    (!data.paused &&
                        !data.loop &&
                        playbackPosition(data, now) >= data.clip.duration)
                ) {
                    this.finishVoice(voice, data.stopAt <= now ? 'stopped' : 'completed');
                    continue;
                }
                this.measure(data, now);
                i++;
            }
            this.updateOcclusion(now);
            for (const voice of this.voices) {
                const data = voiceData(voice);
                if (
                    !data.paused &&
                    data.anchorTime <= now + this.scheduleAhead &&
                    data.audibility > this.minAudibility
                )
                    this.select(voice);
            }
            for (const voice of this.heap) voiceData(voice).selected = this.epoch;
            for (const voice of this.voices) {
                const data = voiceData(voice);
                if (data.slot && data.selected !== this.epoch) this.releaseVoiceSlot(voice, 0.005);
            }
            this.mixer.resetActivity();
            for (const voice of this.heap) {
                const data = voiceData(voice);
                if (!data.slot) {
                    let slot: VoiceSlot | undefined;
                    for (const candidate of this.slots)
                        if (!candidate.source) {
                            slot = candidate;
                            break;
                        }
                    if (!slot && this.slots.length < this.maxReal) {
                        slot = new VoiceSlot(this.context);
                        this.slots.push(slot);
                    }
                    if (slot) {
                        try {
                            slot.activate(voice, now);
                            this.sourceNodes++;
                        } catch (error) {
                            this.finishVoice(voice, 'error');
                            throw error;
                        }
                    }
                }
                data.slot?.update(now, this.rampSeconds);
                if (data.slot && now >= data.anchorTime) this.mixer.markActive(data.bus);
            }
            for (const stream of this.streams)
                if (stream.playing && stream.volume > 0) this.mixer.markActive(stream.bus);
            this.mixer.updateDucking();
        } finally {
            this.updating = false;
        }
    }

    /** Fade/stop all buffer voices and pause all streams. Does not release cached assets. */
    stopAll(seconds = 0.01): void {
        finite(seconds, 'stop seconds', 0);
        for (let i = this.voices.length - 1; i >= 0; i--) this.voices[i]?.stop(seconds);
        for (const stream of this.streams) stream.pause();
    }

    /** Allocate an on-demand snapshot; counters never require native node access. */
    getDiagnostics(): AudioDiagnostics {
        let real = 0;
        let virtual = 0;
        let paused = 0;
        let scheduled = 0;
        for (const voice of this.voices) {
            const data = voiceData(voice);
            if (data.paused) paused++;
            else if (data.anchorTime > this.context.currentTime) scheduled++;
            else if (data.slot) real++;
            else virtual++;
        }
        let retiring = 0;
        for (const slot of this.slots) if (slot.source && !slot.voice) retiring++;
        return {
            contextState: this.context.state,
            activeVoices: this.voices.length,
            realVoices: real,
            virtualVoices: virtual,
            pausedVoices: paused,
            scheduledVoices: scheduled,
            retiringVoices: retiring,
            allocatedVoiceSlots: this.slots.length,
            sourceNodesCreated: this.sourceNodes,
            rejectedPlays: this.rejected,
            stolenVoices: this.stolen,
            occlusionQueries: this.queries,
            streams: this.streams.size,
            buses: this.mixer.size,
            cache: this.clips.getDiagnostics()
        };
    }

    /** Synchronously stop/disconnect everything; only an internally created context is closed. */
    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        while (this.voices.length) {
            const voice = this.voices[0];
            if (voice) this.finishVoice(voice, 'destroyed');
        }
        for (const stream of this.streams) stream.destroy();
        for (const slot of this.slots) slot.destroy();
        this.slots.length = 0;
        this.heap.length = 0;
        this.groups.clear();
        this.clips.destroy();
        this.mixer.destroy();
        contexts.delete(this.context);
        if (this.owned && this.realtime && this.realtime.state !== 'closed') {
            this.closing = this.realtime.close();
            void this.closing.catch(() => {
                /* whenClosed retains the asynchronous close error. */
            });
        }
    }

    /** Await after destroy to observe completion/failure of an owned AudioContext.close(). */
    whenClosed(): Promise<void> {
        return this.closing;
    }

    /** @internal */
    releaseStream(stream: AudioStream): void {
        this.streams.delete(stream);
    }
    /** @internal */
    releaseVoiceSlot(voice: AudioVoice, seconds: number): void {
        voiceData(voice).slot?.release(this.context.currentTime, seconds);
    }
    /** @internal */
    finishVoice(voice: AudioVoice, reason: AudioEndReason, seconds = 0): void {
        this.releaseVoiceSlot(voice, seconds);
        endVoice(voice, reason);
        const index = this.voices.indexOf(voice);
        if (index >= 0) {
            const last = this.voices.pop();
            if (last && index < this.voices.length) this.voices[index] = last;
        }
    }

    private assertAlive(): void {
        if (this.destroyed) throw new Error('Audio engine is destroyed.');
    }
    private reject(voice: AudioVoice): null {
        endVoice(voice, 'stopped');
        this.rejected++;
        return null;
    }

    private preferVictim(a: AudioVoice, b: AudioVoice, resolution: Group['resolution']): boolean {
        if (resolution === 'oldest' || resolution === 'reject') return a.id < b.id;
        if (resolution === 'quietest') {
            const x = voiceData(a);
            const y = voiceData(b);
            return x.audibility < y.audibility || (x.audibility === y.audibility && a.id < b.id);
        }
        return a.priority > b.priority || (a.priority === b.priority && a.id < b.id);
    }

    private select(voice: AudioVoice): void {
        const heap = this.heap;
        if (heap.length < this.maxReal) {
            heap.push(voice);
            let index = heap.length - 1;
            while (index > 0) {
                const parentIndex = (index - 1) >>> 1;
                const parent = heap[parentIndex];
                if (!parent || !better(parent, voice)) break;
                heap[index] = parent;
                index = parentIndex;
            }
            heap[index] = voice;
        } else {
            const worst = heap[0];
            if (!worst || !better(voice, worst)) return;
            let index = 0;
            for (;;) {
                let child = index * 2 + 1;
                if (child >= heap.length) break;
                const left = heap[child];
                const right = heap[child + 1];
                if (left && right && better(left, right)) child++;
                const candidate = heap[child];
                if (!candidate || !better(voice, candidate)) break;
                heap[index] = candidate;
                index = child;
            }
            heap[index] = voice;
        }
    }

    private updateListener(now: number): void {
        if (this.listenerTransform) {
            this.listenerTransform.readAudioPose(this.listener);
            validatePose(this.listener);
        }
        const next = this.listener;
        const old = this.appliedListener;
        const target = this.context.listener;
        if (next.x !== old.x) target.positionX.setValueAtTime(next.x, now);
        if (next.y !== old.y) target.positionY.setValueAtTime(next.y, now);
        if (next.z !== old.z) target.positionZ.setValueAtTime(next.z, now);
        if (next.forwardX !== old.forwardX) target.forwardX.setValueAtTime(next.forwardX, now);
        if (next.forwardY !== old.forwardY) target.forwardY.setValueAtTime(next.forwardY, now);
        if (next.forwardZ !== old.forwardZ) target.forwardZ.setValueAtTime(next.forwardZ, now);
        if (next.upX !== old.upX) target.upX.setValueAtTime(next.upX, now);
        if (next.upY !== old.upY) target.upY.setValueAtTime(next.upY, now);
        if (next.upZ !== old.upZ) target.upZ.setValueAtTime(next.upZ, now);
        Object.assign(old, next);
    }

    private measure(data: VoiceData, now: number): void {
        const spatial = data.spatial;
        let gain = 1;
        let doppler = 1;
        if (spatial) {
            if (spatial.transform) {
                spatial.transform.readAudioPose(spatial.pose);
                validatePose(spatial.pose);
            }
            const dx = this.listener.x - spatial.pose.x;
            const dy = this.listener.y - spatial.pose.y;
            const dz = this.listener.z - spatial.pose.z;
            const distance = Math.hypot(dx, dy, dz);
            const clamped = Math.max(spatial.ref, Math.min(distance, spatial.max));
            if (distance >= spatial.max) gain = 0;
            else if (spatial.curve) {
                const t = (clamped - spatial.ref) / (spatial.max - spatial.ref);
                for (let i = 1; i < spatial.curve.length; i++) {
                    const a = spatial.curve[i - 1];
                    const b = spatial.curve[i];
                    if (a && b && t <= b.distance) {
                        gain =
                            a.gain +
                            ((b.gain - a.gain) * (t - a.distance)) / (b.distance - a.distance);
                        break;
                    }
                }
            } else if (spatial.model === 'linear')
                gain = Math.max(
                    0,
                    1 - (spatial.rolloff * (clamped - spatial.ref)) / (spatial.max - spatial.ref)
                );
            else if (spatial.model === 'exponential')
                gain = (clamped / spatial.ref) ** -spatial.rolloff;
            else gain = spatial.ref / (spatial.ref + spatial.rolloff * (clamped - spatial.ref));
            if (distance > 1e-8) {
                const nx = dx / distance;
                const ny = dy / distance;
                const nz = dz / distance;
                const angle =
                    (Math.acos(
                        Math.max(
                            -1,
                            Math.min(
                                1,
                                nx * spatial.pose.forwardX +
                                    ny * spatial.pose.forwardY +
                                    nz * spatial.pose.forwardZ
                            )
                        )
                    ) *
                        360) /
                    Math.PI;
                if (angle > spatial.inner)
                    gain *=
                        angle >= spatial.outer
                            ? spatial.outerGain
                            : 1 +
                              ((spatial.outerGain - 1) * (angle - spatial.inner)) /
                                  (spatial.outer - spatial.inner);
                if (spatial.doppler > 0) {
                    const scale = this.metersPerUnit * spatial.doppler;
                    const sourceSpeed =
                        (spatial.velocity.x * nx +
                            spatial.velocity.y * ny +
                            spatial.velocity.z * nz) *
                        scale;
                    const listenerSpeed =
                        (this.listenerVelocity.x * nx +
                            this.listenerVelocity.y * ny +
                            this.listenerVelocity.z * nz) *
                        scale;
                    doppler = Math.max(
                        0.25,
                        Math.min(
                            4,
                            (this.soundSpeed -
                                Math.max(
                                    -this.soundSpeed * 0.9,
                                    Math.min(this.soundSpeed * 0.9, listenerSpeed)
                                )) /
                                (this.soundSpeed -
                                    Math.max(
                                        -this.soundSpeed * 0.9,
                                        Math.min(this.soundSpeed * 0.9, sourceSpeed)
                                    ))
                        )
                    );
                }
            }
            data.distanceGain = gain;
            gain *= 1 + (this.occludedGain - 1) * spatial.obstruction;
            data.lowpass =
                (this.context.sampleRate / 2) *
                (this.occludedLowpass / (this.context.sampleRate / 2)) ** spatial.obstruction;
        }
        const rate = data.rate * doppler;
        if (rate !== data.effectiveRate) {
            data.anchorOffset = playbackPosition(data, now);
            data.anchorTime = Math.max(now, data.anchorTime);
            data.effectiveRate = rate;
            data.slot?.source?.playbackRate.setValueAtTime(rate, now);
        }
        data.attenuation = gain;
        data.audibility =
            gain *
            Math.max(data.volume.value(now), data.volume.target) *
            this.mixer.getSelectionGain(data.bus);
    }

    private updateOcclusion(now: number): void {
        if (!this.query || this.maxQueries === 0 || this.voices.length === 0) return;
        let checked = 0;
        let issued = 0;
        while (checked++ < this.voices.length && issued < this.maxQueries) {
            this.queryCursor %= this.voices.length;
            const voice = this.voices[this.queryCursor++];
            if (!voice) continue;
            const data = voiceData(voice);
            const spatial = data.spatial;
            if (
                !spatial?.occlusion ||
                data.paused ||
                data.anchorTime > now ||
                data.distanceGain <= this.minAudibility ||
                spatial.nextQuery > now
            )
                continue;
            spatial.obstruction = finite(
                this.query(this.listener, spatial.pose, voice),
                'occlusion query result',
                0,
                1
            );
            spatial.nextQuery = now + this.queryInterval;
            issued++;
            this.queries++;
            this.measure(data, now);
        }
    }
}
