import { describe, expect, it } from 'vitest';
import {
    checkReleaseTag,
    parseRemoteTagTarget,
    pushReleaseTag,
    verifyReleaseTag,
    type GitClient,
    type GitCommandResult
} from '../../../scripts/release-git-tag-core';

const head = '1111111111111111111111111111111111111111';
const tagObject = '2222222222222222222222222222222222222222';

class FakeGit implements GitClient {
    readonly calls: string[][] = [];
    dirty = false;
    localTarget?: string;
    remoteTarget?: string;

    run(arguments_: readonly string[]): GitCommandResult {
        const args = [...arguments_];
        this.calls.push(args);
        const command = args.join(' ');
        if (command === 'status --porcelain --untracked-files=all') {
            return this.result(0, this.dirty ? ' M package.json\n' : '');
        }
        if (command === 'check-ref-format refs/tags/2.0.0-alpha.5') return this.result(0);
        if (command === 'rev-parse HEAD') return this.result(0, `${head}\n`);
        if (command === 'rev-parse --verify --quiet refs/tags/2.0.0-alpha.5^{commit}') {
            return this.localTarget ? this.result(0, `${this.localTarget}\n`) : this.result(1);
        }
        if (command.startsWith('ls-remote --tags origin ')) {
            return this.remoteTarget
                ? this.result(
                      0,
                      `${tagObject}\trefs/tags/2.0.0-alpha.5\n${this.remoteTarget}\trefs/tags/2.0.0-alpha.5^{}\n`
                  )
                : this.result(0);
        }
        if (command === 'tag --annotate 2.0.0-alpha.5 --message publish 2.0.0-alpha.5') {
            this.localTarget = head;
            return this.result(0);
        }
        if (command === 'push origin refs/tags/2.0.0-alpha.5') {
            this.remoteTarget = head;
            return this.result(0);
        }
        return this.result(2, '', `Unexpected command: ${command}`);
    }

    private result(status: number, stdout = '', stderr = ''): GitCommandResult {
        return { status, stdout, stderr };
    }
}

describe('release Git tag automation', () => {
    it('prefers an annotated tag peeled target', () => {
        expect(
            parseRemoteTagTarget(
                `${tagObject}\trefs/tags/2.0.0-alpha.5\n${head}\trefs/tags/2.0.0-alpha.5^{}\n`,
                '2.0.0-alpha.5'
            )
        ).toBe(head);
    });

    it('rejects dirty release worktrees before publishing', () => {
        const git = new FakeGit();
        git.dirty = true;
        expect(() => checkReleaseTag(git, '2.0.0-alpha.5')).toThrow('dirty Git worktree');
    });

    it('rejects a conflicting remote tag', () => {
        const git = new FakeGit();
        git.remoteTarget = '3333333333333333333333333333333333333333';
        expect(() => checkReleaseTag(git, '2.0.0-alpha.5')).toThrow(
            'Remote tag 2.0.0-alpha.5 points to'
        );
    });

    it('creates, pushes, and verifies the version tag', () => {
        const git = new FakeGit();
        const state = pushReleaseTag(git, '2.0.0-alpha.5');
        expect(state).toMatchObject({ head, localTarget: head, remoteTarget: head });
        expect(git.calls).toContainEqual([
            'tag',
            '--annotate',
            '2.0.0-alpha.5',
            '--message',
            'publish 2.0.0-alpha.5'
        ]);
        expect(git.calls).toContainEqual(['push', 'origin', 'refs/tags/2.0.0-alpha.5']);
    });

    it('requires the release tag locally and remotely before npm publishing', () => {
        const git = new FakeGit();
        expect(() => verifyReleaseTag(git, '2.0.0-alpha.5')).toThrow(
            'Local tag 2.0.0-alpha.5 does not point to HEAD'
        );
        git.localTarget = head;
        expect(() => verifyReleaseTag(git, '2.0.0-alpha.5')).toThrow(
            'Remote tag 2.0.0-alpha.5 does not point to HEAD'
        );
    });

    it('is idempotent when the tag is already published from HEAD', () => {
        const git = new FakeGit();
        git.localTarget = head;
        git.remoteTarget = head;
        pushReleaseTag(git, '2.0.0-alpha.5');
        expect(git.calls.some(call => call[0] === 'tag')).toBe(false);
        expect(git.calls.some(call => call[0] === 'push')).toBe(false);
    });
});
