export interface GitCommandResult {
    readonly status: number;
    readonly stdout: string;
    readonly stderr: string;
}

export interface GitClient {
    run(arguments_: readonly string[]): GitCommandResult;
}

export interface ReleaseTagState {
    readonly head: string;
    readonly localTarget?: string;
    readonly remoteTarget?: string;
    readonly tag: string;
}

function gitFailure(arguments_: readonly string[], result: GitCommandResult): never {
    const detail =
        result.stderr.trim() || result.stdout.trim() || `exit code ${String(result.status)}`;
    throw new Error(`git ${arguments_.join(' ')} failed: ${detail}`);
}

function runRequired(git: GitClient, arguments_: readonly string[]): string {
    const result = git.run(arguments_);
    if (result.status !== 0) gitFailure(arguments_, result);
    return result.stdout.trim();
}

function optionalCommit(git: GitClient, ref: string): string | undefined {
    const arguments_ = ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`];
    const result = git.run(arguments_);
    if (result.status === 1) return undefined;
    if (result.status !== 0) gitFailure(arguments_, result);
    return result.stdout.trim();
}

export function parseRemoteTagTarget(output: string, tag: string): string | undefined {
    const directRef = `refs/tags/${tag}`;
    const peeledRef = `${directRef}^{}`;
    let directTarget: string | undefined;
    let peeledTarget: string | undefined;

    for (const line of output.trim().split('\n')) {
        if (!line) continue;
        const [target, ref] = line.trim().split(/\s+/u);
        if (!target || !ref) throw new Error(`Unexpected git ls-remote output: ${line}`);
        if (ref === directRef) directTarget = target;
        if (ref === peeledRef) peeledTarget = target;
    }

    return peeledTarget ?? directTarget;
}

function readRemoteTarget(git: GitClient, remote: string, tag: string): string | undefined {
    const arguments_ = ['ls-remote', '--tags', remote, `refs/tags/${tag}`, `refs/tags/${tag}^{}`];
    const result = git.run(arguments_);
    if (result.status !== 0) gitFailure(arguments_, result);
    return parseRemoteTagTarget(result.stdout, tag);
}

function validateTagName(git: GitClient, tag: string): void {
    if (tag.length === 0 || tag.trim() !== tag) {
        throw new Error(`Invalid package version for Git tag: ${tag}`);
    }
    const arguments_ = ['check-ref-format', `refs/tags/${tag}`];
    const result = git.run(arguments_);
    if (result.status !== 0) gitFailure(arguments_, result);
}

function validateTarget(
    label: string,
    target: string | undefined,
    head: string,
    tag: string
): void {
    if (target && target !== head) {
        throw new Error(`${label} tag ${tag} points to ${target}, but HEAD is ${head}.`);
    }
}

export function inspectReleaseTag(
    git: GitClient,
    version: string,
    remote = 'origin'
): ReleaseTagState {
    validateTagName(git, version);
    const head = runRequired(git, ['rev-parse', 'HEAD']);
    const localTarget = optionalCommit(git, `refs/tags/${version}`);
    const remoteTarget = readRemoteTarget(git, remote, version);
    validateTarget('Local', localTarget, head, version);
    validateTarget('Remote', remoteTarget, head, version);
    return {
        head,
        ...(localTarget ? { localTarget } : {}),
        ...(remoteTarget ? { remoteTarget } : {}),
        tag: version
    };
}

export function checkReleaseTag(
    git: GitClient,
    version: string,
    remote = 'origin'
): ReleaseTagState {
    const status = runRequired(git, ['status', '--porcelain', '--untracked-files=all']);
    if (status) {
        throw new Error(
            'Refusing to publish from a dirty Git worktree. Commit all release changes first.'
        );
    }
    return inspectReleaseTag(git, version, remote);
}

export function verifyReleaseTag(
    git: GitClient,
    version: string,
    remote = 'origin'
): ReleaseTagState {
    const state = checkReleaseTag(git, version, remote);
    if (state.localTarget !== state.head) {
        throw new Error(`Local tag ${version} does not point to HEAD ${state.head}.`);
    }
    if (state.remoteTarget !== state.head) {
        throw new Error(`Remote tag ${version} does not point to HEAD ${state.head}.`);
    }
    return state;
}

export function pushReleaseTag(
    git: GitClient,
    version: string,
    remote = 'origin'
): ReleaseTagState {
    let state = checkReleaseTag(git, version, remote);
    if (!state.localTarget) {
        runRequired(git, ['tag', '--annotate', version, '--message', `publish ${version}`]);
        state = inspectReleaseTag(git, version, remote);
    }
    if (!state.remoteTarget) {
        runRequired(git, ['push', remote, `refs/tags/${version}`]);
    }
    return verifyReleaseTag(git, version, remote);
}
