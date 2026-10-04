import './collaboration-panel.css';
import {
    CollaborationClient,
    CollaborationConflictError,
    createCollaborationRoom,
    deleteCollaborationRoom,
    listCollaborationRooms,
    rotateCollaborationCapabilities,
    sameCollaborationContent,
    type CollaborationRole,
    type CollaborationSnapshot
} from './collaboration';
import { serializeProject, validateProject, type ProjectDocument } from './project';

export interface CollaborationPanelOptions {
    getProject: () => ProjectDocument;
    /** Apply remote authoring data while preserving this browser's local project storage identity. */
    onRemoteProject: (project: ProjectDocument, label: string) => void | Promise<void>;
    onNotify: (message: string, isError?: boolean) => void;
    onSaveCopy?: () => void | Promise<void>;
    onRole?: (role: CollaborationRole | null) => void;
}

function escapeHtml(value: string): string {
    return value.replace(
        /[&<>"']/gu,
        character =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
            character
    );
}

/** Self-hosted room controls. Capability tokens stay in this session and never enter project data. */
export class CollaborationPanel {
    private readonly client = new CollaborationClient();
    private readonly dialog = document.createElement('dialog');
    private readonly button = document.createElement('button');
    private readonly controller = new AbortController();
    private busy = false;
    private destroyed = false;
    private applyingRemote = false;
    private localProjectId: string | null = null;
    private conflict: CollaborationSnapshot | null = null;
    private autoSync = false;
    private autoTimer: ReturnType<typeof setTimeout> | undefined;
    private message =
        'Connect to your own collaboration server. Projects stay local until you create or publish to a room.';
    private remoteRevision = 0;
    private lastRole: CollaborationRole | null = null;
    private inviteRoomId: string | null = null;

    constructor(
        app: HTMLElement,
        private readonly options: CollaborationPanelOptions
    ) {
        this.button.type = 'button';
        this.button.className = 'collaboration-open';
        this.button.textContent = 'Collaborate';
        this.button.setAttribute('aria-label', 'Open collaboration');
        (app.querySelector('.file-controls') ?? app.querySelector('.menubar') ?? app).append(
            this.button
        );
        this.dialog.className = 'collaboration-dialog';
        this.dialog.setAttribute('aria-label', 'Project collaboration');
        this.dialog.innerHTML = `
            <div class="collaboration-heading"><div><strong>Project collaboration</strong><span>Self-hosted rooms · authenticated capabilities</span></div><button type="button" data-collaboration-action="close" aria-label="Close collaboration">×</button></div>
            <div class="collaboration-body">
                <p class="collaboration-description">Share complete project revisions with your team. Editors can publish; viewers can read and preview. Concurrent edits are retained for explicit review.</p>
                <div class="collaboration-status" role="status" aria-live="polite"></div>
                <div class="collaboration-fields">
                    <label class="collaboration-wide">Server URL<input data-collaboration-field="url" type="url" aria-label="Collaboration server URL" value="http://127.0.0.1:5175" autocomplete="off" spellcheck="false"/></label>
                    <label>Display name<input data-collaboration-field="name" aria-label="Collaboration display name" value="Editor" maxlength="60" autocomplete="off"/></label>
                    <label>Room ID<input data-collaboration-field="room" aria-label="Collaboration room ID" placeholder="room-…" autocomplete="off" spellcheck="false"/></label>
                    <label class="collaboration-wide">Room capability<input data-collaboration-field="token" type="password" aria-label="Room capability token" placeholder="Paste an editor or viewer token" autocomplete="off" spellcheck="false"/></label>
                </div>
                <div class="collaboration-actions"><button type="button" data-collaboration-action="join">Join & load shared project</button><button type="button" data-collaboration-action="disconnect">Disconnect</button><span class="collaboration-role"></span></div>
                <div class="collaboration-session" hidden>
                    <div class="collaboration-presence" aria-label="Room members"></div>
                    <div class="collaboration-actions"><button type="button" data-collaboration-action="publish">Publish local changes</button><button type="button" data-collaboration-action="fetch">Fetch shared version</button><label><input type="checkbox" data-collaboration-field="auto"/>Publish automatically after edits</label></div>
                    <p class="collaboration-pending"></p>
                    <div class="collaboration-conflict" hidden><strong>Choose how to resolve this version</strong><p>Your local work has not been overwritten. Loading shared data replaces the active local draft; keep a copy first if needed.</p><div class="collaboration-actions"><button type="button" data-collaboration-action="load-shared">Replace local with shared</button><button type="button" data-collaboration-action="copy">${options.onSaveCopy ? 'Keep local copy & disconnect' : 'Download local copy & disconnect'}</button><button type="button" data-collaboration-action="replace-shared">Replace shared with local</button></div></div>
                    <details class="collaboration-recovery"><summary>Revision recovery</summary><p>Load a retained revision as a local draft, review it, then publish it as a new shared revision.</p><div class="collaboration-actions"><button type="button" data-collaboration-action="history">Refresh history</button><select data-collaboration-field="revision" aria-label="Shared recovery revision"><option value="">Load revision list</option></select><button type="button" data-collaboration-action="recover">Load as local draft</button></div></details>
                </div>
                <details class="collaboration-create"><summary>Create a room from this local project</summary><p>Start the repository collaboration server, then use its administrator capability. Room creation returns separate editor and viewer invitations.</p><label>Server admin capability<input data-collaboration-field="admin" type="password" aria-label="Server admin capability" autocomplete="off" spellcheck="false"/></label><button type="button" data-collaboration-action="create">Create shared room</button></details>
                <details class="collaboration-administration"><summary>Server administration</summary><p>Rotate leaked invitations or delete rooms and their retained history. These actions require the server administrator capability.</p><label>Administrator capability<input data-collaboration-field="manage-admin" type="password" aria-label="Administration capability" autocomplete="off" spellcheck="false"/></label><div class="collaboration-actions"><button type="button" data-collaboration-action="list-rooms">List rooms</button><select data-collaboration-field="managed-room" aria-label="Room to administer"><option value="">Use room ID above</option></select></div><div class="collaboration-actions"><select data-collaboration-field="managed-role" aria-label="Capability role to rotate"><option value="all">All capabilities</option><option value="editor">Editor capability</option><option value="viewer">Viewer capability</option></select><label><input data-collaboration-field="confirm-rotation" type="checkbox"/>Invalidate old invitations and disconnect affected members</label><button type="button" data-collaboration-action="rotate">Rotate invitations</button></div><label class="collaboration-delete-confirm">Type the exact room ID to delete this room and all shared recovery history<input data-collaboration-field="confirm-deletion" aria-label="Confirm room deletion" autocomplete="off" spellcheck="false"/></label><button type="button" data-collaboration-action="delete-room">Delete shared room</button></details>
                <section class="collaboration-invites" hidden><strong>Retain these new invitations</strong><code class="collaboration-invite-room"></code><p>Only this session can display the plaintext tokens. Give the viewer token to people who should not publish.</p><label>Editor token<div><input data-collaboration-field="editor-invite" type="password" readonly aria-label="Created editor token"/><button type="button" data-collaboration-action="copy-editor">Copy editor token</button></div></label><label>Viewer token<div><input data-collaboration-field="viewer-invite" type="password" readonly aria-label="Created viewer token"/><button type="button" data-collaboration-action="copy-viewer">Copy viewer token</button></div></label><button type="button" data-collaboration-action="copy-room">Copy room ID</button></section>
                <p class="collaboration-boundary">Tokens stay in session memory and are never saved in project exports or browser storage. This server uses room capabilities; it does not provide an external identity provider or automatic conflict merging.</p>
            </div>`;
        app.append(this.dialog);
        const signal = this.controller.signal;
        this.button.addEventListener(
            'click',
            () => {
                this.dialog.showModal();
                this.update();
            },
            { signal }
        );
        this.dialog.addEventListener(
            'click',
            event => {
                if (!(event.target instanceof Element)) return;
                const target = event.target.closest<HTMLElement>('[data-collaboration-action]');
                const action = target?.dataset['collaborationAction'];
                if (action === 'close') this.dialog.close();
                else if (action) this.run(() => this.action(action));
            },
            { signal }
        );
        this.field('auto').addEventListener(
            'change',
            event => {
                if (!(event.target instanceof HTMLInputElement)) return;
                this.autoSync = event.target.checked;
                if (this.autoSync) this.schedulePublish();
                else this.clearAutoTimer();
            },
            { signal }
        );
        this.update();
    }

    get role(): CollaborationRole | null {
        return this.client.role;
    }
    get canEditShared(): boolean {
        return this.client.role !== 'viewer';
    }

    /** Call after an authored project transaction. Remote adoption is suppressed to avoid echoes. */
    projectChanged(): void {
        if (
            this.destroyed ||
            this.applyingRemote ||
            this.client.role === null ||
            this.client.state === 'disconnected' ||
            this.client.state === 'connecting'
        )
            return;
        const project = this.options.getProject();
        if (this.localProjectId && project.id !== this.localProjectId) {
            this.disconnect();
            this.message = 'Another local project was opened. The shared room was disconnected.';
            this.update();
            return;
        }
        try {
            this.client.stage(project);
            this.schedulePublish();
        } catch (cause) {
            this.notifyError(cause);
        }
        this.update();
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.clearAutoTimer();
        this.client.disconnect();
        this.controller.abort();
        this.dialog.close();
        this.dialog.remove();
        this.button.remove();
    }

    private field(name: string): HTMLInputElement {
        const input = this.dialog.querySelector<HTMLInputElement>(
            `[data-collaboration-field="${name}"]`
        );
        if (!input) throw new Error(`Missing collaboration field ${name}`);
        return input;
    }

    private element(selector: string): HTMLElement {
        const element = this.dialog.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`Missing collaboration UI ${selector}`);
        return element;
    }

    private async connect(): Promise<void> {
        const joiningProject = validateProject(this.options.getProject());
        let joining = true;
        try {
            const remote = await this.client.connect(
                {
                    url: this.field('url').value.trim(),
                    roomId: this.field('room').value.trim(),
                    token: this.field('token').value.trim(),
                    displayName: this.field('name').value.trim()
                },
                {
                    onStatus: (_state, message) => {
                        this.message = message;
                        if (this.lastRole !== this.client.role) {
                            this.lastRole = this.client.role;
                            this.options.onRole?.(this.client.role);
                        }
                        this.update();
                        this.schedulePublish();
                    },
                    onRemote: async snapshot => {
                        if (
                            joining &&
                            (this.options.getProject().id !== joiningProject.id ||
                                !sameCollaborationContent(
                                    this.options.getProject(),
                                    joiningProject
                                ))
                        )
                            throw new Error(
                                'Local work changed while joining. Your edits are retained; join again when ready to load the shared project.'
                            );
                        this.applyingRemote = true;
                        try {
                            await this.options.onRemoteProject(
                                validateProject(snapshot.project),
                                `Shared revision ${String(snapshot.revision)} loaded`
                            );
                            this.localProjectId = this.options.getProject().id;
                            this.remoteRevision = snapshot.revision;
                            this.conflict = null;
                        } finally {
                            this.applyingRemote = false;
                        }
                    },
                    onPresence: () => {
                        this.update();
                    },
                    onConflict: snapshot => {
                        this.conflict = snapshot;
                        this.remoteRevision = snapshot.revision;
                        this.clearAutoTimer();
                        this.update();
                    }
                }
            );
            this.remoteRevision = remote.revision;
            this.field('token').value = '';
            this.localProjectId = this.options.getProject().id;
            this.update();
        } catch (cause) {
            this.client.disconnect();
            throw cause;
        } finally {
            joining = false;
        }
    }

    private disconnect(): void {
        this.clearAutoTimer();
        this.client.disconnect();
        this.autoSync = false;
        this.field('auto').checked = false;
        this.localProjectId = null;
        for (const name of ['token', 'admin', 'manage-admin', 'editor-invite', 'viewer-invite'])
            this.field(name).value = '';
        this.element('.collaboration-invites').hidden = true;
        this.inviteRoomId = null;
        this.update();
    }

    private async action(action: string): Promise<void> {
        if (action === 'join') {
            await this.connect();
            return;
        }
        if (action === 'disconnect') {
            this.disconnect();
            return;
        }
        if (action === 'create') {
            if (this.client.role) throw new Error('Disconnect before creating another room.');
            const sourceProject = validateProject(this.options.getProject());
            const room = await createCollaborationRoom({
                url: this.field('url').value.trim(),
                adminToken: this.field('admin').value.trim(),
                project: sourceProject,
                signal: this.controller.signal
            });
            this.field('admin').value = '';
            this.field('room').value = room.roomId;
            this.field('token').value = room.editorToken;
            this.field('editor-invite').value = room.editorToken;
            this.field('viewer-invite').value = room.viewerToken;
            this.element('.collaboration-invites').hidden = false;
            this.inviteRoomId = room.roomId;
            this.element('.collaboration-invite-room').textContent = room.roomId;
            if (
                sourceProject.id !== this.options.getProject().id ||
                !sameCollaborationContent(sourceProject, this.options.getProject())
            ) {
                this.message =
                    'Room created from the earlier local revision. Newer local edits were retained; join the room explicitly when ready.';
                return;
            }
            this.client.disconnect();
            this.client.clearPending();
            await this.connect();
            return;
        }
        if (action === 'list-rooms') {
            const rooms = await listCollaborationRooms({
                url: this.field('url').value.trim(),
                adminToken: this.field('manage-admin').value.trim()
            });
            const select = this.dialog.querySelector<HTMLSelectElement>(
                '[data-collaboration-field="managed-room"]'
            );
            if (select)
                select.innerHTML =
                    rooms
                        .map(
                            room =>
                                `<option value="${room.roomId}">${escapeHtml(room.name)} · ${room.roomId}</option>`
                        )
                        .join('') || '<option value="">No shared rooms</option>';
            this.message = `${String(rooms.length)} shared rooms available for administration.`;
            return;
        }
        if (action === 'rotate' || action === 'delete-room') {
            const select = this.dialog.querySelector<HTMLSelectElement>(
                '[data-collaboration-field="managed-room"]'
            );
            const targetRoom =
                select && select.value !== '' ? select.value : this.field('room').value.trim();
            const common = {
                url: this.field('url').value.trim(),
                roomId: targetRoom,
                adminToken: this.field('manage-admin').value.trim()
            };
            if (action === 'rotate') {
                if (!this.field('confirm-rotation').checked)
                    throw new Error(
                        'Confirm that old invitations will be invalidated before rotating.'
                    );
                const role = this.dialog.querySelector<HTMLSelectElement>(
                    '[data-collaboration-field="managed-role"]'
                )?.value;
                if (role !== 'editor' && role !== 'viewer' && role !== 'all')
                    throw new Error('Select a capability role.');
                const rotated = await rotateCollaborationCapabilities({ ...common, role });
                if (this.inviteRoomId !== targetRoom) {
                    this.field('editor-invite').value = '';
                    this.field('viewer-invite').value = '';
                }
                this.inviteRoomId = targetRoom;
                this.element('.collaboration-invite-room').textContent = targetRoom;
                if (rotated.editorToken) this.field('editor-invite').value = rotated.editorToken;
                if (rotated.viewerToken) this.field('viewer-invite').value = rotated.viewerToken;
                this.element('.collaboration-invites').hidden = false;
                this.field('confirm-rotation').checked = false;
                this.message =
                    'Invitations rotated. Affected members were disconnected; retain and distribute the new capabilities.';
            } else {
                if (!targetRoom || this.field('confirm-deletion').value.trim() !== targetRoom)
                    throw new Error(
                        'Type the exact targeted room ID before deleting its shared history.'
                    );
                await deleteCollaborationRoom(common);
                this.field('confirm-deletion').value = '';
                if (this.inviteRoomId === targetRoom) {
                    this.field('editor-invite').value = '';
                    this.field('viewer-invite').value = '';
                    this.inviteRoomId = null;
                    this.element('.collaboration-invites').hidden = true;
                }
                this.message =
                    'Shared room and retained history deleted. Local project copies remain available.';
            }
            this.field('manage-admin').value = '';
            return;
        }
        if (action === 'publish') {
            await this.client.publish(this.options.getProject(), this.client.revision);
            this.conflict = null;
            return;
        }
        if (action === 'fetch') {
            this.conflict = await this.client.fetchLatest();
            this.remoteRevision = this.conflict.revision;
            this.message = `Fetched shared revision ${String(this.conflict.revision)}. Choose whether to replace the active local version.`;
            return;
        }
        if (action === 'load-shared') {
            const remote = this.conflict ?? (await this.client.fetchLatest());
            await this.client.acceptRemote(remote);
            this.conflict = null;
            return;
        }
        if (action === 'replace-shared') {
            if (!this.conflict) return;
            await this.client.publish(this.options.getProject(), this.conflict.revision);
            this.conflict = null;
            return;
        }
        if (action === 'copy') {
            this.disconnect();
            if (this.options.onSaveCopy) await this.options.onSaveCopy();
            else {
                const source = this.options.getProject();
                const now = new Date().toISOString();
                const copy = validateProject({
                    ...source,
                    id: `project-${crypto.randomUUID()}`,
                    revision: 0,
                    createdAt: now,
                    updatedAt: now,
                    name: `${source.name.slice(0, 105)} (local copy)`
                });
                const url = URL.createObjectURL(
                    new Blob([serializeProject(copy)], { type: 'application/json' })
                );
                const link = document.createElement('a');
                link.href = url;
                link.download = 'hilo-local-conflict-copy.json';
                link.click();
                setTimeout(() => {
                    URL.revokeObjectURL(url);
                }, 1000);
            }
            this.client.clearPending();
            this.conflict = null;
            this.message = 'Local copy retained. Disconnected from the shared room.';
            this.options.onNotify(this.message);
            return;
        }
        if (action === 'history') {
            const revisions = await this.client.listRevisions();
            const select = this.dialog.querySelector<HTMLSelectElement>(
                '[data-collaboration-field="revision"]'
            );
            if (select)
                select.innerHTML = revisions
                    .map(
                        item =>
                            `<option value="${String(item.revision)}">Revision ${String(item.revision)} · ${escapeHtml(new Date(item.updatedAt).toLocaleString())}</option>`
                    )
                    .join('');
            return;
        }
        if (action === 'recover') {
            const input = this.dialog.querySelector<HTMLSelectElement>(
                '[data-collaboration-field="revision"]'
            );
            const value = Number(input?.value);
            if (!Number.isSafeInteger(value) || value < 1)
                throw new Error('Refresh history and choose a retained revision.');
            const remote = await this.client.fetchRevision(value);
            this.autoSync = false;
            this.field('auto').checked = false;
            this.applyingRemote = true;
            try {
                await this.options.onRemoteProject(
                    remote.project,
                    `Shared revision ${String(value)} loaded as a local draft`
                );
            } finally {
                this.applyingRemote = false;
            }
            this.client.stage(this.options.getProject());
            this.message =
                'Recovery draft loaded. Review it and publish to create a new shared revision.';
            return;
        }
        if (action === 'copy-editor' || action === 'copy-viewer' || action === 'copy-room') {
            const field =
                action === 'copy-editor'
                    ? 'editor-invite'
                    : action === 'copy-viewer'
                      ? 'viewer-invite'
                      : 'room';
            await navigator.clipboard.writeText(
                field === 'room'
                    ? (this.inviteRoomId ?? this.field('room').value)
                    : this.field(field).value
            );
            this.message =
                action === 'copy-room'
                    ? 'Room ID copied.'
                    : 'Capability copied. Share it only with the intended role.';
        }
    }

    private update(): void {
        if (this.destroyed) return;
        const role = this.client.role;
        const joined = role !== null;
        this.button.textContent =
            this.client.state === 'conflict'
                ? 'Collaboration · conflict'
                : joined
                  ? `Collaborate · ${role}`
                  : 'Collaborate';
        this.button.dataset['state'] = this.client.state;
        this.element('.collaboration-status').textContent = this.message;
        this.element('.collaboration-status').dataset['state'] = this.client.state;
        this.element('.collaboration-role').textContent = role
            ? `${role === 'viewer' ? 'Viewer · authoring disabled' : 'Editor'} · shared revision ${String(this.client.revision)}`
            : 'Local workspace';
        this.element('.collaboration-session').hidden = !joined && !this.client.hasPending;
        this.element('.collaboration-conflict').hidden =
            this.conflict === null && !(this.client.hasPending && !joined);
        this.element('.collaboration-pending').textContent = this.client.hasPending
            ? `Unsent local work is retained.${this.conflict ? ` Shared revision ${String(this.remoteRevision)} needs review.` : ''}`
            : 'No unsent local changes.';
        this.element('.collaboration-presence').innerHTML = this.client.peers.length
            ? this.client.peers
                  .map(
                      peer =>
                          `<span>${escapeHtml(peer.displayName)} <small>${peer.role}</small></span>`
                  )
                  .join('')
            : '<span>Presence connects automatically while this room is open.</span>';
        for (const button of this.dialog.querySelectorAll<HTMLButtonElement>(
            '[data-collaboration-action]'
        )) {
            const action = button.dataset['collaborationAction'];
            button.disabled = this.busy && action !== 'close';
            if (action === 'join') button.disabled ||= joined;
            if (action === 'create') button.disabled ||= joined;
            if (action === 'copy-editor') button.disabled ||= !this.field('editor-invite').value;
            if (action === 'copy-viewer') button.disabled ||= !this.field('viewer-invite').value;
            if (action === 'disconnect') button.disabled ||= this.client.state === 'disconnected';
            if (action === 'fetch' || action === 'history' || action === 'load-shared')
                button.disabled ||= !joined;
            if (action === 'publish' || action === 'replace-shared' || action === 'recover')
                button.disabled ||= role !== 'editor';
            if (action === 'replace-shared' || action === 'load-shared')
                button.disabled ||= !this.conflict;
        }
        for (const name of ['url', 'room', 'token', 'name'])
            this.field(name).disabled = joined || this.busy;
        this.field('auto').disabled = role !== 'editor' || this.busy;
    }

    private run(action: () => Promise<void>): void {
        if (this.destroyed || this.busy) return;
        this.busy = true;
        this.update();
        void action()
            .catch((cause: unknown) => {
                this.notifyError(cause);
            })
            .finally(() => {
                this.busy = false;
                this.update();
                this.schedulePublish();
            });
    }

    private schedulePublish(): void {
        this.clearAutoTimer();
        if (
            !this.autoSync ||
            this.busy ||
            this.destroyed ||
            this.applyingRemote ||
            this.client.role !== 'editor' ||
            this.client.state !== 'connected' ||
            !this.client.hasPending ||
            this.conflict
        )
            return;
        this.autoTimer = setTimeout(() => {
            this.run(async () => {
                await this.client.publish(this.options.getProject(), this.client.revision);
            });
        }, 600);
    }

    private clearAutoTimer(): void {
        if (this.autoTimer !== undefined) clearTimeout(this.autoTimer);
        this.autoTimer = undefined;
    }

    private notifyError(cause: unknown): void {
        if (this.destroyed) return;
        if (cause instanceof CollaborationConflictError) this.conflict = cause.snapshot;
        if (this.autoSync && this.client.state !== 'offline' && this.client.state !== 'conflict') {
            this.autoSync = false;
            this.field('auto').checked = false;
            this.clearAutoTimer();
        }
        this.message = cause instanceof Error ? cause.message : String(cause);
        this.options.onNotify(this.message, true);
        this.update();
    }
}
