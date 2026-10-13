import type { SceneDocument } from './scene';

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

/** Validated commands address the bound scene node, never native addon handles. */
export type ScriptComponentCommand =
    | { nodeId: string; type: 'applyImpulse'; x: number; y: number; z: number }
    | { nodeId: string; type: 'emitParticles'; count: number }
    | { nodeId: string; type: 'playAudio' | 'stopAudio' };

/** Treat worker replies as untrusted even though the worker context exposes only bounded helpers. */
export function validateScriptCommands(
    value: unknown,
    scene: SceneDocument,
    allowedNodeIds: ReadonlySet<string>
): ScriptComponentCommand[] {
    if (!Array.isArray(value) || value.length > 128)
        throw new Error('Scripts support at most 128 component commands per step.');
    const result: ScriptComponentCommand[] = [];
    for (const entry of value) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry))
            throw new Error('Invalid script component command.');
        const command = entry as Record<string, unknown>;
        const nodeId = command['nodeId'];
        if (
            typeof nodeId !== 'string' ||
            !allowedNodeIds.has(nodeId) ||
            !Object.hasOwn(scene.nodes, nodeId)
        )
            throw new Error('Script tried to command an unbound object.');
        const components = scene.nodes[nodeId]?.components;
        const type = command['type'];
        const allowed =
            type === 'applyImpulse'
                ? ['nodeId', 'type', 'x', 'y', 'z']
                : type === 'emitParticles'
                  ? ['nodeId', 'type', 'count']
                  : ['nodeId', 'type'];
        if (Object.keys(command).some(key => !allowed.includes(key)))
            throw new Error('Unknown script component command field.');
        if (type === 'applyImpulse') {
            if (components?.physics?.body !== 'dynamic')
                throw new Error('applyImpulse requires a dynamic physics component.');
            const x = command['x'];
            const y = command['y'];
            const z = command['z'];
            if (
                typeof x !== 'number' ||
                typeof y !== 'number' ||
                typeof z !== 'number' ||
                ![x, y, z].every(number => Number.isFinite(number) && Math.abs(number) <= 1e6)
            )
                throw new Error('Script impulse must be finite and within ±1000000.');
            result.push({ nodeId, type, x, y, z });
        } else if (type === 'emitParticles') {
            const count = command['count'];
            if (!components?.particles)
                throw new Error('emitParticles requires a particle component.');
            if (
                typeof count !== 'number' ||
                !Number.isSafeInteger(count) ||
                count < 1 ||
                count > 4096
            )
                throw new Error('Script particle count must be between 1 and 4096.');
            result.push({ nodeId, type, count });
        } else if (type === 'playAudio' || type === 'stopAudio') {
            if (!components?.audio) throw new Error(`${type} requires an audio component.`);
            result.push({ nodeId, type });
        } else throw new Error('Unknown script component command.');
    }
    return result;
}
