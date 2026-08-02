#ifdef HILO_HAS_LIGHT
    #ifdef HILO_DOUBLE_SIDED
        normal = normal * ( float( gl_FrontFacing ) * 2.0 - 1.0 );
    #endif
#endif
