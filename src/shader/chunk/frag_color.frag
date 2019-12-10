#ifdef HILO_IGNORE_TRANSPARENT
color.a = 1.0;
#endif

#ifdef HILO_USE_HDR
    color.rgb = vec3(1.0) - exp(-color.rgb * u_exposure);
#endif

#ifdef HILO_GAMMA_CORRECTION
    color.rgb = pow(color.rgb, vec3(1.0 / u_gammaFactor));
#endif

#pragma glslify: import('./fog_main.frag');

#ifdef HILO_PREMULTIPLY_ALPHA
    color.rgb *= color.a;
#endif

gl_FragColor = color;