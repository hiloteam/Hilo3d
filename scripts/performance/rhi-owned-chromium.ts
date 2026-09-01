import { constants as bufferConstants } from 'node:buffer';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type CDPSession } from 'playwright';
import {
    compactRHIHeapProfilerStopResponse,
    RHI_STREAMING_HEAP_PROFILER_MAX_PAYLOAD_BYTES,
    type RHIHeapProfilerSamplingMode
} from './rhi-streaming-heap-profiler';

const LOOPBACK_HOST = '127.0.0.1';
const DEVTOOLS_ACTIVE_PORT_FILE = 'DevToolsActivePort';
const BROWSER_START_TIMEOUT_MS = 120_000;
const BROWSER_CLOSE_TIMEOUT_MS = 10_000;
const PROCESS_SIGNAL_TIMEOUT_MS = 5_000;
/** @internal Exported only so the raw-pipe contract test can exercise the exact bound. */
export const RHI_OWNED_CHROMIUM_SMALL_CDP_MESSAGE_MAX_BYTES = 16 * 1024 * 1024;
const PIPE_DELIMITER = Buffer.from([0]);
const DEFAULT_ARGUMENT_HELPER_MAX_BYTES = 1024 * 1024;
const DEFAULT_ARGUMENT_HELPER_SOURCE = String.raw`
import * as bundle from 'playwright-core/lib/coreBundle';

(async () => {
    const input = JSON.parse(process.argv[1]);
    const playwright = bundle.server.createPlaywright({ sdkLanguage: 'javascript', isServer: false });
    const args = await playwright.chromium.defaultArgs(
        { headless: true, args: input.extraArguments },
        false,
        input.userDataDir
    );
    process.stdout.write(JSON.stringify(args));
})().catch(error => {
    process.stderr.write(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
});`;

interface PendingPipeCommand {
    readonly method: string;
    readonly sessionId?: string;
    readonly stopSamplingMode?: RHIHeapProfilerSamplingMode;
    readonly resolve: (value: unknown) => void;
    readonly reject: (reason: unknown) => void;
}

interface PipeCommandOptions {
    readonly sessionId?: string;
    readonly stopSamplingMode?: RHIHeapProfilerSamplingMode;
}

interface CDPErrorResponse {
    readonly code?: unknown;
    readonly message?: unknown;
}

interface DevToolsActivePort {
    readonly port: number;
    readonly browserPath: string;
}

export interface RHIOwnedChromiumLaunchOptions {
    readonly executablePath?: string;
    readonly args: readonly string[];
}

function ownedChromiumFailure(message: string): never {
    throw new Error(`RHI owned Chromium failed: ${message}`);
}

function record(value: unknown, context: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        ownedChromiumFailure(`${context} is not an object`);
    }
    return value as Record<string, unknown>;
}

function errorValue(reason: unknown): Error {
    return reason instanceof Error ? reason : new Error(String(reason));
}

function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, milliseconds);
    });
}

async function settleTeardownWithin(
    operation: () => Promise<unknown>,
    milliseconds: number
): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const settled = Promise.resolve()
        .then(operation)
        .then(
            () => undefined,
            () => undefined
        );
    try {
        await Promise.race([
            settled,
            new Promise<void>(resolve => {
                timeout = setTimeout(resolve, milliseconds);
            })
        ]);
    } finally {
        if (timeout !== undefined) clearTimeout(timeout);
    }
}

function validateExtraArguments(args: readonly string[]): void {
    for (const argument of args) {
        if (
            argument.startsWith('--remote-debugging-pipe') ||
            argument.startsWith('--remote-debugging-port') ||
            argument.startsWith('--remote-debugging-address') ||
            argument.startsWith('--user-data-dir')
        ) {
            throw new RangeError(`RHI owned Chromium reserves browser argument ${argument}`);
        }
    }
}

function playwrightDefaultArguments(
    userDataDir: string,
    extraArguments: readonly string[]
): Promise<readonly string[]> {
    const input = JSON.stringify({
        userDataDir,
        extraArguments
    });
    return new Promise<readonly string[]>((resolve, reject) => {
        execFile(
            process.execPath,
            ['--input-type=module', '-e', DEFAULT_ARGUMENT_HELPER_SOURCE, input],
            {
                cwd: fileURLToPath(new URL('../..', import.meta.url)),
                encoding: 'utf8',
                maxBuffer: DEFAULT_ARGUMENT_HELPER_MAX_BYTES
            },
            (error, stdout, stderr) => {
                if (error) {
                    reject(
                        new Error(
                            `Playwright default-argument helper failed: ${stderr || error.message}`
                        )
                    );
                    return;
                }
                let value: unknown;
                try {
                    value = JSON.parse(stdout) as unknown;
                } catch {
                    reject(new Error('Playwright default-argument helper returned invalid JSON'));
                    return;
                }
                if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
                    reject(new Error('Playwright default-argument helper returned invalid args'));
                    return;
                }
                resolve(Object.freeze([...value]));
            }
        );
    });
}

async function ownedChromiumArguments(
    userDataDir: string,
    extraArguments: readonly string[]
): Promise<readonly string[]> {
    validateExtraArguments(extraArguments);
    const args = await playwrightDefaultArguments(userDataDir, [
        ...extraArguments,
        `--remote-debugging-address=${LOOPBACK_HOST}`,
        '--remote-debugging-port=0'
    ]);
    const pipeArguments = args.filter(argument => argument === '--remote-debugging-pipe');
    const portArguments = args.filter(argument => argument === '--remote-debugging-port=0');
    const profileArguments = args.filter(argument => argument.startsWith('--user-data-dir='));
    if (
        pipeArguments.length !== 1 ||
        portArguments.length !== 1 ||
        profileArguments.length !== 1 ||
        profileArguments[0] !== `--user-data-dir=${userDataDir}`
    ) {
        ownedChromiumFailure('Playwright generated an incompatible debugging launch contract');
    }
    return Object.freeze([...args]);
}

function childPipe(child: ChildProcess, descriptor: number, direction: 'read'): Readable;
function childPipe(child: ChildProcess, descriptor: number, direction: 'write'): Writable;
function childPipe(
    child: ChildProcess,
    descriptor: number,
    direction: 'read' | 'write'
): Readable | Writable {
    const value = child.stdio[descriptor];
    if (direction === 'read' && value instanceof Readable) return value;
    if (direction === 'write' && value instanceof Writable) return value;
    ownedChromiumFailure(`Chromium debugging fd ${String(descriptor)} is unavailable`);
}

function readUnsignedResponseId(
    buffer: Buffer,
    offset: number
): {
    readonly id: number;
    readonly offset: number;
} {
    let cursor = offset;
    let id = 0;
    const start = cursor;
    while (cursor < buffer.length) {
        const byte = buffer[cursor] ?? 0;
        if (byte < 0x30 || byte > 0x39) break;
        id = id * 10 + byte - 0x30;
        if (!Number.isSafeInteger(id)) ownedChromiumFailure('CDP response id is not safe');
        cursor += 1;
    }
    if (cursor === start || id < 1) ownedChromiumFailure('CDP response id is invalid');
    return { id, offset: cursor };
}

function skipAsciiWhitespace(buffer: Buffer, offset: number): number {
    let cursor = offset;
    while (cursor < buffer.length) {
        const byte = buffer[cursor] ?? 0;
        if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) break;
        cursor += 1;
    }
    return cursor;
}

function startsWithAscii(buffer: Buffer, offset: number, value: string): boolean {
    const bytes = Buffer.from(value, 'ascii');
    return (
        offset + bytes.length <= buffer.length &&
        buffer.subarray(offset, offset + bytes.length).equals(bytes)
    );
}

/** Read only the frozen top-level response prefix; notifications begin with the method key. */
function structuralPipeResponseId(buffer: Buffer): number | null {
    let cursor = skipAsciiWhitespace(buffer, 0);
    if (buffer[cursor] !== 0x7b) ownedChromiumFailure('CDP pipe message is not an object');
    cursor = skipAsciiWhitespace(buffer, cursor + 1);
    if (startsWithAscii(buffer, cursor, '"method"')) return null;
    if (!startsWithAscii(buffer, cursor, '"id"')) {
        ownedChromiumFailure('CDP pipe message has an unexpected first key');
    }
    cursor = skipAsciiWhitespace(buffer, cursor + 4);
    if (buffer[cursor] !== 0x3a) ownedChromiumFailure('CDP response id colon is missing');
    const parsed = readUnsignedResponseId(buffer, skipAsciiWhitespace(buffer, cursor + 1));
    cursor = skipAsciiWhitespace(buffer, parsed.offset);
    if (buffer[cursor] !== 0x2c && buffer[cursor] !== 0x7d) {
        ownedChromiumFailure('CDP response id has an invalid terminator');
    }
    return parsed.id;
}

function requestedSamplingMode(parameters: object | undefined): RHIHeapProfilerSamplingMode {
    const candidate: unknown = parameters;
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
        ownedChromiumFailure('HeapProfiler.startSampling parameters are missing');
    }
    const values = candidate as Record<string, unknown>;
    const major = values['includeObjectsCollectedByMajorGC'];
    const minor = values['includeObjectsCollectedByMinorGC'];
    if (major === false && minor === false) return 'discard';
    if (major === true && minor === true) return 'marked';
    ownedChromiumFailure('HeapProfiler.startSampling flags do not select an audited mode');
}

/** @internal Raw Chromium transport; exported for deterministic contract testing. */
export class RHIDebuggingPipe {
    readonly #writePipe: Writable;
    readonly #readPipe: Readable;
    readonly #pending = new Map<number, PendingPipeCommand>();
    readonly #abandonedResponseIds = new Set<number>();
    readonly #sessionTargets = new Map<string, string>();
    readonly #terminalSessions = new Map<string, Error>();
    #pendingBuffers: Buffer[] = [];
    #pendingBytes = 0;
    #nextId = 0;
    #closed = false;
    #poison: Error | null = null;

    constructor(writePipe: Writable, readPipe: Readable) {
        if (
            RHI_STREAMING_HEAP_PROFILER_MAX_PAYLOAD_BYTES < 1 ||
            RHI_STREAMING_HEAP_PROFILER_MAX_PAYLOAD_BYTES > bufferConstants.MAX_LENGTH
        ) {
            ownedChromiumFailure('heap-profile payload bound exceeds this Node runtime');
        }
        this.#writePipe = writePipe;
        this.#readPipe = readPipe;
        readPipe.on('data', (chunk: Buffer | string) => {
            try {
                this.acceptChunk(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
            } catch (error) {
                this.poison(error);
            }
        });
        readPipe.on('error', error => {
            this.poison(error);
        });
        readPipe.on('close', () => {
            this.closeWithError(new Error('Chromium debugging read pipe closed'));
        });
        writePipe.on('error', error => {
            this.poison(error);
        });
        writePipe.on('close', () => {
            this.closeWithError(new Error('Chromium debugging write pipe closed'));
        });
    }

    private acceptChunk(chunk: Buffer): void {
        let start = 0;
        while (start <= chunk.length) {
            const end = chunk.indexOf(0, start);
            if (end < 0) {
                if (start < chunk.length) this.appendPartial(chunk.subarray(start));
                return;
            }
            const tail = chunk.subarray(start, end);
            let message: Buffer;
            if (this.#pendingBuffers.length === 0) {
                message = tail;
            } else {
                this.appendPartial(tail);
                message = Buffer.concat(this.#pendingBuffers, this.#pendingBytes);
            }
            this.#pendingBuffers = [];
            this.#pendingBytes = 0;
            if (message.length === 0)
                ownedChromiumFailure('Chromium debugging pipe emitted an empty message');
            if (message.length > RHI_STREAMING_HEAP_PROFILER_MAX_PAYLOAD_BYTES) {
                ownedChromiumFailure('Chromium debugging message exceeds the payload bound');
            }
            this.handleMessage(message);
            start = end + 1;
            if (start === chunk.length) return;
        }
    }

    private appendPartial(buffer: Buffer): void {
        const nextSize = this.#pendingBytes + buffer.length;
        if (
            !Number.isSafeInteger(nextSize) ||
            nextSize > RHI_STREAMING_HEAP_PROFILER_MAX_PAYLOAD_BYTES
        ) {
            ownedChromiumFailure('Chromium debugging response exceeds the payload bound');
        }
        this.#pendingBuffers.push(buffer);
        this.#pendingBytes = nextSize;
    }

    private handleMessage(buffer: Buffer): void {
        const id = structuralPipeResponseId(buffer);
        if (id === null) {
            this.handleNotification(buffer);
            return;
        }
        const pending = this.#pending.get(id);
        if (!pending) {
            if (this.#abandonedResponseIds.delete(id)) return;
            ownedChromiumFailure(`unexpected CDP response id ${String(id)}`);
        }
        this.#pending.delete(id);
        try {
            if (pending.method === 'HeapProfiler.stopSampling') {
                const mode = pending.stopSamplingMode;
                const sessionId = pending.sessionId;
                if (!mode || !sessionId) {
                    ownedChromiumFailure(
                        'stopSampling pipe command lacks its audited session state'
                    );
                }
                pending.resolve(
                    compactRHIHeapProfilerStopResponse(buffer, {
                        expectedId: id,
                        mode,
                        expectedSessionId: sessionId
                    })
                );
                return;
            }
            if (buffer.length > RHI_OWNED_CHROMIUM_SMALL_CDP_MESSAGE_MAX_BYTES) {
                ownedChromiumFailure(`CDP ${pending.method} response exceeds its small bound`);
            }
            const response = record(
                JSON.parse(buffer.toString('utf8')) as unknown,
                `CDP ${pending.method} response`
            );
            if (response['id'] !== id) ownedChromiumFailure('parsed CDP response id differs');
            if (
                (pending.sessionId === undefined && response['sessionId'] !== undefined) ||
                (pending.sessionId !== undefined && response['sessionId'] !== pending.sessionId)
            ) {
                ownedChromiumFailure(`CDP ${pending.method} response session differs`);
            }
            if (response['error'] !== undefined) {
                const cdpError = record(
                    response['error'],
                    `CDP ${pending.method} error`
                ) as CDPErrorResponse;
                pending.reject(
                    new Error(
                        `CDP ${pending.method} failed (${String(cdpError.code)}): ${String(cdpError.message)}`
                    )
                );
                return;
            }
            if (!Object.hasOwn(response, 'result')) {
                ownedChromiumFailure(`CDP ${pending.method} result is missing`);
            }
            pending.resolve(response['result']);
        } catch (error) {
            pending.reject(error);
            throw error;
        }
    }

    private handleNotification(buffer: Buffer): void {
        if (buffer.length > RHI_OWNED_CHROMIUM_SMALL_CDP_MESSAGE_MAX_BYTES) {
            ownedChromiumFailure('CDP notification exceeds its small bound');
        }
        const notification = record(
            JSON.parse(buffer.toString('utf8')) as unknown,
            'CDP notification'
        );
        const method = notification['method'];
        if (typeof method !== 'string' || method.length === 0) {
            ownedChromiumFailure('CDP notification method is invalid');
        }
        if (notification['id'] !== undefined) {
            ownedChromiumFailure('CDP notification unexpectedly contains an id');
        }

        const envelopeSessionId = notification['sessionId'];
        if (
            envelopeSessionId !== undefined &&
            (typeof envelopeSessionId !== 'string' || envelopeSessionId.length === 0)
        ) {
            ownedChromiumFailure(`CDP ${method} notification session id is invalid`);
        }

        if (method === 'Inspector.detached') {
            const params = record(notification['params'], 'CDP Inspector.detached parameters');
            const reason = params['reason'];
            if (typeof reason !== 'string' || reason.length === 0) {
                ownedChromiumFailure('CDP Inspector.detached reason is invalid');
            }
            if (typeof envelopeSessionId === 'string') {
                this.failSession(envelopeSessionId, `Inspector.detached (${reason})`);
                return;
            }
            ownedChromiumFailure(`browser Inspector.detached (${reason})`);
        }

        if (method === 'Inspector.targetCrashed') {
            if (typeof envelopeSessionId === 'string') {
                this.failSession(envelopeSessionId, 'Inspector.targetCrashed');
                return;
            }
            ownedChromiumFailure('browser Inspector.targetCrashed');
        }

        if (method === 'Target.detachedFromTarget') {
            const params = record(
                notification['params'],
                'CDP Target.detachedFromTarget parameters'
            );
            const sessionId = params['sessionId'];
            if (typeof sessionId !== 'string' || sessionId.length === 0) {
                ownedChromiumFailure('CDP Target.detachedFromTarget session id is invalid');
            }
            this.failSession(sessionId, 'Target.detachedFromTarget');
            return;
        }

        if (method === 'Target.targetCrashed') {
            const params = record(notification['params'], 'CDP Target.targetCrashed parameters');
            const targetId = params['targetId'];
            const status = params['status'];
            const errorCode = params['errorCode'];
            if (typeof targetId !== 'string' || targetId.length === 0) {
                ownedChromiumFailure('CDP Target.targetCrashed target id is invalid');
            }
            if (typeof status !== 'string' || !Number.isSafeInteger(errorCode)) {
                ownedChromiumFailure('CDP Target.targetCrashed status is invalid');
            }
            this.failTargetSessions(
                targetId,
                `Target.targetCrashed (${status}/${String(errorCode)})`
            );
            return;
        }

        if (method === 'Target.targetDestroyed') {
            const params = record(notification['params'], 'CDP Target.targetDestroyed parameters');
            const targetId = params['targetId'];
            if (typeof targetId !== 'string' || targetId.length === 0) {
                ownedChromiumFailure('CDP Target.targetDestroyed target id is invalid');
            }
            this.failTargetSessions(targetId, 'Target.targetDestroyed');
        }
    }

    private failTargetSessions(targetId: string, detail: string): void {
        for (const [sessionId, sessionTargetId] of this.#sessionTargets) {
            if (sessionTargetId === targetId) this.failSession(sessionId, detail);
        }
    }

    private failSession(sessionId: string, detail: string): void {
        const existing = this.#terminalSessions.get(sessionId);
        if (existing) return;
        const reason = new Error(
            `RHI owned Chromium target session ${sessionId} terminated: ${detail}`
        );
        this.#terminalSessions.set(sessionId, reason);
        this.#sessionTargets.delete(sessionId);
        for (const [id, pending] of this.#pending) {
            if (pending.sessionId !== sessionId) continue;
            this.#pending.delete(id);
            this.#abandonedResponseIds.add(id);
            pending.reject(reason);
        }
    }

    abortSession(sessionId: string, detail: string): void {
        this.failSession(sessionId, detail);
    }

    send(method: string, parameters?: object, options: PipeCommandOptions = {}): Promise<unknown> {
        if (this.#poison) return Promise.reject(this.#poison);
        if (this.#closed || !this.#writePipe.writable) {
            return Promise.reject(new Error('Chromium debugging pipe is closed'));
        }
        if (options.sessionId !== undefined) {
            const terminal = this.#terminalSessions.get(options.sessionId);
            if (terminal) return Promise.reject(terminal);
        }
        const id = ++this.#nextId;
        const command = {
            id,
            method,
            ...(parameters === undefined ? {} : { params: parameters }),
            ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId })
        };
        return new Promise<unknown>((resolve, reject) => {
            this.#pending.set(id, {
                method,
                ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
                ...(options.stopSamplingMode === undefined
                    ? {}
                    : { stopSamplingMode: options.stopSamplingMode }),
                resolve,
                reject
            });
            const payload = Buffer.concat([
                Buffer.from(JSON.stringify(command), 'utf8'),
                PIPE_DELIMITER
            ]);
            try {
                this.#writePipe.write(payload, error => {
                    if (!error) return;
                    const pending = this.#pending.get(id);
                    this.#pending.delete(id);
                    pending?.reject(error);
                    this.poison(error);
                });
            } catch (error) {
                this.#pending.delete(id);
                reject(errorValue(error));
                this.poison(error);
            }
        });
    }

    async attachHeapProfiler(targetId: string): Promise<RHIOwnedHeapProfilerSession> {
        if (typeof targetId !== 'string' || targetId.length === 0) {
            throw new RangeError('RHI Chromium target id is invalid');
        }
        const response = record(
            await this.send('Target.attachToTarget', { targetId, flatten: true }),
            'Target.attachToTarget'
        );
        const sessionId = response['sessionId'];
        if (typeof sessionId !== 'string' || sessionId.length === 0) {
            ownedChromiumFailure('Target.attachToTarget session id is missing');
        }
        this.#sessionTargets.set(sessionId, targetId);
        try {
            await this.send('Inspector.enable', undefined, { sessionId });
        } catch (error) {
            this.#sessionTargets.delete(sessionId);
            throw error;
        }
        return new RHIOwnedHeapProfilerSession(this, sessionId);
    }

    private rejectAll(reason: unknown): void {
        for (const pending of this.#pending.values()) pending.reject(reason);
        this.#pending.clear();
    }

    private clearPartialMessage(): void {
        this.#pendingBuffers = [];
        this.#pendingBytes = 0;
    }

    private terminate(reason: Error, streamError?: Error): void {
        this.#closed = true;
        this.clearPartialMessage();
        this.rejectAll(reason);
        this.#abandonedResponseIds.clear();
        this.#sessionTargets.clear();
        this.#terminalSessions.clear();
        if (!this.#readPipe.destroyed) this.#readPipe.destroy(streamError);
        if (!this.#writePipe.destroyed) this.#writePipe.destroy(streamError);
    }

    private closeWithError(reason: Error): void {
        this.terminate(reason);
    }

    private poison(reason: unknown): void {
        this.#poison ??= errorValue(reason);
        this.terminate(this.#poison, this.#poison);
    }

    close(): void {
        this.terminate(new Error('Chromium debugging pipe closed'));
    }
}

export class RHIOwnedHeapProfilerSession {
    readonly #pipe: RHIDebuggingPipe;
    readonly #sessionId: string;
    #samplingMode: RHIHeapProfilerSamplingMode | null = null;
    #closed = false;

    constructor(pipe: RHIDebuggingPipe, sessionId: string) {
        this.#pipe = pipe;
        this.#sessionId = sessionId;
    }

    readonly send = (async (method: string, parameters?: object): Promise<unknown> => {
        if (this.#closed) ownedChromiumFailure('heap-profiler target session is closed');
        if (!method.startsWith('HeapProfiler.')) {
            ownedChromiumFailure(`heap-profiler target session rejects method ${method}`);
        }
        if (method === 'HeapProfiler.startSampling') {
            if (this.#samplingMode !== null) {
                ownedChromiumFailure('HeapProfiler sampling is already active');
            }
            const mode = requestedSamplingMode(parameters);
            const result = await this.#pipe.send(method, parameters, {
                sessionId: this.#sessionId
            });
            this.#samplingMode = mode;
            return result;
        }
        if (method === 'HeapProfiler.stopSampling') {
            const mode = this.#samplingMode;
            if (mode === null) ownedChromiumFailure('HeapProfiler sampling is not active');
            try {
                return await this.#pipe.send(method, parameters, {
                    sessionId: this.#sessionId,
                    stopSamplingMode: mode
                });
            } finally {
                this.#samplingMode = null;
            }
        }
        return this.#pipe.send(method, parameters, { sessionId: this.#sessionId });
    }) as CDPSession['send'];

    abort(reason: Error): void {
        if (this.#closed) return;
        this.#samplingMode = null;
        this.#pipe.abortSession(this.#sessionId, reason.message);
    }

    async close(): Promise<void> {
        if (this.#closed) return;
        this.#closed = true;
        this.#samplingMode = null;
        await settleTeardownWithin(
            () => this.#pipe.send('Target.detachFromTarget', { sessionId: this.#sessionId }),
            BROWSER_CLOSE_TIMEOUT_MS
        );
    }
}

async function readDevToolsActivePort(
    userDataDir: string,
    child: ChildProcess,
    stderr: () => string,
    childError: () => Error | null
): Promise<DevToolsActivePort> {
    const path = join(userDataDir, DEVTOOLS_ACTIVE_PORT_FILE);
    const deadline = Date.now() + BROWSER_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const launchError = childError();
        if (launchError) {
            ownedChromiumFailure(`Chromium process failed to spawn: ${launchError.message}`);
        }
        if (child.exitCode !== null || child.signalCode !== null) {
            ownedChromiumFailure(
                `Chromium exited before DevTools became ready (${String(child.exitCode)}/${String(child.signalCode)}): ${stderr()}`
            );
        }
        try {
            const content = await readFile(path, 'utf8');
            const lines = content.trim().split(/\r?\n/u);
            const port = Number(lines[0]);
            const browserPath = lines[1];
            if (
                lines.length === 2 &&
                Number.isSafeInteger(port) &&
                port > 0 &&
                port <= 65_535 &&
                typeof browserPath === 'string' &&
                /^\/devtools\/browser\/[A-Za-z0-9-]+$/u.test(browserPath)
            ) {
                return { port, browserPath };
            }
        } catch {
            // The file is atomically published after Chromium finishes opening its profile.
        }
        await delay(25);
    }
    const launchError = childError();
    if (launchError) {
        ownedChromiumFailure(`Chromium process failed to spawn: ${launchError.message}`);
    }
    ownedChromiumFailure(`DevToolsActivePort was not published: ${stderr()}`);
}

function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
    const pid = child.pid;
    if (!pid) return;
    try {
        if (process.platform === 'win32') child.kill(signal);
        else process.kill(-pid, signal);
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ESRCH') throw error;
    }
}

async function waitForExit(child: ChildProcess, timeout: number): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return true;
    return Promise.race([
        new Promise<true>(resolve => {
            child.once('exit', () => {
                resolve(true);
            });
        }),
        delay(timeout).then(() => false)
    ]);
}

async function terminateOwnedProcess(child: ChildProcess): Promise<void> {
    if (!child.pid) return;
    if (await waitForExit(child, 0)) return;
    signalProcessGroup(child, 'SIGTERM');
    if (await waitForExit(child, PROCESS_SIGNAL_TIMEOUT_MS)) return;
    signalProcessGroup(child, 'SIGKILL');
    if (!(await waitForExit(child, PROCESS_SIGNAL_TIMEOUT_MS))) {
        ownedChromiumFailure('Chromium process group did not terminate');
    }
}

export class RHIOwnedChromium {
    readonly browser: Browser;
    readonly #child: ChildProcess;
    readonly #pipe: RHIDebuggingPipe;
    readonly #userDataDir: string;
    #session: RHIOwnedHeapProfilerSession | null = null;
    #closed = false;

    constructor(
        browser: Browser,
        child: ChildProcess,
        pipe: RHIDebuggingPipe,
        userDataDir: string
    ) {
        this.browser = browser;
        this.#child = child;
        this.#pipe = pipe;
        this.#userDataDir = userDataDir;
    }

    async createHeapProfilerSession(targetId: string): Promise<RHIOwnedHeapProfilerSession> {
        if (this.#closed) ownedChromiumFailure('browser owner is closed');
        if (this.#session) ownedChromiumFailure('a heap-profiler target session is already active');
        const session = await this.#pipe.attachHeapProfiler(targetId);
        const originalClose = session.close.bind(session);
        session.close = async (): Promise<void> => {
            try {
                await originalClose();
            } finally {
                if (this.#session === session) this.#session = null;
            }
        };
        this.#session = session;
        return session;
    }

    async close(): Promise<void> {
        if (this.#closed) return;
        this.#closed = true;
        try {
            const session = this.#session;
            if (session) {
                await settleTeardownWithin(() => session.close(), BROWSER_CLOSE_TIMEOUT_MS);
            }
            this.#session = null;
            await settleTeardownWithin(() => this.browser.close(), BROWSER_CLOSE_TIMEOUT_MS);
            if (this.#child.exitCode === null && this.#child.signalCode === null) {
                await settleTeardownWithin(
                    () => this.#pipe.send('Browser.close'),
                    BROWSER_CLOSE_TIMEOUT_MS
                );
            }
            if (!(await waitForExit(this.#child, BROWSER_CLOSE_TIMEOUT_MS))) {
                await terminateOwnedProcess(this.#child);
            }
        } finally {
            this.#pipe.close();
            await terminateOwnedProcess(this.#child).catch(() => undefined);
            await rm(this.#userDataDir, { recursive: true, force: true });
        }
    }
}

/** Launch Chromium with an owned raw DevTools pipe and a separate Playwright CDP connection. */
export async function launchRHIOwnedChromium(
    options: RHIOwnedChromiumLaunchOptions
): Promise<RHIOwnedChromium> {
    const userDataDir = await mkdtemp(join(tmpdir(), 'hilo3d-rhi-chromium-'));
    let child: ChildProcess | null = null;
    let pipe: RHIDebuggingPipe | null = null;
    let browser: Browser | null = null;
    let stderrTail = '';
    try {
        const args = await ownedChromiumArguments(userDataDir, options.args);
        child = spawn(options.executablePath ?? chromium.executablePath(), args, {
            detached: process.platform !== 'win32',
            stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe']
        });
        let childError: Error | null = null;
        child.on('error', error => {
            childError ??= errorValue(error);
        });
        const stderr = childPipe(child, 2, 'read');
        stderr.setEncoding('utf8');
        stderr.on('data', (chunk: Buffer | string) => {
            stderrTail = `${stderrTail}${String(chunk)}`.slice(-16_384);
        });
        pipe = new RHIDebuggingPipe(childPipe(child, 3, 'write'), childPipe(child, 4, 'read'));
        const activePort = await readDevToolsActivePort(
            userDataDir,
            child,
            () => stderrTail,
            () => childError
        );
        const endpoint = `ws://${LOOPBACK_HOST}:${String(activePort.port)}${activePort.browserPath}`;
        browser = await chromium.connectOverCDP(endpoint, { timeout: BROWSER_START_TIMEOUT_MS });
        return new RHIOwnedChromium(browser, child, pipe, userDataDir);
    } catch (error) {
        const connectedBrowser = browser;
        if (connectedBrowser) {
            await settleTeardownWithin(() => connectedBrowser.close(), BROWSER_CLOSE_TIMEOUT_MS);
        }
        pipe?.close();
        if (child) await terminateOwnedProcess(child).catch(() => undefined);
        await rm(userDataDir, { recursive: true, force: true });
        throw error;
    }
}
