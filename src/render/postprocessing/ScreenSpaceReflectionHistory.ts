/** @internal Integer history count stored above fractional SSR confidence in rgba16float. */
export const MAX_HISTORY_SAMPLE_COUNT = 31;

/** @internal Shared compute packing and interpolation; never filter packed alpha directly. */
export const REFLECTION_HISTORY_WGSL = `
fn historySampleCount(packed: f32) -> f32 { return floor(max(packed, 0.0)); }
fn historyConfidence(packed: f32) -> f32 {
    return clamp(fract(max(packed, 0.0)) * 2.0, 0.0, 1.0);
}
fn packHistoryState(sampleCount: f32, confidence: f32) -> f32 {
    return round(clamp(sampleCount, 0.0, ${String(MAX_HISTORY_SAMPLE_COUNT)}.0)) +
        min(confidence, 0.999) * 0.5;
}
// Receiver motion follows the surface, not its reflected virtual image. Only use it
// to fill supported, nearly stationary misses; TAA jitter alone stays below two pixels.
fn reflectionMissHistoryWeight(velocityPixels: f32, hasCurrentSupport: bool, historyWeight: f32, continuity: f32) -> f32 {
    if (!hasCurrentSupport) { return 0.0; }
    return min(historyWeight, 0.82) * clamp(continuity, 0.0, 1.0) *
        (1.0 - smoothstep(2.0, 8.0, velocityPixels));
}
fn interpolateHistory(a: vec4<f32>, b: vec4<f32>, c: vec4<f32>, d: vec4<f32>, fraction: vec2<f32>) -> vec4<f32> {
    let weights = vec4<f32>(
        (1.0 - fraction.x) * (1.0 - fraction.y), fraction.x * (1.0 - fraction.y),
        (1.0 - fraction.x) * fraction.y, fraction.x * fraction.y
    );
    let counts = vec4<f32>(historySampleCount(a.a), historySampleCount(b.a), historySampleCount(c.a), historySampleCount(d.a));
    let confidence = vec4<f32>(historyConfidence(a.a), historyConfidence(b.a), historyConfidence(c.a), historyConfidence(d.a));
    return vec4<f32>(
        a.rgb * weights.x + b.rgb * weights.y + c.rgb * weights.z + d.rgb * weights.w,
        packHistoryState(dot(counts, weights), dot(confidence, weights))
    );
}`;
