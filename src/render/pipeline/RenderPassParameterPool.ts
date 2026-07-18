/** Factory for one reusable scriptable-pass parameter record. */
export type RenderPassParameterFactory<P extends object> = () => P;

/** Resets a retained parameter record immediately before its next acquisition. */
export type RenderPassParameterReset<P extends object> = (parameters: P) => void;

interface RenderPassParameterPoolState {
    readonly storage: object[];
    readonly factory: () => object;
    readonly reset: ((parameters: object) => void) | null;
    owner: object | null;
    frameIndex: number;
    cursor: number;
}

const poolStates = new WeakMap<object, RenderPassParameterPoolState>();

function requirePoolState(pool: object): RenderPassParameterPoolState {
    const state = poolStates.get(pool);
    if (state === undefined) {
        throw new TypeError('Render pass parameter pool is not initialized');
    }
    return state;
}

/**
 * Renderer-local high-water storage for scriptable-pass parameters.
 *
 * A slot remains owned by the frame that acquired it until that frame has submitted or failed.
 * Existing slots are reset and reused; the factory runs only when a new historical high-water mark
 * is reached.
 */
export class RenderPassParameterPool<P extends object> {
    constructor(
        /** Creates a slot only when the historical high-water mark grows. */
        factory: RenderPassParameterFactory<P>,
        /** Resets a retained slot immediately before reuse. */
        reset?: RenderPassParameterReset<P>
    ) {
        if (typeof factory !== 'function') {
            throw new TypeError('Render pass parameter factory must be a function');
        }
        if (reset !== undefined && typeof reset !== 'function') {
            throw new TypeError('Render pass parameter reset must be a function');
        }
        poolStates.set(this, {
            storage: [],
            factory: (): object => factory(),
            reset:
                reset === undefined
                    ? null
                    : (parameters: object): void => {
                          reset(parameters as P);
                      },
            owner: null,
            frameIndex: -1,
            cursor: 0
        });
    }

    /** Historical slot count retained by this pool. */
    get capacity(): number {
        return requirePoolState(this).storage.length;
    }
}

/** @internal Acquire through RenderPipelineContext so ownership and frame scope are enforced. */
export function acquireRenderPassParameters<P extends object>(
    pool: RenderPassParameterPool<P>,
    owner: object,
    frameIndex: number
): P {
    if (!(pool instanceof RenderPassParameterPool)) {
        throw new TypeError('Pass parameter acquisition requires a RenderPassParameterPool');
    }
    const state = requirePoolState(pool);
    if (state.owner === null) state.owner = owner;
    else if (state.owner !== owner) {
        throw new Error('RenderPassParameterPool belongs to another render pipeline runtime');
    }
    if (state.frameIndex !== frameIndex) {
        state.frameIndex = frameIndex;
        state.cursor = 0;
    }
    const index = state.cursor++;
    const retained = state.storage[index];
    if (retained !== undefined) {
        state.reset?.(retained);
        return retained as P;
    }
    const created = state.factory();
    const candidate: unknown = created;
    if ((typeof candidate !== 'object' && typeof candidate !== 'function') || candidate === null) {
        throw new TypeError('Render pass parameter factory must return an object');
    }
    state.storage.push(created);
    return created as P;
}
