#ifdef HILO_HAS_COLOR
    #if HILO_COLOR_SIZE == 3
        in vec3 a_color;
    #elif HILO_COLOR_SIZE == 4
        in vec4 a_color;
    #endif
    out vec4 v_color;
#endif
