#ifdef HILO_USE_LOG_DEPTH
    #ifdef HILO_USE_EXT_FRAG_DEPTH
        varying float v_fragDepth;
    #else
        uniform float u_logDepth;
    #endif
#endif