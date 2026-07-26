#ifdef HILO_HAS_NORMAL
    in vec3 v_normal;
    #if defined(HILO_NORMAL_MAP) || defined(HILO_CLEARCOAT_NORMAL_MAP) || defined(HILO_NEED_TANGENT_BASIS)
        in mat3 v_TBN;
        #ifdef HILO_NORMAL_MAP
            uniform sampler2D u_normalMap;
            
            #ifdef HILO_NORMAL_MAP_SCALE
            #endif
        #endif

        #ifdef HILO_CLEARCOAT_NORMAL_MAP
            uniform sampler2D u_clearcoatNormalMap;
        #endif
    #endif
#endif
