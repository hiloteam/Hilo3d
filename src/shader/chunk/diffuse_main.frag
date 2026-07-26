#if defined(HILO_DIFFUSE_MAP)
    diffuse = HILO_TEXTURE_2D(u_diffuse, HILO_DIFFUSE_MAP);
#elif defined(HILO_DIFFUSE_CUBE_MAP)
    diffuse = texture(u_diffuse, hiloTextureCubeDirection(v_position));
#elif defined(HILO_HAS_COLOR)
    diffuse = v_color;
#else
    diffuse = u_diffuseColor;
#endif
color.a = diffuse.a;
