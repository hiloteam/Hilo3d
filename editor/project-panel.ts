import { icon } from './icons';
import projectSchemaURL from './project.schema.json?url';
import workspaceSchemaURL from './project-manifest.schema.json?url';
import { exportProjectArchive, importProjectArchive } from './project-archive';
import {
    parseProject,
    projectSummary,
    serializeProject,
    validateProject,
    type ProjectDocument,
    type ProjectSummary
} from './project';
import type { ProjectController } from './project-controller';
import { createDefaultScene } from './scene';
import './project-panel.css';

function uniqueId(record: Record<string, unknown>, prefix: string): string {
    let index = 1;
    let id = `${prefix}-${String(index).padStart(3, '0')}`;
    while (Object.hasOwn(record, id)) id = `${prefix}-${String(++index).padStart(3, '0')}`;
    return id;
}

/** Add an empty scene without dropping project assets or authoring registries. */
export function createProjectScene(
    project: ProjectDocument,
    name = 'Untitled Scene'
): ProjectDocument {
    const next = structuredClone(project);
    const scene = createDefaultScene();
    scene.name = name;
    scene.nodes = {};
    scene.materials = {};
    const id = uniqueId(next.scenes, 'scene');
    next.scenes[id] = scene;
    next.activeSceneId = id;
    return validateProject(next);
}

/** Duplicate a scene together with its prefab links and animation clips. */
export function duplicateProjectScene(project: ProjectDocument, sceneId: string): ProjectDocument {
    const source = project.scenes[sceneId];
    if (!source) throw new Error('Scene no longer exists');
    const next = structuredClone(project);
    const id = uniqueId(next.scenes, 'scene');
    next.scenes[id] = { ...structuredClone(source), name: `${source.name.slice(0, 114)} copy` };
    next.activeSceneId = id;
    for (const instance of Object.values(project.instances)) {
        if (instance.sceneId !== sceneId) continue;
        const instanceId = uniqueId(next.instances, 'instance-copy');
        next.instances[instanceId] = { ...structuredClone(instance), id: instanceId, sceneId: id };
    }
    for (const clip of Object.values(project.clips)) {
        if (clip.sceneId !== sceneId) continue;
        const clipId = uniqueId(next.clips, 'clip-copy');
        next.clips[clipId] = { ...structuredClone(clip), id: clipId, sceneId: id };
    }
    return validateProject(next);
}

/** Delete scene-scoped authoring records atomically; shared templates, assets and scripts remain. */
export function deleteProjectScene(project: ProjectDocument, sceneId: string): ProjectDocument {
    if (!Object.hasOwn(project.scenes, sceneId)) throw new Error('Scene no longer exists');
    if (Object.keys(project.scenes).length <= 1)
        throw new Error('A project must retain at least one scene');
    const next = structuredClone(project);
    Reflect.deleteProperty(next.scenes, sceneId);
    for (const [id, instance] of Object.entries(next.instances))
        if (instance.sceneId === sceneId) Reflect.deleteProperty(next.instances, id);
    for (const [id, clip] of Object.entries(next.clips))
        if (clip.sceneId === sceneId) Reflect.deleteProperty(next.clips, id);
    if (next.activeSceneId === sceneId)
        next.activeSceneId = Object.keys(next.scenes).sort()[0] ?? '';
    return validateProject(next);
}

export interface ProjectPanelOptions {
    controller: ProjectController;
    getProject(): ProjectDocument;
    onCommit(project: ProjectDocument, label: string): void;
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
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Local project browser, scene manager, portable bundles and revision recovery. */
export class ProjectPanel {
    private readonly button: HTMLButtonElement;
    private readonly dialog: HTMLDialogElement;
    private projects: ProjectSummary[] = [];
    private backups: ProjectSummary[] = [];
    private recoveryId: string;
    private pendingDelete: ProjectSummary | null = null;
    private pendingSceneDelete: string | null = null;
    private busy = false;
    private destroyed = false;
    private error = '';
    private refreshGeneration = 0;
    private operationGeneration = 0;
    private operationAbort: AbortController | null = null;
    private readonly fileInput = document.createElement('input');
    private readonly downloads = new Set<string>();

    constructor(
        app: HTMLElement,
        private readonly options: ProjectPanelOptions
    ) {
        this.recoveryId = options.getProject().id;
        this.button = document.createElement('button');
        this.button.type = 'button';
        this.button.className = 'project-browser-trigger';
        this.button.innerHTML = `${icon('group')}<span>Projects</span>`;
        this.button.setAttribute('aria-label', 'Project browser');
        (app.querySelector('.file-controls') ?? app).prepend(this.button);
        this.button.addEventListener('click', this.handleOpen);
        this.dialog = document.createElement('dialog');
        this.dialog.className = 'project-browser-dialog';
        this.dialog.setAttribute('aria-label', 'Project browser');
        app.append(this.dialog);
        this.dialog.addEventListener('click', this.click);
        this.dialog.addEventListener('change', this.change);
        this.dialog.addEventListener('cancel', this.cancel);
        this.dialog.addEventListener('close', this.closed);
        this.fileInput.type = 'file';
        this.fileInput.className = 'project-bundle-input';
        this.fileInput.accept =
            '.json,.zip,application/json,application/zip,application/x-zip-compressed';
        this.fileInput.hidden = true;
        this.fileInput.setAttribute('aria-label', 'Import project bundle');
        this.render();
    }

    async open(): Promise<void> {
        if (this.destroyed) return;
        if (!this.dialog.open) this.cancelOperation();
        this.recoveryId = this.options.getProject().id;
        this.error = '';
        this.pendingDelete = null;
        this.pendingSceneDelete = null;
        this.render();
        if (!this.dialog.open) this.dialog.showModal();
        await this.refresh();
    }

    async refresh(): Promise<void> {
        if (this.destroyed) return;
        const generation = ++this.refreshGeneration;
        try {
            const store = this.options.controller.store;
            const [projects, backups] = store
                ? await Promise.all([store.list(), store.revisions(this.recoveryId)])
                : [[], []];
            if (this.isDestroyed() || generation !== this.refreshGeneration) return;
            this.projects = projects;
            this.backups = backups;
        } catch (error) {
            if (this.isDestroyed() || generation !== this.refreshGeneration) return;
            this.error = errorMessage(error);
        }
        this.render();
    }

    destroy(): void {
        this.cancelOperation();
        this.destroyed = true;
        this.button.removeEventListener('click', this.handleOpen);
        this.dialog.removeEventListener('click', this.click);
        this.dialog.removeEventListener('change', this.change);
        this.dialog.removeEventListener('cancel', this.cancel);
        this.dialog.removeEventListener('close', this.closed);
        this.button.remove();
        this.dialog.remove();
        for (const url of this.downloads) URL.revokeObjectURL(url);
        this.downloads.clear();
    }

    private isDestroyed(): boolean {
        return this.destroyed;
    }

    private render(): void {
        if (this.destroyed) return;
        const project = this.options.getProject();
        const disabled = this.busy ? 'disabled' : '';
        const conflict = this.options.controller.state === 'conflict';
        const stored = this.options.controller.store !== null;
        const projects = this.projects.map(summary =>
            summary.id === project.id ? projectSummary(project) : summary
        );
        if (!projects.some(summary => summary.id === project.id))
            projects.unshift(projectSummary(project));
        const recovery = projects.find(summary => summary.id === this.recoveryId);
        this.dialog.setAttribute('aria-busy', String(this.busy));
        this.dialog.innerHTML = `<div class="dialog-heading"><div>${icon('group')}<strong>Project browser</strong><span>LOCAL WORKSPACE</span></div><button data-project-action="close" aria-label="Close project browser">${icon('close')}</button></div>
        <div class="project-browser-body"><section class="project-browser-main"><div class="project-browser-intro"><h2>Your projects</h2><p>Scenes, source assets and authoring data, together in one portable project.</p></div>
        ${!stored ? '<div class="project-warning" role="status">Browser storage is unavailable. Export a project bundle to preserve this session.</div>' : ''}
        ${conflict ? `<div class="project-warning" role="alert"><strong>This project changed in another tab.</strong><span>Your local work is still here. Reload keeps unsaved work as a separate copy.</span><div><button data-project-action="reload" ${disabled}>Reload latest</button><button data-project-action="copy" ${disabled}>Save local copy</button></div></div>` : ''}
        <div class="project-create-row"><input name="newProjectName" aria-label="New project name" placeholder="New project name" maxlength="120"/><button class="primary" data-project-action="create" ${disabled}>${icon('plus')}Create project</button><button data-project-action="import" ${disabled}>${icon('import')}Import project</button></div>
        <div class="project-browser-list">${projects.map(summary => `<article class="project-browser-row ${summary.id === project.id ? 'active' : ''}"><span class="project-folder">${icon('group')}</span><div><strong>${escape(summary.name)}</strong><span>${String(summary.sceneCount)} scenes · ${String(summary.assetCount)} assets · revision ${String(summary.revision)}${summary.id === project.id ? ' · OPEN' : ''}</span><small>${escape(new Date(summary.updatedAt).toLocaleString())}</small></div><button data-project-action="open" data-project-id="${summary.id}" ${disabled || (summary.id === project.id ? 'disabled' : '')} aria-label="Open project ${escape(summary.name)}">Open</button><button data-project-action="history" data-project-id="${summary.id}" ${disabled || (!stored ? 'disabled' : '')} aria-label="Recovery history ${escape(summary.name)}">${icon('undo')}</button><button data-project-action="delete" data-project-id="${summary.id}" ${disabled || (!stored ? 'disabled' : '')} aria-label="Delete project ${escape(summary.name)}">${icon('trash')}</button></article>`).join('')}</div>
        ${this.pendingDelete ? `<div class="project-delete-confirm" role="alert"><strong>Delete “${escape(this.pendingDelete.name)}” from this browser?</strong><span>This removes its stored revisions. Export a bundle first if you need a backup.</span><div><button data-project-action="cancel-delete">Keep project</button><button class="danger" data-project-action="confirm-delete" ${disabled}>Delete project permanently</button></div></div>` : ''}
        <section class="project-scenes"><div class="project-section-heading"><h3>Scenes in ${escape(project.name)}</h3><button data-project-action="new-scene" ${disabled}>${icon('plus')}New scene</button></div>${Object.entries(
            project.scenes
        )
            .map(
                ([id, scene]) =>
                    `<div class="project-scene-row ${id === project.activeSceneId ? 'active' : ''}">${icon('cube')}<input data-scene-name="${id}" aria-label="Scene name ${escape(scene.name)}" value="${escape(scene.name)}" maxlength="120"/><span>${String(Object.keys(scene.nodes).length)} objects</span><button data-project-action="switch-scene" data-scene-id="${id}" ${disabled || (id === project.activeSceneId ? 'disabled' : '')} aria-label="Open scene ${escape(scene.name)}">${id === project.activeSceneId ? 'Active' : 'Open'}</button><button data-project-action="duplicate-scene" data-scene-id="${id}" ${disabled} aria-label="Duplicate scene ${escape(scene.name)}">${icon('copy')}</button><button data-project-action="delete-scene" data-scene-id="${id}" ${disabled || (Object.keys(project.scenes).length === 1 ? 'disabled' : '')} aria-label="Delete scene ${escape(scene.name)}">${icon('trash')}</button></div>`
            )
            .join('')}
        ${this.pendingSceneDelete ? `<div class="project-delete-confirm" role="alert"><span>Remove this scene, its prefab links and animation clips? Project undo restores them together.</span><button data-project-action="cancel-scene-delete">Keep scene</button><button class="danger" data-project-action="confirm-scene-delete" ${disabled}>Delete scene</button></div>` : ''}</section></section>
        <aside class="project-browser-details"><h3>Current project</h3><label>Project name<input name="projectName" aria-label="Project name" value="${escape(project.name)}" maxlength="120"/></label><button data-project-action="rename" ${disabled}>Rename project</button><dl><dt>Revision</dt><dd>${String(project.revision)}</dd><dt>Project ID</dt><dd class="project-id">${project.id}</dd></dl><button class="primary" data-project-action="export" ${disabled}>${icon('export')}Export project bundle</button><button data-project-action="export-workspace" ${disabled}>${icon('export')}Export AI workspace (.zip)</button><button data-project-action="copy" ${disabled}>${icon('copy')}Save as a new project</button><p>JSON bundles preserve one portable backup. AI workspaces separate editable scenes and scripts from binary assets, with an indexed manifest and offline schemas.</p><h3>Recovery history</h3><span class="project-recovery-name">${escape(recovery?.name ?? 'Selected project')}</span><div class="project-recovery-list">${this.backups.map(summary => `<button data-project-action="restore" data-revision="${String(summary.revision)}" ${disabled}><span>Revision ${String(summary.revision)}<small>${escape(new Date(summary.updatedAt).toLocaleString())}</small></span>${icon('undo')}</button>`).join('') || '<p>Previous saves will appear here. The latest 10 revisions are retained.</p>'}</div></aside></div>
        <div class="project-browser-error" role="alert">${escape(this.error)}</div><div class="dialog-footer"><a href="${projectSchemaURL}" target="_blank" rel="noreferrer">Project JSON Schema ↗</a><a href="${workspaceSchemaURL}" target="_blank" rel="noreferrer">AI workspace schema ↗</a><span>${this.busy ? 'Working…' : 'Local projects · JSON / ZIP workspaces · recoverable revisions'}</span><button data-project-action="close">Done</button></div>`;
        this.dialog.querySelector('.project-create-row')?.append(this.fileInput);
    }

    private async run(
        action: string,
        id?: string,
        sceneId?: string,
        revision?: string,
        value?: string
    ): Promise<void> {
        if (this.busy || this.destroyed || !this.dialog.open) return;
        const generation = this.beginOperation();
        try {
            await this.perform(action, generation, id, sceneId, revision, value);
        } catch (error) {
            if (!this.isCurrentOperation(generation)) return;
            this.error = errorMessage(error);
            this.options.onNotify(this.error, true);
        } finally {
            await this.finishOperation(generation);
        }
    }

    private async perform(
        action: string,
        generation: number,
        id?: string,
        sceneId?: string,
        revision?: string,
        value?: string
    ): Promise<void> {
        const controller = this.options.controller;
        switch (action) {
            case 'create':
                await controller.create(
                    createDefaultScene(),
                    value?.trim().length ? value.trim() : 'Untitled Project'
                );
                if (!this.isCurrentOperation(generation)) return;
                this.recoveryId = this.options.getProject().id;
                break;
            case 'open':
                if (id) {
                    await controller.open(id);
                    if (!this.isCurrentOperation(generation)) return;
                    this.recoveryId = id;
                }
                break;
            case 'history':
                if (id) this.recoveryId = id;
                break;
            case 'rename': {
                const next = structuredClone(this.options.getProject());
                next.name = value?.trim() ?? '';
                this.options.onCommit(validateProject(next), 'Project renamed');
                break;
            }
            case 'copy':
                await controller.saveCopy();
                if (!this.isCurrentOperation(generation)) return;
                this.recoveryId = this.options.getProject().id;
                break;
            case 'reload':
                await controller.reloadConflict();
                if (!this.isCurrentOperation(generation)) return;
                this.recoveryId = this.options.getProject().id;
                break;
            case 'restore': {
                if (!controller.store || !revision)
                    throw new Error('Recovery history is unavailable');
                if (this.recoveryId === this.options.getProject().id)
                    await controller.restoreRevision(Number(revision));
                else {
                    const summary = this.projects.find(item => item.id === this.recoveryId);
                    if (!summary) throw new Error('Project no longer exists');
                    await controller.store.restore(summary.id, Number(revision), summary.revision);
                    if (!this.isCurrentOperation(generation)) return;
                    await controller.open(summary.id);
                }
                break;
            }
            case 'delete':
                this.pendingDelete = this.projects.find(summary => summary.id === id) ?? null;
                break;
            case 'confirm-delete': {
                const pending = this.pendingDelete;
                if (!pending || !controller.store) throw new Error('Project is unavailable');
                let expected = pending.revision;
                if (pending.id === this.options.getProject().id) {
                    await controller.save();
                    if (!this.isCurrentOperation(generation)) return;
                    expected = controller.project.revision;
                    const other = this.projects.find(summary => summary.id !== pending.id);
                    if (other) await controller.open(other.id);
                    else await controller.create(createDefaultScene(), 'Untitled Project');
                }
                if (!this.isCurrentOperation(generation)) return;
                await controller.store.delete(pending.id, expected);
                if (!this.isCurrentOperation(generation)) return;
                this.pendingDelete = null;
                this.recoveryId = this.options.getProject().id;
                this.options.onNotify('Project and its local recovery history deleted');
                break;
            }
            case 'new-scene':
                this.options.onCommit(
                    createProjectScene(this.options.getProject()),
                    'Scene created'
                );
                break;
            case 'duplicate-scene':
                if (sceneId)
                    this.options.onCommit(
                        duplicateProjectScene(this.options.getProject(), sceneId),
                        'Scene duplicated'
                    );
                break;
            case 'switch-scene': {
                const next = structuredClone(this.options.getProject());
                if (!sceneId || !Object.hasOwn(next.scenes, sceneId))
                    throw new Error('Scene no longer exists');
                next.activeSceneId = sceneId;
                this.options.onCommit(validateProject(next), 'Scene opened');
                this.closeDialog();
                break;
            }
            case 'delete-scene':
                this.pendingSceneDelete = sceneId ?? null;
                break;
            case 'confirm-scene-delete':
                if (this.pendingSceneDelete) {
                    this.options.onCommit(
                        deleteProjectScene(this.options.getProject(), this.pendingSceneDelete),
                        'Scene removed'
                    );
                    this.pendingSceneDelete = null;
                }
                break;
        }
    }

    private export(): void {
        if (this.destroyed || this.busy || !this.dialog.open) return;
        try {
            const project = this.options.getProject();
            const url = URL.createObjectURL(
                new Blob([serializeProject(project)], { type: 'application/json' })
            );
            this.downloads.add(url);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/gu, '-') || 'project'}.hilo-project.json`;
            anchor.click();
            window.setTimeout(() => {
                URL.revokeObjectURL(url);
                this.downloads.delete(url);
            }, 1000);
            this.options.onNotify('Portable project bundle exported');
        } catch (error) {
            this.error = errorMessage(error);
            this.render();
        }
    }
    private readonly handleOpen = (): void => {
        void this.open();
    };
    private readonly click = (event: MouseEvent): void => {
        if (!(event.target instanceof Element)) return;
        const target = event.target.closest<HTMLElement>('[data-project-action]');
        const action = target?.dataset['projectAction'];
        if (!target || !action) return;
        if (action === 'close') {
            this.closeDialog();
            return;
        }
        if (action === 'import') {
            if (!this.busy) this.fileInput.click();
            return;
        }
        if (action === 'export') {
            this.export();
            return;
        }
        if (action === 'export-workspace') {
            void this.exportWorkspace();
            return;
        }
        if (action === 'cancel-delete') {
            this.pendingDelete = null;
            this.render();
            return;
        }
        if (action === 'cancel-scene-delete') {
            this.pendingSceneDelete = null;
            this.render();
            return;
        }
        const value =
            action === 'create'
                ? this.dialog.querySelector<HTMLInputElement>('[name="newProjectName"]')?.value
                : this.dialog.querySelector<HTMLInputElement>('[name="projectName"]')?.value;
        void this.run(
            action,
            target.dataset['projectId'],
            target.dataset['sceneId'],
            target.dataset['revision'],
            value
        );
    };
    private readonly change = (event: Event): void => {
        if (this.destroyed || !this.dialog.open) return;
        const input = event.target;
        if (!(input instanceof HTMLInputElement)) return;
        if (input.type === 'file') {
            const file = input.files?.[0];
            input.value = '';
            if (file && !this.busy) void this.importFile(file);
            return;
        }
        const id = input.dataset['sceneName'];
        if (!id) return;
        try {
            const project = structuredClone(this.options.getProject());
            const scene = project.scenes[id];
            if (!scene) throw new Error('Scene no longer exists');
            scene.name = input.value.trim();
            this.options.onCommit(validateProject(project), 'Scene renamed');
            this.render();
        } catch (error) {
            this.error = errorMessage(error);
            this.render();
        }
    };

    private beginOperation(): number {
        this.operationAbort = new AbortController();
        this.busy = true;
        this.error = '';
        const generation = ++this.operationGeneration;
        this.render();
        return generation;
    }

    private isCurrentOperation(generation: number): boolean {
        return (
            !this.destroyed &&
            this.dialog.open &&
            generation === this.operationGeneration &&
            this.operationAbort?.signal.aborted === false
        );
    }

    private async finishOperation(generation: number): Promise<void> {
        if (!this.isCurrentOperation(generation)) return;
        this.operationAbort = null;
        this.busy = false;
        await this.refresh();
    }

    private cancelOperation(): void {
        this.operationGeneration++;
        this.refreshGeneration++;
        if (this.operationAbort) {
            this.operationAbort.abort();
            this.operationAbort = null;
            this.options.controller.cancelPendingActivation();
        }
        this.busy = false;
    }

    private closeDialog(): void {
        this.cancelOperation();
        this.dialog.close();
    }

    private readonly cancel = (): void => {
        this.cancelOperation();
    };
    private readonly closed = (): void => {
        if (!this.dialog.open) this.cancelOperation();
    };

    private authoringKey(project: ProjectDocument): string {
        return JSON.stringify({ ...project, revision: 0, updatedAt: project.createdAt });
    }

    private async importFile(file: File): Promise<void> {
        const generation = this.beginOperation();
        const signal = this.operationAbort?.signal;
        const history = this.options.controller.history;
        const original = this.authoringKey(this.options.getProject());
        try {
            if (file.size > 128 * 1024 * 1024)
                throw new Error(
                    'ZIP workspace exceeds 128 MiB; JSON bundles are limited to 96 MiB'
                );
            const prefix = new Uint8Array(await file.slice(0, 4).arrayBuffer());
            if (!this.isCurrentOperation(generation)) return;
            const zip =
                /\.zip$/iu.test(file.name) ||
                file.type === 'application/zip' ||
                (prefix[0] === 0x50 && prefix[1] === 0x4b && (prefix[2] === 3 || prefix[2] === 5));
            if (!zip && file.size > 96 * 1024 * 1024)
                throw new Error('Project bundle exceeds 96 MiB');
            const project = zip
                ? await importProjectArchive(file)
                : parseProject(await file.text());
            if (!this.isCurrentOperation(generation)) return;
            if (
                this.options.controller.history !== history ||
                this.authoringKey(this.options.getProject()) !== original
            )
                throw new Error(
                    'Newer local changes were retained. Import the workspace again when ready to switch projects.'
                );
            await this.options.controller.import(project, signal);
            if (!this.isCurrentOperation(generation)) return;
            this.recoveryId = this.options.getProject().id;
            this.options.onNotify(
                zip
                    ? 'AI workspace imported as a separate project'
                    : 'Project bundle imported as a separate project'
            );
        } catch (error) {
            if (!this.isCurrentOperation(generation)) return;
            this.error = errorMessage(error);
            this.options.onNotify(this.error, true);
        } finally {
            await this.finishOperation(generation);
        }
    }

    private async exportWorkspace(): Promise<void> {
        if (this.busy || this.destroyed || !this.dialog.open) return;
        const project = this.options.getProject();
        const generation = this.beginOperation();
        try {
            const archive = await exportProjectArchive(project);
            if (!this.isCurrentOperation(generation)) return;
            const url = URL.createObjectURL(archive);
            this.downloads.add(url);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/gu, '-') || 'project'}.hilo-workspace.zip`;
            anchor.click();
            window.setTimeout(() => {
                URL.revokeObjectURL(url);
                this.downloads.delete(url);
            }, 1000);
            this.options.onNotify(
                'AI workspace exported with editable source files and separate binary assets'
            );
        } catch (error) {
            if (!this.isCurrentOperation(generation)) return;
            this.error = errorMessage(error);
            this.options.onNotify(this.error, true);
        } finally {
            await this.finishOperation(generation);
        }
    }
}
