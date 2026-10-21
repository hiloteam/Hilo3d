interface TestTicker {
    pause(): void;
    resume(): void;
    stop(): void;
    addTick(tick: { tick(): void }): void;
    removeTick(tick: { tick(): void }): void;
}

export interface TestFrameControl {
    waitForFrames(count: number): Promise<void>;
    pause(): Promise<void>;
    resume(): void;
    /** Gate automatic resumption while the owning page is suspended in BFCache. */
    setSuspended(suspended: boolean): void;
    dispose(): void;
}

/** Test-only backpressure: one submission at a time, with an idle window for browser input. */
export function createTestFrameControl(
    ticker: TestTicker,
    waitForIdle: () => Promise<void>,
    paceFrames = true
): TestFrameControl {
    let capturing = false;
    let suspended = false;
    let pending = false;
    let disposed = false;
    let failure: Error | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let finishIdleWindow: (() => void) | undefined;
    const observers = new Map<{ tick(): void }, (reason: unknown) => void>();
    const captures = new Set<(reason: unknown) => void>();

    function resumeWhenReady(): void {
        if (!pending && !capturing && !suspended && !disposed && !failure) ticker.resume();
    }

    function cancelIdleWindow(): void {
        if (idleTimer !== undefined) clearTimeout(idleTimer);
        idleTimer = undefined;
        const finish = finishIdleWindow;
        finishIdleWindow = undefined;
        finish?.();
    }

    function rejectWaits(reason: unknown): void {
        ticker.removeTick(frame);
        for (const [observer, reject] of observers) {
            ticker.removeTick(observer);
            reject(reason);
        }
        observers.clear();
        for (const reject of captures) reject(reason);
        captures.clear();
        cancelIdleWindow();
    }

    function fail(error: unknown): void {
        if (disposed || failure) return;
        failure =
            error instanceof Error
                ? error
                : new Error('Test frame submission failed', { cause: error });
        ticker.stop();
        rejectWaits(failure);
        queueMicrotask(() => {
            throw error;
        });
    }

    const frame = {
        tick(): void {
            if (pending || disposed || failure) return;
            pending = true;
            ticker.pause();
            // Drain after the whole ticker callback list, including user callbacks, finishes.
            void Promise.resolve()
                .then(() => {
                    if (!disposed && !failure) return waitForIdle();
                    return undefined;
                })
                .then(() => {
                    if (disposed || failure) return;
                    return new Promise<void>(resolve => {
                        finishIdleWindow = resolve;
                        idleTimer = setTimeout(() => {
                            idleTimer = undefined;
                            finishIdleWindow = undefined;
                            resolve();
                        }, 50);
                    });
                })
                .then(() => {
                    pending = false;
                    resumeWhenReady();
                })
                .catch(fail);
        }
    };
    if (paceFrames) ticker.addTick(frame);
    return {
        waitForFrames(count: number): Promise<void> {
            if (failure) return Promise.reject(failure);
            if (disposed) return Promise.reject(new Error('Test frame control disposed'));
            if (!Number.isInteger(count) || count < 1 || count > 60) {
                return Promise.reject(new Error('Test frame wait requires 1 to 60 live frames'));
            }
            return new Promise<void>((resolve, reject) => {
                let remaining = count;
                const observer = {
                    tick(): void {
                        if (disposed || failure) return;
                        remaining--;
                        if (remaining === 0) {
                            ticker.removeTick(observer);
                            observers.delete(observer);
                            resolve();
                        }
                    }
                };
                observers.set(observer, reject);
                ticker.addTick(observer);
            });
        },
        pause(): Promise<void> {
            if (failure) return Promise.reject(failure);
            if (disposed) return Promise.reject(new Error('Test frame control disposed'));
            capturing = true;
            ticker.pause();
            return new Promise<void>((resolve, reject) => {
                captures.add(reject);
                void Promise.resolve()
                    .then(() => {
                        if (!disposed && !failure) return waitForIdle();
                        return undefined;
                    })
                    .then(() => {
                        captures.delete(reject);
                        if (!disposed && !failure) resolve();
                    })
                    .catch(fail);
            });
        },
        resume(): void {
            capturing = false;
            resumeWhenReady();
        },
        setSuspended(value: boolean): void {
            if (suspended === value) return;
            suspended = value;
            if (!suspended) resumeWhenReady();
        },
        dispose(): void {
            if (disposed) return;
            disposed = true;
            rejectWaits(new Error('Test frame control disposed'));
        }
    };
}
