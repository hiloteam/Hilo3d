#ifdef HILO_HAS_TEXCOORD0
    #ifdef HILO_UV_MATRIX
        v_texcoord0 = (u_uvMatrix * vec3(uv, 1.0)).xy;
    #else
        v_texcoord0 = uv;
    #endif
#endif
#ifdef HILO_HAS_TEXCOORD1
    #ifdef HILO_UV_MATRIX1
        v_texcoord1 = (u_uvMatrix1 * vec3(uv1, 1.0)).xy;
    #else
        v_texcoord1 = uv1;
    #endif
#endif
#ifdef HILO_DIFFUSE_CUBE_MAP
    v_position = pos.xyz;
#endif