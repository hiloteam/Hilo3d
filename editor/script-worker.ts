import type { SceneNode } from './scene';
import type { ScriptInput } from './script-runtime';

type TransformMap = Record<string, SceneNode['transform']>;
type Vector = SceneNode['transform']['position'];

export interface ScriptWorkerBinding {
    nodeId: string;
    scriptId: string;
    name: string;
    source: string;
}

interface ScriptWorkerCommand {
    id: number;
    type: 'start' | 'step' | 'stop';
    bindings: ScriptWorkerBinding[];
    transforms: TransformMap;
    names: Record<string, string>;
    input: ScriptInput;
    dt: number;
    time: number;
}

interface ScriptWorkerResponse {
    id: number;
    transforms?: TransformMap;
    logs: string[];
    error?: string;
}

/** The installer needs only the dedicated worker's message boundary. */
export interface ScriptWorkerScope {
    onmessage: ((event: MessageEvent<ScriptWorkerCommand>) => void) | null;
    postMessage(message: ScriptWorkerResponse): void;
}

interface ScriptContext {
    readonly id: string;
    readonly name: string;
    readonly time: number;
    readonly position: Readonly<Vector>;
    readonly rotation: Readonly<Vector>;
    readonly scale: Readonly<Vector>;
    readonly input: Readonly<ScriptInput>;
    setPosition(x: number, y: number, z: number): void;
    translate(x: number, y: number, z: number): void;
    setRotation(x: number, y: number, z: number): void;
    rotate(x: number, y: number, z: number): void;
    setScale(x: number, y?: number, z?: number): void;
    log(message: unknown): void;
}

interface RuntimeBinding extends ScriptWorkerBinding {
    handlers: Record<string, unknown>;
}

/**
 * Serialized after TypeScript compilation into a worker in the opaque sandbox frame. Keep every
 * runtime helper and constant inside this function: its function source must have no module captures.
 */
export function installScriptWorker(scope: ScriptWorkerScope): void {
    'use strict';
    let bindings: RuntimeBinding[] = [];
    let transforms: TransformMap = {};
    let names: Record<string, string> = {};
    let logs: string[] = [];
    let input: ScriptInput = { keys: [], pointer: { x: 0, y: 0, buttons: 0 } };

    function finite(
        values: readonly [unknown, unknown, unknown],
        min: number,
        max: number
    ): Vector {
        function component(value: unknown): number {
            if (
                typeof value !== 'number' ||
                !Number.isFinite(value) ||
                value < min ||
                value > max
            ) {
                throw new Error('Script produced an out-of-range transform');
            }
            return value;
        }
        return { x: component(values[0]), y: component(values[1]), z: component(values[2]) };
    }

    function context(binding: RuntimeBinding, time: number): ScriptContext {
        const value = transforms[binding.nodeId];
        if (!value) throw new Error('Script target no longer exists');
        return Object.freeze({
            id: binding.nodeId,
            name: names[binding.nodeId] ?? binding.name,
            time,
            get position(): Readonly<Vector> {
                return Object.freeze({ ...value.position });
            },
            get rotation(): Readonly<Vector> {
                return Object.freeze({ ...value.rotation });
            },
            get scale(): Readonly<Vector> {
                return Object.freeze({ ...value.scale });
            },
            input: Object.freeze({
                keys: Object.freeze([...input.keys]),
                pointer: Object.freeze({ ...input.pointer })
            }),
            setPosition(x: number, y: number, z: number): void {
                value.position = finite([x, y, z], -10_000, 10_000);
            },
            translate(x: number, y: number, z: number): void {
                value.position = finite(
                    [value.position.x + x, value.position.y + y, value.position.z + z],
                    -10_000,
                    10_000
                );
            },
            setRotation(x: number, y: number, z: number): void {
                value.rotation = finite([x, y, z], -360_000, 360_000);
            },
            rotate(x: number, y: number, z: number): void {
                value.rotation = finite(
                    [value.rotation.x + x, value.rotation.y + y, value.rotation.z + z],
                    -360_000,
                    360_000
                );
            },
            setScale(x: number, y = x, z = x): void {
                value.scale = finite([x, y, z], 0.001, 10_000);
            },
            log(message: unknown): void {
                if (logs.length < 32)
                    logs.push(`${binding.name}: ${String(message).slice(0, 500)}`);
            }
        });
    }

    function invoke(
        binding: RuntimeBinding,
        phase: 'start' | 'update' | 'stop',
        dt: number,
        time: number
    ): void {
        const handler = binding.handlers[phase];
        if (handler === undefined) return;
        if (typeof handler !== 'function')
            throw new Error(`${binding.name}: ${phase} must be a function`);
        const call = handler as (
            this: Record<string, unknown>,
            context: ScriptContext,
            deltaTime: number
        ) => unknown;
        const result = call.call(binding.handlers, context(binding, time), dt);
        if (
            ((typeof result === 'object' && result !== null) || typeof result === 'function') &&
            typeof Reflect.get(result, 'then') === 'function'
        ) {
            throw new Error('Script callbacks must be synchronous');
        }
    }

    scope.onmessage = (event: MessageEvent<ScriptWorkerCommand>): void => {
        const command = event.data;
        logs = [];
        try {
            transforms = command.transforms;
            names = command.names;
            input = command.input;
            if (command.type === 'start') {
                bindings = command.bindings.map((binding): RuntimeBinding => {
                    const source = binding.source.trim().replace(/;+\s*$/u, '');
                    // This is the explicit user-code evaluation boundary inside the isolated worker.
                    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- Explicit lifecycle evaluation inside the CSP-isolated worker, bounded by the host watchdog.
                    const evaluate = new Function(
                        `"use strict"; return (${source}\n);`
                    ) as () => unknown;
                    const handlers = evaluate();
                    if (!handlers || typeof handlers !== 'object' || Array.isArray(handlers))
                        throw new Error(
                            `${binding.name}: source must evaluate to a lifecycle object`
                        );
                    return { ...binding, handlers: handlers as Record<string, unknown> };
                });
            }
            for (const binding of bindings) {
                if (!transforms[binding.nodeId]) continue;
                invoke(
                    binding,
                    command.type === 'start'
                        ? 'start'
                        : command.type === 'stop'
                          ? 'stop'
                          : 'update',
                    command.dt,
                    command.time
                );
            }
            const output: TransformMap = {};
            for (const binding of bindings) {
                const transform = transforms[binding.nodeId];
                if (transform) output[binding.nodeId] = transform;
            }
            scope.postMessage({ id: command.id, transforms: output, logs });
        } catch (error) {
            scope.postMessage({
                id: command.id,
                error: error instanceof Error ? error.message : String(error),
                logs
            });
        }
    };
}
