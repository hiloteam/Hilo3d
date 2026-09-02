import type { ComponentType } from './Component';
import type { Entity } from './Entity';
import type World from './World';

const MIN_COMMAND_CAPACITY = 32;

const enum CommandKind {
    Spawn = 1,
    Destroy = 2,
    Add = 3,
    Set = 4,
    Remove = 5
}

declare const pendingEntityBrand: unique symbol;

/** Temporary identity for an Entity that will become live at the next structural sync point. */
export type PendingEntity = number & { readonly [pendingEntityBrand]: 'PendingEntity' };

/** Entity target accepted by deferred structural commands. */
export type CommandEntity = Entity | PendingEntity;

function isPendingEntity(target: CommandEntity): target is PendingEntity {
    return target < 0;
}

/** Reused structure-of-arrays command buffer for mutations requested during System execution. */
export class WorldCommandBuffer {
    private kinds = new Uint8Array(MIN_COMMAND_CAPACITY);
    private targets = new Float64Array(MIN_COMMAND_CAPACITY);
    private components: (ComponentType<unknown> | undefined)[] = new Array<
        ComponentType<unknown> | undefined
    >(MIN_COMMAND_CAPACITY);
    private values: unknown[] = new Array<unknown>(MIN_COMMAND_CAPACITY);
    private commandCount = 0;
    private nextPendingIdentity = -1;
    private readonly resolvedEntities = new Map<PendingEntity, Entity>();
    private readonly pendingValidation = new Set<PendingEntity>();
    private readonly destroyedValidation = new Set<CommandEntity>();
    private readonly componentPresenceValidation = new Map<
        ComponentType<unknown>,
        Map<CommandEntity, boolean>
    >();

    /** Number of queued commands. */
    get length(): number {
        return this.commandCount;
    }

    /** Current high-water command capacity. */
    get capacity(): number {
        return this.kinds.length;
    }

    /** Queue one new Entity and return a token usable by later commands in this batch. */
    spawn(): PendingEntity {
        if (!Number.isSafeInteger(this.nextPendingIdentity)) {
            throw new RangeError('The deferred Entity identity space is exhausted.');
        }
        const pending = this.nextPendingIdentity as PendingEntity;
        this.nextPendingIdentity--;
        this.push(CommandKind.Spawn, pending, undefined, undefined);
        return pending;
    }

    /** Queue destruction of an existing or pending Entity. */
    destroy(entity: CommandEntity): void {
        this.push(CommandKind.Destroy, entity, undefined, undefined);
    }

    /** Queue a component addition. */
    add<T>(entity: CommandEntity, component: ComponentType<T>, value: T): void {
        this.push(CommandKind.Add, entity, component, value);
    }

    /** Queue replacement of an existing component value. */
    set<T>(entity: CommandEntity, component: ComponentType<T>, value: T): void {
        this.push(CommandKind.Set, entity, component, value);
    }

    /** Queue removal of an existing component. */
    remove<T>(entity: CommandEntity, component: ComponentType<T>): void {
        this.push(CommandKind.Remove, entity, component, undefined);
    }

    /** Resolve a token after its batch was successfully applied. */
    resolve(entity: PendingEntity): Entity {
        const resolved = this.resolvedEntities.get(entity);
        if (resolved === undefined) {
            throw new ReferenceError(`Pending Entity ${String(entity)} has not been resolved.`);
        }
        return resolved;
    }

    /** Drop queued and previously resolved state while retaining high-water buffers. */
    clear(): void {
        this.releaseReferences();
        this.commandCount = 0;
        this.resolvedEntities.clear();
        this.clearValidationScratch();
    }

    /** Validate then apply one structural batch. Intended only for World synchronization points. */
    apply(world: World): void {
        if (this.commandCount === 0) return;
        this.resolvedEntities.clear();
        try {
            this.validate(world);
            for (let index = 0; index < this.commandCount; index++) {
                if (this.kinds[index] !== CommandKind.Spawn) continue;
                const pending = (this.targets[index] ?? 0) as PendingEntity;
                this.resolvedEntities.set(pending, world.createEntity());
            }
            for (let index = 0; index < this.commandCount; index++) {
                const kind = this.kinds[index];
                if (kind === CommandKind.Spawn) continue;
                const target = (this.targets[index] ?? 0) as CommandEntity;
                const entity = isPendingEntity(target) ? this.resolve(target) : target;
                const component = this.components[index];
                switch (kind) {
                    case CommandKind.Destroy:
                        world.destroyEntity(entity);
                        break;
                    case CommandKind.Add:
                        world.addErased(
                            entity,
                            this.requireComponent(component),
                            this.values[index]
                        );
                        break;
                    case CommandKind.Set:
                        world.setErased(
                            entity,
                            this.requireComponent(component),
                            this.values[index]
                        );
                        break;
                    case CommandKind.Remove:
                        world.removeErased(entity, this.requireComponent(component));
                        break;
                    default:
                        throw new TypeError(`Unknown World command ${String(kind)}.`);
                }
            }
        } finally {
            this.releaseReferences();
            this.commandCount = 0;
        }
    }

    private push(
        kind: CommandKind,
        target: CommandEntity,
        component: ComponentType<unknown> | undefined,
        value: unknown
    ): void {
        this.ensureCapacity(this.commandCount + 1);
        const index = this.commandCount;
        this.commandCount++;
        this.kinds[index] = kind;
        this.targets[index] = target;
        this.components[index] = component;
        this.values[index] = value;
    }

    private validate(world: World): void {
        const pending = this.pendingValidation;
        const destroyed = this.destroyedValidation;
        try {
            for (let index = 0; index < this.commandCount; index++) {
                if (this.kinds[index] === CommandKind.Spawn) {
                    pending.add((this.targets[index] ?? 0) as PendingEntity);
                }
            }
            for (let index = 0; index < this.commandCount; index++) {
                const kind = this.kinds[index];
                if (kind === CommandKind.Spawn) continue;
                const target = (this.targets[index] ?? 0) as CommandEntity;
                if (isPendingEntity(target)) {
                    if (!pending.has(target)) {
                        throw new ReferenceError(
                            `Pending Entity ${String(target)} does not belong to this command batch.`
                        );
                    }
                } else if (!world.isAlive(target)) {
                    throw new ReferenceError(
                        `Entity ${String(target)} is not alive in this World.`
                    );
                }
                if (destroyed.has(target)) {
                    throw new ReferenceError(
                        `Command targets Entity ${String(target)} after it was queued for destruction.`
                    );
                }
                if (kind === CommandKind.Destroy) {
                    destroyed.add(target);
                    continue;
                }
                const component = this.requireComponent(this.components[index]);
                if (!component.writable) {
                    throw new TypeError(
                        `Derived component ${component.name} is read-only and owned by its System.`
                    );
                }
                world.componentTypeId(component);
                let componentPresence = this.componentPresenceValidation.get(component);
                if (componentPresence === undefined) {
                    componentPresence = new Map<CommandEntity, boolean>();
                    this.componentPresenceValidation.set(component, componentPresence);
                }
                const knownPresence = componentPresence.get(target);
                const present =
                    knownPresence ??
                    (isPendingEntity(target) ? false : world.hasErased(target, component));
                if (kind === CommandKind.Add) {
                    if (present) {
                        throw new TypeError(
                            `Entity ${String(target)} already has component ${component.name}.`
                        );
                    }
                    world.validateComponentValue(component, this.values[index]);
                    componentPresence.set(target, true);
                } else if (kind === CommandKind.Set) {
                    if (!present) {
                        throw new ReferenceError(
                            `Entity ${String(target)} does not have component ${component.name}.`
                        );
                    }
                    world.validateComponentValue(component, this.values[index]);
                } else if (kind === CommandKind.Remove) {
                    if (!present) {
                        throw new ReferenceError(
                            `Entity ${String(target)} does not have component ${component.name}.`
                        );
                    }
                    componentPresence.set(target, false);
                }
            }
        } finally {
            this.clearValidationScratch();
        }
    }

    private clearValidationScratch(): void {
        this.pendingValidation.clear();
        this.destroyedValidation.clear();
        for (const presence of this.componentPresenceValidation.values()) presence.clear();
    }

    private requireComponent(
        component: ComponentType<unknown> | undefined
    ): ComponentType<unknown> {
        if (component === undefined) throw new TypeError('World component command is incomplete.');
        return component;
    }

    private releaseReferences(): void {
        for (let index = 0; index < this.commandCount; index++) {
            this.components[index] = undefined;
            this.values[index] = undefined;
        }
    }

    private ensureCapacity(required: number): void {
        if (required <= this.capacity) return;
        let capacity = this.capacity;
        while (capacity < required) capacity *= 2;
        const kinds = new Uint8Array(capacity);
        kinds.set(this.kinds);
        this.kinds = kinds;
        const targets = new Float64Array(capacity);
        targets.set(this.targets);
        this.targets = targets;
        this.components.length = capacity;
        this.values.length = capacity;
    }
}
