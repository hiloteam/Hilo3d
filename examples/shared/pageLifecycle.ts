export interface ExamplePageLifecycle {
    readonly active: boolean;
    readonly disposed: boolean;
    /** Run before the runtime is destroyed, or immediately if it has already been disposed. */
    readonly onDispose: (cleanup: () => void) => void;
    readonly dispose: () => void;
}

export interface ExamplePageLifecycleOptions {
    pause(): void;
    resume(): void;
    dispose(): void;
}

/** Own page suspension separately from final teardown, including asynchronous initialization. */
export function installPageLifecycle(
    options: ExamplePageLifecycleOptions,
    events: EventTarget = window
): ExamplePageLifecycle {
    let active = true;
    let disposed = false;
    const cleanups: (() => void)[] = [];

    function dispose(): void {
        if (disposed) return;
        disposed = true;
        active = false;
        events.removeEventListener('pagehide', hide);
        events.removeEventListener('pageshow', show);
        const failures: unknown[] = [];
        try {
            options.pause();
        } catch (error) {
            failures.push(error);
        }
        for (const cleanup of cleanups) {
            try {
                cleanup();
            } catch (error) {
                failures.push(error);
            }
        }
        cleanups.length = 0;
        try {
            options.dispose();
        } catch (error) {
            failures.push(error);
        }
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) throw new AggregateError(failures, 'Example teardown failed');
    }

    function hide(event: Event): void {
        if (disposed) return;
        active = false;
        if ((event as PageTransitionEvent).persisted) options.pause();
        else dispose();
    }

    function show(event: Event): void {
        if (disposed || active || !(event as PageTransitionEvent).persisted) return;
        active = true;
        options.resume();
    }

    events.addEventListener('pagehide', hide);
    events.addEventListener('pageshow', show);
    return {
        get active(): boolean {
            return active;
        },
        get disposed(): boolean {
            return disposed;
        },
        onDispose(cleanup): void {
            if (disposed) cleanup();
            else cleanups.push(cleanup);
        },
        dispose
    };
}
