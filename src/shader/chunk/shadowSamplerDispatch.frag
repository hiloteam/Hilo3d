#ifdef HILO_WEBGPU
#ifdef HILO_DIRECTIONAL_LIGHTS_SMC
float hiloDirectionalShadow(
    int index,
    vec2 mapSize,
    float bias,
    vec3 fragPosition,
    mat4 lightSpaceMatrix
) {
    return getShadowAtlas(index, bias, fragPosition, lightSpaceMatrix);
}
#endif

#ifdef HILO_SPOT_LIGHTS_SMC
float hiloSpotShadow(
    int index,
    vec2 mapSize,
    float bias,
    vec3 fragPosition,
    mat4 lightSpaceMatrix
) {
    return getShadowAtlas(HILO_MAX_DIRECTIONAL_LIGHTS + index, bias, fragPosition, lightSpaceMatrix);
}
#endif

#ifdef HILO_POINT_LIGHTS_SMC
float hiloPointShadow(
    int index,
    float bias,
    vec3 lightPosition,
    vec3 fragPosition,
    vec2 cameraPlanes,
    mat4 lightSpaceMatrix
) {
    return getPointShadowAtlas(index, bias, fragPosition);
}
#endif
#else
#ifdef HILO_DIRECTIONAL_LIGHTS_SMC
float hiloDirectionalShadow(
    int index,
    vec2 mapSize,
    float bias,
    vec3 fragPosition,
    mat4 lightSpaceMatrix
) {
    #if HILO_DIRECTIONAL_LIGHTS_SMC > 0
        if (index == 0) return getShadow(u_directionalLightsShadowMap[0], mapSize, bias, fragPosition, lightSpaceMatrix);
    #endif
    #if HILO_DIRECTIONAL_LIGHTS_SMC > 1
        if (index == 1) return getShadow(u_directionalLightsShadowMap[1], mapSize, bias, fragPosition, lightSpaceMatrix);
    #endif
    #if HILO_DIRECTIONAL_LIGHTS_SMC > 2
        if (index == 2) return getShadow(u_directionalLightsShadowMap[2], mapSize, bias, fragPosition, lightSpaceMatrix);
    #endif
    #if HILO_DIRECTIONAL_LIGHTS_SMC > 3
        if (index == 3) return getShadow(u_directionalLightsShadowMap[3], mapSize, bias, fragPosition, lightSpaceMatrix);
    #endif
    #if HILO_DIRECTIONAL_LIGHTS_SMC > 4
        if (index == 4) return getShadow(u_directionalLightsShadowMap[4], mapSize, bias, fragPosition, lightSpaceMatrix);
    #endif
    #if HILO_DIRECTIONAL_LIGHTS_SMC > 5
        if (index == 5) return getShadow(u_directionalLightsShadowMap[5], mapSize, bias, fragPosition, lightSpaceMatrix);
    #endif
    #if HILO_DIRECTIONAL_LIGHTS_SMC > 6
        if (index == 6) return getShadow(u_directionalLightsShadowMap[6], mapSize, bias, fragPosition, lightSpaceMatrix);
    #endif
    #if HILO_DIRECTIONAL_LIGHTS_SMC > 7
        if (index == 7) return getShadow(u_directionalLightsShadowMap[7], mapSize, bias, fragPosition, lightSpaceMatrix);
    #endif
    return 1.0;
}
#endif

#ifdef HILO_SPOT_LIGHTS_SMC
float hiloSpotShadow(
    int index,
    vec2 mapSize,
    float bias,
    vec3 fragPosition,
    mat4 lightSpaceMatrix
) {
    #if HILO_SPOT_LIGHTS_SMC > 0
        if (index == 0) return getShadow(u_spotLightsShadowMap[0], mapSize, bias, fragPosition, lightSpaceMatrix);
    #endif
    #if HILO_SPOT_LIGHTS_SMC > 1
        if (index == 1) return getShadow(u_spotLightsShadowMap[1], mapSize, bias, fragPosition, lightSpaceMatrix);
    #endif
    #if HILO_SPOT_LIGHTS_SMC > 2
        if (index == 2) return getShadow(u_spotLightsShadowMap[2], mapSize, bias, fragPosition, lightSpaceMatrix);
    #endif
    #if HILO_SPOT_LIGHTS_SMC > 3
        if (index == 3) return getShadow(u_spotLightsShadowMap[3], mapSize, bias, fragPosition, lightSpaceMatrix);
    #endif
    #if HILO_SPOT_LIGHTS_SMC > 4
        if (index == 4) return getShadow(u_spotLightsShadowMap[4], mapSize, bias, fragPosition, lightSpaceMatrix);
    #endif
    #if HILO_SPOT_LIGHTS_SMC > 5
        if (index == 5) return getShadow(u_spotLightsShadowMap[5], mapSize, bias, fragPosition, lightSpaceMatrix);
    #endif
    #if HILO_SPOT_LIGHTS_SMC > 6
        if (index == 6) return getShadow(u_spotLightsShadowMap[6], mapSize, bias, fragPosition, lightSpaceMatrix);
    #endif
    #if HILO_SPOT_LIGHTS_SMC > 7
        if (index == 7) return getShadow(u_spotLightsShadowMap[7], mapSize, bias, fragPosition, lightSpaceMatrix);
    #endif
    return 1.0;
}
#endif

#ifdef HILO_POINT_LIGHTS_SMC
float hiloPointShadow(
    int index,
    float bias,
    vec3 lightPosition,
    vec3 fragPosition,
    vec2 cameraPlanes,
    mat4 lightSpaceMatrix
) {
    #if HILO_POINT_LIGHTS_SMC > 0
        if (index == 0) return getShadow(u_pointLightsShadowMap[0], bias, lightPosition, fragPosition, cameraPlanes, lightSpaceMatrix);
    #endif
    #if HILO_POINT_LIGHTS_SMC > 1
        if (index == 1) return getShadow(u_pointLightsShadowMap[1], bias, lightPosition, fragPosition, cameraPlanes, lightSpaceMatrix);
    #endif
    #if HILO_POINT_LIGHTS_SMC > 2
        if (index == 2) return getShadow(u_pointLightsShadowMap[2], bias, lightPosition, fragPosition, cameraPlanes, lightSpaceMatrix);
    #endif
    #if HILO_POINT_LIGHTS_SMC > 3
        if (index == 3) return getShadow(u_pointLightsShadowMap[3], bias, lightPosition, fragPosition, cameraPlanes, lightSpaceMatrix);
    #endif
    #if HILO_POINT_LIGHTS_SMC > 4
        if (index == 4) return getShadow(u_pointLightsShadowMap[4], bias, lightPosition, fragPosition, cameraPlanes, lightSpaceMatrix);
    #endif
    #if HILO_POINT_LIGHTS_SMC > 5
        if (index == 5) return getShadow(u_pointLightsShadowMap[5], bias, lightPosition, fragPosition, cameraPlanes, lightSpaceMatrix);
    #endif
    #if HILO_POINT_LIGHTS_SMC > 6
        if (index == 6) return getShadow(u_pointLightsShadowMap[6], bias, lightPosition, fragPosition, cameraPlanes, lightSpaceMatrix);
    #endif
    #if HILO_POINT_LIGHTS_SMC > 7
        if (index == 7) return getShadow(u_pointLightsShadowMap[7], bias, lightPosition, fragPosition, cameraPlanes, lightSpaceMatrix);
    #endif
    #if HILO_POINT_LIGHTS_SMC > 8
        if (index == 8) return getShadow(u_pointLightsShadowMap[8], bias, lightPosition, fragPosition, cameraPlanes, lightSpaceMatrix);
    #endif
    #if HILO_POINT_LIGHTS_SMC > 9
        if (index == 9) return getShadow(u_pointLightsShadowMap[9], bias, lightPosition, fragPosition, cameraPlanes, lightSpaceMatrix);
    #endif
    #if HILO_POINT_LIGHTS_SMC > 10
        if (index == 10) return getShadow(u_pointLightsShadowMap[10], bias, lightPosition, fragPosition, cameraPlanes, lightSpaceMatrix);
    #endif
    #if HILO_POINT_LIGHTS_SMC > 11
        if (index == 11) return getShadow(u_pointLightsShadowMap[11], bias, lightPosition, fragPosition, cameraPlanes, lightSpaceMatrix);
    #endif
    #if HILO_POINT_LIGHTS_SMC > 12
        if (index == 12) return getShadow(u_pointLightsShadowMap[12], bias, lightPosition, fragPosition, cameraPlanes, lightSpaceMatrix);
    #endif
    #if HILO_POINT_LIGHTS_SMC > 13
        if (index == 13) return getShadow(u_pointLightsShadowMap[13], bias, lightPosition, fragPosition, cameraPlanes, lightSpaceMatrix);
    #endif
    #if HILO_POINT_LIGHTS_SMC > 14
        if (index == 14) return getShadow(u_pointLightsShadowMap[14], bias, lightPosition, fragPosition, cameraPlanes, lightSpaceMatrix);
    #endif
    #if HILO_POINT_LIGHTS_SMC > 15
        if (index == 15) return getShadow(u_pointLightsShadowMap[15], bias, lightPosition, fragPosition, cameraPlanes, lightSpaceMatrix);
    #endif
    return 1.0;
}
#endif
#endif
