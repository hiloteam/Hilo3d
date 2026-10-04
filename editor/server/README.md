# Self-hosted editor collaboration

This server shares complete Hilo Studio project revisions through authenticated rooms. It supports
editor and viewer capabilities, presence, server-sent revision events, explicit optimistic conflicts
and retained recovery snapshots. It is a single-process service with atomic JSON persistence, not a
multi-primary database, external identity provider or automatic operational-transform/CRDT service.

## Start

Use the repository's supported Node.js and npm versions and install dependencies with `npm ci`.

```sh
npm run editor:server
```

The default address is `http://127.0.0.1:5175`. If `HILO_EDITOR_ADMIN_TOKEN` is not configured, the
process prints a fresh administrator capability once at startup. In the editor, choose
**Collaborate**, expand **Create a room from this local project**, and paste that administrator
capability. Room creation returns separate editor and viewer tokens. Retain the intended invitation;
the server stores only SHA-256 hashes and cannot recover plaintext tokens later.

The **Server administration** section lists rooms using the administrator capability. It can rotate
an editor token, a viewer token or both. Rotation atomically replaces the stored hashes and closes
affected presence streams; old invitations immediately stop authenticating, including uploads that
were still waiting to commit. Retain the replacement capabilities before closing the session.

Deleting a room requires typing its exact ID. It removes the shared room and its retained recovery
history, disconnects members, and releases its room/storage budget; separately stored local copies
are unaffected. Administrative listing, rotation and deletion never accept room-level capabilities.

To join from another editor, provide the server URL, room ID and an editor or viewer token. Browser
requests send the token in `Authorization: Bearer …`, including the streaming connection. Tokens
never appear in URLs, project exports or browser storage. Disconnecting or closing the editor clears
the client's capabilities; unsent project content remains local.

For remote teammates, terminate HTTPS at your reverse proxy, forward the service to its loopback
listener, disable response buffering on `/rooms/*/events`, and configure the exact editor origin in
`HILO_EDITOR_ORIGINS`. The browser client permits plain HTTP only for loopback hosts. Do not enable
wildcard CORS. Requests without an Origin header support authenticated command-line clients.

## Configuration

| Environment variable               | Default                                       | Meaning                                                                                                 |
| ---------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `HILO_EDITOR_ADMIN_TOKEN`          | Fresh process capability                      | 32–256 URL-safe characters; only this capability creates rooms.                                         |
| `HILO_EDITOR_HOST`                 | `127.0.0.1`                                   | Explicit listening interface.                                                                           |
| `HILO_EDITOR_PORT`                 | `5175`                                        | HTTP listening port.                                                                                    |
| `HILO_EDITOR_DATA`                 | `~/.hilo-studio/collaboration`                | Dedicated persistent room storage directory, outside repository build/clean output.                     |
| `HILO_EDITOR_ORIGINS`              | `http://127.0.0.1:5174,http://localhost:5174` | Comma-separated exact browser origins.                                                                  |
| `HILO_EDITOR_MAX_ROOMS`            | `32`                                          | Maximum retained rooms.                                                                                 |
| `HILO_EDITOR_MAX_REVISIONS`        | `20`                                          | Maximum retained snapshots per room; the room byte budget can retain fewer.                             |
| `HILO_EDITOR_MAX_PROJECT_BYTES`    | `25165824`                                    | Maximum validated project payload, 24 MiB. This is separate from local project export limits.           |
| `HILO_EDITOR_MAX_ROOM_BYTES`       | `134217728`                                   | Maximum retained room file, 128 MiB.                                                                    |
| `HILO_EDITOR_MAX_STORAGE_BYTES`    | `536870912`                                   | Maximum total retained room files, 512 MiB. An atomic write temporarily needs one additional room file. |
| `HILO_EDITOR_MAX_CONNECTIONS`      | `64`                                          | Maximum simultaneous presence streams.                                                                  |
| `HILO_EDITOR_MAX_ROOM_CONNECTIONS` | `16`                                          | Maximum presence streams in one room.                                                                   |
| `HILO_EDITOR_REQUESTS_PER_MINUTE`  | `240`                                         | Per-source-IP request budget, including stream reconnections.                                           |

Transport also caps concurrent JSON requests at 16, request bodies at the project limit plus bounded
metadata, headers at 32, and slow-stream buffering at 64 KiB. Request and header timeouts are
finite. Increase quotas only for workloads whose storage and memory budgets are understood. The
service uses the actual socket source address; it does not trust arbitrary forwarded-IP headers.

## Editing, conflicts and recovery

The shared revision counter is independent from a browser's IndexedDB project revision. Receivers
may retain their local project identity while applying the shared authoring content. Scene and asset
identifiers remain stable. A publication includes the last reviewed server revision; stale requests
return HTTP 409 and leave both versions intact.

The client retains an unsent snapshot across interrupted connections and retries the read stream
with backoff. It never silently replaces a pending local draft with a remote update. In the dialog,
fetch the shared version and choose whether to replace the local draft, keep a local copy and
disconnect, or explicitly replace the reviewed shared revision. The latter still uses
compare-and-swap: another concurrent publication requires review again. Automatic publishing is
opt-in and pauses on conflicts or rejected writes.

**Revision recovery** lists retained snapshots. Loading one creates a local draft for review;
publishing that draft appends a new shared revision. It does not rewind the server counter or mutate
the retained historical snapshot.

## Persistence and operations

Every accepted update writes a new file, syncs it, atomically renames it over the room file, and
syncs the directory before acknowledging success. A storage failure blocks further writes until the
service restarts. Project validation, capability hashes and bounded revision history are checked
when the service starts; corrupt data fails closed rather than creating an empty replacement
project.

One writer owns each data directory through `.hilo-collaboration.lock`. A second process is
rejected. A clean shutdown drains writes and removes the lock. After a crash, verify that the owning
process is stopped before removing its stale lock and restarting. Startup removes only orphaned
files matching the service's private atomic-write filename pattern. Back up the dedicated data
directory while the service is stopped; invite capabilities must be distributed separately.

The current capability model has no per-user revocation, external SSO, audit identity verification
or cross-region replication. Display names are presence labels, not verified user identities. A
room's editor token is a shared write capability; rotate that role's token to revoke an exposed
invitation. The administrator capability is process configuration: change `HILO_EDITOR_ADMIN_TOKEN`
and restart to rotate it. These boundaries should inform the intended deployment.

## Validation

```sh
npx vitest run --config vitest.editor-node.config.ts
```

The Node suite starts real HTTP servers on ephemeral loopback ports with isolated temporary storage.
It covers role enforcement, concurrent writes, restart persistence, revisions, presence, request
budgets, two-client updates, dirty conflicts, offline reconnection and local storage identity.
Browser component tests cover the collaboration dialog separately. Passing these tests is not a
distributed load, deployment or security-audit claim.
