#if defined(HILO_DIFFUSE_MAP)
    uniform sampler2D u_diffuse;
#elif defined(HILO_DIFFUSE_CUBE_MAP)
    uniform samplerCube u_diffuse;
#else
#endif
