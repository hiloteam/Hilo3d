bool isOutOfRange(vec2 pos) {
    if (pos.x < 0.0 || pos.x > 1.0 || pos.y < 0.0 || pos.y > 1.0) {
        return true;
    }
    return false;
}

float getShadow(sampler2D shadowMap, vec2 shadowMapSize, float bias, vec3 fragPos, mat4 lightSpaceMatrix) {
    vec4 fragPosLightSpace = lightSpaceMatrix * vec4(fragPos, 1.0);
    vec3 projCoords = fragPosLightSpace.xyz / fragPosLightSpace.w;
    projCoords = projCoords * 0.5 + 0.5;
    if (isOutOfRange(projCoords.xy)) {
        return 1.0;
    }
    float currentDepth = projCoords.z;
    float shadow = 0.0;
    vec2 texelSize = 1.0 / shadowMapSize;
    for (int x = -1; x <= 1; ++x) {
        for (int y = -1; y <= 1; ++y) {
            vec2 pos = projCoords.xy + vec2(x, y) * texelSize;
            if (isOutOfRange(pos)) {
                shadow += 1.0;
            } else {
                float pcfDepth = texture2D(shadowMap, pos).r;
                shadow += currentDepth - bias > pcfDepth ? 1.0 : 0.0;
            }
        }
    }
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
                float closestDistance = camera[0] + (camera[1] - camera[0]) * unpackFloat(textureCube(shadowMap, direction + vec3(x, y, z)));
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

#pragma glslify: export(getShadow)