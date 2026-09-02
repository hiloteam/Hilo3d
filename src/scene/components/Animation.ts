import { defineComponent, SparseSetComponentStore, type ComponentStore } from '../../ecs/Component';
import type { Entity } from '../../ecs/Entity';
import type Matrix4 from '../../math/Matrix4';
import { ChangedComponentStore } from './Rendering';

export type AnimationTargetProperty = 'translation' | 'rotation' | 'scale' | 'weights';
export type AnimationInterpolation = 'step' | 'linear' | 'cubic-spline';

/** One resolved animation channel. Targets are Entity handles, never object names. */
export interface AnimationChannel {
    readonly target: Entity;
    readonly property: AnimationTargetProperty;
    readonly times: Float32Array;
    readonly values: Float32Array;
    readonly interpolation?: AnimationInterpolation;
    readonly width: number;
}

/** Immutable shared clip resource with Entity-resolved channels. */
export class AnimationClip {
    readonly name: string;
    readonly duration: number;
    readonly channels: readonly AnimationChannel[];

    constructor(name: string, channels: readonly AnimationChannel[]) {
        if (name.trim().length === 0) throw new TypeError('AnimationClip name cannot be empty.');
        let duration = 0;
        const snapshot: AnimationChannel[] = [];
        for (const channel of channels) {
            if (channel.times.length === 0) {
                throw new TypeError('Animation channels require at least one keyframe.');
            }
            const valueMultiplier = channel.interpolation === 'cubic-spline' ? 3 : 1;
            if (channel.values.length !== channel.times.length * channel.width * valueMultiplier) {
                throw new TypeError('Animation channel value count does not match its width.');
            }
            if (channel.width <= 0 || !Number.isSafeInteger(channel.width)) {
                throw new RangeError('Animation channel width must be a positive safe integer.');
            }
            const end = channel.times[channel.times.length - 1] ?? 0;
            if (!Number.isFinite(end) || end < 0) {
                throw new RangeError('Animation keyframe times must be finite and non-negative.');
            }
            duration = Math.max(duration, end);
            snapshot.push(
                Object.freeze({
                    ...channel,
                    times: channel.times.slice(),
                    values: channel.values.slice(),
                    interpolation: channel.interpolation ?? 'linear'
                })
            );
        }
        this.name = name;
        this.duration = duration;
        this.channels = Object.freeze(snapshot);
    }
}

export interface AnimatorValue {
    readonly clip: AnimationClip;
    readonly time?: number;
    readonly speed?: number;
    readonly playing?: boolean;
    readonly loop?: boolean;
}

/** Sparse identity plus SoA playing state for the animation hot loop. */
export class AnimatorStore implements ComponentStore<AnimatorValue> {
    private readonly entries: SparseSetComponentStore<AnimationClip>;
    private times: Float64Array;
    private speeds: Float64Array;
    private playing: Uint8Array;
    private looping: Uint8Array;

    constructor(initialCapacity: number) {
        this.entries = new SparseSetComponentStore(initialCapacity);
        this.times = new Float64Array(initialCapacity);
        this.speeds = new Float64Array(initialCapacity);
        this.playing = new Uint8Array(initialCapacity);
        this.looping = new Uint8Array(initialCapacity);
    }

    get length(): number {
        return this.entries.length;
    }

    get entityIndices(): Uint32Array {
        return this.entries.entityIndices;
    }

    get entityCapacity(): number {
        return this.times.length;
    }

    get structureRevision(): number {
        return this.entries.structureRevision;
    }

    get dataRevision(): number {
        return this.entries.dataRevision;
    }

    ensureEntityCapacity(capacity: number): void {
        const previous = this.times.length;
        this.entries.ensureEntityCapacity(capacity);
        if (capacity <= previous) return;
        const times = new Float64Array(capacity);
        times.set(this.times);
        this.times = times;
        const speeds = new Float64Array(capacity);
        speeds.set(this.speeds);
        this.speeds = speeds;
        const playing = new Uint8Array(capacity);
        playing.set(this.playing);
        this.playing = playing;
        const looping = new Uint8Array(capacity);
        looping.set(this.looping);
        this.looping = looping;
    }

    has(entityIndex: number): boolean {
        return this.entries.has(entityIndex);
    }

    get(entityIndex: number): AnimatorValue {
        return this.getByDenseIndex(this.requireDenseIndex(entityIndex));
    }

    getByDenseIndex(denseIndex: number): AnimatorValue {
        const entityIndex = this.entityIndices[denseIndex];
        if (entityIndex === undefined || denseIndex < 0 || denseIndex >= this.length) {
            throw new RangeError('Animator dense index is out of range.');
        }
        return {
            clip: this.entries.getByDenseIndex(denseIndex),
            time: this.times[entityIndex] ?? 0,
            speed: this.speeds[entityIndex] ?? 1,
            playing: this.playing[entityIndex] === 1,
            loop: this.looping[entityIndex] === 1
        };
    }

    getEntryRevision(entityIndex: number): number {
        return this.entries.getEntryRevision(entityIndex);
    }

    validate(value: AnimatorValue): void {
        if (!(value.clip instanceof AnimationClip)) {
            throw new TypeError('Animator clip must be an AnimationClip.');
        }
        const time = value.time ?? 0;
        const speed = value.speed ?? 1;
        if (!Number.isFinite(time) || time < 0 || !Number.isFinite(speed)) {
            throw new RangeError(
                'Animator time and speed must be finite; time cannot be negative.'
            );
        }
    }

    add(entityIndex: number, value: AnimatorValue): void {
        this.validate(value);
        this.entries.add(entityIndex, value.clip);
        this.writeState(entityIndex, value);
    }

    set(entityIndex: number, value: AnimatorValue): void {
        this.validate(value);
        this.entries.set(entityIndex, value.clip);
        this.writeState(entityIndex, value);
    }

    remove(entityIndex: number): boolean {
        const removed = this.entries.remove(entityIndex);
        if (removed) this.clearState(entityIndex);
        return removed;
    }

    clear(): void {
        this.entries.clear();
        this.times.fill(0);
        this.speeds.fill(0);
        this.playing.fill(0);
        this.looping.fill(0);
    }

    clipAtDenseIndex(denseIndex: number): AnimationClip {
        return this.entries.getByDenseIndex(denseIndex);
    }

    advanceAtDenseIndex(denseIndex: number, deltaSeconds: number): number {
        const entityIndex = this.entityIndices[denseIndex];
        if (entityIndex === undefined || denseIndex < 0 || denseIndex >= this.length) {
            throw new RangeError('Animator dense index is out of range.');
        }
        if (this.playing[entityIndex] !== 1) return this.times[entityIndex] ?? 0;
        const clip = this.entries.getByDenseIndex(denseIndex);
        let time = (this.times[entityIndex] ?? 0) + deltaSeconds * (this.speeds[entityIndex] ?? 1);
        if (clip.duration > 0 && time > clip.duration) {
            if (this.looping[entityIndex] === 1) time %= clip.duration;
            else {
                time = clip.duration;
                this.playing[entityIndex] = 0;
            }
        }
        this.times[entityIndex] = time;
        return time;
    }

    private requireDenseIndex(entityIndex: number): number {
        for (let index = 0; index < this.length; index++) {
            if (this.entityIndices[index] === entityIndex) return index;
        }
        throw new ReferenceError(`Entity index ${String(entityIndex)} has no Animator.`);
    }

    private writeState(entityIndex: number, value: AnimatorValue): void {
        const time = value.time ?? 0;
        const speed = value.speed ?? 1;
        this.times[entityIndex] = time;
        this.speeds[entityIndex] = speed;
        this.playing[entityIndex] = value.playing === false ? 0 : 1;
        this.looping[entityIndex] = value.loop === false ? 0 : 1;
    }

    private clearState(entityIndex: number): void {
        this.times[entityIndex] = 0;
        this.speeds[entityIndex] = 0;
        this.playing[entityIndex] = 0;
        this.looping[entityIndex] = 0;
    }
}

/** Playing clip state. */
export const Animator = defineComponent<AnimatorValue>(
    'hilo3d/animator',
    initialCapacity => new AnimatorStore(initialCapacity)
);

export interface SkeletonPoseValue {
    readonly joints: readonly Entity[];
    readonly inverseBindMatrices: readonly Matrix4[];
}

export interface SkinValue {
    readonly skeleton: Entity;
}

export interface MorphPoseValue {
    readonly weights: Float32Array;
}

/** Skeleton pose relationship resolved during prefab instantiation. */
export const SkeletonPose = defineComponent<SkeletonPoseValue>('hilo3d/skeleton-pose');

/** Mesh-to-skeleton relationship used by render extraction. */
export const Skin = defineComponent<SkinValue>('hilo3d/skin');

/** Mutable morph-weight pose authored by AnimationSystem. */
export const MorphPose = defineComponent<MorphPoseValue>(
    'hilo3d/morph-pose',
    initialCapacity => new ChangedComponentStore(initialCapacity, value => value)
);
