function nonNegativeSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${label} must be a non-negative safe integer`);
    }
}

export const RHI_PRODUCTION_MAX_IN_FLIGHT_FRAMES = 3;

export function benchmarkInFlightBatchIsFull(inFlightFrameCount: number): boolean {
    nonNegativeSafeInteger(inFlightFrameCount, 'Benchmark in-flight frame count');
    if (inFlightFrameCount > RHI_PRODUCTION_MAX_IN_FLIGHT_FRAMES) {
        throw new RangeError('Benchmark in-flight frame count exceeded its fixed limit');
    }
    return inFlightFrameCount === RHI_PRODUCTION_MAX_IN_FLIGHT_FRAMES;
}

/** Reserve material zero for the sole caster without reducing the active variant count. */
export function benchmarkMaterialIndex(
    drawIndex: number,
    materialCount: number,
    singleShadowCaster: boolean
): number {
    nonNegativeSafeInteger(drawIndex, 'Benchmark draw index');
    if (!Number.isSafeInteger(materialCount) || materialCount < 1) {
        throw new RangeError('Benchmark material count must be a positive safe integer');
    }
    if (!singleShadowCaster) return drawIndex % materialCount;
    if (materialCount < 2) {
        throw new RangeError('A shadow benchmark requires a dedicated caster material');
    }
    return drawIndex === 0 ? 0 : 1 + ((drawIndex - 1) % (materialCount - 1));
}

/** Every shadow benchmark owns exactly one caster in stable mesh slot zero. */
export function benchmarkMeshCastsShadow(meshSlot: number, shadowsEnabled: boolean): boolean {
    nonNegativeSafeInteger(meshSlot, 'Benchmark mesh slot');
    return shadowsEnabled && meshSlot === 0;
}

/**
 * Keep overlapping churn meshes visually deterministic even when the two render-list
 * implementations choose a different legal draw order. Slot zero remains nearest the camera.
 */
export function benchmarkMeshDepth(meshSlot: number, sceneChurn: boolean): number {
    nonNegativeSafeInteger(meshSlot, 'Benchmark mesh slot');
    return sceneChurn && meshSlot > 0 ? -meshSlot * 0.002 : 0;
}

export function benchmarkPrimaryDrawCount(
    totalDrawCount: number,
    postProcessDrawCount: number,
    shadowDrawCount: number
): number {
    if (!Number.isSafeInteger(totalDrawCount) || totalDrawCount < 1) {
        throw new RangeError('Benchmark total draw count must be a positive safe integer');
    }
    nonNegativeSafeInteger(postProcessDrawCount, 'Benchmark post-process draw count');
    nonNegativeSafeInteger(shadowDrawCount, 'Benchmark shadow draw count');
    const primary = totalDrawCount - postProcessDrawCount - shadowDrawCount;
    if (primary < 1) throw new RangeError('Benchmark scenario has no primary draws');
    return primary;
}
