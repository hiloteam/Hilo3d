import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
    RoomError,
    RoomStore,
    tokenHash,
    tokenMatches,
    type RoomRole,
    type RoomStoreOptions
} from './store';

export interface CollaborationServerOptions extends RoomStoreOptions {
    adminToken: string;
    allowedOrigins?: readonly string[];
    maxConnections?: number;
    maxRoomConnections?: number;
    requestsPerMinute?: number;
    heartbeatMs?: number;
}

interface Peer {
    id: string;
    room: string;
    displayName: string;
    role: RoomRole;
    response: ServerResponse;
    heartbeat: ReturnType<typeof setInterval>;
}

function bearer(request: IncomingMessage): string {
    const value = request.headers.authorization;
    const match = value?.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/u);
    if (!match?.[1]) throw new RoomError(401, 'A bearer capability is required');
    return match[1];
}

function inputObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new RoomError(400, 'Expected a JSON object');
    return value as Record<string, unknown>;
}

function reply(response: ServerResponse, status: number, data: unknown): void {
    const body = JSON.stringify(data);
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
    });
    response.end(body);
}

function readBody(request: IncomingMessage, limit: number): Promise<unknown> {
    const length = Number(request.headers['content-length'] ?? 0);
    if (!Number.isFinite(length) || length > limit)
        throw new RoomError(413, 'Request body is too large');
    if (!(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json'))
        throw new RoomError(415, 'Use application/json');
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        let settled = false;
        const fail = (error: Error): void => {
            if (settled) return;
            settled = true;
            chunks.length = 0;
            reject(error);
        };
        request.on('data', (chunk: unknown) => {
            if (settled) return;
            if (!Buffer.isBuffer(chunk)) {
                fail(new RoomError(400, 'Unsupported request encoding'));
                return;
            }
            bytes += chunk.length;
            if (bytes > limit) {
                fail(new RoomError(413, 'Request body is too large'));
                return;
            }
            chunks.push(chunk);
        });
        request.on('aborted', () => {
            fail(new RoomError(400, 'Request was interrupted'));
        });
        request.on('error', fail);
        request.on('end', () => {
            if (settled) return;
            settled = true;
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
            } catch {
                reject(new RoomError(400, 'Invalid JSON'));
            }
        });
    });
}

/** Authenticated room transport. It binds only when listen() is called. */
export class CollaborationServer {
    private readonly server: Server;
    private readonly peers = new Set<Peer>();
    private readonly origins: Set<string>;
    private readonly adminHash: string;
    private readonly rates = new Map<string, { started: number; count: number }>();
    private activeRequests = 0;
    private readonly maxConnections: number;
    private readonly maxRoomConnections: number;
    private readonly requestsPerMinute: number;
    private readonly heartbeatMs: number;
    private closed = false;

    private constructor(
        private readonly store: RoomStore,
        options: CollaborationServerOptions
    ) {
        if (!/^[A-Za-z0-9_-]{32,256}$/u.test(options.adminToken))
            throw new Error('Admin capability must contain 32–256 URL-safe characters');
        this.adminHash = tokenHash(options.adminToken);
        this.origins = new Set(
            options.allowedOrigins ?? ['http://127.0.0.1:5174', 'http://localhost:5174']
        );
        for (const origin of this.origins)
            if (new URL(origin).origin !== origin)
                throw new Error('CORS origins must be exact scheme/host/port origins');
        this.maxConnections = options.maxConnections ?? 64;
        this.maxRoomConnections = options.maxRoomConnections ?? 16;
        this.requestsPerMinute = options.requestsPerMinute ?? 240;
        this.heartbeatMs = options.heartbeatMs ?? 15_000;
        for (const limit of [
            this.maxConnections,
            this.maxRoomConnections,
            this.requestsPerMinute,
            this.heartbeatMs
        ]) {
            if (!Number.isSafeInteger(limit) || limit < 1)
                throw new Error('Invalid collaboration transport limit');
        }
        this.server = createServer((request, response) => {
            void this.handle(request, response).catch((cause: unknown) => {
                if (response.headersSent) {
                    response.destroy();
                    return;
                }
                const error =
                    cause instanceof RoomError
                        ? cause
                        : new RoomError(
                              422,
                              cause instanceof Error ? cause.message : 'Invalid project request'
                          );
                response.setHeader('Connection', 'close');
                reply(response, error.status, {
                    error: error.message,
                    ...(error.revision === undefined ? {} : { revision: error.revision })
                });
            });
        });
        this.server.requestTimeout = 20_000;
        this.server.headersTimeout = 10_000;
        this.server.keepAliveTimeout = 5_000;
        this.server.maxHeadersCount = 32;
        this.server.maxRequestsPerSocket = 200;
    }

    static async create(options: CollaborationServerOptions): Promise<CollaborationServer> {
        const store = await RoomStore.open(options);
        try {
            return new CollaborationServer(store, options);
        } catch (cause) {
            await store.close();
            throw cause;
        }
    }

    async listen(options: { port?: number; host?: string } = {}): Promise<string> {
        if (this.closed) throw new Error('Create a new collaboration server after shutdown.');
        try {
            await new Promise<void>((resolve, reject) => {
                this.server.once('error', reject);
                this.server.listen(options.port ?? 5175, options.host ?? '127.0.0.1', () => {
                    this.server.removeListener('error', reject);
                    resolve();
                });
            });
            return this.address;
        } catch (cause) {
            await this.close();
            throw cause;
        }
    }

    get address(): string {
        const address = this.server.address();
        if (!address || typeof address === 'string')
            throw new Error('Collaboration server is not listening');
        const host = address.address.includes(':') ? `[${address.address}]` : address.address;
        return `http://${host}:${String(address.port)}`;
    }

    async close(): Promise<void> {
        if (this.closed) return;
        this.closed = true;
        for (const peer of this.peers) peer.response.end();
        try {
            await new Promise<void>((resolve, reject) => {
                this.server.close(error => {
                    if (error && (!('code' in error) || error.code !== 'ERR_SERVER_NOT_RUNNING'))
                        reject(error);
                    else resolve();
                });
                this.server.closeAllConnections();
            });
        } finally {
            await this.store.close();
        }
    }

    private rateLimit(request: IncomingMessage): void {
        const now = Date.now();
        const key = request.socket.remoteAddress ?? 'unknown';
        for (const [id, entry] of this.rates)
            if (now - entry.started >= 60_000) this.rates.delete(id);
        let rate = this.rates.get(key);
        if (!rate) {
            if (this.rates.size >= 1024)
                throw new RoomError(429, 'Server request budget exhausted');
            rate = { started: now, count: 0 };
            this.rates.set(key, rate);
        }
        if (++rate.count > this.requestsPerMinute)
            throw new RoomError(429, 'Too many requests; retry after one minute');
    }

    private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        this.rateLimit(request);
        const origin = request.headers.origin;
        if (origin) {
            if (!this.origins.has(origin))
                throw new RoomError(403, 'This editor origin is not allowed');
            response.setHeader('Access-Control-Allow-Origin', origin);
            response.setHeader('Vary', 'Origin');
        }
        if (request.method === 'OPTIONS') {
            response.writeHead(204, {
                'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
                'Access-Control-Allow-Headers':
                    'Authorization,Content-Type,X-Hilo-Client-ID,X-Hilo-Name',
                'Access-Control-Max-Age': '600'
            });
            response.end();
            return;
        }
        if (++this.activeRequests > 16) {
            this.activeRequests--;
            throw new RoomError(503, 'Server request concurrency exhausted');
        }
        try {
            const url = new URL(request.url ?? '/', 'http://localhost');
            if (url.searchParams.has('token') || url.searchParams.has('access_token'))
                throw new RoomError(400, 'Send capabilities in the Authorization header only');
            if (request.method === 'GET' && url.pathname === '/health') {
                reply(response, 200, { service: 'hilo-editor-collaboration', version: 1 });
                return;
            }
            if (request.method === 'POST' && url.pathname === '/rooms') {
                if (!tokenMatches(bearer(request), this.adminHash))
                    throw new RoomError(403, 'Room creation requires the server admin capability');
                const body = inputObject(
                    await readBody(request, this.store.maxProjectBytes + 1024)
                );
                if (Object.keys(body).some(key => key !== 'project'))
                    throw new RoomError(400, 'Unknown room creation field');
                const created = await this.store.create(body['project']);
                reply(response, 201, {
                    roomId: created.roomId,
                    editorToken: created.editorToken,
                    viewerToken: created.viewerToken,
                    ...created.snapshot,
                    role: 'editor'
                });
                return;
            }
            if (request.method === 'GET' && url.pathname === '/rooms') {
                if (!tokenMatches(bearer(request), this.adminHash))
                    throw new RoomError(403, 'Listing rooms requires the server admin capability');
                reply(response, 200, { rooms: this.store.list() });
                return;
            }
            const path =
                /^\/rooms\/(room-[a-f0-9-]{36})(?:\/(events|revisions|capabilities)(?:\/(\d+))?)?$/u.exec(
                    url.pathname
                );
            const id = path?.[1];
            if (!id) throw new RoomError(404, 'Endpoint not found');
            if (
                (path[2] === 'capabilities' && request.method === 'POST') ||
                (!path[2] && request.method === 'DELETE')
            ) {
                if (!tokenMatches(bearer(request), this.adminHash))
                    throw new RoomError(
                        403,
                        'Room administration requires the server admin capability'
                    );
                const body = inputObject(await readBody(request, 4096));
                if (request.method === 'DELETE') {
                    if (
                        body['confirmRoomId'] !== id ||
                        Object.keys(body).some(key => key !== 'confirmRoomId')
                    )
                        throw new RoomError(
                            400,
                            'Confirm the exact room ID before deleting its shared history'
                        );
                    await this.store.delete(id);
                    this.revoke(id, 'all', 'The administrator deleted this shared room.');
                    reply(response, 200, { deleted: id });
                } else {
                    const selectedRole = body['role'];
                    if (
                        (selectedRole !== 'editor' &&
                            selectedRole !== 'viewer' &&
                            selectedRole !== 'all') ||
                        Object.keys(body).some(key => key !== 'role')
                    )
                        throw new RoomError(
                            400,
                            'Choose editor, viewer or all capabilities to rotate'
                        );
                    const rotated = await this.store.rotate(id, selectedRole);
                    this.revoke(
                        id,
                        selectedRole,
                        'The administrator rotated this invitation capability.'
                    );
                    reply(response, 200, rotated);
                }
                return;
            }
            const role = this.store.authenticate(id, bearer(request));
            if (path[2] === 'events' && request.method === 'GET') {
                this.openEvents(id, role, request, response);
                return;
            }
            if (path[2] === 'revisions' && request.method === 'GET') {
                if (path[3]) {
                    const revision = Number(path[3]);
                    if (!Number.isSafeInteger(revision))
                        throw new RoomError(400, 'Invalid revision');
                    reply(response, 200, {
                        roomId: id,
                        role,
                        ...this.store.revision(id, revision)
                    });
                } else reply(response, 200, { revisions: this.store.revisions(id) });
                return;
            }
            if (!path[2] && request.method === 'GET') {
                reply(response, 200, { roomId: id, role, ...this.store.latest(id) });
                return;
            }
            if (!path[2] && request.method === 'PUT') {
                if (role !== 'editor')
                    throw new RoomError(403, 'Viewer capabilities cannot publish');
                const body = inputObject(
                    await readBody(request, this.store.maxProjectBytes + 1024)
                );
                if (Object.keys(body).some(key => key !== 'project' && key !== 'baseRevision'))
                    throw new RoomError(400, 'Unknown publication field');
                const revision = body['baseRevision'];
                if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1)
                    throw new RoomError(400, 'Expected a positive baseRevision');
                const snapshot = await this.store.publish(
                    id,
                    revision,
                    body['project'],
                    bearer(request)
                );
                reply(response, 200, { roomId: id, role, ...snapshot });
                this.broadcast(id, 'revision', {
                    revision: snapshot.revision,
                    actor: this.clientId(request)
                });
                return;
            }
            throw new RoomError(405, 'Method not allowed');
        } finally {
            this.activeRequests--;
        }
    }

    private clientId(request: IncomingMessage): string {
        const value = request.headers['x-hilo-client-id'];
        return typeof value === 'string' && /^[a-f0-9-]{36}$/u.test(value) ? value : 'unknown';
    }

    private openEvents(
        room: string,
        role: RoomRole,
        request: IncomingMessage,
        response: ServerResponse
    ): void {
        if (
            this.peers.size >= this.maxConnections ||
            [...this.peers].filter(peer => peer.room === room).length >= this.maxRoomConnections
        )
            throw new RoomError(429, 'Presence connection limit reached');
        const encodedName = request.headers['x-hilo-name'];
        let displayName = 'Guest';
        try {
            if (typeof encodedName === 'string')
                displayName = decodeURIComponent(encodedName).trim();
        } catch {
            throw new RoomError(400, 'Invalid display name encoding');
        }
        if (
            !displayName ||
            displayName.length > 60 ||
            Array.from(displayName).some(
                character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
            )
        )
            throw new RoomError(400, 'Display name must contain 1–60 printable characters');
        response.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-store',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
            'X-Content-Type-Options': 'nosniff'
        });
        response.flushHeaders();
        const peer: Peer = {
            id: this.clientId(request) === 'unknown' ? randomUUID() : this.clientId(request),
            room,
            displayName,
            role,
            response,
            heartbeat: setInterval(() => {
                if (response.writableLength > 64 * 1024) response.destroy();
                else response.write(': heartbeat\n\n');
            }, this.heartbeatMs)
        };
        this.peers.add(peer);
        response.once('close', () => {
            clearInterval(peer.heartbeat);
            this.peers.delete(peer);
            this.presence(room);
        });
        this.event(peer, 'hello', { revision: this.store.latest(room).revision, role });
        this.presence(room);
    }

    private event(peer: Peer, name: string, data: unknown): void {
        if (peer.response.destroyed || peer.response.writableLength > 64 * 1024) {
            peer.response.destroy();
            return;
        }
        peer.response.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    }

    private broadcast(room: string, name: string, data: unknown): void {
        for (const peer of this.peers) if (peer.room === room) this.event(peer, name, data);
    }

    private presence(room: string): void {
        this.broadcast(room, 'presence', {
            peers: [...this.peers]
                .filter(peer => peer.room === room)
                .map(({ id, displayName, role }) => ({ id, displayName, role }))
        });
    }

    private revoke(room: string, selectedRole: RoomRole | 'all', message: string): void {
        for (const peer of this.peers) {
            if (peer.room !== room || (selectedRole !== 'all' && peer.role !== selectedRole))
                continue;
            this.event(peer, 'revoked', { message });
            peer.response.end();
        }
    }
}

export async function createCollaborationServer(
    options: CollaborationServerOptions
): Promise<CollaborationServer> {
    return CollaborationServer.create(options);
}
