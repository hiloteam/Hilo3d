#if defined(HILO_HAS_LIGHT) || defined(HILO_HAS_FOG) || defined(HILO_HAS_FRAG_POS)
    vec3 fragPos = (u_modelViewMatrix * pos).xyz;

    #if defined(HILO_HAS_LIGHT) || defined(HILO_HAS_FRAG_POS)
        v_fragPos = fragPos;
    #endif

    #ifdef HILO_HAS_FOG
        v_dist = length(fragPos);
    #endif
#endif