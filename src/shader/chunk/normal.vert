#ifdef HILO_HAS_NORMAL
    attribute vec3 a_normal;
    uniform mat3 u_normalMatrix;
    varying vec3 v_normal;

    #if defined(HILO_NORMAL_MAP) || defined(HILO_CLEARCOAT_NORMAL_MAP)
        attribute vec4 a_tangent;
        varying mat3 v_TBN;
    #endif
#endif