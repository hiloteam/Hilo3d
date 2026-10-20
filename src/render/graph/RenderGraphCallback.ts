import { renderGraphFailure } from './RenderGraphValidation';

/** @internal Graph callbacks cannot outlive their declaration or command scope. */
export function assertSynchronousGraphCallback(
    result: unknown,
    phase: 'setup' | 'prepare' | 'execute',
    passName: string
): void {
    if (
        ((typeof result === 'object' && result !== null) || typeof result === 'function') &&
        typeof Reflect.get(result, 'then') === 'function'
    ) {
        // The synchronous error is authoritative; observe any later rejection from the
        // invalid callback so it cannot escape as an unrelated unhandled rejection.
        void Promise.resolve(result).catch(() => undefined);
        renderGraphFailure('invalid-state', `${phase} callbacks must be synchronous`, passName);
    }
}
