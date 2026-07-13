/** Resolve the engine's one-argument mutating and two-argument functional overloads. */
export function resolveOperands<Value>(
    current: Value,
    first: Value,
    second?: Value
): readonly [Value, Value] {
    return second === undefined ? [current, first] : [first, second];
}

/** Resolve an optional source operand to the current instance. */
export function resolveSource<Value>(current: Value, source?: Value): Value {
    return source ?? current;
}
