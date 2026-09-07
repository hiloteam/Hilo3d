import { animationItem } from './animationArray';
import type Node from '../core/Node';
import type { AnimationClip } from './AnimationClip';
import { AnimationBlendTree1D } from './AnimationBlendTree1D';
import { PoseBinding, type AnimationBindingResolver } from './AnimationBinding';
import {
    AnimationLayerRuntime,
    type AnimationLayer,
    type AnimationLayerParameters,
    type AnimationPlayOptions
} from './AnimationLayer';
import type { AnimationTrack } from './AnimationTrack';

/** Character animation configuration. All clocks use seconds except the Ticker-compatible tick(). */
export interface AnimationParameters {
    rootNode?: Node;
    clips?: readonly AnimationClip[];
    resolveBinding?: AnimationBindingResolver;
}
/** Character-local pose mixer. Assets are shared; bindings, clocks, layers and scratch storage are isolated. */
class Animation {
    private static readonly active = new Set<Animation>();
    private static serial = 0;
    private lastTick = -1;
    /** Advances automatically playing characters from a Ticker (milliseconds). */
    static tick(milliseconds: number): void {
        const serial = ++Animation.serial;
        for (const animation of Animation.active) {
            if (animation.lastTick === serial) continue;
            animation.lastTick = serial;
            animation.tick(milliseconds);
        }
    }
    readonly isAnimation = true;
    readonly className = 'Animation';
    private root: Node | undefined;
    private readonly clipAssets: readonly AnimationClip[];
    private readonly resolver: AnimationBindingResolver | undefined;
    private readonly bindings: PoseBinding[] = [];
    private readonly boundClips = new Map<
        AnimationClip,
        readonly { track: AnimationTrack; binding: PoseBinding }[]
    >();
    private readonly layerList: AnimationLayerRuntime[] = [];
    private readonly layerDescriptors: AnimationLayerParameters[] = [];
    private readonly parameters = new Map<string, number>();
    private base: AnimationLayerRuntime | undefined;
    private rate = 1;
    private destroyed = false;
    paused = true;
    constructor(params: AnimationParameters = {}) {
        this.root = params.rootNode;
        this.clipAssets = Object.freeze([...(params.clips ?? [])]);
        this.resolver = params.resolveBinding;
        const names = new Set<string>();
        for (const clip of this.clipAssets) {
            if (names.has(clip.name))
                throw new RangeError(`Duplicate animation clip: ${clip.name}`);
            names.add(clip.name);
        }
    }
    /** Shared clip assets. To author additional motions use addLayer(). */
    get clips(): readonly AnimationClip[] {
        return this.clipAssets;
    }
    /** Binding root. Rebinding a live mixer requires creating a new Animation or clone(). */
    get rootNode(): Node | undefined {
        return this.root;
    }
    set rootNode(value: Node | undefined) {
        this.assertAlive();
        if (this.bindings.length && value !== this.root)
            throw new Error('Cannot rebind an initialized animation.');
        this.root = value;
    }
    /** Playback rate, including transitions; zero freezes time while allowing explicit pose evaluation. */
    get timeScale(): number {
        return this.rate;
    }
    set timeScale(value: number) {
        if (!Number.isFinite(value) || value < 0)
            throw new RangeError('Animation timeScale must be finite and nonnegative.');
        this.rate = value;
    }
    /** Set a blend parameter immediately, or exponentially damp it using a half-life and elapsed seconds. */
    setParameter(name: string, value: number, halfLife = 0, seconds = 0): void {
        this.assertAlive();
        if (
            !Number.isFinite(value) ||
            !Number.isFinite(halfLife) ||
            halfLife < 0 ||
            !Number.isFinite(seconds) ||
            seconds < 0
        )
            throw new RangeError('Invalid animation parameter.');
        const previous = this.parameters.get(name) ?? value;
        this.parameters.set(
            name,
            halfLife === 0
                ? value
                : previous + (value - previous) * (1 - 2 ** (-seconds / halfLife))
        );
    }
    /** Current scalar parameter value, defaulting to zero. */
    getParameter(name: string): number {
        return this.parameters.get(name) ?? 0;
    }
    /** Append a layer in composition order. Resolve nodes and capture reference properties once. */
    addLayer(params: AnimationLayerParameters): AnimationLayer {
        return this.createLayer(params);
    }
    private createLayer(params: AnimationLayerParameters): AnimationLayerRuntime {
        this.assertAlive();
        if (this.layerList.some(layer => layer.name === params.name))
            throw new RangeError(`Duplicate animation layer: ${params.name}`);
        if (!this.root) throw new Error('Animation needs a root node before binding.');
        const nodes = new Map<string, Node>();
        this.root.traverse(node => {
            if (node.name && !nodes.has(node.name)) nodes.set(node.name, node);
        });
        this.root.traverse(node => {
            nodes.set(node.animationId, node);
        });
        const pendingBindings: PoseBinding[] = [];
        const pendingClips = new Map<
            AnimationClip,
            readonly { track: AnimationTrack; binding: PoseBinding }[]
        >();
        const bind = (clip: AnimationClip): void => {
            if (this.boundClips.has(clip) || pendingClips.has(clip)) return;
            const entries = clip.tracks.map(track => {
                const node = nodes.get(track.target);
                if (!node) throw new RangeError(`Missing animation target: ${track.target}`);
                let binding =
                    this.bindings.find(
                        item => item.node === node && item.track.property === track.property
                    ) ??
                    pendingBindings.find(
                        item => item.node === node && item.track.property === track.property
                    );
                if (binding && binding.track.components !== track.components)
                    throw new RangeError('Animation component counts disagree for a property.');
                if (!binding) {
                    binding = new PoseBinding(node, track, this.resolver);
                    pendingBindings.push(binding);
                }
                return { track, binding };
            });
            const unique = new Set(entries.map(entry => entry.binding));
            if (unique.size !== entries.length)
                throw new RangeError('Animation target aliases write the same property twice.');
            pendingClips.set(clip, entries);
        };
        for (const motion of params.motions) {
            if (motion instanceof AnimationBlendTree1D)
                for (const sample of motion.samples) bind(sample.clip);
            else bind(motion);
        }
        const descriptor: AnimationLayerParameters = {
            ...params,
            motions: Object.freeze([...params.motions]),
            ...(params.mask ? { mask: Object.freeze({ ...params.mask }) } : {})
        };
        const layer = new AnimationLayerRuntime(
            descriptor,
            this.boundClips,
            this.bindings,
            this.parameters
        );
        this.bindings.push(...pendingBindings);
        for (const [clip, entries] of pendingClips) this.boundClips.set(clip, entries);
        this.layerList.push(layer);
        this.layerDescriptors.push(descriptor);
        return layer;
    }
    /** Play or crossfade a loaded clip on the default base layer and enroll in Animation.tick(). */
    play(name?: string, options: AnimationPlayOptions = {}): AnimationLayer {
        this.assertAlive();
        const selected = name ?? this.clipAssets[0]?.name;
        if (!selected || !this.clipAssets.some(clip => clip.name === selected))
            throw new RangeError(`Unknown animation clip: ${name ?? '(none)'}`);
        this.base ??= this.createLayer({ name: '__base', motions: this.clipAssets });
        this.base.play(selected, options);
        this.resume();
        return this.base;
    }
    /** Advance from a millisecond Ticker. Manually controlled characters can call update(seconds). */
    tick(milliseconds: number): void {
        if (!this.paused) this.update(milliseconds / 1000);
    }
    /** Evaluate one pose and write each bound property once. Call before physics/render transform collection. */
    update(seconds: number): void {
        this.assertAlive();
        if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(seconds * this.rate))
            throw new RangeError('Animation delta must be finite and nonnegative.');
        for (const binding of this.bindings) binding.value.set(binding.reference);
        for (const layer of this.layerList) layer.evaluate(seconds * this.rate);
        for (const binding of this.bindings) binding.write(binding.value);
        for (const layer of this.layerList) layer.dispatchEvents();
    }
    /** Suspend automatic ticking, retaining the displayed pose and playback state. */
    pause(): void {
        this.paused = true;
        Animation.active.delete(this);
    }
    /** Enroll in automatic ticking. Do not also update manually in the same frame. */
    resume(): void {
        this.assertAlive();
        this.paused = false;
        this.lastTick = Animation.serial;
        Animation.active.add(this);
    }
    /** Stop all motions and automatic ticking, optionally restoring captured reference properties. */
    stop(restore = false): void {
        this.pause();
        for (const layer of this.layerList) layer.stop();
        if (restore) for (const binding of this.bindings) binding.write(binding.reference);
    }
    /** Release node references and remove this instance from automatic ticking. Shared assets remain valid. */
    destroy(): void {
        this.stop();
        this.bindings.length = 0;
        this.boundClips.clear();
        this.layerList.length = 0;
        this.layerDescriptors.length = 0;
        this.root = undefined;
        this.destroyed = true;
    }
    /** Clone configuration with fresh clocks and bindings. Reference poses are copied from the source mixer. */
    clone(rootNode: Node): Animation {
        this.assertAlive();
        const result = new Animation({
            rootNode,
            clips: this.clipAssets,
            ...(this.resolver ? { resolveBinding: this.resolver } : {})
        });
        result.timeScale = this.timeScale;
        for (const [name, value] of this.parameters) result.setParameter(name, value);
        for (let i = 0; i < this.layerDescriptors.length; i++) {
            const layer = result.createLayer(animationItem(this.layerDescriptors, i));
            const source = animationItem(this.layerList, i);
            layer.copyPlaybackFrom(source);
            if (source === this.base) result.base = layer;
        }
        for (let i = 0; i < this.bindings.length; i++)
            animationItem(result.bindings, i).reference.set(
                animationItem(this.bindings, i).reference
            );
        if (!this.paused) result.resume();
        return result;
    }
    private assertAlive(): void {
        if (this.destroyed) throw new Error('Animation has been destroyed.');
    }
}
export default Animation;
