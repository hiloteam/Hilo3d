/** Options forwarded by configureLive2D to a generated, self-hosted runtime provider. */
export interface RuntimeProviderOptions {
    /** CSP nonce applied to the original Cubism Core script element. */
    readonly nonce?: string;
}

/** Colocated deployment assets produced by the SDK builder. */
export interface RuntimeProviderAssets {
    readonly coreUrl: URL;
    readonly moduleUrl: URL;
}

interface CoreScriptState {
    readonly url: string;
    readonly promise: Promise<void>;
}

interface RuntimeFactoryModule {
    createLive2DRuntime(): unknown;
}

const coreStateKey = Symbol.for('@hilo/addon-live2d/core-script/v1');
const scriptStates = globalThis as typeof globalThis & {
    [coreStateKey]?: CoreScriptState;
    Live2DCubismCore?: unknown;
};

function coreIsPresent(): boolean {
    const core = scriptStates.Live2DCubismCore;
    return typeof core === 'object' && core !== null;
}

function loadCore(url: URL, options: Readonly<RuntimeProviderOptions>): Promise<void> {
    const existing = scriptStates[coreStateKey];
    if (existing) {
        if (existing.url !== url.href) {
            return Promise.reject(
                new Error('A different Cubism Core deployment is already active.')
            );
        }
        return existing.promise;
    }
    if (coreIsPresent()) {
        return Promise.reject(
            new Error(
                'Cubism Core was loaded outside this runtime provider. Remove the separate Core script.'
            )
        );
    }
    if (typeof document === 'undefined') {
        return Promise.reject(
            new Error('The Cubism runtime provider requires a browser document.')
        );
    }
    let script: HTMLScriptElement | undefined;
    const promise = new Promise<void>((resolve, reject) => {
        script = document.createElement('script');
        script.src = url.href;
        script.async = true;
        if (options.nonce !== undefined) script.nonce = options.nonce;
        script.onload = (): void => {
            if (coreIsPresent()) resolve();
            else reject(new Error('Cubism Core loaded without exposing its runtime.'));
        };
        script.onerror = (): void => {
            reject(new Error(`Unable to load Cubism Core: ${url.href}`));
        };
        document.head.append(script);
    });
    const state: CoreScriptState = { url: url.href, promise };
    scriptStates[coreStateKey] = state;
    void promise.catch((): void => {
        if (scriptStates[coreStateKey] === state)
            Reflect.deleteProperty(scriptStates, coreStateKey);
        script?.remove();
    });
    return promise;
}

function requireFactory(value: unknown): RuntimeFactoryModule {
    if (
        typeof value !== 'object' ||
        value === null ||
        !('createLive2DRuntime' in value) ||
        typeof value.createLive2DRuntime !== 'function'
    ) {
        throw new TypeError('The deployed Cubism CPU module has no runtime factory.');
    }
    return value as RuntimeFactoryModule;
}

/**
 * Create the factory exported by a generated runtime.js deployment.
 *
 * Core stays byte-identical and loads before Framework module initialization. Failed script,
 * module or runtime creation releases its pending promise so callers can retry. A document may
 * use only one Core deployment because the vendor executable owns one process-global runtime.
 */
export function createRuntimeProvider(
    assets: Readonly<RuntimeProviderAssets>
): (options?: Readonly<RuntimeProviderOptions>) => Promise<unknown> {
    let pending: Promise<unknown> | undefined;
    let loadedModule: RuntimeFactoryModule | undefined;
    let moduleAttempts = 0;
    return (options: Readonly<RuntimeProviderOptions> = {}): Promise<unknown> => {
        if (pending) return pending;
        const operation = (async (): Promise<unknown> => {
            await loadCore(assets.coreUrl, options);
            if (!loadedModule) {
                const url = new URL(assets.moduleUrl.href);
                if (moduleAttempts > 0)
                    url.searchParams.set('__hilo_retry', String(moduleAttempts));
                try {
                    const module: unknown = await import(/* @vite-ignore */ url.href);
                    loadedModule = requireFactory(module);
                } catch (error) {
                    moduleAttempts++;
                    throw error;
                }
            }
            return await loadedModule.createLive2DRuntime();
        })();
        pending = operation;
        void operation.catch((): void => {
            if (pending === operation) pending = undefined;
        });
        return operation;
    };
}
