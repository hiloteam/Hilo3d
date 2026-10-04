import { randomBytes } from 'node:crypto';
import { createCollaborationServer } from './server';
import { resolveCollaborationDataDirectory } from './data-directory';

const configuredToken = process.env['HILO_EDITOR_ADMIN_TOKEN'];
const adminToken = configuredToken ?? randomBytes(32).toString('base64url');
const dataDirectory = resolveCollaborationDataDirectory(process.env['HILO_EDITOR_DATA']);
const origins = (
    process.env['HILO_EDITOR_ORIGINS'] ?? 'http://127.0.0.1:5174,http://localhost:5174'
)
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
function limit(name: string, fallback: number): number {
    return Number(process.env[name] ?? fallback);
}
const server = await createCollaborationServer({
    dataDirectory,
    adminToken,
    allowedOrigins: origins,
    maxRooms: limit('HILO_EDITOR_MAX_ROOMS', 32),
    maxRevisions: limit('HILO_EDITOR_MAX_REVISIONS', 20),
    maxProjectBytes: limit('HILO_EDITOR_MAX_PROJECT_BYTES', 24 * 1024 * 1024),
    maxRoomBytes: limit('HILO_EDITOR_MAX_ROOM_BYTES', 128 * 1024 * 1024),
    maxStorageBytes: limit('HILO_EDITOR_MAX_STORAGE_BYTES', 512 * 1024 * 1024),
    maxConnections: limit('HILO_EDITOR_MAX_CONNECTIONS', 64),
    maxRoomConnections: limit('HILO_EDITOR_MAX_ROOM_CONNECTIONS', 16),
    requestsPerMinute: limit('HILO_EDITOR_REQUESTS_PER_MINUTE', 240)
});
const address = await server.listen({
    port: Number(process.env['HILO_EDITOR_PORT'] ?? 5175),
    host: process.env['HILO_EDITOR_HOST'] ?? '127.0.0.1'
});
console.log(`Hilo Studio collaboration: ${address}`);
console.log(`Room data: ${dataDirectory}`);
if (!configuredToken) console.log(`Admin capability for this process: ${adminToken}`);
console.log(
    'Room capabilities are returned only at creation. Keep editor and viewer invites separate.'
);
let closing = false;
const close = (): void => {
    if (closing) return;
    closing = true;
    void server
        .close()
        .then(() => {
            process.exitCode = 0;
        })
        .catch((cause: unknown) => {
            console.error(cause instanceof Error ? cause.message : 'Server shutdown failed');
            process.exitCode = 1;
        });
};
process.once('SIGINT', close);
process.once('SIGTERM', close);
