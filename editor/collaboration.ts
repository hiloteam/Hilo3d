import { validateProject, type ProjectDocument } from './project';

export type CollaborationRole = 'editor' | 'viewer';
export type CollaborationState =
    'disconnected' | 'connecting' | 'connected' | 'offline' | 'conflict';
export interface CollaborationConnection {
    url: string;
    roomId: string;
    token: string;
    displayName: string;
}
export interface CollaborationSnapshot {
    roomId: string;
    revision: number;
    updatedAt: string;
    role: CollaborationRole;
    project: ProjectDocument;
}
export interface CollaborationPeer {
    id: string;
    displayName: string;
    role: CollaborationRole;
}
export interface CollaborationRevision {
    revision: number;
    updatedAt: string;
    name: string;
}
export interface CollaborationCallbacks {
    onStatus?: (state: CollaborationState, message: string) => void;
    onRemote?: (snapshot: CollaborationSnapshot) => void | Promise<void>;
    onPresence?: (peers: readonly CollaborationPeer[]) => void;
    onConflict?: (snapshot: CollaborationSnapshot) => void;
}
export interface CreatedCollaborationRoom extends CollaborationSnapshot {
    editorToken: string;
    viewerToken: string;
}
export interface CollaborationRoomSummary extends CollaborationRevision {
    roomId: string;
}
export interface RotatedCollaborationCapabilities {
    roomId: string;
    editorToken?: string;
    viewerToken?: string;
}
interface PendingPublication {
    roomId: string;
    baseRevision: number;
    project: ProjectDocument;
}

export class CollaborationRequestError extends Error {
    constructor(
        readonly status: number,
        message: string
    ) {
        super(message);
        this.name = 'CollaborationRequestError';
    }
}
export class CollaborationConflictError extends Error {
    constructor(readonly snapshot: CollaborationSnapshot) {
        super(
            'Shared project changed. Local changes are retained for explicit conflict resolution.'
        );
        this.name = 'CollaborationConflictError';
    }
}

const MAX_RESPONSE_BYTES = 100 * 1024 * 1024;

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid collaboration response');
    return value as Record<string, unknown>;
}
function revision(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
        throw new Error('Invalid collaboration revision');
    return value;
}
function role(value: unknown): CollaborationRole {
    if (value !== 'editor' && value !== 'viewer') throw new Error('Invalid collaboration role');
    return value;
}
function timestamp(value: unknown): string {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
        throw new Error('Invalid collaboration timestamp');
    return value;
}
function capability(value: string): string {
    if (!/^[A-Za-z0-9_-]{32,256}$/u.test(value))
        throw new Error('Enter a valid room or admin capability token.');
    return value;
}
function roomId(value: unknown): string {
    if (typeof value !== 'string' || !/^room-[a-f0-9-]{36}$/u.test(value))
        throw new Error('Enter a valid room ID.');
    return value;
}

/** Require HTTPS outside loopback. Authentication is never encoded into a URL. */
export function collaborationServerUrl(value: string): string {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash)
        throw new Error('Server URL cannot contain credentials, query parameters or fragments.');
    const local =
        url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
        throw new Error('Remote collaboration requires HTTPS; HTTP is supported on loopback only.');
    return url.href.replace(/\/+$/u, '');
}

function readSnapshot(value: unknown): CollaborationSnapshot {
    const data = object(value);
    return {
        roomId: roomId(data['roomId']),
        revision: revision(data['revision']),
        updatedAt: timestamp(data['updatedAt']),
        role: role(data['role']),
        project: validateProject(data['project'])
    };
}

/** Compare authored content independently of this browser's IndexedDB identity and save counter. */
export function sameCollaborationContent(left: ProjectDocument, right: ProjectDocument): boolean {
    const authored = (value: ProjectDocument): string => {
        const data: Record<string, unknown> = { ...validateProject(value) };
        delete data['id'];
        delete data['revision'];
        delete data['createdAt'];
        delete data['updatedAt'];
        return JSON.stringify(data);
    };
    return authored(left) === authored(right);
}

async function json(response: Response): Promise<unknown> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Collaboration server returned no response body');
    const decoder = new TextDecoder();
    const parts: string[] = [];
    let bytes = 0;
    let complete = false;
    try {
        for (;;) {
            const next = await reader.read();
            if (next.done) {
                complete = true;
                break;
            }
            bytes += next.value.byteLength;
            if (bytes > MAX_RESPONSE_BYTES)
                throw new Error('Collaboration response exceeds the project size limit');
            parts.push(decoder.decode(next.value, { stream: true }));
        }
        parts.push(decoder.decode());
        const value: unknown = JSON.parse(parts.join(''));
        if (!response.ok) {
            const body = object(value);
            throw new CollaborationRequestError(
                response.status,
                typeof body['error'] === 'string'
                    ? body['error']
                    : `Server returned ${String(response.status)}`
            );
        }
        return value;
    } finally {
        if (!complete) await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}

async function authenticatedJson(
    url: string,
    token: string,
    options: {
        method?: string;
        body?: unknown;
        signal?: AbortSignal;
        headers?: Record<string, string>;
    } = {}
): Promise<unknown> {
    const controller = new AbortController();
    const abort = (): void => {
        controller.abort();
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    const timeout = setTimeout(abort, 20_000);
    try {
        const response = await fetch(url, {
            method: options.method ?? 'GET',
            signal: controller.signal,
            credentials: 'omit',
            cache: 'no-store',
            referrerPolicy: 'no-referrer',
            headers: {
                Authorization: `Bearer ${capability(token)}`,
                ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
                ...options.headers
            },
            ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
        });
        return await json(response);
    } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', abort);
    }
}

/** Create a room through the administrator capability; plaintext invite tokens are returned once. */
export async function createCollaborationRoom(options: {
    url: string;
    adminToken: string;
    project: ProjectDocument;
    signal?: AbortSignal;
}): Promise<CreatedCollaborationRoom> {
    const value = object(
        await authenticatedJson(
            `${collaborationServerUrl(options.url)}/rooms`,
            options.adminToken,
            {
                method: 'POST',
                body: { project: validateProject(options.project) },
                ...(options.signal ? { signal: options.signal } : {})
            }
        )
    );
    const editorToken = value['editorToken'];
    const viewerToken = value['viewerToken'];
    if (typeof editorToken !== 'string' || typeof viewerToken !== 'string')
        throw new Error('Server did not return invite capabilities');
    return {
        ...readSnapshot(value),
        editorToken: capability(editorToken),
        viewerToken: capability(viewerToken)
    };
}

export async function listCollaborationRooms(options: {
    url: string;
    adminToken: string;
}): Promise<CollaborationRoomSummary[]> {
    const body = object(
        await authenticatedJson(`${collaborationServerUrl(options.url)}/rooms`, options.adminToken)
    );
    const rows = body['rooms'];
    if (!Array.isArray(rows) || rows.length > 1000)
        throw new Error('Invalid administration room list');
    return rows.map((entry: unknown) => {
        const row = object(entry);
        if (typeof row['name'] !== 'string') throw new Error('Invalid room name');
        return {
            roomId: roomId(row['roomId']),
            name: row['name'],
            revision: revision(row['revision']),
            updatedAt: timestamp(row['updatedAt'])
        };
    });
}

export async function rotateCollaborationCapabilities(options: {
    url: string;
    roomId: string;
    adminToken: string;
    role: CollaborationRole | 'all';
}): Promise<RotatedCollaborationCapabilities> {
    const value = object(
        await authenticatedJson(
            `${collaborationServerUrl(options.url)}/rooms/${roomId(options.roomId)}/capabilities`,
            options.adminToken,
            { method: 'POST', body: { role: options.role } }
        )
    );
    const result: RotatedCollaborationCapabilities = { roomId: roomId(value['roomId']) };
    if (typeof value['editorToken'] === 'string')
        result.editorToken = capability(value['editorToken']);
    if (typeof value['viewerToken'] === 'string')
        result.viewerToken = capability(value['viewerToken']);
    if (!result.editorToken && !result.viewerToken)
        throw new Error('No replacement capabilities returned');
    return result;
}

export async function deleteCollaborationRoom(options: {
    url: string;
    roomId: string;
    adminToken: string;
}): Promise<void> {
    await authenticatedJson(
        `${collaborationServerUrl(options.url)}/rooms/${roomId(options.roomId)}`,
        options.adminToken,
        { method: 'DELETE', body: { confirmRoomId: options.roomId } }
    );
}

/** Fetch/SSE client. Unsent local work survives transport loss; conflicts never overwrite it. */
export class CollaborationClient {
    private connection: CollaborationConnection | null = null;
    private callbacks: CollaborationCallbacks = {};
    private controller: AbortController | null = null;
    private streamController: AbortController | null = null;
    private stateValue: CollaborationState = 'disconnected';
    private revisionValue = 0;
    private roleValue: CollaborationRole | null = null;
    private presenceValue: CollaborationPeer[] = [];
    private pending: PendingPublication | null = null;
    private latest: CollaborationSnapshot | null = null;
    private generation = 0;
    private publishing = false;
    private deferredRevision = 0;
    private readonly clientId = crypto.randomUUID();
    private readonly retryDelay: number;

    constructor(options: { retryDelayMs?: number } = {}) {
        this.retryDelay = options.retryDelayMs ?? 700;
        if (!Number.isFinite(this.retryDelay) || this.retryDelay < 10)
            throw new Error('Invalid collaboration reconnect delay');
    }

    get state(): CollaborationState {
        return this.stateValue;
    }
    /** Last revision applied locally or acknowledged by this client's own publication. */
    get revision(): number {
        return this.revisionValue;
    }
    get role(): CollaborationRole | null {
        return this.roleValue;
    }
    get hasPending(): boolean {
        return this.pending !== null;
    }
    get peers(): readonly CollaborationPeer[] {
        return this.presenceValue.map(peer => ({ ...peer }));
    }
    get pendingProject(): ProjectDocument | null {
        return this.pending ? validateProject(this.pending.project) : null;
    }

    async connect(
        connection: CollaborationConnection,
        callbacks: CollaborationCallbacks = {}
    ): Promise<CollaborationSnapshot> {
        const normalized = {
            url: collaborationServerUrl(connection.url),
            roomId: roomId(connection.roomId),
            token: capability(connection.token),
            displayName: connection.displayName.trim()
        };
        if (
            !normalized.displayName ||
            normalized.displayName.length > 60 ||
            Array.from(normalized.displayName).some(character => character.charCodeAt(0) < 32)
        )
            throw new Error('Display name must contain 1–60 printable characters.');
        if (this.pending && this.pending.roomId !== normalized.roomId)
            throw new Error('Save unsent changes as a copy before joining a different room.');
        this.disconnect();
        this.connection = normalized;
        this.callbacks = callbacks;
        const controller = new AbortController();
        this.controller = controller;
        const generation = ++this.generation;
        this.report('connecting', 'Connecting to shared project…');
        try {
            const remote = await this.fetchLatest();
            if (generation !== this.generation) throw new Error('Connection was canceled');
            this.roleValue = remote.role;
            if (this.pending) {
                this.revisionValue = this.pending.baseRevision;
                await this.reconcile(remote);
            } else await this.acceptRemote(remote);
            void this.streamLoop(generation, controller.signal);
            return remote;
        } catch (cause) {
            if (generation === this.generation) {
                if (
                    cause instanceof CollaborationRequestError &&
                    (cause.status === 401 || cause.status === 403)
                ) {
                    this.disconnect();
                    this.report(
                        'disconnected',
                        'Capability rejected. Join again with a valid invitation.'
                    );
                } else this.report('offline', this.error(cause));
            }
            throw cause;
        }
    }

    /** Mark authored changes as unsent without starting a network write. */
    stage(project: ProjectDocument): void {
        const connection = this.requireConnection();
        if (!this.roleValue)
            throw new Error('Wait for the room connection before staging changes.');
        const validated = this.wireProject(project);
        if (
            !this.publishing &&
            this.latest &&
            sameCollaborationContent(validated, this.latest.project)
        ) {
            this.pending = null;
            this.revisionValue = this.latest.revision;
            if (this.stateValue !== 'offline')
                this.report('connected', 'Local authored content matches the shared project.');
            return;
        }
        this.pending = {
            roomId: connection.roomId,
            baseRevision: this.pending?.baseRevision ?? this.revisionValue,
            project: validated
        };
        if (this.stateValue !== 'offline' && this.stateValue !== 'conflict')
            this.report('connected', 'Local edits are retained and waiting to be published.');
    }

    async publish(project: ProjectDocument, baseRevision: number): Promise<CollaborationSnapshot> {
        const connection = this.requireConnection();
        if (this.roleValue !== 'editor')
            throw new CollaborationRequestError(
                403,
                'Only editor capabilities can publish shared changes.'
            );
        if (this.publishing) throw new Error('A publication is already in progress.');
        revision(baseRevision);
        const pending: PendingPublication = {
            roomId: connection.roomId,
            baseRevision,
            project: this.wireProject(project)
        };
        this.pending = pending;
        this.publishing = true;
        const generation = this.generation;
        try {
            const remote = readSnapshot(
                await this.request('', {
                    method: 'PUT',
                    body: { project: pending.project, baseRevision }
                })
            );
            if (generation !== this.generation)
                throw new Error(
                    'Publication finished after disconnect; reconnect to check the shared revision.'
                );
            this.latest = remote;
            this.revisionValue = remote.revision;
            if (this.pending === pending) this.pending = null;
            else this.rebasePending(remote);
            this.report(
                'connected',
                this.pending
                    ? 'Published. Newer local edits are waiting.'
                    : `Shared revision ${String(remote.revision)} saved.`
            );
            return remote;
        } catch (cause) {
            if (generation !== this.generation) throw cause;
            if (
                cause instanceof CollaborationRequestError &&
                (cause.status === 401 || cause.status === 403)
            ) {
                this.disconnect();
                this.report(
                    'disconnected',
                    'Publishing capability rejected. Local edits are retained; join again with a valid invitation.'
                );
                throw cause;
            }
            if (cause instanceof CollaborationRequestError && cause.status === 409) {
                const remote = await this.fetchLatest();
                this.latest = remote;
                this.report(
                    'conflict',
                    'Shared revision changed. Your unsent local version is retained.'
                );
                this.callbacks.onConflict?.(remote);
                throw new CollaborationConflictError(remote);
            }
            if (!(cause instanceof CollaborationRequestError)) {
                this.report(
                    'offline',
                    'Connection lost. Unsent local edits remain in this editor.'
                );
                this.streamController?.abort();
            } else this.report(this.stateValue, cause.message);
            throw cause;
        } finally {
            this.publishing = false;
            if (this.deferredRevision > this.revisionValue && generation === this.generation) {
                const deferred = this.deferredRevision;
                this.deferredRevision = 0;
                void this.handleRevision(deferred).catch((cause: unknown) => {
                    this.report('offline', this.error(cause));
                });
            }
        }
    }

    async fetchLatest(): Promise<CollaborationSnapshot> {
        return readSnapshot(await this.request(''));
    }

    async listRevisions(): Promise<CollaborationRevision[]> {
        const data = object(await this.request('/revisions'));
        const rows = data['revisions'];
        if (!Array.isArray(rows) || rows.length > 100) throw new Error('Invalid recovery history');
        return rows.map((entry: unknown) => {
            const row = object(entry);
            if (typeof row['name'] !== 'string') throw new Error('Invalid recovery revision name');
            return {
                revision: revision(row['revision']),
                updatedAt: timestamp(row['updatedAt']),
                name: row['name']
            };
        });
    }

    async fetchRevision(value: number): Promise<CollaborationSnapshot> {
        return readSnapshot(await this.request(`/revisions/${String(revision(value))}`));
    }

    /** Explicitly adopt a reviewed remote snapshot and clear the retained local conflict. */
    async acceptRemote(remote: CollaborationSnapshot): Promise<void> {
        if (remote.roomId !== this.requireConnection().roomId)
            throw new Error('Remote snapshot belongs to another room');
        const previous = this.pending;
        this.pending = null;
        try {
            await this.callbacks.onRemote?.(readSnapshot(remote));
        } catch (cause) {
            this.pending = previous;
            throw cause;
        }
        this.latest = remote;
        this.revisionValue = remote.revision;
        this.roleValue = remote.role;
        this.report(
            'connected',
            `Connected as ${remote.role} at shared revision ${String(remote.revision)}.`
        );
    }

    /** Disconnect clears capabilities from the client. Authored local work remains available. */
    disconnect(): void {
        this.generation++;
        this.controller?.abort();
        this.streamController?.abort();
        this.controller = null;
        this.streamController = null;
        this.connection = null;
        this.roleValue = null;
        this.presenceValue = [];
        this.callbacks.onPresence?.([]);
        this.report(
            'disconnected',
            this.pending ? 'Disconnected. Unsent local edits remain available.' : 'Disconnected.'
        );
    }

    /** Only after the caller has retained/exported a local copy or intentionally discarded it. */
    clearPending(): void {
        this.pending = null;
    }

    private requireConnection(): CollaborationConnection {
        if (!this.connection) throw new Error('Join a collaboration room first.');
        return this.connection;
    }

    private wireProject(project: ProjectDocument): ProjectDocument {
        const validated = validateProject(project);
        const baseline = this.latest?.project;
        if (!baseline) return validated;
        return validateProject({
            ...validated,
            id: baseline.id,
            revision: baseline.revision,
            createdAt: baseline.createdAt,
            updatedAt: new Date(Math.max(Date.now(), Date.parse(baseline.createdAt))).toISOString()
        });
    }

    private async request(
        path: string,
        options: { method?: string; body?: unknown } = {}
    ): Promise<unknown> {
        const connection = this.requireConnection();
        return authenticatedJson(
            `${connection.url}/rooms/${connection.roomId}${path}`,
            connection.token,
            {
                ...options,
                ...(this.controller ? { signal: this.controller.signal } : {}),
                headers: { 'X-Hilo-Client-ID': this.clientId }
            }
        );
    }

    private async reconcile(remote: CollaborationSnapshot): Promise<void> {
        this.latest = remote;
        if (this.pending) {
            if (remote.revision !== this.pending.baseRevision) {
                this.report(
                    'conflict',
                    'A remote update overlaps your unsent local work. Choose which version to retain.'
                );
                this.callbacks.onConflict?.(remote);
            } else
                this.report(
                    'connected',
                    'Connected. Your unsent local edits are ready to publish.'
                );
        } else if (remote.revision > this.revisionValue) await this.acceptRemote(remote);
        else this.report('connected', `Connected at shared revision ${String(remote.revision)}.`);
    }

    private async handleRevision(value: number): Promise<void> {
        if (value <= this.revisionValue) return;
        if (this.publishing) {
            this.deferredRevision = Math.max(this.deferredRevision, value);
            return;
        }
        const generation = this.generation;
        const remote = await this.fetchLatest();
        if (generation === this.generation) await this.reconcile(remote);
    }

    private async streamLoop(generation: number, signal: AbortSignal): Promise<void> {
        let attempt = 0;
        while (this.active(generation, signal)) {
            const stream = new AbortController();
            this.streamController = stream;
            const abort = (): void => {
                stream.abort();
            };
            signal.addEventListener('abort', abort, { once: true });
            const timeout = setTimeout(abort, 20_000);
            try {
                if (attempt) await this.reconcile(await this.fetchLatest());
                const connection = this.requireConnection();
                const response = await fetch(
                    `${connection.url}/rooms/${connection.roomId}/events`,
                    {
                        headers: {
                            Authorization: `Bearer ${connection.token}`,
                            'X-Hilo-Client-ID': this.clientId,
                            'X-Hilo-Name': encodeURIComponent(connection.displayName)
                        },
                        signal: stream.signal,
                        credentials: 'omit',
                        cache: 'no-store',
                        referrerPolicy: 'no-referrer'
                    }
                );
                clearTimeout(timeout);
                if (!response.ok) await json(response);
                if (!response.headers.get('content-type')?.includes('text/event-stream'))
                    throw new Error('Server does not provide an event stream');
                attempt = 0;
                await this.readEvents(response, generation);
                if (this.active(generation, signal)) throw new Error('Shared event stream closed');
            } catch (cause) {
                if (!this.active(generation, signal)) return;
                if (
                    cause instanceof CollaborationRequestError &&
                    (cause.status === 401 || cause.status === 403)
                ) {
                    this.disconnect();
                    this.report(
                        'disconnected',
                        'The room capability was rejected. Join again with a valid invite.'
                    );
                    return;
                }
                this.report(
                    'offline',
                    'Shared connection interrupted; local edits are retained while reconnecting.'
                );
                attempt++;
            } finally {
                clearTimeout(timeout);
                signal.removeEventListener('abort', abort);
                stream.abort();
            }
            if (this.active(generation, signal))
                await this.wait(
                    Math.min(10_000, this.retryDelay * 2 ** Math.min(attempt - 1, 4)),
                    signal
                );
        }
    }

    private async readEvents(response: Response, generation: number): Promise<void> {
        const reader = response.body?.getReader();
        if (!reader) throw new Error('Missing collaboration event stream');
        const decoder = new TextDecoder();
        let buffer = '';
        try {
            while (generation === this.generation) {
                const next = await reader.read();
                if (next.done) return;
                buffer = (buffer + decoder.decode(next.value, { stream: true })).replace(
                    /\r\n/gu,
                    '\n'
                );
                if (buffer.length > 65_536)
                    throw new Error('Collaboration event exceeded its limit');
                let end = buffer.indexOf('\n\n');
                while (end >= 0) {
                    const block = buffer.slice(0, end);
                    buffer = buffer.slice(end + 2);
                    const lines = block.split('\n');
                    const event = lines
                        .find(line => line.startsWith('event:'))
                        ?.slice(6)
                        .trim();
                    const data = lines
                        .filter(line => line.startsWith('data:'))
                        .map(line => line.slice(5).trim())
                        .join('\n');
                    if (event && data) await this.event(event, JSON.parse(data) as unknown);
                    end = buffer.indexOf('\n\n');
                }
            }
        } finally {
            await reader.cancel().catch(() => undefined);
        }
    }

    private async event(event: string, value: unknown): Promise<void> {
        const data = object(value);
        if (event === 'revoked') {
            this.disconnect();
            this.report(
                'disconnected',
                typeof data['message'] === 'string'
                    ? data['message']
                    : 'This invitation was revoked.'
            );
            return;
        }
        if (event === 'hello' || event === 'revision') {
            await this.handleRevision(revision(data['revision']));
            return;
        }
        if (event === 'presence') {
            const peers = data['peers'];
            if (!Array.isArray(peers) || peers.length > 1024)
                throw new Error('Invalid room presence');
            this.presenceValue = peers.map((entry: unknown) => {
                const peer = object(entry);
                if (
                    typeof peer['id'] !== 'string' ||
                    typeof peer['displayName'] !== 'string' ||
                    peer['displayName'].length > 60
                )
                    throw new Error('Invalid presence member');
                return {
                    id: peer['id'],
                    displayName: peer['displayName'],
                    role: role(peer['role'])
                };
            });
            this.callbacks.onPresence?.(this.peers);
        }
    }

    private wait(milliseconds: number, signal: AbortSignal): Promise<void> {
        return new Promise(resolve => {
            const finish = (): void => {
                clearTimeout(timer);
                signal.removeEventListener('abort', finish);
                resolve();
            };
            const timer = setTimeout(finish, milliseconds);
            signal.addEventListener('abort', finish, { once: true });
            if (signal.aborted) finish();
        });
    }

    private report(state: CollaborationState, message: string): void {
        this.stateValue = state;
        this.callbacks.onStatus?.(state, message);
    }

    private active(generation: number, signal: AbortSignal): boolean {
        return !signal.aborted && generation === this.generation;
    }

    private rebasePending(remote: CollaborationSnapshot): void {
        if (this.pending) {
            if (sameCollaborationContent(this.pending.project, remote.project)) this.pending = null;
            else this.pending.baseRevision = remote.revision;
        }
    }

    private error(cause: unknown): string {
        return cause instanceof Error ? cause.message : String(cause);
    }
}
