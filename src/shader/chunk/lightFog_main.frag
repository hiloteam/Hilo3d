#ifdef HILO_HAS_LIGHT
    #if HILO_SIDE == HILO_FRONT_AND_BACK_SIDE
        normal = normal * ( float( gl_FrontFacing ) * 2.0 - 1.0 );
    #endif
#endif