import './timeline.css';
import {
    ANIMATION_PROPERTIES,
    createClip,
    evaluateClip,
    normalizeClipTime,
    validateClip,
    validateClipTargets,
    type AnimationClip,
    type AnimationKey,
    type AnimationProperty,
    type AnimationTrack,
    type AnimationTransforms
} from './animation';
import type { SceneDocument } from './scene';

export interface TimelineOptions {
    getScene: () => SceneDocument;
    getSceneId: () => string;
    getClips: () => readonly AnimationClip[];
    getSelected: () => string | null;
    onChangeClip: (clip: AnimationClip) => void | Promise<void>;
    onDeleteClip: (id: string) => void | Promise<void>;
    onPreview: (transforms: AnimationTransforms, time: number) => void;
    onStop: () => void;
    onError?: (message: string) => void;
}

interface SelectedKey {
    trackId: string;
    time: number;
}

const LABEL_WIDTH = 170;
const MAX_RENDERED_KEYS = 2_000;

function escapeHtml(value: string): string {
    return value.replace(
        /[&<>"']/gu,
        character =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
            character
    );
}

function inputNumber(value: number): string {
    return String(Math.round(value * 1_000_000) / 1_000_000);
}

function command(action: string, label: string, title = label, disabled = false): string {
    return `<button type="button" data-timeline-action="${action}" aria-label="${title}" title="${title}" ${disabled ? 'disabled' : ''}>${label}</button>`;
}

/** Live clip authoring and preview. Authored scene transforms are never changed by playback. */
export class Timeline {
    private readonly root = document.createElement('section');
    private readonly controller = new AbortController();
    private readonly observer: ResizeObserver;
    private selectedClipId: string | null = null;
    private selectedKey: SelectedKey | null = null;
    private channel: AnimationProperty = 'position.x';
    private currentTime = 0;
    private pixelsPerSecond = 100;
    private snap = true;
    private playing = false;
    private previewActive = false;
    private busy = false;
    private destroyed = false;
    private frame = 0;
    private lastTick = 0;
    private sceneId = '';
    private message = '';
    private scrub: { pointer: number; originalTime: number; wasPreview: boolean } | null = null;

    constructor(
        host: HTMLElement,
        private readonly options: TimelineOptions
    ) {
        this.root.className = 'editor-timeline';
        this.root.setAttribute('aria-label', 'Animation timeline');
        this.root.tabIndex = 0;
        host.append(this.root);
        const signal = this.controller.signal;
        this.root.addEventListener('click', this.handleClick, { signal });
        this.root.addEventListener('change', this.handleChange, { signal });
        this.root.addEventListener('keydown', this.handleKeyDown, { signal, capture: true });
        this.root.addEventListener('pointerdown', this.handlePointerDown, { signal });
        this.root.addEventListener('pointermove', this.handlePointerMove, { signal });
        this.root.addEventListener('pointerup', this.handlePointerUp, { signal });
        this.root.addEventListener('pointercancel', this.handlePointerCancel, { signal });
        this.root.addEventListener('lostpointercapture', this.handlePointerCancel, { signal });
        this.root.addEventListener(
            'scroll',
            event => {
                if (
                    event.target instanceof HTMLElement &&
                    event.target.classList.contains('timeline-scroll')
                )
                    this.renderTracks();
            },
            { signal, capture: true }
        );
        document.addEventListener(
            'visibilitychange',
            () => {
                if (document.hidden) this.pause();
            },
            { signal }
        );
        window.addEventListener(
            'pagehide',
            event => {
                if (event.persisted) this.pause();
                else this.destroy();
            },
            { signal }
        );
        this.observer = new ResizeObserver(() => {
            this.renderTracks();
        });
        this.observer.observe(this.root);
        this.render();
    }

    /** Refresh after project, scene, selection or history changes. */
    render(): void {
        if (this.destroyed || this.busy) return;
        const sceneId = this.options.getSceneId();
        if (this.sceneId !== sceneId) {
            this.stop();
            this.sceneId = sceneId;
            this.selectedClipId = null;
            this.selectedKey = null;
        }
        const clips = this.clips();
        if (!clips.some(clip => clip.id === this.selectedClipId)) {
            this.stop();
            this.selectedClipId = clips[0]?.id ?? null;
            this.selectedKey = null;
        }
        const clip = this.currentClip();
        if (clip) this.currentTime = Math.min(this.currentTime, clip.duration);
        const selected = this.options.getSelected();
        const node = selected ? this.options.getScene().nodes[selected] : undefined;
        const previousScroll = this.root.querySelector<HTMLElement>('.timeline-scroll');
        const scrollLeft = previousScroll?.scrollLeft ?? 0;
        const scrollTop = previousScroll?.scrollTop ?? 0;
        const focused =
            document.activeElement instanceof HTMLElement &&
            this.root.contains(document.activeElement)
                ? document.activeElement
                : null;
        const focusField = focused?.dataset['timelineField'];
        const focusAction = focused?.dataset['timelineAction'];
        const focusKeyTrack = focused?.dataset['timelineKeyTrack'];
        const focusKeyTime = focused?.dataset['timelineKey'];
        this.root.innerHTML = `
            <div class="timeline-toolbar">
                <strong>Animation</strong>
                <select data-timeline-field="clip" aria-label="Animation clip" ${clips.length ? '' : 'disabled'}>
                    ${clips.length ? clips.map(item => `<option value="${item.id}" ${clip?.id === item.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('') : '<option>No animation clips</option>'}
                </select>
                ${command('new', '+ Clip', 'Create animation clip')}
                ${command('delete-clip', 'Delete', 'Delete animation clip', !clip)}
                <span class="timeline-divider"></span>
                ${command('first', '⏮', 'First frame', !clip)}
                ${command('play', this.playing ? 'Pause' : 'Play', this.playing ? 'Pause animation' : 'Play animation', !clip)}
                ${command('stop', 'Stop', 'Stop animation and restore authored transforms', !clip)}
                <label class="timeline-time-label"><input data-timeline-field="time" type="number" min="0" max="${inputNumber(clip?.duration ?? 0)}" step="${inputNumber(1 / (clip?.fps ?? 30))}" value="${inputNumber(this.currentTime)}" aria-label="Animation time in seconds" ${clip ? '' : 'disabled'}/>s</label>
                <span class="timeline-clock" data-timeline-clock></span>
                <label class="timeline-snap"><input type="checkbox" data-timeline-field="snap" ${this.snap ? 'checked' : ''}/>Snap</label>
                ${command('zoom-out', '−', 'Zoom timeline out', !clip)}${command('zoom-in', '+', 'Zoom timeline in', !clip)}
            </div>
            ${
                clip
                    ? `<div class="timeline-settings">
                <input data-timeline-field="name" aria-label="Animation name" maxlength="120" value="${escapeHtml(clip.name)}"/>
                <label>Duration <input type="number" data-timeline-field="duration" aria-label="Animation duration" min="0.004167" max="86400" step="0.1" value="${inputNumber(clip.duration)}"/>s</label>
                <label>FPS <input type="number" data-timeline-field="fps" aria-label="Animation frame rate" min="1" max="240" step="1" value="${String(clip.fps)}"/></label>
                <label><input type="checkbox" data-timeline-field="loop" ${clip.loop ? 'checked' : ''}/>Loop</label>
                <span class="timeline-selected-object" title="${escapeHtml(node?.name ?? '')}">${escapeHtml(node?.name ?? 'Select an object to add keys')}</span>
                <select data-timeline-field="channel" aria-label="Animation channel">${ANIMATION_PROPERTIES.map(property => `<option value="${property}" ${this.channel === property ? 'selected' : ''}>${property}</option>`).join('')}</select>
                ${command('add-key', '◆ Set key', 'Set keyframe from authored transform at current time', !node)}
            </div>`
                    : ''
            }
            <div class="timeline-scroll" tabindex="0" aria-label="Animation tracks. Scrub the ruler to preview.">
                ${
                    clip
                        ? `<div class="timeline-sheet" style="width:${String(LABEL_WIDTH + Math.max(480, clip.duration * this.pixelsPerSecond))}px;--timeline-label-width:${String(LABEL_WIDTH)}px;--timeline-grid:${String(this.pixelsPerSecond)}px">
                    <div class="timeline-ruler"><div class="timeline-track-label">Object / channel</div><div class="timeline-ruler-lane" data-timeline-scrub></div></div>
                    ${clip.tracks.length ? clip.tracks.map(track => `<div class="timeline-track-row"><div class="timeline-track-label" title="${escapeHtml(this.trackLabel(track))}">${escapeHtml(this.trackLabel(track))}</div><div class="timeline-track-lane" data-timeline-track="${track.id}" data-timeline-scrub></div></div>`).join('') : '<p class="timeline-empty-track">Select an object, choose a transform channel and set a keyframe.</p>'}
                    <div class="timeline-playhead" aria-hidden="true"></div>
                </div>`
                        : '<div class="timeline-empty">Create a clip to animate object transforms. Clips stay in your project; playback leaves authored transforms unchanged.</div>'
                }
            </div>
            <div class="timeline-key-editor">${this.keyEditor(clip)}</div>
            <div class="timeline-message" role="status" aria-live="polite">${escapeHtml(this.message)}</div>`;
        const scroll = this.root.querySelector<HTMLElement>('.timeline-scroll');
        if (scroll) {
            scroll.scrollLeft = scrollLeft;
            scroll.scrollTop = scrollTop;
        }
        this.renderTracks();
        this.renderTime();
        if (focused) {
            const selector = focusField
                ? `[data-timeline-field="${focusField}"]`
                : focusAction
                  ? `[data-timeline-action="${focusAction}"]`
                  : focusKeyTrack && focusKeyTime
                    ? `[data-timeline-key-track="${focusKeyTrack}"][data-timeline-key="${focusKeyTime}"]`
                    : '.timeline-scroll';
            const target = this.root.querySelector<HTMLElement>(selector);
            if (target && !(target instanceof HTMLButtonElement && target.disabled))
                target.focus({ preventScroll: true });
            else this.root.focus({ preventScroll: true });
        }
    }

    /** End preview and release control of transforms back to the authored scene. */
    /** Restore authored poses while keeping the playhead for property edits and key insertion. */
    suspend(): void {
        this.pause();
        if (this.previewActive) {
            this.previewActive = false;
            this.options.onStop();
        }
        this.renderTime();
    }

    stop(): void {
        this.pause();
        this.currentTime = 0;
        if (this.previewActive) {
            this.previewActive = false;
            this.options.onStop();
        }
        this.renderTime();
    }

    destroy(): void {
        if (this.destroyed) return;
        this.stop();
        this.destroyed = true;
        this.observer.disconnect();
        this.controller.abort();
        this.root.remove();
    }

    private clips(): readonly AnimationClip[] {
        const sceneId = this.options.getSceneId();
        return this.options.getClips().filter(clip => clip.sceneId === sceneId);
    }

    private currentClip(): AnimationClip | undefined {
        return this.clips().find(clip => clip.id === this.selectedClipId);
    }

    private currentKey(
        clip = this.currentClip()
    ): { track: AnimationTrack; key: AnimationKey } | undefined {
        const track = clip?.tracks.find(item => item.id === this.selectedKey?.trackId);
        const key = track?.keys.find(item => item.time === this.selectedKey?.time);
        return track && key ? { track, key } : undefined;
    }

    private trackLabel(track: AnimationTrack): string {
        return `${this.options.getScene().nodes[track.nodeId]?.name ?? track.nodeId} · ${track.property}`;
    }

    private keyEditor(clip: AnimationClip | undefined): string {
        const selected = this.currentKey(clip);
        if (!selected)
            return '<span>Select a diamond to edit its time, value and outgoing interpolation.</span>';
        return `<strong>${escapeHtml(this.trackLabel(selected.track))}</strong>
            <label>Time <input data-timeline-field="key-time" type="number" aria-label="Keyframe time" min="0" max="${inputNumber(clip?.duration ?? 0)}" step="${inputNumber(1 / (clip?.fps ?? 30))}" value="${inputNumber(selected.key.time)}"/></label>
            <label>Value <input data-timeline-field="key-value" type="number" aria-label="Keyframe value" step="0.1" value="${inputNumber(selected.key.value)}"/></label>
            <select data-timeline-field="interpolation" aria-label="Keyframe interpolation">${(['linear', 'step', 'smooth'] as const).map(interpolation => `<option value="${interpolation}" ${selected.key.interpolation === interpolation ? 'selected' : ''}>${interpolation}</option>`).join('')}</select>
            ${command('delete-key', 'Remove key', 'Remove selected keyframe')}`;
    }

    private renderTracks(): void {
        if (this.destroyed) return;
        const clip = this.currentClip();
        const scroll = this.root.querySelector<HTMLElement>('.timeline-scroll');
        const ruler = this.root.querySelector<HTMLElement>('.timeline-ruler-lane');
        if (!clip || !scroll || !ruler) return;
        const start = Math.max(0, (scroll.scrollLeft - 20) / this.pixelsPerSecond);
        const end = Math.min(
            clip.duration,
            (scroll.scrollLeft + scroll.clientWidth + 20) / this.pixelsPerSecond
        );
        let majorStep = 1 / clip.fps;
        while (majorStep * this.pixelsPerSecond < 65) majorStep *= 2;
        const labels: string[] = [];
        for (
            let time = Math.floor(start / majorStep) * majorStep;
            time <= end + majorStep;
            time += majorStep
        ) {
            if (time < 0 || time > clip.duration) continue;
            labels.push(
                `<span style="left:${String(time * this.pixelsPerSecond)}px">${inputNumber(time)}s</span>`
            );
        }
        ruler.innerHTML = labels.join('');
        let rendered = 0;
        let dense = false;
        for (const lane of this.root.querySelectorAll<HTMLElement>('[data-timeline-track]')) {
            const track = clip.tracks.find(item => item.id === lane.dataset['timelineTrack']);
            if (!track) continue;
            const markers: string[] = [];
            for (const key of track.keys) {
                if (key.time < start || key.time > end) continue;
                if (++rendered > MAX_RENDERED_KEYS) {
                    dense = true;
                    continue;
                }
                const selected =
                    this.selectedKey?.trackId === track.id && this.selectedKey.time === key.time;
                markers.push(
                    `<button type="button" class="timeline-key ${selected ? 'selected' : ''}" data-timeline-key="${String(key.time)}" data-timeline-key-track="${track.id}" style="left:${String(key.time * this.pixelsPerSecond)}px" aria-label="${escapeHtml(this.trackLabel(track))} key at ${inputNumber(key.time)} seconds, value ${inputNumber(key.value)}" aria-pressed="${String(selected)}" title="${inputNumber(key.time)}s · ${inputNumber(key.value)} · ${key.interpolation}">◆</button>`
                );
            }
            lane.innerHTML = markers.join('');
        }
        const status = this.root.querySelector<HTMLElement>('.timeline-message');
        if (status)
            status.textContent = dense
                ? 'Dense key range: zoom in to inspect more keys.'
                : this.message;
    }

    private renderTime(): void {
        const clip = this.currentClip();
        const playhead = this.root.querySelector<HTMLElement>('.timeline-playhead');
        if (playhead)
            playhead.style.left = `${String(LABEL_WIDTH + this.currentTime * this.pixelsPerSecond)}px`;
        const input = this.root.querySelector<HTMLInputElement>('[data-timeline-field="time"]');
        if (input && input !== document.activeElement) input.value = inputNumber(this.currentTime);
        const clock = this.root.querySelector<HTMLElement>('[data-timeline-clock]');
        if (clock)
            clock.textContent = clip
                ? `Frame ${String(Math.round(this.currentTime * clip.fps))} / ${String(Math.round(clip.duration * clip.fps))}`
                : '';
        const button = this.root.querySelector<HTMLButtonElement>('[data-timeline-action="play"]');
        if (button) {
            button.textContent = this.playing ? 'Pause' : 'Play';
            button.setAttribute('aria-label', this.playing ? 'Pause animation' : 'Play animation');
            button.setAttribute('aria-pressed', String(this.playing));
        }
    }

    private seek(time: number, snap = this.snap): void {
        const clip = this.currentClip();
        if (!clip) return;
        this.currentTime = normalizeClipTime(clip, time, { loop: false, snapToFrame: snap });
        const transforms = evaluateClip(clip, this.options.getScene(), this.currentTime, {
            loop: false
        });
        this.previewActive = true;
        this.options.onPreview(transforms, this.currentTime);
        this.renderTime();
    }

    private play(): void {
        const clip = this.currentClip();
        if (!clip) return;
        validateClipTargets(clip, this.options.getScene());
        if (this.currentTime >= clip.duration) this.currentTime = 0;
        this.playing = true;
        this.lastTick = performance.now();
        this.seek(this.currentTime, false);
        this.renderTime();
        this.frame = requestAnimationFrame(this.tick);
    }

    private pause(): void {
        this.playing = false;
        cancelAnimationFrame(this.frame);
        this.frame = 0;
        this.renderTime();
    }

    private readonly tick = (now: number): void => {
        if (!this.playing || this.destroyed) return;
        try {
            const clip = this.currentClip();
            if (!clip) {
                this.stop();
                return;
            }
            const elapsed = Math.max(0, (now - this.lastTick) / 1000);
            this.lastTick = now;
            const next = this.currentTime + elapsed;
            this.seek(normalizeClipTime(clip, next), false);
            if (!clip.loop && next >= clip.duration) this.pause();
            else this.frame = requestAnimationFrame(this.tick);
        } catch (cause) {
            this.stop();
            this.report(cause);
        }
    };

    private async editClip(change: (clip: AnimationClip) => void): Promise<void> {
        const clip = this.currentClip();
        if (!clip) return;
        this.pause();
        const next = validateClip(clip);
        change(next);
        const validated = validateClip(next);
        validateClipTargets(validated, this.options.getScene());
        await this.options.onChangeClip(validated);
        if (this.previewActive && validated.sceneId === this.options.getSceneId())
            this.seek(Math.min(this.currentTime, validated.duration), false);
    }

    private async addKey(): Promise<void> {
        const nodeId = this.options.getSelected();
        const node = nodeId ? this.options.getScene().nodes[nodeId] : undefined;
        if (!node || !nodeId) throw new Error('Select an object before inserting a keyframe.');
        const [kind, axis] = this.channel.split('.');
        if (
            (kind !== 'position' && kind !== 'rotation' && kind !== 'scale') ||
            (axis !== 'x' && axis !== 'y' && axis !== 'z')
        )
            return;
        const value = node.transform[kind][axis];
        await this.editClip(clip => {
            const time = normalizeClipTime(clip, this.currentTime, {
                loop: false,
                snapToFrame: this.snap
            });
            let track = clip.tracks.find(
                item => item.nodeId === nodeId && item.property === this.channel
            );
            if (!track) {
                track = {
                    id: `track-${crypto.randomUUID()}`,
                    nodeId,
                    property: this.channel,
                    keys: []
                };
                clip.tracks.push(track);
            }
            const key = track.keys.find(item => item.time === time);
            if (key) key.value = value;
            else track.keys.push({ time, value, interpolation: 'linear' });
            this.selectedKey = { trackId: track.id, time };
        });
        this.message = 'Keyframe stored from the authored transform.';
    }

    private async removeKey(): Promise<void> {
        const selected = this.selectedKey;
        if (!selected) return;
        await this.editClip(clip => {
            const track = clip.tracks.find(item => item.id === selected.trackId);
            if (!track) return;
            track.keys = track.keys.filter(key => key.time !== selected.time);
            if (!track.keys.length) clip.tracks = clip.tracks.filter(item => item.id !== track.id);
        });
        this.selectedKey = null;
        this.message = 'Keyframe removed.';
    }

    private async action(name: string): Promise<void> {
        switch (name) {
            case 'new': {
                this.stop();
                const clip = createClip(
                    `clip-${crypto.randomUUID()}`,
                    this.options.getSceneId(),
                    `Animation ${String(this.clips().length + 1)}`
                );
                await this.options.onChangeClip(clip);
                this.selectedClipId = clip.id;
                this.selectedKey = null;
                this.message = 'Clip created. Select an object and set a keyframe.';
                break;
            }
            case 'delete-clip': {
                const clip = this.currentClip();
                if (!clip) return;
                this.stop();
                await this.options.onDeleteClip(clip.id);
                this.selectedClipId = null;
                this.selectedKey = null;
                this.message = 'Clip deleted. Project undo can restore it.';
                break;
            }
            case 'play':
                if (this.playing) this.pause();
                else this.play();
                break;
            case 'stop':
                this.stop();
                break;
            case 'first':
                this.pause();
                this.seek(0);
                break;
            case 'add-key':
                await this.addKey();
                break;
            case 'delete-key':
                await this.removeKey();
                break;
            case 'zoom-in':
                this.pixelsPerSecond = Math.min(2000, this.pixelsPerSecond * 1.5);
                break;
            case 'zoom-out':
                this.pixelsPerSecond = Math.max(4, this.pixelsPerSecond / 1.5);
                break;
        }
    }

    private run(action: () => void | Promise<void>): void {
        if (this.busy || this.destroyed) return;
        const previousKey = this.selectedKey ? { ...this.selectedKey } : null;
        this.busy = true;
        this.root.setAttribute('aria-busy', 'true');
        void Promise.resolve()
            .then(action)
            .catch((cause: unknown) => {
                this.pause();
                this.selectedKey = previousKey;
                this.report(cause);
            })
            .finally(() => {
                this.busy = false;
                this.root.removeAttribute('aria-busy');
                this.render();
            });
    }

    private readonly handleClick = (event: MouseEvent): void => {
        if (!(event.target instanceof Element) || this.busy) return;
        const marker = event.target.closest<HTMLElement>('[data-timeline-key]');
        if (marker) {
            const trackId = marker.dataset['timelineKeyTrack'];
            const time = Number(marker.dataset['timelineKey']);
            if (!trackId || !Number.isFinite(time)) return;
            this.pause();
            this.selectedKey = { trackId, time };
            this.channel = this.currentKey()?.track.property ?? this.channel;
            try {
                this.seek(time, false);
                this.render();
                this.root
                    .querySelector<HTMLElement>(
                        `[data-timeline-key-track="${trackId}"][data-timeline-key="${String(time)}"]`
                    )
                    ?.focus({ preventScroll: true });
            } catch (cause) {
                this.report(cause);
            }
            return;
        }
        const button = event.target.closest<HTMLElement>('[data-timeline-action]');
        const action = button?.dataset['timelineAction'];
        if (action) this.run(() => this.action(action));
    };

    private readonly handleChange = (event: Event): void => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) return;
        const field = input.dataset['timelineField'];
        if (!field) return;
        const value = input.value;
        const checked = input instanceof HTMLInputElement && input.checked;
        this.run(async () => {
            if (field === 'clip') {
                this.stop();
                this.selectedClipId = value;
                this.selectedKey = null;
                return;
            }
            if (field === 'channel') {
                const property = ANIMATION_PROPERTIES.find(item => item === value);
                if (property) this.channel = property;
                return;
            }
            if (field === 'snap') {
                this.snap = checked;
                return;
            }
            if (field === 'time') {
                this.pause();
                this.seek(Number(value));
                return;
            }
            await this.editClip(clip => {
                if (field === 'name') clip.name = value.trim();
                else if (field === 'duration') {
                    const duration = Number(value);
                    if (clip.tracks.some(track => track.keys.some(key => key.time > duration)))
                        throw new Error(
                            'Move or remove keys beyond the new duration before shortening this clip.'
                        );
                    clip.duration = duration;
                } else if (field === 'fps') clip.fps = Number(value);
                else if (field === 'loop') clip.loop = checked;
                else {
                    const selected = this.currentKey(clip);
                    if (!selected) return;
                    if (field === 'key-time') {
                        const time = Number(value);
                        if (!Number.isFinite(time) || time < 0 || time > clip.duration)
                            throw new Error('Keyframe time must be within this clip.');
                        selected.key.time = normalizeClipTime(clip, time, {
                            loop: false,
                            snapToFrame: this.snap
                        });
                        this.selectedKey = { trackId: selected.track.id, time: selected.key.time };
                    } else if (field === 'key-value') selected.key.value = Number(value);
                    else if (field === 'interpolation') {
                        if (value !== 'linear' && value !== 'step' && value !== 'smooth')
                            throw new Error('Unsupported interpolation.');
                        selected.key.interpolation = value;
                    }
                }
            });
            this.message = 'Animation updated.';
        });
    };

    private readonly handleKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape' && this.scrub) {
            event.preventDefault();
            event.stopPropagation();
            this.cancelScrub();
            return;
        }
        if (event.target instanceof Element && event.target.closest('input,select,textarea'))
            return;
        if (event.code === 'Space' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            this.run(() => this.action('play'));
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            event.stopPropagation();
            this.run(() => this.removeKey());
        } else if (
            event.key === 'ArrowLeft' ||
            event.key === 'ArrowRight' ||
            event.key === 'Home' ||
            event.key === 'End'
        ) {
            const clip = this.currentClip();
            if (!clip) return;
            event.preventDefault();
            event.stopPropagation();
            this.pause();
            try {
                this.seek(
                    event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? clip.duration
                          : this.currentTime +
                            ((event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 10 : 1)) /
                                clip.fps
                );
            } catch (cause) {
                this.report(cause);
            }
        }
    };

    private timeAtPointer(event: PointerEvent): number {
        const sheet = this.root.querySelector<HTMLElement>('.timeline-sheet');
        if (!sheet) return 0;
        return (
            (event.clientX - sheet.getBoundingClientRect().left - LABEL_WIDTH) /
            this.pixelsPerSecond
        );
    }

    private readonly handlePointerDown = (event: PointerEvent): void => {
        if (
            event.button !== 0 ||
            this.busy ||
            !(event.target instanceof Element) ||
            event.target.closest('button') ||
            !event.target.closest('[data-timeline-scrub]')
        )
            return;
        event.preventDefault();
        this.root.focus({ preventScroll: true });
        this.pause();
        this.scrub = {
            pointer: event.pointerId,
            originalTime: this.currentTime,
            wasPreview: this.previewActive
        };
        this.root.setPointerCapture(event.pointerId);
        try {
            this.seek(this.timeAtPointer(event));
        } catch (cause) {
            this.cancelScrub();
            this.report(cause);
        }
    };

    private readonly handlePointerMove = (event: PointerEvent): void => {
        if (event.pointerId !== this.scrub?.pointer) return;
        try {
            this.seek(this.timeAtPointer(event));
        } catch (cause) {
            this.cancelScrub();
            this.report(cause);
        }
    };

    private readonly handlePointerUp = (event: PointerEvent): void => {
        if (event.pointerId !== this.scrub?.pointer) return;
        this.scrub = null;
        if (this.root.hasPointerCapture(event.pointerId))
            this.root.releasePointerCapture(event.pointerId);
    };

    private readonly handlePointerCancel = (event: PointerEvent): void => {
        if (event.pointerId === this.scrub?.pointer) this.cancelScrub();
    };

    private cancelScrub(): void {
        const scrub = this.scrub;
        if (!scrub) return;
        this.scrub = null;
        if (this.root.hasPointerCapture(scrub.pointer))
            this.root.releasePointerCapture(scrub.pointer);
        if (scrub.wasPreview) this.seek(scrub.originalTime, false);
        else {
            this.stop();
            this.currentTime = scrub.originalTime;
            this.renderTime();
        }
    }

    private report(cause: unknown): void {
        this.message = cause instanceof Error ? cause.message : String(cause);
        const element = this.root.querySelector<HTMLElement>('.timeline-message');
        if (element) element.textContent = this.message;
        this.options.onError?.(this.message);
    }
}
