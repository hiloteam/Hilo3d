import packageJson from '../package.json' with { type: 'json' };
import { createPlayerManifest, type PlayerManifest } from './player-manifest';
import { exportPlayerArchive } from './player-export';
import type { ProjectDocument } from './project';
import './publish-panel.css';

export interface PublishPanelOptions {
    getProject(): ProjectDocument;
    onNotify(message: string, error?: boolean): void;
}
function escape(value: string): string {
    return value.replace(
        /[&<>"']/gu,
        character =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
            character
    );
}

/** Export a static, self-contained experience without granting access to a hosting account. */
export class PublishPanel {
    private readonly dialog = document.createElement('dialog');
    private project: ProjectDocument | null = null;
    private settings: PlayerManifest | null = null;
    private pending: AbortController | null = null;
    private readonly downloads = new Map<string, number>();
    private destroyed = false;

    constructor(
        host: HTMLElement,
        private readonly options: PublishPanelOptions
    ) {
        this.dialog.id = 'publish-dialog';
        this.dialog.className = 'publish-dialog';
        this.dialog.setAttribute('aria-label', 'Publish website');
        host.append(this.dialog);
        this.dialog.addEventListener('click', this.click);
        this.dialog.addEventListener('change', this.change);
        this.dialog.addEventListener('close', this.cancel);
    }
    private isDestroyed(): boolean {
        return this.destroyed;
    }
    open(): void {
        if (this.destroyed || this.pending) return;
        this.project = structuredClone(this.options.getProject());
        this.settings = createPlayerManifest(this.project, packageJson.version);
        this.render();
        if (!this.dialog.open) this.dialog.showModal();
    }
    private render(): void {
        const project = this.project;
        const settings = this.settings;
        if (!project || !settings) return;
        const options = Object.entries(project.scenes)
            .map(
                ([id, scene]) =>
                    `<option value="${id}" ${id === settings.startSceneId ? 'selected' : ''}>${escape(scene.name)}</option>`
            )
            .join('');
        this.dialog.innerHTML = `<div class="dialog-heading"><strong>Publish a website</strong><button data-publish="close" aria-label="Close publish dialog">×</button></div>
            <div class="publish-body"><p>Package your scenes, scripts, physics, particles and audio as an independent web experience.</p>
            <label>Title<input name="title" aria-label="Website title" maxlength="120" value="${escape(settings.title)}" /></label>
            <label>First scene<select name="startSceneId" aria-label="Website first scene">${options}</select></label>
            <label class="publish-checkbox"><input type="checkbox" name="showControls" ${settings.showControls ? 'checked' : ''} />Show scene selector and playback controls</label>
            <h3>Scene playback</h3>${Object.entries(project.scenes)
                .map(([id, scene]) => {
                    const cameras = Object.entries(scene.nodes).filter(
                        ([, node]) => node.type === 'camera'
                    );
                    const clips = Object.values(project.clips).filter(clip => clip.sceneId === id);
                    return `<fieldset><legend>${escape(scene.name)}</legend><label>Camera<select data-scene="${id}" name="camera" aria-label="${escape(scene.name)} player camera"><option value="">Automatic framing</option>${cameras.map(([cameraId, node]) => `<option value="${cameraId}" ${settings.cameras[id] === cameraId ? 'selected' : ''}>${escape(node.name)}</option>`).join('')}</select></label><label>Animation<select data-scene="${id}" name="clip" aria-label="${escape(scene.name)} player animation"><option value="">No timeline clip</option>${clips.map(clip => `<option value="${clip.id}" ${settings.clips[id] === clip.id ? 'selected' : ''}>${escape(clip.name)}</option>`).join('')}</select></label></fieldset>`;
                })
                .join(
                    ''
                )}<p class="publish-note">Download the ZIP, extract it, and upload the whole folder to any static HTTP(S) host. Relative paths support subfolders. Visitors click Start to run scripts and enable sound. Keep your original project as an editable source.</p>
            <p id="publish-status" role="status"></p><p id="publish-error" role="alert"></p></div>
            <div class="dialog-footer"><span>${String(Object.keys(project.scenes).length)} scenes · ${String(Object.keys(project.assets).length)} assets</span><button data-publish="close">Cancel</button><button class="primary" data-publish="export">Download website ZIP</button></div>`;
    }
    private readonly change = (event: Event): void => {
        const input = event.target;
        const settings = this.settings;
        if (
            !settings ||
            this.pending ||
            !(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)
        )
            return;
        if (input.name === 'title') settings.title = input.value;
        if (input.name === 'startSceneId') settings.startSceneId = input.value;
        if (input.name === 'showControls' && input instanceof HTMLInputElement)
            settings.showControls = input.checked;
        const sceneId = input.dataset['scene'];
        if (sceneId && (input.name === 'camera' || input.name === 'clip')) {
            const values = input.name === 'camera' ? settings.cameras : settings.clips;
            if (input.value) values[sceneId] = input.value;
            else Reflect.deleteProperty(values, sceneId);
        }
    };
    private readonly click = (event: MouseEvent): void => {
        if (!(event.target instanceof Element)) return;
        const action = event.target.closest<HTMLElement>('[data-publish]')?.dataset['publish'];
        if (action === 'close') this.dialog.close();
        if (action === 'export') void this.export();
    };
    private readonly cancel = (): void => {
        this.pending?.abort();
    };
    private async export(): Promise<void> {
        if (!this.project || !this.settings || this.pending || this.isDestroyed()) return;
        const operation = new AbortController();
        this.pending = operation;
        const error = this.dialog.querySelector<HTMLElement>('#publish-error');
        const status = this.dialog.querySelector<HTMLElement>('#publish-status');
        if (error) error.textContent = '';
        for (const field of this.dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
            'input,select'
        ))
            field.disabled = true;
        const button = this.dialog.querySelector<HTMLButtonElement>('[data-publish="export"]');
        if (button) button.disabled = true;
        try {
            const template = new URL('./player-template/', document.baseURI);
            const archive = await exportPlayerArchive(
                this.project,
                this.settings,
                template,
                operation.signal,
                message => {
                    if (status) status.textContent = message;
                }
            );
            operation.signal.throwIfAborted();
            if (this.isDestroyed()) return;
            const url = URL.createObjectURL(archive);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${
                this.project.name
                    .toLowerCase()
                    .replace(/[^a-z0-9-]+/gu, '-')
                    .replace(/^-|-$/gu, '') || 'hilo-experience'
            }-website.zip`;
            link.click();
            const timer = window.setTimeout(() => {
                URL.revokeObjectURL(url);
                this.downloads.delete(url);
            }, 30_000);
            this.downloads.set(url, timer);
            if (status)
                status.textContent =
                    'Website ZIP downloaded. Extract it and upload the whole folder to your host.';
            this.options.onNotify('Website ZIP exported with its Player and all project assets.');
        } catch (cause) {
            if (!operation.signal.aborted && !this.isDestroyed()) {
                const message = cause instanceof Error ? cause.message : String(cause);
                if (error) error.textContent = message;
                this.options.onNotify(message, true);
            }
        } finally {
            if (this.pending === operation) this.pending = null;
            if (!this.isDestroyed()) {
                for (const field of this.dialog.querySelectorAll<
                    HTMLInputElement | HTMLSelectElement
                >('input,select'))
                    field.disabled = false;
                if (button) button.disabled = false;
            }
        }
    }
    destroy(): void {
        this.destroyed = true;
        this.cancel();
        this.dialog.removeEventListener('click', this.click);
        this.dialog.removeEventListener('change', this.change);
        this.dialog.removeEventListener('close', this.cancel);
        this.dialog.remove();
        for (const [url, timer] of this.downloads) {
            window.clearTimeout(timer);
            URL.revokeObjectURL(url);
        }
        this.downloads.clear();
    }
}
