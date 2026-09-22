import type { Live2DRuntime } from './runtime/Live2DRuntime.js';

/** Optional runtime configuration. Omit it to use this release's prebuilt runtime. */
export interface Live2DConfiguration {
    /** Advanced dependency injection for another compatible provider or an embedded application. */
    readonly runtime?: Live2DRuntime | (() => Live2DRuntime | Promise<Live2DRuntime>);
    /** CSP nonce forwarded to the provider's external SDK loader. */
    readonly nonce?: string;
    /** Default model-load and shared provider-initialization deadline. Defaults to 30,000 ms. */
    readonly timeoutMilliseconds?: number;
}

interface RuntimeConfigurationState {
    readonly configuration: Readonly<Live2DConfiguration>;
    pending: Promise<Live2DRuntime> | null;
}

let current: RuntimeConfigurationState | null = null;

/** Override defaults during setup; an empty configuration restores the prebuilt runtime. */
export function configureLive2D(configuration: Readonly<Live2DConfiguration> = {}): void {
    const timeout = configuration.timeoutMilliseconds ?? 30_000;
    if (!Number.isFinite(timeout) || timeout <= 0) {
        throw new RangeError('Live2D timeoutMilliseconds must be positive and finite.');
    }
    current = {
        configuration: Object.freeze({
            ...configuration,
            timeoutMilliseconds: timeout
        }),
        pending: null
    };
}

function requireRuntime(value: unknown): Live2DRuntime {
    if (
        typeof value !== 'object' ||
        value === null ||
        Reflect.get(value, 'apiVersion') !== 1 ||
        typeof Reflect.get(value, 'createModel') !== 'function'
    ) {
        throw new TypeError(
            'Live2D runtime must implement provider API version 1 and createModel().'
        );
    }
    return value as Live2DRuntime;
}

async function initialize(state: RuntimeConfigurationState): Promise<Live2DRuntime> {
    const { runtime, nonce } = state.configuration;
    if (runtime !== undefined) {
        return requireRuntime(typeof runtime === 'function' ? await runtime() : runtime);
    }
    const { createDefaultLive2DRuntime } = await import('./runtime/DefaultRuntime.js');
    return requireRuntime(await createDefaultLive2DRuntime(nonce === undefined ? {} : { nonce }));
}

function initializeWithDeadline(state: RuntimeConfigurationState): Promise<Live2DRuntime> {
    return new Promise<Live2DRuntime>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new DOMException('Live2D runtime initialization timed out.', 'TimeoutError'));
        }, state.configuration.timeoutMilliseconds ?? 30_000);
        // Deferring application code lets resolveLive2DConfiguration publish this promise first,
        // while starting its deadline before a model's same-duration load deadline.
        void Promise.resolve()
            .then(() => initialize(state))
            .then(
                runtime => {
                    clearTimeout(timer);
                    resolve(runtime);
                },
                (error: unknown) => {
                    clearTimeout(timer);
                    reject(
                        error instanceof Error
                            ? error
                            : new Error('Live2D runtime initialization failed.', { cause: error })
                    );
                }
            );
    });
}

/** @internal Snapshot the provider and deadline at the beginning of one load. */
export function resolveLive2DConfiguration(override?: Live2DRuntime): {
    readonly runtime: Promise<Live2DRuntime>;
    readonly timeoutMilliseconds: number;
} {
    if (current === null) configureLive2D();
    const state = current;
    if (override !== undefined) {
        return {
            runtime: Promise.resolve(requireRuntime(override)),
            timeoutMilliseconds: state?.configuration.timeoutMilliseconds ?? 30_000
        };
    }
    if (!state) throw new Error('Live2D runtime configuration is unavailable.');
    if (!state.pending) {
        // Publish the shared promise before invoking application code, including a factory that
        // synchronously starts another model load during initialization.
        const pending = initializeWithDeadline(state);
        state.pending = pending;
        void pending.catch(() => {
            if (state.pending === pending) state.pending = null;
        });
    }
    return {
        runtime: state.pending,
        timeoutMilliseconds: state.configuration.timeoutMilliseconds ?? 30_000
    };
}
