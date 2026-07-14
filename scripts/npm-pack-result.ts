export interface NpmPackResult {
    readonly filename: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

/** Normalize the array and package-keyed object shapes emitted by supported npm versions. */
export function parseNpmPackResult(output: string): NpmPackResult {
    const parsed = JSON.parse(output) as unknown;
    const candidates = isUnknownArray(parsed)
        ? parsed
        : isRecord(parsed)
          ? Object.values(parsed)
          : [];

    if (candidates.length !== 1) {
        throw new Error(`Unexpected npm pack response: ${output}`);
    }

    const result = candidates[0];
    if (!isRecord(result) || typeof result['filename'] !== 'string' || !result['filename']) {
        throw new Error(`Unexpected npm pack response: ${output}`);
    }
    return { filename: result['filename'] };
}
