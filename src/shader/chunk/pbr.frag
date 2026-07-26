#include "../method/textureEnvMap.glsl"
#include "../method/encoding.glsl"
#include "../method/portableCoordinates.glsl"
#include "./fixMathCrash.glsl"

#ifdef HILO_HAS_IRIDESCENCE
#include "../method/iridescence.glsl"
#endif

#ifdef HILO_BASE_COLOR_MAP
uniform sampler2D u_baseColorMap;
#endif

#ifdef HILO_HAS_LIGHT
    #ifdef HILO_METALLIC_MAP
    uniform sampler2D u_metallicMap;
    #endif
    #ifdef HILO_ROUGHNESS_MAP
    uniform sampler2D u_roughnessMap;
    #endif
    #ifdef HILO_METALLIC_ROUGHNESS_MAP
    uniform sampler2D u_metallicRoughnessMap;
    #endif
    #ifdef HILO_OCCLUSION_MAP
    uniform sampler2D u_occlusionMap;
    #endif
    #ifdef HILO_DIFFUSE_ENV_MAP
        #ifdef HILO_DIFFUSE_ENV_MAP_CUBE
        uniform samplerCube u_diffuseEnvMap;
        #else
        uniform sampler2D u_diffuseEnvMap;
        #endif
    #endif
    #ifdef HILO_SPECULAR_ENV_MAP
    uniform sampler2D u_brdfLUT;
        #ifdef HILO_SPECULAR_ENV_MAP_CUBE
        uniform samplerCube u_specularEnvMap;
        #else
        uniform sampler2D u_specularEnvMap;
        #endif
    #endif
    #ifdef HILO_EMISSION_MAP
    uniform sampler2D u_emission;
    #endif
    #ifdef HILO_PBR_SPECULAR_GLOSSINESS
        #ifdef HILO_SPECULAR_GLOSSINESS_MAP
        uniform sampler2D u_specularGlossinessMap;
        #endif
    #endif
    #ifdef HILO_LIGHT_MAP
    uniform sampler2D u_lightMap;
    #endif
    #ifdef HILO_HAS_CLEARCOAT
        #ifdef HILO_CLEARCOAT_MAP
        uniform sampler2D u_clearcoatMap;
        #endif
        #ifdef HILO_CLEARCOAT_ROUGHNESS_MAP
        uniform sampler2D u_clearcoatRoughnessMap;
        #endif
    #endif
    #ifdef HILO_HAS_ANISOTROPY
        #ifdef HILO_ANISOTROPY_MAP
        uniform sampler2D u_anisotropyMap;
        #endif
    #endif
    #ifdef HILO_HAS_TRANSMISSION
    uniform sampler2D u_opaqueTexture;
        #ifdef HILO_TRANSMISSION_MAP
        uniform sampler2D u_transmissionMap;
        #endif
        #ifdef HILO_THICKNESS_MAP
        uniform sampler2D u_thicknessMap;
        #endif
    #endif
    #ifdef HILO_HAS_IRIDESCENCE
        #ifdef HILO_IRIDESCENCE_MAP
        uniform sampler2D u_iridescenceMap;
        #endif
        #ifdef HILO_IRIDESCENCE_THICKNESS_MAP
        uniform sampler2D u_iridescenceThicknessMap;
        #endif
    #endif

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

vec3 hiloComputeDiffuseSH(vec3 normal, in vec3 sh[9]) {
    return sh[0] +
        sh[1] * normal.y +
        sh[2] * normal.z +
        sh[3] * normal.x +
        sh[4] * (normal.y * normal.x) +
        sh[5] * (normal.y * normal.z) +
        sh[6] * (3.0 * normal.z * normal.z - 1.0) +
        sh[7] * (normal.z * normal.x) +
        sh[8] * (normal.x * normal.x - normal.y * normal.y);
}

vec3 hiloDecodeRGBD(vec4 color) {
    return color.rgb / max(color.a, 1e-6);
}

vec3 hiloSampleSpecularEnvironment(vec3 direction, float perceptualRoughness) {
    #ifdef HILO_SPECULAR_ENV_MAP
        float lod = clamp(
            perceptualRoughness * u_specularEnvMapMipCount,
            0.0,
            u_specularEnvMapMipCount
        );
        #ifdef HILO_IS_SPECULAR_ENV_MAP_INCLUDE_MIPMAPS
            vec4 encoded = textureEnvMapIncludeMipmapsLod(u_specularEnvMap, direction, lod);
        #elif defined(HILO_USE_SHADER_TEXTURE_LOD)
            vec4 encoded = textureEnvMapLod(u_specularEnvMap, direction, lod);
        #else
            vec4 encoded = textureEnvMap(u_specularEnvMap, direction);
        #endif
        vec3 radiance = hiloDecodeRGBD(encoded);
        #ifdef HILO_GAMMA_CORRECTION
            radiance = sRGBToLinear(radiance);
        #endif
        return radiance * u_specularEnvIntensity;
    #else
        return vec3(0.0);
    #endif
}

vec3 hiloGetIBLDiffuse(vec3 N, vec3 diffuseColor, float ao) {
    #ifdef HILO_NEED_WORLD_NORMAL
        N = normalize(u_viewInverseNormalMatrix * N);
    #endif
    #ifdef HILO_DIFFUSE_ENV_MAP
        vec3 irradiance = textureEnvMap(u_diffuseEnvMap, N).rgb;
        #ifdef HILO_GAMMA_CORRECTION
            irradiance = sRGBToLinear(irradiance);
        #endif
        return irradiance * diffuseColor * ao * u_diffuseEnvIntensity;
    #elif defined(HILO_DIFFUSE_ENV_SPHERE_HARMONICS3)
        return hiloComputeDiffuseSH(N, u_diffuseEnvSphereHarmonics3) *
            diffuseColor * ao * u_diffuseEnvIntensity;
    #else
        return vec3(0.0);
    #endif
}

vec3 hiloGetIBLSpecular(
    vec3 N,
    vec3 V,
    vec3 T,
    vec3 f0,
    float perceptualRoughness,
    float anisotropyStrength,
    float iridescenceFactor,
    float iridescenceIor,
    float iridescenceThickness,
    float ao
) {
    #ifdef HILO_SPECULAR_ENV_MAP
        float NdotV = max(abs(dot(N, V)), 1e-4);
        vec3 reflectionNormal = N;
        #ifdef HILO_HAS_ANISOTROPY
            vec3 anisotropicNormal = cross(T, V);
            anisotropicNormal = normalize(cross(anisotropicNormal, T));
            float bend = anisotropyStrength * (1.0 - perceptualRoughness);
            reflectionNormal = normalize(mix(N, anisotropicNormal, bend));
        #endif
        vec3 R = -normalize(reflect(V, reflectionNormal));
        vec3 horizonNormal = N;
        #ifdef HILO_NEED_WORLD_NORMAL
            R = normalize(u_viewInverseNormalMatrix * R);
            horizonNormal = normalize(u_viewInverseNormalMatrix * N);
        #endif
        vec2 dfg = texture(
            u_brdfLUT,
            hiloTextureUV(vec2(NdotV, 1.0 - perceptualRoughness))
        ).rg;
        vec3 energyCompensation = vec3(1.0) +
            f0 * (1.0 / max(dfg.y, 0.04) - 1.0);
        float specularAO = clamp(
            pow(NdotV + ao, exp2(-16.0 * perceptualRoughness - 1.0)) - 1.0 + ao,
            0.0,
            1.0
        );
        float horizon = min(1.0 + dot(R, horizonNormal), 1.0);
        horizon *= horizon;
        vec3 environmentRadiance = hiloSampleSpecularEnvironment(R, perceptualRoughness);
        vec3 baseResponse = environmentRadiance *
            (f0 * dfg.x + dfg.y) * energyCompensation * specularAO * horizon;
        #ifdef HILO_HAS_IRIDESCENCE
            vec3 iridescenceFresnel = hiloEvaluateIridescence(
                1.0,
                iridescenceIor,
                NdotV,
                iridescenceThickness,
                f0
            );
            vec3 iridescenceResponse =
                environmentRadiance * iridescenceFresnel * specularAO * horizon;
            return mix(baseResponse, iridescenceResponse, iridescenceFactor);
        #else
            return baseResponse;
        #endif
    #else
        return vec3(0.0);
    #endif
}

vec3 hiloGetIBLClearcoat(vec3 N, vec3 V, float perceptualRoughness) {
    #ifdef HILO_SPECULAR_ENV_MAP
        float NdotV = max(abs(dot(N, V)), 1e-4);
        vec3 R = -normalize(reflect(V, N));
        #ifdef HILO_NEED_WORLD_NORMAL
            R = normalize(u_viewInverseNormalMatrix * R);
        #endif
        vec2 dfg = texture(
            u_brdfLUT,
            hiloTextureUV(vec2(NdotV, 1.0 - perceptualRoughness))
        ).rg;
        return hiloSampleSpecularEnvironment(R, perceptualRoughness) *
            (0.04 * dfg.x + dfg.y);
    #else
        return vec3(0.0);
    #endif
}

#ifdef HILO_HAS_TRANSMISSION
vec3 hiloSampleOpaqueScene(vec2 uv, float perceptualRoughness) {
    vec2 texel = 1.0 / max(u_viewport.zw, vec2(1.0));
    float radius = perceptualRoughness * perceptualRoughness * 6.0;
    vec2 offset = texel * radius;
    vec3 result = texture(u_opaqueTexture, uv).rgb * 0.25;
    result += texture(u_opaqueTexture, uv + vec2(offset.x, 0.0)).rgb * 0.125;
    result += texture(u_opaqueTexture, uv - vec2(offset.x, 0.0)).rgb * 0.125;
    result += texture(u_opaqueTexture, uv + vec2(0.0, offset.y)).rgb * 0.125;
    result += texture(u_opaqueTexture, uv - vec2(0.0, offset.y)).rgb * 0.125;
    result += texture(u_opaqueTexture, uv + offset).rgb * 0.0625;
    result += texture(u_opaqueTexture, uv - offset).rgb * 0.0625;
    result += texture(u_opaqueTexture, uv + vec2(offset.x, -offset.y)).rgb * 0.0625;
    result += texture(u_opaqueTexture, uv + vec2(-offset.x, offset.y)).rgb * 0.0625;
    return result;
}

vec3 hiloGetTransmission(
    vec3 viewPosition,
    vec3 N,
    vec3 V,
    vec3 baseColor,
    float perceptualRoughness,
    float thickness
) {
    vec3 refractionDirection = refract(-V, N, 1.0 / max(u_ior, 1.0));
    float pathLength = thickness /
        max(abs(dot(normalize(refractionDirection), normalize(N))), 0.05);
    vec3 exitPosition = viewPosition + refractionDirection * pathLength;
    vec4 clipPosition = u_projectionMatrix * vec4(exitPosition, 1.0);
    vec2 uv = clipPosition.xy / max(abs(clipPosition.w), 1e-5) * 0.5 + 0.5;
    uv = hiloRenderTargetUV(uv);
    uv = clamp(uv, vec2(0.001), vec2(0.999));
    vec3 transmitted = hiloSampleOpaqueScene(uv, perceptualRoughness);
    #ifdef HILO_HAS_VOLUME
        if (u_attenuationDistance > 0.0 && pathLength > 0.0) {
            vec3 attenuation = pow(
                max(u_attenuationColor.rgb, vec3(1e-5)),
                vec3(pathLength / u_attenuationDistance)
            );
            transmitted *= attenuation;
        }
    #endif
    return transmitted * baseColor;
}
#endif
#endif
