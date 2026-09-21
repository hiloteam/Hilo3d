import type { CubismCoreModel, CubismCoreUtils } from '../Live2DSource.js';

/** Minimal CPU-side parameter buffers required from the host's Core instance. */
export interface CubismRuntimeCoreModel extends CubismCoreModel {
    /** Core parameter metadata; no SDK identifier objects escape to addon consumers. */
    readonly parameters: {
        readonly count: number;
        readonly ids: readonly string[];
        readonly minimumValues: Float32Array;
        readonly maximumValues: Float32Array;
        readonly defaultValues: Float32Array;
    };
}

/** Structural model methods used by the CPU runtime adapter. */
export interface CubismModelInstance {
    getModel(): CubismRuntimeCoreModel;
    getCanvasWidth(): number;
    getCanvasHeight(): number;
    loadParameters(): void;
    saveParameters(): void;
    getParameterValueByIndex(index: number): number;
    setParameterValueByIndex(index: number, value: number, weight?: number): void;
    addParameterValueByIndex(index: number, value: number, weight?: number): void;
    multiplyParameterValueByIndex(index: number, value: number, weight?: number): void;
    getModelOapcity(): number;
    update(): void;
}

/** A host SDK moc owner and its model lifecycle. */
export interface CubismMocInstance {
    createModel(): CubismModelInstance | null;
    deleteModel(model: CubismModelInstance): void;
    release(): void;
}

/** SDK-owned motion allocation, transferred to one queue when played. */
export interface CubismMotionInstance {
    setFadeInTime(seconds: number): void;
    setFadeOutTime(seconds: number): void;
    setLoop(loop: boolean): void;
    setEffectIds(eyeBlinkIds: object[], lipSyncIds: object[]): void;
    release(): void;
}

/** SDK-owned expression allocation, transferred to one queue when played. */
export interface CubismExpressionInstance {
    setFadeInTime(seconds: number): void;
    setFadeOutTime(seconds: number): void;
    release(): void;
}

/** CPU animation queue lifecycle shared by the host's manager classes. */
export interface CubismQueue {
    stopAllMotions(): void;
    getCubismMotionQueueEntries(): readonly { getCubismMotion(): CubismExpressionInstance }[];
    release(): void;
}

/** Host SDK motion manager; all clock state belongs to this instance. */
export interface CubismMotionManagerInstance extends CubismQueue {
    isFinished(): boolean;
    reserveMotion(priority: number): boolean;
    setReservePriority(priority: number): void;
    startMotionPriority(
        motion: CubismMotionInstance,
        autoDelete: boolean,
        priority: number
    ): unknown;
    updateMotion(model: CubismModelInstance, deltaSeconds: number): boolean;
}

/** Host SDK expression manager; all clock state belongs to this instance. */
export interface CubismExpressionManagerInstance extends CubismQueue {
    startMotion(expression: CubismExpressionInstance, autoDelete: boolean): unknown;
    updateMotion(model: CubismModelInstance, deltaSeconds: number): boolean;
}

/** Parameter effect evaluated by the host SDK. */
export interface CubismParameterEffect {
    updateParameters(model: CubismModelInstance, deltaSeconds: number): void;
}

/** Host SDK automatic blink effect. */
export interface CubismEyeBlinkInstance extends CubismParameterEffect {
    setParameterIds(ids: object[]): void;
}

/** Host SDK physics simulation. */
export interface CubismPhysicsInstance {
    evaluate(model: CubismModelInstance, deltaSeconds: number): void;
}

/**
 * CPU-only host SDK dependencies. The provider assembles these official classes; the addon never
 * loads SDK executable code or reaches into a browser global. This structural view is internal to
 * the adapter and deliberately omits renderer and application-controller classes.
 */
export interface CubismSDK {
    readonly Core: { readonly Utils: CubismCoreUtils };
    readonly CubismFramework: {
        isStarted(): boolean;
        startUp(): boolean;
        isInitialized(): boolean;
        initialize(): void;
        getIdManager(): { getId(id: string): object };
    };
    readonly CubismMoc: {
        create(bytes: ArrayBuffer, checkConsistency: boolean): CubismMocInstance | null;
    };
    readonly CubismMotionManager: new () => CubismMotionManagerInstance;
    readonly CubismExpressionMotionManager: new () => CubismExpressionManagerInstance;
    readonly CubismModelMatrix: new (
        width: number,
        height: number
    ) => {
        loadIdentity(): void;
        setupFromLayout(layout: Map<string, number>): void;
        transformX(value: number): number;
        transformY(value: number): number;
    };
    readonly CubismMotion: {
        create(
            bytes: ArrayBuffer,
            size: number,
            finished?: undefined,
            began?: undefined,
            checkConsistency?: boolean
        ): CubismMotionInstance | null;
    };
    readonly CubismExpressionMotion: {
        create(bytes: ArrayBuffer, size: number): CubismExpressionInstance | null;
    };
    readonly CubismEyeBlink: {
        create(): CubismEyeBlinkInstance | null;
        delete(effect: CubismEyeBlinkInstance): void;
    };
    readonly CubismPhysics: {
        create(bytes: ArrayBuffer, size: number): CubismPhysicsInstance | null;
        delete(effect: CubismPhysicsInstance): void;
    };
    readonly CubismPose: {
        create(bytes: ArrayBuffer, size: number): CubismParameterEffect | null;
        delete(effect: CubismParameterEffect): void;
    };
}

function object(value: unknown, name: string): object {
    if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
        throw new TypeError(`Live2D SDK ${name} is missing`);
    }
    return value;
}

/** Validate the provider namespace before narrowing it to the adapter's structural contract. */
export function requireCubismSDK(value: unknown): CubismSDK {
    const sdk = object(value, 'namespace');
    const requireMethods = (owner: object, path: string, names: readonly string[]): void => {
        for (const name of names) {
            if (typeof Reflect.get(owner, name) !== 'function') {
                throw new TypeError(`Live2D SDK ${path}.${name} must be a function`);
            }
        }
    };
    const core = object(Reflect.get(sdk, 'Core'), 'Core');
    requireMethods(object(Reflect.get(core, 'Utils'), 'Core.Utils'), 'Core.Utils', [
        'hasBlendAdditiveBit',
        'hasBlendMultiplicativeBit',
        'hasIsDoubleSidedBit',
        'hasIsInvertedMaskBit',
        'hasIsVisibleBit'
    ]);
    requireMethods(
        object(Reflect.get(sdk, 'CubismFramework'), 'CubismFramework'),
        'CubismFramework',
        ['isStarted', 'startUp', 'isInitialized', 'initialize', 'getIdManager']
    );
    for (const name of ['CubismMoc', 'CubismMotion', 'CubismExpressionMotion']) {
        requireMethods(object(Reflect.get(sdk, name), name), name, ['create']);
    }
    for (const name of ['CubismEyeBlink', 'CubismPhysics', 'CubismPose']) {
        requireMethods(object(Reflect.get(sdk, name), name), name, ['create', 'delete']);
    }
    requireMethods(sdk, 'namespace', [
        'CubismMotionManager',
        'CubismExpressionMotionManager',
        'CubismModelMatrix'
    ]);
    return sdk as CubismSDK;
}
