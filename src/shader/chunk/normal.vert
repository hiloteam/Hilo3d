#ifdef HILO_HAS_NORMAL
    in vec3 a_normal;
    out vec3 v_normal;

    #if defined(HILO_NORMAL_MAP) || defined(HILO_CLEARCOAT_NORMAL_MAP) || defined(HILO_NEED_TANGENT_BASIS)
        in vec4 a_tangent;
        out mat3 v_TBN;
    #endif
#endif
