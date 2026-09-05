import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    checkReleaseTag,
    pushReleaseTag,
    verifyReleaseTag,
    type GitClient,
    type GitCommandResult
} from './release-git-tag-core';

interface PackageManifest {
    readonly version?: unknown;
}

const repositoryRoot = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(
    readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8')
) as PackageManifest;
if (typeof manifest.version !== 'string') {
    throw new Error('package.json must declare a string version.');
}

const git: GitClient = {
    run(arguments_: readonly string[]): GitCommandResult {
        const result = spawnSync('git', arguments_, {
            cwd: repositoryRoot,
            encoding: 'utf8'
        });
        if (result.error) throw result.error;
        return {
            status: result.status ?? 1,
            stdout: result.stdout,
            stderr: result.stderr
        };
    }
};

const action = process.argv[2];
if (action === 'check') {
    const state = checkReleaseTag(git, manifest.version);
    console.log(`Release Git tag ${state.tag} is available for ${state.head}.`);
} else if (action === 'push') {
    const state = pushReleaseTag(git, manifest.version);
    console.log(`Verified remote Git tag ${state.tag} at ${state.head}.`);
} else if (action === 'verify') {
    const state = verifyReleaseTag(git, manifest.version);
    console.log(`Verified release Git tag ${state.tag} at ${state.head}.`);
} else {
    throw new Error('Usage: release-git-tag.ts <check|push|verify>');
}
