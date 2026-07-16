import type {
    RHIBackend,
    RHIBuffer,
    RHIBufferDescriptor,
    RHIBindGroup,
    RHIBindGroupDescriptor,
    RHICapabilities,
    RHIDevice,
    RHIDeviceOwnedDestroyable,
    RHISampler,
    RHISamplerDescriptor,
    RHITexture,
    RHITextureDescriptor
} from '../rhi/core';
import { assertRHIObjectOwnedBy, snapshotRHIDataSource } from '../rhi/core/RHIValidation';

export type ResourceRegistryState = 'active' | 'recovering' | 'recovery-failed' | 'destroyed';

let nextRegistryId = 1;

function allocateRegistryId(): number {
    if (nextRegistryId === Number.MAX_SAFE_INTEGER) {
        throw new RangeError('Resource registry identity space is exhausted');
    }
    return nextRegistryId++;
}

function requireFrameIndex(frameIndex: number): void {
    if (!Number.isSafeInteger(frameIndex) || frameIndex < 0) {
        throw new RangeError('Resource frame index must be a non-negative safe integer');
    }
}

function resourceCleanupError(reason: unknown): Error {
    return reason instanceof Error
        ? reason
        : new Error(`RHI resource cleanup failed: ${String(reason)}`);
}

export class RendererRecoveringError extends Error {
    constructor(message = 'Renderer resources are recovering') {
        super(message);
        this.name = 'RendererRecoveringError';
    }
}

export class ResourceRegistryHandle<T extends RHIDeviceOwnedDestroyable> {
    /** @internal */
    constructor(
        readonly id: number,
        readonly registryId: number,
        readonly label: string
    ) {}

    /** Type-only covariance marker; it has no runtime/native value. */
    declare readonly resourceType: T;
}

export type ResourceRegistryResolver = <T extends RHIDeviceOwnedDestroyable>(
    handle: ResourceRegistryHandle<T>
) => T;

export interface ResourceRegistryRecipe<T extends RHIDeviceOwnedDestroyable> {
    readonly label?: string;
    readonly dependencies?: readonly ResourceRegistryHandle<RHIDeviceOwnedDestroyable>[];
    create(device: RHIDevice, resolve: ResourceRegistryResolver): T;
}

interface ResourceRegistryEntry<T extends RHIDeviceOwnedDestroyable> {
    readonly handle: ResourceRegistryHandle<T>;
    readonly recipe: ResourceRegistryRecipe<T>;
    readonly dependencies: readonly ResourceRegistryHandle<RHIDeviceOwnedDestroyable>[];
    resource: T;
    referenceCount: number;
    lastUsedFrame: number;
    everMarkedUsed: boolean;
}

export interface ResourceRegistryDiagnostics {
    readonly state: ResourceRegistryState;
    readonly registryGeneration: number;
    readonly trackedResourceCount: number;
    readonly pendingReleaseCount: number;
}

/**
 * Owns logical renderer resources above the RHI. Recipes retain descriptors/source data and rebuild
 * stable logical handles against a replacement device; native handles never cross this boundary.
 */
export class ResourceRegistry {
    readonly id = allocateRegistryId();
    readonly #entries = new Map<number, ResourceRegistryEntry<RHIDeviceOwnedDestroyable>>();
    #device: RHIDevice;
    #deviceGeneration: number;
    #state: ResourceRegistryState = 'active';
    #registryGeneration = 1;
    #nextHandleId = 1;

    constructor(device: RHIDevice) {
        if (device.destroyed)
            throw new Error('Cannot create a resource registry for a destroyed device');
        this.#device = device;
        this.#deviceGeneration = device.generation;
    }

    get state(): ResourceRegistryState {
        return this.#state;
    }

    get generation(): number {
        return this.#registryGeneration;
    }

    get deviceBackend(): RHIBackend {
        return this.#device.backend;
    }

    get deviceGeneration(): number {
        return this.#deviceGeneration;
    }

    get deviceCapabilities(): RHICapabilities {
        return this.#device.capabilities;
    }

    get deviceId(): number {
        return this.#device.id;
    }

    register<T extends RHIDeviceOwnedDestroyable>(
        recipe: ResourceRegistryRecipe<T>
    ): ResourceRegistryHandle<T> {
        this.assertActive();
        const dependencies = Object.freeze([...(recipe.dependencies ?? [])]);
        for (const dependency of dependencies) {
            const dependencyEntry = this.requireEntry(dependency);
            if (dependencyEntry.referenceCount === Number.MAX_SAFE_INTEGER) {
                throw new RangeError('Resource registry reference count is exhausted');
            }
        }
        const id = this.allocateHandleId();
        const handle = new ResourceRegistryHandle<T>(id, this.id, recipe.label ?? '');
        const resource = recipe.create(this.#device, dependency => this.resolve(dependency));
        try {
            assertRHIObjectOwnedBy(this.#device, resource, `registry resource ${handle.label}`);
        } catch (error) {
            resource.destroy();
            throw error;
        }
        const frozenRecipe = Object.freeze({ ...recipe, dependencies });
        const entry: ResourceRegistryEntry<T> = {
            handle,
            recipe: frozenRecipe,
            dependencies,
            resource,
            referenceCount: 1,
            lastUsedFrame: 0,
            everMarkedUsed: false
        };
        this.#entries.set(id, entry);
        for (const dependency of dependencies) this.requireEntry(dependency).referenceCount++;
        return handle;
    }

    registerBuffer(descriptor: RHIBufferDescriptor): ResourceRegistryHandle<RHIBuffer> {
        const initialData =
            descriptor.initialData === undefined
                ? undefined
                : snapshotRHIDataSource(descriptor.initialData);
        const snapshot = Object.freeze({
            ...descriptor,
            ...(initialData === undefined ? {} : { initialData })
        });
        return this.register({
            ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
            create: device => device.createBuffer(snapshot)
        });
    }

    registerTexture(descriptor: RHITextureDescriptor): ResourceRegistryHandle<RHITexture> {
        const snapshot = Object.freeze({
            ...descriptor,
            size: Object.freeze({ ...descriptor.size }),
            ...(descriptor.viewFormats === undefined
                ? {}
                : { viewFormats: Object.freeze([...descriptor.viewFormats]) })
        });
        return this.register({
            ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
            create: device => device.createTexture(snapshot)
        });
    }

    registerSampler(descriptor: RHISamplerDescriptor = {}): ResourceRegistryHandle<RHISampler> {
        const snapshot = Object.freeze({ ...descriptor });
        return this.register({
            ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
            create: device => device.createSampler(snapshot)
        });
    }

    /** @internal Create one submission-fenced resource that deliberately has no recovery recipe. */
    createFrameBindGroup(descriptor: RHIBindGroupDescriptor): RHIBindGroup {
        this.assertActive();
        if (descriptor.lifetime !== 'frame') {
            throw new Error('Frame bind groups require frame resource lifetime');
        }
        return this.#device.createBindGroup(descriptor);
    }

    resolve<T extends RHIDeviceOwnedDestroyable>(handle: ResourceRegistryHandle<T>): T {
        this.assertActive();
        return this.requireEntry(handle).resource;
    }

    retain(handle: ResourceRegistryHandle<RHIDeviceOwnedDestroyable>): void {
        this.assertActive();
        const entry = this.requireEntry(handle);
        if (entry.referenceCount === Number.MAX_SAFE_INTEGER) {
            throw new RangeError('Resource registry reference count is exhausted');
        }
        entry.referenceCount++;
    }

    release(handle: ResourceRegistryHandle<RHIDeviceOwnedDestroyable>): void {
        this.assertNotDestroyed();
        const entry = this.requireEntry(handle);
        if (entry.referenceCount === 0)
            throw new Error('Resource registry handle is already released');
        entry.referenceCount--;
    }

    /**
     * Close the logical-resource gate as soon as device loss is observed. Replacement provisioning
     * may be asynchronous, so recovery cannot wait until recipes are ready before blocking builds.
     */
    beginRecovery(): void {
        if (this.#state === 'recovering') return;
        if (this.#state === 'recovery-failed') throw new RendererRecoveringError();
        if (this.#state === 'destroyed') throw new Error('Resource registry is destroyed');
        this.#state = 'recovering';
    }

    /** Keep every logical handle fail-closed after provisioning or synchronization fails. */
    failRecovery(): void {
        if (this.#state === 'destroyed' || this.#state === 'recovery-failed') return;
        this.#state = 'recovery-failed';
    }

    /**
     * Roll back one newly registered resource before it can become visible to a submission.
     * Unlike `collect`, this removes only the supplied handle and never retires dependencies.
     */
    discardUnsubmitted(handle: ResourceRegistryHandle<RHIDeviceOwnedDestroyable>): void {
        this.assertNotDestroyed();
        const entry = this.requireEntry(handle);
        if (entry.referenceCount !== 1 || entry.everMarkedUsed) {
            throw new Error('Only an exclusively owned, unsubmitted resource can be discarded');
        }
        this.#entries.delete(entry.handle.id);
        try {
            entry.resource.destroy();
        } finally {
            for (const dependency of entry.dependencies) {
                const dependencyEntry = this.requireEntry(dependency);
                dependencyEntry.referenceCount--;
            }
        }
    }

    markUsed(handle: ResourceRegistryHandle<RHIDeviceOwnedDestroyable>, frameIndex: number): void {
        this.assertActive();
        requireFrameIndex(frameIndex);
        const entry = this.requireEntry(handle);
        if (entry.referenceCount === 0) {
            throw new Error('Cannot mark a released resource as used');
        }
        entry.everMarkedUsed = true;
        if (frameIndex > entry.lastUsedFrame) entry.lastUsedFrame = frameIndex;
    }

    /** Destroy zero-reference resources whose last submitted frame has completed. */
    collect(completedFrame: number): number {
        this.assertActive();
        requireFrameIndex(completedFrame);
        const retired: ResourceRegistryEntry<RHIDeviceOwnedDestroyable>[] = [];
        for (const entry of this.#entries.values()) {
            if (entry.referenceCount === 0 && entry.lastUsedFrame <= completedFrame) {
                retired.push(entry);
            }
        }
        let count = 0;
        for (const entry of retired) count += this.retire(entry, completedFrame);
        return count;
    }

    /** Rebuild all live recipes in dependency/registration order against a replacement device. */
    recover(device: RHIDevice): void {
        if (this.#state === 'destroyed') throw new Error('Resource registry is destroyed');
        if (device.destroyed) throw new Error('Cannot recover with a destroyed RHI device');
        if (this.#registryGeneration === Number.MAX_SAFE_INTEGER) {
            throw new RangeError('Resource registry generation space is exhausted');
        }
        this.#state = 'recovering';
        if (device.backend !== this.#device.backend) {
            this.#state = 'recovery-failed';
            throw new TypeError('Resource registry recovery requires the same RHI backend');
        }
        const replacements = new Map<number, RHIDeviceOwnedDestroyable>();
        const resolver: ResourceRegistryResolver = <T extends RHIDeviceOwnedDestroyable>(
            handle: ResourceRegistryHandle<T>
        ): T => {
            const entry = this.requireEntryDuringRecovery(handle);
            const replacement = replacements.get(entry.handle.id);
            if (!replacement) {
                throw new Error(`Resource dependency ${entry.handle.label} has not been rebuilt`);
            }
            return replacement as T;
        };
        try {
            for (const entry of this.#entries.values()) {
                const replacement = entry.recipe.create(device, resolver);
                try {
                    assertRHIObjectOwnedBy(
                        device,
                        replacement,
                        `registry resource ${entry.handle.label}`
                    );
                } catch (error) {
                    replacement.destroy();
                    throw error;
                }
                replacements.set(entry.handle.id, replacement);
            }
        } catch (error) {
            for (const replacement of replacements.values()) {
                try {
                    replacement.destroy();
                } catch {
                    // Cleanup failure must not replace the reconstruction failure.
                }
            }
            this.#state = 'recovery-failed';
            throw error;
        }
        const oldResources: RHIDeviceOwnedDestroyable[] = [];
        for (const entry of this.#entries.values()) {
            const replacement = replacements.get(entry.handle.id);
            if (!replacement) throw new Error('Resource recovery result is incomplete');
            oldResources.push(entry.resource);
            entry.resource = replacement;
        }
        this.#device = device;
        this.#deviceGeneration = device.generation;
        this.#registryGeneration++;
        this.#state = 'active';
        for (const resource of oldResources) {
            try {
                resource.destroy();
            } catch {
                // The replacement set is already adopted atomically. A stale native cleanup
                // failure must not make valid rebuilt logical handles appear unusable.
            }
        }
    }

    diagnostics(): ResourceRegistryDiagnostics {
        let pendingReleaseCount = 0;
        for (const entry of this.#entries.values()) {
            if (entry.referenceCount === 0) pendingReleaseCount++;
        }
        return Object.freeze({
            state: this.#state,
            registryGeneration: this.#registryGeneration,
            trackedResourceCount: this.#entries.size,
            pendingReleaseCount
        });
    }

    destroy(): void {
        if (this.#state === 'destroyed') return;
        this.#state = 'destroyed';
        let firstFailure: Error | null = null;
        for (const entry of this.#entries.values()) {
            try {
                entry.resource.destroy();
            } catch (error) {
                firstFailure ??= resourceCleanupError(error);
            }
        }
        this.#entries.clear();
        if (firstFailure !== null) throw firstFailure;
    }

    private retire(
        entry: ResourceRegistryEntry<RHIDeviceOwnedDestroyable>,
        completedFrame: number
    ): number {
        if (!this.#entries.delete(entry.handle.id)) return 0;
        let firstFailure: Error | null = null;
        try {
            entry.resource.destroy();
        } catch (error) {
            firstFailure = resourceCleanupError(error);
        }
        let count = 1;
        for (const dependency of entry.dependencies) {
            const dependencyEntry = this.#entries.get(dependency.id);
            if (!dependencyEntry) continue;
            dependencyEntry.referenceCount--;
            if (entry.lastUsedFrame > dependencyEntry.lastUsedFrame) {
                dependencyEntry.lastUsedFrame = entry.lastUsedFrame;
            }
            if (
                dependencyEntry.referenceCount === 0 &&
                dependencyEntry.lastUsedFrame <= completedFrame
            ) {
                try {
                    count += this.retire(dependencyEntry, completedFrame);
                } catch (error) {
                    firstFailure ??= resourceCleanupError(error);
                }
            }
        }
        if (firstFailure !== null) throw firstFailure;
        return count;
    }

    private requireEntry<T extends RHIDeviceOwnedDestroyable>(
        handle: ResourceRegistryHandle<T>
    ): ResourceRegistryEntry<T> {
        if (handle.registryId !== this.id)
            throw new Error('Resource handle belongs to another registry');
        const entry = this.#entries.get(handle.id);
        if (entry?.handle !== handle) throw new Error('Resource handle is stale or released');
        return entry as ResourceRegistryEntry<T>;
    }

    private requireEntryDuringRecovery<T extends RHIDeviceOwnedDestroyable>(
        handle: ResourceRegistryHandle<T>
    ): ResourceRegistryEntry<T> {
        if (handle.registryId !== this.id)
            throw new Error('Resource handle belongs to another registry');
        const entry = this.#entries.get(handle.id);
        if (entry?.handle !== handle) throw new Error('Resource handle is stale or released');
        return entry as ResourceRegistryEntry<T>;
    }

    private allocateHandleId(): number {
        if (this.#nextHandleId === Number.MAX_SAFE_INTEGER) {
            throw new RangeError('Resource registry handle identity space is exhausted');
        }
        return this.#nextHandleId++;
    }

    private assertActive(): void {
        if (
            this.#state === 'active' &&
            (this.#device.destroyed || this.#device.generation !== this.#deviceGeneration)
        ) {
            this.#state = 'recovering';
        }
        if (this.#state === 'recovering' || this.#state === 'recovery-failed') {
            throw new RendererRecoveringError();
        }
        if (this.#state === 'destroyed') throw new Error('Resource registry is destroyed');
    }

    private assertNotDestroyed(): void {
        if (this.#state === 'destroyed') throw new Error('Resource registry is destroyed');
    }
}
