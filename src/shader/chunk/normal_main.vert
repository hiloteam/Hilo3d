#ifdef HILO_HAS_NORMAL
    #if defined(HILO_NORMAL_MAP) || defined(HILO_CLEARCOAT_NORMAL_MAP) || defined(HILO_NEED_TANGENT_BASIS)
        mat3 viewNormalMatrix = mat3(u_viewMatrix) * u_normalWorldMatrix;
        vec3 T = normalize(viewNormalMatrix * tangent.xyz);
        vec3 N = normalize(viewNormalMatrix * normal);
        T = normalize(T - dot(T, N) * N);
        vec3 B = cross(N, T) * tangent.w;
        v_TBN = mat3(T, B, N);
    #endif
    v_normal = normalize(mat3(u_viewMatrix) * u_normalWorldMatrix * normal);
#endif
