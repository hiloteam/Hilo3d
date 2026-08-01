import type Node from './Node';

const revisions = new WeakMap<Node, number>();

/** @internal Monotonic application-controlled discontinuity revision. */
export function getTransformHistoryRevision(node: Node): number {
    return revisions.get(node) ?? 0;
}

/** @internal Mark a transform discontinuity without changing CPU scene identity. */
export function invalidateTransformHistory(node: Node): void {
    revisions.set(node, getTransformHistoryRevision(node) + 1);
}
