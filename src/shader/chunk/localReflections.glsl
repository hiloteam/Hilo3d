#ifdef HILO_LOCAL_REFLECTIONS
layout(std140) uniform ReflectionProbeBlock {
    vec4 u_reflectionPosition[2];
    vec4 u_reflectionBoxMin[2];
    vec4 u_reflectionBoxMax[2];
    vec4 u_reflectionAtlas[2];
};

#ifdef HILO_REFLECTION_CUBE_0
uniform samplerCube u_localReflection0;
#else
uniform sampler2D u_localReflection0;
#endif
#if HILO_LOCAL_REFLECTIONS > 1
    #ifdef HILO_REFLECTION_CUBE_1
    uniform samplerCube u_localReflection1;
    #else
    uniform sampler2D u_localReflection1;
    #endif
#endif

float hiloReflectionWeight(vec3 position, int index) {
    vec3 edge = min(position - u_reflectionBoxMin[index].xyz, u_reflectionBoxMax[index].xyz - position);
    return u_reflectionPosition[index].w > 0.0
        ? smoothstep(0.0, u_reflectionBoxMin[index].w, min(edge.x, min(edge.y, edge.z))) : 0.0;
}

vec3 hiloReflectionDirection(vec3 position, vec3 direction, int index) {
    vec3 signDirection = mix(vec3(-1.0), vec3(1.0), greaterThanEqual(direction, vec3(0.0)));
    vec3 safeDirection = signDirection * max(abs(direction), vec3(0.000001));
    vec3 exits = max((u_reflectionBoxMin[index].xyz - position) / safeDirection,
        (u_reflectionBoxMax[index].xyz - position) / safeDirection);
    float distanceToBox = min(exits.x, min(exits.y, exits.z));
    return normalize(position + direction * distanceToBox - u_reflectionPosition[index].xyz);
}

vec3 hiloReflectionSample(samplerCube source, vec3 direction, float roughness, int index) {
    vec4 value = textureLod(source, hiloTextureCubeDirection(direction), roughness * u_reflectionBoxMax[index].w);
    return value.rgb / (u_reflectionAtlas[index].z > 0.5 ? max(value.a, 0.000001) : 1.0);
}

vec3 hiloReflectionAtlasLevel(sampler2D source, vec2 uv, float level, int index) {
    vec2 size = u_reflectionAtlas[index].xy;
    float bandHeight = size.y / (u_reflectionBoxMax[index].w + 1.0);
    vec2 local = (vec2(1.0) + uv * vec2(size.x - 2.0, bandHeight - 2.0)) / vec2(size.x, bandHeight);
    // Native viewport rows are shared by CPU atlas packing. Normalize within the selected band,
    // then apply its offset; flipping the entire atlas would exchange roughness bands.
    vec2 normalized = hiloRenderTargetUV(local);
    vec2 atlasUV = vec2(normalized.x, (level + normalized.y) * bandHeight / size.y);
    return textureLod(source, atlasUV, 0.0).rgb;
}

vec3 hiloReflectionSample(sampler2D source, vec3 direction, float roughness, int index) {
    vec2 uv = vec2(fract(atan(direction.x, direction.z) * HILO_INVERSE_PI * 0.5 + 0.5),
        acos(clamp(direction.y, -1.0, 1.0)) * HILO_INVERSE_PI);
    float level = roughness * u_reflectionBoxMax[index].w;
    return mix(hiloReflectionAtlasLevel(source, uv, floor(level), index),
        hiloReflectionAtlasLevel(source, uv, ceil(level), index), fract(level));
}

vec3 hiloLocalReflection(vec3 baseline, vec3 direction, float roughness) {
    vec3 position = (u_viewInverseMatrix * vec4(v_fragPos, 1.0)).xyz + u_renderOrigin.xyz;
    float weight0 = hiloReflectionWeight(position, 0);
    vec3 radiance = vec3(0.0);
    if (weight0 > 0.0) radiance = hiloReflectionSample(u_localReflection0,
        hiloReflectionDirection(position, direction, 0), roughness, 0) * u_reflectionPosition[0].w * weight0;
    float total = weight0;
    #if HILO_LOCAL_REFLECTIONS > 1
        float weight1 = hiloReflectionWeight(position, 1);
        if (weight1 > 0.0) radiance += hiloReflectionSample(u_localReflection1,
            hiloReflectionDirection(position, direction, 1), roughness, 1) * u_reflectionPosition[1].w * weight1;
        total += weight1;
    #endif
    return mix(baseline, radiance / max(total, 0.000001), min(total, 1.0));
}
#endif
