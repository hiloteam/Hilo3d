#if defined(HILO_DIFFUSE_MAP)
    uniform HILO_SAMPLER_2D u_diffuse;
#elif defined(HILO_DIFFUSE_CUBE_MAP)
    uniform samplerCube u_diffuse;
#else
    uniform vec4 u_diffuse;
#endif