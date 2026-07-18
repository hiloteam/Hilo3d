import type * as Naga from 'web-naga';

export type NagaModule = typeof Naga;

let initializedModule: NagaModule | null = null;
let pendingInitialization: Promise<NagaModule> | null = null;

/**
 * Initialize the process-wide Naga WASM module.
 *
 * Concurrent callers share one attempt. A rejected attempt is deliberately not cached so a later
 * renderer or compiler can retry initialization.
 */
export function initializeNagaModule(): Promise<NagaModule> {
    if (initializedModule !== null) return Promise.resolve(initializedModule);
    if (pendingInitialization !== null) return pendingInitialization;

    const loading = import('web-naga').then(async module => {
        await module.default();
        return module;
    });
    const initialization: Promise<NagaModule> = loading.then(
        module => {
            if (pendingInitialization === initialization) initializedModule = module;
            return module;
        },
        (error: unknown) => {
            if (pendingInitialization === initialization) pendingInitialization = null;
            throw error;
        }
    );
    pendingInitialization = initialization;
    return initialization;
}

/** Return the initialized module without starting an asynchronous initialization attempt. */
export function getInitializedNagaModule(): NagaModule | null {
    return initializedModule;
}

/**
 * Run one operation against a Naga shader module and always attempt to release it.
 *
 * Some wasm-bindgen failure paths leave a Rust borrow active, causing `free()` itself to throw.
 * That cleanup error must not replace the shader diagnostic that caused it. A cleanup failure is
 * surfaced only when the shader operation completed successfully.
 */
interface NagaOwnedResource {
    free(): void;
}

export function useNagaResource<Resource extends NagaOwnedResource, Result>(
    resource: Resource,
    operation: (resource: Resource) => Result
): Result {
    let result: Result;
    try {
        result = operation(resource);
    } catch (error: unknown) {
        try {
            resource.free();
        } catch (cleanupError: unknown) {
            // A failed wasm operation can retain a Rust borrow. The original shader error is the
            // actionable diagnostic; the best-effort cleanup failure must not replace it.
            void cleanupError;
        }
        throw error;
    }
    resource.free();
    return result;
}

/** Run a shader-module operation with the same primary-error-preserving cleanup policy. */
export function useNagaShaderModule<Result>(
    module: Naga.ShaderModule,
    operation: (module: Naga.ShaderModule) => Result
): Result {
    return useNagaResource(module, operation);
}
