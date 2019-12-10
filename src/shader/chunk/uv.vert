#ifdef HILO_HAS_TEXCOORD0
    attribute vec2 a_texcoord0;
    varying vec2 v_texcoord0;
    #ifdef HILO_UV_MATRIX
        uniform mat3 u_uvMatrix;
    #endif
#endif

#ifdef HILO_HAS_TEXCOORD1
    attribute vec2 a_texcoord1;
    varying vec2 v_texcoord1;
    #ifdef HILO_UV_MATRIX1
        uniform mat3 u_uvMatrix1;
    #endif
#endif

#ifdef HILO_DIFFUSE_CUBE_MAP
    varying vec3 v_position;
#endif