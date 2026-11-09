/** Spatial RGB contrast; a solid colored clear or alpha-only variation is not scene evidence. */
export function srpSpatialPixelRange(pixels: Uint8Array): number {
    if (pixels.length === 0 || pixels.length % 4 !== 0)
        throw new Error('SRP pixels must be complete RGBA texels');
    let range = 0;
    for (let component = 0; component < 3; component++) {
        let minimum = 255;
        let maximum = 0;
        for (let offset = component; offset < pixels.length; offset += 4) {
            const value = pixels[offset];
            if (value === undefined) throw new Error('Missing SRP pixel component');
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
        }
        range = Math.max(range, maximum - minimum);
    }
    return range;
}

/** Reject missing or invalid samples instead of treating unavailable metrics as zero. */
export function summarizeSRPSamples(values: readonly number[]): {
    median: number;
    p95: number;
    min: number;
    max: number;
} {
    if (values.length === 0 || values.some(value => !Number.isFinite(value) || value < 0))
        throw new Error('SRP samples must be finite nonnegative observations');
    const sorted = [...values].sort((a, b) => a - b);
    const at = (index: number): number => {
        const value = sorted[index];
        if (value === undefined) throw new Error('Missing SRP sample');
        return value;
    };
    return {
        median: at(Math.floor(sorted.length / 2)),
        p95: at(Math.ceil(sorted.length * 0.95) - 1),
        min: at(0),
        max: at(sorted.length - 1)
    };
}

function record(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Malformed SRP allocation profile');
    return value as Record<string, unknown>;
}

/** One-byte CDP sampling, restricted to synchronous engine descendants of the fixture frame. */
export function srpAllocationBytes(value: unknown): number {
    const root = record(record(value)['profile'])['head'];
    const state = { sawBoundary: false, total: 0 };
    const visit = (nodeValue: unknown, inside: boolean, engine: boolean): void => {
        const node = record(nodeValue);
        const frame = record(node['callFrame']);
        const url = typeof frame['url'] === 'string' ? frame['url'] : '';
        const boundary =
            frame['functionName'] === 'renderSRPAllocationFrame' &&
            url.includes('/test/performance/fixtures/srp-production.ts');
        state.sawBoundary ||= boundary;
        inside ||= boundary;
        engine ||= inside && url.includes('/src/');
        const bytes = node['selfSize'];
        if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0)
            throw new Error('Invalid SRP allocation byte count');
        if (engine) state.total += bytes;
        const children = node['children'];
        if (children !== undefined) {
            if (!Array.isArray(children)) throw new Error('Invalid SRP allocation children');
            for (const child of children) visit(child, inside, engine);
        }
    };
    visit(root, false, false);
    if (!state.sawBoundary)
        throw new Error('SRP allocation profile has no synchronous frame boundary');
    return state.total;
}
