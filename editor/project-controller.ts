import { validateProjectAssetDecoding } from './assets';
import { createProject, validateProject, type ProjectDocument } from './project';
import { ProjectStore, ProjectConflictError } from './project-store';
import { ProjectHistory } from './project-history';
import { createDefaultScene, type SceneDocument } from './scene';

export type SaveState = 'saved' | 'pending' | 'saving' | 'conflict' | 'unavailable' | 'error';
interface ActivationTicket {
    history: ProjectHistory;
    generation: number;
    sequence: number;
    signal?: AbortSignal;
}

const LAST_PROJECT = 'hilo-studio.last-project';

/** Coordinates durable saves, project-wide history and explicit cross-tab conflicts. */
export class ProjectController {
    history: ProjectHistory;
    readonly store: ProjectStore | null;
    onStatus: ((state: SaveState, message: string) => void) | undefined;
    onProject: ((project: ProjectDocument, message: string) => void) | undefined;
    private activationSequence = 0;
    private generation = 0;
    private savedGeneration = 0;
    private timer = 0;
    private saving: Promise<void> | null = null;
    private conflict = false;
    private readonly channel: BroadcastChannel | null;
    private closed = false;
    private statusValue: SaveState = 'saved';
    readonly startupWarning: string;

    private constructor(store: ProjectStore | null, project: ProjectDocument, warning: string) {
        this.store = store;
        this.history = new ProjectHistory(project);
        this.startupWarning = warning;
        this.statusValue = store ? 'saved' : 'unavailable';
        this.channel =
            typeof BroadcastChannel === 'undefined'
                ? null
                : new BroadcastChannel('hilo-studio.projects');
        if (this.channel)
            this.channel.onmessage = event => {
                const value: unknown = event.data;
                if (!value || typeof value !== 'object') return;
                const id: unknown = Reflect.get(value, 'id');
                const revision: unknown = Reflect.get(value, 'revision');
                const current = this.history.project;
                if (
                    id === current.id &&
                    typeof revision === 'number' &&
                    revision > current.revision
                ) {
                    this.conflict = true;
                    this.report(
                        'conflict',
                        'This project changed in another tab. Reload it or save your work as a copy.'
                    );
                }
            };
        window.addEventListener('beforeunload', this.beforeUnload);
        window.addEventListener('pagehide', this.pageHide);
    }
    static async restore(fallback: SceneDocument): Promise<ProjectController> {
        let store: ProjectStore | null = null;
        try {
            store = await ProjectStore.open();
            let id: string | null = null;
            try {
                id = localStorage.getItem(LAST_PROJECT);
            } catch {
                /* IndexedDB may still work. */
            }
            const previous = id ? await store.load(id) : null;
            if (previous) {
                await validateProjectAssetDecoding(previous.assets);
                return new ProjectController(store, previous, '');
            }
            const created = await store.save(createProject(fallback));
            try {
                localStorage.setItem(LAST_PROJECT, created.id);
            } catch {
                /* Project browser remains usable. */
            }
            return new ProjectController(store, created, '');
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            let recovery: ProjectDocument;
            try {
                recovery = createProject(fallback);
            } catch {
                recovery = createProject(createDefaultScene(), 'Recovery workspace');
            }
            const warning = store
                ? `Could not restore the last project: ${reason}. Its stored data is preserved. Open Projects and Recovery history to restore an earlier revision. Export unsaved work before closing.`
                : `Project storage is unavailable: ${reason}. Export a project bundle before closing.`;
            const controller = new ProjectController(store, recovery, warning);
            controller.generation = 1;
            controller.statusValue = store ? 'error' : 'unavailable';
            return controller;
        }
    }
    get project(): ProjectDocument {
        return this.history.project;
    }
    get state(): SaveState {
        return this.statusValue;
    }
    get dirty(): boolean {
        return this.generation !== this.savedGeneration;
    }
    markChanged(): void {
        this.generation++;
        if (this.conflict) {
            this.report(
                'conflict',
                'Local edits retained. Resolve the project conflict before saving.'
            );
            return;
        }
        this.report(
            this.store ? 'pending' : 'unavailable',
            this.store ? 'Unsaved changes' : 'Session only — export a project bundle'
        );
        window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => {
            void this.save().catch(() => {
                /* Status contains the actionable error. */
            });
        }, 350);
    }
    async save(): Promise<void> {
        window.clearTimeout(this.timer);
        if (this.closed) return;
        if (!this.store)
            throw new Error('Project storage is unavailable. Export your project bundle.');
        if (this.conflict)
            throw new Error('Project conflict: reload the latest revision or save a copy.');
        if (this.saving) {
            await this.saving;
            if (this.dirty) await this.save();
            return;
        }
        if (!this.dirty) return;
        const store = this.store;
        const generation = this.generation;
        const savingHistory = this.history;
        const snapshot = savingHistory.project;
        this.report('saving', 'Saving project…');
        this.saving = store
            .save(snapshot, snapshot.revision)
            .then(saved => {
                if (!this.closed)
                    this.channel?.postMessage({ id: saved.id, revision: saved.revision });
                if (this.closed || this.history !== savingHistory) return;
                savingHistory.markSaved(saved.revision, saved.updatedAt);
                this.savedGeneration = generation;
                this.report(
                    this.dirty ? 'pending' : 'saved',
                    this.dirty ? 'New changes pending' : `Saved revision ${String(saved.revision)}`
                );
            })
            .catch((error: unknown) => {
                if (this.history !== savingHistory) throw error;
                this.conflict = error instanceof ProjectConflictError;
                this.report(
                    this.conflict ? 'conflict' : 'error',
                    error instanceof Error ? error.message : String(error)
                );
                throw error;
            })
            .finally(() => {
                this.saving = null;
            });
        await this.saving;
        if (this.generation !== this.savedGeneration) await this.save();
    }
    async open(id: string): Promise<void> {
        const ticket = this.beginActivation();
        if (!this.store) throw new Error('Project storage is unavailable.');
        if (this.dirty) await this.save();
        const project = await this.store.load(id);
        if (!project) throw new Error('Project no longer exists.');
        await validateProjectAssetDecoding(project.assets);
        this.checkActivation(ticket);
        this.install(project, 'Project opened');
    }
    async create(scene: SceneDocument, name: string): Promise<void> {
        const ticket = this.beginActivation();
        if (this.dirty) await this.save();
        const project = createProject(scene, name);
        const saved = this.store ? await this.store.save(project) : project;
        this.checkActivation(ticket);
        this.install(saved, 'Project created');
    }
    async import(document: ProjectDocument, signal?: AbortSignal): Promise<void> {
        const ticket = this.beginActivation(signal);
        this.checkActivation(ticket);
        if (this.dirty) await this.save();
        const source = validateProject(document);
        await validateProjectAssetDecoding(source.assets);
        this.checkActivation(ticket);
        const seed = createProject(createDefaultScene(), source.name);
        const project = {
            ...source,
            id: seed.id,
            revision: 0,
            createdAt: seed.createdAt,
            updatedAt: seed.updatedAt
        };
        const saved = this.store
            ? await this.store.save(project, project.revision, signal)
            : project;
        this.checkActivation(ticket);
        this.install(saved, 'Project imported as a separate copy');
    }
    async reloadConflict(): Promise<void> {
        const ticket = this.beginActivation();
        if (!this.store) throw new Error('Project storage is unavailable.');
        // Preserve unsaved local work in a separate project before replacing the active revision.
        const id = this.project.id;
        if (this.dirty) await this.saveCopy(false);
        const latest = await this.store.load(id);
        if (!latest)
            throw new Error('The shared project was deleted. Your local copy remains available.');
        await validateProjectAssetDecoding(latest.assets);
        this.checkActivation(ticket);
        this.install(
            latest,
            'Latest revision loaded; unsaved local work was kept as a separate project'
        );
    }
    async saveCopy(activate = true): Promise<ProjectDocument> {
        const ticket = activate ? this.beginActivation() : null;
        const source = this.project;
        const seed = createProject(createDefaultScene(), `${source.name.slice(0, 112)} copy`);
        const copy = {
            ...source,
            id: seed.id,
            name: seed.name,
            revision: 0,
            createdAt: seed.createdAt,
            updatedAt: seed.updatedAt
        };
        const saved = this.store ? await this.store.save(copy) : copy;
        if (ticket) {
            this.checkActivation(ticket);
            this.install(
                saved,
                this.store
                    ? 'Local work saved as a separate project'
                    : 'Session-only copy created; export a bundle before closing'
            );
        }
        return saved;
    }
    async restoreRevision(revision: number): Promise<void> {
        const ticket = this.beginActivation();
        if (!this.store) throw new Error('Project storage is unavailable.');
        if (this.dirty) await this.save();
        const project = this.project;
        this.checkActivation(ticket);
        const recovery = await this.store.loadRevision(project.id, revision);
        if (!recovery) throw new Error('Recovery revision is unavailable.');
        await validateProjectAssetDecoding(recovery.assets);
        this.checkActivation(ticket);
        const restored = await this.store.restore(project.id, revision, project.revision);
        if (this.history === ticket.history)
            this.history.markSaved(restored.revision, restored.updatedAt);
        this.checkActivation(ticket);
        this.install(restored, 'Recovery revision restored as a new save');
        this.channel?.postMessage({ id: restored.id, revision: restored.revision });
    }
    cancelPendingActivation(): void {
        this.activationSequence++;
    }
    private beginActivation(signal?: AbortSignal): ActivationTicket {
        return {
            history: this.history,
            generation: this.generation,
            sequence: ++this.activationSequence,
            ...(signal ? { signal } : {})
        };
    }
    private checkActivation(ticket: ActivationTicket): void {
        if (ticket.signal?.aborted) throw new Error('Project operation cancelled.');
        if (
            this.closed ||
            ticket.history !== this.history ||
            ticket.generation !== this.generation ||
            ticket.sequence !== this.activationSequence
        ) {
            throw new Error(
                'Newer edits or a different project operation were kept. The active project was not replaced. Any completed copy remains in Projects.'
            );
        }
    }
    private install(project: ProjectDocument, message: string): void {
        this.history = new ProjectHistory(project);
        this.generation = this.store ? 0 : 1;
        this.savedGeneration = 0;
        this.conflict = false;
        try {
            localStorage.setItem(LAST_PROJECT, project.id);
        } catch {
            /* Storage status is shown separately. */
        }
        this.report(
            this.store ? 'saved' : 'unavailable',
            this.store ? 'Project ready' : 'Session only'
        );
        this.onProject?.(this.project, message);
    }
    private report(state: SaveState, message: string): void {
        this.statusValue = state;
        this.onStatus?.(state, message);
    }
    private readonly beforeUnload = (event: BeforeUnloadEvent): void => {
        if (this.dirty) {
            event.preventDefault();
        }
    };
    private readonly pageHide = (event: PageTransitionEvent): void => {
        if (event.persisted) return;
        this.closed = true;
        window.clearTimeout(this.timer);
        this.channel?.close();
        window.removeEventListener('beforeunload', this.beforeUnload);
        window.removeEventListener('pagehide', this.pageHide);
        if (this.saving)
            void this.saving
                .finally(() => {
                    this.store?.close();
                })
                .catch(() => {
                    /* Save errors were already reported before teardown. */
                });
        else this.store?.close();
    };
}
