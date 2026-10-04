import type { AudioBus } from './AudioMixer.js';
import type { AudioClip } from './AudioClip.js';
import type { AudioVoice } from './AudioVoice.js';

/** World-space vector. Distances use engine units; velocities use engine units/second. */
export interface AudioVector3 {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

/** Mutable, reusable pose filled by a transform provider; forward is local -Z, up is +Y. */
export interface AudioPose {
    x: number;
    y: number;
    z: number;
    forwardX: number;
    forwardY: number;
    forwardZ: number;
    upX: number;
    upY: number;
    upZ: number;
}

/** Fill a caller-owned pose without allocating. Providers must return finite, nonzero axes. */
export interface AudioTransform {
    readAudioPose(target: AudioPose): void;
}

/** Distance in normalized [0,1] range and corresponding amplitude in [0,1]. */
export interface AudioRolloffPoint {
    readonly distance: number;
    readonly gain: number;
}

/** Spatialization and attenuation, snapshotted on play. */
export interface AudioSpatialOptions {
    readonly position?: AudioVector3;
    readonly forward?: AudioVector3;
    readonly velocity?: AudioVector3;
    readonly transform?: AudioTransform;
    /** Defaults to HRTF. Spatial sources are downmixed to mono before panning. */
    readonly panningModel?: PanningModelType;
    readonly distanceModel?: 'linear' | 'inverse' | 'exponential';
    readonly refDistance?: number;
    /** Hard audibility boundary for all distance models; defaults to 100 engine units. */
    readonly maxDistance?: number;
    readonly rolloffFactor?: number;
    /** Optional monotone piecewise linear rolloff, with endpoints at distance 0 and 1. */
    readonly rolloffCurve?: readonly AudioRolloffPoint[];
    readonly coneInnerAngle?: number;
    readonly coneOuterAngle?: number;
    readonly coneOuterGain?: number;
    /** Explicit velocities drive Doppler; zero disables it (default). */
    readonly dopplerFactor?: number;
    readonly occlusion?: boolean;
}

/** Logical voice states. A virtual voice advances without a native source node. */
export type AudioVoiceState = 'scheduled' | 'playing' | 'virtual' | 'paused' | 'stopping' | 'ended';
/** Terminal reasons, retained by the handle after it leaves the active pool. */
export type AudioEndReason = 'completed' | 'stopped' | 'stolen' | 'destroyed' | 'error';

/** Buffer playback request. All times and fades use seconds on the AudioContext clock. */
export interface AudioPlayOptions {
    readonly bus?: AudioBus;
    readonly volume?: number;
    readonly playbackRate?: number;
    readonly loop?: boolean;
    readonly loopStart?: number;
    readonly loopEnd?: number;
    readonly offset?: number;
    /** Absolute AudioContext time. Past times begin immediately at offset. */
    readonly when?: number;
    readonly fadeIn?: number;
    /** 0 is most important, 255 least important. Equal priorities compare audibility and age. */
    readonly priority?: number;
    readonly spatial?: AudioSpatialOptions;
    readonly concurrency?: string;
    /** Optional identity for owner-scoped concurrency. */
    readonly owner?: object;
}

/** A named, engine-local concurrency group, including virtual, scheduled and paused voices. */
export interface AudioConcurrencyOptions {
    readonly maxCount: number;
    readonly resolution?: 'reject' | 'oldest' | 'quietest' | 'lowest-priority';
    readonly perOwner?: boolean;
    readonly retriggerSeconds?: number;
}

/** An independently releasable pin on a decoded clip. Release is idempotent. */
export interface AudioClipLease {
    readonly clip: AudioClip;
    release(): void;
}

/** Bounded decoded cache and fetch/decode admission limits. */
export interface AudioClipCacheOptions {
    /** Resident float32 PCM budget, default 64 MiB. */
    readonly maxBytes?: number;
    /** Resident clip count, default 256; pending identities use a separate limit. */
    readonly maxEntries?: number;
    /** Fetch and native decode slots, default 4. */
    readonly maxConcurrentLoads?: number;
    /** Combined queued/loading URL identities, default 64. */
    readonly maxPendingLoads?: number;
    /** Per-response encoded byte cap, default 16 MiB. */
    readonly maxEncodedBytes?: number;
    /** Allows application-controlled credentials/headers without global fetch replacement. */
    readonly fetch?: typeof globalThis.fetch;
}

/** Cache accounting excludes caller-owned buffers and the browser decoder's transient memory. */
export interface AudioClipCacheDiagnostics {
    readonly bytes: number;
    readonly entries: number;
    readonly pinnedEntries: number;
    readonly activeLoads: number;
    readonly pendingLoads: number;
    readonly hits: number;
    readonly evictions: number;
}

/** Runtime configuration; injected contexts remain caller-owned. No global side effects at import. */
export interface AudioEngineOptions {
    readonly context?: BaseAudioContext;
    readonly latencyHint?: AudioContextLatencyCategory | number;
    /** Native buffer sources including release tails; defaults to 32. */
    readonly maxRealVoices?: number;
    /** Scheduled, real, virtual and paused buffer voices; defaults to 256. */
    readonly maxVoices?: number;
    /** Independently bounded streaming media elements; defaults to 4. */
    readonly maxStreams?: number;
    readonly maxBuses?: number;
    readonly maxSends?: number;
    readonly masterVolume?: number;
    /** Optional output dynamics compressor; this is not a brickwall limiter. Defaults to true. */
    readonly compressor?: boolean;
    readonly cache?: AudioClipCacheOptions;
    /** Convert explicit world-unit velocities to meters/second; default 1. */
    readonly metersPerUnit?: number;
    /** Doppler speed of sound in meters/second, default 343. */
    readonly speedOfSound?: number;
    /** Estimated linear amplitude threshold for real voices, default 0.0001. */
    readonly minAudibility?: number;
    /** How early future voices can reserve a real slot. Defaults to 0.1 seconds. */
    readonly scheduleAheadSeconds?: number;
    readonly parameterRampSeconds?: number;
    readonly maxOcclusionQueriesPerUpdate?: number;
    readonly occlusionIntervalSeconds?: number;
    readonly occludedGain?: number;
    readonly occludedLowpassHz?: number;
    /** Synchronous, budgeted application physics query. Return 0 (clear) through 1 (blocked). */
    readonly queryOcclusion?: (
        listener: AudioVector3,
        source: AudioVector3,
        voice: AudioVoice
    ) => number;
    /** Random values must be in [0,1). Used only when triggering cues. */
    readonly random?: () => number;
}

/** Allocation and admission counters, intended for profiling without reading private nodes. */
export interface AudioDiagnostics {
    readonly contextState: AudioContextState;
    readonly activeVoices: number;
    readonly realVoices: number;
    readonly virtualVoices: number;
    readonly pausedVoices: number;
    readonly scheduledVoices: number;
    /** Native sources finishing a short release; these still occupy the real-voice budget. */
    readonly retiringVoices: number;
    readonly allocatedVoiceSlots: number;
    readonly sourceNodesCreated: number;
    readonly rejectedPlays: number;
    readonly stolenVoices: number;
    readonly occlusionQueries: number;
    readonly streams: number;
    readonly buses: number;
    readonly cache: AudioClipCacheDiagnostics;
}
