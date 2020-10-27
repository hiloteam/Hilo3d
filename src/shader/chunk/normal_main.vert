#ifdef HILO_HAS_NORMAL
    #if defined(HILO_NORMAL_MAP) || defined(HILO_CLEARCOAT_NORMAL_MAP)
        vec3 T = normalize(u_normalMatrix * tangent.xyz);
        vec3 N = normalize(u_normalMatrix * normal);
        T = normalize(T - dot(T, N) * N);
        vec3 B = cross(N, T) * tangent.w;
        v_TBN = mat3(T, B, N);
    #endif
    v_normal = normalize(u_normalMatrix * normal);
#endif