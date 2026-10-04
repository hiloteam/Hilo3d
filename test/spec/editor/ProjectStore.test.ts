import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject, projectSummary, serializeProject } from '../../../editor/project';
import {
    ProjectConflictError,
    ProjectCorruptionError,
    ProjectStore
} from '../../../editor/project-store';
import { createDefaultScene } from '../../../editor/scene';

const stores: ProjectStore[] = [];
const databases = new Set<string>();

async function open(
    name = `hilo-editor-test-${crypto.randomUUID()}`
): Promise<{ store: ProjectStore; name: string }> {
    const store = await ProjectStore.open(name);
    stores.push(store);
    databases.add(name);
    return { store, name };
}

function deleteDatabase(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const operation = indexedDB.deleteDatabase(name);
        operation.onsuccess = () => {
            resolve();
        };
        operation.onerror = () => {
            reject(operation.error ?? new Error('Database deletion failed'));
        };
        operation.onblocked = () => {
            reject(new Error('Test database remained open'));
        };
    });
}

afterEach(async () => {
    vi.restoreAllMocks();
    for (const store of stores.splice(0)) store.close();
    await Promise.all([...databases].map(deleteDatabase));
    databases.clear();
});

describe('editor IndexedDB project storage', () => {
    it('migrates version1 projects and recovery metadata without rewriting source bundles', async () => {
        const name = `hilo-editor-migration-${crypto.randomUUID()}`;
        databases.add(name);
        const first = createProject(createDefaultScene(), 'Before migration');
        first.revision = 1;
        const second = { ...first, revision: 2, name: 'Current project' };
        await new Promise<void>((resolve, reject) => {
            const opening = indexedDB.open(name, 1);
            opening.onupgradeneeded = () => {
                const db = opening.result;
                db.createObjectStore('projects', { keyPath: 'summary.id' });
                db.createObjectStore('summaries', { keyPath: 'id' });
                db.createObjectStore('revisions', {
                    keyPath: ['summary.id', 'summary.revision']
                }).createIndex('projectId', 'summary.id');
            };
            opening.onerror = () => {
                reject(opening.error ?? new Error('Legacy database failed'));
            };
            opening.onsuccess = () => {
                const db = opening.result;
                const transaction = db.transaction(
                    ['projects', 'summaries', 'revisions'],
                    'readwrite'
                );
                transaction
                    .objectStore('projects')
                    .put({ summary: projectSummary(second), source: serializeProject(second) });
                transaction.objectStore('summaries').put(projectSummary(second));
                transaction
                    .objectStore('revisions')
                    .put({ summary: projectSummary(first), source: serializeProject(first) });
                transaction.oncomplete = () => {
                    db.close();
                    resolve();
                };
                transaction.onabort = () => {
                    db.close();
                    reject(transaction.error ?? new Error('Legacy data write failed'));
                };
            };
        });
        const { store } = await open(name);
        expect(await store.load(second.id)).toEqual(second);
        expect(await store.revisions(second.id)).toEqual([projectSummary(first)]);
        expect(await store.loadRevision(second.id, 1)).toEqual(first);
        const restored = await store.restore(second.id, 1, 2);
        expect(restored.revision).toBe(3);
        expect(restored.name).toBe('Before migration');
    });

    it('reads revision summaries without loading asset-bearing historical bundles', async () => {
        const { store } = await open();
        const first = await store.create(createDefaultScene(), 'Original');
        await store.save({ ...first, name: 'Second' });
        const originalGetAll = Reflect.get(IDBIndex.prototype, 'getAll') as (
            this: IDBIndex,
            query?: IDBValidKey | IDBKeyRange | null,
            count?: number
        ) => IDBRequest<unknown[]>;
        const mock = vi.spyOn(IDBIndex.prototype, 'getAll').mockImplementation(function (
            this: IDBIndex,
            query?: IDBValidKey | IDBKeyRange | null,
            count?: number
        ): IDBRequest<unknown[]> {
            if (this.objectStore.name === 'revisions')
                throw new Error('Historical payloads must not be loaded for summaries');
            return originalGetAll.call(this, query, count);
        });
        expect(await store.revisions(first.id)).toEqual([projectSummary(first)]);
        mock.mockRestore();
    });

    it('creates, lists and reloads isolated scene projects across connections', async () => {
        const { store, name } = await open();
        const saved = await store.create(createDefaultScene(), 'Project One');
        expect(saved.revision).toBe(1);
        const other = (await open(name)).store;
        expect(await other.load(saved.id)).toEqual(saved);
        expect(await store.list()).toEqual([projectSummary(saved)]);
        const copy = await other.load(saved.id);
        if (!copy) throw new Error('Missing saved project');
        copy.name = 'In memory only';
        expect((await store.load(saved.id))?.name).toBe('Project One');
        expect(await store.load('missing-project')).toBeNull();
    });

    it('resolves read APIs only after their readonly transactions have completed', async () => {
        const { store } = await open();
        const first = await store.create(createDefaultScene());
        await store.save({ ...first, name: 'Second revision' });
        const observed = new Set<IDBTransaction>();
        const completed = new Set<IDBTransaction>();
        const nativeTransaction = Reflect.get(IDBDatabase.prototype, 'transaction');
        const transactions = vi
            .spyOn(IDBDatabase.prototype, 'transaction')
            .mockImplementation(function (
                this: IDBDatabase,
                ...arguments_: Parameters<IDBDatabase['transaction']>
            ): IDBTransaction {
                const transaction = nativeTransaction.apply(this, arguments_);
                if (transaction.mode === 'readonly') {
                    observed.add(transaction);
                    transaction.addEventListener(
                        'complete',
                        () => {
                            completed.add(transaction);
                        },
                        { once: true }
                    );
                }
                return transaction;
            });
        try {
            const operations = [
                () => store.load(first.id),
                () => store.list(),
                () => store.revisions(first.id),
                () => store.loadRevision(first.id, 1)
            ];
            for (const operation of operations) {
                await operation();
                expect(
                    [...observed].every(transaction => completed.has(transaction)),
                    'Resolved reads must not retain an active IndexedDB transaction'
                ).toBe(true);
            }
            expect(observed.size).toBe(4);
        } finally {
            transactions.mockRestore();
        }
    });

    it('rejects a readonly transaction aborted after request success and releases it cleanly', async () => {
        const { store } = await open();
        const original = await store.create(createDefaultScene());
        const nativeGet = Reflect.get(IDBObjectStore.prototype, 'get');
        const reads = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (
            this: IDBObjectStore,
            key: IDBValidKey | IDBKeyRange
        ): IDBRequest<unknown> {
            const operation = nativeGet.call(this, key) as IDBRequest<unknown>;
            operation.addEventListener(
                'success',
                () => {
                    operation.transaction?.abort();
                },
                { once: true }
            );
            return operation;
        });
        await expect(store.load(original.id)).rejects.toThrow();
        reads.mockRestore();
        await expect(store.loadRevision(original.id, Number.NaN)).rejects.toThrow();
        expect(await store.load(original.id)).toEqual(original);
    });

    it('serializes competing saves atomically and exposes the losing revision conflict', async () => {
        const { store, name } = await open();
        const other = (await open(name)).store;
        const initial = await store.create(createDefaultScene(), 'Original');
        const results = await Promise.allSettled([
            store.save({ ...initial, name: 'First tab' }),
            other.save({ ...initial, name: 'Second tab' })
        ]);
        const successes = results.filter(result => result.status === 'fulfilled');
        const failures = results.filter(result => result.status === 'rejected');
        expect(successes).toHaveLength(1);
        expect(failures).toHaveLength(1);
        const failure = failures[0];
        if (!failure) throw new Error('Expected a conflict');
        expect(failure.reason).toBeInstanceOf(ProjectConflictError);
        const current = await store.load(initial.id);
        expect(current?.revision).toBe(2);
        expect((await store.revisions(initial.id)).map(item => item.revision)).toEqual([1]);
        expect((await store.loadRevision(initial.id, 1))?.name).toBe('Original');
        await expect(store.delete(initial.id, 1)).rejects.toBeInstanceOf(ProjectConflictError);
        expect((await store.load(initial.id))?.revision).toBe(2);
    });

    it('rolls back current data, metadata and recovery history together when storage fails', async () => {
        const { store } = await open();
        const initial = await store.create(createDefaultScene(), 'Before quota failure');
        const originalPut = Reflect.get(IDBObjectStore.prototype, 'put') as (
            this: IDBObjectStore,
            value: unknown,
            key?: IDBValidKey
        ) => IDBRequest<IDBValidKey>;
        const mock = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
            this: IDBObjectStore,
            value: unknown,
            key?: IDBValidKey
        ): IDBRequest<IDBValidKey> {
            if (this.name === 'summaries')
                throw new DOMException('Quota exceeded', 'QuotaExceededError');
            return key === undefined
                ? originalPut.call(this, value)
                : originalPut.call(this, value, key);
        });
        await expect(store.save({ ...initial, name: 'Must roll back' })).rejects.toThrow(
            'Quota exceeded'
        );
        mock.mockRestore();
        expect(await store.load(initial.id)).toEqual(initial);
        expect(await store.list()).toEqual([projectSummary(initial)]);
        expect(await store.revisions(initial.id)).toEqual([]);
    });

    it('aborts an active save atomically after writes were queued and permits a clean subsequent save', async () => {
        const { store } = await open();
        const original = await store.create(createDefaultScene(), 'Before cancellation');
        const cancellation = new AbortController();
        const nativePut = Reflect.get(IDBObjectStore.prototype, 'put');
        const writes = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
            this: IDBObjectStore,
            value: unknown,
            key?: IDBValidKey
        ): IDBRequest<IDBValidKey> {
            const request =
                key === undefined ? nativePut.call(this, value) : nativePut.call(this, value, key);
            if (this.name === 'summaries')
                queueMicrotask(() => {
                    cancellation.abort();
                });
            return request;
        });
        await expect(
            store.save(
                { ...original, name: 'Canceled changes' },
                original.revision,
                cancellation.signal
            )
        ).rejects.toThrow();
        writes.mockRestore();
        expect(await store.load(original.id)).toEqual(original);
        expect(await store.list()).toEqual([projectSummary(original)]);
        expect(await store.revisions(original.id)).toEqual([]);
        const saved = await store.save({ ...original, name: 'Subsequent save' });
        expect(saved.revision).toBe(2);
        expect((await store.load(original.id))?.name).toBe('Subsequent save');
        expect((await store.revisions(original.id)).map(item => item.revision)).toEqual([1]);
    });

    it('retains ten recovery revisions and restores content as a new commit', async () => {
        const { store } = await open();
        let project = await store.create(createDefaultScene(), 'Revision 1');
        for (let revision = 2; revision <= 13; revision += 1)
            project = await store.save({ ...project, name: `Revision ${String(revision)}` });
        expect((await store.revisions(project.id)).map(item => item.revision)).toEqual([
            12, 11, 10, 9, 8, 7, 6, 5, 4, 3
        ]);
        expect(await store.loadRevision(project.id, 1)).toBeNull();
        const restored = await store.restore(project.id, 3, 13);
        expect(restored.revision).toBe(14);
        expect(restored.name).toBe('Revision 3');
        expect((await store.loadRevision(project.id, 13))?.name).toBe('Revision 13');
        await expect(store.restore(project.id, 4, 13)).rejects.toBeInstanceOf(ProjectConflictError);
        expect((await store.load(project.id))?.revision).toBe(14);
    });

    it('recovers a corrupt latest payload while preserving valid historical snapshots', async () => {
        const { store, name } = await open();
        const initial = await store.create(createDefaultScene(), 'Recover this');
        const latest = await store.save({ ...initial, name: 'Current revision' });
        await new Promise<void>((resolve, reject) => {
            const opening = indexedDB.open(name);
            opening.onerror = () => {
                reject(opening.error ?? new Error('Database open failed'));
            };
            opening.onsuccess = () => {
                const db = opening.result;
                const transaction = db.transaction('projects', 'readwrite');
                transaction
                    .objectStore('projects')
                    .put({ summary: projectSummary(latest), source: '{corrupt' });
                transaction.oncomplete = () => {
                    db.close();
                    resolve();
                };
                transaction.onabort = () => {
                    db.close();
                    reject(transaction.error ?? new Error('Database write failed'));
                };
            };
        });
        await expect(store.load(latest.id)).rejects.toBeInstanceOf(ProjectCorruptionError);
        const restored = await store.restore(latest.id, 1, 2);
        expect(restored.name).toBe('Recover this');
        expect(restored.revision).toBe(3);
        expect(await store.load(latest.id)).toEqual(restored);
    });

    it('does not resurrect projects from stale tabs and rejects invalid imports before writing', async () => {
        const { store } = await open();
        const project = await store.create(createDefaultScene());
        const latest = await store.save({ ...project, name: 'Latest' });
        await store.delete(latest.id, latest.revision);
        expect(await store.load(latest.id)).toBeNull();
        expect(await store.list()).toEqual([]);
        expect(await store.revisions(latest.id)).toEqual([]);
        await expect(store.save(latest)).rejects.toBeInstanceOf(ProjectConflictError);
        const invalid = createProject(createDefaultScene());
        invalid.activeSceneId = 'missing';
        await expect(store.save(invalid)).rejects.toThrow('missing scene');
        expect(await store.list()).toEqual([]);
    });
});
