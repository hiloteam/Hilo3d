#ifdef HILO_HAS_FOG
    float fogFactor = 1.0;

    #ifdef HILO_FOG_LINEAR
        fogFactor = (u_fogInfo.y - v_dist)/(u_fogInfo.y - u_fogInfo.x);
    #elif defined(HILO_FOG_EXP)
        fogFactor = exp(-abs(u_fogInfo * v_dist));
    #elif defined(HILO_FOG_EXP2)
        fogFactor = exp(-(u_fogInfo * v_dist) * (u_fogInfo * v_dist)); 
    #endif
    
    fogFactor = clamp(fogFactor, 0.0, 1.0);
    color = mix(u_fogColor, color, fogFactor);
#endif