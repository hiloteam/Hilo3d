import {
    createProject,
    parseProject,
    projectSummary,
    serializeProject,
    validateProject,
    type ProjectDocument,
    type ProjectSummary
} from './project';
import type { SceneDocument } from './scene';

const DATABASE = 'hilo-studio-projects';
const BACKUP_LIMIT = 10;
const DATABASE_VERSION = 2;
const REVISION_SUMMARIES = 'revision-summaries';

interface StoredProject {
    summary: ProjectSummary;
    source: string;
}

/** Another editor tab saved or deleted this project after the caller loaded it. */
export class ProjectConflictError extends Error {
    readonly projectId: string;
    readonly expectedRevision: number;
    readonly actualRevision: number | null;

    constructor(projectId: string, expectedRevision: number, actualRevision: number | null) {
        super(
            `Project changed in another tab: expected revision ${String(expectedRevision)}, found ${actualRevision === null ? 'no project' : String(actualRevision)}. Reload or save a copy.`
        );
        this.name = 'ProjectConflictError';
        this.projectId = projectId;
        this.expectedRevision = expectedRevision;
        this.actualRevision = actualRevision;
    }
}

/** Stored current data is damaged; previously committed revisions remain available for recovery. */
export class ProjectCorruptionError extends Error {
    readonly projectId: string;

    constructor(projectId: string, cause: unknown) {
        super(
            `Stored project ${projectId} could not be read. Recover a previous revision or import a backup.`,
            { cause }
        );
        this.name = 'ProjectCorruptionError';
        this.projectId = projectId;
    }
}

function request<T>(operation: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        operation.onsuccess = () => {
            resolve(operation.result);
        };
        operation.onerror = () => {
            reject(operation.error ?? new Error('IndexedDB request failed'));
        };
    });
}

function completion(transaction: IDBTransaction): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => {
            resolve();
        };
        transaction.onabort = () => {
            reject(transaction.error ?? new Error('Project transaction was aborted'));
        };
        transaction.onerror = () => {
            reject(transaction.error ?? new Error('Project transaction failed'));
        };
    });
}

function stored(value: unknown): StoredProject {
    if (!value || typeof value !== 'object') throw new Error('Stored project record is invalid');
    const summary: unknown = Reflect.get(value, 'summary');
    const source: unknown = Reflect.get(value, 'source');
    if (!summary || typeof summary !== 'object' || typeof source !== 'string')
        throw new Error('Stored project record is invalid');
    const id: unknown = Reflect.get(summary, 'id');
    const revision: unknown = Reflect.get(summary, 'revision');
    const updatedAt: unknown = Reflect.get(summary, 'updatedAt');
    if (
        typeof id !== 'string' ||
        typeof revision !== 'number' ||
        !Number.isSafeInteger(revision) ||
        revision < 1 ||
        typeof updatedAt !== 'string' ||
        !Number.isFinite(Date.parse(updatedAt))
    )
        throw new Error('Stored project metadata is invalid');
    return value as StoredProject;
}

function readDocument(value: unknown, id: string): ProjectDocument {
    try {
        const record = stored(value);
        const project = parseProject(record.source);
        if (project.id !== id || project.revision !== record.summary.revision)
            throw new Error('Stored project identity or revision mismatch');
        return project;
    } catch (cause) {
        throw new ProjectCorruptionError(id, cause);
    }
}

async function abort(transaction: IDBTransaction, done: Promise<void>): Promise<void> {
    try {
        transaction.abort();
    } catch {
        /* A failed or completed transaction is already inactive. */
    }
    await done.catch(() => undefined);
}

/** A successful request alone does not finish an IndexedDB transaction or release its connection. */
async function readTransaction<T>(
    database: IDBDatabase,
    storeName: string,
    operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
    const transaction = database.transaction(storeName, 'readonly');
    const done = completion(transaction);
    try {
        const result = request(operation(transaction.objectStore(storeName)));
        const [value] = await Promise.all([result, done]);
        return value;
    } catch (error) {
        await abort(transaction, done);
        throw error;
    }
}

/** Transactional local project repository with optimistic concurrency and ten recovery snapshots. */
export class ProjectStore {
    private constructor(private readonly database: IDBDatabase) {}

    /** Optional database name isolates test sessions or separate application profiles. */
    static async open(databaseName = DATABASE): Promise<ProjectStore> {
        const factory = Reflect.get(globalThis, 'indexedDB') as IDBFactory | undefined;
        if (!factory)
            throw new Error(
                'IndexedDB is unavailable; export a project file to preserve your work'
            );
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const opening = factory.open(databaseName, DATABASE_VERSION);
            let blocked = false;
            opening.onupgradeneeded = event => {
                const db = opening.result;
                if (event.oldVersion < 1) {
                    db.createObjectStore('projects', { keyPath: 'summary.id' });
                    db.createObjectStore('summaries', { keyPath: 'id' });
                    const revisions = db.createObjectStore('revisions', {
                        keyPath: ['summary.id', 'summary.revision']
                    });
                    revisions.createIndex('projectId', 'summary.id');
                }
                if (event.oldVersion < 2) {
                    const summaries = db.createObjectStore(REVISION_SUMMARIES, {
                        keyPath: ['id', 'revision']
                    });
                    summaries.createIndex('projectId', 'id');
                    const upgrade = opening.transaction;
                    if (!upgrade) throw new Error('Project upgrade transaction is unavailable');
                    const cursor = upgrade.objectStore('revisions').openCursor();
                    cursor.onsuccess = () => {
                        const entry = cursor.result;
                        if (!entry) return;
                        try {
                            const value: unknown = entry.value;
                            summaries.put(stored(value).summary);
                            entry.continue();
                        } catch {
                            // Migration and its metadata writes roll back together. Existing
                            // project data remains untouched if an old record cannot be read.
                            upgrade.abort();
                        }
                    };
                }
            };
            opening.onsuccess = () => {
                if (blocked) {
                    opening.result.close();
                    return;
                }
                resolve(opening.result);
            };
            opening.onerror = () => {
                reject(opening.error ?? new Error('Project database could not be opened'));
            };
            opening.onblocked = () => {
                blocked = true;
                reject(
                    new Error(
                        'Project database upgrade is blocked by another tab; close it and retry'
                    )
                );
            };
        });
        database.onversionchange = () => {
            database.close();
        };
        return new ProjectStore(database);
    }

    /** Release this tab's connection. */
    close(): void {
        this.database.close();
    }

    /** Lists metadata without reading or decoding asset payloads. */
    async list(): Promise<ProjectSummary[]> {
        const values = await readTransaction(
            this.database,
            'summaries',
            store => store.getAll() as IDBRequest<unknown[]>
        );
        return values
            .map(value => {
                if (
                    !value ||
                    typeof value !== 'object' ||
                    typeof Reflect.get(value, 'id') !== 'string' ||
                    typeof Reflect.get(value, 'updatedAt') !== 'string'
                )
                    throw new Error('Project summary is damaged');
                return value as ProjectSummary;
            })
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    async load(id: string): Promise<ProjectDocument | null> {
        const value = await readTransaction(
            this.database,
            'projects',
            store => store.get(id) as IDBRequest<unknown>
        );
        return value === undefined ? null : readDocument(value, id);
    }

    async create(scene: SceneDocument, name?: string): Promise<ProjectDocument> {
        return this.save(createProject(scene, name));
    }

    /** Atomically save current data and the previous revision; stale writers cannot overwrite it. */
    async save(
        project: ProjectDocument,
        expectedRevision = project.revision,
        signal?: AbortSignal
    ): Promise<ProjectDocument> {
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
            throw new Error('Expected revision must be a nonnegative integer');
        if (signal?.aborted) throw new Error('Project save cancelled.');
        const candidate = validateProject(project);
        const transaction = this.database.transaction(
            ['projects', 'summaries', 'revisions', REVISION_SUMMARIES],
            'readwrite'
        );
        const done = completion(transaction);
        const cancel = (): void => {
            try {
                transaction.abort();
            } catch {
                /* The transaction already completed. */
            }
        };
        signal?.addEventListener('abort', cancel, { once: true });
        try {
            const projects = transaction.objectStore('projects');
            const raw = await request(projects.get(candidate.id) as IDBRequest<unknown>);
            const previous = raw === undefined ? null : stored(raw);
            if ((previous?.summary.revision ?? 0) !== expectedRevision)
                throw new ProjectConflictError(
                    candidate.id,
                    expectedRevision,
                    previous?.summary.revision ?? null
                );
            if (previous && candidate.createdAt !== previous.summary.createdAt)
                throw new Error('Project creation time cannot change during save');
            candidate.revision = expectedRevision + 1;
            candidate.updatedAt = new Date(
                Math.max(
                    Date.now(),
                    Date.parse(candidate.createdAt),
                    previous ? Date.parse(previous.summary.updatedAt) + 1 : 0
                )
            ).toISOString();
            const current: StoredProject = {
                summary: projectSummary(candidate),
                source: serializeProject(candidate)
            };
            const revisions = transaction.objectStore('revisions');
            const recoverySummaries = transaction.objectStore(REVISION_SUMMARIES);
            if (previous) {
                revisions.put(previous);
                recoverySummaries.put(previous.summary);
            }
            projects.put(current);
            transaction.objectStore('summaries').put(current.summary);
            const backupKeys = await request(
                revisions.index('projectId').getAllKeys(IDBKeyRange.only(candidate.id))
            );
            for (const key of backupKeys.slice(0, Math.max(0, backupKeys.length - BACKUP_LIMIT))) {
                revisions.delete(key);
                recoverySummaries.delete(key);
            }
            await done;
            return candidate;
        } catch (error) {
            await abort(transaction, done);
            throw error;
        } finally {
            signal?.removeEventListener('abort', cancel);
        }
    }

    /** Recovery snapshots are newest first; the current revision is returned by load(). */
    async revisions(id: string): Promise<ProjectSummary[]> {
        const values = await readTransaction(
            this.database,
            REVISION_SUMMARIES,
            store => store.index('projectId').getAll(IDBKeyRange.only(id)) as IDBRequest<unknown[]>
        );
        return values
            .map(value => {
                if (
                    !value ||
                    typeof value !== 'object' ||
                    typeof Reflect.get(value, 'revision') !== 'number' ||
                    Reflect.get(value, 'id') !== id
                )
                    throw new Error('Project recovery metadata is damaged');
                return value as ProjectSummary;
            })
            .sort((a, b) => b.revision - a.revision);
    }

    async loadRevision(id: string, revision: number): Promise<ProjectDocument | null> {
        const value = await readTransaction(
            this.database,
            'revisions',
            store => store.get([id, revision]) as IDBRequest<unknown>
        );
        return value === undefined ? null : readDocument(value, id);
    }

    /** Restoring is a new commit; it preserves history and requires a current expected revision. */
    async restore(
        id: string,
        revision: number,
        expectedRevision: number
    ): Promise<ProjectDocument> {
        const project = await this.loadRevision(id, revision);
        if (!project) throw new Error('The requested project recovery revision is unavailable');
        return this.save(project, expectedRevision);
    }

    /** Delete current data and recovery snapshots only when the caller still owns this revision. */
    async delete(id: string, expectedRevision: number): Promise<void> {
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
            throw new Error('Delete requires the current saved project revision');
        const transaction = this.database.transaction(
            ['projects', 'summaries', 'revisions', REVISION_SUMMARIES],
            'readwrite'
        );
        const done = completion(transaction);
        try {
            const projects = transaction.objectStore('projects');
            const raw = await request(projects.get(id) as IDBRequest<unknown>);
            const previous = raw === undefined ? null : stored(raw);
            if (previous?.summary.revision !== expectedRevision)
                throw new ProjectConflictError(
                    id,
                    expectedRevision,
                    previous?.summary.revision ?? null
                );
            projects.delete(id);
            transaction.objectStore('summaries').delete(id);
            const revisions = transaction.objectStore('revisions');
            const keys = await request(
                revisions.index('projectId').getAllKeys(IDBKeyRange.only(id))
            );
            const recoverySummaries = transaction.objectStore(REVISION_SUMMARIES);
            for (const key of keys) {
                revisions.delete(key);
                recoverySummaries.delete(key);
            }
            await done;
        } catch (error) {
            await abort(transaction, done);
            throw error;
        }
    }
}
