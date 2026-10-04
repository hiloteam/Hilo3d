import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Durable room data stays outside repository clean/build outputs unless explicitly overridden. */
export function resolveCollaborationDataDirectory(override?: string): string {
    return override?.trim() ? resolve(override) : join(homedir(), '.hilo-studio', 'collaboration');
}
