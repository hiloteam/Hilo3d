#ifdef HILO_HAS_COLOR
    #if HILO_COLOR_SIZE == 3
        attribute vec3 a_color;
    #elif HILO_COLOR_SIZE == 4
        attribute vec4 a_color;
    #endif
    varying vec4 v_color;
#endif