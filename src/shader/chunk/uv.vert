#ifdef HILO_HAS_TEXCOORD0
    in vec2 a_texcoord0;
    out vec2 v_texcoord0;
    #ifdef HILO_UV_MATRIX
    #endif
#endif

#ifdef HILO_HAS_TEXCOORD1
    in vec2 a_texcoord1;
    out vec2 v_texcoord1;
    #ifdef HILO_UV_MATRIX1
    #endif
#endif

#ifdef HILO_DIFFUSE_CUBE_MAP
    out vec3 v_position;
#endif
