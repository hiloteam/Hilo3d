import type { AnimationTrack } from './AnimationTrack';

/** A semantic marker for footsteps, effects, sounds or interaction timing. Time is in clip-source seconds. */
export interface AnimationMarker {
    name: string;
    time: number;
}

/** Immutable clip descriptor. Optional start/end select a window of the shared tracks. */
export interface AnimationClipParameters {
    name: string;
    tracks: readonly AnimationTrack[];
    start?: number;
    end?: number;
    markers?: readonly AnimationMarker[];
}
/** Shareable animation asset; playback clocks and pose bindings live on the Animation instance. */
export class AnimationClip {
    readonly name: string;
    readonly tracks: readonly AnimationTrack[];
    readonly start: number;
    readonly end: number;
    readonly duration: number;
    readonly markers: readonly AnimationMarker[];
    constructor(params: AnimationClipParameters) {
        this.name = params.name;
        this.tracks = Object.freeze([...params.tracks]);
        this.start = params.start ?? 0;
        this.end = params.end ?? Math.max(0, ...this.tracks.map(track => track.endTime));
        if (
            !Number.isFinite(this.start) ||
            !Number.isFinite(this.end) ||
            this.start < 0 ||
            this.end < this.start
        ) {
            throw new RangeError('Invalid animation clip range.');
        }
        const targets = new Map<string, Set<string>>();
        for (const track of this.tracks) {
            let properties = targets.get(track.target);
            if (!properties) targets.set(track.target, (properties = new Set()));
            if (properties.has(track.property))
                throw new RangeError('A clip may only write each target property once.');
            properties.add(track.property);
        }
        this.markers = Object.freeze(
            (params.markers ?? [])
                .map(marker => {
                    if (
                        !Number.isFinite(marker.time) ||
                        marker.time < this.start ||
                        marker.time > this.end
                    )
                        throw new RangeError('Animation marker is outside the clip.');
                    return Object.freeze({ ...marker });
                })
                .sort((a, b) => a.time - b.time)
        );
        this.duration = this.end - this.start;
        Object.freeze(this);
    }
}
