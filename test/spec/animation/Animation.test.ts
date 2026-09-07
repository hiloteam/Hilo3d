import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    Animation,
    AnimationClip,
    AnimationTrack,
    AnimationBlendTree1D,
    Node,
    Mesh,
    MorphGeometry,
    Quaternion,
    type AnimationEvent,
    type AnimationProperty
} from '../../../src/Hilo3d';

const owned: Animation[] = [];
afterEach(() => {
    for (const animation of owned) animation.destroy();
    owned.length = 0;
});
function clip(
    name: string,
    x: number,
    duration = 1,
    target = 'pet',
    property: AnimationProperty = 'translation'
): AnimationClip {
    return new AnimationClip({
        name,
        tracks: [
            new AnimationTrack({
                target,
                property,
                times: [0, duration],
                values: [x, 0, 0, x, 0, 0]
            })
        ]
    });
}
function mixer(root: Node, clips: readonly AnimationClip[] = []): Animation {
    const animation = new Animation({ rootNode: root, clips });
    owned.push(animation);
    return animation;
}
describe('Animation pose mixer', () => {
    it('crossfades and reverses an interrupted transition without a pose discontinuity', () => {
        const node = new Node({ name: 'pet' });
        const animation = mixer(node, [clip('idle', 0), clip('walk', 10), clip('run', 20)]);
        animation.play('idle');
        animation.play('walk', { fade: 1 });
        animation.update(0.25);
        expect(node.x).toBeCloseTo(2.5);
        animation.play('run', { fade: 1 });
        animation.update(0);
        expect(node.x).toBeCloseTo(2.5);
        animation.update(0.5);
        expect(node.x).toBeCloseTo(11.25);
        animation.play('walk', { fade: 1 });
        animation.update(0);
        expect(node.x).toBeCloseTo(11.25);
        animation.update(1);
        expect(node.x).toBeCloseTo(10);
    });
    it('blends unequal walk/run durations at the same gait phase', () => {
        const node = new Node({ name: 'pet' });
        const walk = new AnimationClip({
            name: 'walk',
            tracks: [
                new AnimationTrack({
                    target: 'pet',
                    property: 'translation',
                    times: [0, 2],
                    values: [0, 0, 0, 2, 0, 0]
                })
            ]
        });
        const run = new AnimationClip({
            name: 'run',
            tracks: [
                new AnimationTrack({
                    target: 'pet',
                    property: 'translation',
                    times: [0, 1],
                    values: [0, 0, 0, 4, 0, 0]
                })
            ]
        });
        const animation = mixer(node);
        const layer = animation.addLayer({
            name: 'locomotion',
            motions: [
                new AnimationBlendTree1D('move', 'speed', [
                    { threshold: 1, clip: walk },
                    { threshold: 3, clip: run }
                ])
            ]
        });
        animation.setParameter('speed', 2);
        layer.play('move');
        animation.update(0.75);
        expect(layer.normalizedTime).toBeCloseTo(0.5);
        expect(node.x).toBeCloseTo(1.5);
        animation.setParameter('speed', 99);
        animation.update(0);
        expect(node.x).toBeCloseTo(2);
    });
    it('handles sparse channels and fades an upper layer all the way back to the lower pose', () => {
        const root = new Node({ name: 'pet' });
        const head = new Node({ name: 'head' }).addTo(root);
        const animation = mixer(root);
        animation.addLayer({ name: 'base', motions: [clip('walk', 10)] }).play('walk');
        const upper = animation.addLayer({
            name: 'upper',
            motions: [clip('head', 4, 1, 'head')],
            mask: { head: 1 }
        });
        upper.play('head');
        animation.update(0);
        expect(root.x).toBe(10);
        expect(head.x).toBe(4);
        upper.stop(1);
        animation.update(0.99);
        expect(head.x).toBeCloseTo(0.04);
        animation.update(0.01);
        expect(head.x).toBe(0);
        const override = animation.addLayer({ name: 'override', motions: [clip('pose', 20)] });
        override.play('pose');
        animation.update(0);
        override.stop(1);
        animation.update(0.99);
        expect(root.x).toBeCloseTo(10.1);
        animation.update(0.01);
        expect(root.x).toBe(10);
    });
    it('fills missing channels from the reference pose without retaining the previous action', () => {
        const root = new Node({ name: 'pet', x: 2 });
        const empty = new AnimationClip({ name: 'empty', tracks: [], end: 1 });
        const animation = mixer(root, [clip('move', 10), empty]);
        animation.play('move');
        animation.update(0);
        animation.play('empty', { fade: 1 });
        animation.update(0.5);
        expect(root.x).toBeCloseTo(6);
        animation.update(0.5);
        expect(root.x).toBe(2);
    });
    it('supports additive translation and shortest-arc quaternion layers', () => {
        const node = new Node({ name: 'pet', x: 2 });
        const animation = mixer(node);
        animation.addLayer({ name: 'base', motions: [clip('base', 10)] }).play('base');
        animation
            .addLayer({
                name: 'breathing',
                mode: 'additive',
                weight: 0.5,
                motions: [clip('breathe', 4)]
            })
            .play('breathe');
        animation.update(0);
        expect(node.x).toBe(11);
        const rotation = new AnimationClip({
            name: 'turn',
            tracks: [
                new AnimationTrack({
                    target: 'pet',
                    property: 'rotation',
                    times: [0],
                    values: [0, 1, 0, 0]
                })
            ]
        });
        animation
            .addLayer({ name: 'turn', mode: 'additive', weight: 0.5, motions: [rotation] })
            .play('turn');
        animation.update(0);
        expect(Math.abs(node.quaternion.y)).toBeCloseTo(Math.SQRT1_2);
        expect(Math.abs(node.quaternion.w)).toBeCloseTo(Math.SQRT1_2);
    });
    it('aligns the lower quaternion hemisphere when fading a sparse upper layer', () => {
        const root = new Node({ name: 'pet' });
        const rotation = new AnimationClip({
            name: 'turn',
            tracks: [
                new AnimationTrack({
                    target: 'pet',
                    property: 'rotation',
                    times: [0],
                    values: [0, Math.sin(Math.PI / 3), 0, Math.cos(Math.PI / 3)]
                })
            ]
        });
        const animation = mixer(root);
        animation.addLayer({ name: 'one', motions: [rotation] }).play('turn');
        animation.addLayer({ name: 'two', mode: 'additive', motions: [rotation] }).play('turn');
        animation.update(0);
        const expected = Array.from(root.quaternion.elements);
        const upper = animation.addLayer({
            name: 'upper',
            motions: [
                new AnimationClip({
                    name: 'same',
                    tracks: [
                        new AnimationTrack({
                            target: 'pet',
                            property: 'rotation',
                            times: [0],
                            values: expected
                        })
                    ]
                })
            ]
        });
        upper.play('same', { fade: 1 });
        animation.update(0.5);
        const actual = root.quaternion.elements;
        const dot = expected.reduce((sum, value, i) => sum + value * (actual[i] ?? 0), 0);
        expect(Math.abs(dot)).toBeCloseTo(1);
    });
    it('keeps cloned character clocks and reference poses independent', () => {
        const root = new Node({ name: 'pet', x: 2 });
        const animation = mixer(root, [clip('walk', 10)]);
        animation.play();
        animation.update(0.25);
        const second = new Node({ name: 'pet', x: 10 });
        const clone = animation.clone(second);
        owned.push(clone);
        clone.stop(true);
        expect(second.x).toBe(2);
        expect(root.x).toBe(10);
        animation.update(0.25);
        expect(second.x).toBe(2);
    });
    it('clones a morph-mesh root only after its geometry is initialized', () => {
        const geometry = new MorphGeometry({ weights: [0] });
        const mesh = new Mesh({ name: 'pet', geometry });
        const face = new AnimationClip({
            name: 'face',
            tracks: [
                new AnimationTrack({
                    target: 'pet',
                    property: 'weights',
                    components: 1,
                    times: [0, 1],
                    values: [0, 1]
                })
            ]
        });
        const animation = mixer(mesh, [face]);
        mesh.setAnim(animation);
        animation.play();
        animation.update(0.25);
        const cloned = mesh.clone();
        const copy = cloned.anim;
        if (!copy) throw new Error('Clone animation missing');
        owned.push(copy);
        copy.update(0.25);
        expect(cloned.geometry).not.toBe(mesh.geometry);
        expect((cloned.geometry as MorphGeometry).weights[0]).toBeCloseTo(0.5);
        expect(geometry.weights[0]).toBeCloseTo(0.25);
    });
    it('copies an interrupted crossfade without sharing its mutable weights', () => {
        const node = new Node({ name: 'pet' });
        const animation = mixer(node, [clip('idle', 0), clip('run', 10)]);
        animation.play('idle');
        animation.play('run', { fade: 1 });
        animation.update(0.25);
        const target = new Node({ name: 'pet' });
        const copy = animation.clone(target);
        owned.push(copy);
        copy.update(0);
        expect(target.x).toBeCloseTo(2.5);
        copy.update(0.25);
        expect(target.x).toBeCloseTo(5);
        expect(node.x).toBeCloseTo(2.5);
    });
    it('writes each property once and reuses numeric binding storage in steady state', () => {
        const node = new Node({ name: 'pet' });
        const write = vi.fn();
        const values: Float32Array[] = [];
        const custom = new AnimationClip({
            name: 'custom',
            tracks: [
                new AnimationTrack({
                    target: 'pet',
                    property: 'custom:value',
                    components: 1,
                    times: [0, 1],
                    values: [0, 1]
                })
            ]
        });
        const animation = new Animation({
            rootNode: node,
            resolveBinding: () => ({
                reference: [0],
                write: value => {
                    write();
                    values.push(value);
                }
            })
        });
        owned.push(animation);
        animation.addLayer({ name: 'one', motions: [custom] }).play('custom');
        animation.addLayer({ name: 'two', motions: [custom], weight: 0.5 }).play('custom');
        for (let i = 0; i < 100; i++) animation.update(0.01);
        expect(write).toHaveBeenCalledTimes(100);
        expect(new Set(values).size).toBe(1);
    });
    it('blends morph weights before ranking, preserves negative weights, and supports one target', () => {
        const geometry = new MorphGeometry({ weights: [0, 0] });
        const mesh = new Mesh({ name: 'pet', geometry });
        const morph = new AnimationClip({
            name: 'face',
            tracks: [
                new AnimationTrack({
                    target: 'pet',
                    property: 'weights',
                    components: 2,
                    times: [0],
                    values: [-0.8, 0.3]
                })
            ]
        });
        const animation = mixer(mesh, [morph]);
        animation.play();
        animation.update(0);
        expect(Array.from(geometry.weights)).toEqual([expect.closeTo(-0.8), expect.closeTo(0.3)]);
        const one = new Mesh({ name: 'pet', geometry: new MorphGeometry() });
        const single = new AnimationClip({
            name: 'one',
            tracks: [
                new AnimationTrack({
                    target: 'pet',
                    property: 'weights',
                    components: 1,
                    times: [0],
                    values: [0.5]
                })
            ]
        });
        const singleMixer = mixer(one, [single]);
        singleMixer.play();
        singleMixer.update(0);
        expect(Array.from((one.geometry as MorphGeometry).weights)).toEqual([0.5]);
    });
    it('reports marker crossings after writeback and completes a one-shot once', () => {
        const root = new Node({ name: 'pet' });
        const events: AnimationEvent[] = [];
        const attack = new AnimationClip({
            name: 'attack',
            tracks: clip('source', 5).tracks,
            markers: [{ name: 'spark', time: 0.5 }]
        });
        const animation = mixer(root);
        const layer = animation.addLayer({
            name: 'action',
            motions: [attack],
            onEvent: event => {
                expect(root.x).toBe(5);
                events.push(event);
            }
        });
        layer.play('attack', { loop: false });
        layer.playbackRate = 2;
        animation.update(0.25);
        expect(events.map(event => event.name)).toEqual(['spark']);
        expect(layer.finished).toBe(false);
        animation.update(1);
        expect(layer.finished).toBe(true);
        animation.update(1);
        expect(events.map(event => event.type)).toEqual(['marker', 'finished']);
        layer.play('attack', { loop: false });
        expect(layer.finished).toBe(false);
    });
    it('coalesces large-delta marker crossings and preserves loop overshoot', () => {
        const root = new Node({ name: 'pet' });
        const events: AnimationEvent[] = [];
        const walk = new AnimationClip({
            name: 'walk',
            tracks: clip('source', 0).tracks,
            markers: [{ name: 'foot', time: 0.25 }]
        });
        const animation = mixer(root);
        const layer = animation.addLayer({
            name: 'base',
            motions: [walk],
            onEvent: event => events.push(event)
        });
        layer.play('walk');
        animation.update(3.5);
        expect(events[0]?.count).toBe(4);
        expect(layer.normalizedTime).toBe(3.5);
    });
    it('does not re-tick a character restarted by a completion callback', () => {
        const root = new Node({ name: 'pet' });
        const animation = mixer(root);
        let count = 0;
        const layer = animation.addLayer({
            name: 'one',
            motions: [clip('happy', 1)],
            onEvent: () => {
                count++;
                animation.stop();
                layer.play('happy', { loop: false });
                animation.resume();
            }
        });
        layer.play('happy', { loop: false });
        animation.resume();
        Animation.tick(1000);
        expect(count).toBe(1);
    });
    it('rejects invalid inputs and binding conflicts without corrupting an existing mixer', () => {
        const node = new Node({ name: 'pet' });
        const animation = mixer(node, [clip('idle', 1)]);
        animation.play();
        expect(() =>
            animation.addLayer({ name: 'bad', motions: [clip('bad', 1, 1, 'missing')] })
        ).toThrow('Missing animation target');
        expect(() => {
            animation.update(NaN);
        }).toThrow();
        expect(() => {
            animation.timeScale = -1;
        }).toThrow();
        expect(() => animation.play('missing')).toThrow();
        animation.update(0);
        expect(node.x).toBe(1);
        animation.destroy();
        expect(() => {
            animation.update(0);
        }).toThrow('destroyed');
    });
});

describe('AnimationTrack immutable sampling', () => {
    it('samples linear, step, boundaries and nonzero source ranges', () => {
        const values = [1, 2, 3, 5, 6, 7];
        const track = new AnimationTrack({
            target: 'pet',
            property: 'translation',
            times: [1, 3],
            values
        });
        values[0] = 99;
        const out = new Float32Array(3);
        track.sample(2, out);
        expect(Array.from(out)).toEqual([3, 4, 5]);
        track.sample(-1, out);
        expect(out[0]).toBe(1);
        track.sample(4, out);
        expect(out[0]).toBe(5);
        const step = new AnimationTrack({
            target: 'pet',
            property: 'translation',
            interpolation: 'STEP',
            times: [1, 3],
            values: [1, 2, 3, 5, 6, 7]
        });
        step.sample(2.9, out);
        expect(out[0]).toBe(1);
        step.sample(3, out);
        expect(out[0]).toBe(5);
    });
    it('scales cubic tangents by interval and clamps endpoints', () => {
        const track = new AnimationTrack({
            target: 'pet',
            property: 'custom:value',
            components: 1,
            interpolation: 'CUBICSPLINE',
            times: [0, 2],
            values: [0, 0, 2, 0, 1, 0]
        });
        const out = new Float32Array(1);
        track.sample(1, out);
        expect(out[0]).toBe(1);
        track.sample(5, out);
        expect(out[0]).toBe(1);
    });
    it('normalizes cubic rotations and takes the shortest linear rotation arc without mutating input', () => {
        const q = new Quaternion(0, 0, 0, 1);
        const track = new AnimationTrack({
            target: 'pet',
            property: 'rotation',
            times: [0, 1],
            values: [0, 0, 0, 1, 0, 0, 0, -1]
        });
        const out = new Float32Array(4);
        track.sample(0.5, out);
        expect(Math.abs(out[3] ?? 0)).toBe(1);
        expect(q.w).toBe(1);
        const cubic = new AnimationTrack({
            target: 'pet',
            property: 'rotation',
            interpolation: 'CUBICSPLINE',
            times: [0, 1],
            values: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]
        });
        cubic.sample(0.5, out);
        expect(Math.hypot(...out)).toBeCloseTo(1);
    });
    it('rejects malformed assets at construction', () => {
        expect(
            () =>
                new AnimationTrack({
                    target: 'x',
                    property: 'translation',
                    times: [0, 0],
                    values: [0, 0, 0, 0, 0, 0]
                })
        ).toThrow();
        expect(
            () =>
                new AnimationTrack({
                    target: 'x',
                    property: 'rotation',
                    times: [0],
                    values: [0, 0, 0, 0]
                })
        ).toThrow();
        expect(
            () =>
                new AnimationTrack({
                    target: 'x',
                    property: 'translation',
                    times: [0],
                    values: [Infinity, 0, 0]
                })
        ).toThrow();
        const track = clip('x', 0).tracks[0];
        if (!track) throw new Error('Fixture missing');
        expect(() => new AnimationClip({ name: 'duplicate', tracks: [track, track] })).toThrow();
    });
});
