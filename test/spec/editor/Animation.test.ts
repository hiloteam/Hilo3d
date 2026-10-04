import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
    createClip,
    evaluateClip,
    normalizeClipTime,
    validateClip,
    validateClipTargets,
    type AnimationClip,
    type AnimationInterpolation
} from '../../../editor/animation';
import { createDefaultScene } from '../../../editor/scene';
import { Timeline } from '../../../editor/timeline';

function clip(interpolation: AnimationInterpolation = 'linear'): AnimationClip {
    return validateClip({
        ...createClip('test-clip', 'main-scene', 'Motion study'),
        duration: 2,
        loop: false,
        tracks: [
            {
                id: 'move-x',
                nodeId: 'hero-sphere',
                property: 'position.x',
                keys: [
                    { time: 0, value: 0, interpolation },
                    { time: 2, value: 10, interpolation: 'linear' }
                ]
            }
        ]
    });
}

describe('editor animation clips', () => {
    it('sorts and detaches valid keys without rewriting authored values or identifiers', () => {
        const source = clip();
        source.tracks[0]?.keys.reverse();
        const result = validateClip(source);
        expect(result.tracks[0]?.keys.map(key => key.time)).toEqual([0, 2]);
        expect(source.tracks[0]?.keys.map(key => key.time)).toEqual([2, 0]);
        expect(result.id).toBe('test-clip');
        expect(result.tracks[0]).not.toBe(source.tracks[0]);
    });

    it('interpolates linear segments, holds endpoints and retains unkeyed authored channels', () => {
        const scene = createDefaultScene();
        const original = structuredClone(scene);
        const animation = clip();
        const before = evaluateClip(animation, scene, -4);
        const middle = evaluateClip(animation, scene, 1);
        const after = evaluateClip(animation, scene, 100);
        expect(before['hero-sphere']?.position.x).toBe(0);
        expect(middle['hero-sphere']?.position.x).toBe(5);
        expect(after['hero-sphere']?.position.x).toBe(10);
        expect(middle['hero-sphere']?.position.y).toBe(
            scene.nodes['hero-sphere']?.transform.position.y
        );
        expect(middle['hero-sphere']?.rotation).toEqual(
            scene.nodes['hero-sphere']?.transform.rotation
        );
        expect(Object.keys(middle)).toEqual(['hero-sphere']);
        const sampled = middle['hero-sphere'];
        if (!sampled) throw new Error('Expected animated sphere');
        sampled.position.y = 999;
        expect(scene).toEqual(original);
        expect(animation).toEqual(clip());
    });

    it('uses outgoing step segments and changes value exactly at the next key', () => {
        const animation = clip('step');
        animation.tracks[0]?.keys.splice(1, 0, { time: 1, value: 8, interpolation: 'step' });
        const scene = createDefaultScene();
        expect(evaluateClip(animation, scene, 0.999)['hero-sphere']?.position.x).toBe(0);
        expect(evaluateClip(animation, scene, 1)['hero-sphere']?.position.x).toBe(8);
        expect(evaluateClip(animation, scene, 1.999)['hero-sphere']?.position.x).toBe(8);
        expect(evaluateClip(animation, scene, 2)['hero-sphere']?.position.x).toBe(10);
    });

    it('smoothly eases without overshooting and interpolates full Euler revolutions', () => {
        const scene = createDefaultScene();
        expect(evaluateClip(clip('smooth'), scene, 0.5)['hero-sphere']?.position.x).toBeCloseTo(
            1.5625
        );
        const rotation = clip();
        const track = rotation.tracks[0];
        if (!track) throw new Error('Expected track');
        track.property = 'rotation.y';
        track.keys = [
            { time: 0, value: 0, interpolation: 'linear' },
            { time: 2, value: 720, interpolation: 'linear' }
        ];
        expect(evaluateClip(rotation, scene, 1)['hero-sphere']?.rotation.y).toBe(360);
    });

    it('wraps looping time including negative time and permits explicit final-frame inspection', () => {
        const animation = clip();
        animation.loop = true;
        const scene = createDefaultScene();
        expect(normalizeClipTime(animation, 2)).toBe(0);
        expect(normalizeClipTime(animation, -0.5)).toBe(1.5);
        expect(evaluateClip(animation, scene, 2.5)['hero-sphere']?.position.x).toBe(2.5);
        expect(evaluateClip(animation, scene, 2, { loop: false })['hero-sphere']?.position.x).toBe(
            10
        );
        expect(Object.is(normalizeClipTime(animation, -2), -0)).toBe(false);
    });

    it('snaps to the nearest frame only when requested, including midpoint rounding', () => {
        const animation = clip();
        animation.fps = 10;
        animation.loop = true;
        expect(normalizeClipTime(animation, 0.15, { snapToFrame: true })).toBe(0.2);
        expect(normalizeClipTime(animation, 0.15)).toBe(0.15);
        expect(normalizeClipTime(animation, 1.99, { snapToFrame: true })).toBe(0);
        expect(normalizeClipTime(animation, 1.99, { snapToFrame: true, loop: false })).toBe(2);
    });

    it('merges multiple tracks on a node and leaves empty clips and empty tracks inert', () => {
        const scene = createDefaultScene();
        const animation = clip();
        animation.tracks.push({
            id: 'scale-z',
            nodeId: 'hero-sphere',
            property: 'scale.z',
            keys: [{ time: 0.5, value: 2, interpolation: 'linear' }]
        });
        const result = evaluateClip(animation, scene, 1);
        expect(result['hero-sphere']?.position.x).toBe(5);
        expect(result['hero-sphere']?.scale.z).toBe(2);
        expect(result['hero-sphere']?.scale.x).toBe(scene.nodes['hero-sphere']?.transform.scale.x);
        const empty = createClip('empty', 'main-scene');
        expect(evaluateClip(empty, scene, 1)).toEqual({});
        empty.tracks.push({
            id: 'empty-track',
            nodeId: 'hero-sphere',
            property: 'position.x',
            keys: []
        });
        expect(evaluateClip(empty, scene, 1)).toEqual({});
    });

    it('rejects duplicate key times, duplicate channels and duplicate track identities', () => {
        const duplicateTime = clip();
        duplicateTime.tracks[0]?.keys.push({ time: 0, value: 1, interpolation: 'linear' });
        expect(() => validateClip(duplicateTime)).toThrow('duplicate key time');
        const duplicateTrack = clip();
        const first = duplicateTrack.tracks[0];
        if (!first) throw new Error('Expected track');
        duplicateTrack.tracks.push(structuredClone(first));
        expect(() => validateClip(duplicateTrack)).toThrow('duplicate track identifier');
        duplicateTrack.tracks[1] = { ...structuredClone(first), id: 'another-track' };
        expect(() => validateClip(duplicateTrack)).toThrow('duplicate node/channel');
    });

    it('rejects malformed fields, nonfinite values, out-of-duration keys and unsupported channels', () => {
        expect(() => validateClip({ ...clip(), fps: 29.97 })).toThrow('whole-number');
        expect(() => validateClip({ ...clip(), duration: 0 })).toThrow('finite value');
        expect(() => validateClip({ ...clip(), executable: 'alert(1)' })).toThrow('unknown field');
        expect(() => validateClip({ ...clip(), loop: 'yes' })).toThrow('boolean');
        const invalid = clip();
        const track = invalid.tracks[0];
        if (!track) throw new Error('Expected track');
        track.keys = [{ time: 3, value: 1, interpolation: 'linear' }];
        expect(() => validateClip(invalid)).toThrow('finite value');
        track.keys = [{ time: 0, value: Infinity, interpolation: 'linear' }];
        expect(() => validateClip(invalid)).toThrow('finite value');
        track.property = 'scale.x';
        track.keys = [{ time: 0, value: 0, interpolation: 'linear' }];
        expect(() => validateClip(invalid)).toThrow('finite value');
        expect(() =>
            validateClip({ ...clip(), tracks: [{ ...track, property: 'material.opacity' }] })
        ).toThrow('position, rotation or scale');
        expect(() => normalizeClipTime(clip(), NaN)).toThrow('finite');
    });

    it('validates dangling node references separately and refuses unsafe sampled targets', () => {
        const animation = clip();
        const track = animation.tracks[0];
        if (!track) throw new Error('Expected track');
        track.nodeId = 'missing-node';
        expect(validateClip(animation).tracks[0]?.nodeId).toBe('missing-node');
        const scene = createDefaultScene();
        expect(() => {
            validateClipTargets(animation, scene);
        }).toThrow('missing node missing-node');
        expect(() => evaluateClip(animation, scene, 1)).toThrow('missing node missing-node');
    });
});

const timelines: Timeline[] = [];
const hosts: HTMLElement[] = [];

/** Drive only this fixture's external frame callbacks, independent of background iframe throttling. */
function animationFrames(): {
    advance(time: number): void;
    next(): FrameRequestCallback | undefined;
    pending(): number;
} {
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
        frames.set(++frameId, callback);
        return frameId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
        frames.delete(id);
    });
    return {
        advance(time: number): void {
            const callbacks = [...frames.values()];
            frames.clear();
            for (const callback of callbacks) callback(time);
        },
        next: (): FrameRequestCallback | undefined => [...frames.values()][0],
        pending: (): number => frames.size
    };
}

function timelineFixture(initial: AnimationClip[] = [clip()]): {
    host: HTMLElement;
    timeline: Timeline;
    scene: ReturnType<typeof createDefaultScene>;
    clips: AnimationClip[];
    preview: ReturnType<typeof vi.fn>;
    stopped: ReturnType<typeof vi.fn>;
    change: ReturnType<typeof vi.fn>;
} {
    const host = document.createElement('div');
    host.style.cssText = 'width:1050px;height:300px;position:relative;';
    document.body.append(host);
    hosts.push(host);
    const scene = createDefaultScene();
    const clips = initial.map(value => validateClip(value));
    const preview = vi.fn();
    const stopped = vi.fn();
    const change = vi.fn((value: AnimationClip): void => {
        const index = clips.findIndex(existing => existing.id === value.id);
        if (index < 0) clips.push(validateClip(value));
        else clips[index] = validateClip(value);
    });
    const timeline = new Timeline(host, {
        getScene: () => scene,
        getSceneId: () => 'main-scene',
        getClips: () => clips,
        getSelected: () => 'hero-sphere',
        onChangeClip: change,
        onDeleteClip: id => {
            const index = clips.findIndex(existing => existing.id === id);
            if (index >= 0) clips.splice(index, 1);
        },
        onPreview: preview,
        onStop: stopped
    });
    timelines.push(timeline);
    return { host, timeline, scene, clips, preview, stopped, change };
}

function timelineElement<T extends HTMLElement>(
    host: HTMLElement,
    selector: string,
    type?: new () => T
): T {
    const element = host.querySelector<T>(selector);
    if (!element || (type && !(element instanceof type)))
        throw new Error(`Missing timeline test element ${selector}`);
    return element;
}

async function timelineAction(host: HTMLElement, action: string): Promise<void> {
    timelineElement<HTMLButtonElement>(host, `[data-timeline-action="${action}"]`).click();
    await expect.poll(() => host.querySelector('[aria-busy="true"]')).toBeNull();
}

async function timelineField(host: HTMLElement, field: string, value: string): Promise<void> {
    const input = timelineElement<HTMLInputElement | HTMLSelectElement>(
        host,
        `[data-timeline-field="${field}"]`
    );
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await expect.poll(() => host.querySelector('[aria-busy="true"]')).toBeNull();
}

afterEach(() => {
    for (const timeline of timelines.splice(0)) timeline.destroy();
    for (const host of hosts.splice(0)) host.remove();
    vi.restoreAllMocks();
});

describe('editor timeline authoring', () => {
    it('scrubs the real ruler with browser pointer capture and focuses timeline keyboard controls', async () => {
        const { host, scene, preview, change } = timelineFixture();
        const ruler = timelineElement(host, '.timeline-ruler-lane');
        await userEvent.click(ruler, { position: { x: 100, y: 10 } });
        expect(timelineElement<HTMLInputElement>(host, '[data-timeline-field="time"]').value).toBe(
            '1'
        );
        expect(document.activeElement).toBe(timelineElement(host, '.editor-timeline'));
        expect(preview).toHaveBeenLastCalledWith(evaluateClip(clip(), scene, 1), 1);
        expect(change).not.toHaveBeenCalled();
        expect(scene.nodes['hero-sphere']?.transform.position.x).toBe(0);
    });

    it('creates a real clip and inserts the selected object authored transform at the current frame', async () => {
        const { host, scene, clips, change } = timelineFixture([]);
        await timelineAction(host, 'new');
        expect(clips).toHaveLength(1);
        expect(clips[0]?.sceneId).toBe('main-scene');
        const node = scene.nodes['hero-sphere'];
        if (!node) throw new Error('Expected authored sphere');
        node.transform.position.x = 7;
        await timelineField(host, 'time', '1');
        await timelineAction(host, 'add-key');
        expect(clips[0]?.tracks[0]?.nodeId).toBe('hero-sphere');
        expect(clips[0]?.tracks[0]?.keys).toEqual([{ time: 1, value: 7, interpolation: 'linear' }]);
        expect(change).toHaveBeenCalledTimes(2);
        expect(host.querySelectorAll('.timeline-key')).toHaveLength(1);
        expect(scene.nodes['hero-sphere']?.transform.position.x).toBe(7);
    });

    it('edits selected key time, value and interpolation, rejects duplicate time without losing the selection', async () => {
        const { host, clips, change } = timelineFixture();
        timelineElement<HTMLButtonElement>(host, '[data-timeline-key="2"]').click();
        await timelineField(host, 'key-value', '12');
        await timelineField(host, 'interpolation', 'smooth');
        await timelineField(host, 'key-time', '1.5');
        expect(clips[0]?.tracks[0]?.keys[1]).toEqual({
            time: 1.5,
            value: 12,
            interpolation: 'smooth'
        });
        expect(change).toHaveBeenCalledTimes(3);
        await timelineField(host, 'key-time', '0');
        expect(clips[0]?.tracks[0]?.keys[1]?.time).toBe(1.5);
        expect(
            timelineElement<HTMLInputElement>(host, '[data-timeline-field="key-time"]').value
        ).toBe('1.5');
        expect(timelineElement(host, '.timeline-message').textContent).toContain(
            'duplicate key time'
        );
        expect(change).toHaveBeenCalledTimes(3);
    });

    it('scrubs and plays detached preview transforms and restores authored state on stop', async () => {
        const frames = animationFrames();
        const { host, scene, preview, stopped, change } = timelineFixture();
        const authored = structuredClone(scene);
        const transform = scene.nodes['hero-sphere']?.transform;
        if (!transform) throw new Error('Expected authored sphere');
        await timelineField(host, 'time', '1');
        expect(preview).toHaveBeenLastCalledWith(
            { 'hero-sphere': { ...transform, position: { ...transform.position, x: 5 } } },
            1
        );
        expect(scene).toEqual(authored);
        await timelineAction(host, 'play');
        frames.advance(1200);
        expect(
            Number(timelineElement<HTMLInputElement>(host, '[data-timeline-field="time"]').value)
        ).toBe(1.2);
        expect(preview).toHaveBeenLastCalledWith(evaluateClip(clip(), scene, 1.2), 1.2);
        await timelineAction(host, 'play');
        const pausedAt = timelineElement<HTMLInputElement>(
            host,
            '[data-timeline-field="time"]'
        ).value;
        const previewsAtPause = preview.mock.calls.length;
        frames.advance(1600);
        expect(timelineElement<HTMLInputElement>(host, '[data-timeline-field="time"]').value).toBe(
            pausedAt
        );
        expect(preview).toHaveBeenCalledTimes(previewsAtPause);
        expect(frames.pending()).toBe(0);
        await timelineAction(host, 'stop');
        expect(stopped).toHaveBeenCalledOnce();
        expect(timelineElement<HTMLInputElement>(host, '[data-timeline-field="time"]').value).toBe(
            '0'
        );
        expect(scene).toEqual(authored);
        expect(change).not.toHaveBeenCalled();
    });

    it('removes keys and clips through project callbacks and protects keys when reducing duration', async () => {
        const { host, clips, change } = timelineFixture();
        await timelineField(host, 'duration', '1');
        expect(clips[0]?.duration).toBe(2);
        expect(change).not.toHaveBeenCalled();
        expect(timelineElement(host, '.timeline-message').textContent).toContain(
            'Move or remove keys'
        );
        timelineElement<HTMLButtonElement>(host, '[data-timeline-key="2"]').click();
        await timelineAction(host, 'delete-key');
        expect(clips[0]?.tracks[0]?.keys).toHaveLength(1);
        await timelineField(host, 'duration', '1');
        expect(clips[0]?.duration).toBe(1);
        await timelineAction(host, 'delete-clip');
        expect(clips).toHaveLength(0);
        expect(host.querySelector('.timeline-key')).toBeNull();
    });

    it('steps frames with keyboard without bubbling object-delete shortcuts to the editor', async () => {
        const { host, preview, clips } = timelineFixture();
        const root = timelineElement(host, '.editor-timeline');
        const bubbled = vi.fn();
        document.addEventListener('keydown', bubbled, { once: true });
        root.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
        );
        expect(preview).toHaveBeenLastCalledWith(expect.anything(), 1 / 30);
        expect(bubbled).not.toHaveBeenCalled();
        timelineElement<HTMLButtonElement>(host, '[data-timeline-key="0"]').click();
        root.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })
        );
        await expect.poll(() => host.querySelector('[aria-busy="true"]')).toBeNull();
        expect(clips[0]?.tracks[0]?.keys).toHaveLength(1);
        expect(bubbled).not.toHaveBeenCalled();
        document.removeEventListener('keydown', bubbled);
    });

    it('tears down active preview and does not emit frames after destroy', async () => {
        const frames = animationFrames();
        const { host, timeline, preview, stopped } = timelineFixture();
        await timelineAction(host, 'play');
        frames.advance(1200);
        expect(preview.mock.calls.length).toBeGreaterThan(1);
        const queuedCallback = frames.next();
        if (!queuedCallback) throw new Error('Playing timeline did not schedule another frame');
        timeline.destroy();
        const frameCount = preview.mock.calls.length;
        expect(frames.pending()).toBe(0);
        frames.advance(1600);
        queuedCallback(1600);
        expect(preview).toHaveBeenCalledTimes(frameCount);
        expect(stopped).toHaveBeenCalledOnce();
        expect(host.querySelector('.editor-timeline')).toBeNull();
    });
});
