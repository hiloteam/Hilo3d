#ifdef HILO_IGNORE_TRANSPARENT
color.a = 1.0;
#endif

#if defined(HILO_USE_HDR) && !defined(HILO_LINEAR_OUTPUT)
    color.rgb = vec3(1.0) - exp(-color.rgb * u_exposure);
#endif

#if defined(HILO_GAMMA_CORRECTION) && !defined(HILO_LINEAR_OUTPUT)
    color.rgb = pow(color.rgb, vec3(1.0 / u_gammaFactor));
#endif

#include "./fog_main.frag"

#ifdef HILO_PREMULTIPLY_ALPHA
    color.rgb *= color.a;
#endif

hilo_FragColor = color;
