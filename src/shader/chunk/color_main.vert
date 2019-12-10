#ifdef HILO_HAS_COLOR
    #if HILO_COLOR_SIZE == 3
        v_color = vec4(a_color, 1.0);
    #elif HILO_COLOR_SIZE == 4
        v_color = a_color;
    #endif
#endif