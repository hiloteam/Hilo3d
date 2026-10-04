import type { SceneDocument, SceneNode } from './scene';

export const ANIMATION_PROPERTIES = [
    'position.x',
    'position.y',
    'position.z',
    'rotation.x',
    'rotation.y',
    'rotation.z',
    'scale.x',
    'scale.y',
    'scale.z'
] as const;

export type AnimationProperty = (typeof ANIMATION_PROPERTIES)[number];
export type AnimationInterpolation = 'linear' | 'step' | 'smooth';

/** Interpolation describes the outgoing segment from this key to its next key. */
export interface AnimationKey {
    time: number;
    value: number;
    interpolation: AnimationInterpolation;
}

export interface AnimationTrack {
    id: string;
    nodeId: string;
    property: AnimationProperty;
    keys: AnimationKey[];
}

/** Project-owned authoring data. Times use seconds; rotations use Euler degrees. */
export interface AnimationClip {
    id: string;
    name: string;
    sceneId: string;
    duration: number;
    fps: number;
    loop: boolean;
    tracks: AnimationTrack[];
}

export interface AnimationSampleOptions {
    /** Overrides the clip's playback loop, for example to inspect its final key when scrubbing. */
    loop?: boolean;
    /** Round to the nearest authored frame. Continuous sampling is the default. */
    snapToFrame?: boolean;
}

export type AnimationTransforms = Record<string, SceneNode['transform']>;
const MAX_TRACKS = 3_000;
const MAX_KEYS = 100_000;
const MAX_DURATION = 86_400;
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

function record(value: unknown, path: string, allowed: readonly string[]): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${path}: expected an object`);
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
        throw new Error(`${path}: expected a plain object`);
    const input = value as Record<string, unknown>;
    for (const key of Object.keys(input)) {
        if (!allowed.includes(key)) throw new Error(`${path}.${key}: unknown field`);
    }
    return input;
}

function identifier(value: unknown, path: string): string {
    if (
        typeof value !== 'string' ||
        value.length > 64 ||
        !ID.test(value) ||
        value === 'constructor' ||
        value === 'prototype'
    ) {
        throw new Error(
            `${path}: expected a stable kebab-case identifier of at most 64 characters`
        );
    }
    return value;
}

function finite(value: unknown, path: string, minimum: number, maximum: number): number {
    if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < minimum ||
        value > maximum
    ) {
        throw new Error(
            `${path}: expected a finite value between ${String(minimum)} and ${String(maximum)}`
        );
    }
    return value === 0 ? 0 : value;
}

function property(value: unknown, path: string): AnimationProperty {
    for (const candidate of ANIMATION_PROPERTIES) if (value === candidate) return candidate;
    throw new Error(`${path}: expected a position, rotation or scale axis`);
}

/** Validate and detach clip data, sort key times, and reject duplicate tracks or key times. */
export function validateClip(value: unknown): AnimationClip {
    const input = record(value, 'clip', [
        'id',
        'name',
        'sceneId',
        'duration',
        'fps',
        'loop',
        'tracks'
    ]);
    const duration = finite(input['duration'], 'clip.duration', 1 / 240, MAX_DURATION);
    const fps = finite(input['fps'], 'clip.fps', 1, 240);
    if (!Number.isInteger(fps)) throw new Error('clip.fps: expected a whole-number frame rate');
    const name = input['name'];
    if (typeof name !== 'string' || !name.trim() || name.length > 120)
        throw new Error('clip.name: expected a name of 1 to 120 characters');
    if (typeof input['loop'] !== 'boolean') throw new Error('clip.loop: expected a boolean');
    const rawTracks = input['tracks'];
    if (!Array.isArray(rawTracks) || rawTracks.length > MAX_TRACKS)
        throw new Error('clip.tracks: expected at most 3,000 tracks');
    const ids = new Set<string>();
    const channels = new Set<string>();
    let keyCount = 0;
    const tracks: AnimationTrack[] = rawTracks.map((entry: unknown, index: number) => {
        const path = `clip.tracks[${String(index)}]`;
        const track = record(entry, path, ['id', 'nodeId', 'property', 'keys']);
        const id = identifier(track['id'], `${path}.id`);
        const nodeId = identifier(track['nodeId'], `${path}.nodeId`);
        const channel = property(track['property'], `${path}.property`);
        if (ids.has(id)) throw new Error(`${path}.id: duplicate track identifier`);
        ids.add(id);
        const channelId = `${nodeId}:${channel}`;
        if (channels.has(channelId)) throw new Error(`${path}: duplicate node/channel track`);
        channels.add(channelId);
        const rawKeys = track['keys'];
        if (!Array.isArray(rawKeys)) throw new Error(`${path}.keys: expected an array`);
        keyCount += rawKeys.length;
        if (keyCount > MAX_KEYS) throw new Error('clip.tracks: at most 100,000 keys are supported');
        const bounds = channel.startsWith('scale.')
            ? ([0.001, 10_000] as const)
            : channel.startsWith('rotation.')
              ? ([-360_000, 360_000] as const)
              : ([-10_000, 10_000] as const);
        const keys: AnimationKey[] = rawKeys
            .map((keyValue: unknown, keyIndex: number): AnimationKey => {
                const keyPath = `${path}.keys[${String(keyIndex)}]`;
                const key = record(keyValue, keyPath, ['time', 'value', 'interpolation']);
                const interpolation = key['interpolation'];
                if (
                    interpolation !== 'linear' &&
                    interpolation !== 'step' &&
                    interpolation !== 'smooth'
                ) {
                    throw new Error(`${keyPath}.interpolation: expected linear, step or smooth`);
                }
                return {
                    time: finite(key['time'], `${keyPath}.time`, 0, duration),
                    value: finite(key['value'], `${keyPath}.value`, bounds[0], bounds[1]),
                    interpolation
                };
            })
            .sort((a, b) => a.time - b.time);
        for (let keyIndex = 1; keyIndex < keys.length; keyIndex++) {
            if (keys[keyIndex]?.time === keys[keyIndex - 1]?.time) {
                throw new Error(`${path}.keys: duplicate key time`);
            }
        }
        return { id, nodeId, property: channel, keys };
    });
    return {
        id: identifier(input['id'], 'clip.id'),
        name,
        sceneId: identifier(input['sceneId'], 'clip.sceneId'),
        duration,
        fps,
        loop: input['loop'],
        tracks
    };
}

/** Validate node references independently from structural validation or project scene identity. */
export function validateClipTargets(clip: AnimationClip, scene: SceneDocument): void {
    for (const track of clip.tracks) {
        if (!Object.hasOwn(scene.nodes, track.nodeId))
            throw new Error(`Animation track ${track.id} references missing node ${track.nodeId}`);
    }
}

/** Build an empty three-second clip; identity is supplied by the owning project. */
export function createClip(id: string, sceneId: string, name = 'Animation'): AnimationClip {
    return validateClip({ id, sceneId, name, duration: 3, fps: 30, loop: true, tracks: [] });
}

/**
 * Normalize seconds: non-looping clips clamp to both endpoints, looping clips wrap into
 * [0, duration), including negative time. A looping exact endpoint is the first frame.
 */
export function normalizeClipTime(
    clip: AnimationClip,
    time: number,
    options: AnimationSampleOptions = {}
): number {
    if (!Number.isFinite(time)) throw new Error('Animation time must be finite');
    finite(clip.duration, 'clip.duration', 1 / 240, MAX_DURATION);
    finite(clip.fps, 'clip.fps', 1, 240);
    const loop = options.loop ?? clip.loop;
    let result = loop ? time % clip.duration : Math.max(0, Math.min(clip.duration, time));
    if (result < 0) result += clip.duration;
    if (options.snapToFrame) result = Math.round(result * clip.fps) / clip.fps;
    if (loop && result >= clip.duration) return 0;
    return result === 0 ? 0 : Math.min(clip.duration, result);
}

function sampleTrack(track: AnimationTrack, time: number): number | undefined {
    const first = track.keys[0];
    const last = track.keys.at(-1);
    if (!first || !last) return undefined;
    if (time <= first.time) return first.value;
    if (time >= last.time) return last.value;
    let low = 0;
    let high = track.keys.length - 1;
    while (high - low > 1) {
        const middle = (low + high) >>> 1;
        const candidate = track.keys[middle];
        if (candidate && candidate.time <= time) low = middle;
        else high = middle;
    }
    const left = track.keys[low];
    const right = track.keys[high];
    if (!left || !right) throw new Error(`Animation track ${track.id} has invalid key ordering`);
    if (left.interpolation === 'step') return left.value;
    const progress = (time - left.time) / (right.time - left.time);
    const weight =
        left.interpolation === 'smooth' ? progress * progress * (3 - 2 * progress) : progress;
    return left.value + (right.value - left.value) * weight;
}

/**
 * Sample into detached local transforms. Only animated nodes are returned; unkeyed channels retain
 * the authored scene values. Neither the clip nor scene is mutated. Rotation channels interpolate
 * authored Euler numbers directly, so values such as 0 to 720 preserve full revolutions.
 */
export function evaluateClip(
    clip: AnimationClip,
    scene: SceneDocument,
    time: number,
    options: AnimationSampleOptions = {}
): AnimationTransforms {
    const normalized = normalizeClipTime(clip, time, options);
    const result: AnimationTransforms = {};
    for (const track of clip.tracks) {
        const authored = scene.nodes[track.nodeId];
        if (!authored || !Object.hasOwn(scene.nodes, track.nodeId))
            throw new Error(`Animation track ${track.id} references missing node ${track.nodeId}`);
        const value = sampleTrack(track, normalized);
        if (value === undefined) continue;
        let transform = result[track.nodeId];
        if (!transform) {
            transform = {
                position: { ...authored.transform.position },
                rotation: { ...authored.transform.rotation },
                scale: { ...authored.transform.scale }
            };
            result[track.nodeId] = transform;
        }
        const [kind, axis] = track.property.split('.');
        if (
            (kind !== 'position' && kind !== 'rotation' && kind !== 'scale') ||
            (axis !== 'x' && axis !== 'y' && axis !== 'z')
        ) {
            throw new Error(`Animation track ${track.id} has an invalid channel`);
        }
        transform[kind][axis] = value;
    }
    return result;
}
