float transparency = 1.0;
#ifdef HILO_TRANSPARENCY_MAP
    transparency = HILO_TEXTURE_2D(u_transparency, HILO_TRANSPARENCY_MAP).r;
#else
    transparency = u_transparencyFactor;
#endif
color.a *= transparency;
#if defined(HILO_MOTION_VECTOR_PASS) && defined(HILO_TEMPORAL_FORCE_REACTIVE)
    if (color.a <= 0.00392156862745098) discard;
#endif
#ifdef HILO_ALPHA_CUTOFF
    if (color.a < u_alphaCutoff) {
        discard;
    } else {
        color.a = 1.0;
    }
#endif
