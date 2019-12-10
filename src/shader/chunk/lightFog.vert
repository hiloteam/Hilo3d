#if defined(HILO_HAS_LIGHT) || defined(HILO_HAS_FOG) || defined(HILO_HAS_FRAG_POS)
    uniform mat4 u_modelViewMatrix;
    #ifdef HILO_HAS_FOG
        varying float v_dist;
    #endif

    #if defined(HILO_HAS_LIGHT) || defined(HILO_HAS_FRAG_POS) 
        varying vec3 v_fragPos;
    #endif
#endif