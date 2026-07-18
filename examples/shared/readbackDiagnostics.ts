/** Deterministic FNV-1a digest for tightly packed GPU readback bytes. */
export function hashReadback(data: Uint8Array): string {
    let hash = 0x811c9dc5;
    for (const value of data) {
        hash = Math.imul(hash ^ value, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Count RGBA texels whose native readback bytes changed. */
export function changedReadbackPixelCount(left: Uint8Array, right: Uint8Array): number {
    if (left.byteLength !== right.byteLength || left.byteLength % 4 !== 0) {
        throw new RangeError('Comparable RGBA readbacks must have equal four-byte texel lengths.');
    }
    let changed = 0;
    for (let offset = 0; offset < left.byteLength; offset += 4) {
        if (
            left[offset] !== right[offset] ||
            left[offset + 1] !== right[offset + 1] ||
            left[offset + 2] !== right[offset + 2] ||
            left[offset + 3] !== right[offset + 3]
        ) {
            changed++;
        }
    }
    return changed;
}

/** Count exact native RGBA8 texels in a readback. */
export function exactReadbackPixelCount(
    data: Uint8Array,
    color: readonly [red: number, green: number, blue: number, alpha: number]
): number {
    if (data.byteLength % 4 !== 0) {
        throw new RangeError('RGBA8 readbacks must contain complete four-byte texels.');
    }
    let matches = 0;
    for (let offset = 0; offset < data.byteLength; offset += 4) {
        if (
            data[offset] === color[0] &&
            data[offset + 1] === color[1] &&
            data[offset + 2] === color[2] &&
            data[offset + 3] === color[3]
        ) {
            matches++;
        }
    }
    return matches;
}
