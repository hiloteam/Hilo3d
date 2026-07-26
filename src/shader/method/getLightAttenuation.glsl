float getLightAttenuation(vec3 distanceVec, vec3 info, float range){
    float distanceSquared = dot(distanceVec, distanceVec);
    #ifdef HILO_USE_PHYSICS_LIGHT
        float attenuation = 1.0 / max(distanceSquared, 0.01);
        if (range > 0.0) {
            float normalizedDistanceSquared = distanceSquared / (range * range);
            float smoothRange = clamp(
                1.0 - normalizedDistanceSquared * normalizedDistanceSquared,
                0.0,
                1.0
            );
            attenuation *= smoothRange * smoothRange;
        }
        return attenuation;
    #else
        float distance = sqrt(distanceSquared);
        return 1.0 / max(info.x + info.y * distance + info.z * distanceSquared, 1e-4);
    #endif
}
