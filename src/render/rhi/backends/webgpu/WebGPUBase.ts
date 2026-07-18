import type {
    RHIDeviceOwnedDestroyable,
    RHIDeviceOwnedObject,
    RHIResource,
    RHIResourceLifetime
} from '../../core/RHIResources';
import { RHIValidationError, assertRHIObjectOwnedBy } from '../../core/RHIValidation';
import type { WebGPUDevice } from './WebGPUDevice';
import type { RHIDiagnosticNativeObjectKind } from '../../RHIDiagnosticsSink';

export type WebGPUNativeLifetimeDiagnostics = 'complete' | 'creation-only';

/** @internal Direct backend state used by command validation without invoking a hot getter. */
export const WEBGPU_DESTROYED_STATE: unique symbol = Symbol('WebGPU.destroyed');

/** Backend-private owner contract used without exposing native handles through the portable core. */
export interface WebGPUObjectOwner {
    readonly id: number;
    readonly generation: number;
    readonly destroyed: boolean;
    allocateObjectId(): number;
    registerDestroyable(object: WebGPUDestroyableObject): void;
    unregisterDestroyable(object: WebGPUDestroyableObject): void;
    recordNativeObjectCreated(
        kind: RHIDiagnosticNativeObjectKind,
        lifetime: WebGPUNativeLifetimeDiagnostics
    ): void;
    recordNativeObjectDestroyed(kind: RHIDiagnosticNativeObjectKind): void;
}

export abstract class WebGPUObject implements RHIDeviceOwnedObject {
    readonly id: number;
    readonly deviceId: number;
    readonly deviceGeneration: number;
    label: string;

    protected constructor(
        readonly owner: WebGPUDevice,
        label = ''
    ) {
        this.id = owner.allocateObjectId();
        this.deviceId = owner.id;
        this.deviceGeneration = owner.generation;
        this.label = label;
    }
}

/**
 * Logical destruction is immediate. Native destruction is delayed while an encoded/submitted
 * frame retains the object, which is the lifetime rule promised by the portable RHI.
 */
export abstract class WebGPUDestroyableObject
    extends WebGPUObject
    implements RHIDeviceOwnedDestroyable
{
    [WEBGPU_DESTROYED_STATE] = false;
    #nativeReleased = false;
    #retainCount = 0;
    #lastRetainedFrameId = 0;
    readonly #nativeKind: RHIDiagnosticNativeObjectKind | null;
    readonly #nativeLifetime: WebGPUNativeLifetimeDiagnostics | null;

    protected constructor(
        owner: WebGPUDevice,
        label = '',
        nativeKind: RHIDiagnosticNativeObjectKind | null = null,
        nativeLifetime: WebGPUNativeLifetimeDiagnostics | null = null
    ) {
        super(owner, label);
        if ((nativeKind === null) !== (nativeLifetime === null)) {
            throw new TypeError('Native diagnostics kind and lifetime must be supplied together');
        }
        this.#nativeKind = nativeKind;
        this.#nativeLifetime = nativeLifetime;
        owner.registerDestroyable(this);
        if (nativeKind !== null && nativeLifetime !== null) {
            owner.recordNativeObjectCreated(nativeKind, nativeLifetime);
        }
    }

    get destroyed(): boolean {
        return this[WEBGPU_DESTROYED_STATE];
    }

    /** Exposed for backend contract tests and diagnostics only. */
    get nativeReleased(): boolean {
        return this.#nativeReleased;
    }

    destroy(): void {
        if (this[WEBGPU_DESTROYED_STATE]) return;
        this[WEBGPU_DESTROYED_STATE] = true;
        this.owner.unregisterDestroyable(this);
        this.releaseNativeIfUnused();
    }

    /** @internal */
    retainForFrame(frameId: number): boolean {
        if (this.#nativeReleased) {
            throw new RHIValidationError(
                'destroyed-object',
                'native allocation has already been released',
                'object'
            );
        }
        if (this.#lastRetainedFrameId === frameId) return false;
        this.#lastRetainedFrameId = frameId;
        this.#retainCount += 1;
        return true;
    }

    /** @internal */
    releaseFromFrame(): void {
        if (this.#retainCount <= 0) {
            throw new Error(`WebGPU object ${String(this.id)} has no frame retention`);
        }
        this.#retainCount -= 1;
        this.releaseNativeIfUnused();
    }

    /** @internal */
    invalidateGeneration(): void {
        this.releaseNativeIfUnused();
    }

    /** Native objects without an explicit destroy operation use the default no-op. */
    protected releaseNative(): void {
        return;
    }

    private releaseNativeIfUnused(): void {
        if (
            this.#nativeReleased ||
            this.#retainCount !== 0 ||
            (!this[WEBGPU_DESTROYED_STATE] && this.deviceGeneration === this.owner.generation)
        ) {
            return;
        }
        this.#nativeReleased = true;
        this.releaseNative();
        if (this.#nativeKind !== null && this.#nativeLifetime === 'complete') {
            this.owner.recordNativeObjectDestroyed(this.#nativeKind);
        }
    }
}

export abstract class WebGPUResource<D extends object>
    extends WebGPUDestroyableObject
    implements RHIResource
{
    abstract readonly descriptor: Readonly<D>;
    readonly lifetime: RHIResourceLifetime;

    protected constructor(
        owner: WebGPUDevice,
        label: string,
        lifetime: RHIResourceLifetime,
        nativeKind: RHIDiagnosticNativeObjectKind | null = null,
        nativeLifetime: WebGPUNativeLifetimeDiagnostics | null = null
    ) {
        super(owner, label, nativeKind, nativeLifetime);
        this.lifetime = lifetime;
    }
}

/** Reject foreign wrappers even if a malformed implementation reuses a numeric identity. */
export function assertWebGPUObject<T extends WebGPUObject>(
    device: WebGPUDevice,
    object: RHIDeviceOwnedObject,
    constructor: abstract new (...parameters: never[]) => T,
    path: string
): asserts object is T {
    assertRHIObjectOwnedBy(device, object, path);
    if (!(object instanceof constructor) || object.owner !== device) {
        throw new RHIValidationError('wrong-device', 'is not a WebGPU backend object', path);
    }
}

export function assertPositiveSafeInteger(value: number, path: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RHIValidationError('invalid-descriptor', 'must be a positive safe integer', path);
    }
}

export function assertNonNegativeSafeInteger(value: number, path: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RHIValidationError(
            'invalid-descriptor',
            'must be a non-negative safe integer',
            path
        );
    }
}

export function assertBufferRange(
    size: number,
    offset: number,
    rangeSize: number,
    path: string,
    offsetPath: string,
    sizePath: string
): void {
    assertNonNegativeSafeInteger(offset, offsetPath);
    assertPositiveSafeInteger(rangeSize, sizePath);
    if (offset > size || rangeSize > size - offset) {
        throw new RHIValidationError('out-of-bounds', 'range exceeds buffer size', path);
    }
}

export interface WebGPUDeferred<T> {
    readonly promise: Promise<T>;
    resolve(value: T | PromiseLike<T>): void;
    reject(reason?: unknown): void;
}

export function createWebGPUDeferred<T>(): WebGPUDeferred<T> {
    let resolvePromise: ((value: T | PromiseLike<T>) => void) | undefined;
    let rejectPromise: ((reason?: unknown) => void) | undefined;
    const promise = new Promise<T>((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
    });
    return {
        promise,
        resolve: value => resolvePromise?.(value),
        reject: reason => rejectPromise?.(reason)
    };
}
