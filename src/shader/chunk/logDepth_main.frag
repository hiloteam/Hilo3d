#if defined(HILO_USE_LOG_DEPTH) && defined(HILO_USE_EXT_FRAG_DEPTH)
    gl_FragDepthEXT = log2( v_fragDepth ) * u_logDepth * 0.5;
#endif