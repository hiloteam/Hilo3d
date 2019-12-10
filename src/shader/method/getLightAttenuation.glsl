float getLightAttenuation(vec3 distanceVec, vec3 info, float range){
    float distance = length(distanceVec);
    float attenuation = 1.0;
    #ifdef HILO_USE_PHYSICS_LIGHT
        attenuation = max(1.0 / (distance * distance), 0.001);
        if (range > 0.0) {
            attenuation *= max(min(1.0 - pow( distance / range, 4.0 ), 1.0), 0.0);
        }
    #else
        attenuation = 1.0/(info.x + info.y * distance + info.z * distance * distance);
    #endif

    return attenuation;
}

#pragma glslify: export(getLightAttenuation)