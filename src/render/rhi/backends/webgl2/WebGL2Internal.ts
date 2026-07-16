import type {
    RHIDeviceOwnedDestroyable,
    RHIDeviceOwnedObject,
    RHIResource,
    RHIResourceLifetime
} from '../../core';
import type { RHIDiagnosticNativeObjectKind } from '../../RHIDiagnosticsSink';
import type { WebGL2RHIDevice } from './WebGL2Device';

const WEBGL2_OBJECT_KIND = Symbol('WebGL2ObjectKind');

export const WEBGL2_BUFFER_OBJECT_KIND = 1;
export const WEBGL2_TEXTURE_OBJECT_KIND = 2;
export const WEBGL2_TEXTURE_VIEW_OBJECT_KIND = 3;
export const WEBGL2_SAMPLER_OBJECT_KIND = 4;
export const WEBGL2_SHADER_OBJECT_KIND = 5;
export const WEBGL2_GRAPHICS_PIPELINE_OBJECT_KIND = 6;
export const WEBGL2_BIND_GROUP_OBJECT_KIND = 7;

interface WebGL2BrandedObject {
    readonly [WEBGL2_OBJECT_KIND]: number;
}

/** Exact backend brand check whose private symbol cannot be forged through the public RHI API. */
export function hasWebGL2ObjectKind(value: unknown, kind: number): boolean {
    return (
        typeof value === 'object' &&
        value !== null &&
        (value as WebGL2BrandedObject)[WEBGL2_OBJECT_KIND] === kind
    );
}

export function requireNative<T>(value: T | null, description: string): T {
    if (value === null) throw new Error(`WebGL2 failed to create ${description}`);
    return value;
}

export function webGL2ValidationError(
    code: 'invalid-descriptor' | 'invalid-state' | 'unsupported-feature' | 'unsupported-format',
    message: string,
    path: string
): Error {
    // Kept as a lazy module-free helper so native files do not create validation import cycles.
    const error = new Error(`${path}: ${message}`);
    error.name = `RHIValidationError:${code}`;
    return error;
}

export abstract class WebGL2ObjectBase implements RHIDeviceOwnedObject {
    readonly id: number;
    readonly deviceId: number;
    readonly deviceGeneration: number;
    label?: string;
    readonly [WEBGL2_OBJECT_KIND]: number;

    protected constructor(
        readonly owner: WebGL2RHIDevice,
        label = '',
        objectKind = 0
    ) {
        this.id = owner.allocateObjectId();
        this.deviceId = owner.id;
        this.deviceGeneration = owner.generationValue;
        this.label = label;
        this[WEBGL2_OBJECT_KIND] = objectKind;
    }

    assertUsable(path = 'object'): void {
        this.owner.assertObjectUsable(this, path);
    }
}

export interface WebGL2DestroyObserver {
    onWebGL2ObjectInvalidated(object: WebGL2DestroyableBase): void;
}

export abstract class WebGL2DestroyableBase
    extends WebGL2ObjectBase
    implements RHIDeviceOwnedDestroyable
{
    destroyed = false;
    #nativeKind: RHIDiagnosticNativeObjectKind | null = null;
    #destroyObservers: Set<WebGL2DestroyObserver> | null = null;

    protected constructor(owner: WebGL2RHIDevice, label = '', objectKind = 0) {
        super(owner, label, objectKind);
        owner.registerDestroyable(this);
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.notifyDestroyObservers();
        this.releaseNative(false);
        this.recordTrackedNativeObjectDestroyed();
        this.owner.unregisterDestroyable(this);
    }

    invalidateForDeviceLoss(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.notifyDestroyObservers();
        this.releaseNative(true);
        this.recordTrackedNativeObjectDestroyed();
    }

    override assertUsable(path = 'object'): void {
        super.assertUsable(path);
        if (this.destroyed) throw new Error(`${path} is destroyed`);
    }

    /** @internal Subscribe one prepared backend object to cold-path invalidation. */
    addDestroyObserver(observer: WebGL2DestroyObserver): void {
        let observers = this.#destroyObservers;
        if (observers === null) {
            observers = new Set<WebGL2DestroyObserver>();
            this.#destroyObservers = observers;
        }
        observers.add(observer);
    }

    /** @internal Remove a prepared backend object's cold-path invalidation subscription. */
    removeDestroyObserver(observer: WebGL2DestroyObserver): void {
        const observers = this.#destroyObservers;
        if (observers === null) return;
        observers.delete(observer);
        if (observers.size === 0) this.#destroyObservers = null;
    }

    /** Register the one native object whose lifetime is owned by this wrapper. */
    protected trackNativeObject(kind: RHIDiagnosticNativeObjectKind): void {
        if (this.#nativeKind !== null) {
            throw new Error(`WebGL2 object already tracks native ${this.#nativeKind}`);
        }
        this.owner.recordNativeObjectCreated(kind);
        this.#nativeKind = kind;
    }

    private recordTrackedNativeObjectDestroyed(): void {
        if (this.#nativeKind === null) return;
        this.owner.recordNativeObjectDestroyed(this.#nativeKind);
        this.#nativeKind = null;
    }

    private notifyDestroyObservers(): void {
        const observers = this.#destroyObservers;
        if (observers === null) return;
        this.#destroyObservers = null;
        for (const observer of observers) observer.onWebGL2ObjectInvalidated(this);
    }

    protected abstract releaseNative(contextLost: boolean): void;
}

export abstract class WebGL2ResourceBase extends WebGL2DestroyableBase implements RHIResource {
    readonly lifetime: RHIResourceLifetime;

    protected constructor(
        owner: WebGL2RHIDevice,
        label: string,
        lifetime: RHIResourceLifetime,
        objectKind = 0
    ) {
        super(owner, label, objectKind);
        this.lifetime = lifetime;
    }
}

export interface WebGL2NativeDestroyable {
    invalidateForDeviceLoss(): void;
}
