vec4 baseColorSample = vec4(1.0);
vec3 emissionColor = u_emissionFactor.rgb;

#ifdef HILO_BASE_COLOR_MAP
    baseColorSample = HILO_TEXTURE_2D(u_baseColorMap, HILO_BASE_COLOR_MAP);
#endif
vec4 baseColor = hiloEvaluatePBRBaseColor(u_baseColor, baseColorSample);

#ifdef HILO_HAS_COLOR
baseColor *= v_color;
#endif

color.a = baseColor.a;
#include "./transparency_main.frag"

#ifdef HILO_HAS_LIGHT
vec3 N = normal;
vec3 V = normalize(-v_fragPos);

#ifdef HILO_OCCLUSION_MAP
float ao = HILO_TEXTURE_2D(u_occlusionMap, HILO_OCCLUSION_MAP).r;
#else
float ao = 1.0;
#endif

#ifdef HILO_PBR_SPECULAR_GLOSSINESS
    vec3 specularColor = u_specularColor.rgb;
    float glossiness = u_glossiness;
    #ifdef HILO_SPECULAR_GLOSSINESS_MAP
        vec4 specularGlossiness =
            HILO_TEXTURE_2D(u_specularGlossinessMap, HILO_SPECULAR_GLOSSINESS_MAP);
        specularColor *= specularGlossiness.rgb;
        glossiness *= specularGlossiness.a;
    #endif
    float roughness = clamp(1.0 - glossiness, 0.045, 1.0);
    float metallic = 0.0;
    vec3 diffuseColor = baseColor.rgb *
        (1.0 - max(max(specularColor.r, specularColor.g), specularColor.b));
    vec3 iblDiffuseColor = diffuseColor;
#else
    float metallic = u_metallic;
    float roughness = u_roughness;
    #ifdef HILO_METALLIC_MAP
        metallic *= HILO_TEXTURE_2D(u_metallicMap, HILO_METALLIC_MAP).r;
    #endif
    #ifdef HILO_ROUGHNESS_MAP
        roughness *= HILO_TEXTURE_2D(u_roughnessMap, HILO_ROUGHNESS_MAP).r;
    #endif
    #ifdef HILO_METALLIC_ROUGHNESS_MAP
        vec4 metallicRoughness = HILO_TEXTURE_2D(
            u_metallicRoughnessMap,
            HILO_METALLIC_ROUGHNESS_MAP
        );
        #ifdef HILO_IS_OCCLUSION_MAP_IN_METALLIC_ROUGHNESS_MAP
            ao = metallicRoughness.r;
        #endif
        roughness *= metallicRoughness.g;
        metallic *= metallicRoughness.b;
    #endif
    HiloMetallicRoughnessSurface metallicRoughnessSurface =
        hiloEvaluateMetallicRoughnessSurface(
            baseColor,
            emissionColor,
            metallic,
            roughness,
            ao,
            0.0,
            u_ior
        );
    metallic = metallicRoughnessSurface.metallic;
    roughness = metallicRoughnessSurface.roughness;
    vec3 diffuseColor = metallicRoughnessSurface.diffuseColor;
    vec3 specularColor = metallicRoughnessSurface.specularColor;
    vec3 iblDiffuseColor = metallicRoughnessSurface.iblDiffuseColor;
#endif

float iridescenceFactor = 0.0;
float iridescenceIor = 1.3;
float iridescenceThickness = 0.0;
vec3 areaDiffuseColor = diffuseColor;
vec3 areaSpecularColor = specularColor;
#ifdef HILO_HAS_IRIDESCENCE
    iridescenceFactor = clamp(u_iridescenceFactor, 0.0, 1.0);
    iridescenceIor = max(u_iridescenceIor, 1.0);
    #ifdef HILO_IRIDESCENCE_MAP
        iridescenceFactor *= HILO_TEXTURE_2D(
            u_iridescenceMap,
            HILO_IRIDESCENCE_MAP
        ).r;
    #endif
    iridescenceThickness = max(u_iridescenceThicknessMaximum, 0.0);
    #ifdef HILO_IRIDESCENCE_THICKNESS_MAP
        float iridescenceThicknessSample = HILO_TEXTURE_2D(
            u_iridescenceThicknessMap,
            HILO_IRIDESCENCE_THICKNESS_MAP
        ).g;
        iridescenceThickness = mix(
            u_iridescenceThicknessMinimum,
            u_iridescenceThicknessMaximum,
            iridescenceThicknessSample
        );
    #endif
    if (iridescenceThickness <= 0.0) iridescenceFactor = 0.0;
    vec3 iridescenceFresnelView = hiloEvaluateIridescence(
        1.0,
        iridescenceIor,
        max(abs(dot(N, V)), 1e-4),
        iridescenceThickness,
        specularColor
    );
    float iridescenceReflectanceView = clamp(
        max(
            max(iridescenceFresnelView.r, iridescenceFresnelView.g),
            iridescenceFresnelView.b
        ),
        0.0,
        1.0
    );
    iblDiffuseColor = mix(
        iblDiffuseColor,
        diffuseColor * (1.0 - iridescenceReflectanceView),
        iridescenceFactor
    );
    areaDiffuseColor = mix(
        diffuseColor,
        diffuseColor * (1.0 - iridescenceReflectanceView),
        iridescenceFactor
    );
    areaSpecularColor = mix(
        specularColor,
        iridescenceFresnelView,
        iridescenceFactor
    );
#endif

#ifdef HILO_OCCLUSION_STRENGTH
ao = hiloEvaluatePBROcclusion(ao, u_occlusionStrength);
#endif

float materialAmbientOcclusion = ao;
vec3 indirectDiffuseNormal = N;
vec3 gtaoDiffuseVisibility = vec3(1.0);
float gtaoSpecularVisibility = 1.0;
#ifdef HILO_GTAO
vec2 gtaoUV = (gl_FragCoord.xy - u_viewport.xy) / max(u_viewport.zw, vec2(1.0));
vec4 gtaoSample = texture(u_gtaoTexture, gtaoUV);
float gtaoVisibility = clamp(gtaoSample.b, 0.0, 1.0);
indirectDiffuseNormal = hiloDecodeGTAOBentNormal(gtaoSample.xy);
gtaoDiffuseVisibility = hiloGTAOMultiBounceVisibility(
    gtaoVisibility,
    clamp(baseColor.rgb, 0.0, 1.0),
    clamp(gtaoSample.a, 0.0, 1.0)
);
gtaoSpecularVisibility = hiloGTAOSpecularVisibility(
    gtaoVisibility,
    indirectDiffuseNormal,
    N,
    V,
    roughness
);
#endif

vec3 anisotropyT = N;
vec3 anisotropyB = N;
float anisotropyStrength = 0.0;
#ifdef HILO_HAS_ANISOTROPY
    vec2 anisotropyDirection = vec2(cos(u_anisotropyRotation), sin(u_anisotropyRotation));
    anisotropyStrength = clamp(u_anisotropyStrength, 0.0, 1.0);
    #ifdef HILO_ANISOTROPY_MAP
        vec3 anisotropySample = HILO_TEXTURE_2D(u_anisotropyMap, HILO_ANISOTROPY_MAP).rgb;
        vec2 textureDirection = anisotropySample.rg * 2.0 - 1.0;
        float directionLength = length(textureDirection);
        if (directionLength > 1e-4) {
            textureDirection /= directionLength;
            anisotropyDirection = vec2(
                anisotropyDirection.x * textureDirection.x -
                    anisotropyDirection.y * textureDirection.y,
                anisotropyDirection.x * textureDirection.y +
                    anisotropyDirection.y * textureDirection.x
            );
        }
        anisotropyStrength *= anisotropySample.b;
    #endif
    anisotropyT = v_TBN * vec3(anisotropyDirection, 0.0);
    anisotropyT = normalize(anisotropyT - N * dot(anisotropyT, N));
    anisotropyB = normalize(cross(N, anisotropyT));
#endif

float clearcoatFactor = 0.0;
float clearcoatRoughness = 0.0;
vec3 clearcoatDirect = vec3(0.0);
#ifdef HILO_HAS_CLEARCOAT
    clearcoatFactor = clamp(u_clearcoatFactor, 0.0, 1.0);
    #ifdef HILO_CLEARCOAT_MAP
        clearcoatFactor *= HILO_TEXTURE_2D(u_clearcoatMap, HILO_CLEARCOAT_MAP).r;
    #endif
    clearcoatRoughness = clamp(u_clearcoatRoughnessFactor, 0.045, 1.0);
    #ifdef HILO_CLEARCOAT_ROUGHNESS_MAP
        clearcoatRoughness *= HILO_TEXTURE_2D(
            u_clearcoatRoughnessMap,
            HILO_CLEARCOAT_ROUGHNESS_MAP
        ).g;
    #endif
#endif

vec3 directDiffuse = vec3(0.0);
vec3 directSpecular = vec3(0.0);
vec3 lightDiffuse;
vec3 lightSpecular;

#ifndef HILO_CLUSTERED_FORWARD
#ifdef HILO_DIRECTIONAL_LIGHTS
for (int i = 0; i < HILO_DIRECTIONAL_LIGHTS; i++) {
    vec3 lightDir = normalize(-u_directionalLightsInfo[i]);
    vec3 radiance = u_directionalLightsColor[i];
    float shadow = 1.0;
    #ifdef HILO_DIRECTIONAL_LIGHTS_SMC
        if (i < HILO_DIRECTIONAL_LIGHTS_SMC) {
            float bias = HILO_MAX(
                u_directionalLightsShadowBias[i][1] * (1.0 - dot(N, lightDir)),
                u_directionalLightsShadowBias[i][0]
            );
            shadow = hiloDirectionalShadow(
                i,
                u_directionalLightsShadowMapSize[i],
                bias,
                v_fragPos,
                u_directionalLightSpaceMatrix[i]
            );
        }
    #endif
    hiloEvaluateBaseBRDF(
        N,
        V,
        lightDir,
        anisotropyT,
        anisotropyB,
        specularColor,
        diffuseColor,
        roughness,
        anisotropyStrength,
        iridescenceFactor,
        iridescenceIor,
        iridescenceThickness,
        lightDiffuse,
        lightSpecular
    );
    directDiffuse += shadow * radiance * lightDiffuse;
    directSpecular += shadow * radiance * lightSpecular;
    #ifdef HILO_HAS_CLEARCOAT
        clearcoatDirect += shadow * radiance *
            hiloEvaluateClearcoatBRDF(clearcoatNormal, V, lightDir, clearcoatRoughness);
    #endif
}
#endif

#ifdef HILO_SPOT_LIGHTS
for (int i = 0; i < HILO_SPOT_LIGHTS; i++) {
    vec3 spotDirection = normalize(-u_spotLightsDir[i]);
    vec3 distanceVector = u_spotLightsPos[i] - v_fragPos;
    vec3 lightDir = normalize(distanceVector);
    float theta = dot(lightDir, spotDirection);
    float epsilon = max(u_spotLightsCutoffs[i][0] - u_spotLightsCutoffs[i][1], 1e-5);
    float cone = clamp((theta - u_spotLightsCutoffs[i][1]) / epsilon, 0.0, 1.0);
    cone = cone * cone * (3.0 - 2.0 * cone);
    float attenuation = getLightAttenuation(
        distanceVector,
        u_spotLightsInfo[i],
        u_spotLightsRange[i]
    );
    vec3 radiance = cone * attenuation * u_spotLightsColor[i];
    float shadow = 1.0;
    #ifdef HILO_SPOT_LIGHTS_SMC
        if (i < HILO_SPOT_LIGHTS_SMC) {
            float bias = HILO_MAX(
                u_spotLightsShadowBias[i][1] * (1.0 - dot(N, lightDir)),
                u_spotLightsShadowBias[i][0]
            );
            shadow = hiloSpotShadow(
                i,
                u_spotLightsShadowMapSize[i],
                bias,
                v_fragPos,
                u_spotLightSpaceMatrix[i]
            );
        }
    #endif
    hiloEvaluateBaseBRDF(
        N,
        V,
        lightDir,
        anisotropyT,
        anisotropyB,
        specularColor,
        diffuseColor,
        roughness,
        anisotropyStrength,
        iridescenceFactor,
        iridescenceIor,
        iridescenceThickness,
        lightDiffuse,
        lightSpecular
    );
    directDiffuse += shadow * radiance * lightDiffuse;
    directSpecular += shadow * radiance * lightSpecular;
    #ifdef HILO_HAS_CLEARCOAT
        clearcoatDirect += shadow * radiance *
            hiloEvaluateClearcoatBRDF(clearcoatNormal, V, lightDir, clearcoatRoughness);
    #endif
}
#endif

#ifdef HILO_POINT_LIGHTS
for (int i = 0; i < HILO_POINT_LIGHTS; i++) {
    vec3 distanceVector = u_pointLightsPos[i] - v_fragPos;
    vec3 lightDir = normalize(distanceVector);
    float attenuation = getLightAttenuation(
        distanceVector,
        u_pointLightsInfo[i],
        u_pointLightsRange[i]
    );
    vec3 radiance = attenuation * u_pointLightsColor[i];
    float shadow = 1.0;
    #ifdef HILO_POINT_LIGHTS_SMC
        if (i < HILO_POINT_LIGHTS_SMC) {
            float bias = HILO_MAX(
                u_pointLightsShadowBias[i][1] * (1.0 - dot(N, lightDir)),
                u_pointLightsShadowBias[i][0]
            );
            shadow = hiloPointShadow(
                i,
                bias,
                u_pointLightsPos[i],
                v_fragPos,
                u_pointLightCamera[i],
                u_pointLightSpaceMatrix[i]
            );
        }
    #endif
    hiloEvaluateBaseBRDF(
        N,
        V,
        lightDir,
        anisotropyT,
        anisotropyB,
        specularColor,
        diffuseColor,
        roughness,
        anisotropyStrength,
        iridescenceFactor,
        iridescenceIor,
        iridescenceThickness,
        lightDiffuse,
        lightSpecular
    );
    directDiffuse += shadow * radiance * lightDiffuse;
    directSpecular += shadow * radiance * lightSpecular;
    #ifdef HILO_HAS_CLEARCOAT
        clearcoatDirect += shadow * radiance *
            hiloEvaluateClearcoatBRDF(clearcoatNormal, V, lightDir, clearcoatRoughness);
    #endif
}
#endif

#ifdef HILO_AREA_LIGHTS
for (int i = 0; i < HILO_AREA_LIGHTS; i++) {
    getAreaLightComponents(
        areaDiffuseColor,
        areaSpecularColor,
        roughness,
        N,
        V,
        v_fragPos,
        u_areaLightsPos[i],
        u_areaLightsColor[i],
        u_areaLightsWidth[i],
        u_areaLightsHeight[i],
        u_areaLightsLtcTexture1,
        u_areaLightsLtcTexture2,
        lightDiffuse,
        lightSpecular
    );
    directDiffuse += lightDiffuse;
    directSpecular += lightSpecular;
    #ifdef HILO_HAS_CLEARCOAT
        getAreaLightComponents(
            vec3(0.0),
            vec3(0.04),
            clearcoatRoughness,
            clearcoatNormal,
            V,
            v_fragPos,
            u_areaLightsPos[i],
            u_areaLightsColor[i],
            u_areaLightsWidth[i],
            u_areaLightsHeight[i],
            u_areaLightsLtcTexture1,
            u_areaLightsLtcTexture2,
            lightDiffuse,
            lightSpecular
        );
        clearcoatDirect += lightSpecular;
    #endif
}
#endif
#else
uvec2 clusteredAllocation = hiloClusteredAllocation(v_fragPos);
uint clusteredGlobalLightCount = floatBitsToUint(clusterFrameData.values[30u]).x;
uint clusteredLocalLightCount = clusteredAllocation.y;
vec3 clusteredClearcoatNormal = N;
#ifdef HILO_HAS_CLEARCOAT
clusteredClearcoatNormal = clearcoatNormal;
#endif
for (uint lightIndex = 0u; lightIndex < clusteredGlobalLightCount; lightIndex += 1u) {
    vec3 clusteredClearcoat;
    hiloEvaluateClusteredPBRLight(
        lightIndex,
        v_fragPos,
        N,
        V,
        clusteredClearcoatNormal,
        anisotropyT,
        anisotropyB,
        specularColor,
        diffuseColor,
        areaSpecularColor,
        areaDiffuseColor,
        roughness,
        anisotropyStrength,
        iridescenceFactor,
        iridescenceIor,
        iridescenceThickness,
        clearcoatFactor,
        clearcoatRoughness,
        lightDiffuse,
        lightSpecular,
        clusteredClearcoat
    );
    directDiffuse += lightDiffuse;
    directSpecular += lightSpecular;
    clearcoatDirect += clusteredClearcoat;
}
for (uint clusteredIndex = 0u; clusteredIndex < clusteredLocalLightCount; clusteredIndex += 1u) {
    uint lightIndex = clusterLightIndices.values[clusteredAllocation.x + clusteredIndex];
    vec3 clusteredClearcoat;
    hiloEvaluateClusteredPBRLight(
        lightIndex,
        v_fragPos,
        N,
        V,
        clusteredClearcoatNormal,
        anisotropyT,
        anisotropyB,
        specularColor,
        diffuseColor,
        areaSpecularColor,
        areaDiffuseColor,
        roughness,
        anisotropyStrength,
        iridescenceFactor,
        iridescenceIor,
        iridescenceThickness,
        clearcoatFactor,
        clearcoatRoughness,
        lightDiffuse,
        lightSpecular,
        clusteredClearcoat
    );
    directDiffuse += lightDiffuse;
    directSpecular += lightSpecular;
    clearcoatDirect += clusteredClearcoat;
}
#endif

vec3 indirectDiffuse = hiloGetIBLDiffuse(
    indirectDiffuseNormal,
    iblDiffuseColor,
    materialAmbientOcclusion
) * gtaoDiffuseVisibility;
vec3 indirectSpecular = hiloGetIBLSpecular(
    N,
    V,
    anisotropyT,
    specularColor,
    roughness,
    anisotropyStrength,
    iridescenceFactor,
    iridescenceIor,
    iridescenceThickness,
    materialAmbientOcclusion * gtaoSpecularVisibility
);

#if defined(HILO_CLUSTERED_FORWARD) && (defined(HILO_IS_DIFFUSE_ENV_AND_AMBIENT_LIGHT_WORK_TOGETHER) || (!defined(HILO_DIFFUSE_ENV_MAP) && !defined(HILO_DIFFUSE_ENV_SPHERE_HARMONICS3)))
indirectDiffuse += clusterFrameData.values[31u].rgb * iblDiffuseColor *
    materialAmbientOcclusion * gtaoDiffuseVisibility * HILO_INVERSE_PI;
#elif defined(HILO_AMBIENT_LIGHTS) && (defined(HILO_IS_DIFFUSE_ENV_AND_AMBIENT_LIGHT_WORK_TOGETHER) || (!defined(HILO_DIFFUSE_ENV_MAP) && !defined(HILO_DIFFUSE_ENV_SPHERE_HARMONICS3)))
indirectDiffuse += u_ambientLightsColor * iblDiffuseColor *
    materialAmbientOcclusion * gtaoDiffuseVisibility * HILO_INVERSE_PI;
#endif

#ifdef HILO_LIGHT_MAP
vec4 lightMapColor = HILO_TEXTURE_2D(u_lightMap, HILO_LIGHT_MAP);
indirectDiffuse += baseColor.rgb * hiloDecodeRGBD(lightMapColor);
#endif

#ifdef HILO_EMISSION_MAP
    emissionColor = hiloEvaluatePBREmission(
        emissionColor,
        HILO_TEXTURE_2D(u_emission, HILO_EMISSION_MAP).rgb
    );
#endif

vec3 diffuseLighting = directDiffuse + indirectDiffuse;
vec3 baseLayer = diffuseLighting + directSpecular + indirectSpecular + emissionColor;

#ifdef HILO_HAS_TRANSMISSION
    float transmission = clamp(u_transmissionFactor, 0.0, 1.0);
    #ifdef HILO_TRANSMISSION_MAP
        transmission *= HILO_TEXTURE_2D(u_transmissionMap, HILO_TRANSMISSION_MAP).r;
    #endif
    float thickness = 0.0;
    #ifdef HILO_HAS_VOLUME
        thickness = max(u_thicknessFactor, 0.0);
        #ifdef HILO_THICKNESS_MAP
            thickness *= HILO_TEXTURE_2D(u_thicknessMap, HILO_THICKNESS_MAP).g;
        #endif
    #endif
    vec3 transmitted = hiloGetTransmission(
        v_fragPos,
        N,
        V,
        baseColor.rgb,
        roughness,
        thickness
    );
    baseLayer = mix(diffuseLighting, transmitted, transmission) +
        directSpecular + indirectSpecular + emissionColor;
#endif

#ifdef HILO_HAS_CLEARCOAT
    float clearcoatNdotV = max(abs(dot(clearcoatNormal, V)), 1e-4);
    float clearcoatFresnel = hiloFresnelSchlickScalar(0.04, clearcoatNdotV);
    vec3 clearcoatIndirect = hiloGetIBLClearcoat(
        clearcoatNormal,
        V,
        clearcoatRoughness
    );
    baseLayer = baseLayer * (1.0 - clearcoatFactor * clearcoatFresnel) +
        clearcoatFactor * (clearcoatDirect + clearcoatIndirect);
#endif

color.rgb = baseLayer;
#else
color.rgb = baseColor.rgb + emissionColor;
#endif
