#ifdef HILO_HAS_TEXCOORD0
    v_texcoord0 = uv;
#endif
#ifdef HILO_HAS_TEXCOORD1
    v_texcoord1 = uv1;
#endif
#ifdef HILO_DIFFUSE_CUBE_MAP
    v_position = pos.xyz;
#endif
