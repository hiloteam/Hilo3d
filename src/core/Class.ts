type ClassLike = abstract new (...params: never[]) => object;

// `Class.create` is a public compatibility API that deliberately accepts
// runtime-defined members. Keep the unsafe escape hatch isolated here instead
// of weakening every engine module. Known public members are contextualized by
// the declaration file; genuinely private legacy members remain `unknown`.
export type DynamicMembers = Record<string, unknown>;

export interface RuntimeClassLike {
    prototype: object;
    superclass?: object;
}

type ClassDefinition<Static extends ClassLike> = DynamicMembers &
    ThisType<InstanceType<Static> & DynamicMembers & { constructor: Static }> & {
        Extends?: RuntimeClassLike;
        Mixes?: object | RuntimeClassLike | readonly (object | RuntimeClassLike)[];
        Statics?: DynamicMembers & ThisType<Static & DynamicMembers>;
    };

type LegacyClass<Static extends ClassLike> = Static &
    DynamicMembers & {
        superclass: InstanceType<Static>;
    };

export type InferredClass<Definition extends object> = (new (
    ...params: readonly unknown[]
) => Definition) & { superclass: Definition };

type DescriptorRecord = Record<PropertyKey, PropertyDescriptor>;
type MutableRecord = Record<PropertyKey, unknown>;

function isPropertyDescriptor(value: unknown): value is PropertyDescriptor {
    if (typeof value !== 'object' || value === null) return false;
    return 'value' in value || 'get' in value || 'set' in value;
}

/**
 * 将一个或多个对象的成员混入目标对象，并保留 Hilo3d 旧版的属性描述符语义。
 */
export function mix<Target extends object>(target: Target, ...sources: readonly unknown[]): Target {
    const targetRecord = target as MutableRecord;

    for (const source of sources) {
        if ((typeof source !== 'object' && typeof source !== 'function') || source === null)
            continue;

        const descriptors: DescriptorRecord = {};
        for (const key of Object.keys(source)) {
            const value = (source as MutableRecord)[key];
            if (isPropertyDescriptor(value)) {
                descriptors[key] = value;
            } else {
                targetRecord[key] = value;
            }
        }

        if (Reflect.ownKeys(descriptors).length > 0) {
            Object.defineProperties(target, descriptors);
        }
    }

    return target;
}

function asClassLike(value: unknown): RuntimeClassLike | null {
    if (typeof value !== 'function') return null;
    const prototype: unknown = Reflect.get(value, 'prototype');
    return typeof prototype === 'object' && prototype !== null ? value : null;
}

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

function applyDefinition(clazz: RuntimeClassLike, properties: Record<string, unknown>): void {
    const prototypeMembers: MutableRecord = {};

    for (const [key, value] of Object.entries(properties)) {
        switch (key) {
            case 'constructor':
                break;
            case 'Extends': {
                const parent = asClassLike(value);
                if (!parent) break;

                const existingPrototype = clazz.prototype;
                const prototype = Object.create(parent.prototype) as MutableRecord;
                mix(clazz, parent);
                mix(prototype, existingPrototype);
                Reflect.set(prototype, 'constructor', clazz);
                clazz.prototype = prototype;
                clazz.superclass = parent.prototype;
                break;
            }
            case 'Mixes': {
                const items = isUnknownArray(value) ? value : [value];
                for (const item of items) {
                    if ((typeof item !== 'object' && typeof item !== 'function') || item === null)
                        continue;
                    const sourceClass = asClassLike(item);
                    mix(clazz.prototype, sourceClass?.prototype ?? item);
                }
                break;
            }
            case 'Statics':
                if (typeof value === 'object' && value !== null) mix(clazz, value);
                break;
            default:
                prototypeMembers[key] = value;
        }
    }

    mix(clazz.prototype, prototypeMembers);
}

/**
 * Hilo3d 的兼容类工厂。新代码优先使用原生 `class`，该工厂用于保持既有公共 API
 * 和原型布局，同时为旧模块提供完整的 TypeScript 上下文类型。
 */
export function create<Static extends ClassLike>(): (
    properties: ClassDefinition<Static>
) => LegacyClass<Static>;
export function create<Definition extends object>(
    properties: Definition &
        DynamicMembers &
        ThisType<
            Definition &
                DynamicMembers & {
                    constructor: InferredClass<Definition>;
                }
        >
): InferredClass<Definition> & DynamicMembers;
export function create<Definition extends object>(
    properties?: Definition
): InferredClass<Definition> | ((definition: Definition) => InferredClass<Definition>) {
    if (properties === undefined) {
        return (definition: Definition) => createRuntimeClass(definition);
    }
    return createRuntimeClass(properties);
}

function createRuntimeClass<Definition extends object>(
    properties: Definition
): InferredClass<Definition> {
    const definition = properties as Definition & Record<string, unknown>;
    const hasConstructor = Object.prototype.hasOwnProperty.call(definition, 'constructor');
    const userConstructor =
        hasConstructor && typeof definition.constructor === 'function'
            ? definition.constructor
            : null;
    const clazz = function DynamicClass(this: object, ...params: readonly unknown[]): unknown {
        return userConstructor ? Reflect.apply(userConstructor, this, params) : undefined;
    } as unknown as InferredClass<Definition>;

    applyDefinition(clazz, definition);
    return clazz;
}

const Class = { create, mix } as const;

export type { ClassDefinition, ClassLike, LegacyClass };
export default Class;
