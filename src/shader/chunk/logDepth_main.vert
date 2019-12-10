#ifdef HILO_USE_LOG_DEPTH
    #ifdef HILO_USE_EXT_FRAG_DEPTH
        v_fragDepth = 1.0 + gl_Position.w;
    #else
        gl_Position.z = log2( max( 1e-6, gl_Position.w + 1.0 ) ) * u_logDepth - 1.0;
        gl_Position.z *= gl_Position.w;
    #endif
#endif