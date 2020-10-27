#ifdef HILO_NORMAL_MAP
    vec3 normal = HILO_TEXTURE_2D(u_normalMap).rgb * 2.0 - 1.0;
    #ifdef HILO_NORMAL_MAP_SCALE
        normal.xy *= u_normalMapScale;
    #endif
    normal = normalize(v_TBN * normal);
#elif defined(HILO_HAS_NORMAL)
    vec3 normal = normalize(v_normal);
#else
    vec3 normal = vec3(0, 0, 1);
#endif

#ifdef HILO_HAS_CLEARCOAT
    #ifdef HILO_CLEARCOAT_NORMAL_MAP
        vec3 clearcoatNormal = HILO_TEXTURE_2D(u_clearcoatNormalMap).rgb * 2.0 - 1.0;
        clearcoatNormal = normalize(v_TBN * clearcoatNormal);
    #elif defined(HILO_HAS_NORMAL)
        vec3 clearcoatNormal = normalize(v_normal);
    #else
        vec3 clearcoatNormal = vec3(0, 0, 1);
    #endif
#endif

#if HILO_SIDE == HILO_BACK_SIDE
    normal = -normal;
    #ifdef HILO_HAS_CLEARCOAT
        clearcoatNormal = -clearcoatNormal;
    #endif
#endif