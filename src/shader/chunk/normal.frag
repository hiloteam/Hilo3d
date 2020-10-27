#ifdef HILO_HAS_NORMAL
    varying vec3 v_normal;
    #if defined(HILO_NORMAL_MAP) || defined(HILO_CLEARCOAT_NORMAL_MAP)
        varying mat3 v_TBN;
        #ifdef HILO_NORMAL_MAP
            uniform HILO_SAMPLER_2D u_normalMap;
            
            #ifdef HILO_NORMAL_MAP_SCALE
            uniform float u_normalMapScale;
            #endif
        #endif

        #ifdef HILO_CLEARCOAT_NORMAL_MAP
            uniform HILO_SAMPLER_2D u_clearcoatNormalMap;
        #endif
    #endif
#endif