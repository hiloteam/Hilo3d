import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
    mkdir,
    open,
    readdir,
    readFile,
    rename,
    stat,
    unlink,
    type FileHandle
} from 'node:fs/promises';
import { join } from 'node:path';
import { validateProject, type ProjectDocument } from '../project';

export type RoomRole = 'editor' | 'viewer';

export interface RoomRevision {
    revision: number;
    updatedAt: string;
    project: ProjectDocument;
}

interface RoomFile {
    format: 'hilo-editor-room';
    version: 1;
    id: string;
    tokens: Record<RoomRole, string>;
    history: RoomRevision[];
}

interface RoomEntry {
    data: RoomFile;
    bytes: number;
}

export interface RoomStoreOptions {
    dataDirectory: string;
    maxRooms?: number;
    maxRevisions?: number;
    maxProjectBytes?: number;
    maxRoomBytes?: number;
    maxStorageBytes?: number;
}

export class RoomError extends Error {
    constructor(
        readonly status: number,
        message: string,
        readonly revision?: number
    ) {
        super(message);
        this.name = 'RoomError';
    }
}

export function tokenHash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

export function tokenMatches(token: string, hash: string): boolean {
    const actual = Buffer.from(tokenHash(token), 'hex');
    const expected = Buffer.from(hash, 'hex');
    return expected.length === actual.length && timingSafeEqual(actual, expected);
}

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid stored room');
    return value as Record<string, unknown>;
}

function positive(value: number | undefined, fallback: number, maximum: number): number {
    const result = value ?? fallback;
    if (!Number.isSafeInteger(result) || result < 1 || result > maximum)
        throw new Error('Invalid collaboration storage limit');
    return result;
}

/** Serial, atomic snapshot store. A failed write blocks further mutations until restart. */
export class RoomStore {
    readonly maxProjectBytes: number;
    private readonly maxRooms: number;
    private readonly maxRevisions: number;
    private readonly maxRoomBytes: number;
    private readonly maxStorageBytes: number;
    private readonly rooms = new Map<string, RoomEntry>();
    private queue: Promise<void> = Promise.resolve();
    private totalBytes = 0;
    private failed = false;
    private lock: FileHandle | null = null;
    private readonly lockIdentity = `${String(process.pid)}:${randomUUID()}`;

    private constructor(
        private readonly directory: string,
        options: RoomStoreOptions
    ) {
        this.maxRooms = positive(options.maxRooms, 32, 1000);
        this.maxRevisions = positive(options.maxRevisions, 20, 100);
        this.maxProjectBytes = positive(
            options.maxProjectBytes,
            24 * 1024 * 1024,
            96 * 1024 * 1024
        );
        this.maxRoomBytes = positive(options.maxRoomBytes, 128 * 1024 * 1024, 512 * 1024 * 1024);
        this.maxStorageBytes = positive(
            options.maxStorageBytes,
            512 * 1024 * 1024,
            8 * 1024 * 1024 * 1024
        );
        if (this.maxProjectBytes + 4096 > this.maxRoomBytes)
            throw new Error('Room storage limit must allow one project snapshot plus metadata');
    }

    static async open(options: RoomStoreOptions): Promise<RoomStore> {
        const store = new RoomStore(options.dataDirectory, options);
        await mkdir(options.dataDirectory, { recursive: true, mode: 0o700 });
        try {
            store.lock = await open(
                join(options.dataDirectory, '.hilo-collaboration.lock'),
                'wx',
                0o600
            );
            await store.lock.writeFile(store.lockIdentity, 'utf8');
            await store.lock.sync();
        } catch (cause) {
            if (store.lock) await store.close();
            throw new Error(
                `Collaboration data directory is locked or unavailable. Stop the other server; after a crash, remove .hilo-collaboration.lock only after verifying no server is running. ${cause instanceof Error ? cause.message : ''}`,
                { cause }
            );
        }
        try {
            for (const entry of await readdir(options.dataDirectory, { withFileTypes: true })) {
                if (entry.isFile() && /^\.room-write-[a-f0-9-]{36}\.tmp$/u.test(entry.name)) {
                    await unlink(join(options.dataDirectory, entry.name));
                    continue;
                }
                if (!entry.isFile() || !/^room-[a-f0-9-]{36}\.json$/u.test(entry.name)) continue;
                if (store.rooms.size >= store.maxRooms)
                    throw new Error('Stored room count exceeds configured maximum');
                const path = join(options.dataDirectory, entry.name);
                const info = await stat(path);
                if (
                    info.size > store.maxRoomBytes ||
                    store.totalBytes + info.size > store.maxStorageBytes
                )
                    throw new Error('Stored room data exceeds configured budget');
                const room = store.parseRoom(JSON.parse(await readFile(path, 'utf8')) as unknown);
                if (`${room.id}.json` !== entry.name)
                    throw new Error('Stored room ID does not match file name');
                store.rooms.set(room.id, { data: room, bytes: info.size });
                store.totalBytes += info.size;
            }
            return store;
        } catch (cause) {
            await store.close();
            throw cause;
        }
    }

    async close(): Promise<void> {
        await this.queue;
        const lock = this.lock;
        this.lock = null;
        if (!lock) return;
        await lock.close();
        const path = join(this.directory, '.hilo-collaboration.lock');
        const owner = await readFile(path, 'utf8').catch(() => '');
        if (owner === this.lockIdentity) await unlink(path);
    }

    authenticate(id: string, token: string): RoomRole {
        const room = this.rooms.get(id);
        // Compare fixed-size hashes even for an unknown room, without revealing room existence.
        const editor = tokenMatches(token, room?.data.tokens.editor ?? '0'.repeat(64));
        const viewer = tokenMatches(token, room?.data.tokens.viewer ?? '0'.repeat(64));
        if (!room || (!editor && !viewer)) throw new RoomError(401, 'Invalid room capability');
        return editor ? 'editor' : 'viewer';
    }

    latest(id: string): RoomRevision {
        const snapshot = this.requireRoom(id).history.at(-1);
        if (!snapshot) throw new RoomError(500, 'Room has no recoverable revision');
        return snapshot;
    }

    revision(id: string, revision: number): RoomRevision {
        const snapshot = this.requireRoom(id).history.find(entry => entry.revision === revision);
        if (!snapshot) throw new RoomError(404, 'Revision is no longer retained');
        return snapshot;
    }

    revisions(id: string): { revision: number; updatedAt: string; name: string }[] {
        return this.requireRoom(id)
            .history.map(entry => ({
                revision: entry.revision,
                updatedAt: entry.updatedAt,
                name: entry.project.name
            }))
            .reverse();
    }

    list(): { roomId: string; name: string; revision: number; updatedAt: string }[] {
        return [...this.rooms.keys()].map(id => {
            const latest = this.latest(id);
            return {
                roomId: id,
                name: latest.project.name,
                revision: latest.revision,
                updatedAt: latest.updatedAt
            };
        });
    }

    async rotate(
        id: string,
        selectedRole: RoomRole | 'all'
    ): Promise<{ roomId: string; editorToken?: string; viewerToken?: string }> {
        return this.exclusive(async () => {
            const previous = this.requireRoom(id);
            const tokens = { ...previous.tokens };
            const result: { roomId: string; editorToken?: string; viewerToken?: string } = {
                roomId: id
            };
            if (selectedRole === 'all' || selectedRole === 'editor') {
                result.editorToken = randomBytes(32).toString('base64url');
                tokens.editor = tokenHash(result.editorToken);
            }
            if (selectedRole === 'all' || selectedRole === 'viewer') {
                result.viewerToken = randomBytes(32).toString('base64url');
                tokens.viewer = tokenHash(result.viewerToken);
            }
            await this.commit({ ...previous, tokens });
            return result;
        });
    }

    async delete(id: string): Promise<void> {
        await this.exclusive(async () => {
            this.requireRoom(id);
            try {
                await unlink(join(this.directory, `${id}.json`));
                const directory = await open(this.directory, 'r');
                try {
                    await directory.sync();
                } finally {
                    await directory.close();
                }
                this.totalBytes -= this.rooms.get(id)?.bytes ?? 0;
                this.rooms.delete(id);
            } catch (cause) {
                this.failed = true;
                throw new RoomError(
                    503,
                    `Durable room deletion failed: ${cause instanceof Error ? cause.message : 'storage unavailable'}`
                );
            }
        });
    }

    async create(project: unknown): Promise<{
        roomId: string;
        editorToken: string;
        viewerToken: string;
        snapshot: RoomRevision;
    }> {
        const validated = this.project(project);
        return this.exclusive(async () => {
            if (this.rooms.size >= this.maxRooms) throw new RoomError(507, 'Room limit reached');
            const id = `room-${randomUUID()}`;
            const editorToken = randomBytes(32).toString('base64url');
            const viewerToken = randomBytes(32).toString('base64url');
            const snapshot = {
                revision: 1,
                updatedAt: new Date().toISOString(),
                project: validated
            };
            const room: RoomFile = {
                format: 'hilo-editor-room',
                version: 1,
                id,
                tokens: { editor: tokenHash(editorToken), viewer: tokenHash(viewerToken) },
                history: [snapshot]
            };
            await this.commit(room);
            return { roomId: id, editorToken, viewerToken, snapshot };
        });
    }

    async publish(
        id: string,
        baseRevision: number,
        project: unknown,
        token: string
    ): Promise<RoomRevision> {
        const validated = this.project(project);
        return this.exclusive(async () => {
            if (this.authenticate(id, token) !== 'editor')
                throw new RoomError(403, 'Viewer capabilities cannot publish');
            const previous = this.requireRoom(id);
            const current = this.latest(id);
            if (current.revision !== baseRevision)
                throw new RoomError(
                    409,
                    'Shared project changed; resolve the conflict before publishing',
                    current.revision
                );
            if (current.project.id !== validated.id)
                throw new RoomError(
                    422,
                    'A room cannot change project identity; create another room for a different project'
                );
            const snapshot: RoomRevision = {
                revision: current.revision + 1,
                updatedAt: new Date().toISOString(),
                project: validated
            };
            const history = [...previous.history, snapshot].slice(-this.maxRevisions);
            let estimated = history.reduce(
                (sum, entry) => sum + Buffer.byteLength(JSON.stringify(entry)),
                4096
            );
            while (history.length > 1 && estimated > this.maxRoomBytes) {
                const removed = history.shift();
                if (removed) estimated -= Buffer.byteLength(JSON.stringify(removed));
            }
            await this.commit({ ...previous, history });
            return snapshot;
        });
    }

    private project(value: unknown): ProjectDocument {
        const project = validateProject(value);
        if (Buffer.byteLength(JSON.stringify(project)) > this.maxProjectBytes)
            throw new RoomError(413, 'Project exceeds this server’s collaboration size limit');
        return project;
    }

    private requireRoom(id: string): RoomFile {
        const room = this.rooms.get(id)?.data;
        if (!room) throw new RoomError(404, 'Room not found');
        return room;
    }

    private parseRoom(value: unknown): RoomFile {
        const input = object(value);
        if (
            input['format'] !== 'hilo-editor-room' ||
            input['version'] !== 1 ||
            typeof input['id'] !== 'string' ||
            !/^room-[a-f0-9-]{36}$/u.test(input['id'])
        )
            throw new Error('Invalid stored room format');
        const tokens = object(input['tokens']);
        if (
            typeof tokens['editor'] !== 'string' ||
            typeof tokens['viewer'] !== 'string' ||
            !/^[a-f0-9]{64}$/u.test(tokens['editor']) ||
            !/^[a-f0-9]{64}$/u.test(tokens['viewer'])
        )
            throw new Error('Invalid stored room token hashes');
        const rawHistory = input['history'];
        if (
            !Array.isArray(rawHistory) ||
            !rawHistory.length ||
            rawHistory.length > this.maxRevisions
        )
            throw new Error('Invalid stored room recovery history');
        let previousRevision = 0;
        let projectId = '';
        const history = rawHistory.map((entry: unknown): RoomRevision => {
            const row = object(entry);
            const revision = row['revision'];
            const updatedAt = row['updatedAt'];
            if (
                typeof revision !== 'number' ||
                !Number.isSafeInteger(revision) ||
                revision < 1 ||
                (previousRevision !== 0 && revision !== previousRevision + 1) ||
                typeof updatedAt !== 'string' ||
                !Number.isFinite(Date.parse(updatedAt))
            )
                throw new Error('Invalid stored room revision');
            const project = this.project(row['project']);
            if (projectId && project.id !== projectId)
                throw new Error('Stored room revisions have inconsistent project identity');
            previousRevision = revision;
            projectId = project.id;
            return { revision, updatedAt, project };
        });
        return {
            format: 'hilo-editor-room',
            version: 1,
            id: input['id'],
            tokens: { editor: tokens['editor'], viewer: tokens['viewer'] },
            history
        };
    }

    private async exclusive<T>(action: () => Promise<T>): Promise<T> {
        const previous = this.queue;
        let release: () => void = () => undefined;
        this.queue = new Promise<void>(resolve => {
            release = resolve;
        });
        await previous;
        try {
            if (this.failed)
                throw new RoomError(
                    503,
                    'Storage failed; restart the server after repairing storage'
                );
            return await action();
        } finally {
            release();
        }
    }

    private async commit(room: RoomFile): Promise<void> {
        const source = JSON.stringify(room);
        const bytes = Buffer.byteLength(source);
        const previousBytes = this.rooms.get(room.id)?.bytes ?? 0;
        if (
            bytes > this.maxRoomBytes ||
            this.totalBytes - previousBytes + bytes > this.maxStorageBytes
        )
            throw new RoomError(507, 'Collaboration storage budget exhausted');
        const temporary = join(this.directory, `.room-write-${randomUUID()}.tmp`);
        let handle;
        try {
            handle = await open(temporary, 'wx', 0o600);
            await handle.writeFile(source, 'utf8');
            await handle.sync();
            await handle.close();
            handle = undefined;
            await rename(temporary, join(this.directory, `${room.id}.json`));
            const directory = await open(this.directory, 'r');
            try {
                await directory.sync();
            } finally {
                await directory.close();
            }
            this.rooms.set(room.id, { data: room, bytes });
            this.totalBytes += bytes - previousBytes;
        } catch (cause) {
            this.failed = true;
            await handle?.close().catch(() => undefined);
            await unlink(temporary).catch(() => undefined);
            throw new RoomError(
                503,
                `Durable room write failed: ${cause instanceof Error ? cause.message : 'storage unavailable'}`
            );
        }
    }
}
