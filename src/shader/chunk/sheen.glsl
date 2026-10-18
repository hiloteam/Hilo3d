// Conty Estevez / Kulla Charlie distribution and fitted visibility (SIGGRAPH 2017).
// https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_sheen
uniform sampler2D u_sheenAlbedoLUT;

float hiloSheenAlbedoTexel(ivec2 coordinate) {
    // Engine-managed data image: exactly one logical top-left normalization.
    vec2 encoded = textureLod(u_sheenAlbedoLUT,
        hiloTextureUV((vec2(coordinate) + 0.5) / 32.0), 0.0).rg;
    return dot(encoded, vec2(65280.0, 255.0)) * (8.0 / 65535.0);
}

float hiloSheenLambdaCurve(float cosine, float alpha) {
    float t = (1.0 - alpha) * (1.0 - alpha);
    float a = mix(21.5473, 25.3245, t);
    float b = mix(3.82987, 3.32435, t);
    float c = mix(0.19823, 0.16801, t);
    float d = mix(-1.97760, -1.27393, t);
    float e = mix(-4.32054, -4.85967, t);
    return a / (1.0 + b * pow(max(cosine, 0.0), c)) + d * cosine + e;
}

float hiloSheenLambda(float cosine, float alpha) {
    return exp(cosine < 0.5 ? hiloSheenLambdaCurve(cosine, alpha) :
        2.0 * hiloSheenLambdaCurve(0.5, alpha) - hiloSheenLambdaCurve(1.0 - cosine, alpha));
}

vec4 hiloSheenAlbedoSamples(float NdotV, float roughness, out vec2 fraction) {
    vec2 coordinate = vec2(sqrt(clamp(NdotV, 0.0, 1.0)),
        (clamp(roughness, 0.05, 1.0) - 0.05) / 0.95) * 31.0;
    ivec2 lower = min(ivec2(floor(coordinate)), ivec2(30));
    fraction = coordinate - vec2(lower);
    return vec4(hiloSheenAlbedoTexel(lower), hiloSheenAlbedoTexel(lower + ivec2(1, 0)),
        hiloSheenAlbedoTexel(lower + ivec2(0, 1)), hiloSheenAlbedoTexel(lower + ivec2(1, 1)));
}

float hiloSheenDirectionalAlbedo(float NdotV, float roughness) {
    vec2 fraction;
    vec4 samples = hiloSheenAlbedoSamples(NdotV, roughness, fraction);
    return mix(mix(samples.x, samples.y, fraction.x),
        mix(samples.z, samples.w, fraction.x), fraction.y);
}

float hiloSheenAlbedoBound(float NdotV, float roughness) {
    vec2 fraction;
    vec4 samples = hiloSheenAlbedoSamples(NdotV, roughness, fraction);
    // Cell maxima and a 5% + 0.002 guard bound interpolation and integration error.
    // The published visibility fit exceeds unit albedo for smooth grazing cloth;
    // its reciprocal normalization below preserves both bounded energy and reciprocity.
    return max(max(samples.x, samples.y), max(samples.z, samples.w)) * 1.05 + 0.002;
}

float hiloSheenRawBRDF(vec3 N, vec3 V, vec3 L, float roughness) {
    float NdotL = dot(N, L);
    if (NdotL <= 0.0) return 0.0;
    float NdotV = max(abs(dot(N, V)), 1e-4);
    vec3 halfVector = V + L;
    float NdotH = max(dot(N, halfVector) * inversesqrt(max(dot(halfVector, halfVector), 1e-8)), 0.0);
    float alpha = max(roughness * roughness, 0.0025);
    float inverseAlpha = 1.0 / alpha;
    float distribution = (2.0 + inverseAlpha) *
        pow(max(1.0 - NdotH * NdotH, 0.0), inverseAlpha * 0.5) * (0.5 * HILO_INVERSE_PI);
    // NdotL cancels analytically; retaining it in a tiny denominator loses grazing energy.
    return distribution / (4.0 * NdotV *
        (1.0 + hiloSheenLambda(NdotV, alpha) + hiloSheenLambda(NdotL, alpha)));
}

float hiloSheenBRDF(vec3 N, vec3 V, vec3 L, float roughness) {
    float NdotL = dot(N, L);
    if (NdotL <= 0.0) return 0.0;
    float NdotV = max(abs(dot(N, V)), 1e-4);
    float normalization = max(1.0, max(hiloSheenAlbedoBound(NdotV, roughness),
        hiloSheenAlbedoBound(NdotL, roughness)));
    return hiloSheenRawBRDF(N, V, L, roughness) / normalization;
}
