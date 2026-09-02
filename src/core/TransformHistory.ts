const revisions = new WeakMap<object, number>();

/** @internal Monotonic application-controlled discontinuity revision. */
export function getTransformHistoryRevision(node: object): number {
    return revisions.get(node) ?? 0;
}

/** @internal Mark a transform discontinuity without changing CPU scene identity. */
export function invalidateTransformHistory(node: object): void {
    revisions.set(node, getTransformHistoryRevision(node) + 1);
}
