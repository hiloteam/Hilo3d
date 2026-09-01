import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
    RHIDebuggingPipe,
    RHI_OWNED_CHROMIUM_SMALL_CDP_MESSAGE_MAX_BYTES,
    type RHIOwnedHeapProfilerSession
} from '../../scripts/performance/rhi-owned-chromium';

interface RawCDPCommand {
    readonly id: number;
    readonly method: string;
    readonly params?: object;
    readonly sessionId?: string;
}

function parseCommand(buffer: Buffer): RawCDPCommand {
    const value = JSON.parse(buffer.toString('utf8')) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError('test CDP command is not an object');
    }
    const command = value as Record<string, unknown>;
    const id = command['id'];
    const method = command['method'];
    const params = command['params'];
    const sessionId = command['sessionId'];
    if (!Number.isSafeInteger(id) || typeof id !== 'number' || id < 1) {
        throw new TypeError('test CDP command id is invalid');
    }
    if (typeof method !== 'string' || method.length === 0) {
        throw new TypeError('test CDP command method is invalid');
    }
    if (
        params !== undefined &&
        (typeof params !== 'object' || params === null || Array.isArray(params))
    ) {
        throw new TypeError('test CDP command params are invalid');
    }
    if (sessionId !== undefined && typeof sessionId !== 'string') {
        throw new TypeError('test CDP command session is invalid');
    }
    return {
        id,
        method,
        ...(params === undefined ? {} : { params }),
        ...(sessionId === undefined ? {} : { sessionId })
    };
}

class RawPipeHarness {
    readonly #clientToChromium = new PassThrough();
    readonly #chromiumToClient = new PassThrough();
    readonly #queuedCommands: RawCDPCommand[] = [];
    readonly #commandWaiters: ((command: RawCDPCommand) => void)[] = [];
    #commandBytes = Buffer.alloc(0);
    commandCount = 0;
    readonly pipe = new RHIDebuggingPipe(this.#clientToChromium, this.#chromiumToClient);

    constructor() {
        this.#clientToChromium.on('data', (chunk: Buffer | string) => {
            this.acceptClientBytes(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        });
    }

    private acceptClientBytes(chunk: Buffer): void {
        this.#commandBytes = Buffer.concat([this.#commandBytes, chunk]);
        let delimiter = this.#commandBytes.indexOf(0);
        while (delimiter >= 0) {
            const command = parseCommand(this.#commandBytes.subarray(0, delimiter));
            this.#commandBytes = this.#commandBytes.subarray(delimiter + 1);
            this.commandCount += 1;
            const waiter = this.#commandWaiters.shift();
            if (waiter) waiter(command);
            else this.#queuedCommands.push(command);
            delimiter = this.#commandBytes.indexOf(0);
        }
    }

    nextCommand(): Promise<RawCDPCommand> {
        const command = this.#queuedCommands.shift();
        if (command) return Promise.resolve(command);
        return new Promise(resolve => {
            this.#commandWaiters.push(resolve);
        });
    }

    respond(command: RawCDPCommand, result: object = {}): void {
        this.notify({
            id: command.id,
            result,
            ...(command.sessionId === undefined ? {} : { sessionId: command.sessionId })
        });
    }

    notify(notification: object): void {
        this.writeBrowserBytes(
            Buffer.concat([Buffer.from(JSON.stringify(notification), 'utf8'), Buffer.from([0])])
        );
    }

    writeBrowserBytes(bytes: Buffer): void {
        this.#chromiumToClient.write(bytes);
    }

    close(): void {
        this.pipe.close();
    }
}

const harnesses: RawPipeHarness[] = [];

function createHarness(): RawPipeHarness {
    const harness = new RawPipeHarness();
    harnesses.push(harness);
    return harness;
}

afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
});

async function attachSession(
    harness: RawPipeHarness,
    targetId: string,
    sessionId: string
): Promise<RHIOwnedHeapProfilerSession> {
    const attaching = harness.pipe.attachHeapProfiler(targetId);
    const attach = await harness.nextCommand();
    expect(attach).toEqual({
        id: attach.id,
        method: 'Target.attachToTarget',
        params: { targetId, flatten: true }
    });
    harness.respond(attach, { sessionId });

    const inspectorEnable = await harness.nextCommand();
    expect(inspectorEnable).toEqual({
        id: inspectorEnable.id,
        method: 'Inspector.enable',
        sessionId
    });
    harness.respond(inspectorEnable);
    return attaching;
}

async function startMarkedSampling(
    harness: RawPipeHarness,
    session: RHIOwnedHeapProfilerSession,
    sessionId: string
): Promise<void> {
    const starting = session.send('HeapProfiler.startSampling', {
        samplingInterval: 32_768,
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true
    });
    const command = await harness.nextCommand();
    expect(command.method).toBe('HeapProfiler.startSampling');
    expect(command.sessionId).toBe(sessionId);
    harness.respond(command);
    await starting;
}

describe('RHI owned Chromium raw CDP transport', () => {
    it('rejects only the crashed target session and leaves other pending work alive', async () => {
        const harness = createHarness();
        const first = await attachSession(harness, 'target-1', 'session-1');
        const second = await attachSession(harness, 'target-2', 'session-2');
        await startMarkedSampling(harness, first, 'session-1');

        const stopping = first.send('HeapProfiler.stopSampling');
        const stopCommand = await harness.nextCommand();
        expect(stopCommand.sessionId).toBe('session-1');

        const otherSessionPending = second.send('HeapProfiler.enable');
        const otherSessionCommand = await harness.nextCommand();
        const browserPending = harness.pipe.send('Browser.getVersion');
        const browserCommand = await harness.nextCommand();
        const stopped = expect(stopping).rejects.toThrow(/Inspector\.targetCrashed/u);

        harness.notify({
            method: 'Inspector.targetCrashed',
            params: {},
            sessionId: 'session-1'
        });
        await stopped;

        // A response already in flight after the terminal event is an abandoned session reply,
        // not evidence that the still-live browser transport is corrupt.
        harness.respond(stopCommand);
        harness.respond(otherSessionCommand, { enabled: true });
        harness.respond(browserCommand, { product: 'Chromium' });
        await expect(otherSessionPending).resolves.toEqual({ enabled: true });
        await expect(browserPending).resolves.toEqual({ product: 'Chromium' });

        const commandCount = harness.commandCount;
        await expect(first.send('HeapProfiler.enable')).rejects.toThrow(
            /Inspector\.targetCrashed/u
        );
        expect(harness.commandCount).toBe(commandCount);
    });

    it('rejects a pending stopSampling when its flattened target detaches', async () => {
        const harness = createHarness();
        const session = await attachSession(harness, 'target-1', 'session-1');
        await startMarkedSampling(harness, session, 'session-1');

        const stopping = session.send('HeapProfiler.stopSampling');
        await harness.nextCommand();
        const browserPending = harness.pipe.send('Browser.getVersion');
        const browserCommand = await harness.nextCommand();
        const stopped = expect(stopping).rejects.toThrow(/Target\.detachedFromTarget/u);

        harness.notify({
            method: 'Target.detachedFromTarget',
            params: { sessionId: 'session-1', targetId: 'target-1' }
        });
        await stopped;

        harness.respond(browserCommand, { product: 'Chromium' });
        await expect(browserPending).resolves.toEqual({ product: 'Chromium' });
        await expect(session.send('HeapProfiler.enable')).rejects.toThrow(
            /Target\.detachedFromTarget/u
        );
    });

    it('abandons a pending profiler response when the local phase timeout aborts its session', async () => {
        const harness = createHarness();
        const session = await attachSession(harness, 'target-1', 'session-1');
        await startMarkedSampling(harness, session, 'session-1');

        const stopping = session.send('HeapProfiler.stopSampling');
        const stopCommand = await harness.nextCommand();
        session.abort(new Error('allocation phase timeout'));
        await expect(stopping).rejects.toThrow(/allocation phase timeout/u);

        harness.respond(stopCommand);
        await expect(session.send('HeapProfiler.enable')).rejects.toThrow(
            /allocation phase timeout/u
        );
        const browserPending = harness.pipe.send('Browser.getVersion');
        const browserCommand = await harness.nextCommand();
        harness.respond(browserCommand, { product: 'Chromium' });
        await expect(browserPending).resolves.toEqual({ product: 'Chromium' });
    });

    it('does not poison the browser pipe when a normal detach event precedes its response', async () => {
        const harness = createHarness();
        const session = await attachSession(harness, 'target-1', 'session-1');

        const closing = session.close();
        const detach = await harness.nextCommand();
        expect(detach).toEqual({
            id: detach.id,
            method: 'Target.detachFromTarget',
            params: { sessionId: 'session-1' }
        });
        harness.notify({
            method: 'Target.detachedFromTarget',
            params: { sessionId: 'session-1', targetId: 'target-1' }
        });
        harness.respond(detach);
        await closing;

        const browserPending = harness.pipe.send('Browser.getVersion');
        const browserCommand = await harness.nextCommand();
        harness.respond(browserCommand, { product: 'Chromium' });
        await expect(browserPending).resolves.toEqual({ product: 'Chromium' });
    });

    it('poisons the whole pipe for an oversized notification before parsing JSON', async () => {
        const harness = createHarness();
        const browserPending = harness.pipe.send('Browser.getVersion');
        await harness.nextCommand();
        const rejected = expect(browserPending).rejects.toThrow(
            /CDP notification exceeds its small bound/u
        );

        const oversized = Buffer.alloc(RHI_OWNED_CHROMIUM_SMALL_CDP_MESSAGE_MAX_BYTES + 1, 0x78);
        Buffer.from('{"method"', 'ascii').copy(oversized);
        harness.writeBrowserBytes(oversized);
        harness.writeBrowserBytes(Buffer.from([0]));
        await rejected;

        const commandCount = harness.commandCount;
        await expect(harness.pipe.send('Browser.getVersion')).rejects.toThrow(
            /CDP notification exceeds its small bound/u
        );
        expect(harness.commandCount).toBe(commandCount);
    });
});
