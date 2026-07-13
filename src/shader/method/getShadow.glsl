bool isOutOfRange(vec2 pos) {
    if (pos.x < 0.0 || pos.x > 1.0 || pos.y < 0.0 || pos.y > 1.0) {
        return true;
    }
    return false;
}

#ifdef HILO_WEBGPU
#if defined(HILO_DIRECTIONAL_LIGHTS_SMC) || defined(HILO_SPOT_LIGHTS_SMC) || defined(HILO_POINT_LIGHTS_SMC)
float getShadowAtlas(int sliceIndex, float bias, vec3 fragPos, mat4 lightSpaceMatrix) {
    vec4 clipPosition = lightSpaceMatrix * vec4(fragPos, 1.0);
    if (clipPosition.w <= 0.0) {
        return 1.0;
    }
    vec3 projection = clipPosition.xyz / clipPosition.w;
    projection = projection * 0.5 + 0.5;
    if (isOutOfRange(projection.xy) || projection.z < 0.0 || projection.z > 1.0) {
        return 1.0;
    }
    vec4 atlasRect = u_shadowAtlasRects[sliceIndex];
    vec2 atlasUV = atlasRect.zw + projection.xy * atlasRect.xy;
    vec2 texel = u_shadowAtlasSize.zw;
    vec2 rectEnd = atlasRect.zw + atlasRect.xy;
    vec2 rectMin = min(atlasRect.zw, rectEnd) + texel * 0.5;
    vec2 rectMax = max(atlasRect.zw, rectEnd) - texel * 0.5;
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
                vec3(sampleUV, projection.z - bias),
                0.0
            );
        }
    }
    return visibility / 9.0;
}

float getPointShadowAtlas(int lightIndex, float bias, vec3 fragPos) {
    int matrixOffset = lightIndex * 6;
    for (int face = 0; face < 6; face++) {
        mat4 lightSpaceMatrix = u_pointShadowMatrices[matrixOffset + face];
        vec4 clipPosition = lightSpaceMatrix * vec4(fragPos, 1.0);
        if (clipPosition.w <= 0.0) {
            continue;
        }
        vec3 projection = clipPosition.xyz / clipPosition.w;
        if (abs(projection.x) <= 1.0001 && abs(projection.y) <= 1.0001) {
            return getShadowAtlas(
                HILO_MAX_DIRECTIONAL_LIGHTS + HILO_MAX_SPOT_LIGHTS + matrixOffset + face,
                bias,
                fragPos,
                lightSpaceMatrix
            );
        }
    }
    return 1.0;
}
#endif
#else

float getShadow(vec2 pos, sampler2D shadowMap, float currentDepth) {
    if (isOutOfRange(pos)) {
        return 0.0;
    }
    float pcfDepth = unpackFloat(texture(shadowMap, pos));
    return step(pcfDepth, currentDepth);
}

float getShadow(sampler2D shadowMap, vec2 shadowMapSize, float bias, vec3 fragPos, mat4 lightSpaceMatrix) {
    vec4 fragPosLightSpace = lightSpaceMatrix * vec4(fragPos, 1.0);
    vec3 projCoords = fragPosLightSpace.xyz / fragPosLightSpace.w;
    projCoords = projCoords * 0.5 + 0.5;
    if (isOutOfRange(projCoords.xy)) {
        return 1.0;
    }
    float currentDepth = projCoords.z - bias;
    float shadow = 0.0;
    vec2 texelSize = 1.0 / shadowMapSize;
    shadow += getShadow(projCoords.xy + vec2(-1, -1) * texelSize, shadowMap, currentDepth);
    shadow += getShadow(projCoords.xy + vec2(0, -1) * texelSize, shadowMap, currentDepth);
    shadow += getShadow(projCoords.xy + vec2(1, -1) * texelSize, shadowMap, currentDepth);
    shadow += getShadow(projCoords.xy + vec2(-1, 0) * texelSize, shadowMap, currentDepth);
    shadow += getShadow(projCoords.xy + vec2(0, 0) * texelSize, shadowMap, currentDepth);
    shadow += getShadow(projCoords.xy + vec2(1, 0) * texelSize, shadowMap, currentDepth);
    shadow += getShadow(projCoords.xy + vec2(-1, 1) * texelSize, shadowMap, currentDepth);
    shadow += getShadow(projCoords.xy + vec2(0, 1) * texelSize, shadowMap, currentDepth);
    shadow += getShadow(projCoords.xy + vec2(1, 1) * texelSize, shadowMap, currentDepth);

    return 1.0 - shadow / 9.0;
}

float getShadow(samplerCube shadowMap, float bias, vec3 lightPos, vec3 position, vec2 camera, mat4 lightSpaceMatrix) {
    vec4 distanceVec = lightSpaceMatrix * vec4(position, 1.0) - lightSpaceMatrix * vec4(lightPos, 1.0);
    float currentDistance = length(distanceVec);
    vec3 direction = normalize(distanceVec).xyz;

    float shadow = 0.0;
    const float samples = 2.0;
    const float offset = 0.01;
    const float step = offset / (samples * 0.5);
    for(float x = -offset; x < offset; x +=step)
    {
        for(float y = -offset; y < offset; y +=step)
        {
            for(float z = -offset; z < offset; z +=step)
            {
                float closestDistance = camera[0] + (camera[1] - camera[0]) * unpackFloat(texture(shadowMap, direction + vec3(x, y, z)));
                if (closestDistance == camera[0]) {
                    continue;
                }
                else if(currentDistance - bias > closestDistance)
                    shadow += 1.0;
            }
        }
    }
    shadow /= (samples * samples * samples);

    return 1.0 - shadow;
}
#endif
