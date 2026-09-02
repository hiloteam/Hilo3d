/** Typed World-scoped service identity used by System setup and execution. */
export class WorldResource<T> {
    /** Human-readable diagnostics name. */
    readonly name: string;
    declare private readonly resourceType: T;

    constructor(name: string) {
        if (name.trim().length === 0) {
            throw new TypeError('World resource names cannot be empty.');
        }
        this.name = name;
    }
}

/** Create a typed World resource token whose object identity is the runtime key. */
export function defineWorldResource<T>(name: string): WorldResource<T> {
    return new WorldResource<T>(name);
}
