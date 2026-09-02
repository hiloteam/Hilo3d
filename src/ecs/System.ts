import { ComponentType } from './Component';
import type { WorldCommandBuffer } from './CommandBuffer';
import { WorldResource } from './Resource';
import type World from './World';

/** Initial World System ABI. Increment for breaking descriptor or execution-context changes. */
export const WORLD_SYSTEM_API_VERSION = 1 as const;

/** Fixed phase sequence executed by a headless World update. */
export const WORLD_SYSTEM_PHASES = [
    'input',
    'fixed-pre-physics',
    'physics',
    'fixed-post-physics',
    'update',
    'animation',
    'transform',
    'render-extract',
    'cleanup'
] as const;

/** One phase in the compiled World System schedule. */
export type WorldSystemPhase = (typeof WORLD_SYSTEM_PHASES)[number];

/** Declared component and resource access used for validation and future scheduling. */
export interface WorldSystemAccess {
    readonly reads?: readonly ComponentType<unknown>[];
    readonly writes?: readonly ComponentType<unknown>[];
    readonly readsResources?: readonly WorldResource<unknown>[];
    readonly writesResources?: readonly WorldResource<unknown>[];
}

/** Immutable identity, ordering, phase, and access metadata for one World System. */
export interface WorldSystemDescriptor {
    readonly id: string;
    readonly version: string;
    readonly apiVersion: typeof WORLD_SYSTEM_API_VERSION;
    readonly phase: WorldSystemPhase;
    readonly requires?: readonly string[];
    readonly before?: readonly string[];
    readonly after?: readonly string[];
    readonly provides?: readonly WorldResource<unknown>[];
    readonly access?: WorldSystemAccess;
}

/** Context valid only while a World System factory is being initialized. */
export interface WorldSystemSetupContext {
    readonly world: World;
    provide<T>(resource: WorldResource<T>, value: T): void;
    get<T>(resource: WorldResource<T>): T;
    getOptional<T>(resource: WorldResource<T>): T | undefined;
}

/** Reused per-dispatch context passed to every runtime in a compiled phase. */
export interface WorldSystemExecutionContext {
    readonly world: World;
    readonly commands: WorldCommandBuffer;
    readonly phase: WorldSystemPhase;
    readonly deltaTimeMilliseconds: number;
    readonly fixedStepIndex: number;
    readonly interpolationAlpha: number;
}

/** Synchronous runtime produced for one World. */
export interface WorldSystemRuntime {
    execute(context: WorldSystemExecutionContext): void;
    destroy?(): void;
}

/** Reusable System factory. Each World receives a distinct runtime. */
export interface WorldSystem {
    readonly descriptor: WorldSystemDescriptor;
    setup(context: WorldSystemSetupContext): WorldSystemRuntime | Promise<WorldSystemRuntime>;
}

interface ResolvedWorldSystemDescriptor {
    readonly id: string;
    readonly version: string;
    readonly apiVersion: typeof WORLD_SYSTEM_API_VERSION;
    readonly phase: WorldSystemPhase;
    readonly requires: readonly string[];
    readonly before: readonly string[];
    readonly after: readonly string[];
    readonly provides: readonly WorldResource<unknown>[];
    readonly access: Readonly<{
        reads: readonly ComponentType<unknown>[];
        writes: readonly ComponentType<unknown>[];
        readsResources: readonly WorldResource<unknown>[];
        writesResources: readonly WorldResource<unknown>[];
    }>;
}

interface ResolvedWorldSystem {
    readonly system: WorldSystem;
    readonly descriptor: ResolvedWorldSystemDescriptor;
}

interface InstalledWorldSystem extends ResolvedWorldSystem {
    readonly runtime: WorldSystemRuntime;
    readonly execute: (context: WorldSystemExecutionContext) => unknown;
    readonly destroy: (() => void) | undefined;
}

class MutableExecutionContext implements WorldSystemExecutionContext {
    readonly world: World;
    readonly commands: WorldCommandBuffer;
    phase: WorldSystemPhase = 'input';
    deltaTimeMilliseconds = 0;
    fixedStepIndex = 0;
    interpolationAlpha = 0;

    constructor(world: World, commands: WorldCommandBuffer) {
        this.world = world;
        this.commands = commands;
    }
}

function phaseIndex(phase: WorldSystemPhase): number {
    return WORLD_SYSTEM_PHASES.indexOf(phase);
}

function readProperty(value: object, key: PropertyKey): unknown {
    return Reflect.get(value, key);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    return (
        (typeof value === 'object' || typeof value === 'function') &&
        value !== null &&
        typeof Reflect.get(value, 'then') === 'function'
    );
}

function snapshotStringList(
    descriptor: WorldSystemDescriptor,
    key: 'requires' | 'before' | 'after'
): readonly string[] {
    const values = descriptor[key] ?? [];
    if (new Set(values).size !== values.length) {
        throw new TypeError(`World System ${descriptor.id} declares duplicate ${key} entries.`);
    }
    for (const value of values) {
        if (value.trim().length === 0) {
            throw new TypeError(`World System ${descriptor.id} declares an empty ${key} identity.`);
        }
        if (value === descriptor.id) {
            throw new TypeError(
                `World System ${descriptor.id} cannot order itself through ${key}.`
            );
        }
    }
    return Object.freeze([...values]);
}

function snapshotTokenList<T extends ComponentType<unknown> | WorldResource<unknown>>(
    systemId: string,
    label: string,
    values: readonly T[],
    constructor: typeof ComponentType | typeof WorldResource
): readonly T[] {
    if (new Set(values).size !== values.length) {
        throw new TypeError(`World System ${systemId} declares duplicate ${label} entries.`);
    }
    for (const value of values) {
        if (!(value instanceof constructor)) {
            throw new TypeError(`World System ${systemId} declares an invalid ${label} token.`);
        }
    }
    return Object.freeze([...values]);
}

function snapshotSystem(system: WorldSystem): ResolvedWorldSystem {
    const descriptor = system.descriptor;
    if (descriptor.id.trim().length === 0) throw new TypeError('World System ids cannot be empty.');
    if (descriptor.version.trim().length === 0) {
        throw new TypeError(`World System ${descriptor.id} must declare a version.`);
    }
    if (readProperty(descriptor, 'apiVersion') !== WORLD_SYSTEM_API_VERSION) {
        throw new TypeError(
            `World System ${descriptor.id} targets API ${String(descriptor.apiVersion)}; Hilo3D requires ${String(WORLD_SYSTEM_API_VERSION)}.`
        );
    }
    if (!WORLD_SYSTEM_PHASES.includes(descriptor.phase)) {
        throw new TypeError(
            `World System ${descriptor.id} declares invalid phase ${descriptor.phase}.`
        );
    }
    const access = descriptor.access ?? {};
    const reads = snapshotTokenList(
        descriptor.id,
        'component read',
        access.reads ?? [],
        ComponentType
    );
    const writes = snapshotTokenList(
        descriptor.id,
        'component write',
        access.writes ?? [],
        ComponentType
    );
    const readsResources = snapshotTokenList(
        descriptor.id,
        'resource read',
        access.readsResources ?? [],
        WorldResource
    );
    const writesResources = snapshotTokenList(
        descriptor.id,
        'resource write',
        access.writesResources ?? [],
        WorldResource
    );
    for (const token of reads) {
        if (writes.includes(token)) {
            throw new TypeError(
                `World System ${descriptor.id} declares the same component as read and write.`
            );
        }
    }
    for (const token of readsResources) {
        if (writesResources.includes(token)) {
            throw new TypeError(
                `World System ${descriptor.id} declares the same resource as read and write.`
            );
        }
    }
    return {
        system,
        descriptor: Object.freeze({
            id: descriptor.id,
            version: descriptor.version,
            apiVersion: WORLD_SYSTEM_API_VERSION,
            phase: descriptor.phase,
            requires: snapshotStringList(descriptor, 'requires'),
            before: snapshotStringList(descriptor, 'before'),
            after: snapshotStringList(descriptor, 'after'),
            provides: snapshotTokenList(
                descriptor.id,
                'provided resource',
                descriptor.provides ?? [],
                WorldResource
            ),
            access: Object.freeze({ reads, writes, readsResources, writesResources })
        })
    };
}

function validateResourceProviders(systems: readonly ResolvedWorldSystem[]): void {
    const providers = new Map<WorldResource<unknown>, string>();
    for (const system of systems) {
        for (const resource of system.descriptor.provides) {
            const provider = providers.get(resource);
            if (provider !== undefined) {
                throw new TypeError(
                    `World resource ${resource.name} is provided by both ${provider} and ${system.descriptor.id}.`
                );
            }
            providers.set(resource, system.descriptor.id);
        }
    }
}

function validatePhaseEdge(predecessor: ResolvedWorldSystem, successor: ResolvedWorldSystem): void {
    if (phaseIndex(predecessor.descriptor.phase) > phaseIndex(successor.descriptor.phase)) {
        throw new TypeError(
            `World System order ${predecessor.descriptor.id} -> ${successor.descriptor.id} conflicts with phases ${predecessor.descriptor.phase} -> ${successor.descriptor.phase}.`
        );
    }
}

function tokenListsOverlap<T>(left: readonly T[], right: readonly T[]): boolean {
    for (const value of left) {
        if (right.includes(value)) return true;
    }
    return false;
}

function systemsHaveAccessHazard(left: ResolvedWorldSystem, right: ResolvedWorldSystem): boolean {
    const leftAccess = left.descriptor.access;
    const rightAccess = right.descriptor.access;
    return (
        tokenListsOverlap(leftAccess.writes, rightAccess.reads) ||
        tokenListsOverlap(leftAccess.writes, rightAccess.writes) ||
        tokenListsOverlap(leftAccess.reads, rightAccess.writes) ||
        tokenListsOverlap(leftAccess.writesResources, rightAccess.readsResources) ||
        tokenListsOverlap(leftAccess.writesResources, rightAccess.writesResources) ||
        tokenListsOverlap(leftAccess.readsResources, rightAccess.writesResources)
    );
}

function hasPredecessor(
    predecessors: ReadonlyMap<string, readonly ResolvedWorldSystem[]>,
    systemId: string,
    predecessorId: string,
    visited: Set<string>
): boolean {
    if (systemId === predecessorId) return true;
    if (visited.has(systemId)) return false;
    visited.add(systemId);
    for (const predecessor of predecessors.get(systemId) ?? []) {
        if (
            predecessor.descriptor.id === predecessorId ||
            hasPredecessor(predecessors, predecessor.descriptor.id, predecessorId, visited)
        ) {
            return true;
        }
    }
    return false;
}

function validateAccessHazards(
    systems: readonly ResolvedWorldSystem[],
    predecessors: ReadonlyMap<string, readonly ResolvedWorldSystem[]>
): void {
    for (let leftIndex = 0; leftIndex < systems.length; leftIndex++) {
        const left = systems[leftIndex];
        if (!left) continue;
        for (let rightIndex = leftIndex + 1; rightIndex < systems.length; rightIndex++) {
            const right = systems[rightIndex];
            if (!right) continue;
            if (left.descriptor.phase !== right.descriptor.phase) continue;
            if (!systemsHaveAccessHazard(left, right)) continue;
            const ordered =
                hasPredecessor(
                    predecessors,
                    left.descriptor.id,
                    right.descriptor.id,
                    new Set<string>()
                ) ||
                hasPredecessor(
                    predecessors,
                    right.descriptor.id,
                    left.descriptor.id,
                    new Set<string>()
                );
            if (!ordered) {
                throw new TypeError(
                    `World Systems ${left.descriptor.id} and ${right.descriptor.id} have an unordered ${left.descriptor.phase} access hazard.`
                );
            }
        }
    }
}

function resolveSystemOrder(systems: readonly ResolvedWorldSystem[]): ResolvedWorldSystem[] {
    const systemsById = new Map<string, ResolvedWorldSystem>();
    const predecessors = new Map<string, ResolvedWorldSystem[]>();
    for (const system of systems) {
        const { id } = system.descriptor;
        if (systemsById.has(id)) throw new TypeError(`Duplicate World System ${id}.`);
        systemsById.set(id, system);
        predecessors.set(id, []);
    }
    for (const system of systems) {
        for (const dependency of system.descriptor.requires) {
            const predecessor = systemsById.get(dependency);
            if (!predecessor) {
                throw new TypeError(
                    `World System ${system.descriptor.id} requires missing System ${dependency}.`
                );
            }
            validatePhaseEdge(predecessor, system);
            predecessors.get(system.descriptor.id)?.push(predecessor);
        }
        for (const target of system.descriptor.after) {
            const predecessor = systemsById.get(target);
            if (!predecessor) continue;
            validatePhaseEdge(predecessor, system);
            predecessors.get(system.descriptor.id)?.push(predecessor);
        }
        for (const target of system.descriptor.before) {
            const successor = systemsById.get(target);
            if (!successor) continue;
            validatePhaseEdge(system, successor);
            predecessors.get(successor.descriptor.id)?.push(system);
        }
    }

    validateAccessHazards(systems, predecessors);

    const sorted: ResolvedWorldSystem[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (system: ResolvedWorldSystem): void => {
        const { id } = system.descriptor;
        if (visited.has(id)) return;
        if (visiting.has(id)) {
            throw new TypeError(`World System ordering cycle includes ${id}.`);
        }
        visiting.add(id);
        for (const predecessor of predecessors.get(id) ?? []) visit(predecessor);
        visiting.delete(id);
        visited.add(id);
        sorted.push(system);
    };
    for (const phase of WORLD_SYSTEM_PHASES) {
        for (const system of systems) {
            if (system.descriptor.phase === phase) visit(system);
        }
    }
    return sorted;
}

function validateRuntime(
    value: unknown,
    systemId: string
): {
    readonly runtime: WorldSystemRuntime;
    readonly execute: (context: WorldSystemExecutionContext) => unknown;
    readonly destroy: (() => void) | undefined;
} {
    if (typeof value !== 'object' || value === null) {
        throw new TypeError(`World System ${systemId} returned no runtime.`);
    }
    const execute = readProperty(value, 'execute');
    if (typeof execute !== 'function') {
        throw new TypeError(`World System ${systemId} runtime execute must be a function.`);
    }
    const destroy = readProperty(value, 'destroy');
    if (destroy !== undefined && typeof destroy !== 'function') {
        throw new TypeError(`World System ${systemId} runtime destroy must be a function.`);
    }
    return {
        runtime: value as WorldSystemRuntime,
        execute: (context: WorldSystemExecutionContext): unknown =>
            (execute as (this: object, context: WorldSystemExecutionContext) => unknown).call(
                value,
                context
            ),
        destroy:
            destroy === undefined
                ? undefined
                : (): void => {
                      (destroy as (this: object) => void).call(value);
                  }
    };
}

function cleanupRuntimeCandidate(value: unknown, systemId: string): void {
    if (typeof value !== 'object' || value === null) return;
    const destroy = readProperty(value, 'destroy');
    if (typeof destroy === 'function') (destroy as (this: object) => void).call(value);
    else if (destroy !== undefined) {
        throw new TypeError(`World System ${systemId} runtime destroy must be a function.`);
    }
}

function createEmptySchedule(): Record<WorldSystemPhase, readonly InstalledWorldSystem[]> {
    return {
        input: Object.freeze([]),
        'fixed-pre-physics': Object.freeze([]),
        physics: Object.freeze([]),
        'fixed-post-physics': Object.freeze([]),
        update: Object.freeze([]),
        animation: Object.freeze([]),
        transform: Object.freeze([]),
        'render-extract': Object.freeze([]),
        cleanup: Object.freeze([])
    };
}

/** Transactional World System registry with a compiled allocation-free phase dispatch path. */
export class WorldSystemRegistry {
    readonly world: World;
    private readonly commands: WorldCommandBuffer;
    private readonly installed = new Map<string, InstalledWorldSystem>();
    private readonly installationOrder: InstalledWorldSystem[] = [];
    private readonly resources = new Map<WorldResource<unknown>, unknown>();
    private readonly executionContext: MutableExecutionContext;
    private executionOrder: readonly InstalledWorldSystem[] = Object.freeze([]);
    private schedule = createEmptySchedule();
    private dispatching = false;
    private initializing = false;
    private settingUp = false;
    private destroyingRuntime = false;
    private initialized = false;
    private destroyed = false;

    constructor(world: World, commands: WorldCommandBuffer) {
        this.world = world;
        this.commands = commands;
        this.executionContext = new MutableExecutionContext(world, commands);
    }

    async initialize(systems: readonly WorldSystem[]): Promise<void> {
        this.requireMutable('initialize Systems');
        if (this.initialized) throw new Error('World Systems have already been initialized.');
        this.initialized = true;
        this.initializing = true;
        try {
            const resolved = systems.map(snapshotSystem);
            validateResourceProviders(resolved);
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
                    'World System setup and rollback both failed.',
                    { cause: rollbackCause }
                );
            }
            throw cause;
        } finally {
            this.initializing = false;
        }
    }

    async install(system: WorldSystem): Promise<void> {
        this.requireMutable('install a System');
        const resolved = snapshotSystem(system);
        if (this.installed.has(resolved.descriptor.id)) {
            throw new TypeError(`World System ${resolved.descriptor.id} is already installed.`);
        }
        const planned = [...this.installationOrder, resolved];
        validateResourceProviders(planned);
        resolveSystemOrder(planned);
        await this.installResolved(resolved);
        this.rebuildSchedule();
    }

    uninstall(id: string): void {
        this.requireMutable('uninstall a System');
        const installed = this.installed.get(id);
        if (!installed) return;
        for (const candidate of this.installationOrder) {
            if (candidate.descriptor.requires.includes(id)) {
                throw new Error(
                    `Cannot uninstall World System ${id} while ${candidate.descriptor.id} depends on it.`
                );
            }
        }
        try {
            this.destroyInstalled(installed);
        } finally {
            this.rebuildSchedule();
        }
    }

    has(id: string): boolean {
        return this.installed.has(id);
    }

    getRuntime(id: string): WorldSystemRuntime | undefined {
        return this.installed.get(id)?.runtime;
    }

    get<T>(resource: WorldResource<T>): T {
        if (!this.resources.has(resource)) {
            throw new Error(`World resource ${resource.name} is not available.`);
        }
        return this.resources.get(resource) as T;
    }

    getOptional<T>(resource: WorldResource<T>): T | undefined {
        return this.resources.get(resource) as T | undefined;
    }

    runPhase(
        phase: WorldSystemPhase,
        deltaTimeMilliseconds: number,
        fixedStepIndex: number,
        interpolationAlpha: number
    ): void {
        if (this.destroyed) return;
        const systems = this.schedule[phase];
        if (systems.length === 0) return;
        if (this.dispatching)
            throw new Error('World System phases cannot be dispatched recursively.');
        this.dispatching = true;
        this.executionContext.phase = phase;
        this.executionContext.deltaTimeMilliseconds = deltaTimeMilliseconds;
        this.executionContext.fixedStepIndex = fixedStepIndex;
        this.executionContext.interpolationAlpha = interpolationAlpha;
        this.world.beginSystemDispatch();
        try {
            let index = 0;
            while (index < systems.length) {
                const system = systems[index];
                index++;
                if (!system) continue;
                const result = system.execute(this.executionContext);
                if (isPromiseLike(result)) {
                    throw new TypeError(
                        `World System ${system.descriptor.id} returned a Promise from execute().`
                    );
                }
            }
        } finally {
            this.world.endSystemDispatch();
            this.dispatching = false;
        }
    }

    destroy(): void {
        if (this.destroyed) return;
        if (this.dispatching) throw new Error('Cannot destroy World Systems during a phase.');
        if (this.destroyingRuntime) throw new Error('Cannot destroy World Systems recursively.');
        this.destroyed = true;
        const errors: unknown[] = [];
        const order =
            this.executionOrder.length === this.installationOrder.length
                ? this.executionOrder
                : this.installationOrder;
        for (let index = order.length - 1; index >= 0; index--) {
            const installed = order[index];
            if (!installed) continue;
            try {
                this.destroyInstalled(installed);
            } catch (cause) {
                errors.push(cause);
            }
        }
        this.executionOrder = Object.freeze([]);
        this.schedule = createEmptySchedule();
        if (errors.length > 0) {
            throw new AggregateError(errors, 'One or more World Systems failed to destroy.');
        }
    }

    private async installResolved(resolved: ResolvedWorldSystem): Promise<void> {
        const { descriptor, system } = resolved;
        const declaredResources = new Set(descriptor.provides);
        const publishedResources = new Map<WorldResource<unknown>, unknown>();
        let setupActive = true;
        let runtimeValue: unknown;
        let validatedRuntime:
            | {
                  readonly runtime: WorldSystemRuntime;
                  readonly execute: (context: WorldSystemExecutionContext) => unknown;
                  readonly destroy: (() => void) | undefined;
              }
            | undefined;
        let committed = false;
        const context: WorldSystemSetupContext = {
            world: this.world,
            provide: <T>(resource: WorldResource<T>, value: T): void => {
                if (!setupActive) {
                    throw new Error('World resources can only be published during System setup.');
                }
                if (!declaredResources.has(resource)) {
                    throw new TypeError(
                        `World System ${descriptor.id} published undeclared resource ${resource.name}.`
                    );
                }
                if (this.resources.has(resource) || publishedResources.has(resource)) {
                    throw new TypeError(`World resource ${resource.name} already has a provider.`);
                }
                publishedResources.set(resource, value);
            },
            get: <T>(resource: WorldResource<T>): T => {
                if (publishedResources.has(resource)) return publishedResources.get(resource) as T;
                return this.get(resource);
            },
            getOptional: <T>(resource: WorldResource<T>): T | undefined => {
                if (publishedResources.has(resource)) return publishedResources.get(resource) as T;
                return this.getOptional(resource);
            }
        };
        this.settingUp = true;
        try {
            runtimeValue = await system.setup(context);
            validatedRuntime = validateRuntime(runtimeValue, descriptor.id);
            for (const resource of descriptor.provides) {
                if (!publishedResources.has(resource)) {
                    throw new TypeError(
                        `World System ${descriptor.id} did not publish declared resource ${resource.name}.`
                    );
                }
            }
            if (this.destroyed) {
                throw new Error(
                    `World System ${descriptor.id} finished setup after its World was destroyed.`
                );
            }
            for (const [resource, value] of publishedResources) {
                this.resources.set(resource, value);
            }
            const installed: InstalledWorldSystem = { ...resolved, ...validatedRuntime };
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
                        `World System ${descriptor.id} setup validation and cleanup both failed.`,
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

    private destroyInstalled(installed: InstalledWorldSystem): void {
        this.destroyingRuntime = true;
        try {
            installed.destroy?.();
        } finally {
            this.installed.delete(installed.descriptor.id);
            const index = this.installationOrder.indexOf(installed);
            if (index >= 0) this.installationOrder.splice(index, 1);
            for (const resource of installed.descriptor.provides) this.resources.delete(resource);
            this.destroyingRuntime = false;
        }
    }

    private rebuildSchedule(): void {
        if (this.destroyed) return;
        const order = resolveSystemOrder(this.installationOrder) as InstalledWorldSystem[];
        this.executionOrder = Object.freeze(order);
        const schedule = createEmptySchedule();
        for (const phase of WORLD_SYSTEM_PHASES) {
            schedule[phase] = Object.freeze(
                order.filter(system => system.descriptor.phase === phase)
            );
        }
        this.schedule = schedule;
    }

    private requireMutable(operation: string): void {
        if (this.destroyed) {
            throw new Error(`Cannot ${operation} after the World System registry is destroyed.`);
        }
        if (this.initializing || this.settingUp) {
            throw new Error(`Cannot ${operation} while World Systems are being initialized.`);
        }
        if (this.destroyingRuntime) {
            throw new Error(`Cannot ${operation} while a World System runtime is being destroyed.`);
        }
        if (this.dispatching) {
            throw new Error(`Cannot ${operation} while a World System phase is running.`);
        }
    }
}
