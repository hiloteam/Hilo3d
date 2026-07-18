export const UNIFORM_BLOCK_BINDINGS = Object.freeze({
    FrameBlock: 0,
    CameraBlock: 1,
    SceneBlock: 2,
    LightBlock: 3,
    MaterialBlock: 4,
    ModelBlock: 5,
    GeometryBlock: 6,
    SkinningBlock: 7,
    MorphBlock: 8
} as const);
export const BUILTIN_UNIFORM_BLOCK_BINDING_COUNT = 9;

const bindings = new Map<string, number>(Object.entries(UNIFORM_BLOCK_BINDINGS));
const FIRST_CUSTOM_BINDING_POINT = BUILTIN_UNIFORM_BLOCK_BINDING_COUNT;

/** Register an application block before linking programs. Binding points must be globally stable. */
export function registerUniformBlockBinding(name: string, bindingPoint?: number): number {
    if (!name) throw new TypeError('Uniform block name cannot be empty');
    const current = bindings.get(name);
    if (current !== undefined) {
        if (bindingPoint !== undefined && current !== bindingPoint) {
            throw new Error(
                `${name} is already assigned to uniform block binding point ${String(current)}`
            );
        }
        return current;
    }
    if (bindingPoint === undefined) {
        const occupied = new Set(bindings.values());
        bindingPoint = FIRST_CUSTOM_BINDING_POINT;
        while (occupied.has(bindingPoint)) bindingPoint++;
    }
    if (!Number.isSafeInteger(bindingPoint) || bindingPoint < 0) {
        throw new RangeError('Uniform block binding point must be a non-negative integer');
    }
    for (const [registeredName, registeredPoint] of bindings) {
        if (registeredName !== name && registeredPoint === bindingPoint) {
            throw new Error(
                `Uniform block binding point ${String(bindingPoint)} is already assigned to ${registeredName}`
            );
        }
    }
    bindings.set(name, bindingPoint);
    return bindingPoint;
}

export function getUniformBlockBinding(name: string): number {
    const bindingPoint = bindings.get(name);
    if (bindingPoint === undefined) {
        throw new Error(
            `Uniform block ${name} has no fixed binding point; call registerUniformBlockBinding before linking`
        );
    }
    return bindingPoint;
}
