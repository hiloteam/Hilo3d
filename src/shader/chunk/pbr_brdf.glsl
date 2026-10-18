float hiloSaturate(float value) {
    return clamp(value, 0.0, 1.0);
}

float hiloPow5(float value) {
    float value2 = value * value;
    return value2 * value2 * value;
}

vec3 hiloFresnelSchlick(vec3 f0, float cosTheta) {
    return f0 + (vec3(1.0) - f0) * hiloPow5(1.0 - hiloSaturate(cosTheta));
}

float hiloFresnelSchlickScalar(float f0, float cosTheta) {
    return f0 + (1.0 - f0) * hiloPow5(1.0 - hiloSaturate(cosTheta));
}

float hiloDistributionGGX(float NdotH, float alpha) {
    float alpha2 = alpha * alpha;
    float denominator = NdotH * NdotH * (alpha2 - 1.0) + 1.0;
    return alpha2 / max(HILO_PI * denominator * denominator, 1e-6);
}

float hiloVisibilityGGXCorrelated(float NdotV, float NdotL, float alpha) {
    float alpha2 = alpha * alpha;
    float lambdaV = NdotL * sqrt(max((NdotV - alpha2 * NdotV) * NdotV + alpha2, 0.0));
    float lambdaL = NdotV * sqrt(max((NdotL - alpha2 * NdotL) * NdotL + alpha2, 0.0));
    return 0.5 / max(lambdaV + lambdaL, 1e-6);
}

float hiloDistributionGGXAnisotropic(
    float NdotH,
    float TdotH,
    float BdotH,
    float alphaT,
    float alphaB
) {
    vec3 d = vec3(TdotH / alphaT, BdotH / alphaB, NdotH);
    float denominator = dot(d, d);
    return 1.0 / max(HILO_PI * alphaT * alphaB * denominator * denominator, 1e-6);
}

float hiloVisibilityGGXAnisotropic(
    float NdotV,
    float NdotL,
    float TdotV,
    float BdotV,
    float TdotL,
    float BdotL,
    float alphaT,
    float alphaB
) {
    float lambdaV = NdotL * length(vec3(alphaT * TdotV, alphaB * BdotV, NdotV));
    float lambdaL = NdotV * length(vec3(alphaT * TdotL, alphaB * BdotL, NdotL));
    return 0.5 / max(lambdaV + lambdaL, 1e-6);
}

vec3 hiloDiffuseBurley(
    vec3 diffuseColor,
    float perceptualRoughness,
    float NdotV,
    float NdotL,
    float LdotH
) {
    float f90 = 0.5 + 2.0 * perceptualRoughness * LdotH * LdotH;
    float lightScatter = 1.0 + (f90 - 1.0) * hiloPow5(1.0 - NdotL);
    float viewScatter = 1.0 + (f90 - 1.0) * hiloPow5(1.0 - NdotV);
    return diffuseColor * HILO_INVERSE_PI * lightScatter * viewScatter;
}

void hiloEvaluateBaseBRDF(
    vec3 N,
    vec3 V,
    vec3 L,
    vec3 T,
    vec3 B,
    vec3 f0,
    vec3 diffuseColor,
    float perceptualRoughness,
    float anisotropyStrength,
    float iridescenceFactor,
    float iridescenceIor,
    float iridescenceThickness,
    out vec3 diffuseTerm,
    out vec3 specularTerm
) {
    vec3 H = normalize(V + L);
    float NdotV = max(abs(dot(N, V)), 1e-4);
    float NdotL = max(dot(N, L), 0.0);
    float NdotH = max(dot(N, H), 0.0);
    float VdotH = max(dot(V, H), 0.0);
    float LdotH = max(dot(L, H), 0.0);
    vec3 baseFresnel = hiloFresnelSchlick(f0, VdotH);
    vec3 F = baseFresnel;
    vec3 diffuseWeight = vec3(1.0) - baseFresnel;
    #ifdef HILO_HAS_IRIDESCENCE
        vec3 iridescenceFresnel = hiloEvaluateIridescence(
            1.0,
            iridescenceIor,
            VdotH,
            iridescenceThickness,
            f0
        );
        F = mix(baseFresnel, iridescenceFresnel, iridescenceFactor);
        float iridescenceReflectance = max(
            max(iridescenceFresnel.r, iridescenceFresnel.g),
            iridescenceFresnel.b
        );
        diffuseWeight = mix(
            diffuseWeight,
            vec3(1.0 - clamp(iridescenceReflectance, 0.0, 1.0)),
            iridescenceFactor
        );
    #endif
    float alpha = max(perceptualRoughness * perceptualRoughness, 0.0025);
    float D;
    float Vis;
    #ifdef HILO_HAS_ANISOTROPY
        float alphaT = mix(alpha, 1.0, anisotropyStrength * anisotropyStrength);
        float alphaB = alpha;
        D = hiloDistributionGGXAnisotropic(
            NdotH,
            dot(T, H),
            dot(B, H),
            alphaT,
            alphaB
        );
        Vis = hiloVisibilityGGXAnisotropic(
            NdotV,
            NdotL,
            dot(T, V),
            dot(B, V),
            dot(T, L),
            dot(B, L),
            alphaT,
            alphaB
        );
    #else
        D = hiloDistributionGGX(NdotH, alpha);
        Vis = hiloVisibilityGGXCorrelated(NdotV, NdotL, alpha);
    #endif
    diffuseTerm = diffuseWeight *
        hiloDiffuseBurley(diffuseColor, perceptualRoughness, NdotV, NdotL, LdotH) * NdotL;
    specularTerm = F * (D * Vis * NdotL);
}

float hiloEvaluateClearcoatBRDF(vec3 N, vec3 V, vec3 L, float perceptualRoughness) {
    vec3 H = normalize(V + L);
    float NdotV = max(abs(dot(N, V)), 1e-4);
    float NdotL = max(dot(N, L), 0.0);
    float NdotH = max(dot(N, H), 0.0);
    float VdotH = max(dot(V, H), 0.0);
    float alpha = max(perceptualRoughness * perceptualRoughness, 0.0025);
    float D = hiloDistributionGGX(NdotH, alpha);
    float Vis = hiloVisibilityGGXCorrelated(NdotV, NdotL, alpha);
    return hiloFresnelSchlickScalar(0.04, VdotH) * D * Vis * NdotL;
}

#ifdef HILO_HAS_SHEEN
#include "./sheen.glsl"
#endif

// Thin diffuse transmission consumes the dielectric diffuse energy, independently
// of base color. The virtual incident direction keeps opposite hemispheres finite.
void hiloEvaluateLayeredBRDF(
    vec3 N, vec3 V, vec3 L, vec3 T, vec3 B,
    vec3 f0, vec3 diffuseColor, float perceptualRoughness,
    float anisotropyStrength, float iridescenceFactor,
    float iridescenceIor, float iridescenceThickness,
    vec3 sheenColor, float sheenRoughness,
    vec3 diffuseTransmissionColor, float diffuseTransmissionFactor,
    out vec3 diffuseTerm, out vec3 specularTerm
) {
    // Exactly opposed directions otherwise normalize a zero half-vector.
    if (dot(N, L) > 0.0) {
        hiloEvaluateBaseBRDF(N, V, L, T, B, f0, diffuseColor,
            perceptualRoughness, anisotropyStrength, iridescenceFactor,
            iridescenceIor, iridescenceThickness, diffuseTerm, specularTerm);
    } else {
        diffuseTerm = vec3(0.0);
        specularTerm = vec3(0.0);
    }
    #ifdef HILO_HAS_DIFFUSE_TRANSMISSION
        diffuseTerm *= 1.0 - diffuseTransmissionFactor;
        float backCosine = max(-dot(N, L), 0.0);
        float transmissionFresnelCosine = sqrt(max((1.0 - dot(V, L)) * 0.5, 0.0));
        vec3 transmissionWeight = vec3(1.0) -
            hiloFresnelSchlick(f0, transmissionFresnelCosine);
        #ifdef HILO_HAS_IRIDESCENCE
            vec3 transmissionIridescence = hiloEvaluateIridescence(1.0, iridescenceIor,
                transmissionFresnelCosine, iridescenceThickness, f0);
            float transmissionIridescenceReflectance = clamp(max(max(transmissionIridescence.r,
                transmissionIridescence.g), transmissionIridescence.b), 0.0, 1.0);
            transmissionWeight = mix(transmissionWeight,
                vec3(1.0 - transmissionIridescenceReflectance), iridescenceFactor);
        #endif
        diffuseTerm += transmissionWeight * diffuseTransmissionColor *
            (HILO_INVERSE_PI * backCosine);
    #endif
    #ifdef HILO_HAS_SHEEN
        if (max(max(sheenColor.r, sheenColor.g), sheenColor.b) <= 0.0) return;
        float NdotV = max(abs(dot(N, V)), 1e-4);
        float sheenAlbedo = max(hiloSheenAlbedoBound(NdotV, sheenRoughness),
            hiloSheenAlbedoBound(abs(dot(N, L)), sheenRoughness));
        float baseWeight = 1.0 - max(max(sheenColor.r, sheenColor.g), sheenColor.b) *
            min(sheenAlbedo, 1.0);
        diffuseTerm *= baseWeight;
        specularTerm *= baseWeight;
        specularTerm += sheenColor * hiloSheenBRDF(N, V, L, sheenRoughness);
    #endif
}
