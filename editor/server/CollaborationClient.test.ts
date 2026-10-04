import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    CollaborationClient,
    CollaborationConflictError,
    createCollaborationRoom,
    deleteCollaborationRoom,
    listCollaborationRooms,
    rotateCollaborationCapabilities,
    sameCollaborationContent,
    type CollaborationSnapshot
} from '../collaboration';
import { createProject } from '../project';
import { createDefaultScene } from '../scene';
import { createCollaborationServer, type CollaborationServer } from './server';

const ADMIN = 'client-test-admin-capability-00000000000000000000';
const servers = new Set<CollaborationServer>();
const clients: CollaborationClient[] = [];
const directories: string[] = [];

async function fixture(
    directory?: string,
    port = 0
): Promise<{ url: string; directory: string; server: CollaborationServer }> {
    const dataDirectory =
        directory ?? (await mkdtemp(join(tmpdir(), 'hilo-collaboration-client-')));
    if (!directory) directories.push(dataDirectory);
    const server = await createCollaborationServer({
        dataDirectory,
        adminToken: ADMIN,
        heartbeatMs: 100
    });
    servers.add(server);
    return { url: await server.listen({ port }), directory: dataDirectory, server };
}

function client(): CollaborationClient {
    const value = new CollaborationClient({ retryDelayMs: 30 });
    clients.push(value);
    return value;
}

afterEach(async () => {
    for (const value of clients.splice(0)) value.disconnect();
    await Promise.all([...servers].map(server => server.close()));
    servers.clear();
    await Promise.all(
        directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))
    );
});

describe('collaboration client over real HTTP and SSE', () => {
    it('rotates capabilities durably, disconnects revoked members and deletes rooms with admin authority', async () => {
        const running = await fixture();
        const { url } = running;
        const room = await createCollaborationRoom({
            url,
            adminToken: ADMIN,
            project: createProject(createDefaultScene())
        });
        const writer = client();
        const reader = client();
        await writer.connect({
            url,
            roomId: room.roomId,
            token: room.editorToken,
            displayName: 'Editor'
        });
        await reader.connect({
            url,
            roomId: room.roomId,
            token: room.viewerToken,
            displayName: 'Viewer'
        });
        await expect.poll(() => writer.peers.length).toBe(2);
        await expect(
            rotateCollaborationCapabilities({
                url,
                roomId: room.roomId,
                adminToken: room.editorToken,
                role: 'all'
            })
        ).rejects.toThrow('admin capability');
        const replacement = await rotateCollaborationCapabilities({
            url,
            roomId: room.roomId,
            adminToken: ADMIN,
            role: 'viewer'
        });
        await expect.poll(() => reader.state).toBe('disconnected');
        expect(reader.role).toBeNull();
        expect(writer.role).toBe('editor');
        expect(replacement.viewerToken).toBeTruthy();
        expect(replacement.editorToken).toBeUndefined();
        await expect(
            reader.connect({
                url,
                roomId: room.roomId,
                token: room.viewerToken,
                displayName: 'Revoked'
            })
        ).rejects.toThrow('Invalid room capability');
        expect(reader.state).toBe('disconnected');
        const newToken = replacement.viewerToken;
        if (!newToken) throw new Error('Missing replacement viewer token');
        await reader.connect({
            url,
            roomId: room.roomId,
            token: newToken,
            displayName: 'New invite'
        });
        await expect.poll(() => writer.peers.length).toBe(2);
        expect(await listCollaborationRooms({ url, adminToken: ADMIN })).toMatchObject([
            { roomId: room.roomId, revision: 1 }
        ]);
        reader.disconnect();
        writer.disconnect();
        await running.server.close();
        servers.delete(running.server);
        const restarted = await fixture(running.directory);
        await reader.connect({
            url: restarted.url,
            roomId: room.roomId,
            token: newToken,
            displayName: 'After restart'
        });
        await expect(reader.fetchLatest()).resolves.toMatchObject({ revision: 1 });
        await expect(
            deleteCollaborationRoom({
                url: restarted.url,
                roomId: room.roomId,
                adminToken: newToken
            })
        ).rejects.toThrow('admin capability');
        await deleteCollaborationRoom({
            url: restarted.url,
            roomId: room.roomId,
            adminToken: ADMIN
        });
        await expect.poll(() => reader.state).toBe('disconnected');
        expect(await listCollaborationRooms({ url: restarted.url, adminToken: ADMIN })).toEqual([]);
        await expect(
            reader.connect({
                url: restarted.url,
                roomId: room.roomId,
                token: newToken,
                displayName: 'Deleted room'
            })
        ).rejects.toThrow('Invalid room capability');
        const recreated = await createCollaborationRoom({
            url: restarted.url,
            adminToken: ADMIN,
            project: room.project
        });
        expect(recreated.roomId).not.toBe(room.roomId);
    });

    it('synchronizes two authenticated peers, exposes presence and prevents viewer publication', async () => {
        const { url } = await fixture();
        const room = await createCollaborationRoom({
            url,
            adminToken: ADMIN,
            project: createProject(createDefaultScene())
        });
        const writer = client();
        const reader = client();
        const observed: CollaborationSnapshot[] = [];
        await writer.connect({
            url,
            roomId: room.roomId,
            token: room.editorToken,
            displayName: 'Writer'
        });
        await reader.connect(
            { url, roomId: room.roomId, token: room.viewerToken, displayName: 'Reader' },
            {
                onRemote: value => {
                    observed.push(value);
                }
            }
        );
        await expect.poll(() => writer.peers.length).toBe(2);
        expect(writer.peers.map(peer => peer.displayName).sort()).toEqual(['Reader', 'Writer']);
        expect(reader.role).toBe('viewer');
        await expect(reader.publish(room.project, 1)).rejects.toThrow('Only editor');
        const edited = { ...room.project, name: 'Shared update' };
        await writer.publish(edited, writer.revision);
        await expect.poll(() => observed.at(-1)?.project.name).toBe('Shared update');
        expect(reader.revision).toBe(2);
        expect(writer.hasPending).toBe(false);
        reader.disconnect();
        await expect.poll(() => writer.peers.length).toBe(1);
    });

    it('retains overlapping local drafts and requires explicit conflict adoption or CAS replacement', async () => {
        const { url } = await fixture();
        const room = await createCollaborationRoom({
            url,
            adminToken: ADMIN,
            project: createProject(createDefaultScene())
        });
        const first = client();
        const second = client();
        const remoteApplied: string[] = [];
        await first.connect(
            { url, roomId: room.roomId, token: room.editorToken, displayName: 'A' },
            {
                onRemote: value => {
                    remoteApplied.push(value.project.name);
                }
            }
        );
        await second.connect({
            url,
            roomId: room.roomId,
            token: room.editorToken,
            displayName: 'B'
        });
        first.stage({ ...room.project, name: 'Unsent A' });
        await second.publish({ ...room.project, name: 'Committed B' }, 1);
        await expect.poll(() => first.state).toBe('conflict');
        expect(first.pendingProject?.name).toBe('Unsent A');
        expect(first.revision).toBe(1);
        expect(remoteApplied).not.toContain('Committed B');
        await expect(first.publish(first.pendingProject ?? room.project, 1)).rejects.toBeInstanceOf(
            CollaborationConflictError
        );
        const remote = await first.fetchLatest();
        await first.acceptRemote(remote);
        expect(first.hasPending).toBe(false);
        expect(remoteApplied.at(-1)).toBe('Committed B');
        expect(first.revision).toBe(2);
        await first.publish({ ...remote.project, name: 'Reviewed replacement' }, remote.revision);
        await expect.poll(() => second.revision).toBe(3);
    });

    it('ignores local IndexedDB identity/counters while keeping scene IDs and authored changes stable', async () => {
        const { url } = await fixture();
        const room = await createCollaborationRoom({
            url,
            adminToken: ADMIN,
            project: createProject(createDefaultScene())
        });
        const session = client();
        await session.connect({
            url,
            roomId: room.roomId,
            token: room.editorToken,
            displayName: 'Local copy'
        });
        const local = {
            ...room.project,
            id: 'project-local-storage',
            revision: 120,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-02-01T00:00:00.000Z'
        };
        expect(sameCollaborationContent(local, room.project)).toBe(true);
        session.stage(local);
        expect(session.hasPending).toBe(false);
        local.name = 'Authoring change';
        session.stage(local);
        expect(session.hasPending).toBe(true);
        const published = await session.publish(local, 1);
        expect(published.project.id).toBe(room.project.id);
        expect(Object.keys(published.project.scenes)).toEqual(Object.keys(local.scenes));
        expect(local.id).toBe('project-local-storage');
        expect(published.revision).toBe(2);
    });

    it('keeps edits made while a previous publication is in flight, including an undo back to baseline', async () => {
        const { url } = await fixture();
        const room = await createCollaborationRoom({
            url,
            adminToken: ADMIN,
            project: createProject(createDefaultScene())
        });
        const session = client();
        await session.connect({
            url,
            roomId: room.roomId,
            token: room.editorToken,
            displayName: 'Concurrent author'
        });
        const publishing = session.publish({ ...room.project, name: 'First edit' }, 1);
        session.stage(room.project);
        await publishing;
        expect(session.hasPending).toBe(true);
        expect(session.pendingProject?.name).toBe(room.project.name);
        expect(session.revision).toBe(2);
        await session.publish(session.pendingProject ?? room.project, session.revision);
        expect((await session.fetchLatest()).project.name).toBe(room.project.name);
        expect(session.hasPending).toBe(false);
    });

    it('reconnects after server restart and retains offline unsent edits until explicit publication', async () => {
        const running = await fixture();
        const room = await createCollaborationRoom({
            url: running.url,
            adminToken: ADMIN,
            project: createProject(createDefaultScene())
        });
        const session = client();
        await session.connect({
            url: running.url,
            roomId: room.roomId,
            token: room.editorToken,
            displayName: 'Offline author'
        });
        await expect.poll(() => session.peers.length).toBe(1);
        await running.server.close();
        servers.delete(running.server);
        await expect.poll(() => session.state).toBe('offline');
        const local = { ...room.project, name: 'Offline draft' };
        session.stage(local);
        await expect(session.publish(local, session.revision)).rejects.toThrow();
        expect(session.pendingProject?.name).toBe('Offline draft');
        await fixture(running.directory, Number(new URL(running.url).port));
        await expect.poll(() => session.state, { timeout: 5000 }).toBe('connected');
        expect(session.hasPending).toBe(true);
        expect((await session.fetchLatest()).project.name).toBe(room.project.name);
        await session.publish(local, session.revision);
        expect(session.hasPending).toBe(false);
        expect((await session.fetchLatest()).project.name).toBe('Offline draft');
    });

    it('loads retained revisions as data without rewinding the current server baseline', async () => {
        const { url } = await fixture();
        const room = await createCollaborationRoom({
            url,
            adminToken: ADMIN,
            project: createProject(createDefaultScene())
        });
        const session = client();
        await session.connect({
            url,
            roomId: room.roomId,
            token: room.editorToken,
            displayName: 'Recovering author'
        });
        await session.publish({ ...room.project, name: 'Second revision' }, 1);
        const entries = await session.listRevisions();
        expect(entries.map(entry => entry.revision)).toEqual([2, 1]);
        const original = await session.fetchRevision(1);
        expect(original.project.name).toBe(room.project.name);
        expect(session.revision).toBe(2);
        await session.publish(original.project, session.revision);
        expect(session.revision).toBe(3);
    });
});
