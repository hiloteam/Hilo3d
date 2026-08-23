#ifdef HILO_CLUSTERED_FORWARD
flat in uint v_clusterReceiverLayer;
layout(std430) readonly buffer ClusterFrameDataBlock {
    vec4 values[];
} clusterFrameData;
layout(std430) readonly buffer ClusterLightDataBlock {
    vec4 values[];
} clusterLights;
layout(std430) readonly buffer ClusterLightGridBlock {
    uvec2 values[];
} clusterLightGrid;
layout(std430) readonly buffer ClusterLightIndexBlock {
    uint values[];
} clusterLightIndices;

// Keep these offsets synchronized with ClusteredForwardPlus.ts. Vec4 32 maps output-resolution
// fragment coordinates back to the internal cluster viewport; the shadow payload follows it.
#define HILO_CLUSTER_OUTPUT_MAPPING_VEC4 32u
#define HILO_CLUSTER_SHADOW_ATLAS_SIZE_VEC4 33u
#define HILO_CLUSTER_SHADOW_METADATA_VEC4 34u
#define HILO_CLUSTER_SHADOW_ATLAS_RECTS_VEC4 35u
#define HILO_CLUSTER_SHADOW_DIRECTIONAL_BIASES_VEC4 171u
#define HILO_CLUSTER_SHADOW_DIRECTIONAL_SPLITS_VEC4 179u
#define HILO_CLUSTER_SHADOW_DIRECTIONAL_PARAMS_VEC4 187u
#define HILO_CLUSTER_SHADOW_DIRECTIONAL_MATRICES_VEC4 195u
#define HILO_CLUSTER_SHADOW_SPOT_BIASES_VEC4 323u
#define HILO_CLUSTER_SHADOW_SPOT_MATRICES_VEC4 331u
#define HILO_CLUSTER_SHADOW_POINT_BIASES_VEC4 363u
#define HILO_CLUSTER_SHADOW_POINT_MATRICES_VEC4 379u

uvec2 hiloClusteredAllocation(vec3 viewPosition) {
    float depth = max(-viewPosition.z, clusterFrameData.values[25u].x);
    uvec4 cluster = floatBitsToUint(clusterFrameData.values[27u]);
    vec2 clusterPosition = gl_FragCoord.xy *
        clusterFrameData.values[HILO_CLUSTER_OUTPUT_MAPPING_VEC4].zw;
    uint tileX = min(uint(clusterPosition.x) / cluster.w, cluster.x - 1u);
    uint tileY = min(uint(clusterPosition.y) / cluster.w, cluster.y - 1u);
    float logScale = clusterFrameData.values[25u].z;
    uint slice = min(
        uint(
            clamp(
                log(depth / clusterFrameData.values[25u].x) / logScale,
                0.0,
                0.999999
            ) * float(cluster.z)
        ),
        cluster.z - 1u
    );
    uint clusterIndex = slice * cluster.x * cluster.y + tileY * cluster.x + tileX;
    return clusterLightGrid.values[clusterIndex];
}

#ifdef HILO_CLUSTERED_SHADOWS
mat4 hiloClusteredShadowMatrix(uint base) {
    return mat4(
        clusterFrameData.values[base],
        clusterFrameData.values[base + 1u],
        clusterFrameData.values[base + 2u],
        clusterFrameData.values[base + 3u]
    );
}

float hiloClusteredShadowAtlasVisibility(
    int sliceIndex,
    float bias,
    vec3 viewPosition,
    mat4 lightMatrix
) {
    vec4 clipPosition = lightMatrix * vec4(viewPosition, 1.0);
    if (clipPosition.w <= 0.0) return 1.0;
    vec3 projection = clipPosition.xyz / clipPosition.w;
    projection = projection * 0.5 + 0.5;
    if (
        any(lessThan(projection, vec3(0.0))) ||
        any(greaterThan(projection, vec3(1.0)))
    ) return 1.0;
    vec4 atlasRect = clusterFrameData.values[
        HILO_CLUSTER_SHADOW_ATLAS_RECTS_VEC4 + uint(sliceIndex)
    ];
    vec2 atlasUV = atlasRect.zw + hiloRenderTargetUV(projection.xy) * atlasRect.xy;
    vec2 texel = clusterFrameData.values[HILO_CLUSTER_SHADOW_ATLAS_SIZE_VEC4].zw;
    vec2 rectEnd = atlasRect.zw + atlasRect.xy;
    vec2 rectMin = min(atlasRect.zw, rectEnd) + texel * 0.5;
    vec2 rectMax = max(atlasRect.zw, rectEnd) - texel * 0.5;
    float depthBias = clusterFrameData.values[HILO_CLUSTER_SHADOW_METADATA_VEC4].w > 0.5
        ? bias
        : -bias;
    float visibility = 0.0;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 sampleUV = clamp(
                atlasUV + vec2(float(x), float(y)) * texel,
                rectMin,
                rectMax
            );
            visibility += textureLod(
                u_shadowAtlas,
                vec3(sampleUV, projection.z + depthBias),
                0.0
            );
        }
    }
    return visibility / 9.0;
}

float hiloClusteredDirectionalShadow(int index, float bias, vec3 viewPosition) {
    vec4 splits = clusterFrameData.values[
        HILO_CLUSTER_SHADOW_DIRECTIONAL_SPLITS_VEC4 + uint(index)
    ];
    vec4 parameters = clusterFrameData.values[
        HILO_CLUSTER_SHADOW_DIRECTIONAL_PARAMS_VEC4 + uint(index)
    ];
    int cascadeCount = clamp(int(parameters.x + 0.5), 1, HILO_MAX_DIRECTIONAL_SHADOW_CASCADES);
    float viewDepth = max(-viewPosition.z, 0.0);
    int cascade = 0;
    if (cascadeCount > 1 && viewDepth > splits.x) cascade = 1;
    if (cascadeCount > 2 && viewDepth > splits.y) cascade = 2;
    if (cascadeCount > 3 && viewDepth > splits.z) cascade = 3;
    if (viewDepth > splits[cascadeCount - 1]) return 1.0;
    int matrixIndex = index * HILO_MAX_DIRECTIONAL_SHADOW_CASCADES + cascade;
    uint matrixBase = HILO_CLUSTER_SHADOW_DIRECTIONAL_MATRICES_VEC4 +
        uint(matrixIndex) * 4u;
    float visibility = hiloClusteredShadowAtlasVisibility(
        matrixIndex,
        bias,
        viewPosition,
        hiloClusteredShadowMatrix(matrixBase)
    );
    float blend = parameters.y;
    if (cascade < cascadeCount - 1 && blend > 0.0) {
        float previousSplit = cascade == 0
            ? clusterFrameData.values[25u].x
            : splits[cascade - 1];
        float interval = max(splits[cascade] - previousSplit, 0.00001);
        float blendStart = splits[cascade] - interval * blend;
        if (viewDepth > blendStart) {
            int nextMatrixIndex = matrixIndex + 1;
            float nextVisibility = hiloClusteredShadowAtlasVisibility(
                nextMatrixIndex,
                bias,
                viewPosition,
                hiloClusteredShadowMatrix(
                    HILO_CLUSTER_SHADOW_DIRECTIONAL_MATRICES_VEC4 +
                        uint(nextMatrixIndex) * 4u
                )
            );
            visibility = mix(
                visibility,
                nextVisibility,
                smoothstep(blendStart, splits[cascade], viewDepth)
            );
        }
    }
    float strength = clamp(parameters.z, 0.0, 4.0);
    return clamp(1.0 - (1.0 - visibility) * strength, 0.0, 1.0);
}

float hiloClusteredSpotShadow(int index, float bias, vec3 viewPosition) {
    int sliceIndex = HILO_MAX_DIRECTIONAL_LIGHTS * HILO_MAX_DIRECTIONAL_SHADOW_CASCADES +
        index;
    uint matrixBase = HILO_CLUSTER_SHADOW_SPOT_MATRICES_VEC4 + uint(index) * 4u;
    return hiloClusteredShadowAtlasVisibility(
        sliceIndex,
        bias,
        viewPosition,
        hiloClusteredShadowMatrix(matrixBase)
    );
}

float hiloClusteredPointShadow(int index, float bias, vec3 viewPosition) {
    int matrixOffset = index * 6;
    for (int face = 0; face < 6; face++) {
        int matrixIndex = matrixOffset + face;
        uint matrixBase = HILO_CLUSTER_SHADOW_POINT_MATRICES_VEC4 + uint(matrixIndex) * 4u;
        mat4 lightMatrix = hiloClusteredShadowMatrix(matrixBase);
        vec4 clipPosition = lightMatrix * vec4(viewPosition, 1.0);
        if (clipPosition.w <= 0.0) continue;
        vec3 projection = clipPosition.xyz / clipPosition.w;
        if (abs(projection.x) <= 1.0001 && abs(projection.y) <= 1.0001) {
            int sliceIndex = HILO_MAX_DIRECTIONAL_LIGHTS *
                HILO_MAX_DIRECTIONAL_SHADOW_CASCADES + HILO_MAX_SPOT_LIGHTS + matrixIndex;
            return hiloClusteredShadowAtlasVisibility(
                sliceIndex,
                bias,
                viewPosition,
                lightMatrix
            );
        }
    }
    return 1.0;
}

float hiloClusteredShadow(
    vec4 metadata,
    vec3 viewPosition,
    vec3 normal,
    vec3 lightDirection
) {
    int kind = int(metadata.x + 0.5);
    int index = int(metadata.y + 0.5);
    if (kind == 0) return 1.0;
    uint biasBase = kind == 1
        ? HILO_CLUSTER_SHADOW_DIRECTIONAL_BIASES_VEC4
        : (kind == 2
            ? HILO_CLUSTER_SHADOW_SPOT_BIASES_VEC4
            : HILO_CLUSTER_SHADOW_POINT_BIASES_VEC4);
    vec2 biasParameters = clusterFrameData.values[biasBase + uint(index)].xy;
    float bias = max(
        biasParameters.y * (1.0 - dot(normal, lightDirection)),
        biasParameters.x
    );
    if (kind == 1) return hiloClusteredDirectionalShadow(index, bias, viewPosition);
    if (kind == 2) return hiloClusteredSpotShadow(index, bias, viewPosition);
    return hiloClusteredPointShadow(index, bias, viewPosition);
}
#endif

float hiloClusteredPhotometricAttenuation(
    vec3 viewPosition,
    vec3 lightPosition,
    vec3 lightAxis,
    vec4 cookieParameters,
    vec4 photometricParameters,
    uint featureFlags
) {
    vec3 axis = normalize(lightAxis);
    vec3 delta = viewPosition - lightPosition;
    vec3 reference = abs(axis.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
    vec3 right = normalize(cross(reference, axis));
    vec3 up = cross(axis, right);
    float axialDistance = max(dot(delta, axis), 1e-5);
    float attenuation = 1.0;
    if ((featureFlags & 1u) != 0u) {
        vec2 projected = vec2(dot(delta, right), dot(delta, up)) / axialDistance;
        vec2 coordinate = (projected - cookieParameters.zw) / cookieParameters.xy;
        float edge = 1.0 - max(abs(coordinate.x), abs(coordinate.y));
        float softness = max(photometricParameters.y, 1e-5);
        attenuation *= photometricParameters.x * smoothstep(0.0, softness, edge);
    }
    if ((featureFlags & 2u) != 0u) {
        float axialCosine = max(dot(normalize(delta), axis), 0.0);
        attenuation *= photometricParameters.z * pow(axialCosine, photometricParameters.w);
    }
    return attenuation;
}

void hiloEvaluateClusteredPBRLight(
    uint lightIndex,
    vec3 viewPosition,
    vec3 normal,
    vec3 viewDirection,
    vec3 clearcoatLayerNormal,
    vec3 anisotropyT,
    vec3 anisotropyB,
    vec3 specularColor,
    vec3 diffuseColor,
    vec3 areaSpecularColor,
    vec3 areaDiffuseColor,
    float roughness,
    float anisotropyStrength,
    float iridescenceFactor,
    float iridescenceIor,
    float iridescenceThickness,
    float clearcoatFactor,
    float clearcoatRoughness,
    out vec3 lightDiffuse,
    out vec3 lightSpecular,
    out vec3 clearcoatLighting
) {
    uint lightBase = lightIndex * 7u;
    vec4 positionRange = clusterLights.values[lightBase];
    vec4 colorType = clusterLights.values[lightBase + 1u];
    vec4 directionOuter = clusterLights.values[lightBase + 2u];
    vec4 attenuationInner = clusterLights.values[lightBase + 3u];
    vec4 shadowMetadata = clusterLights.values[lightBase + 4u];
    uint lightType = uint(colorType.w + 0.5);
    lightDiffuse = vec3(0.0);
    lightSpecular = vec3(0.0);
    clearcoatLighting = vec3(0.0);
    uint lightLayerMask = floatBitsToUint(shadowMetadata.z);
    if ((v_clusterReceiverLayer & lightLayerMask) == 0u) return;
    if (lightType == 3u) {
        getAreaLightComponents(
            areaDiffuseColor,
            areaSpecularColor,
            roughness,
            normal,
            viewDirection,
            viewPosition,
            positionRange.xyz,
            colorType.rgb,
            clusterLights.values[lightBase + 5u].xyz,
            clusterLights.values[lightBase + 6u].xyz,
            u_areaLightsLtcTexture1,
            u_areaLightsLtcTexture2,
            lightDiffuse,
            lightSpecular
        );
#ifdef HILO_HAS_CLEARCOAT
        if (clearcoatFactor > 0.0) {
            vec3 unusedDiffuse;
            getAreaLightComponents(
                vec3(0.0),
                vec3(0.04),
                clearcoatRoughness,
                clearcoatLayerNormal,
                viewDirection,
                viewPosition,
                positionRange.xyz,
                colorType.rgb,
                clusterLights.values[lightBase + 5u].xyz,
                clusterLights.values[lightBase + 6u].xyz,
                u_areaLightsLtcTexture1,
                u_areaLightsLtcTexture2,
                unusedDiffuse,
                clearcoatLighting
            );
        }
#endif
        return;
    }
    vec3 lightDirection;
    vec3 radiance = colorType.rgb;
    if (lightType == 2u) {
        lightDirection = normalize(-directionOuter.xyz);
    } else {
        vec3 distanceVector = positionRange.xyz - viewPosition;
        lightDirection = normalize(distanceVector);
        radiance *= getLightAttenuation(
            distanceVector,
            attenuationInner.xyz,
            positionRange.w
        );
        if (lightType == 1u) {
            float theta = dot(lightDirection, normalize(-directionOuter.xyz));
            float epsilon = max(attenuationInner.w - directionOuter.w, 1e-5);
            float cone = clamp((theta - directionOuter.w) / epsilon, 0.0, 1.0);
            radiance *= cone * cone * (3.0 - 2.0 * cone);
            radiance *= hiloClusteredPhotometricAttenuation(
                viewPosition,
                positionRange.xyz,
                directionOuter.xyz,
                clusterLights.values[lightBase + 5u],
                clusterLights.values[lightBase + 6u],
                floatBitsToUint(shadowMetadata.w)
            );
        }
    }
    hiloEvaluateBaseBRDF(
        normal,
        viewDirection,
        lightDirection,
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
    float visibility = 1.0;
#if defined(HILO_CLUSTERED_SHADOWS) && defined(HILO_RECEIVE_SHADOWS)
    visibility = hiloClusteredShadow(
        shadowMetadata,
        viewPosition,
        normal,
        lightDirection
    );
#endif
    lightDiffuse *= visibility * radiance;
    lightSpecular *= visibility * radiance;
#ifdef HILO_HAS_CLEARCOAT
    if (clearcoatFactor > 0.0) {
        clearcoatLighting = visibility * radiance * hiloEvaluateClearcoatBRDF(
            clearcoatLayerNormal,
            viewDirection,
            lightDirection,
            clearcoatRoughness
        );
    }
#endif
}
#endif
