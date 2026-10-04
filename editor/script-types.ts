export interface ScriptDocument {
    id: string;
    name: string;
    source: string;
    enabled: boolean;
}

/** Script source remains inert project data; execution requires an explicit Play command. */
export function validateScript(value: unknown): ScriptDocument {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Script must be an object.');
    const input = value as Record<string, unknown>;
    if (Object.keys(input).some(key => !['id', 'name', 'source', 'enabled'].includes(key)))
        throw new Error('Unknown script field.');
    const id = input['id'];
    const name = input['name'];
    const source = input['source'];
    const enabled = input['enabled'];
    if (
        typeof id !== 'string' ||
        id.length > 64 ||
        !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(id) ||
        id === 'constructor' ||
        id === 'prototype'
    )
        throw new Error('Invalid script ID.');
    if (typeof name !== 'string' || !name.trim() || name.length > 120)
        throw new Error('Script name must contain 1 to 120 characters.');
    if (
        typeof source !== 'string' ||
        source.length > 65536 ||
        new TextEncoder().encode(source).length > 65536
    )
        throw new Error('Script source exceeds 64 KiB.');
    if (typeof enabled !== 'boolean') throw new Error('Script enabled must be a boolean.');
    return { id, name, source, enabled };
}

export function createScript(id: string, name = 'Rotate object'): ScriptDocument {
    return validateScript({
        id,
        name,
        enabled: true,
        source: `({
  start(ctx) {
    ctx.log("Started " + ctx.name);
  },
  update(ctx, dt) {
    // dt is simulation time in seconds. Rotation uses degrees.
    ctx.rotate(0, 30 * dt, 0);
  }
})`
    });
}
