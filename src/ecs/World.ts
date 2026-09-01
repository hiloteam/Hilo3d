import { ComponentType, type ComponentStore } from './Component';
import { WorldCommandBuffer } from './CommandBuffer';
import { type Entity, EntityAllocator } from './Entity';
import { CachedQuery, type QueryDescription } from './Query';
import type { WorldResource } from './Resource';
import {
    WORLD_SYSTEM_PHASES,
    type WorldSystem,
    type WorldSystemPhase,
    WorldSystemRegistry
} from './System';

const DEFAULT_INITIAL_CAPACITY = 1024;
const DEFAULT_FIXED_DELTA_MILLISECONDS = 1000 / 60;
const DEFAULT_MAX_SUB_STEPS = 4;
const DEFAULT_MAX_DELTA_MILLISECONDS = 250;

interface ComponentRegistration {
    readonly id: number;
    readonly type: ComponentType<unknown>;
    readonly store: ComponentStore<unknown>;
}

/** Allocation-free notification emitted after one structural component or Entity mutation. */
export type WorldStructureListener = (
    entityIndex: number,
    component: ComponentType<unknown> | null
) => void;

/** Parameters for a headless ECS World. */
export interface WorldParameters {
    readonly initialCapacity?: number;
    readonly fixedDeltaMilliseconds?: number;
    readonly maxSubSteps?: number;
    readonly maxDeltaMilliseconds?: number;
    /** Collect per-phase wall-clock diagnostics. Disabled by default to keep update allocation-free. */
    readonly measurePhaseDurations?: boolean;
    readonly systems?: readonly WorldSystem[];
}

/** Snapshot of World scheduling and storage health. */
export interface WorldDiagnostics {
    readonly entityCount: number;
    readonly entityCapacity: number;
    readonly componentTypeCount: number;
    readonly queryCount: number;
    readonly frameCount: number;
    readonly fixedStepCount: number;
    readonly interpolationAlpha: number;
    readonly droppedTimeMilliseconds: number;
    readonly queuedCommandCount: number;
    /** Last frame CPU wall time attributed to each phase. */
    readonly phaseDurationsMilliseconds: Readonly<Record<WorldSystemPhase, number>>;
}

function requireFiniteNonNegative(value: number, name: string): number {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`${name} must be finite and non-negative.`);
    }
    return value;
}

function requireFinitePositive(value: number, name: string): number {
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`${name} must be finite and positive.`);
    }
    return value;
}

function requirePositiveInteger(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer.`);
    }
    return value;
}

/**
 * Headless Entity/Component/System owner and authoritative application simulation runtime.
 */
export default class World {
    /** Deferred structural mutations shared by every System execution context. */
    readonly commands = new WorldCommandBuffer();
    /** Transactional System scheduler and typed resource registry. */
    readonly systems: WorldSystemRegistry;
    readonly fixedDeltaMilliseconds: number;
    readonly maxSubSteps: number;
    readonly maxDeltaMilliseconds: number;
    /** Whether this World samples wall-clock time around every System phase. */
    readonly measurePhaseDurations: boolean;
    private readonly entities: EntityAllocator;
    private readonly registrations = new Map<ComponentType<unknown>, ComponentRegistration>();
    private readonly registrationsById: ComponentRegistration[] = [];
    private readonly queriesByKey = new Map<string, CachedQuery>();
    private readonly queries: CachedQuery[] = [];
    private readonly structureListeners: WorldStructureListener[] = [];
    private fixedAccumulatorMilliseconds = 0;
    private totalDroppedTimeMilliseconds = 0;
    private completedFrameCount = 0;
    private completedFixedStepCount = 0;
    private systemDispatching = false;
    private updating = false;
    private framePending = false;
    private pendingDeltaMilliseconds = 0;
    private pendingInterpolationAlpha = 0;
    private destroyed = false;
    private readonly phaseDurations = new Float64Array(WORLD_SYSTEM_PHASES.length);

    private constructor(parameters: WorldParameters) {
        this.fixedDeltaMilliseconds = requireFinitePositive(
            parameters.fixedDeltaMilliseconds ?? DEFAULT_FIXED_DELTA_MILLISECONDS,
            'fixedDeltaMilliseconds'
        );
        this.maxSubSteps = requirePositiveInteger(
            parameters.maxSubSteps ?? DEFAULT_MAX_SUB_STEPS,
            'maxSubSteps'
        );
        this.maxDeltaMilliseconds = requireFinitePositive(
            parameters.maxDeltaMilliseconds ?? DEFAULT_MAX_DELTA_MILLISECONDS,
            'maxDeltaMilliseconds'
        );
        this.measurePhaseDurations = parameters.measurePhaseDurations ?? false;
        this.entities = new EntityAllocator(parameters.initialCapacity ?? DEFAULT_INITIAL_CAPACITY);
        this.systems = new WorldSystemRegistry(this, this.commands);
    }

    /** Create a World and initialize its complete initial System set transactionally. */
    static async create(parameters: WorldParameters = {}): Promise<World> {
        const world = new World(parameters);
        try {
            await world.systems.initialize(parameters.systems ?? []);
            return world;
        } catch (cause) {
            try {
                world.destroy();
            } catch (destroyCause) {
                throw new AggregateError(
                    [cause, destroyCause],
                    'World initialization and cleanup both failed.',
                    { cause: destroyCause }
                );
            }
            throw cause;
        }
    }

    /** Number of live Entities. */
    get entityCount(): number {
        return this.entities.size;
    }

    /** Allocate one empty Entity. Components are added independently. */
    createEntity(): Entity {
        this.requireStructuralMutation('create an Entity');
        const entity = this.entities.create();
        this.ensureEntityCapacity(this.entities.capacity);
        return entity;
    }

    /** Destroy an Entity, all its components, and every cached query membership. */
    destroyEntity(entity: Entity): void {
        this.requireStructuralMutation('destroy an Entity');
        const entityIndex = this.entities.requireAliveIndex(entity);
        for (const registration of this.registrationsById) {
            registration.store.remove(entityIndex);
        }
        for (const query of this.queries) query.remove(entityIndex);
        this.entities.destroy(entity);
        this.notifyStructureChange(entityIndex, null);
    }

    /** Return whether a generation-safe handle is currently live in this World. */
    isAlive(entity: Entity): boolean {
        return !this.destroyed && this.entities.isAlive(entity);
    }

    /** Resolve one live internal entity index back to its public generation-safe handle. */
    entityAt(entityIndex: number): Entity {
        this.requireActive('resolve an Entity index');
        return this.entities.entityAt(entityIndex);
    }

    /** Resolve a live Entity to its World-local index for allocation-free component APIs. */
    entityIndex(entity: Entity): number {
        this.requireActive('resolve an Entity');
        return this.entities.requireAliveIndex(entity);
    }

    /** Add one component to a live Entity. */
    add<T>(entity: Entity, component: ComponentType<T>, value: T): void {
        this.addErased(entity, component, value);
    }

    /** Replace an existing component value without changing query membership. */
    set<T>(entity: Entity, component: ComponentType<T>, value: T): void {
        this.setErased(entity, component, value);
    }

    /** Remove a component and update every affected cached query. */
    remove<T>(entity: Entity, component: ComponentType<T>): boolean {
        return this.removeErased(entity, component);
    }

    /** Return whether an Entity owns a component. */
    has<T>(entity: Entity, component: ComponentType<T>): boolean {
        return this.hasErased(entity, component);
    }

    /** Read one existing component value. */
    get<T>(entity: Entity, component: ComponentType<T>): T {
        const entityIndex = this.entities.requireAliveIndex(entity);
        const registration = this.registrations.get(component);
        if (!registration) {
            throw new ReferenceError(
                `Component ${component.name} is not registered in this World.`
            );
        }
        return registration.store.get(entityIndex) as T;
    }

    /** Resolve and cache the World-local store for use by a System hot loop. */
    getStore<T>(component: ComponentType<T>): ComponentStore<T> {
        return this.requireRegistration(component).store as ComponentStore<T>;
    }

    /** Register a System-owned store for one derived component during setup. @internal */
    registerDerivedStore<T>(component: ComponentType<T>, store: ComponentStore<T>): void {
        this.requireActive(`register derived component ${component.name}`);
        if (component.writable) {
            throw new TypeError(`Component ${component.name} is not a derived component.`);
        }
        if (this.systemDispatching || this.updating) {
            throw new Error(
                `Derived component ${component.name} must be registered during System setup.`
            );
        }
        if (this.registrations.has(component)) {
            throw new TypeError(`Component ${component.name} is already registered in this World.`);
        }
        store.ensureEntityCapacity(this.entities.capacity);
        const erased = component as ComponentType<unknown>;
        const registration: ComponentRegistration = {
            id: this.registrationsById.length,
            type: erased,
            store
        };
        this.registrations.set(erased, registration);
        this.registrationsById.push(registration);
    }

    /** Subscribe during setup to post-mutation structural notifications. */
    subscribeStructureChanges(listener: WorldStructureListener): () => void {
        this.requireActive('subscribe to World structure changes');
        if (this.systemDispatching || this.updating) {
            throw new Error('World structure listeners must be installed outside phase execution.');
        }
        if (this.structureListeners.includes(listener)) {
            throw new TypeError('World structure listener is already installed.');
        }
        this.structureListeners.push(listener);
        return (): void => {
            const index = this.structureListeners.indexOf(listener);
            if (index >= 0) this.structureListeners.splice(index, 1);
        };
    }

    /** Create or reuse an incrementally maintained component query. */
    query(...all: readonly ComponentType<unknown>[]): CachedQuery;
    query(description: QueryDescription): CachedQuery;
    query(
        descriptionOrFirst: QueryDescription | ComponentType<unknown> | undefined,
        ...remaining: readonly ComponentType<unknown>[]
    ): CachedQuery {
        this.requireActive('create a query');
        if (this.systemDispatching) {
            throw new Error('World queries must be created during setup, not System execution.');
        }
        const description =
            descriptionOrFirst === undefined
                ? { all: [] }
                : descriptionOrFirst instanceof ComponentType
                  ? { all: [descriptionOrFirst, ...remaining] }
                  : descriptionOrFirst;
        const all = this.normalizeComponentTypes(description.all, 'required');
        const none = this.normalizeComponentTypes(description.none ?? [], 'excluded');
        if (all.length === 0) throw new TypeError('World queries must require a component.');
        for (const component of all) {
            if (none.includes(component)) {
                throw new TypeError(
                    `World query both requires and excludes component ${component.name}.`
                );
            }
        }
        const allRegistrations = all.map(component => this.requireRegistration(component));
        const noneRegistrations = none.map(component => this.requireRegistration(component));
        const key = `a:${allRegistrations.map(value => String(value.id)).join(',')}|n:${noneRegistrations.map(value => String(value.id)).join(',')}`;
        const cached = this.queriesByKey.get(key);
        if (cached) return cached;
        let candidate = allRegistrations[0]?.store;
        for (const registration of allRegistrations) {
            if (candidate === undefined || registration.store.length < candidate.length) {
                candidate = registration.store;
            }
        }
        const query = new CachedQuery(
            all,
            none,
            allRegistrations.map(value => value.store),
            noneRegistrations.map(value => value.store),
            this.entities.capacity,
            candidate?.length ?? 0
        );
        if (candidate) {
            for (let denseIndex = 0; denseIndex < candidate.length; denseIndex++) {
                query.refresh(candidate.entityIndices[denseIndex] ?? 0);
            }
        }
        this.queriesByKey.set(key, query);
        this.queries.push(query);
        return query;
    }

    /** Execute fixed and variable World phases once. Rendering is owned by a future Engine layer. */
    update(deltaTimeMilliseconds: number): void {
        this.beginFrame(deltaTimeMilliseconds);
        this.finishFrame();
    }

    /** Execute all phases through render extraction, leaving cleanup for Engine. @internal */
    beginFrame(deltaTimeMilliseconds: number): void {
        this.requireActive('update');
        if (this.updating || this.framePending) throw new Error('World updates cannot be nested.');
        const requestedDelta = requireFiniteNonNegative(
            deltaTimeMilliseconds,
            'deltaTimeMilliseconds'
        );
        const delta =
            requestedDelta < this.maxDeltaMilliseconds ? requestedDelta : this.maxDeltaMilliseconds;
        this.totalDroppedTimeMilliseconds += requestedDelta - delta;
        this.updating = true;
        this.phaseDurations.fill(0);
        try {
            this.runAndFlush('input', delta, 0);
            this.fixedAccumulatorMilliseconds += delta;
            let fixedSteps = 0;
            while (
                this.fixedAccumulatorMilliseconds >= this.fixedDeltaMilliseconds &&
                fixedSteps < this.maxSubSteps
            ) {
                this.runPhaseTimed('fixed-pre-physics', this.fixedDeltaMilliseconds, fixedSteps, 0);
                this.runPhaseTimed('physics', this.fixedDeltaMilliseconds, fixedSteps, 0);
                this.runPhaseTimed(
                    'fixed-post-physics',
                    this.fixedDeltaMilliseconds,
                    fixedSteps,
                    0
                );
                this.commands.apply(this);
                this.fixedAccumulatorMilliseconds -= this.fixedDeltaMilliseconds;
                this.completedFixedStepCount++;
                fixedSteps++;
            }
            if (this.fixedAccumulatorMilliseconds >= this.fixedDeltaMilliseconds) {
                const droppedSteps = Math.floor(
                    this.fixedAccumulatorMilliseconds / this.fixedDeltaMilliseconds
                );
                const dropped = droppedSteps * this.fixedDeltaMilliseconds;
                this.fixedAccumulatorMilliseconds -= dropped;
                this.totalDroppedTimeMilliseconds += dropped;
            }
            const interpolationAlpha =
                this.fixedAccumulatorMilliseconds / this.fixedDeltaMilliseconds;
            this.runAndFlush('update', delta, interpolationAlpha);
            this.runAndFlush('animation', delta, interpolationAlpha);
            this.runAndFlush('transform', delta, interpolationAlpha);
            this.runAndFlush('render-extract', delta, interpolationAlpha);
            this.pendingDeltaMilliseconds = delta;
            this.pendingInterpolationAlpha = interpolationAlpha;
            this.framePending = true;
        } catch (cause) {
            this.commands.clear();
            throw cause;
        } finally {
            this.updating = false;
        }
    }

    /** Execute cleanup after Engine rendering, whether presentation succeeded or failed. @internal */
    finishFrame(): void {
        this.requireActive('finish a frame');
        if (!this.framePending || this.updating) {
            throw new Error('World has no extracted frame awaiting cleanup.');
        }
        this.updating = true;
        try {
            this.runAndFlush(
                'cleanup',
                this.pendingDeltaMilliseconds,
                this.pendingInterpolationAlpha
            );
            this.completedFrameCount++;
        } catch (cause) {
            this.commands.clear();
            throw cause;
        } finally {
            this.updating = false;
            this.framePending = false;
            this.pendingDeltaMilliseconds = 0;
            this.pendingInterpolationAlpha = 0;
        }
    }

    /** Install one System outside a running phase and rebuild the compiled schedule. */
    async installSystem(system: WorldSystem): Promise<void> {
        this.requireActive('install a System');
        await this.systems.install(system);
    }

    /** Remove a leaf System outside a running phase. */
    uninstallSystem(id: string): void {
        this.requireActive('uninstall a System');
        this.systems.uninstall(id);
    }

    /** Read a required typed resource published by a System. */
    getResource<T>(resource: WorldResource<T>): T {
        return this.systems.get(resource);
    }

    /** Read an optional typed resource published by a System. */
    getOptionalResource<T>(resource: WorldResource<T>): T | undefined {
        return this.systems.getOptional(resource);
    }

    /** Return a stable diagnostics snapshot. Phase durations are zero unless explicitly enabled. */
    getDiagnostics(): WorldDiagnostics {
        return {
            entityCount: this.entities.size,
            entityCapacity: this.entities.capacity,
            componentTypeCount: this.registrationsById.length,
            queryCount: this.queries.length,
            frameCount: this.completedFrameCount,
            fixedStepCount: this.completedFixedStepCount,
            interpolationAlpha: this.fixedAccumulatorMilliseconds / this.fixedDeltaMilliseconds,
            droppedTimeMilliseconds: this.totalDroppedTimeMilliseconds,
            queuedCommandCount: this.commands.length,
            phaseDurationsMilliseconds: Object.freeze(
                Object.fromEntries(
                    WORLD_SYSTEM_PHASES.map((phase, index) => [
                        phase,
                        this.phaseDurations[index] ?? 0
                    ])
                ) as Record<WorldSystemPhase, number>
            )
        };
    }

    /** Destroy Systems, components, queries, and pending commands exactly once. */
    destroy(): void {
        if (this.destroyed) return;
        if (this.systemDispatching || this.updating || this.framePending) {
            throw new Error('Cannot destroy a World during System execution or update.');
        }
        this.destroyed = true;
        let systemError: unknown;
        try {
            this.systems.destroy();
        } catch (cause) {
            systemError = cause;
        } finally {
            this.commands.clear();
            for (const query of this.queries) query.clear();
            for (const registration of this.registrationsById) registration.store.clear();
            this.queries.length = 0;
            this.queriesByKey.clear();
            this.registrations.clear();
            this.registrationsById.length = 0;
            this.structureListeners.length = 0;
            this.entities.clear();
        }
        if (systemError instanceof Error) throw systemError;
        if (systemError !== undefined) {
            throw new Error('A World System threw a non-Error value during destruction.', {
                cause: systemError
            });
        }
    }

    /** @internal */
    beginSystemDispatch(): void {
        if (this.systemDispatching) throw new Error('World System dispatch is already active.');
        this.systemDispatching = true;
    }

    /** @internal */
    endSystemDispatch(): void {
        this.systemDispatching = false;
    }

    /** @internal */
    componentTypeId(component: ComponentType<unknown>): number {
        return this.requireRegistration(component).id;
    }

    /** @internal */
    validateComponentValue(component: ComponentType<unknown>, value: unknown): void {
        this.requireWritableComponent(component);
        this.requireRegistration(component).store.validate(value);
    }

    /** @internal */
    addErased(entity: Entity, component: ComponentType<unknown>, value: unknown): void {
        this.requireStructuralMutation(`add component ${component.name}`);
        this.requireWritableComponent(component);
        const entityIndex = this.entities.requireAliveIndex(entity);
        const registration = this.requireRegistration(component);
        registration.store.add(entityIndex, value);
        this.refreshQueries(entityIndex);
        this.notifyStructureChange(entityIndex, component);
    }

    /** @internal */
    setErased(entity: Entity, component: ComponentType<unknown>, value: unknown): void {
        this.requireActive(`set component ${component.name}`);
        this.requireWritableComponent(component);
        const entityIndex = this.entities.requireAliveIndex(entity);
        const registration = this.registrations.get(component);
        if (!registration) {
            throw new ReferenceError(
                `Component ${component.name} is not registered in this World.`
            );
        }
        registration.store.set(entityIndex, value);
    }

    /** @internal */
    removeErased(entity: Entity, component: ComponentType<unknown>): boolean {
        this.requireStructuralMutation(`remove component ${component.name}`);
        this.requireWritableComponent(component);
        const entityIndex = this.entities.requireAliveIndex(entity);
        const registration = this.registrations.get(component);
        if (!registration) return false;
        const removed = registration.store.remove(entityIndex);
        if (removed) {
            this.refreshQueries(entityIndex);
            this.notifyStructureChange(entityIndex, component);
        }
        return removed;
    }

    /** @internal */
    hasErased(entity: Entity, component: ComponentType<unknown>): boolean {
        const entityIndex = this.entities.requireAliveIndex(entity);
        return this.registrations.get(component)?.store.has(entityIndex) ?? false;
    }

    private runAndFlush(
        phase: WorldSystemPhase,
        deltaTimeMilliseconds: number,
        interpolationAlpha: number
    ): void {
        this.runPhaseTimed(phase, deltaTimeMilliseconds, 0, interpolationAlpha);
        this.commands.apply(this);
    }

    private runPhaseTimed(
        phase: WorldSystemPhase,
        deltaTimeMilliseconds: number,
        fixedStepIndex: number,
        interpolationAlpha: number
    ): void {
        if (!this.measurePhaseDurations) {
            this.systems.runPhase(phase, deltaTimeMilliseconds, fixedStepIndex, interpolationAlpha);
            return;
        }
        const start = performance.now();
        this.systems.runPhase(phase, deltaTimeMilliseconds, fixedStepIndex, interpolationAlpha);
        const index = WORLD_SYSTEM_PHASES.indexOf(phase);
        this.phaseDurations[index] =
            (this.phaseDurations[index] ?? 0) + (performance.now() - start);
    }

    private requireRegistration<T>(component: ComponentType<T>): ComponentRegistration {
        this.requireActive(`register component ${component.name}`);
        const existing = this.registrations.get(component);
        if (existing) return existing;
        if (this.systemDispatching) {
            throw new Error(
                `Component ${component.name} must be registered during setup, not System execution.`
            );
        }
        const erased = component as ComponentType<unknown>;
        const registration: ComponentRegistration = {
            id: this.registrationsById.length,
            type: erased,
            store: component.createStore(this.entities.capacity)
        };
        this.registrations.set(erased, registration);
        this.registrationsById.push(registration);
        return registration;
    }

    private requireWritableComponent(component: ComponentType<unknown>): void {
        if (!component.writable) {
            throw new TypeError(
                `Derived component ${component.name} is read-only and owned by its System.`
            );
        }
    }

    private normalizeComponentTypes(
        components: readonly ComponentType<unknown>[],
        label: string
    ): readonly ComponentType<unknown>[] {
        const registrations = components.map(component => this.requireRegistration(component));
        registrations.sort((left, right) => left.id - right.id);
        for (let index = 1; index < registrations.length; index++) {
            if (registrations[index - 1]?.id === registrations[index]?.id) {
                throw new TypeError(
                    `World query declares duplicate ${label} component ${registrations[index]?.type.name ?? ''}.`
                );
            }
        }
        return Object.freeze(registrations.map(registration => registration.type));
    }

    private refreshQueries(entityIndex: number): void {
        for (const query of this.queries) query.refresh(entityIndex);
    }

    private notifyStructureChange(
        entityIndex: number,
        component: ComponentType<unknown> | null
    ): void {
        let index = 0;
        while (index < this.structureListeners.length) {
            this.structureListeners[index]?.(entityIndex, component);
            index++;
        }
    }

    private ensureEntityCapacity(capacity: number): void {
        for (const registration of this.registrationsById) {
            registration.store.ensureEntityCapacity(capacity);
        }
        for (const query of this.queries) query.ensureEntityCapacity(capacity);
    }

    private requireStructuralMutation(operation: string): void {
        this.requireActive(operation);
        if (this.systemDispatching) {
            throw new Error(
                `Cannot ${operation} during System execution; use the World command buffer.`
            );
        }
        if (this.framePending) {
            throw new Error(`Cannot ${operation} between render extraction and frame cleanup.`);
        }
    }

    private requireActive(operation: string): void {
        if (this.destroyed) throw new Error(`Cannot ${operation} after the World is destroyed.`);
    }
}
