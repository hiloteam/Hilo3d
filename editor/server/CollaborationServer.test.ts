import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProject, type ProjectDocument } from '../project';
import { createDefaultScene } from '../scene';
import {
    createCollaborationServer,
    type CollaborationServer,
    type CollaborationServerOptions
} from './server';

const ADMIN = 'editor-test-admin-capability-00000000000000000000';
const servers = new Set<CollaborationServer>();
const directories: string[] = [];
const aborts: AbortController[] = [];

interface CreatedRoom {
    roomId: string;
    editorToken: string;
    viewerToken: string;
    revision: number;
    project: ProjectDocument;
}

async function fixture(
    options: Partial<CollaborationServerOptions> = {}
): Promise<{ server: CollaborationServer; url: string; directory: string }> {
    const directory =
        options.dataDirectory ?? (await mkdtemp(join(tmpdir(), 'hilo-collaboration-')));
    if (!options.dataDirectory) directories.push(directory);
    const server = await createCollaborationServer({
        dataDirectory: directory,
        adminToken: ADMIN,
        ...options
    });
    servers.add(server);
    const url = await server.listen({ port: 0 });
    return { server, url, directory };
}

async function request(
    url: string,
    method: string,
    token: string,
    body?: unknown,
    extra: Record<string, string> = {}
): Promise<Response> {
    return fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
}

async function createRoom(url: string): Promise<CreatedRoom> {
    const response = await request(`${url}/rooms`, 'POST', ADMIN, {
        project: createProject(createDefaultScene())
    });
    expect(response.status).toBe(201);
    return (await response.json()) as CreatedRoom;
}

afterEach(async () => {
    for (const controller of aborts.splice(0)) controller.abort();
    await Promise.all([...servers].map(server => server.close()));
    servers.clear();
    await Promise.all(
        directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))
    );
});

describe('authenticated collaboration server', () => {
    it('refuses a second writer for the same data directory and releases the lock after clean shutdown', async () => {
        const first = await fixture();
        await expect(
            createCollaborationServer({ dataDirectory: first.directory, adminToken: ADMIN })
        ).rejects.toThrow('locked');
        await first.server.close();
        servers.delete(first.server);
        const reopened = await fixture({ dataDirectory: first.directory });
        expect((await fetch(`${reopened.url}/health`)).status).toBe(200);
    });

    it('requires admin creation, enforces viewer/editor roles and uses independent optimistic server revisions', async () => {
        const { url } = await fixture();
        const project = createProject(createDefaultScene());
        expect(
            (
                await request(`${url}/rooms`, 'POST', 'wrong-capability-00000000000000000000000', {
                    project
                })
            ).status
        ).toBe(403);
        const room = await createRoom(url);
        const endpoint = `${url}/rooms/${room.roomId}`;
        expect((await fetch(endpoint)).status).toBe(401);
        expect((await request(endpoint, 'GET', room.viewerToken)).status).toBe(200);
        const edited = { ...room.project, name: 'Shared revision two', revision: 400 };
        expect(
            (await request(endpoint, 'PUT', room.viewerToken, { baseRevision: 1, project: edited }))
                .status
        ).toBe(403);
        const saved = await request(endpoint, 'PUT', room.editorToken, {
            baseRevision: 1,
            project: edited
        });
        expect(saved.status).toBe(200);
        const value = (await saved.json()) as { revision: number; project: ProjectDocument };
        expect(value.revision).toBe(2);
        expect(value.project.revision).toBe(400);
        const stale = await request(endpoint, 'PUT', room.editorToken, {
            baseRevision: 1,
            project: room.project
        });
        expect(stale.status).toBe(409);
        expect(await stale.json()).toMatchObject({ revision: 2 });
        const latest = await request(endpoint, 'GET', room.viewerToken);
        expect(await latest.json()).toMatchObject({ project: { name: 'Shared revision two' } });
    });

    it('allows only one concurrent CAS winner and retains a bounded durable recovery history', async () => {
        const { server, url, directory } = await fixture({ maxRevisions: 3 });
        const room = await createRoom(url);
        const endpoint = `${url}/rooms/${room.roomId}`;
        const attempts = await Promise.all(
            ['First writer', 'Second writer'].map(name =>
                request(endpoint, 'PUT', room.editorToken, {
                    baseRevision: 1,
                    project: { ...room.project, name }
                })
            )
        );
        expect(attempts.map(response => response.status).sort()).toEqual([200, 409]);
        for (let revision = 2; revision < 5; revision++) {
            expect(
                (
                    await request(endpoint, 'PUT', room.editorToken, {
                        baseRevision: revision,
                        project: { ...room.project, name: `Revision ${String(revision + 1)}` }
                    })
                ).status
            ).toBe(200);
        }
        const history = await request(`${endpoint}/revisions`, 'GET', room.viewerToken);
        expect(await history.json()).toMatchObject({
            revisions: [{ revision: 5 }, { revision: 4 }, { revision: 3 }]
        });
        expect((await request(`${endpoint}/revisions/1`, 'GET', room.viewerToken)).status).toBe(
            404
        );
        const older = await request(`${endpoint}/revisions/3`, 'GET', room.editorToken);
        expect(await older.json()).toMatchObject({ revision: 3, project: { name: 'Revision 3' } });
        await server.close();
        servers.delete(server);
        const files = await readdir(directory);
        expect(files).toEqual([`${room.roomId}.json`]);
        const source = await readFile(join(directory, `${room.roomId}.json`), 'utf8');
        expect(source).not.toContain(room.editorToken);
        expect(source).not.toContain(room.viewerToken);
        expect(source).not.toContain(ADMIN);
        const restarted = await fixture({ dataDirectory: directory, maxRevisions: 3 });
        const latest = await request(
            `${restarted.url}/rooms/${room.roomId}`,
            'GET',
            room.viewerToken
        );
        expect(await latest.json()).toMatchObject({ revision: 5, project: { name: 'Revision 5' } });
    });

    it('streams authenticated revision events and presence without URL capabilities', async () => {
        const { url } = await fixture({ heartbeatMs: 100 });
        const room = await createRoom(url);
        const controller = new AbortController();
        aborts.push(controller);
        const response = await fetch(`${url}/rooms/${room.roomId}/events`, {
            headers: {
                Authorization: `Bearer ${room.viewerToken}`,
                'X-Hilo-Name': encodeURIComponent('审阅者'),
                'X-Hilo-Client-ID': 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
            },
            signal: controller.signal
        });
        expect(response.headers.get('content-type')).toContain('text/event-stream');
        const reader = response.body?.getReader();
        if (!reader) throw new Error('Missing event stream');
        let events = '';
        const consume = (async (): Promise<void> => {
            try {
                for (;;) {
                    const next = await reader.read();
                    if (next.done) break;
                    events += new TextDecoder().decode(next.value);
                }
            } catch {
                /* Abort closes the test stream. */
            }
        })();
        await expect.poll(() => events).toContain('审阅者');
        await request(`${url}/rooms/${room.roomId}`, 'PUT', room.editorToken, {
            baseRevision: 1,
            project: { ...room.project, name: 'New scene' }
        });
        await expect.poll(() => events).toContain('event: revision');
        expect(events).toContain('"revision":2');
        expect(events).not.toContain(room.viewerToken);
        expect(
            (
                await request(
                    `${url}/rooms/${room.roomId}/events?token=${room.viewerToken}`,
                    'GET',
                    room.viewerToken
                )
            ).status
        ).toBe(400);
        controller.abort();
        await consume;
    });

    it('rejects disallowed origins, malformed projects, changed identity and oversized uploads without changing the room', async () => {
        const { url } = await fixture({ maxProjectBytes: 16_000 });
        const room = await createRoom(url);
        const endpoint = `${url}/rooms/${room.roomId}`;
        expect(
            (
                await request(endpoint, 'GET', room.viewerToken, undefined, {
                    Origin: 'https://evil.example'
                })
            ).status
        ).toBe(403);
        const allowed = await request(endpoint, 'GET', room.viewerToken, undefined, {
            Origin: 'http://localhost:5174'
        });
        expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:5174');
        expect(
            (
                await request(endpoint, 'PUT', room.editorToken, {
                    baseRevision: 1,
                    project: { ...room.project, injected: true }
                })
            ).status
        ).toBe(422);
        expect(
            (
                await request(endpoint, 'PUT', room.editorToken, {
                    baseRevision: 1,
                    project: { ...room.project, id: 'different-project' }
                })
            ).status
        ).toBe(422);
        expect(
            (
                await request(endpoint, 'PUT', room.editorToken, {
                    baseRevision: 1,
                    project: 'x'.repeat(20_000)
                })
            ).status
        ).toBe(413);
        expect(await (await request(endpoint, 'GET', room.viewerToken)).json()).toMatchObject({
            revision: 1
        });
    });

    it('bounds room creation and request bursts', async () => {
        const { url } = await fixture({ maxRooms: 1, requestsPerMinute: 4 });
        await createRoom(url);
        expect(
            (
                await request(`${url}/rooms`, 'POST', ADMIN, {
                    project: createProject(createDefaultScene())
                })
            ).status
        ).toBe(507);
        expect((await fetch(`${url}/health`)).status).toBe(200);
        expect((await fetch(`${url}/health`)).status).toBe(200);
        expect((await fetch(`${url}/health`)).status).toBe(429);
    });
});
