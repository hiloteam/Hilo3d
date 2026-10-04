import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectController } from '../../../editor/project-controller';
import { ProjectStore } from '../../../editor/project-store';
import { projectSummary } from '../../../editor/project';
import { createDefaultScene } from '../../../editor/scene';

const connections: ProjectStore[] = [];
let databaseName = '';
let remembered: string | null = null;
const nativeOpen = ProjectStore.open.bind(ProjectStore);

beforeEach(() => {
    databaseName = `hilo-controller-test-${crypto.randomUUID()}`;
    remembered = null;
    const get = Reflect.get(Storage.prototype, 'getItem');
    const set = Reflect.get(Storage.prototype, 'setItem');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
        this: Storage,
        key: string
    ): string | null {
        return key === 'hilo-studio.last-project' ? remembered : get.call(this, key);
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
        this: Storage,
        key: string,
        value: string
    ): void {
        if (key === 'hilo-studio.last-project') remembered = value;
        else set.call(this, key, value);
    });
    vi.spyOn(ProjectStore, 'open').mockImplementation(async () => {
        const store = await nativeOpen(databaseName);
        connections.push(store);
        return store;
    });
});

afterEach(async () => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    vi.restoreAllMocks();
    for (const store of connections.splice(0)) store.close();
    await new Promise<void>((resolve, reject) => {
        const operation = indexedDB.deleteDatabase(databaseName);
        operation.onsuccess = () => {
            resolve();
        };
        operation.onerror = () => {
            reject(operation.error ?? new Error('Controller test cleanup failed'));
        };
        operation.onblocked = () => {
            reject(new Error('Controller retained an IndexedDB connection'));
        };
    });
});

function rename(controller: ProjectController, name: string): void {
    const next = controller.project;
    next.name = name;
    controller.history.commitProject(next);
    controller.markChanged();
}

describe('project persistence controller', () => {
    it('saves dirty authoring state, advances metadata and restores the last project', async () => {
        const controller = await ProjectController.restore(createDefaultScene());
        rename(controller, 'Authored Project');
        expect(controller.dirty).toBe(true);
        expect(controller.state).toBe('pending');
        await controller.save();
        expect(controller.project.revision).toBe(2);
        expect(controller.dirty).toBe(false);
        const restored = await ProjectController.restore(createDefaultScene());
        expect(restored.project).toEqual(controller.project);
        expect(restored.state).toBe('saved');
        controller.history.undo();
        controller.markChanged();
        await controller.save();
        expect(controller.project.revision).toBe(3);
        expect(controller.project.name).toBe('Terracotta Study');
    });

    it('keeps a new active project isolated from an older in-flight save callback', async () => {
        const controller = await ProjectController.restore(createDefaultScene());
        const store = controller.store;
        if (!store) throw new Error('Store missing');
        const originalId = controller.project.id;
        const save = store.save.bind(store);
        let release: () => void = () => undefined;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        vi.spyOn(store, 'save').mockImplementation(async (project, expected) => {
            if (project.id === originalId) await gate;
            return save(project, expected);
        });
        rename(controller, 'Old Project Edit');
        const pending = controller.save();
        const copy = await controller.saveCopy();
        expect(copy.id).not.toBe(originalId);
        rename(controller, 'New Active Edit');
        release();
        await pending;
        expect(controller.project.id).toBe(copy.id);
        expect(controller.project.name).toBe('New Active Edit');
        expect(controller.project.revision).toBe(2);
        expect(controller.dirty).toBe(false);
        expect((await store.load(copy.id))?.name).toBe('New Active Edit');
        expect((await store.load(originalId))?.name).toBe('Old Project Edit');
    });

    it('preserves edits made while a Save Copy operation is awaiting durable storage', async () => {
        const controller = await ProjectController.restore(createDefaultScene());
        const store = controller.store;
        if (!store) throw new Error('Store missing');
        const originalId = controller.project.id;
        const save = store.save.bind(store);
        let release: () => void = () => undefined;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        vi.spyOn(store, 'save').mockImplementation(async (project, expected) => {
            if (project.id !== originalId) await gate;
            return save(project, expected);
        });
        const copying = controller.saveCopy();
        const edited = controller.history.scene;
        const sphere = edited.nodes['hero-sphere'];
        if (!sphere) throw new Error('Missing sphere');
        sphere.transform.position.x = 8.125;
        controller.history.commit(edited);
        controller.markChanged();
        release();
        await expect(copying).rejects.toThrow(/new|changed|retain|cancel/iu);
        const saved = await Promise.all(
            (await store.list()).map(summary => store.load(summary.id))
        );
        expect(
            [controller.project, ...saved].some(
                project =>
                    project?.scenes[project.activeSceneId]?.nodes['hero-sphere']?.transform.position
                        .x === 8.125
            ),
            'Edits made during Save Copy must remain active or durable'
        ).toBe(true);
    });

    it('preserves current project edits while another project is still loading', async () => {
        const controller = await ProjectController.restore(createDefaultScene());
        const store = controller.store;
        if (!store) throw new Error('Store missing');
        const originalId = controller.project.id;
        const destination = await store.create(createDefaultScene(), 'Destination');
        const load = store.load.bind(store);
        let release: () => void = () => undefined;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        vi.spyOn(store, 'load').mockImplementation(async id => {
            const project = await load(id);
            if (id === destination.id) await gate;
            return project;
        });
        const opening = controller.open(destination.id);
        rename(controller, 'Typed while loading');
        release();
        await expect(opening).rejects.toThrow(/new|changed|retain|cancel/iu);
        const original = await load(originalId);
        expect(
            controller.project.name === 'Typed while loading' ||
                original?.name === 'Typed while loading',
            'Project activation must not discard a late field edit'
        ).toBe(true);
    });

    it('preserves local work as a separate project before reloading a conflicting remote revision', async () => {
        const controller = await ProjectController.restore(createDefaultScene());
        const store = controller.store;
        if (!store) throw new Error('Store missing');
        const id = controller.project.id;
        await store.save({ ...controller.project, name: 'Other Tab Saved' });
        rename(controller, 'My Local Edits');
        await expect(controller.save()).rejects.toThrow('another tab');
        expect(controller.state).toBe('conflict');
        expect(controller.dirty).toBe(true);
        await controller.reloadConflict();
        expect(controller.project.id).toBe(id);
        expect(controller.project.name).toBe('Other Tab Saved');
        const copy = (await store.list()).find(project => project.id !== id);
        if (!copy) throw new Error('Conflict recovery lost the local copy');
        expect((await store.load(copy.id))?.name).toBe('My Local Edits copy');
        expect(controller.dirty).toBe(false);
    });

    it('keeps the database accessible when the last project payload needs historical recovery', async () => {
        const original = await ProjectController.restore(createDefaultScene());
        rename(original, 'Recent revision');
        await original.save();
        const id = original.project.id;
        await new Promise<void>((resolve, reject) => {
            const opening = indexedDB.open(databaseName);
            opening.onerror = () => {
                reject(opening.error ?? new Error('Open failed'));
            };
            opening.onsuccess = () => {
                const db = opening.result;
                const transaction = db.transaction('projects', 'readwrite');
                transaction
                    .objectStore('projects')
                    .put({ summary: projectSummary(original.project), source: '{corrupt' });
                transaction.oncomplete = () => {
                    db.close();
                    resolve();
                };
                transaction.onabort = () => {
                    db.close();
                    reject(transaction.error ?? new Error('Corruption setup failed'));
                };
            };
        });
        const recovery = await ProjectController.restore(createDefaultScene());
        expect(recovery.store).not.toBeNull();
        expect(recovery.startupWarning).toContain('Recovery history');
        expect(recovery.dirty).toBe(true);
        expect(recovery.project.id).not.toBe(id);
        const store = recovery.store;
        if (!store) throw new Error('Recovery store missing');
        expect((await store.revisions(id)).map(item => item.revision)).toEqual([1]);
        await store.restore(id, 1, 2);
        await recovery.open(id);
        expect(recovery.project.name).toBe('Terracotta Study');
        expect(recovery.project.revision).toBe(3);
    });

    it('allows a pending durable save to finish after teardown without posting to a closed channel', async () => {
        const controller = await ProjectController.restore(createDefaultScene());
        const store = controller.store;
        if (!store) throw new Error('Store missing');
        const id = controller.project.id;
        const save = store.save.bind(store);
        let release: () => void = () => undefined;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        vi.spyOn(store, 'save').mockImplementationOnce(async (project, expected) => {
            await gate;
            return save(project, expected);
        });
        rename(controller, 'Saved before closing');
        const pending = controller.save();
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
        release();
        await expect(pending).resolves.toBeUndefined();
        const proof = await nativeOpen(databaseName);
        connections.push(proof);
        expect((await proof.load(id))?.name).toBe('Saved before closing');
    });

    it('does not represent an unavailable persistence service as a successful save', async () => {
        vi.spyOn(ProjectStore, 'open').mockRejectedValueOnce(new Error('Storage blocked'));
        const controller = await ProjectController.restore(createDefaultScene());
        expect(controller.store).toBeNull();
        expect(controller.state).toBe('unavailable');
        expect(controller.dirty).toBe(true);
        await expect(controller.save()).rejects.toThrow('Export');
        expect(controller.project.scenes[controller.project.activeSceneId]).toEqual(
            createDefaultScene()
        );
        const copy = await controller.saveCopy();
        expect(copy.revision).toBe(0);
        expect(controller.state).toBe('unavailable');
        expect(controller.dirty, 'A session-only copy must remain unsaved').toBe(true);
        await expect(controller.create(createDefaultScene(), 'Another project')).rejects.toThrow(
            'Export'
        );
        expect(controller.project.id).toBe(copy.id);
    });
});
