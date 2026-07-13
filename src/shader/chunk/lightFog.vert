#if defined(HILO_HAS_LIGHT) || defined(HILO_HAS_FOG) || defined(HILO_HAS_FRAG_POS)
    #ifdef HILO_HAS_FOG
        out float v_dist;
    #endif

    #if defined(HILO_HAS_LIGHT) || defined(HILO_HAS_FRAG_POS) 
        out vec3 v_fragPos;
    #endif
#endif
