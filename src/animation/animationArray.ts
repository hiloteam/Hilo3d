/** @internal Checked access to validated animation storage. */
export function animationItem<T>(values: ArrayLike<T>, index: number): T {
    const value = values[index];
    if (value === undefined) throw new RangeError('Animation storage index out of range.');
    return value;
}
