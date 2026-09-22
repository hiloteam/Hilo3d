import type { Live2DAssets, Live2DMotionReference } from '../Live2DAssets.js';
import { createCubismCoreSource, type Live2DSource } from '../Live2DSource.js';
import type {
    Live2DExpressionOptions,
    Live2DModelRuntime,
    Live2DMotionOptions,
    Live2DParameterAccess,
    Live2DParameterBlend,
    Live2DParameterInfo,
    Live2DRuntime,
    Live2DRuntimeCreateOptions,
    Live2DUpdateOptions
} from '../runtime/Live2DRuntime.js';
import {
    requireCubismSDK,
    type CubismExpressionInstance,
    type CubismExpressionManagerInstance,
    type CubismEyeBlinkInstance,
    type CubismMocInstance,
    type CubismModelInstance,
    type CubismMotionInstance,
    type CubismMotionManagerInstance,
    type CubismParameterEffect,
    type CubismPhysicsInstance,
    type CubismQueue,
    type CubismSDK
} from './CubismSDK.js';

const MOTION_POLICIES: ReadonlySet<string> = new Set(['background', 'normal', 'force']);
const PARAMETER_BLENDS: ReadonlySet<string> = new Set(['overwrite', 'add', 'multiply']);

interface MotionData {
    readonly bytes: ArrayBuffer;
    readonly reference: Live2DMotionReference;
    readonly loop: boolean;
}

interface RuntimeData {
    readonly motions: Map<string, readonly MotionData[]>;
    readonly expressions: Map<string, ArrayBuffer>;
    physics: ArrayBuffer | null;
    pose: ArrayBuffer | null;
}

function nonNegative(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`Live2D ${label} must be finite and non-negative`);
    }
}

function unit(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new RangeError(`Live2D ${label} must be in [0, 1]`);
    }
}

function requireValue<T>(value: T | null | undefined, label: string): T {
    if (value === undefined || value === null) throw new Error(`Live2D ${label} is unavailable`);
    return value;
}

async function fetchBytes(url: string, signal: AbortSignal | undefined): Promise<ArrayBuffer> {
    signal?.throwIfAborted();
    const response = await fetch(url, signal === undefined ? {} : { signal });
    signal?.throwIfAborted();
    if (!response.ok) {
        throw new Error(`Live2D animation request failed (${String(response.status)}): ${url}`);
    }
    const bytes = await response.arrayBuffer();
    signal?.throwIfAborted();
    return bytes;
}

function motionLoop(bytes: ArrayBuffer): boolean {
    const json: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof json !== 'object' || json === null) throw new Error('Invalid Live2D motion JSON');
    const meta: unknown = Reflect.get(json, 'Meta');
    if (typeof meta !== 'object' || meta === null) return false;
    const loop: unknown = Reflect.get(meta, 'Loop');
    if (loop !== undefined && typeof loop !== 'boolean') {
        throw new Error('Live2D motion Meta.Loop must be boolean');
    }
    return loop === true;
}

async function loadData(
    assets: Live2DAssets,
    signal: AbortSignal | undefined
): Promise<RuntimeData> {
    const motions = new Map<string, readonly MotionData[]>();
    const expressions = new Map<string, ArrayBuffer>();
    for (const [group, references] of Object.entries(assets.settings.motions)) {
        const entries: MotionData[] = [];
        for (const reference of references) {
            const bytes = await fetchBytes(reference.url, signal);
            entries.push({ bytes, reference, loop: motionLoop(bytes) });
        }
        motions.set(group, entries);
    }
    for (const expression of assets.settings.expressions) {
        if (expressions.has(expression.name)) {
            throw new Error(`Duplicate Live2D expression name: ${expression.name}`);
        }
        expressions.set(expression.name, await fetchBytes(expression.url, signal));
    }
    const physics =
        assets.settings.physicsUrl === undefined
            ? null
            : await fetchBytes(assets.settings.physicsUrl, signal);
    const pose =
        assets.settings.poseUrl === undefined
            ? null
            : await fetchBytes(assets.settings.poseUrl, signal);
    return { motions, expressions, physics, pose };
}

function releaseQueue(queue: CubismQueue): void {
    // Some Framework versions splice their queue while iterating forward. Drain until empty,
    // checking progress, before release; expression-manager release does not release its base queue.
    let count = queue.getCubismMotionQueueEntries().length;
    while (count > 0) {
        queue.stopAllMotions();
        const remaining = queue.getCubismMotionQueueEntries().length;
        if (remaining >= count) throw new Error('Live2D SDK motion queue did not drain');
        count = remaining;
    }
    queue.release();
}

function releaseCompleted<T extends CubismExpressionInstance>(
    queue: CubismQueue,
    owned: Set<T>
): void {
    const entries = queue.getCubismMotionQueueEntries();
    for (const motion of owned) {
        let active = false;
        for (const entry of entries) {
            if (entry.getCubismMotion() === motion) {
                active = true;
                break;
            }
        }
        if (!active) {
            owned.delete(motion);
            motion.release();
        }
    }
}

function layoutSource(
    source: Live2DSource,
    sdk: CubismSDK,
    model: CubismModelInstance,
    assets: Live2DAssets
): Live2DSource {
    const entries = Object.entries(assets.settings.layout);
    if (entries.length === 0) return source;
    const width = model.getCanvasWidth();
    const height = model.getCanvasHeight();
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error('Live2D canvas dimensions are invalid for model3 Layout');
    }
    const names: Readonly<Record<string, string>> = {
        Width: 'width',
        Height: 'height',
        X: 'x',
        Y: 'y',
        CenterX: 'center_x',
        CenterY: 'center_y',
        Top: 'top',
        Bottom: 'bottom',
        Left: 'left',
        Right: 'right'
    };
    const matrix = new sdk.CubismModelMatrix(width, height);
    matrix.loadIdentity();
    matrix.setupFromLayout(new Map(entries.map(([key, value]) => [names[key] ?? key, value])));
    const records = source.drawables.map(drawable => {
        const positions = new Float32Array(drawable.positions.length);
        return { source: drawable, target: { ...drawable, positions }, positions };
    });
    const sync = (): void => {
        source.sync();
        for (const entry of records) {
            Object.assign(entry.target, entry.source);
            entry.target.positions = entry.positions;
            for (let index = 0; index < entry.positions.length; index += 2) {
                const x = matrix.transformX(
                    requireValue(entry.source.positions[index], 'layout X')
                );
                const y = matrix.transformY(
                    requireValue(entry.source.positions[index + 1], 'layout Y')
                );
                if (!Number.isFinite(x) || !Number.isFinite(y))
                    throw new Error('Live2D Layout produced non-finite positions');
                entry.positions[index] = x;
                entry.positions[index + 1] = y;
            }
        }
    };
    sync();
    return { drawables: records.map(entry => entry.target), sync };
}

class CubismSession implements Live2DModelRuntime {
    readonly #sdk: CubismSDK;
    readonly #data: RuntimeData;
    #moc: CubismMocInstance | null;
    #model: CubismModelInstance | null;
    #source: Live2DSource | null = null;
    #parameters: readonly Live2DParameterInfo[] = [];
    readonly #parameterIndices = new Map<string, number>();
    readonly #eyeBlinkIds: object[] = [];
    readonly #lipSyncIds: object[] = [];
    readonly #lipSyncIndices: number[] = [];
    readonly #motions = new Set<CubismMotionInstance>();
    readonly #expressions = new Set<CubismExpressionInstance>();
    #motionManager: CubismMotionManagerInstance | null = null;
    #expressionManager: CubismExpressionManagerInstance | null = null;
    #eyeBlink: CubismEyeBlinkInstance | null = null;
    #physics: CubismPhysicsInstance | null = null;
    #pose: CubismParameterEffect | null = null;
    #destroyed = false;
    readonly #access: Live2DParameterAccess = {
        get: id => this.getParameter(id),
        set: (id, value, weight = 1): void => {
            this.writeParameter(id, value, weight, 'overwrite');
        },
        add: (id, value, weight = 1): void => {
            this.writeParameter(id, value, weight, 'add');
        },
        multiply: (id, value, weight = 1): void => {
            this.writeParameter(id, value, weight, 'multiply');
        }
    };

    constructor(
        sdk: CubismSDK,
        data: RuntimeData,
        moc: CubismMocInstance,
        model: CubismModelInstance
    ) {
        this.#sdk = sdk;
        this.#data = data;
        this.#moc = moc;
        this.#model = model;
    }

    get source(): Live2DSource {
        return requireValue(this.#source, 'runtime source');
    }
    get parameters(): readonly Live2DParameterInfo[] {
        return this.#parameters;
    }

    initialize(assets: Live2DAssets): void {
        const model = this.model();
        const raw = model.getModel().parameters;
        if (
            !Number.isSafeInteger(raw.count) ||
            raw.count < 0 ||
            raw.ids.length !== raw.count ||
            raw.minimumValues.length !== raw.count ||
            raw.maximumValues.length !== raw.count ||
            raw.defaultValues.length !== raw.count
        ) {
            throw new Error('Live2D Core parameter metadata is inconsistent');
        }
        this.#parameters = Object.freeze(
            raw.ids.map((id, index) => {
                const min = requireValue(raw.minimumValues[index], 'parameter minimum');
                const max = requireValue(raw.maximumValues[index], 'parameter maximum');
                const defaultValue = requireValue(raw.defaultValues[index], 'parameter default');
                if (
                    !id ||
                    this.#parameterIndices.has(id) ||
                    !Number.isFinite(min) ||
                    !Number.isFinite(max) ||
                    !Number.isFinite(defaultValue) ||
                    min > max ||
                    defaultValue < min ||
                    defaultValue > max
                ) {
                    throw new Error('Live2D Core parameter metadata is invalid');
                }
                this.#parameterIndices.set(id, index);
                return Object.freeze({ id, index, min, max, defaultValue });
            })
        );
        const ids = this.#sdk.CubismFramework.getIdManager();
        for (const group of assets.settings.groups) {
            if (group.target !== 'Parameter') continue;
            for (const id of group.ids) {
                const index = this.#parameterIndices.get(id);
                if (index === undefined) continue;
                if (group.name === 'EyeBlink') this.#eyeBlinkIds.push(ids.getId(id));
                if (group.name === 'LipSync') {
                    this.#lipSyncIds.push(ids.getId(id));
                    this.#lipSyncIndices.push(index);
                }
            }
        }
        this.#motionManager = new this.#sdk.CubismMotionManager();
        this.#expressionManager = new this.#sdk.CubismExpressionMotionManager();
        if (this.#eyeBlinkIds.length > 0) {
            this.#eyeBlink = requireValue(this.#sdk.CubismEyeBlink.create(), 'eye-blink effect');
            this.#eyeBlink.setParameterIds(this.#eyeBlinkIds);
        }
        if (this.#data.physics !== null) {
            this.#physics = requireValue(
                this.#sdk.CubismPhysics.create(this.#data.physics, this.#data.physics.byteLength),
                'physics rig'
            );
        }
        if (this.#data.pose !== null) {
            this.#pose = requireValue(
                this.#sdk.CubismPose.create(this.#data.pose, this.#data.pose.byteLength),
                'pose'
            );
        }
        // Eager parsing makes later playback synchronous and reports malformed animation assets
        // during model loading. Actual plays get distinct SDK objects for independent fades/loops.
        for (const motions of this.#data.motions.values()) {
            for (const motion of motions) this.createMotion(motion).release();
        }
        for (const bytes of this.#data.expressions.values()) this.createExpression(bytes).release();
        model.saveParameters();
        model.update();
        const source = layoutSource(
            createCubismCoreSource(model.getModel(), this.#sdk.Core.Utils),
            this.#sdk,
            model,
            assets
        );
        const getOpacity = (): number => this.getOpacity();
        this.#source = {
            drawables: source.drawables,
            get modelOpacity(): number {
                return getOpacity();
            },
            sync: (): void => {
                this.model();
                source.sync();
            }
        };
    }

    getParameter(id: string): number {
        return this.model().getParameterValueByIndex(this.parameterIndex(id));
    }

    setParameter(
        id: string,
        value: number,
        weight = 1,
        blend: Live2DParameterBlend = 'overwrite'
    ): void {
        const model = this.model();
        this.validateWrite(id, value, weight, blend);
        // Public edits affect the saved motion baseline, not last frame's transient expression
        // and physics results. Hooks use #access and intentionally do not save their changes.
        model.loadParameters();
        this.writeParameter(id, value, weight, blend);
        model.saveParameters();
    }

    update(deltaSeconds: number, options: Live2DUpdateOptions): void {
        const model = this.model();
        nonNegative(deltaSeconds, 'deltaSeconds');
        const scale = options.motionTimeScale ?? 1;
        nonNegative(scale, 'motionTimeScale');
        nonNegative(deltaSeconds * scale, 'scaled motion delta');
        if (options.lipSync !== undefined && options.lipSync !== null)
            unit(options.lipSync, 'lipSync');
        const motions = requireValue(this.#motionManager, 'motion manager');
        const expressions = requireValue(this.#expressionManager, 'expression manager');
        model.loadParameters();
        const motionUpdated = motions.updateMotion(model, deltaSeconds * scale);
        model.saveParameters();
        releaseCompleted(motions, this.#motions);
        if (!motionUpdated && options.automaticEyeBlink !== false)
            this.#eyeBlink?.updateParameters(model, deltaSeconds);
        options.beforeExpressions?.(this.#access, deltaSeconds);
        expressions.updateMotion(model, deltaSeconds);
        releaseCompleted(expressions, this.#expressions);
        options.afterExpressions?.(this.#access, deltaSeconds);
        if (options.physicsEnabled !== false) this.#physics?.evaluate(model, deltaSeconds);
        this.#pose?.updateParameters(model, deltaSeconds);
        if (options.lipSync !== undefined && options.lipSync !== null) {
            for (const index of this.#lipSyncIndices)
                model.addParameterValueByIndex(index, options.lipSync, 1);
        }
        options.afterEffects?.(this.#access, deltaSeconds);
        model.update();
        this.source.sync();
    }

    playMotion(group: string, options: Live2DMotionOptions = {}): boolean {
        this.model();
        const index = options.index ?? 0;
        if (!Number.isSafeInteger(index) || index < 0)
            throw new RangeError('Live2D motion index must be a non-negative integer');
        const data = this.#data.motions.get(group)?.[index];
        if (data === undefined)
            throw new RangeError(`Unknown Live2D motion: ${group}[${String(index)}]`);
        this.validateFades(options);
        const policy = options.priority ?? 'force';
        if (!MOTION_POLICIES.has(policy)) throw new RangeError('Invalid Live2D motion priority');
        const priority = policy === 'background' ? 1 : policy === 'normal' ? 2 : 3;
        const manager = requireValue(this.#motionManager, 'motion manager');
        const motion = this.createMotion(data);
        let transferred = false;
        let reserved = false;
        try {
            motion.setLoop(options.loop ?? data.loop);
            this.applyFades(motion, options, data.reference);
            motion.setEffectIds(this.#eyeBlinkIds, this.#lipSyncIds);
            if (policy !== 'force') {
                reserved = manager.reserveMotion(priority);
                if (!reserved) return false;
            }
            const handle = manager.startMotionPriority(motion, false, priority);
            if (handle === -1 || handle === null || handle === undefined) return false;
            this.#motions.add(motion);
            transferred = true;
            return true;
        } finally {
            if (!transferred) {
                if (reserved) manager.setReservePriority(0);
                motion.release();
            }
        }
    }

    isMotionPlaying(): boolean {
        this.model();
        return !requireValue(this.#motionManager, 'motion manager').isFinished();
    }

    stopMotions(): void {
        this.model();
        const manager = requireValue(this.#motionManager, 'motion manager');
        this.releaseAnimations(manager, this.#motions);
        this.#motionManager = new this.#sdk.CubismMotionManager();
    }

    setExpression(name: string, options: Live2DExpressionOptions = {}): void {
        this.model();
        const bytes = this.#data.expressions.get(name);
        if (bytes === undefined) throw new RangeError(`Unknown Live2D expression: ${name}`);
        this.validateFades(options);
        const expression = this.createExpression(bytes);
        let transferred = false;
        try {
            this.applyFades(expression, options);
            const handle = requireValue(this.#expressionManager, 'expression manager').startMotion(
                expression,
                false
            );
            if (handle === -1 || handle === null || handle === undefined)
                throw new Error('Live2D expression could not start');
            this.#expressions.add(expression);
            transferred = true;
        } finally {
            if (!transferred) expression.release();
        }
    }

    clearExpression(): void {
        this.model();
        const manager = requireValue(this.#expressionManager, 'expression manager');
        this.releaseAnimations(manager, this.#expressions);
        this.#expressionManager = new this.#sdk.CubismExpressionMotionManager();
    }

    getOpacity(): number {
        const value = this.model().getModelOapcity();
        if (!Number.isFinite(value) || value < -1e-6 || value > 1 + 1e-6)
            throw new Error('Live2D model opacity is invalid');
        return Math.max(0, Math.min(1, value));
    }

    destroy(): void {
        if (this.#destroyed) return;
        this.#destroyed = true;
        const failures: unknown[] = [];
        const release = (callback: () => void): void => {
            try {
                callback();
            } catch (error: unknown) {
                failures.push(error);
            }
        };
        const motions = this.#motionManager;
        if (motions !== null)
            release(() => {
                this.releaseAnimations(motions, this.#motions);
            });
        const expressions = this.#expressionManager;
        if (expressions !== null)
            release(() => {
                this.releaseAnimations(expressions, this.#expressions);
            });
        const eyeBlink = this.#eyeBlink;
        if (eyeBlink !== null)
            release(() => {
                this.#sdk.CubismEyeBlink.delete(eyeBlink);
            });
        const physics = this.#physics;
        if (physics !== null)
            release(() => {
                this.#sdk.CubismPhysics.delete(physics);
            });
        const pose = this.#pose;
        if (pose !== null)
            release(() => {
                this.#sdk.CubismPose.delete(pose);
            });
        const model = this.#model;
        const moc = this.#moc;
        if (model !== null && moc !== null)
            release(() => {
                moc.deleteModel(model);
            });
        if (moc !== null)
            release(() => {
                moc.release();
            });
        this.#model = null;
        this.#moc = null;
        this.#source = null;
        this.#motionManager = null;
        this.#expressionManager = null;
        this.#eyeBlink = null;
        this.#physics = null;
        this.#pose = null;
        this.#data.motions.clear();
        this.#data.expressions.clear();
        this.#data.physics = null;
        this.#data.pose = null;
        this.#parameterIndices.clear();
        this.#eyeBlinkIds.length = 0;
        this.#lipSyncIds.length = 0;
        this.#lipSyncIndices.length = 0;
        if (failures.length > 0)
            throw new AggregateError(failures, 'Live2D runtime cleanup failed');
    }

    private model(): CubismModelInstance {
        if (this.#destroyed) throw new Error('Live2D runtime session is destroyed');
        return requireValue(this.#model, 'runtime model');
    }

    private parameterIndex(id: string): number {
        const index = this.#parameterIndices.get(id);
        if (index === undefined) throw new RangeError(`Unknown Live2D parameter: ${id}`);
        return index;
    }

    private validateWrite(
        id: string,
        value: number,
        weight: number,
        blend: Live2DParameterBlend
    ): void {
        this.parameterIndex(id);
        if (!Number.isFinite(value)) throw new RangeError('Live2D parameter value must be finite');
        unit(weight, 'parameter weight');
        if (!PARAMETER_BLENDS.has(blend)) throw new RangeError('Invalid Live2D parameter blend');
    }

    private writeParameter(
        id: string,
        value: number,
        weight: number,
        blend: Live2DParameterBlend
    ): void {
        const model = this.model();
        this.validateWrite(id, value, weight, blend);
        const index = this.parameterIndex(id);
        if (blend === 'overwrite') model.setParameterValueByIndex(index, value, weight);
        else if (blend === 'add') model.addParameterValueByIndex(index, value, weight);
        else model.multiplyParameterValueByIndex(index, value, weight);
    }

    private createMotion(data: MotionData): CubismMotionInstance {
        return requireValue(
            this.#sdk.CubismMotion.create(
                data.bytes,
                data.bytes.byteLength,
                undefined,
                undefined,
                true
            ),
            'parsed motion'
        );
    }

    private createExpression(bytes: ArrayBuffer): CubismExpressionInstance {
        return requireValue(
            this.#sdk.CubismExpressionMotion.create(bytes, bytes.byteLength),
            'parsed expression'
        );
    }

    private validateFades(options: Live2DExpressionOptions): void {
        if (options.fadeInSeconds !== undefined)
            nonNegative(options.fadeInSeconds, 'fadeInSeconds');
        if (options.fadeOutSeconds !== undefined)
            nonNegative(options.fadeOutSeconds, 'fadeOutSeconds');
    }

    private applyFades(
        motion: CubismExpressionInstance,
        options: Live2DExpressionOptions,
        reference?: Live2DMotionReference
    ): void {
        const fadeIn = options.fadeInSeconds ?? reference?.fadeInTime;
        const fadeOut = options.fadeOutSeconds ?? reference?.fadeOutTime;
        // A manifest value of -1 means retain the SDK/motion file's own duration.
        if (fadeIn !== undefined && fadeIn >= 0) motion.setFadeInTime(fadeIn);
        if (fadeOut !== undefined && fadeOut >= 0) motion.setFadeOutTime(fadeOut);
    }

    private releaseAnimations<T extends CubismExpressionInstance>(
        queue: CubismQueue,
        owned: Set<T>
    ): void {
        const failures: unknown[] = [];
        try {
            releaseQueue(queue);
        } catch (error: unknown) {
            failures.push(error);
        }
        for (const motion of owned) {
            try {
                motion.release();
            } catch (error: unknown) {
                failures.push(error);
            }
        }
        owned.clear();
        if (failures.length > 0)
            throw new AggregateError(failures, 'Live2D animation cleanup failed');
    }
}

/**
 * Create a CPU animation provider from an application's initialized official SDK namespace.
 * The namespace is checked before use; Framework initialization is shared through its own guards,
 * while every model, clock, motion, expression and effect belongs to one independent session.
 * SDK startup is lazy. The provider never disposes the host's global Framework or loads code.
 */
export function createCubismRuntime(namespace: unknown): Live2DRuntime {
    const sdk = requireCubismSDK(namespace);
    return {
        apiVersion: 1,
        async createModel(
            assets: Live2DAssets,
            options: Live2DRuntimeCreateOptions
        ): Promise<Live2DModelRuntime> {
            const signal = options.signal;
            signal?.throwIfAborted();
            const framework = sdk.CubismFramework;
            if (!framework.isStarted() && !framework.startUp())
                throw new Error('Live2D SDK startup failed');
            if (!framework.isInitialized()) framework.initialize();
            if (!framework.isInitialized()) throw new Error('Live2D SDK initialization failed');
            const data = await loadData(assets, signal);
            signal?.throwIfAborted();
            const moc = requireValue(sdk.CubismMoc.create(assets.moc, true), 'consistent moc3');
            let model: CubismModelInstance | null = null;
            let session: CubismSession | null = null;
            try {
                model = requireValue(moc.createModel(), 'Core model');
                session = new CubismSession(sdk, data, moc, model);
                session.initialize(assets);
                signal?.throwIfAborted();
                return session;
            } catch (error: unknown) {
                try {
                    if (session !== null) session.destroy();
                    else {
                        if (model !== null) moc.deleteModel(model);
                        moc.release();
                    }
                } catch (cleanupError: unknown) {
                    throw new AggregateError(
                        [error, cleanupError],
                        'Live2D model creation and cleanup failed',
                        { cause: cleanupError }
                    );
                }
                throw error;
            }
        }
    };
}
