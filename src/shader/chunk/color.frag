#ifdef HILO_HAS_COLOR
    varying vec4 v_color;
#endif

#ifdef HILO_USE_HDR
    uniform float u_exposure;
#endif

#ifdef HILO_GAMMA_CORRECTION
    uniform float u_gammaFactor;
#endif