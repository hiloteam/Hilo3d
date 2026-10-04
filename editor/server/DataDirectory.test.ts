import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveCollaborationDataDirectory } from './data-directory';

describe('durable collaboration data directory', () => {
    it('defaults to the user data directory rather than repository-generated cache files', () => {
        expect(resolveCollaborationDataDirectory()).toBe(
            join(homedir(), '.hilo-studio', 'collaboration')
        );
        expect(resolveCollaborationDataDirectory('')).toBe(
            join(homedir(), '.hilo-studio', 'collaboration')
        );
        expect(resolveCollaborationDataDirectory('   ')).toBe(
            join(homedir(), '.hilo-studio', 'collaboration')
        );
    });

    it('honors an explicitly configured storage location', () => {
        expect(resolveCollaborationDataDirectory('team-data/rooms')).toBe(
            resolve('team-data/rooms')
        );
        expect(resolveCollaborationDataDirectory(join(homedir(), 'studio-data'))).toBe(
            join(homedir(), 'studio-data')
        );
    });
});
