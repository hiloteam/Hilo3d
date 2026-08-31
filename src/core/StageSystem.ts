import type Stage from './Stage';

/** Stage System ABI implemented by this Hilo3D release. */
export const STAGE_SYSTEM_API_VERSION = 1 as const;

/** Typed identity used by systems to publish services without string-key collisions. */
export class StageSystemService<T> {
    /** Human-readable token name used in diagnostics. */
    readonly name: string;
    declare private readonly serviceType: T;

    constructor(name: string) {
        if (name.trim().length === 0) {
            throw new TypeError('Stage System service names cannot be empty.');
        }
        this.name = name;
    }
}

/** Create a typed service identity shared by a provider and its consumers. */
export function createStageSystemService<T>(name: string): StageSystemService<T> {
    return new StageSystemService<T>(name);
}

/** Immutable metadata compiled before System setup begins. */
export interface StageSystemDescriptor {
    /** Stable, package-qualified System identity. */
    readonly id: string;
    /** System implementation version for diagnostics. */
    readonly version: string;
    /** Exact Hilo3D Stage System ABI expected by this System. */
    readonly apiVersion: typeof STAGE_SYSTEM_API_VERSION;
    /** System identities that must be present, initialized first, and destroyed last. */
    readonly requires?: readonly string[];
    /** Optional System identities that this System runs before when they are present. */
    readonly before?: readonly string[];
    /** Optional System identities that this System runs after when they are present. */
    readonly after?: readonly string[];
    /** Complete set of typed services published during setup. */
    readonly provides?: readonly StageSystemService<unknown>[];
}

/** Context available only while a System factory is being initialized. */
export interface StageSystemSetupContext {
    /** Stage that owns this System runtime. */
    readonly stage: Stage;
    /** Publish one descriptor-declared service. */
    provide<T>(service: StageSystemService<T>, value: T): void;
    /** Read a required service published by an initialized dependency. */
    get<T>(service: StageSystemService<T>): T;
    /** Read an optional service published by an initialized dependency. */
    getOptional<T>(service: StageSystemService<T>): T | undefined;
}

/** Synchronous phase hooks owned by one initialized Stage System. */
export interface StageSystemRuntime {
    /** Run before scene-node updates for a frame. */
    beforeUpdate?(deltaTimeMilliseconds: number): void;
    /** Run after scene-node updates for a frame. */
    afterUpdate?(deltaTimeMilliseconds: number): void;
    /** Run immediately before rendering a frame. */
    beforeRender?(): void;
    /** Run after each render attempt, including a failed render. */
    afterRender?(): void;
    /** Release resources owned by this runtime. */
    destroy?(): void;
}

/** Reusable factory. Each Stage receives a distinct runtime from `setup()`. */
export interface StageSystem {
    /** Versioned identity, ordering, dependency, and service metadata. */
    readonly descriptor: StageSystemDescriptor;
    /** Create a fresh runtime for one Stage. */
    setup(context: StageSystemSetupContext): StageSystemRuntime | Promise<StageSystemRuntime>;
}

interface ResolvedStageSystemDescriptor {
    readonly id: string;
    readonly version: string;
    readonly apiVersion: typeof STAGE_SYSTEM_API_VERSION;
    readonly requires: readonly string[];
    readonly before: readonly string[];
    readonly after: readonly string[];
    readonly provides: readonly StageSystemService<unknown>[];
}

interface ResolvedStageSystem {
    readonly system: StageSystem;
    readonly descriptor: ResolvedStageSystemDescriptor;
}

interface InstalledStageSystem extends ResolvedStageSystem {
    readonly runtime: StageSystemRuntime;
    readonly beforeUpdate: ((deltaTimeMilliseconds: number) => void) | undefined;
    readonly afterUpdate: ((deltaTimeMilliseconds: number) => void) | undefined;
    readonly beforeRender: (() => void) | undefined;
    readonly afterRender: (() => void) | undefined;
    readonly destroy: (() => void) | undefined;
}

function readRuntimeProperty(value: object, key: PropertyKey): unknown {
    return Reflect.get(value, key);
}

function readHook(
    runtime: object,
    systemId: string,
    hook: 'beforeUpdate' | 'afterUpdate'
): ((deltaTimeMilliseconds: number) => void) | undefined;
function readHook(
    runtime: object,
    systemId: string,
    hook: 'beforeRender' | 'afterRender' | 'destroy'
): (() => void) | undefined;
function readHook(
    runtime: object,
    systemId: string,
    hook: string
): ((...arguments_: never[]) => unknown) | undefined {
    const callback = readRuntimeProperty(runtime, hook);
    if (callback !== undefined && typeof callback !== 'function') {
        throw new TypeError(`Stage System ${systemId} runtime hook ${hook} must be a function.`);
    }
    return callback === undefined
        ? undefined
        : (callback.bind(runtime) as (...arguments_: never[]) => unknown);
}

function validateSystemRuntime(
    value: unknown,
    systemId: string
): Omit<InstalledStageSystem, keyof ResolvedStageSystem> {
    if (typeof value !== 'object' || value === null) {
        throw new TypeError(`Stage System ${systemId} returned no runtime.`);
    }
    return {
        runtime: value,
        beforeUpdate: readHook(value, systemId, 'beforeUpdate'),
        afterUpdate: readHook(value, systemId, 'afterUpdate'),
        beforeRender: readHook(value, systemId, 'beforeRender'),
        afterRender: readHook(value, systemId, 'afterRender'),
        destroy: readHook(value, systemId, 'destroy')
    };
}

function cleanupRuntimeCandidate(value: unknown, systemId: string): void {
    if (typeof value !== 'object' || value === null) return;
    const destroy = readRuntimeProperty(value, 'destroy');
    if (typeof destroy === 'function') destroy.call(value);
    else if (destroy !== undefined) {
        throw new TypeError(`Stage System ${systemId} runtime hook destroy must be a function.`);
    }
}

function snapshotStringList(
    descriptor: StageSystemDescriptor,
    key: 'requires' | 'before' | 'after'
): readonly string[] {
    const values = descriptor[key] ?? [];
    if (new Set(values).size !== values.length) {
        throw new TypeError(`Stage System ${descriptor.id} declares duplicate ${key} entries.`);
    }
    for (const value of values) {
        if (value.trim().length === 0) {
            throw new TypeError(`Stage System ${descriptor.id} declares an empty ${key} identity.`);
        }
        if (value === descriptor.id) {
            throw new TypeError(
                `Stage System ${descriptor.id} cannot order itself through ${key}.`
            );
        }
    }
    return Object.freeze([...values]);
}

function snapshotSystem(system: StageSystem): ResolvedStageSystem {
    const descriptor = system.descriptor;
    if (descriptor.id.trim().length === 0) {
        throw new TypeError('Stage System ids cannot be empty.');
    }
    if (descriptor.version.trim().length === 0) {
        throw new TypeError(`Stage System ${descriptor.id} must declare a version.`);
    }
    if (readRuntimeProperty(descriptor, 'apiVersion') !== STAGE_SYSTEM_API_VERSION) {
        throw new TypeError(
            `Stage System ${descriptor.id} targets API ${String(descriptor.apiVersion)}; Hilo3D requires ${String(STAGE_SYSTEM_API_VERSION)}.`
        );
    }
    const provides = descriptor.provides ?? [];
    if (new Set(provides).size !== provides.length) {
        throw new TypeError(`Stage System ${descriptor.id} declares duplicate provided services.`);
    }
    for (const service of provides) {
        if (!(service instanceof StageSystemService)) {
            throw new TypeError(`Stage System ${descriptor.id} declares an invalid service token.`);
        }
    }
    return {
        system,
        descriptor: Object.freeze({
            id: descriptor.id,
            version: descriptor.version,
            apiVersion: STAGE_SYSTEM_API_VERSION,
            requires: snapshotStringList(descriptor, 'requires'),
            before: snapshotStringList(descriptor, 'before'),
            after: snapshotStringList(descriptor, 'after'),
            provides: Object.freeze([...provides])
        })
    };
}

function resolveSystemOrder(systems: readonly ResolvedStageSystem[]): ResolvedStageSystem[] {
    const systemsById = new Map<string, ResolvedStageSystem>();
    const predecessors = new Map<string, ResolvedStageSystem[]>();
    for (const system of systems) {
        const { id } = system.descriptor;
        if (systemsById.has(id)) throw new TypeError(`Duplicate Stage System ${id}.`);
        systemsById.set(id, system);
        predecessors.set(id, []);
    }
    for (const system of systems) {
        const { descriptor } = system;
        for (const dependency of descriptor.requires) {
            const predecessor = systemsById.get(dependency);
            if (!predecessor) {
                throw new TypeError(
                    `Stage System ${descriptor.id} requires missing System ${dependency}.`
                );
            }
            predecessors.get(descriptor.id)?.push(predecessor);
        }
        for (const target of descriptor.after) {
            const predecessor = systemsById.get(target);
            if (predecessor) predecessors.get(descriptor.id)?.push(predecessor);
        }
        for (const target of descriptor.before) {
            const successor = systemsById.get(target);
            if (successor) predecessors.get(target)?.push(system);
        }
    }

    const sorted: ResolvedStageSystem[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (system: ResolvedStageSystem): void => {
        const { id } = system.descriptor;
        if (visited.has(id)) return;
        if (visiting.has(id)) {
            throw new TypeError(`Stage System ordering cycle includes ${id}.`);
        }
        visiting.add(id);
        for (const predecessor of predecessors.get(id) ?? []) visit(predecessor);
        visiting.delete(id);
        visited.add(id);
        sorted.push(system);
    };
    for (const system of systems) visit(system);
    return sorted;
}

function validateServiceProviders(systems: readonly ResolvedStageSystem[]): void {
    const providers = new Map<StageSystemService<unknown>, string>();
    for (const system of systems) {
        for (const service of system.descriptor.provides) {
            const provider = providers.get(service);
            if (provider !== undefined) {
                throw new TypeError(
                    `Stage System service ${service.name} is provided by both ${provider} and ${system.descriptor.id}.`
                );
            }
            providers.set(service, system.descriptor.id);
        }
    }
}

/**
 * Per-Stage System scheduler and service registry. Ordering is compiled only when the installed set
 * changes; frame dispatch walks flat phase-specific callback arrays.
 */
export class StageSystemRegistry {
    /** Stage that owns this System registry. */
    readonly stage: Stage;
    private readonly installed = new Map<string, InstalledStageSystem>();
    private readonly installationOrder: InstalledStageSystem[] = [];
    private readonly services = new Map<StageSystemService<unknown>, unknown>();
    private executionOrder: readonly InstalledStageSystem[] = Object.freeze([]);
    private beforeUpdateHooks: readonly ((deltaTimeMilliseconds: number) => void)[] = Object.freeze(
        []
    );
    private afterUpdateHooks: readonly ((deltaTimeMilliseconds: number) => void)[] = Object.freeze(
        []
    );
    private beforeRenderHooks: readonly (() => void)[] = Object.freeze([]);
    private afterRenderHooks: readonly (() => void)[] = Object.freeze([]);
    private dispatching = false;
    private initializing = false;
    private settingUp = false;
    private destroyingRuntime = false;
    private initialized = false;
    private destroyed = false;

    constructor(stage: Stage) {
        this.stage = stage;
    }

    /** Initialize an entire System set transactionally. Intended for `Stage.create()`. */
    async initialize(systems: readonly StageSystem[]): Promise<void> {
        this.requireMutable('initialize Systems');
        if (this.initialized) throw new Error('Stage Systems have already been initialized.');
        this.initialized = true;
        this.initializing = true;
        try {
            const resolved = systems.map(snapshotSystem);
            validateServiceProviders(resolved);
            const sorted = resolveSystemOrder(resolved);
            for (const system of sorted) await this.installResolved(system);
            this.rebuildSchedule();
        } catch (cause) {
            this.initializing = false;
            try {
                this.destroy();
            } catch (rollbackCause) {
                throw new AggregateError(
                    [cause, rollbackCause],
                    'Stage System setup and rollback both failed.',
                    { cause: rollbackCause }
                );
            }
            throw cause;
        } finally {
            this.initializing = false;
        }
    }

    /** Install one System and recompile the frame schedule. */
    async install(system: StageSystem): Promise<void> {
        this.requireMutable('install a System');
        const resolved = snapshotSystem(system);
        if (this.installed.has(resolved.descriptor.id)) {
            throw new TypeError(`Stage System ${resolved.descriptor.id} is already installed.`);
        }
        const planned = [...this.installationOrder, resolved];
        validateServiceProviders(planned);
        resolveSystemOrder(planned);
        await this.installResolved(resolved);
        this.rebuildSchedule();
    }

    /** Remove one leaf System. Hard dependants must be removed first. */
    uninstall(id: string): void {
        this.requireMutable('uninstall a System');
        const installed = this.installed.get(id);
        if (!installed) return;
        for (const candidate of this.installationOrder) {
            if (candidate.descriptor.requires.includes(id)) {
                throw new Error(
                    `Cannot uninstall Stage System ${id} while ${candidate.descriptor.id} depends on it.`
                );
            }
        }
        try {
            this.destroyInstalled(installed);
        } finally {
            this.rebuildSchedule();
        }
    }

    /** Return whether a System identity is currently installed. */
    has(id: string): boolean {
        return this.installed.has(id);
    }

    /** Read an installed System runtime for diagnostics or explicit extension APIs. */
    getRuntime(id: string): StageSystemRuntime | undefined {
        return this.installed.get(id)?.runtime;
    }

    /** Read a required typed service published by an installed System. */
    get<T>(service: StageSystemService<T>): T {
        if (!this.services.has(service)) {
            throw new Error(`Stage System service ${service.name} is not available.`);
        }
        return this.services.get(service) as T;
    }

    /** Read a typed service when its provider is optional. */
    getOptional<T>(service: StageSystemService<T>): T | undefined {
        return this.services.get(service) as T | undefined;
    }

    /** Dispatch the pre-update phase in compiled order. */
    runBeforeUpdate(deltaTimeMilliseconds: number): void {
        this.dispatchDelta(this.beforeUpdateHooks, deltaTimeMilliseconds);
    }

    /** Dispatch the post-update phase in compiled order. */
    runAfterUpdate(deltaTimeMilliseconds: number): void {
        this.dispatchDelta(this.afterUpdateHooks, deltaTimeMilliseconds);
    }

    /** Dispatch the pre-render phase in compiled order. */
    runBeforeRender(): void {
        this.dispatch(this.beforeRenderHooks);
    }

    /** Dispatch the post-render phase in compiled order. */
    runAfterRender(): void {
        this.dispatch(this.afterRenderHooks);
    }

    /** Destroy every runtime and its services in reverse compiled order. */
    destroy(): void {
        if (this.destroyed) return;
        if (this.destroyingRuntime) throw new Error('Cannot destroy Stage Systems recursively.');
        if (this.dispatching) throw new Error('Cannot destroy Stage Systems during a phase.');
        this.destroyed = true;
        const errors: unknown[] = [];
        const order =
            this.executionOrder.length === this.installationOrder.length
                ? this.executionOrder
                : this.installationOrder;
        for (const installed of [...order].reverse()) {
            try {
                this.destroyInstalled(installed);
            } catch (cause) {
                errors.push(cause);
            }
        }
        this.clearSchedule();
        if (errors.length > 0) {
            throw new AggregateError(errors, 'One or more Stage Systems failed to destroy.');
        }
    }

    private async installResolved(resolved: ResolvedStageSystem): Promise<void> {
        const { descriptor, system } = resolved;
        const declaredServices = new Set(descriptor.provides);
        const publishedServices = new Map<StageSystemService<unknown>, unknown>();
        let setupActive = true;
        let runtimeValue: unknown;
        let validatedRuntime: Omit<InstalledStageSystem, keyof ResolvedStageSystem> | undefined;
        let committed = false;
        const context: StageSystemSetupContext = {
            stage: this.stage,
            provide: <T>(service: StageSystemService<T>, value: T): void => {
                if (!setupActive) {
                    throw new Error('Stage System services can only be published during setup.');
                }
                if (!declaredServices.has(service)) {
                    throw new TypeError(
                        `Stage System ${descriptor.id} published undeclared service ${service.name}.`
                    );
                }
                if (this.services.has(service) || publishedServices.has(service)) {
                    throw new TypeError(
                        `Stage System service ${service.name} already has a provider.`
                    );
                }
                publishedServices.set(service, value);
            },
            get: <T>(service: StageSystemService<T>): T => {
                if (publishedServices.has(service)) return publishedServices.get(service) as T;
                return this.get(service);
            },
            getOptional: <T>(service: StageSystemService<T>): T | undefined => {
                if (publishedServices.has(service)) return publishedServices.get(service) as T;
                return this.getOptional(service);
            }
        };
        this.settingUp = true;
        try {
            runtimeValue = await system.setup(context);
            validatedRuntime = validateSystemRuntime(runtimeValue, descriptor.id);
            for (const service of descriptor.provides) {
                if (!publishedServices.has(service)) {
                    throw new TypeError(
                        `Stage System ${descriptor.id} did not publish declared service ${service.name}.`
                    );
                }
            }
            if (this.destroyed) {
                throw new Error(
                    `Stage System ${descriptor.id} finished setup after its Stage was destroyed.`
                );
            }
            for (const [service, value] of publishedServices) this.services.set(service, value);
            const installed: InstalledStageSystem = {
                ...resolved,
                ...validatedRuntime
            };
            this.installed.set(descriptor.id, installed);
            this.installationOrder.push(installed);
            committed = true;
        } catch (cause) {
            if (!committed && runtimeValue !== undefined) {
                try {
                    validatedRuntime?.destroy?.();
                    if (validatedRuntime === undefined) {
                        cleanupRuntimeCandidate(runtimeValue, descriptor.id);
                    }
                } catch (destroyCause) {
                    throw new AggregateError(
                        [cause, destroyCause],
                        `Stage System ${descriptor.id} setup validation and cleanup both failed.`,
                        { cause: destroyCause }
                    );
                }
            }
            throw cause;
        } finally {
            setupActive = false;
            this.settingUp = false;
        }
    }

    private destroyInstalled(installed: InstalledStageSystem): void {
        if (this.destroyingRuntime) {
            throw new Error('Stage System runtimes cannot be destroyed recursively.');
        }
        this.destroyingRuntime = true;
        try {
            installed.destroy?.();
        } finally {
            this.installed.delete(installed.descriptor.id);
            const index = this.installationOrder.indexOf(installed);
            if (index >= 0) this.installationOrder.splice(index, 1);
            for (const service of installed.descriptor.provides) this.services.delete(service);
            this.destroyingRuntime = false;
        }
    }

    private rebuildSchedule(): void {
        if (this.destroyed) {
            this.clearSchedule();
            return;
        }
        const order = resolveSystemOrder(this.installationOrder) as InstalledStageSystem[];
        this.executionOrder = Object.freeze(order);
        this.beforeUpdateHooks = Object.freeze(
            order.flatMap(system => (system.beforeUpdate ? [system.beforeUpdate] : []))
        );
        this.afterUpdateHooks = Object.freeze(
            order.flatMap(system => (system.afterUpdate ? [system.afterUpdate] : []))
        );
        this.beforeRenderHooks = Object.freeze(
            order.flatMap(system => (system.beforeRender ? [system.beforeRender] : []))
        );
        this.afterRenderHooks = Object.freeze(
            order.flatMap(system => (system.afterRender ? [system.afterRender] : []))
        );
    }

    private clearSchedule(): void {
        this.executionOrder = Object.freeze([]);
        this.beforeUpdateHooks = Object.freeze([]);
        this.afterUpdateHooks = Object.freeze([]);
        this.beforeRenderHooks = Object.freeze([]);
        this.afterRenderHooks = Object.freeze([]);
    }

    private dispatchDelta(
        callbacks: readonly ((deltaTimeMilliseconds: number) => void)[],
        deltaTimeMilliseconds: number
    ): void {
        if (this.destroyed || callbacks.length === 0) return;
        this.beginDispatch();
        try {
            for (const callback of callbacks) callback(deltaTimeMilliseconds);
        } finally {
            this.dispatching = false;
        }
    }

    private dispatch(callbacks: readonly (() => void)[]): void {
        if (this.destroyed || callbacks.length === 0) return;
        this.beginDispatch();
        try {
            for (const callback of callbacks) callback();
        } finally {
            this.dispatching = false;
        }
    }

    private beginDispatch(): void {
        if (this.dispatching)
            throw new Error('Stage System phases cannot be dispatched recursively.');
        this.dispatching = true;
    }

    private requireMutable(operation: string): void {
        if (this.destroyed) {
            throw new Error(`Cannot ${operation} after the Stage System registry is destroyed.`);
        }
        if (this.initializing || this.settingUp) {
            throw new Error(`Cannot ${operation} while Stage Systems are being initialized.`);
        }
        if (this.destroyingRuntime) {
            throw new Error(`Cannot ${operation} while a Stage System runtime is being destroyed.`);
        }
        if (this.dispatching) {
            throw new Error(`Cannot ${operation} while a Stage System phase is running.`);
        }
    }
}
