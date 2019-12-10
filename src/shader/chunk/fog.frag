#ifdef HILO_HAS_FOG
    varying float v_dist;
    uniform vec4 u_fogColor;
    
    #ifdef HILO_FOG_LINEAR
        uniform vec2 u_fogInfo;
    #else
        uniform float u_fogInfo;
    #endif
#endif