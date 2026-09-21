import { Renderer } from 'hilo3d';
import { loadLive2DAssets, type Live2DAssets, type Live2DModelSettings } from './Live2DAssets.js';
import { resolveLive2DConfiguration } from './Live2DConfiguration.js';
import { Live2DNode } from './Live2DNode.js';
import type {
    Live2DExpressionOptions,
    Live2DModelRuntime,
    Live2DMotionOptions,
    Live2DParameterAccess,
    Live2DParameterInfo,
    Live2DParameterUpdate,
    Live2DRuntime,
    Live2DUpdateOptions
} from './runtime/Live2DRuntime.js';

/** Input options for an independently owned, fully loaded Live2D scene node. */
export interface Live2DModelLoadOptions {
    /** Cancel the complete load, including SDK model and animation construction. */
    readonly signal?: AbortSignal;
    /** Explicit deployment version added as hilo_v to the manifest and every referenced asset. */
    readonly assetVersion?: string;
    /** Complete load deadline; defaults to configureLive2D's deadline. */
    readonly timeoutMilliseconds?: number;
    /** Optional scene-node name. */
    readonly name?: string;
    /** Per-mask texture resolution. Defaults to 1024. */
    readonly maskSize?: number;
    /** Let Stage updates advance the model. Defaults to true. */
    readonly automaticUpdate?: boolean;
    /** Advanced per-model runtime injection; ordinary callers configure runtimeUrl once. */
    readonly runtime?: Live2DRuntime;
}

/** Model-local bounds, in the same coordinates used by hitTest. */
export interface Live2DBounds {
    /** Minimum model-local X coordinate. */
    readonly left: number;
    /** Maximum model-local X coordinate. */
    readonly right: number;
    /** Minimum model-local Y coordinate. */
    readonly bottom: number;
    /** Maximum model-local Y coordinate. */
    readonly top: number;
}

/** Persistent parameter override applied after animation, expressions and physics. */
export interface Live2DParameterOptions {
    /** Interpolation weight in [0, 1], defaulting to one. */
    readonly weight?: number;
}

interface ParameterOverride {
    value: number;
    weight: number;
}

interface UpdateControls extends Live2DUpdateOptions {
    motionTimeScale: number;
    automaticEyeBlink: boolean;
    physicsEnabled: boolean;
    lipSync: number | null;
}

function requireScale(value: number, label: string): number {
    if (!Number.isFinite(value) || value < 0)
        throw new RangeError(`${label} must be finite and non-negative.`);
    return value;
}

function requireSession(value: Live2DModelRuntime): void {
    const candidate: unknown = value;
    if (typeof candidate !== 'object' || candidate === null)
        throw new TypeError('Live2D runtime returned an invalid model.');
    for (const name of [
        'getParameter',
        'setParameter',
        'update',
        'playMotion',
        'isMotionPlaying',
        'stopMotions',
        'setExpression',
        'clearExpression',
        'getOpacity',
        'destroy'
    ] as const) {
        if (typeof Reflect.get(candidate, name) !== 'function')
            throw new TypeError(`Live2D runtime model is missing ${name}().`);
    }
    const source: unknown = Reflect.get(candidate, 'source');
    if (
        !Array.isArray(Reflect.get(candidate, 'parameters')) ||
        typeof source !== 'object' ||
        source === null ||
        !Array.isArray(Reflect.get(source, 'drawables')) ||
        typeof Reflect.get(source, 'sync') !== 'function'
    ) {
        throw new TypeError('Live2D runtime returned invalid parameters or drawable data.');
    }
}

function abortReason(signal: AbortSignal): Error {
    const reason: unknown = signal.reason;
    if (reason instanceof Error) return reason;
    const error = new Error('Live2D loading was aborted.', { cause: reason });
    error.name = 'AbortError';
    return error;
}

async function waitWithAbort<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const aborted = (): void => {
            signal.removeEventListener('abort', aborted);
            if (settled) return;
            settled = true;
            reject(abortReason(signal));
        };
        if (signal.aborted) aborted();
        else signal.addEventListener('abort', aborted, { once: true });
        // Always observe late settlement, including promises started immediately before an abort.
        void pending.then(
            value => {
                signal.removeEventListener('abort', aborted);
                if (!settled) {
                    settled = true;
                    resolve(value);
                }
            },
            (error: unknown) => {
                signal.removeEventListener('abort', aborted);
                if (!settled) {
                    settled = true;
                    reject(
                        error instanceof Error
                            ? error
                            : new Error('Live2D loading failed.', { cause: error })
                    );
                }
            }
        );
    });
}

/**
 * Fully owned Live2D scene node: load once, attach to Stage, then use motion/expression/parameter APIs.
 * Stage advances the CPU runtime and synchronizes meshes automatically. Destruction releases the
 * SDK model, all animation resources, mask targets, textures and decoded images.
 */
export class Live2DModel extends Live2DNode {
    override readonly className: string = 'Live2DModel';
    /** Immutable model manifest metadata with resolved resource URLs. */
    readonly settings: Live2DModelSettings;
    /** Stable parameter metadata. Use getParameter() for live values. */
    readonly parameters: readonly Live2DParameterInfo[];
    /** Whether Stage's per-node update hook advances this model. */
    automaticUpdate: boolean;
    /** Pause all animation clocks while still applying parameter overrides. */
    paused = false;
    /** Enable the model's automatic eye-blink effect. */
    automaticEyeBlink = true;
    /** Evaluate physics3 when the model supplies a physics rig. */
    physicsEnabled = true;
    /** Procedural parameter animation before expressions, expressed without SDK types. */
    beforeExpressions: Live2DParameterUpdate | null = null;
    /** Procedural parameter animation after expressions and before physics/pose. */
    afterExpressions: Live2DParameterUpdate | null = null;
    #session: Live2DModelRuntime | null;
    #assets: Live2DAssets | null;
    readonly #parametersById = new Map<string, Live2DParameterInfo>();
    readonly #overrides = new Map<string, ParameterOverride>();
    readonly #updateControls: UpdateControls;
    #timeScale = 1;
    #motionTimeScale = 1;
    #lipSync: number | null = null;
    #updating = false;

    private constructor(
        assets: Live2DAssets,
        session: Live2DModelRuntime,
        options: Live2DModelLoadOptions
    ) {
        super({
            source: {
                drawables: session.source.drawables,
                sync(): void {
                    session.source.sync();
                },
                get modelOpacity(): number {
                    return session.getOpacity();
                }
            },
            textures: assets.textures,
            ...(options.maskSize === undefined ? {} : { maskSize: options.maskSize })
        });
        this.#session = session;
        this.#assets = assets;
        this.settings = assets.settings;
        this.parameters = Object.freeze(
            session.parameters.map(parameter => Object.freeze({ ...parameter }))
        );
        for (const parameter of this.parameters) {
            if (
                typeof parameter.id !== 'string' ||
                parameter.id.length === 0 ||
                this.#parametersById.has(parameter.id) ||
                !Number.isSafeInteger(parameter.index) ||
                parameter.index < 0 ||
                ![parameter.min, parameter.max, parameter.defaultValue].every(Number.isFinite) ||
                parameter.min > parameter.max ||
                parameter.defaultValue < parameter.min ||
                parameter.defaultValue > parameter.max
            ) {
                throw new TypeError('Live2D runtime returned invalid parameter metadata.');
            }
            this.#parametersById.set(parameter.id, parameter);
        }
        this.name =
            options.name ??
            new URL(assets.settings.modelUrl).pathname
                .split('/')
                .pop()
                ?.replace(/\.model3\.json$/iu, '') ??
            'Live2DModel';
        this.automaticUpdate = options.automaticUpdate ?? true;
        this.sortingGroup = true;
        this.#updateControls = {
            motionTimeScale: 1,
            automaticEyeBlink: true,
            physicsEnabled: true,
            lipSync: null,
            beforeExpressions: (parameters, delta): void => {
                this.beforeExpressions?.(parameters, delta);
            },
            afterExpressions: (parameters, delta): void => {
                this.afterExpressions?.(parameters, delta);
            },
            afterEffects: parameters => {
                this.applyOverrides(parameters);
            }
        };
        this.enableUpdateHook();
    }

    /** Load model3, moc3, textures and declared animations into an independent owned node. */
    static async load(
        model3Url: string | URL,
        options: Readonly<Live2DModelLoadOptions> = {}
    ): Promise<Live2DModel> {
        options = Object.freeze({ ...options });
        options.signal?.throwIfAborted();
        if (
            options.assetVersion !== undefined &&
            (typeof options.assetVersion !== 'string' || options.assetVersion.trim().length === 0)
        ) {
            throw new TypeError('Live2D assetVersion must be a non-empty string.');
        }
        if (
            options.timeoutMilliseconds !== undefined &&
            (!Number.isFinite(options.timeoutMilliseconds) || options.timeoutMilliseconds <= 0)
        ) {
            throw new RangeError('Live2D timeoutMilliseconds must be positive and finite.');
        }
        const configuration = resolveLive2DConfiguration(options.runtime);
        const timeout = options.timeoutMilliseconds ?? configuration.timeoutMilliseconds;
        if (!Number.isFinite(timeout) || timeout <= 0)
            throw new RangeError('Live2D timeoutMilliseconds must be positive and finite.');
        const controller = new AbortController();
        const forwardAbort = (): void => {
            controller.abort(options.signal?.reason);
        };
        if (options.signal?.aborted) forwardAbort();
        else options.signal?.addEventListener('abort', forwardAbort, { once: true });
        const timer = setTimeout(() => {
            controller.abort(new DOMException('Live2D model loading timed out.', 'TimeoutError'));
        }, timeout);
        const ownership: {
            assets: Live2DAssets | null;
            session: Live2DModelRuntime | null;
            model: Live2DModel | null;
        } = {
            assets: null,
            session: null,
            model: null
        };
        let abandoned = false;
        const assetsTask = loadLive2DAssets(model3Url, {
            signal: controller.signal,
            ...(options.assetVersion === undefined ? {} : { assetVersion: options.assetVersion })
        }).then(value => {
            if (abandoned || controller.signal.aborted) {
                value.destroy();
                throw abortReason(controller.signal);
            }
            ownership.assets = value;
            return value;
        });
        try {
            const [runtime, loadedAssets] = await waitWithAbort(
                Promise.all([configuration.runtime, assetsTask]),
                controller.signal
            );
            const modelTask = runtime
                .createModel(loadedAssets, { signal: controller.signal })
                .then(value => {
                    if (abandoned || controller.signal.aborted) {
                        value.destroy();
                        throw abortReason(controller.signal);
                    }
                    ownership.session = value;
                    return value;
                });
            const loadedSession = await waitWithAbort(modelTask, controller.signal);
            controller.signal.throwIfAborted();
            requireSession(loadedSession);
            const model = new Live2DModel(loadedAssets, loadedSession, options);
            ownership.model = model;
            controller.signal.throwIfAborted();
            return model;
        } catch (cause: unknown) {
            abandoned = true;
            controller.abort(cause);
            const cleanupErrors: unknown[] = [];
            if (ownership.model !== null) {
                try {
                    ownership.model.destroy();
                } catch (error: unknown) {
                    cleanupErrors.push(error);
                }
                ownership.session = null;
                ownership.assets = null;
            }
            try {
                ownership.session?.destroy();
            } catch (error: unknown) {
                cleanupErrors.push(error);
            }
            try {
                ownership.assets?.destroy();
            } catch (error: unknown) {
                cleanupErrors.push(error);
            }
            if (cleanupErrors.length > 0)
                throw new AggregateError(
                    [cause, ...cleanupErrors],
                    'Live2D load and cleanup failed.',
                    { cause }
                );
            throw cause;
        } finally {
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', forwardAbort);
        }
    }

    /** Non-negative global animation speed. */
    get timeScale(): number {
        return this.#timeScale;
    }
    set timeScale(value: number) {
        this.#timeScale = requireScale(value, 'Live2D timeScale');
    }
    /** Independent base-motion speed; expressions and procedural hooks retain the global clock. */
    get motionTimeScale(): number {
        return this.#motionTimeScale;
    }
    set motionTimeScale(value: number) {
        this.#motionTimeScale = requireScale(value, 'Live2D motionTimeScale');
    }
    /** Optional normalized lip-sync amplitude, or null to disable. */
    get lipSync(): number | null {
        return this.#lipSync;
    }
    set lipSync(value: number | null) {
        if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1))
            throw new RangeError('Live2D lipSync must be null or in [0, 1].');
        this.#lipSync = value;
    }

    /** Automatically called by Stage with a delta in milliseconds. */
    override update(deltaMilliseconds: number): void {
        if (this.automaticUpdate) this.advance(deltaMilliseconds);
    }

    /** Advance explicitly when using a standalone Renderer or automaticUpdate=false. */
    advance(deltaMilliseconds: number): void {
        const session = this.requireSession();
        if (this.#updating) throw new Error('Live2D updates cannot be re-entered.');
        requireScale(deltaMilliseconds, 'Live2D deltaMilliseconds');
        const seconds = this.paused ? 0 : (deltaMilliseconds * this.#timeScale) / 1000;
        requireScale(seconds, 'Live2D scaled delta');
        this.#updateControls.motionTimeScale = this.#motionTimeScale;
        this.#updateControls.automaticEyeBlink = this.automaticEyeBlink;
        this.#updateControls.physicsEnabled = this.physicsEnabled;
        this.#updateControls.lipSync = this.#lipSync;
        this.#updating = true;
        try {
            session.update(seconds, this.#updateControls);
            super.sync();
        } finally {
            this.#updating = false;
        }
    }

    /** Start a motion group entry. Ordinary playback replaces the previous motion. */
    playMotion(group: string, options?: Live2DMotionOptions): boolean {
        return this.requireSession().playMotion(group, options);
    }
    /** Whether a base motion is still playing, including a looping motion. */
    get isMotionPlaying(): boolean {
        return this.requireSession().isMotionPlaying();
    }
    /** Stop active motions without disposing the model. */
    stopMotions(): void {
        this.requireSession().stopMotions();
    }
    /** Select an expression by the name in model3 metadata. */
    setExpression(name: string, options?: Live2DExpressionOptions): void {
        this.requireSession().setExpression(name, options);
    }
    /** Remove expression contributions on the next update. */
    clearExpression(): void {
        this.requireSession().clearExpression();
    }
    /** Whether the model declares a parameter. */
    hasParameter(id: string): boolean {
        return this.#parametersById.has(id);
    }
    /** Read the most recently evaluated parameter value. */
    getParameter(id: string): number {
        return this.requireSession().getParameter(id);
    }

    /**
     * Queue a final parameter override for the next Stage/advance update, until cleared.
     * getParameter() continues to report the most recently evaluated frame.
     */
    setParameter(id: string, value: number, options: Readonly<Live2DParameterOptions> = {}): this {
        this.requireSession();
        if (!this.#parametersById.has(id)) throw new RangeError(`Unknown Live2D parameter: ${id}`);
        const weight = options.weight ?? 1;
        if (!Number.isFinite(value) || !Number.isFinite(weight) || weight < 0 || weight > 1)
            throw new RangeError('Live2D parameter value must be finite and weight in [0, 1].');
        const existing = this.#overrides.get(id);
        if (existing) {
            existing.value = value;
            existing.weight = weight;
        } else this.#overrides.set(id, { value, weight });
        return this;
    }

    /** Resume animated control of one parameter on the next update. */
    clearParameter(id: string): this {
        this.requireSession();
        this.#overrides.delete(id);
        return this;
    }
    /** Resume animated control of all overridden parameters. */
    clearParameters(): this {
        this.requireSession();
        this.#overrides.clear();
        return this;
    }

    /** Compute model-local bounds, optionally restricted to authored drawable names. */
    getModelBounds(drawableIds?: readonly string[]): Live2DBounds {
        const source = this.requireSession().source;
        let left = Infinity,
            right = -Infinity,
            bottom = Infinity,
            top = -Infinity;
        for (const drawable of source.drawables) {
            if (drawableIds && !drawableIds.includes(drawable.id)) continue;
            for (let i = 0; i < drawable.positions.length; i += 2) {
                const x = drawable.positions[i],
                    y = drawable.positions[i + 1];
                if (x === undefined || y === undefined)
                    throw new Error('Incomplete Live2D positions.');
                left = Math.min(left, x);
                right = Math.max(right, x);
                bottom = Math.min(bottom, y);
                top = Math.max(top, y);
            }
        }
        if (!Number.isFinite(left)) return { left: 0, right: 0, bottom: 0, top: 0 };
        return { left, right, bottom, top };
    }

    /** Test authored hit-area bounds (or all drawable bounds) in model-local coordinates. */
    hitTest(x: number, y: number, areaName?: string): boolean {
        if (!Number.isFinite(x) || !Number.isFinite(y))
            throw new RangeError('Live2D hit coordinates must be finite.');
        const area =
            areaName === undefined
                ? undefined
                : this.settings.hitAreas.find(value => value.name === areaName);
        if (areaName !== undefined && !area)
            throw new RangeError(`Unknown Live2D hit area: ${areaName}`);
        const bounds = this.getModelBounds(area ? [area.id] : undefined);
        return (
            bounds.right > bounds.left &&
            bounds.top > bounds.bottom &&
            x >= bounds.left &&
            x <= bounds.right &&
            y >= bounds.bottom &&
            y <= bounds.top
        );
    }

    /**
     * Release rendering, SDK session and asset ownership. Stage calls this automatically.
     * Call outside parameter update hooks; destroying or recursively advancing during a hook
     * throws before releasing ownership, so destruction can safely follow the completed update.
     */
    override destroy(renderer?: Renderer, destroyTextures = false): this {
        const renderingDestroyed = (): boolean => this.isDestroyed;
        if (renderingDestroyed()) return this;
        if (renderer !== undefined && !(renderer instanceof Renderer))
            throw new TypeError('Live2D destruction requires a Renderer instance.');
        if (this.#updating)
            throw new Error('Do not destroy a Live2D model from its parameter update hook.');
        const errors: unknown[] = [];
        try {
            super.destroy(renderer, false);
        } catch (error: unknown) {
            if (!renderingDestroyed()) throw error;
            errors.push(error);
        }
        const session = this.#session,
            assets = this.#assets;
        this.#session = null;
        this.#assets = null;
        this.#overrides.clear();
        this.beforeExpressions = this.afterExpressions = null;
        try {
            session?.destroy();
        } catch (error: unknown) {
            errors.push(error);
        }
        try {
            assets?.destroy();
        } catch (error: unknown) {
            errors.push(error);
        }
        void destroyTextures; // Input textures are always owned by the high-level asset bundle.
        if (errors.length > 0) throw new AggregateError(errors, 'Live2D model cleanup failed.');
        return this;
    }

    private requireSession(): Live2DModelRuntime {
        if (!this.#session || this.isDestroyed) throw new Error('Live2D model is destroyed.');
        return this.#session;
    }

    private applyOverrides(parameters: Live2DParameterAccess): void {
        for (const [id, override] of this.#overrides)
            parameters.set(id, override.value, override.weight);
    }
}
