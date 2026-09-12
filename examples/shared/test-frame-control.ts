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
    dispose(): void;
}

/** Test-only backpressure: one submission at a time, with an idle window for browser input. */
export function createTestFrameControl(
    ticker: TestTicker,
    waitForIdle: () => Promise<void>,
    paceFrames = true
): TestFrameControl {
    let capturing = false;
    let pending = false;
    let disposed = false;
    const observers = new Map<{ tick(): void }, () => void>();
    const frame = {
        tick(): void {
            if (pending || disposed) return;
            pending = true;
            ticker.pause();
            // Drain after the whole ticker callback list, including user callbacks, finishes.
            void Promise.resolve()
                .then(waitForIdle)
                .then(
                    () =>
                        new Promise<void>(resolve => {
                            setTimeout(resolve, 50);
                        })
                )
                .then(() => {
                    pending = false;
                    if (!capturing && !disposed) ticker.resume();
                })
                .catch((error: unknown) => {
                    if (disposed) return;
                    ticker.stop();
                    queueMicrotask(() => {
                        throw error;
                    });
                });
        }
    };
    if (paceFrames) ticker.addTick(frame);
    return {
        waitForFrames(count: number): Promise<void> {
            if (!Number.isInteger(count) || count < 1 || count > 60 || disposed) {
                return Promise.reject(new Error('Test frame wait requires 1 to 60 live frames'));
            }
            return new Promise<void>((resolve, reject) => {
                let remaining = count;
                const observer = {
                    tick(): void {
                        remaining--;
                        if (remaining === 0) {
                            ticker.removeTick(observer);
                            observers.delete(observer);
                            resolve();
                        }
                    }
                };
                observers.set(observer, () => {
                    reject(new Error('Test frame control disposed'));
                });
                ticker.addTick(observer);
            });
        },
        async pause(): Promise<void> {
            capturing = true;
            ticker.pause();
            await waitForIdle();
        },
        resume(): void {
            capturing = false;
            if (!pending && !disposed) ticker.resume();
        },
        dispose(): void {
            disposed = true;
            ticker.removeTick(frame);
            for (const [observer, reject] of observers) {
                ticker.removeTick(observer);
                reject();
            }
            observers.clear();
        }
    };
}
